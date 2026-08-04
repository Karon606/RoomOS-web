// 서명이 끝난 계약의 본문이 뒤에 바뀌었는지 검사 — 읽기 전용, 위반 시 exit 1 (2026-08-04).
//
// [본문 편집]과 [공통 템플릿으로]가 서명 유무를 안 보고 열려 있었다. 화면에도 서버에도 가드가 없어
// 서명받은 내용과 다른 계약서로 갈아치울 수 있었다(운영자 신고). 잠금을 넣었으니 그 잠금이
// 다시 사라지는지를 지킨다.
//
// **언제 바뀌었나는 판정할 수 없다.** contractOverride 가 바뀐 시각이 DB 에 없고, updatedAt 은
// 임대료 변경·퇴실 정산에도 밀려서 근거가 못 된다(계약서 6/29 발급인데 값이 7/1 인 lease 가 실재한다).
// 그래서 시각이 아니라 **결과**로 판정한다 — 서명본 스냅샷이 '그 사람이 서명한 본문'의 사본이므로,
// 지금 override 가 그것과 다르다는 사실만으로 서명 후 변경이 증명된다. 순서를 몰라도 결론이 난다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

type Snapshot = { template?: unknown; lease?: unknown }

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const violations: string[] = []

  const links = await prisma.contractShareLink.findMany({
    where: { NOT: { signedAt: null } },
    orderBy: { createdAt: 'desc' },
    select: {
      leaseTermId: true, templateSnapshot: true,
      tenant: { select: { name: true } },
      leaseTerm: { select: { contractOverride: true } },
    },
  })

  // 한 lease 에 링크가 여럿이면 가장 최근 서명본이 기준이다
  const seen = new Set<string>()
  let checked = 0
  let drifted = 0
  for (const k of links) {
    if (!k.leaseTermId || seen.has(k.leaseTermId)) continue
    seen.add(k.leaseTermId)
    const snapTemplate = (k.templateSnapshot as Snapshot | null)?.template
    if (snapTemplate === undefined) continue
    checked++
    const now = JSON.stringify(snapTemplate)

    // 축 G1 — 이 lease 가 개별 수정본을 갖고 있는데 그 값이 서명본과 다르다.
    //   override 가 null 이면 후보에서 빠진다 — 영업장 공통 템플릿이 바뀌어 생긴 드리프트는
    //   이 축에 섞이지 않는다. 이 축은 **본문 편집이라는 행위만** 본다.
    const ov = k.leaseTerm?.contractOverride
    if (ov != null && JSON.stringify(ov) !== now) {
      violations.push(`${k.tenant?.name ?? '?'} 의 계약서 본문이 서명본과 다르다 — 서명 후 본문 편집이 일어났다`)
    }

    // 현황 R1 — 서명본과 지금 실제로 발급될 본문이 다른가. 원인이 영업장 공통 템플릿이라
    //   이번 잠금으로는 0 으로 못 만든다. 종료코드에 반영하지 않는다.
    if (ov == null) drifted++   // override 가 없으면 공통 템플릿을 따라가므로 8/3 변경분이 그대로 반영된다
  }

  await prisma.$disconnect()

  console.log(`[본문 잠금] 서명본 ${checked}건 검사 / 위반 ${violations.length}건`)
  console.log(`  [현황] 서명본과 현재 본문이 갈릴 수 있는 건 ${drifted}건 (현재 기준선 5).`)
  console.log('  원인은 환경설정의 영업장 공통 계약서 본문이고 이번 잠금 범위 밖이다. 게이트로 세지 않는다.')
  if (violations.length) {
    console.error(`\n[본문 잠금] 위반 ${violations.length}건`)
    for (const v of violations) console.error('  - ' + v)
    console.error('\n  서명이 완료된 계약서는 본문을 고칠 수 없다. 내용을 바꾸려면 재서명을 받는다.')
    process.exit(1)
  }
}

main()
