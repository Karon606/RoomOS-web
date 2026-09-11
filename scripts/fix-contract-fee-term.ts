// 계약서 용어 통일 '입실료' → '이용료' 를 DB 저장본에 반영 — 기본은 예행, --apply 일 때만 쓴다.
//
// 왜 있나(운영자 결정 2026-09-11). 계약서 본문에 '입실료'와 '이용료'가 섞여 있어 한 장 안에서
// 같은 돈을 두 이름으로 불렀다. 코드 기본 문안(lib/contract)은 이미 '이용료'로 통일했는데,
// **영업장이 환경설정에서 자기 문안을 저장해 두면 저장본이 코드 기본값을 이긴다** — 제기역점이
// 그 경우라 코드만 고치면 종이가 안 바뀐다(불공정 조항 교체 2026-09-09 와 같은 자리).
//
// 무엇을 고치나. 문자열 안의 '입실료' 만 '이용료' 로 바꾼다.
//   (1) Property.contractTemplate — title · sections[].title · sections[].items[] · oathText
//   (2) Property.subLeaseAddendum · shortStayAddendum · earlyCheckoutAddendum · roomScheduleAddendum
//       (저장본이 있을 때만. 없으면 코드 기본값을 쓰므로 이미 '이용료'다)
//   (3) Property.disposalConsentTemplate.body
//   (+) LeaseTerm.contractOverride — 입실자별 본문 사본. 같은 클래스라 같이 지난다
//       (2026-09-11 실측 0건이라 지금은 무동작이지만, 케이스가 아니라 클래스를 고친다).
//
// **'입실일'·'입실자'·'입실 시'는 안 건드린다.** '입실료' 라는 네 글자만 바꾸므로 구조적으로
// 그렇게 된다 — 정규식을 넓히지 마라. '입실'을 통째로 바꾸면 날짜와 사람 호칭까지 뒤집힌다.
//
// 무엇을 안 고치나. **박제는 손대지 않는다.** ContractShareLink 의 서명본 스냅샷과 ContractFile
// 의 발급본 스냅샷은 "그 사람이 그때 서명한 종이"라 지금 문안으로 덮으면 서명 증거가 사라지고
// 드리프트 감지가 통째로 거짓말을 한다(knowledge/domain-contracts.md). LeaseTerm 의
// signedContractSnapshot · contractVersionArchive 도 같은 이유로 제외다.
//
// 번역본(Property.contractTranslations)도 손대지 않는다. 사전의 열쇠가 한국어 문장 자체라
// 원문이 바뀌면 그 줄 번역이 저절로 고아가 되고 번역본에는 한국어가 그대로 남는다 —
// 설계된 동작이다. 고아를 지우면 본문을 되돌려도 되살아나지 않는다.
//
// 실행:
//   예행  npx tsx --env-file=.env.local scripts/fix-contract-fee-term.ts
//   적용  npx tsx --env-file=.env.local scripts/fix-contract-fee-term.ts --apply
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const APPLY = process.argv.includes('--apply')

const OLD = '입실료'
const NEW = '이용료'

type Change = { where: string; before: string; after: string }

/** 문자열 하나. 바뀌는 것이 있을 때만 changes 에 남긴다. */
function fixStr(v: unknown, where: string, changes: Change[]): unknown {
  if (typeof v !== 'string' || !v.includes(OLD)) return v
  const after = v.split(OLD).join(NEW)
  changes.push({ where, before: v, after })
  return after
}

/** 계약서 본문 한 벌(Property.contractTemplate · LeaseTerm.contractOverride 가 같은 모양이다). */
function fixTemplate(raw: unknown, label: string, changes: Change[]): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const t = raw as { title?: unknown; sections?: unknown; oathText?: unknown }
  const sections = (Array.isArray(t.sections) ? t.sections : []).map((s, i) => {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return s
    const sec = s as { title?: unknown; items?: unknown }
    return {
      ...sec,
      title: fixStr(sec.title, `${label}.sections[${i}].title`, changes),
      items: (Array.isArray(sec.items) ? sec.items : []).map((x, j) =>
        fixStr(x, `${label}.sections[${i}].items[${j}]`, changes)),
    }
  })
  return {
    ...t,
    title: fixStr(t.title, `${label}.title`, changes),
    sections,
    oathText: fixStr(t.oathText, `${label}.oathText`, changes),
  }
}

