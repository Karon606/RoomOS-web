// 이용 기간 시작일(cycleDay) 배선 감지. 기간으로 읽어야 할 자리가 납부일(dueDay)을 다시 읽는지 글자로 본다. 실행: node scripts/check-cycle-day-wiring.mjs
//
// 왜 필요한가(운영자 승인 2026-10-21, 504호). 계약의 dueDay 한 칸이 기간 시작과 납부 기한 두 뜻을 졌다. '납부일만 옮김'
// 계약(기간 1일~말일, 납부일 6일)은 둘이 갈리고, 기간 자리가 하나라도 dueDay 를 읽으면 그 자리만 6일부터 기간을 잰다.
// 진리표(test-money·test-settlement-period)는 함수가 맞는지 보고, 여기는 호출부가 그 함수에 무엇을 넘기는지 본다.
//
// 잡는 것.
//   ① 정본 cycleDayOf 는 lib/dueDay 에 하나다. 청구 엔진 입력 칸 cycleDay 는 필수(옵셔널 금지, select 누락을 tsc 가 잡는다).
//   ② 정산 정본(lib/settlementPeriod)의 기간 시작이 cycleDayOf 를 읽는다. 정산 입력 칸 cycleDay 도 필수다.
//   ③ 정산 함수(calcCheckoutProration·shouldOfferCheckoutProration)에 계약의 dueDay 를 그대로 넘기는 호출이 없다.
//      settlementPeriodFor 에 넘기는 객체는 cycleDay 를 싣는다.
//   ④ 엔진의 첫 달 규칙·첫 달 기한·무청구 판정이 cycleDayOf 를 읽는다.
//   ⑤ 납부 확인서 기간(rentCyclePeriod)·인수월 양도인 판정(수납 관리·홈 미납 두 곳)이 cycleDayOf 를 읽는다.
//   ⑥ 납입일 변경 두 갈래. 서버가 갈래를 받고 납부일만 옮김은 앞당기기를 거절하며 조정 행을 안 만든다. 적용취소가 기간 칸을
//      서명과 함께 되돌린다. 폼·일괄 수정이 같은 판정을 쓴다. 위젯은 기본값 없는 §12 세그먼트이고 일할 옛 값이 cycleDayOf 다.
//   ⑧ 무청구 판정은 날짜 인자가 없다(경계 = 기간 시작, 임시 조정 무시). 호출부가 기한 날짜를 넘기는 사본이 다시 생기면 잡는다.
//   ⑨ 독립 검수 후속. 일괄 수정(판정 순서·전파·적용취소 서명), 딸린 계약 상속, 우회 경로(계약서 문·시트), 내보내기 인수월,
//      서버 일할 재계산, 수납 정보의 임시 조정 뺀 납부일, 위젯 예시 정본, 감사 due-before-cycle.
//   ⑦ 감사 규칙 11(기간 칸이 납부일과 같은 값으로 남음·거주 전 계약에 남음)이 판정 정본으로 적재된다.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const read = f => readFileSync(f, 'utf8')
const fails = []
const need = (name, cond) => { if (!cond) fails.push(name) }
// 주석은 안 본다. "읽는다"고 적힌 설명이 검사를 통과시키면 그물이 아니라 장식이다.
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
function body(src, header) {
  const start = src.indexOf(header)
  if (start < 0) return ''
  const end = src.indexOf('\n}\n', start + header.length)
  return src.slice(start, end < 0 ? src.length : end + 2)
}
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name) && !/ \d\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

