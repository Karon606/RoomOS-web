// 제기역점 계약서 저장본 2절(퇴실 및 환불) 맨 끝에 '통보 지연 배상' 항목을 붙이는 일회성 정정 — 예행 기본, --apply 적용, --revert <undo.json> 되돌림.
//
// 왜 (법률 패널·운영자 확정 2026-10-05). 2절 2항이 "7일 전까지 문자로 알리지 않으면 1개월 자동 연장"
// 인데 어겨도 불이익이 없어 운영자 말로 "의미가 없다". 운영자는 '보증금 반환불가'를 원했으나
// 전액 몰취는 약관규제법 8조 무효 소지이고 2절 1항이 공정위 기준을 약정하고 있어 자기모순이다.
// 채택안은 부족한 통보 일수 × (월 이용료 / 30), 상한 7일분, 보증금 우선 공제, 중도 퇴실 위약금과
// 겹치면 큰 쪽만이다. 소급은 없다 — 새로 서명하는 계약부터다.
//
// 무엇을 하나. Property.contractTemplate 의 2절 items **맨 끝에 한 줄을 더한다.** 그뿐이다.
// 무엇을 안 하나.
//   · 기존 줄은 한 글자도 안 바꾼다. 번역 사전의 열쇠가 한국어 줄 자체라 한 글자만 고쳐도 그 줄
//     번역이 7개 언어에서 고아가 되고 종이에 한국어가 남는다(knowledge/domain-contracts.md
//     '번역은 고아가 된다'). 끝에 붙이면 기존 열쇠와 번호가 그대로라 고아가 0 이다.
//   · 박제(LeaseTerm.signedContractSnapshot · ContractShareLink.templateSnapshot ·
//     ContractFile.issuedSnapshot)는 손대지 않는다. 그때 서명한 종이다.
//   · 번역 사전(Property.contractTranslations)도 손대지 않는다. 새 줄의 번역은 운영자가 설정 >
//     계약서 > 참고용 번역본에서 채운다(초안은 저장소 밖 파일).
//   · 입실자별 본문 사본(contractOverride)은 안 고친다. 그 계약만 따로 정한 본문이라 새 조항을
//     얹는 것은 운영자 판단이다. 건수만 알린다.
//   · 다른 영업장 저장본은 안 고친다. 승인 범위가 제기역점이다. 새 영업장의 출발점인 코드 기본
//     양식(lib/contract 의 DEFAULT_CONTRACT_TEMPLATE)에는 같은 문장이 이미 있다.
//
// 실행:
//   예행    npx tsx --env-file=.env.local scripts/fix-checkout-notice-penalty.ts
//   적용    npx tsx --env-file=.env.local scripts/fix-checkout-notice-penalty.ts --apply
//   되돌림  npx tsx --env-file=.env.local scripts/fix-checkout-notice-penalty.ts --revert scripts/.fix-checkout-notice-penalty-undo-<ts>.json
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { translationSourceLines, translationStaleAfterEdit, orphanTranslationKeys, TRANSLATION_LANGS } from '../lib/contractTranslation'
import { propertyContractAddenda, stripClauseBullet, type ContractTemplate } from '../lib/contract'
import { parseShortStayPolicy } from '../lib/shortStay'

const APPLY = process.argv.includes('--apply')
const REVERT_IDX = process.argv.indexOf('--revert')

const TARGET_PROPERTY_ID = 'c74fd998-23cb-4c3c-8e56-9df32ecbcdcf'   // 더스테이원룸텔 제기역점

// ── 확정 문안 (법률 패널·운영자 2026-10-05, 글자 그대로) ──────────────────────
// 라벨은 같은 저장본의 다른 라벨([중도 퇴실 정산]·[연장 간주]·[원상 복구]) 문체를 따른다.
const LABEL = '[통보 지연 배상]'
const SENTENCE = '7일 전까지 알리지 않은 경우, 부족한 통보 일수만큼의 이용료(1일 이용요금은 월 이용료의 30분의 1)를 공실 손해의 배상으로 청구하며 보증금에서 우선 공제합니다. 이 금액은 7일분을 넘지 않으며, 중도 퇴실 위약금과 겹치면 둘 중 큰 금액만 적용합니다.'
// 같은 클래스의 변형(문장을 조금 고쳐 이미 넣은 경우)도 사람이 보게 멈춘다.
const VARIANT_MARKS = ['부족한 통보 일수', '공실 손해의 배상', '통보 지연 배상']

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

