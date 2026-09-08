// 약관규제법상 무효 소지 계약서 문안 3건을 DB 저장본에서 교체 — 기본은 예행(전후 출력), --apply 일 때만 쓴다.
//
// 왜 있나(법률 패널 2026-09-09). 코드 기본값(lib/contract)만 고치면 종이가 안 바뀐다.
// 영업장이 환경설정에서 자기 문안을 저장해 두면 **저장본이 코드 기본값을 이긴다** — 실제로
// 제기역점은 서약문이 코드 기본값과 문자까지 같은 별도 저장본을 갖고 있었다.
//
// 무엇을 고치나.
//   (1) Property.contractTemplate.oathText — 항변권 배제 서약문.
//   (2) Property.contractTemplate.sections[].items[] — 1절 4항 법적 절차 "모든 비용".
//   (3) Property.disposalConsentTemplate.body — 고소권 사전 포기·민사 청구 포기 2문장.
//   (+) LeaseTerm.contractOverride — 입실자별 본문 사본. 같은 클래스라 같이 지난다
//       (2026-09-09 실측 0건이라 지금은 무동작이지만, 케이스가 아니라 클래스를 고친다).
//
// 무엇을 안 고치나. **박제는 손대지 않는다.** ContractShareLink 의 서명본 스냅샷과
// ContractFile 의 발급본 스냅샷은 "그 사람이 그때 서명한 종이"라 지금 문안으로 덮으면
// 서명 증거가 사라지고 드리프트 감지가 통째로 거짓말을 한다(knowledge/domain-contracts.md).
// 이미 서명된 계약서는 그대로 남는 것이 맞다.
//
// 번역본(Property.contractTranslations)도 손대지 않는다. 사전의 열쇠가 한국어 문장 자체라
// 원문이 바뀌면 그 줄 번역이 저절로 고아가 되고 번역본에는 한국어가 그대로 남는다 —
// 설계된 동작이다. 고아를 지우면 본문을 되돌려도 되살아나지 않는다.
//
// 실행:
//   예행  npx tsx --env-file=.env.local scripts/fix-unfair-contract-clauses.ts
//   적용  npx tsx --env-file=.env.local scripts/fix-unfair-contract-clauses.ts --apply
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const APPLY = process.argv.includes('--apply')

// ── 확정 문안 (법률 패널 2026-09-09, 글자 그대로) ──────────────────────────
const OLD_OATH = '상기 규칙을 숙지하였으며 위반 시 어떠한 조치에도 이의를 제기하지 않을 것에 대해 서약합니다.'
const NEW_OATH = '위 계약 내용과 생활 수칙을 모두 읽고 이해하였으며, 위반 시 본 계약서에 정한 바에 따라 계약 해지 등의 조치가 있을 수 있음을 확인하고 서명합니다.'

// 항목 번호와 탭(`\t4.\t`)·앞뒤 문장·괄호는 그대로 두고 가운데 한 문장만 간다.
// 번호를 통째로 다시 쓰면 조항 번호가 밀린다.
const OLD_COST = '퇴실 불응 및 연락 두절 시에는 법적 절차에 따라 처리되며, 이 과정에서 발생하는 모든 비용은 입실자가 부담합니다.'
const NEW_COST = '퇴실 불응 및 연락 두절 시에는 법적 절차에 따라 처리되며, 이 과정에서 발생하는 소송·집행 비용은 법령이 정한 범위에서 입실자가 부담합니다.'

const OLD_DISPOSAL_WAIVER = '처분 및 폐기하는 것에 일체 동의하며, 추후 이와 관련하여 민사상 손해배상 청구나 형사상 고소(절도, 주거침입, 재물손괴 등) 등 어떠한 이의도 제기하지 않을 것을 서약합니다.'
const NEW_DISPOSAL_WAIVER = '처분 및 폐기하는 것에 동의하며, 위 동의 범위 안에서 이루어진 개방·반출·보관·처분은 본인의 승낙에 따른 것임을 확인합니다.'

// 설명의무 이행 증거라 줄 자체는 살린다. 끝맺음만 간다.
const OLD_DISPOSAL_TAIL = '자유로운 의사에 따라 본 서약에 동의합니다.'
const NEW_DISPOSAL_TAIL = '자유로운 의사에 따라 이에 동의합니다.'