// ── ① 정본과 필수 칸 ───────────────────────────────────────────────
const dueDayLib = strip(read('lib/dueDay.ts'))
need('① lib/dueDay 에 cycleDayOf 정본(cycleDay ?? dueDay)', /export function cycleDayOf\(l: \{ cycleDay: string \| null; dueDay: string \| null \}\): string \| null \{\s*return l\.cycleDay \?\? l\.dueDay/.test(dueDayLib))
const billing = strip(read('lib/billing.ts'))
const fields = body(billing, 'export type BillingLeaseFields = {')
need('① BillingLeaseFields.cycleDay 는 필수 칸(옵셔널 금지)', /\n\s*cycleDay: string \| null\n/.test(fields) && !/cycleDay\?:/.test(fields))
const sources = [...walk('app'), ...walk('lib'), ...walk('components')]
for (const f of sources) {
  if (f === 'lib/dueDay.ts') continue
  if (/export function cycleDayOf\b/.test(read(f))) fails.push(`① cycleDayOf 사본: ${f}`)
}

// ── ② 정산 정본 ────────────────────────────────────────────────────
const sp = strip(read('lib/settlementPeriod.ts'))
need('② 정산 기간 시작이 cycleDayOf 를 읽는다', /function periodStartYmd[\s\S]*?const raw = cycleDayOf\(/.test(sp))
need('② SettlementLease.cycleDay 는 필수 칸', /export type SettlementLease = \{[^}]*\n\s*cycleDay: string \| null\n/.test(sp))

// ── ③ 정산 함수 호출부 ─────────────────────────────────────────────
for (const f of sources) {
  const src = strip(read(f))
  for (const m of src.matchAll(/(calcCheckoutProration|shouldOfferCheckoutProration)\(\s*[^,]+,\s*([^,]+),/g)) {
    if (f === 'lib/prorate.ts' && m[2].trim() === 'cycleDay') continue
    if (/\.dueDay\b|^dueDay$/.test(m[2].trim())) fails.push(`③ ${f}: ${m[1]} 에 납부일(${m[2].trim()})을 넘긴다. cycleDayOf(계약)를 넘겨야 한다`)
  }
  for (const m of src.matchAll(/settlementPeriodFor\(\s*\{([^}]*)\}/g)) {
    if (!/cycleDay/.test(m[1])) fails.push(`③ ${f}: settlementPeriodFor 입력에 cycleDay 가 없다 { ${m[1].trim()} }`)
  }
}

// ── ④ 엔진 ─────────────────────────────────────────────────────────
need('④ 첫 달 규칙이 cycleDayOf 로 잰다', /export function firstMonthRule\([\s\S]*?const cycle = cycleDayOf\(l\)[\s\S]*?sameDueDay\(memos\[memos\.length - 1\]!\.to, cycle\)/.test(body(billing, 'export function firstMonthRule(')))
need('④ 첫 달 기한이 기간 시작일·분리 계약을 본다', /const cycle = cycleDayOf\(l\)[\s\S]*?hasSplitCycle\(l\)/.test(body(billing, 'export function firstMonthDueYmd(')))
need('④ 무청구 판정의 첫 달 예외가 cycleDayOf 로 잰다', /const cycle = cycleDayOf\(l\)[\s\S]*?firstMonthGap\(l\.moveInDate, cycle\)/.test(body(billing, 'export function isCheckoutNoBillingMonthFor(')))

// ── ⑤ 납부 확인서 기간·인수월 판정 ──────────────────────────────────
const receipt = strip(read('app/rent-receipt/[tenantId]/actions.ts'))
need('⑤ 납부 확인서 기간이 cycleDayOf 를 넘긴다', /rentCyclePeriod\(lease \? cycleDayOf\(lease\) : null,/.test(receipt))
for (const f of ['app/(app)/dashboard/unpaid.ts', 'app/(app)/dashboard/getDashboardData.ts']) {
  need(`⑤ ${f} 인수월 판정(getOriginalDueDay)이 cycleDayOf 를 읽는다`, /function getOriginalDueDay\([^)]*cycleDay: string \| null[^)]*\)[\s\S]*?const cycle = cycleDayOf\(l\)/.test(strip(read(f))))
}
const rooms = strip(read('app/(app)/rooms/actions.ts'))
need('⑤ 수납 관리 인수월 판정(buildLeaseRow)이 cycleDayOf 를 넘긴다', /originalDueDayOf\(cycleDayOf\(\{ cycleDay: lease\.cycleDay \?\? null, dueDay: lease\.dueDay \?\? null \}\), allLeaseRecords\)/.test(rooms))
need('⑤ 조정 칩 인수월 판정도 cycleDayOf 를 넘긴다', /originalDueDayOf\(cycleDayOf\(lease\), allLeaseRecords\)/.test(rooms))
need('⑤ 인수월 판정 정본(lib/roomMonth originalDueDayOf)의 첫 인자는 기간 시작일', /export function originalDueDayOf\(cycleDay: string \| null,/.test(strip(read('lib/roomMonth.ts'))))
for (const m of rooms.matchAll(/originalDueDayOf\(([^,]+),/g)) if (/^lease\.dueDay$/.test(m[1].trim())) fails.push('⑤ rooms/actions: originalDueDayOf 에 납부일을 넘긴다')
need('⑤ 미수월 탐색(findFirstUnpaidMonth)의 인수월 판정이 cycleDayOf 를 읽는다', /const baseCycle = cycleDayOf\(lease\)\s*let baseDueDayNum = baseCycle/.test(rooms))

// ── ⑥ 납입일 변경 두 갈래(위젯·서버) ───────────────────────────────
const tenants = strip(read('app/(app)/tenants/actions.ts'))
const change = body(tenants, 'export async function changeDueDay(')
need('⑥ changeDueDay 가 갈래를 받고 납부일만 옮김을 따로 처리한다', /mode: DueDayChangeMode = 'cycle'/.test(change) && /if \(mode === 'dueOnly'\) return await changeDueDayOnly\(/.test(change))
need('⑥ 기간도 옮김의 조정 행 메모 바꾸기 전 = 이용 기간 시작일', /planDueDayAdjustCreate\(\{ fromDue: curCycle,/.test(change))
need('⑥ 기간도 옮김은 기간 칸을 비우고 딸린 계약에도 전파한다', /data: \{ dueDay: nextDue, cycleDay: null, \.\.\.pr\.data \}/.test(change) && /propagateDueDayToSubLeases\(prisma, leaseTermId, lease\.dueDay, nextDue, \{ prev: lease\.cycleDay \?\? null, next: null \}\)/.test(change))
const only = body(tenants, 'async function changeDueDayOnly(')
need('⑥ 납부일만 옮김은 앞당기기를 서버에서 거절한다', /!dueDayAfterCycle\(curCycle, nextDue\)\) return \{ ok: false, error: dueOnlyEarlierRefused\(curCycle\) \}/.test(only))
need('⑥ 납부일만 옮김은 조정 행을 만들지 않는다', !/paymentRecord\.create/.test(only) && /adjustAmount !== 0/.test(only))
need('⑥ 납부일만 옮김의 적용취소 스냅샷에 바꾸기 전 기간 칸·서명', /prevCycleDay: lease\.cycleDay \?\? null/.test(only) && /signUndoBody\(DUE_DAY_CHANGE_UNDO_DOMAIN/.test(only))
need('⑥ 적용취소가 기간 칸을 되돌리고 서명에 넣는다', /cycleDay: u\.prevCycleDay/.test(body(tenants, 'export async function undoChangeDueDay(')) && /prevCycleDay: u\.prevCycleDay/.test(body(tenants, 'function canonicalDueDayChangeUndo(')))
need('⑥ 폼 수정이 기간 칸을 같은 판정으로 정한다', /cycleDayAfterDueChange\(currentLease\.cycleDay, nextDueDay\)/.test(tenants) && /cycleDay: nextCycleDay,/.test(tenants))
need('⑥ 일괄 수정도 같은 판정', /cycleDayAfterDueChange\(b\.cycleDay, nextDue\)/.test(tenants))
const widget = strip(read('components/entity-modal/widgets/DueDayPermanentChangeWidget.tsx'))
need('⑥ 위젯: 기본값 없는 세그먼트(role=radio, 36px), 필터용 SegmentedControl 아님', /useState<DueDayChangeMode \| null>\(null\)/.test(widget) && /role="radio"/.test(widget) && /h-9/.test(widget) && !/SegmentedControl/.test(widget))
need('⑥ 위젯: 고르기 전 변경 적용 꺼짐', /const canApply = mode === 'cycle'[\s\S]*?: mode === 'dueOnly' &&/.test(widget) && /disabled=\{pending \|\| !canApply\}/.test(widget))
need('⑥ 위젯: 기간도 옮김 일할의 옛 값이 cycleDayOf', /calcProRata\(expected, cycle, trimmed, targetMonth\)/.test(widget) && /const cycle = cycleDayOf\(\{ cycleDay, dueDay: currentDueDay \}\)/.test(widget))
need('⑥ 위젯: 납부일만 옮김에서 협의 금액 칸이 없다(일할 상자가 있을 때만)', /\{calc && calc\.type !== 'none' && \(\s*<div className="space-y-1">\s*<p className="text-xs text-\[var\(--warm-muted\)\]">협의 금액/.test(widget))
const pb = strip(read('components/entity-modal/bodies/PaymentBody.tsx'))
need('⑥ 수납 정보가 위젯에 기간 칸을 넘기고 헤더에 이용 기간을 적는다', /cycleDay=\{settlement\.cycleDay\}/.test(pb) && /이용 기간 \$\{cyclePeriodLabel\(settlement\.cycleDay\)\}/.test(pb))
need('⑥ 계약 정보에 이용 기간 표기', /이용 기간 (\$\{|<span className="whitespace-nowrap">\{)cyclePeriodLabel\(lease\.cycleDay \?\? null\)\}/.test(strip(read('components/entity-modal/widgets/TenantContractInfo.tsx'))))

// ── ⑦ 감사 규칙 11 ─────────────────────────────────────────────────
const audit = strip(read('lib/integrityAudit.ts'))
need('⑦ 감사가 기간 칸 판정 정본(cycleDayViolation)으로 규칙 11 을 적재한다', /const why = cycleDayViolation\(l\)/.test(audit) && /signature: `\[정합\] cycle-day-\$\{why\}/.test(audit))

// ── ⑧ 무청구 판정 경계는 기간 시작(임시 조정 무시) ─────────────────────
const nb = body(billing, 'export function isCheckoutNoBillingMonthFor(')
need('⑧ 무청구 판정이 날짜 인자 없이 기간 시작일로 경계를 푼다', /mon: string,\n\): boolean \{/.test(nb) && /isCheckoutNoBillingMonth\(expectedMoveOut, mon, resolveDueDateForMonth\(cycle, mon\)\)/.test(nb))
for (const f of sources) {
  if (f === 'lib/billing.ts') continue
  const src = strip(read(f))
  // 괄호를 세어 최상위 인자 수를 본다. 셋을 넘으면 넷째 자리에 날짜(기한)를 다시 넘기는 것이다(이름이 무엇이든).
  const NAME = 'isCheckoutNoBillingMonthFor('
  for (let at = src.indexOf(NAME); at >= 0; at = src.indexOf(NAME, at + NAME.length)) {
    if (/function\s+$/.test(src.slice(Math.max(0, at - 20), at))) continue
    let depth = 0, args = 1, i = at + NAME.length - 1
    for (; i < src.length; i++) {
      const ch = src[i]
      if (ch === '(' || ch === '{' || ch === '[') depth++
      else if (ch === ')' || ch === '}' || ch === ']') { depth--; if (depth === 0) break }
      else if (ch === ',' && depth === 1) args++
    }
    if (/,\s*\)$/.test(src.slice(at, i + 1))) args--   // 끝 쉼표
    if (args !== 3) fails.push(`⑧ ${f}: 무청구 판정에 인자 ${args}개(경계는 계약에서 스스로 푼다, 날짜를 넘기지 않는다)`)
  }
}

// ── ⑨ 독립 검수 후속(2026-10-21) ─────────────────────────────────────
{
  const batch = body(tenants, 'export async function batchUpdateTenants(')
  const iCycle = batch.indexOf('cycleDayAfterDueChange(b.cycleDay, nextDue)'), iTenantWrite = batch.indexOf('prisma.tenant.updateMany(')
  need('⑨ 일괄 수정: 기간 칸 판정(거절)이 입주자 칸 저장보다 앞', iCycle > 0 && iTenantWrite > 0 && iCycle < iTenantWrite)
  need('⑨ 일괄 수정: 딸린 계약 전파에 기간 칸을 넘기고 되돌리기에 prevCycleDay', /propagateDueDayToSubLeases\(prisma, b\.id, b\.dueDay, nextDue,\s*b\.cycleDay \? \{ prev: b\.cycleDay, next: nextCycle \} : undefined\)/.test(batch) && /cycleDay: m\.prevCycleDay/.test(batch))
  need('⑨ 일괄 수정 적용취소: 서명 검증과 허용 칸 목록', /signUndoBody\(BATCH_TENANTS_UNDO_DOMAIN/.test(batch) && /verifyUndoBody\(BATCH_TENANTS_UNDO_DOMAIN/.test(body(tenants, 'export async function undoBatchUpdateTenants(')) && /BATCH_UNDO_LEASE_FIELDS = new Set\(\['depositAmount', 'dueDay', 'cycleDay', 'status', 'moveInFlexible', 'expectedMoveOut', 'autoCheckoutAt'\]\)/.test(tenants))
  need('⑨ 딸린 계약 신규 생성이 부모 기간 칸을 물려받는다', /const cycleDay = await inheritedCycleDay\(prisma, f\.data\.parentLeaseTermId, f\.data\.dueDay\)/.test(tenants) && /data: \{ \.\.\.f\.data, cycleDay, propertyId, tenantId \}/.test(tenants))
  need('⑨ 입주자 수정(부모 붙이기 포함)도 부모 기간 칸을 물려받는다', /\(await inheritedCycleDay\(prisma, parentForCycle, nextDueDay\)\) \?\? cycleNext\.cycleDay/.test(tenants))
  need('⑨ 계약서 문 납부일이 같은 판정', /cycleDayAfterDueChange\(lease\.cycleDay \?\? null, v\)/.test(strip(read('app/(app)/tenants/contractShare.ts'))))
  const imp = strip(read('app/api/import/route.ts'))
  need('⑨ 시트 가져오기가 같은 판정·전파에 기간 칸', /cycleDayAfterDueChange\(activeLease\.cycleDay \?\? null, nextDueDay\)/.test(imp) && /propagateDueDayToSubLeases\(prisma, activeLease\.id, activeLease\.dueDay, nextDueDay,\s*activeLease\.cycleDay \|\| cycleNext\.cycleDay/.test(imp))
  need('⑨ 내보내기 인수월 판정이 cycleDayOf(임시 조정 무시)', /const cycleForCutoff = cycleDayOf\(l\)/.test(strip(read('app/api/export/route.ts'))))
  need('⑨ 기간도 옮김 일할을 서버가 DB 값으로 다시 잰다(화면 값은 비교용)', /const serverCalc = calcProRata\(viewExpectedForMonth\(lease, targetMonth\), curCycle, nextDue, targetMonth\)/.test(change) && /planDueDayAdjustCreate\(\{ fromDue: curCycle, toDue: newDueDay, adjustAmount: serverAdjust,/.test(change))
  need('⑨ 수납 정보가 위젯에 임시 조정을 뺀 납부일(baseDueDay)을 넘긴다', /currentDueDay=\{settlement\.baseDueDay\}/.test(pb))
  need('⑨ 퇴실 정산 위젯 안내가 기간 시작일(cycleDayOf, 임시 조정 무시)', /currentDueDay=\{cycleDayOf\(\{ cycleDay: settlement\.cycleDay, dueDay: settlement\.baseDueDay \}\)\}/.test(pb))
  need('⑨ 위젯 예시가 정본 일할(cycleShiftExample)', /cycleShiftExample\(expected, cycle, targetMonth\)/.test(widget) && /export function cycleShiftExample\(/.test(strip(read('lib/prorate.ts'))))
  need('⑨ 감사 규칙 11 에 due-before-cycle 축', /if \(!dueDayAfterCycle\(lease\.cycleDay, lease\.dueDay\)\) return 'due-before-cycle'/.test(audit))
}

if (fails.length) {
  console.error(`[기간 시작일 배선] 위반 ${fails.length}건`)
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
console.log('[기간 시작일 배선] 위반 0건')
