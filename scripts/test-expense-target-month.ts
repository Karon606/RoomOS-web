// 고정지출 귀속월 정본(lib/expenseTargetMonth) 회귀 + 회차 판정 배선 그물 — 실행: npx tsx scripts/test-expense-target-month.ts
//
// 고정하는 것(2026-10-01 운영자 승인 1안, 가스요금 9월분 10/1 납부).
//   · 귀속월 = targetMonth ?? date 의 달, 같은 달이면 NULL 로 접어 저장
//   · where 조각(targetMonthWhere)이 메모리 판정(inTargetMonthRange)과 같은 뜻이다(무작위 다수)
//   · 같은 항목·같은 귀속월 중복 판정, 같은 회차 2건은 금액 합산·id 최신
//   · 배지 'N월분 지연/선납', 같은 달 무배지
//   · 소스: recurringStatus·finance actions·기록 모달·재무 목록이 date 월을 직접 쓰지 않고 정본을 지난다
import fs from 'node:fs'
import path from 'node:path'
import {
  expenseTargetMonth, targetMonthForSave, targetMonthWhere, inTargetMonthRange,
  foldRecordedByRecurring, targetMonthBadge, shiftMonthKey, targetMonthLabel, isMonthKey,
} from '../lib/expenseTargetMonth'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  const a = JSON.stringify(got), b = JSON.stringify(want)
  if (a === b) { pass++; return }
  fails.push(`${name}: 기대 ${b} / 실제 ${a}`)
}
const D = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`)   // @db.Date 저장 정본(UTC 자정)

// ── 정본 함수 ────────────────────────────────────────────────────
eq('null 이면 date 의 달', expenseTargetMonth({ targetMonth: null, date: D('2026-10-01') }), '2026-10')
eq('지정이 있으면 지정', expenseTargetMonth({ targetMonth: '2026-09', date: D('2026-10-01') }), '2026-09')
eq('말일 경계 — 9/30 은 9월', expenseTargetMonth({ targetMonth: null, date: D('2026-09-30') }), '2026-09')
eq('문자열 날짜', expenseTargetMonth({ targetMonth: null, date: '2026-09-30T00:00:00.000Z' }), '2026-09')
eq('저장 접기 — 같은 달은 NULL', targetMonthForSave('2026-10', D('2026-10-01')), null)
eq('저장 접기 — 다른 달은 유지', targetMonthForSave('2026-09', D('2026-10-01')), '2026-09')
eq('저장 접기 — 미지정은 NULL', targetMonthForSave(undefined, D('2026-10-01')), null)
eq('형식 검증', [isMonthKey('2026-09'), isMonthKey('2026-13'), isMonthKey('2026-9'), isMonthKey(null)], [true, false, false, false])
eq('달 이동 — 해 넘김', [shiftMonthKey('2026-01', -1), shiftMonthKey('2026-12', 1), shiftMonthKey('2026-10', 0)], ['2025-12', '2027-01', '2026-10'])
eq('표기', targetMonthLabel('2026-09'), '2026년 9월분')

// ── where 조각의 의미 ─────────────────────────────────────────────
// Prisma 가 하는 일을 손으로 흉내 내 조각을 평가한다 — 조각과 메모리 판정이 같은 답을 내야 한다.
type Row = { targetMonth: string | null; date: Date }
function evalWhere(row: Row, w: ReturnType<typeof targetMonthWhere>): boolean {
  return w.OR.some(c => {
    if ('date' in c) {
      const r = c.date as { gte: Date; lt: Date }
      return row.targetMonth === null && row.date >= r.gte && row.date < r.lt
    }
    const t = c.targetMonth as string | { gte: string; lte: string }
    if (row.targetMonth === null) return false
    return typeof t === 'string' ? row.targetMonth === t : row.targetMonth >= t.gte && row.targetMonth <= t.lte
  })
}
eq('조각 모양 — 한 달', targetMonthWhere('2026-09').OR[0], { targetMonth: '2026-09' })
eq('조각 모양 — 범위', targetMonthWhere('2026-07', '2026-09').OR[0], { targetMonth: { gte: '2026-07', lte: '2026-09' } })
{
  // 가스요금 사건: 9월분을 10/1 에 냈다. 9월 회차로 잡히고 10월 회차로는 안 잡힌다.
  const gas = { targetMonth: '2026-09', date: D('2026-10-01') }
  eq('9월분 10/1 납부 — 9월 조회에 잡힌다', evalWhere(gas, targetMonthWhere('2026-09')), true)
  eq('9월분 10/1 납부 — 10월 조회에 안 잡힌다', evalWhere(gas, targetMonthWhere('2026-10')), false)
  const legacy = { targetMonth: null, date: D('2026-10-01') }
  eq('지정 없는 10/1 기록은 10월', [evalWhere(legacy, targetMonthWhere('2026-09')), evalWhere(legacy, targetMonthWhere('2026-10'))], [false, true])
}
{
  let seed = 7
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  let mismatch = 0
  for (let i = 0; i < 3000; i++) {
    const base = 2025 * 12 + Math.floor(rnd() * 24)
    const mk = (idx: number) => `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
    const day = 1 + Math.floor(rnd() * 28)
    const row: Row = {
      targetMonth: rnd() < 0.5 ? null : mk(base + Math.floor(rnd() * 3) - 1),
      date: D(`${mk(base)}-${String(day).padStart(2, '0')}`),
    }
    const from = mk(base + Math.floor(rnd() * 5) - 2)
    const to = rnd() < 0.5 ? from : mk(Number(from.slice(0, 4)) * 12 + Number(from.slice(5)) - 1 + Math.floor(rnd() * 3))
    if (evalWhere(row, targetMonthWhere(from, to)) !== inTargetMonthRange(row, from, to)) mismatch++
  }
  eq('조각 대 메모리 판정 무작위 3000건 불일치', mismatch, 0)
}