/** 키 순서와 무관한 직렬화. jsonb 는 키 순서를 자기 식으로 바꿔 돌려주므로 비교는 이것으로 한다. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as Record<string, unknown>).sort()
      .map(k => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(v ?? null)
}
const digest = (rows: unknown[]): string => createHash('sha256').update(stable(rows)).digest('hex').slice(0, 16)

type Section = { id?: unknown; title?: unknown; items?: unknown }

/** 2절을 찾는다 — id 'checkout' 이 정본이고, 없으면 제목으로. 둘 이상이거나 없으면 null. */
function findCheckoutIndex(t: ContractTemplate): number | null {
  const secs = (Array.isArray(t.sections) ? t.sections : []) as Section[]
  const byId = secs.map((s, i) => (s?.id === 'checkout' ? i : -1)).filter(i => i >= 0)
  if (byId.length === 1) return byId[0]
  if (byId.length > 1) return null
  const byTitle = secs.map((s, i) => (typeof s?.title === 'string' && s.title.includes('퇴실 및 환불') ? i : -1)).filter(i => i >= 0)
  return byTitle.length === 1 ? byTitle[0] : null
}

/** 2절 전문 — 저장 문자열 그대로(탭이 보이게 JSON)와 종이 번호(CSS counter 와 같은 순번)를 함께. */
function printSection(title: string, items: string[]): void {
  console.log(`  [${title}]`)
  items.forEach((it, i) => {
    console.log(`    저장 ${String(i).padStart(2)}: ${JSON.stringify(it)}`)
    console.log(`    종이 ${String(i + 1).padStart(2)}. ${stripClauseBullet(it)}`)
  })
}

// ── 불가침 점검 ─────────────────────────────────────────────────────────────
// 적용 전후에 같은 값을 잰다. 이 정정이 건드려도 되는 것은 대상 영업장의 contractTemplate 하나뿐이다.
type Guard = {
  signedSnapshots: string; signedSnapshotCount: number
  linkSnapshots: string; linkCount: number
  issuedSnapshots: string; issuedCount: number
  translations: string
  otherTemplates: string
  openUnsigned: number; openAny: number
}

async function measureGuard(): Promise<Guard> {
  const now = new Date()
  const leases = await prisma.leaseTerm.findMany({ orderBy: { id: 'asc' }, select: { id: true, signedContractSnapshot: true } })
  const signed = leases.filter(l => l.signedContractSnapshot != null)
  const links = await prisma.contractShareLink.findMany({ orderBy: { id: 'asc' }, select: { id: true, templateSnapshot: true } })
  const files = await prisma.contractFile.findMany({ orderBy: { id: 'asc' }, select: { id: true, issuedSnapshot: true } })
  const props = await prisma.property.findMany({ orderBy: { id: 'asc' }, select: { id: true, contractTranslations: true, contractTemplate: true } })
  // 미서명 열린 링크 — closeStaleUnsignedLinks(app/contract/[tenantId]/actions.ts)와 같은 다섯 조건.
  const openUnsigned = await prisma.contractShareLink.count({
    where: { signedAt: null, disposalSignedAt: null, submittedAt: null, closedAt: null, expiresAt: { gt: now } },
  })
  const openAny = await prisma.contractShareLink.count({ where: { submittedAt: null, closedAt: null, expiresAt: { gt: now } } })
  return {
    signedSnapshots: digest(signed.map(l => [l.id, l.signedContractSnapshot])), signedSnapshotCount: signed.length,
    linkSnapshots: digest(links.map(l => [l.id, l.templateSnapshot])), linkCount: links.length,
    issuedSnapshots: digest(files.map(f => [f.id, f.issuedSnapshot])), issuedCount: files.length,
    translations: digest(props.map(p => [p.id, p.contractTranslations])),
    otherTemplates: digest(props.filter(p => p.id !== TARGET_PROPERTY_ID).map(p => [p.id, p.contractTemplate])),
    openUnsigned, openAny,
  }
}