/** 가변 절 한 벌(추가 호실 · 단기 · 조기 퇴실 · 거주 호실 일정). */
function fixAddendum(raw: unknown, label: string, changes: Change[]): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const a = raw as { title?: unknown; items?: unknown }
  return {
    ...a,
    title: fixStr(a.title, `${label}.title`, changes),
    items: (Array.isArray(a.items) ? a.items : []).map((x, i) => fixStr(x, `${label}.items[${i}]`, changes)),
  }
}

/** 잔여 소지품 임의처분 동의서. 본문 한 칸이다. */
function fixDisposal(raw: unknown, label: string, changes: Change[]): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const d = raw as { body?: unknown }
  return { ...d, body: fixStr(d.body, `${label}.body`, changes) }
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

async function main() {
  console.log(APPLY ? '[적용] DB 를 실제로 씁니다.' : '[예행] 아무것도 쓰지 않습니다. 적용은 --apply.')

  let touchedRows = 0
  let totalChanges = 0

  const props = await prisma.property.findMany({
    select: {
      id: true, name: true, contractTemplate: true, disposalConsentTemplate: true,
      subLeaseAddendum: true, shortStayAddendum: true, earlyCheckoutAddendum: true, roomScheduleAddendum: true,
    },
  })

  for (const p of props) {
    const changes: Change[] = []
    const next = {
      contractTemplate: fixTemplate(p.contractTemplate, '계약서', changes),
      disposalConsentTemplate: fixDisposal(p.disposalConsentTemplate, '동의서', changes),
      subLeaseAddendum: fixAddendum(p.subLeaseAddendum, '추가 호실 특약', changes),
      shortStayAddendum: fixAddendum(p.shortStayAddendum, '단기 입실 특약', changes),
      earlyCheckoutAddendum: fixAddendum(p.earlyCheckoutAddendum, '조기 퇴실 절', changes),
      roomScheduleAddendum: fixAddendum(p.roomScheduleAddendum, '거주 호실 일정 절', changes),
    }

    console.log(`\n=== 영업장 ${p.name} (${p.id})`)
    if (!changes.length) {
      console.log('  바꿀 것 없음 (이미 반영되었거나 저장본이 없습니다).')
      continue
    }
    for (const c of changes) {
      console.log(`  · ${c.where}`)
      console.log(`    전: ${JSON.stringify(c.before)}`)
      console.log(`    후: ${JSON.stringify(c.after)}`)
    }
    totalChanges += changes.length
    touchedRows += 1
    if (APPLY) {
      await prisma.property.update({
        where: { id: p.id },
        data: {
          contractTemplate: next.contractTemplate as never,
          disposalConsentTemplate: next.disposalConsentTemplate as never,
          subLeaseAddendum: next.subLeaseAddendum as never,
          shortStayAddendum: next.shortStayAddendum as never,
          earlyCheckoutAddendum: next.earlyCheckoutAddendum as never,
          roomScheduleAddendum: next.roomScheduleAddendum as never,
        },
      })
      console.log('  적용 완료.')
    }
  }

  // 입실자별 본문 사본 — 있으면 같은 문안을 지고 있으므로 같이 간다.
  const leases = await prisma.leaseTerm.findMany({
    where: { contractOverride: { not: null } },
    select: { id: true, contractOverride: true, tenant: { select: { name: true } }, room: { select: { roomNo: true } } },
  })
  console.log(`\n=== 입실자별 본문 사본(contractOverride) ${leases.length}건`)
  for (const l of leases) {
    const changes: Change[] = []
    const next = fixTemplate(l.contractOverride, '사본', changes)
    if (!changes.length) continue
    console.log(`  [${l.room?.roomNo ?? '-'} ${l.tenant?.name ?? '-'}] ${l.id}`)
    for (const c of changes) {
      console.log(`    · ${c.where}`)
      console.log(`      전: ${JSON.stringify(c.before)}`)
      console.log(`      후: ${JSON.stringify(c.after)}`)
    }
    totalChanges += changes.length
    touchedRows += 1
    if (APPLY) {
      await prisma.leaseTerm.update({ where: { id: l.id }, data: { contractOverride: next as never } })
      console.log('    적용 완료.')
    }
  }

  console.log(`\n합계 — 바뀔 문장 ${totalChanges}개, 쓸 행 ${touchedRows}개.`)
  if (!APPLY) console.log('예행이라 DB 는 그대로입니다. 적용하려면 --apply 를 붙여 다시 실행하세요.')
  console.log('바뀐 한국어 줄의 번역은 고아가 됩니다(설계된 동작). 환경설정 > 계약서 번역에서 다시 채우세요.')
  console.log('이미 서명·발급된 계약서의 박제는 건드리지 않았습니다 — 그 종이는 그대로입니다.')
}

main()
  .catch(e => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
