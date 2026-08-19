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
//
// 2026-08-05 에 표시값 오버라이드(contractFieldOverrides)가 들어왔다. 본문과 같은 클래스라
// 같은 방식으로 지킨다 — 축 G5.
//
// 2026-08-10 에 축 G6 이 붙었다. 위 다섯 축이 '서명본과 지금이 다른가'를 보는 반면, G6 은
// **서명이 사라졌는데 서명본 링크가 열린 채 남았는가**를 본다. 아래 상수 주석 참조.
//
// 2026-08-19 에 축 G7 이 붙었고(폐기 이력의 증거 결손), G1·G5 의 대조 대상이 '지금 lease 에 남아
// 있는 서명을 만든 링크'로 좁아졌다(lib/contractVersion isCurrentSignatureLink). 버전 폐기가
// 정식 동사가 되면서, 무효가 된 옛 링크를 기준으로 삼으면 정당한 재작성이 위반으로 뜬다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { contractLeaseFields, parseContractFieldOverrides } from '../lib/contractFieldOverrides'
import {
  isCurrentSignatureLink, parseContractVersionArchive, voidedVersionHasEvidence,
} from '../lib/contractVersion'

type Snapshot = { template?: unknown; lease?: unknown }

// 축 G6 의 래칫 기준선 — 봉합 시점(2026-08-10) 실측 1건(502호).
//
// 왜 0 이 아닌가. 봉합(부분 서명 삭제 시 closeAllLinks)은 **앞으로 일어날 삭제**에만 작동한다.
// 이미 열린 채 남은 옛 링크는 그 코드가 지나간 자리에 없다. 그리고 이 1건은 데이터를 손대서
// 지우면 안 된다 — closedAt 을 사람이 세우는 것은 땜빵이고, 진입로 교정(1번)이 들어가 있어
// 화면은 이미 정상이다. 즉 지금 이 1건은 '남은 자국'이지 '살아 있는 고장'이 아니다.
//
// 스스로 사라지는 기준선이다. 운영자가 재발급을 마쳐 새 서명이 lease 에 들어오면 네 칸이
// 다시 채워져 이 링크는 조건에서 빠지고, 그 순간 실측이 0 이 된다. 그때 아래 값을 0 으로 내린다
// (줄어드는 쪽은 통과시키되 안내를 찍는다 — 기준선이 낡은 채로 굳지 않게).
// 호실·이름을 명단으로 박지 않는다. 특정 입주자를 코드에 새기면 그 데이터가 사라질 때 검사도 같이 죽는다.
const G6_BASELINE = 0