// ── 중복 판정(기록 가드·삭제취소 가드가 쓰는 식) ──────────────────────
{
  const existing: Row[] = [{ targetMonth: '2026-09', date: D('2026-10-01') }]
  const dupFor = (slot: string, rows: Row[]) => rows.some(r => evalWhere(r, targetMonthWhere(slot)))
  eq('9월분이 있으면 9월분 거부', dupFor('2026-09', existing), true)
  eq('9월분이 있어도 10월분은 통과', dupFor('2026-10', existing), false)
  eq('9/30 지정 없는 기록도 9월분으로 거부', dupFor('2026-09', [{ targetMonth: null, date: D('2026-09-30') }]), true)
  // 새 기록의 회차는 저장할 값으로 계산한다 — 10/1 에 9월분을 고르면 9월 회차를 묻는다.
  const slot = expenseTargetMonth({ targetMonth: targetMonthForSave('2026-09', D('2026-10-01')), date: D('2026-10-01') })
  eq('새 기록의 회차', slot, '2026-09')
}

// ── 같은 회차 2건 접기 ────────────────────────────────────────────
{
  const at = (iso: string) => new Date(iso)
  const m = foldRecordedByRecurring([
    { id: 'a', recurringExpenseId: 'gas', amount: 30000, date: D('2026-09-30'), createdAt: at('2026-09-30T01:00:00Z') },
    { id: 'b', recurringExpenseId: 'gas', amount: 12000, date: D('2026-10-01'), createdAt: at('2026-10-01T01:00:00Z') },
    { id: 'c', recurringExpenseId: 'elec', amount: 50000, date: D('2026-09-25'), createdAt: at('2026-09-25T01:00:00Z') },
    { id: 'd', recurringExpenseId: 'elec', amount: 1000, date: D('2026-09-25'), createdAt: at('2026-09-25T02:00:00Z') },
  ])
  eq('합산', m.get('gas')?.amount, 42000)
  eq('id 는 date 최신', m.get('gas')?.id, 'b')
  eq('같은 날이면 createdAt 최신', m.get('elec')?.id, 'd')
  eq('건수', [m.get('gas')?.count, m.get('elec')?.count], [2, 2])
  // 순서가 바뀌어도 답이 같다 — Map.set 마지막 한 건 방식은 여기서 갈렸다.
  const r = foldRecordedByRecurring([
    { id: 'b', recurringExpenseId: 'gas', amount: 12000, date: D('2026-10-01'), createdAt: at('2026-10-01T01:00:00Z') },
    { id: 'a', recurringExpenseId: 'gas', amount: 30000, date: D('2026-09-30'), createdAt: at('2026-09-30T01:00:00Z') },
  ])
  eq('역순 입력도 같은 답', [r.get('gas')?.id, r.get('gas')?.amount], ['b', 42000])
}