function printGuard(g: Guard): void {
  console.log(`  서명 박제(LeaseTerm.signedContractSnapshot) ${g.signedSnapshotCount}건 · 지문 ${g.signedSnapshots}`)
  console.log(`  링크 스냅샷(ContractShareLink.templateSnapshot) ${g.linkCount}건 · 지문 ${g.linkSnapshots}`)
  console.log(`  발급본 박제(ContractFile.issuedSnapshot) ${g.issuedCount}건 · 지문 ${g.issuedSnapshots}`)
  console.log(`  번역 사전(Property.contractTranslations) 지문 ${g.translations}`)
  console.log(`  다른 영업장 계약서 저장본 지문 ${g.otherTemplates}`)
  console.log(`  열린 링크 — 미서명 ${g.openUnsigned}건 · 제출 전 전체 ${g.openAny}건`)
}

function compareGuard(before: Guard, after: Guard): string[] {
  const diffs: string[] = []
  for (const k of Object.keys(before) as (keyof Guard)[]) {
    if (before[k] !== after[k]) diffs.push(`${k}: ${before[k]} -> ${after[k]}`)
  }
  return diffs
}

// ── 번역 영향 ────────────────────────────────────────────────────────────────
// 편집기와 같은 입력으로 센다(scripts/check-contract-dict-terms.ts 와 같은 조립).
type PropRow = {
  contractTranslations: unknown; refundClauseInContract: boolean | null; shortStayPolicy: unknown
  subLeaseAddendum: unknown; shortStayAddendum: unknown; earlyCheckoutAddendum: unknown; roomScheduleAddendum: unknown
}
function translationImpact(p: PropRow, before: ContractTemplate, after: ContractTemplate, newItem: string): void {
  const addenda = propertyContractAddenda(p, parseShortStayPolicy(p.shortStayPolicy).enabled)
  const refund = p.refundClauseInContract ?? true
  const linesBefore = translationSourceLines(before, addenda, refund, 'property')
  const linesAfter = translationSourceLines(after, addenda, refund, 'property')
  const stale = translationStaleAfterEdit(p.contractTranslations, before, after, addenda, refund, 'property')
  const orphanDelta = TRANSLATION_LANGS.map(lang => {
    const b = orphanTranslationKeys(p.contractTranslations, before, lang, addenda, refund, 'property').length
    const a = orphanTranslationKeys(p.contractTranslations, after, lang, addenda, refund, 'property').length
    return `${lang} ${b}->${a}`
  })
  const at = linesAfter.findIndex(l => l.text === newItem)
  console.log(`  번역 대상 줄 ${linesBefore.length} -> ${linesAfter.length} (새 줄은 '한국어 전문 복사' 의 ${at + 1}번째 줄)`)
  console.log(`  원문으로 돌아가는 기존 번역 — ${stale.lines}줄 · ${stale.langs}개 언어 (0 이어야 한다)`)
  console.log(`  고아 번역(언어별 전->후) — ${orphanDelta.join(' · ')}`)
  console.log('  새 줄은 7개 언어 모두 번역이 비어 있어 공개 언어의 번역본에 한국어로 실린다. 서명 링크를 보내기 전에 채운다.')
}

async function revert(file: string): Promise<void> {
  const undo = JSON.parse(fs.readFileSync(file, 'utf8')) as { propertyId: string; before: unknown; after: unknown }
  const cur = await prisma.property.findUnique({ where: { id: undo.propertyId }, select: { contractTemplate: true } })
  if (!cur) throw new Error('대상 영업장이 없다')
  if (stable(cur.contractTemplate) !== stable(undo.after)) {
    throw new Error('지금 저장본이 적용 직후와 다르다(그 사이 설정 화면에서 고쳤다). 덮어쓰지 않고 멈춘다 — 사람이 본다.')
  }
  const g0 = await measureGuard()
  await prisma.property.update({ where: { id: undo.propertyId }, data: { contractTemplate: undo.before as never } })
  const g1 = await measureGuard()
  const back = await prisma.property.findUnique({ where: { id: undo.propertyId }, select: { contractTemplate: true } })
  console.log(`되돌림 완료 — 저장본이 적용 전과 ${stable(back?.contractTemplate) === stable(undo.before) ? '같다' : '다르다(확인 필요)'}.`)
  const diffs = compareGuard(g0, g1)
  console.log(diffs.length ? `불가침 점검 실패 — ${diffs.join(' · ')}` : '불가침 점검 — 박제·링크·발급본·번역 사전·다른 영업장·열린 링크 건수 모두 그대로.')
  if (diffs.length) process.exitCode = 1
}