// 줄바꿈이 영업장마다 다르다(코드 기본값은 \n, 제기역점 저장본은 \r\n). 줄 안의 문장만
// 치환하므로 줄바꿈 종류를 건드리지 않는다 — 정규화하면 전 줄이 바뀐 것으로 기록된다.
const SENTENCE_SWAPS: [string, string][] = [
  [OLD_COST, NEW_COST],
  [OLD_DISPOSAL_WAIVER, NEW_DISPOSAL_WAIVER],
  [OLD_DISPOSAL_TAIL, NEW_DISPOSAL_TAIL],
]

function swapSentences(text: string): string {
  let out = text
  for (const [from, to] of SENTENCE_SWAPS) out = out.split(from).join(to)
  return out
}

type Change = { where: string; before: string; after: string }

// 계약서 템플릿 JSON 한 벌을 고친다. 모양이 다르면 건드리지 않고 그대로 돌려준다.
function fixTemplate(raw: unknown, label: string, changes: Change[]): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const t = raw as Record<string, unknown>
  const next: Record<string, unknown> = { ...t }

  if (typeof t.oathText === 'string' && t.oathText === OLD_OATH) {
    changes.push({ where: `${label}.oathText`, before: t.oathText, after: NEW_OATH })
    next.oathText = NEW_OATH
  } else if (typeof t.oathText === 'string' && t.oathText.includes('어떠한 조치에도 이의를 제기하지')) {
    // 변형본이다. 자동 치환하면 영업장이 손댄 문장을 조용히 덮으므로 사람이 본다.
    changes.push({ where: `${label}.oathText [수동 확인 필요 — 확정 옛 문안과 다름]`, before: t.oathText, after: '(자동 치환 안 함)' })
  }

  if (Array.isArray(t.sections)) {
    next.sections = t.sections.map((s: unknown, i: number) => {
      if (!s || typeof s !== 'object') return s
      const sec = s as Record<string, unknown>
      if (!Array.isArray(sec.items)) return s
      const items = sec.items.map((it: unknown, j: number) => {
        if (typeof it !== 'string') return it
        const after = swapSentences(it)
        if (after !== it) changes.push({ where: `${label}.sections[${i}].items[${j}]`, before: it, after })
        return after
      })
      return { ...sec, items }
    })
  }
  return next
}

function fixDisposal(raw: unknown, label: string, changes: Change[]): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const d = raw as Record<string, unknown>
  if (typeof d.body !== 'string') return raw
  const after = swapSentences(d.body)
  if (after === d.body) return raw
  changes.push({ where: `${label}.body`, before: d.body, after })
  return { ...d, body: after }
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

async function main() {
  console.log(APPLY ? '[적용] DB 를 실제로 씁니다.' : '[예행] 아무것도 쓰지 않습니다. 적용은 --apply.')

  let touchedRows = 0
  let totalChanges = 0

  const props = await prisma.property.findMany({
    select: { id: true, name: true, contractTemplate: true, disposalConsentTemplate: true },
  })

  for (const p of props) {
    const changes: Change[] = []
    const nextTemplate = fixTemplate(p.contractTemplate, '계약서', changes)
    const nextDisposal = fixDisposal(p.disposalConsentTemplate, '동의서', changes)

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
    const writable = changes.filter(c => !c.where.includes('수동 확인 필요'))
    if (!writable.length) { console.log('  자동 치환 대상 없음 — 위 항목은 사람이 봅니다.'); continue }
    touchedRows += 1
    if (APPLY) {
      await prisma.property.update({
        where: { id: p.id },
        data: {
          contractTemplate: nextTemplate as never,
          disposalConsentTemplate: nextDisposal as never,
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
    if (!changes.some(c => c.where.includes('수동 확인 필요'))) {
      touchedRows += 1
      if (APPLY) {
        await prisma.leaseTerm.update({ where: { id: l.id }, data: { contractOverride: next as never } })
        console.log('    적용 완료.')
      }
    }
  }

  console.log(`\n합계 — 바뀔 문장 ${totalChanges}개, 쓸 행 ${touchedRows}개.`)
  if (!APPLY) console.log('예행이라 DB 는 그대로입니다. 적용하려면 --apply 를 붙여 다시 실행하세요.')
  console.log('바뀐 한국어 줄의 번역은 고아가 됩니다(설계된 동작). 환경설정 > 계약서 번역에서 다시 채우세요.')
}

main()
  .catch(e => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