const FIELD_LABEL: Record<string, string> = {
  rentAmount: '입실료', depositAmount: '보증금', cleaningFee: '청소비',
  moveInDate: '입실일', expectedMoveOut: '퇴실 예정일', dueDay: '매월 납부일',
  roomNo: '호실', registrationStatus: '전입신고', nameStyle: '성명 표기',
}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const violations: string[] = []

  // ── 축 G2·G3·G4 — 서명 시점 본문 격리 ────────────────────────────
  // 공통 템플릿을 고쳐도 서명이 끝난 계약서가 안 바뀌어야 한다(운영자 오더 "절대로").
  const leases = await prisma.leaseTerm.findMany({
    select: {
      id: true, signatureImageUrl: true, signatureSignedAt: true,
      disposalSignatureImageUrl: true, disposalSignatureSignedAt: true,
      signedContractSnapshot: true, contractOverride: true, contractVersionArchive: true,
      tenant: { select: { name: true } },
    },
  })
  const fileIds = new Set((await prisma.contractFile.findMany({
    where: { deletedAt: null }, select: { id: true },
  })).map(f => f.id))

  // 축 G7 — 폐기 이력에 서명 증거가 하나도 안 담겼다.
  //   폐기는 '증거를 이력으로 옮기고 잠금만 푸는' 조작이다(lib/contractVersion). 이력 항목에
  //   서명 이미지도 시각도 격리본도 없으면, 그 폐기는 아무것도 안 남기고 지운 것이다 —
  //   폐기가 조용한 삭제로 퇴화한 상태이고, 그때는 무엇에 서명했는지 되짚을 길이 사라진다.
  let voidedVersions = 0
  for (const l of leases) {
    for (const e of parseContractVersionArchive(l.contractVersionArchive)) {
      voidedVersions++
      if (!voidedVersionHasEvidence(e)) {
        violations.push(`${l.tenant?.name ?? '?'} 의 폐기 기록(${e.voidedAt})에 서명 증거가 없다 — 폐기가 증거를 안 담고 지웠다`)
      }
    }
  }

  for (const l of leases) {
    const who = l.tenant?.name ?? '?'
    const hasSig = !!(l.signatureImageUrl || l.signatureSignedAt || l.disposalSignatureImageUrl || l.disposalSignatureSignedAt)
    const snap = l.signedContractSnapshot as { origin?: string; template?: unknown; sourceContractFileId?: string } | null

    // G2 — 서명이 있으면 격리본이 반드시 있다. 없으면 그 계약은 다음 발급에서 현재 본문으로 나간다.
    if (hasSig && !snap) {
      violations.push(`${who} 의 서명에 본문 격리본이 없다 — 공통 템플릿이 바뀌면 재발급본이 서명 당시와 달라진다`)
      continue
    }
    if (!snap) continue

    // G3 — 본문 담은 격리본은 origin 과 template 이 짝이 맞아야 한다.
    const bodyOrigins = ['REMOTE_LINK', 'IN_PERSON']
    if (bodyOrigins.includes(snap.origin ?? '') && !snap.template) {
      violations.push(`${who} 의 격리본이 ${snap.origin} 인데 본문이 없다 — 박제가 반쪽만 됐다`)
    }
    // G4 — 본문 없는 격리본은 가리키는 증거 파일이 실재해야 한다. 허공을 가리키면 증거가 없는 것이다.
    if (!bodyOrigins.includes(snap.origin ?? '')) {
      if (!snap.sourceContractFileId || !fileIds.has(snap.sourceContractFileId)) {
        violations.push(`${who} 의 격리본이 가리키는 계약서 파일이 없다 — 서명 원본의 증거가 사라졌다`)
      }
    }
  }

  const links = await prisma.contractShareLink.findMany({
    where: { NOT: { signedAt: null } },
    orderBy: { createdAt: 'desc' },
    select: {
      leaseTermId: true, templateSnapshot: true, signedAt: true, disposalSignedAt: true,
      tenant: { select: { name: true } },
      leaseTerm: {
        select: {
          contractOverride: true, contractFieldOverrides: true,
          signatureSignedAt: true, disposalSignatureSignedAt: true,
          moveInDate: true, expectedMoveOut: true, rentAmount: true, depositAmount: true,
          cleaningFee: true, dueDay: true, registrationStatus: true,
          room: { select: { roomNo: true } },
        },
      },
    },
  })

  // 한 lease 에 링크가 여럿이면 가장 최근 서명본이 기준이다
  const seen = new Set<string>()
  let checked = 0
  let fieldChecked = 0
  let skippedStale = 0
  for (const k of links) {
    if (!k.leaseTermId || seen.has(k.leaseTermId)) continue
    seen.add(k.leaseTermId)
    // **지금 lease 에 남아 있는 서명을 만든 링크만** 대조한다(lib/contractVersion 정본).
    // 링크의 signedAt 은 과거 사실이라 서명을 지워도, 버전을 폐기해도 남는다. 그 링크를 기준으로
    // 삼으면 '폐기하고 이름을 고쳐 다시 작성'이라는 정당한 운영이 곧바로 위반으로 뜬다.
    // G1·G5 가 잡으려는 것은 **서명이 살아 있는데 그 뒤에 고친 경우**뿐이다.
    // 축 3 이 같은 판정을 2026-08-11(502호 이름 정정 재서명)에 이미 채택했다.
    if (!isCurrentSignatureLink(k, k.leaseTerm)) { skippedStale++; continue }

    // 축 G5 — 표시값 오버라이드가 서명본과 다르다.
    //   오버라이드 **키가 있는 것만** 본다. 원천 컬럼(임대료 등)이 서명 뒤에 바뀐 것은
    //   드리프트 경고(checkContractShareDrift)가 맡는 다른 사안이고, 이 축은 '표시값 편집'만 본다.
    //   Json null 은 Prisma 필터로 가르기 까다로워 여기서 파싱으로 거른다.
    const lt = k.leaseTerm
    const snapLease = (k.templateSnapshot as Snapshot | null)?.lease as Record<string, unknown> | null | undefined
    if (lt && snapLease) {
      const ov = parseContractFieldOverrides(lt.contractFieldOverrides) as Record<string, unknown>
      const ovKeys = Object.keys(ov)
      if (ovKeys.length) {
        fieldChecked++
        const merged = contractLeaseFields(lt) as unknown as Record<string, unknown>
        for (const key of ovKeys) {
          // **스냅샷 쪽 값이 undefined 인 축은 비교를 생략한다.** 그 축이 생기기 전에 만들어진
          // 스냅샷은 키가 아예 없어서, 없는 값을 '달라졌다'로 읽으면 바뀐 적 없는 계약에 위반이 뜬다
          // (성명 표기 축 2026-08-11). 드리프트 비교(checkContractShareDrift)가 쓰는 규칙과 같다.
          if (snapLease[key] === undefined) continue
          if (merged[key] !== snapLease[key]) {
            violations.push(`${k.tenant?.name ?? '?'} 의 계약서 ${FIELD_LABEL[key] ?? key} 표시값이 서명본과 다르다 — 서명 후 표시값 편집이 일어났다`)
          }
        }
      }
    }

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

  }

  // ── 축 G6 — 서명은 지워졌는데 서명본 링크가 열린 채 남았다 ──────────
  // 링크의 signedAt 은 '그때 서명이 들어왔다'는 과거 사실이라 서명을 지워도 영원히 남는다.
  // 진입로 셋(계약서 파일 칸·입실자 모달·발급 대기)이 그것만 보고 ?share= 서명본 화면으로 보냈고,
  // 그 화면은 signedAt 을 계약일로 삼아 본문을 잠갔다. 결과는 **깨끗한 계약의 영구 잠김**이다
  // (502호 실측 2026-08-10 — lease 서명 4칸 null, 스냅샷 null, 오버라이드 null 인데 화면이 안 열렸다).
  //
  // 세 조건이 함께 있어야 위반이다.
  //   signedAt 있음      = 이 링크는 서명본 화면으로 열릴 자격을 주장한다
  //   lease 서명 4칸 전부 빔 = 그런데 발급할 서명이 하나도 없다
  //   closedAt null      = 그 주장이 아직 살아 있다(닫힌 링크는 어느 화면도 안 고른다)
  // 서명 증거(signedAt·templateSnapshot)를 지워 해소하면 안 된다. 해소는 closedAt 을 세우거나
  // 재서명을 받는 것 둘 중 하나다.
  const orphanLinks = await prisma.contractShareLink.findMany({
    where: {
      signedAt: { not: null },
      closedAt: null,
      leaseTerm: {
        signatureImageUrl: null, signatureSignedAt: null,
        disposalSignatureImageUrl: null, disposalSignatureSignedAt: null,
      },
    },
    orderBy: { signedAt: 'desc' },
    select: {
      id: true, signedAt: true,
      tenant: { select: { name: true } },
      leaseTerm: { select: { room: { select: { roomNo: true } } } },
    },
  })
  for (const k of orphanLinks) {
    const ymd = k.signedAt ? k.signedAt.toISOString().slice(0, 10) : '?'
    console.log(`  [G6 현황] ${k.leaseTerm?.room?.roomNo ?? '?'} ${k.tenant?.name ?? '?'} · ${ymd} 서명 수신 · 서명 지워짐 · 링크 열림 (linkId ${k.id})`)
  }
  const g6Over = orphanLinks.length - G6_BASELINE
  if (g6Over > 0) {
    violations.push(`서명이 지워졌는데 열린 채 남은 서명본 링크가 ${orphanLinks.length}건 — 기준선 ${G6_BASELINE} 초과 ${g6Over}건. 부분 서명 삭제가 제출완료·만료 링크까지 닫는지 확인하라`)
  }

  await prisma.$disconnect()

  console.log(`[본문 잠금·격리] 서명 계약 ${leases.filter(l => !!l.signedContractSnapshot).length}건 격리됨 · 서명본 ${checked}건 대조 · 표시값 오버라이드 ${fieldChecked}건 대조 · 지금 서명과 무관해 건너뛴 링크 ${skippedStale}건 · 폐기 기록 ${voidedVersions}건 · 서명 지워진 열린 링크 ${orphanLinks.length}건(기준선 ${G6_BASELINE}) / 위반 ${violations.length}건`)
  if (g6Over < 0) {
    console.log(`  [G6] 실측이 기준선보다 ${-g6Over}건 적다 — scripts/check-contract-override-lock.ts 의 G6_BASELINE 을 ${orphanLinks.length} 로 내려라.`)
  }
  if (violations.length) {
    console.error(`\n[본문 잠금] 위반 ${violations.length}건`)
    for (const v of violations) console.error('  - ' + v)
    console.error('\n  서명이 완료된 계약서는 본문도 표시값도 고칠 수 없다. 내용을 바꾸려면 재서명을 받는다.')
    process.exit(1)
  }
}

main()