async function main(): Promise<void> {
  if (REVERT_IDX > 0) {
    const file = process.argv[REVERT_IDX + 1]
    if (!file) throw new Error('--revert 다음에 되돌리기 파일 경로를 적는다')
    await revert(file)
    return
  }

  console.log(APPLY ? '[적용] DB 를 실제로 씁니다.' : '[예행] 아무것도 쓰지 않습니다. 적용은 --apply.')

  const p = await prisma.property.findUnique({
    where: { id: TARGET_PROPERTY_ID },
    select: {
      id: true, name: true, contractTemplate: true, contractTranslations: true, refundClauseInContract: true,
      shortStayPolicy: true, subLeaseAddendum: true, shortStayAddendum: true, earlyCheckoutAddendum: true, roomScheduleAddendum: true,
    },
  })
  if (!p) throw new Error('대상 영업장이 없다')
  if (!p.name.includes('제기역점')) throw new Error(`대상 영업장 이름이 예상과 다르다: ${p.name}`)
  if (!p.contractTemplate) throw new Error('이 영업장은 저장본이 없다(코드 기본 양식을 쓴다) — 코드 기본 양식에 이미 같은 문장이 있으니 할 일이 없다.')

  const before = p.contractTemplate as unknown as ContractTemplate
  const idx = findCheckoutIndex(before)
  if (idx == null) throw new Error("2절('퇴실 및 환불')을 하나로 특정하지 못했다 — 사람이 본다.")
  const sec = before.sections[idx]
  const items = Array.isArray(sec.items) ? sec.items : []

  console.log(`\n=== 영업장 ${p.name} (${p.id})`)
  console.log(`  대상 절: sections[${idx}] id=${JSON.stringify(sec.id)} title=${JSON.stringify(sec.title)} · 항목 ${items.length}개`)

  // 이미 있으면 멈춘다 — 절 어디에 있든, 다른 절에 있든.
  const allItems = before.sections.flatMap(s => (Array.isArray(s.items) ? s.items : []))
  if (allItems.some(it => typeof it === 'string' && it.includes(SENTENCE))) {
    console.log('  이미 그 문장이 있다. 할 일이 없어 멈춘다.')
    return
  }
  const variant = allItems.find(it => typeof it === 'string' && VARIANT_MARKS.some(m => it.includes(m)))
  if (variant) {
    console.log(`  같은 취지의 변형 문장이 이미 있다 — 자동으로 더하지 않고 멈춘다(사람이 본다).\n    ${JSON.stringify(variant)}`)
    return
  }

  // 번호 = 종이 순번. 종이는 번호를 CSS counter 로 자리에서 매기고 본문 손 번호는 stripClauseBullet 이
  // 걷는다. 이 절은 '{{청소비조항}}' 줄이 손 번호 없이 4번째 자리를 차지하므로, 마지막 손 번호(3)+1 이
  // 아니라 자리 순번(항목 수 + 1)이 종이 번호와 같다. 문체는 같은 절의 '\tN.\t' 를 따른다.
  const numbered = items.filter(it => /^\t\d+\.\t/.test(it))
  if (numbered.length === 0) throw new Error("이 절은 '\\tN.\\t' 손 번호 문체가 아니다 — 사람이 본다.")
  const lastHand = Math.max(...numbered.map(it => Number(/^\t(\d+)\./.exec(it)?.[1] ?? 0)))
  const n = items.length + 1
  if (n <= lastHand) throw new Error(`번호 계산이 어긋났다(자리 ${n}, 마지막 손 번호 ${lastHand}) — 사람이 본다.`)
  const newItem = `\t${n}.\t${LABEL} ${SENTENCE}`
  console.log(`  번호 근거 — 항목 ${items.length}개 중 손 번호 마지막은 ${lastHand}, 종이 순번으로 ${n}번을 붙인다.`)

  const after: ContractTemplate = {
    ...before,
    sections: before.sections.map((s, i) => (i === idx ? { ...s, items: [...items, newItem] } : s)),
  }

  console.log('\n--- 2절 변경 전')
  printSection(String(sec.title), items)
  console.log('\n--- 2절 변경 후')
  printSection(String(sec.title), [...items, newItem])

  // 다른 절·서약문·제목은 그대로인가(구조 자체로 보장되지만 숫자로 확인한다).
  const untouched = before.sections.every((s, i) => i === idx || stable(s) === stable(after.sections[i]))
    && stable({ ...before, sections: null }) === stable({ ...after, sections: null })
    && items.every((it, j) => (after.sections[idx].items[j] === it))
  console.log(`\n  기존 줄 불변 — ${untouched ? '다른 절·서약문·제목·2절 기존 항목 모두 글자 그대로' : '어긋남(멈춘다)'}`)
  if (!untouched) throw new Error('기존 줄이 바뀌었다 — 멈춘다')

  console.log('\n--- 번역 영향')
  translationImpact(p, before, after, newItem)

  const overrides = await prisma.leaseTerm.count({ where: { contractOverride: { not: null } } })
  console.log(`\n  입실자별 본문 사본(contractOverride) ${overrides}건 — 이 정정은 손대지 않는다.`)

  console.log('\n--- 불가침 점검(적용 전)')
  const g0 = await measureGuard()
  printGuard(g0)

  if (!APPLY) {
    console.log('\n예행이라 DB 는 그대로입니다. 적용하려면 --apply 를 붙여 다시 실행하세요.')
    return
  }

  // 미서명 열린 링크가 있으면 멈춘다. 그 링크는 옛 본문 스냅샷으로 서명받으므로, 적용 뒤에도 새 조항
  // 없는 계약이 하나 더 생긴다. 닫거나 서명받은 뒤 다시 돌린다(체크리스트 D).
  if (g0.openUnsigned > 0) throw new Error(`미서명 열린 링크 ${g0.openUnsigned}건 — 옛 본문으로 서명받는다. 닫거나 서명받은 뒤 다시 돌린다.`)

  // 읽은 뒤 그 사이 설정 화면에서 저장했으면 덮어쓰지 않는다.
  const fresh = await prisma.property.findUnique({ where: { id: p.id }, select: { contractTemplate: true } })
  if (stable(fresh?.contractTemplate) !== stable(before)) throw new Error('읽은 뒤 저장본이 바뀌었다 — 다시 돌린다.')

  const file = `scripts/.fix-checkout-notice-penalty-undo-${Date.now()}.json`
  fs.writeFileSync(file, JSON.stringify({ propertyId: p.id, propertyName: p.name, appliedAt: new Date().toISOString(), newItem, before, after }, null, 2))
  await prisma.property.update({ where: { id: p.id }, data: { contractTemplate: after as never } })

  const back = await prisma.property.findUnique({ where: { id: p.id }, select: { contractTemplate: true } })
  const g1 = await measureGuard()
  console.log('\n--- 불가침 점검(적용 후)')
  printGuard(g1)
  const diffs = compareGuard(g0, g1)
  const stored = stable(back?.contractTemplate) === stable(after)
  console.log(`\n  저장본 — ${stored ? '의도한 모양 그대로 저장됨' : '의도와 다르다(확인 필요)'}`)
  console.log(diffs.length
    ? `  불가침 점검 실패 — ${diffs.join(' · ')}`
    : '  불가침 점검 — 서명 박제·링크 스냅샷·발급본 박제·번역 사전·다른 영업장·열린 링크 건수 모두 그대로.')
  if (diffs.length || !stored) process.exitCode = 1
  console.log(`\n적용했다. 되돌리기: npx tsx --env-file=.env.local scripts/fix-checkout-notice-penalty.ts --revert ${file}`)
  console.log('다음 할 일: 설정 > 계약서 > 참고용 번역본에서 7개 언어의 새 줄을 채우고 저장한다.')
}

main()
  .catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
