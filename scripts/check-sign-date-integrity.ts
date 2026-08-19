// 계약일이 실제 서명일과 갈리는지 검사 — 읽기 전용, 위반 시 exit 1 (2026-08-04).
//
// 계약서의 계약일은 화면 상태 하나로 정해졌고 그 초기값이 무조건 '오늘'이었다. 발급이 하루라도
// 늦으면 종이에 엉뚱한 날이 찍혔고, 그 값 하나가 계약번호 앞자리·파일명·보관 레코드까지 결정했다.
// 실제로 7/29 에 서명하고 미발급으로 남은 건이 있었다 — 그날 발급했으면 6일 어긋난 계약서가 나갔다.
//
// 결함을 찾는 것이 아니라 **고친 정본이 다시 사라지는지**를 지킨다. 셋 다 0 이 정상이다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { kstYmdStr } from '../lib/kstDate'

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const violations: string[] = []

  // 축 1. 발급본에 박힌 계약일이 그 계약의 실제 서명일과 다른가.
  //   ContractFile.signedAt 은 발급 시점에 계약일로 채워진다. 서명 시각과 날짜가 갈리면
  //   이미 종이로 나간 계약서에 틀린 날이 찍혀 있다는 뜻이다.
  //   폐기본(voidedAt)은 뺀다. 그 종이의 계약일은 **그때 그 서명일**이 맞고, 폐기 후 재서명을 받으면
  //   lease 의 서명일만 새 날로 바뀐다 — 남겨 두면 정당한 이력이 통째로 위반으로 뜬다(신고 63cd1049).
  //   구버전(supersededAt)도 같은 이유로 뺀다. 새 판본을 쓰면 lease 의 서명일이 새 날로 바뀌는데
  //   앞 판본의 종이에는 그때 그 서명일이 찍혀 있고 그것이 맞다(2026-08-20 다중 버전).
  //   **축을 '라이브 또는 이력 중 하나와 일치' 로 넓히는 안은 채택하지 않았다** — 집합 소속 판정이
  //   되면 이 축이 잡아야 할 결함(발급이 옛 링크 날짜를 인쇄하던 것)이 그물 밖으로 나간다.
  const files = await prisma.contractFile.findMany({
    // not: null 필터를 안 쓴다 — 이 클라이언트 버전이 거부한다. 걸러내는 것은 아래 루프가 한다.
    where: { source: 'GENERATED', deletedAt: null, voidedAt: null, supersededAt: null },
    select: {
      id: true, signedAt: true, contractNo: true,
      tenant: { select: { name: true } },
      leaseTerm: { select: { signatureSignedAt: true } },
    },
  })
  for (const f of files) {
    const truth = f.leaseTerm?.signatureSignedAt
    if (!truth || !f.signedAt) continue
    const onPaper = kstYmdStr(new Date(f.signedAt))
    const actual = kstYmdStr(new Date(truth))
    if (onPaper !== actual) {
      violations.push(`[발급본] ${f.tenant?.name ?? '?'} ${f.contractNo ?? f.id} 의 계약일이 ${onPaper} 인데 실제 서명일은 ${actual} 이다`)
    }
  }

  // 축 2. 서명은 있는데 시각이 없는가. 있으면 기록 경로 하나가 새고 있다는 뜻이고,
  //   그 계약은 다음 발급 때 계약일이 '오늘'로 나간다.
  const noTime = await prisma.leaseTerm.findMany({
    where: { NOT: { signatureImageUrl: null }, signatureSignedAt: null },
    select: { id: true, tenant: { select: { name: true } } },
  })
  for (const l of noTime) {
    violations.push(`[시각 미기록] ${l.tenant?.name ?? '?'} 의 계약서 서명에 시각이 없다 — 다음 발급에서 계약일이 오늘로 찍힌다`)
  }

  // 축 3. 원격 링크의 서명 시각과 lease 의 시각이 갈렸는가.
  //   둘은 같은 트랜잭션에서 같은 값으로 쓴다. 갈리면 그 트랜잭션이 깨진 것이다.
  //
  //   단, 대조 대상은 **현재 서명을 만든 링크 하나**다(같은 판정을 lib/contractVersion
  //   isCurrentSignatureLink 가 정본으로 들고 있다 — 드리프트 비교·본문 잠금 검사가 그것을 쓴다).
  //   서명을 지우고 새 링크로 다시 받으면
  //   (502호 2026-08-11 실사례 — 이름 정정 재서명) 옛 링크의 서명일은 정당한 과거 기록이라
  //   lease 의 새 서명일과 갈리는 것이 정상이다. 그래서 닫힌 링크는 건너뛰고, 열린 링크
  //   중에서도 계약마다 가장 최근에 서명된 것만 대조한다.
  const links = await prisma.contractShareLink.findMany({
    where: { NOT: { signedAt: null }, closedAt: null },
    select: {
      id: true, signedAt: true, leaseTermId: true,
      tenant: { select: { name: true } },
      leaseTerm: { select: { signatureSignedAt: true } },
    },
  })
  const latestByLease = new Map<string, (typeof links)[number]>()
  for (const k of links) {
    if (!k.signedAt) continue
    const cur = latestByLease.get(k.leaseTermId)
    if (!cur || new Date(k.signedAt) > new Date(cur.signedAt!)) latestByLease.set(k.leaseTermId, k)
  }
  for (const k of latestByLease.values()) {
    const mine = k.leaseTerm?.signatureSignedAt
    if (!mine || !k.signedAt) continue
    if (kstYmdStr(new Date(mine)) !== kstYmdStr(new Date(k.signedAt))) {
      violations.push(`[기록 이탈] ${k.tenant?.name ?? '?'} 의 링크 서명일과 lease 서명일이 다르다`)
    }
  }

  await prisma.$disconnect()

  if (violations.length) {
    console.error(`\n[계약일 정합] 위반 ${violations.length}건`)
    for (const v of violations) console.error('  - ' + v)
    console.error('\n  계약일은 실제로 서명한 날이어야 한다. 발급 시점의 오늘이 아니다.')
    process.exit(1)
  }
  console.log(`[계약일 정합] 발급본 ${files.length}건 · 서명 링크 ${links.length}건 / 위반 0건`)
}

main()