// ── 배지 ────────────────────────────────────────────────────────
eq('뒤 달 납부는 중립 N월분', targetMonthBadge({ targetMonth: '2026-09', date: D('2026-10-01') }), '9월분')
eq('앞 달 납부도 중립 N월분', targetMonthBadge({ targetMonth: '2026-10', date: D('2026-09-28') }), '10월분')
eq('같은 달 무배지', targetMonthBadge({ targetMonth: null, date: D('2026-10-01') }), null)

// ── 소스 그물 ────────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, '..')
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8')
const src: string[] = []
function must(name: string, ok: boolean) { if (ok) pass++; else src.push(name) }
function fnBody(s: string, head: RegExp): string { const m = s.match(head); return m ? m[0] : '' }

{
  const f = 'app/(app)/finance/recurringStatus.ts'
  const s = read(f)
  must(`${f} — 회차·이력 조회가 targetMonthWhere 를 지난다(3곳)`, (s.match(/targetMonthWhere\(/g) ?? []).length >= 3)
  must(`${f} — 지출 조회에 date 달 창을 직접 쓰지 않는다`, !/date:\s*(monthDbRange|monthsDbRange|thisMonth|recentRange)\b/.test(s))
  must(`${f} — 이력 달 키를 date 로 만들지 않는다`, !/dbDateMonthKey\(e\.date\)/.test(s))
  must(`${f} — 같은 회차 2건을 접는 정본(foldRecordedByRecurring)을 쓴다`, /foldRecordedByRecurring\(/.test(s) && !/new Map\(recordedThisMonth/.test(s))
}
{
  const f = 'app/(app)/finance/actions.ts'
  const s = read(f)
  const rec = fnBody(s, /export async function recordRecurringExpense[\s\S]*?\n\}\n/)
  must(`${f} — recordRecurringExpense 가 같은 회차를 거부한다`, /targetMonthWhere\(slot\)/.test(rec) && /이미 기록돼 있습니다/.test(rec))
  must(`${f} — recordRecurringExpense 가 귀속월을 저장한다`, /targetMonth:\s*storedTargetMonth/.test(rec) && /isMonthKey\(/.test(rec))
  const del = fnBody(s, /export async function deleteExpense[\s\S]*?\n\}\n/)
  must(`${f} — 삭제의 회차 되살림이 귀속월 정본을 지난다`, /expenseTargetMonth\(target\)/.test(del) && !/kstMonthOf\(target\.date\)/.test(del))
  const undo = fnBody(s, /export async function undoDeleteExpense[\s\S]*?\n\}\n/)
  must(`${f} — 삭제취소 가드가 기록 가드와 같은 식`, /targetMonthWhere\(slot\)/.test(undo) && !/Date\.UTC\(/.test(undo))
  const resync = fnBody(s, /async function resyncRecurringAnchor[\s\S]*?\n\}\n/)
  must(`${f} — 기준 달 파생이 귀속월 정본을 지난다`, /expenseTargetMonth\(/.test(resync) && !/kstMonthOf\(/.test(resync))
  const upd = fnBody(s, /export async function updateExpense[\s\S]*?\n\}\n/)
  must(`${f} — updateExpense 가 귀속월을 덮어쓰지 않는다`, !/\btargetMonth\s*:/.test(upd))
}
{
  const f = 'app/(app)/finance/RecurringExpenseRecordModal.tsx'
  const s = read(f)
  must(`${f} — 귀속월을 저장에 넘긴다`, /keepCycle:\s*keep,\s*\n\s*targetMonth,/.test(s))
  must(`${f} — 주기 물음이 귀속월로 묻는다`, /const month = targetMonth\b/.test(s) && !/const month = date\.slice\(0,\s*7\)/.test(s))
  must(`${f} — 귀속월 옵션 표기가 정본(targetMonthLabel)`, /targetMonthLabel\(m\)/.test(s))
}
{
  const f = 'app/(app)/finance/FinanceClient.tsx'
  const s = read(f)
  must(`${f} — 목록 배지가 정본(targetMonthBadge)`, /targetMonthBadge\(e\)/.test(s) && (s.match(/<TargetMonthBadge e=\{e\} \/>/g) ?? []).length >= 2)
  // 배지는 판정하지 않는다 — 말일 자동이체 주말 시프트로 제때 낸 회차도 다음 달 날짜다.
  const badge = fnBody(s, /function TargetMonthBadge[\s\S]*?\n\}\n/)
  must(`${f} — 귀속월 배지가 지연·선납을 판정하지 않는다(중립 톤)`, badge !== '' && !/지연|선납|warning-|info-/.test(badge) && /cream-2/.test(badge))
  must(`${f} — 삭제 확인창이 '이번 달'이 아니라 귀속월로 말한다`, !/이번 달 (고정지출 )?기록/.test(s))
}
{
  const f = 'app/(app)/dashboard/DashboardClient.tsx'
  const s = read(f)
  must(`${f} — 홈 알림 기록이 예정일·회차 달을 넘긴다`, /defaultDate=\{recordingRec\.dueDate\}/.test(s) && /dueMonth=\{recordingRec\.dueMonth\}/.test(s))
  // 미래 예정일을 넘기면 모달이 열 때마다 '오늘 날짜로 바꿀까요?'를 묻는다 — 지났거나 오늘일 때만.
  must(`${f} — 홈 알림이 미래 예정일을 날짜로 넘기지 않는다`, /due && due <= kstYmdStr\(\) \? due : undefined/.test(s))
}
// 정본 밖에서 '지정 ?? date 월'을 손으로 다시 쓰면 KST 하나만 틀려도 회차가 갈린다.
{
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of fs.readdirSync(path.join(ROOT, dir))) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const rel = path.join(dir, name)
      if (fs.statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, out)
      else if (/\.(ts|tsx)$/.test(name)) out.push(rel)
    }
    return out
  }
  for (const f of [...walk('app'), ...walk('lib'), ...walk('components')]) {
    if (f.replace(/\\/g, '/') === 'lib/expenseTargetMonth.ts') continue
    const s = read(f)
    // 고정지출 기록을 다루는 파일만 본다 — 발급 서류(RentReceiptFile)·수납의 targetMonth 는 다른 칸이다.
    if (!/recurringExpenseId/.test(s)) continue
    if (/\.targetMonth\s*\?\?\s*(dbDateMonthKey|kstMonthOf|kstMonthKey)\(/.test(s)) src.push(`${f} — 귀속월 폴백을 손으로 쓴다. expenseTargetMonth 를 쓴다.`)
  }
}

if (fails.length > 0 || src.length > 0) {
  console.error(`[고정지출 귀속월] 통과 ${pass} · 실패 ${fails.length + src.length}`)
  for (const f of fails) console.error(`  - ${f}`)
  for (const f of src) console.error(`  - 소스: ${f}`)
  process.exit(1)
}
console.log(`[고정지출 귀속월] 정본·조각 의미·중복 판정·합산·배지·소스 배선 통과 ${pass}`)
