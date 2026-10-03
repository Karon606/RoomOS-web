// 고정지출 귀속월 정본(lib/expenseTargetMonth) 회귀 + 회차 판정 배선 그물 — 실행: npx tsx scripts/test-expense-target-month.ts
//
// 고정하는 것(2026-10-01 운영자 승인 1안, 가스요금 9월분 10/1 납부 · 2026-10-03 2안 지출 결산 전체).
//   · 귀속월 = targetMonth ?? date 의 달, 같은 달이면 NULL 로 접어 저장
//   · where 조각(targetMonthWhere)이 메모리 판정(inTargetMonthRange)과 같은 뜻이다(무작위 다수)
//   · 같은 항목·같은 귀속월 중복 판정, 같은 회차 2건은 금액 합산·id 최신
//   · 배지 중립 'N월분'(전 유형), 같은 달 무배지
//   · 소스: recurringStatus·finance actions·기록 모달·재무 목록이 date 월을 직접 쓰지 않고 정본을 지난다
//   · 2안 소스: 결산 소비처(재무 목록·카테고리·예비비 후보·홈·추이·보고서)의 지출 조회가 귀속월 조각을 쓴다,
//     폼 귀속월 칸·addExpense/updateExpense 전파, 카드 정산 메타 칩
//   · 3단계 소스(2026-10-03): 지출 엑셀 월 필터·월 시트·월 옵션·'귀속월' 열이 정본을 지난다(날짜 범위·전체 워크북은
//     '// 현금일 축:' 표지), 영수증 승인 경로 귀속월 전파, 일괄 수정 귀속월 행별 접기·고정지출 제외·적용취소 스냅샷
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
eq('표기 — 기준 달과 해가 같으면 연도 생략', targetMonthLabel('2026-09', '2026-10'), '9월분')
eq('표기 — 해가 갈리면 연도', [targetMonthLabel('2025-12', '2026-01'), targetMonthLabel('2027-01', '2026-12-31')], ['2025년 12월분', '2027년 1월분'])

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
  // 2안(2026-10-03): 칸이 실려 오면 그 값, 안 실려 오면 보존(form-clear-vs-absent), 분할 행에도 전파.
  const upd = fnBody(s, /export async function updateExpense[\s\S]*?\n\}\n/)
  must(`${f} — updateExpense 가 귀속월 칸 부재를 보존으로 읽는다(formData.has)`, /formData\.has\('targetMonth'\)/.test(upd) && /targetMonthForSave\(/.test(upd))
  must(`${f} — updateExpense 가 첫 행·분할 행·배송비·단일 저장에 귀속월을 싣는다(4곳)`, (upd.match(/^\s*targetMonth,/gm) ?? []).length >= 4)
  must(`${f} — updateExpense 의 고정지출 중복 가드가 기록 가드와 같은 식`, /targetMonthWhere\(slot\)/.test(upd) && /이미 기록돼 있습니다/.test(upd))
  must(`${f} — updateExpense 가 기준 달 파생을 유지한다`, (upd.match(/resyncRecurringAnchor\(/g) ?? []).length >= 2)
  const add = fnBody(s, /export async function addExpense[\s\S]*?\n\}\n/)
  must(`${f} — addExpense 가 귀속월을 접어 저장한다(baseRow·배송비)`, /targetMonthForSave\(/.test(add) && (add.match(/^\s*targetMonth,/gm) ?? []).length >= 2)
}
{
  const f = 'app/(app)/finance/RecurringExpenseRecordModal.tsx'
  const s = read(f)
  must(`${f} — 귀속월을 저장에 넘긴다`, /keepCycle:\s*keep,\s*\n\s*targetMonth,/.test(s))
  must(`${f} — 주기 물음이 귀속월로 묻는다`, /const month = targetMonth\b/.test(s) && !/const month = date\.slice\(0,\s*7\)/.test(s))
  must(`${f} — 귀속월 옵션 표기가 정본(targetMonthLabel, 해가 같으면 'N월분')`, /targetMonthLabel\(m, baseMonth\)/.test(s))
}
{
  const f = 'app/(app)/finance/FinanceClient.tsx'
  const s = read(f)
  // 배지는 정본 메타 칩 하나(components/ui/TargetMonthChip)를 카드 정산과 공유한다(웹디자이너 패스 2026-10-03).
  must(`${f} — 목록 배지가 공유 메타 칩(TargetMonthChip)이고 수제 배지가 없다`, (s.match(/<TargetMonthChip e=\{e\} \/>/g) ?? []).length >= 2 && !/function TargetMonthBadge/.test(s))
  // 조회 달 밖 날짜 묶음은 머리가 ' · 9월분'을 말하므로 그 행 배지는 생략한다(같은 말 두 번 금지).
  must(`${f} — 조회 달 밖 날짜 머리는 합계 대신 귀속월, 그 묶음 행 배지는 생략`,
    (s.match(/\{item\.dateStr\.slice\(0, 7\) === targetMonth && <TargetMonthChip e=\{e\} \/>\}/g) ?? []).length === 2
    && (s.match(/outsideMonthHead\(/g) ?? []).length >= 3 && /!otherDay && /.test(s) && /!outsideMonthHead\(item\.dateStr\) && /.test(s))
  // 폼 귀속월 칸 — 등록·수정 두 폼, 수정은 저장값으로 연다. 날짜 행(반폭 grid) 밖 전폭 한 행.
  // 정본 행은 components/ui/ExpenseTargetMonthField(영수증 승인 카드와 공유, 3단계). FinanceClient 는 가져다 쓴다.
  const FIELD = 'components/ui/ExpenseTargetMonthField.tsx'
  const field = fnBody(read(FIELD), /export function ExpenseTargetMonthField[\s\S]*?\n\}\n/)
  must(`${f} — 귀속월 행을 정본(${FIELD})에서 가져오고 사본을 두지 않는다`, /from '@\/components\/ui\/ExpenseTargetMonthField'/.test(s) && !/function ExpenseTargetMonthField/.test(s))
  must(`${FIELD} — 폼 귀속월 칸이 name="targetMonth" 로 실린다(접힘 hidden·펼침 select)`, (field.match(/name="targetMonth"/g) ?? []).length >= 2 && /targetMonthLabel\(m, dateMonth\)/.test(field))
  must(`${FIELD} — 귀속월 칸 손잡이가 같은 달에도 선다('귀속월 바꾸기')·버튼이 폼 dirty 를 세운다`, /'귀속월 바꾸기'/.test(field) && /onDirty\?\.\(\)/.test(field))
  must(`${FIELD} — form 없는 화면에 고른 값을 넘긴다(onPick)`, /onPick\?\.\(m\)/.test(field))
  const uses = [...s.matchAll(/<ExpenseTargetMonthField [^\n]*\/>/g)]
  must(`${f} — 귀속월 칸이 등록·수정 두 폼에 선다(onDirty 배선)`, uses.length === 2 && uses.every(u => /onDirty=\{\(\) => set(AddExp|ExpEdit)Dirty\(true\)\}/.test(u[0])) && uses.some(u => /initial=\{detailExp\.targetMonth\}/.test(u[0])))
  for (const u of uses) {
    const before = s.slice(0, u.index!)
    const g = before.lastIndexOf('<div className="grid grid-cols-2')
    const seg = before.slice(g)
    const depth = (seg.match(/<div\b/g) ?? []).length - (seg.match(/<\/div>/g) ?? []).length
    must(`${f}:${before.split('\n').length} — 귀속월 칸이 반폭 grid 칸 안에 있다(320px 에서 접힌다). 날짜 행 아래 전폭으로`, g >= 0 && depth <= 0)
  }
  must(`${f} — 다른 달분 흔적 줄이 '낸' 어휘·카테고리 필터·숫자 강조로 선다`, /월에 낸 /.test(s) && /o\.category !== expFilter\.category/.test(s) && /fmtWon\(traceTotal\)/.test(s) && !/월 결제 · 다른 달분/.test(s))
  must(`${f} — 삭제 확인창이 '이번 달'이 아니라 귀속월로 말한다`, !/이번 달 (고정지출 )?기록/.test(s))
}
{
  const f = 'app/(app)/dashboard/DashboardClient.tsx'
  const s = read(f)
  must(`${f} — 홈 알림 기록이 예정일·회차 달을 넘긴다`, /defaultDate=\{recordingRec\.dueDate\}/.test(s) && /dueMonth=\{recordingRec\.dueMonth\}/.test(s))
  // 미래 예정일을 넘기면 모달이 열 때마다 '오늘 날짜로 바꿀까요?'를 묻는다 — 지났거나 오늘일 때만.
  must(`${f} — 홈 알림이 미래 예정일을 날짜로 넘기지 않는다`, /due && due <= kstYmdStr\(\) \? due : undefined/.test(s))
}
// ── 2안(2026-10-03): 지출 결산 소비처는 귀속월 축 ───────────────────────
// 소비처마다 prisma.expense.(findMany|aggregate|groupBy) 인자 블록을 괄호 깊이로 잘라(문자열·주석은 건너뜀)
// 본다. 달 창(date: monthDbRange 류)이 남아 있으면 위반, 현금일 축 예외는 바로 위 3줄 안의 `// 현금일 축:` 표지.
{
  /** idx 의 '(' 부터 짝 ')' 까지 — 문자열·주석 안의 괄호는 세지 않는다. 반환은 주석을 걷은 코드. */
  function callBlock(raw: string, open: number): string | null {
    let depth = 0, out = ''
    for (let i = open; i < raw.length; i++) {
      const c = raw[i], n = raw[i + 1]
      if (c === '/' && n === '/') { const e = raw.indexOf('\n', i); i = e < 0 ? raw.length : e - 1; continue }
      if (c === '/' && n === '*') { const e = raw.indexOf('*/', i + 2); i = e < 0 ? raw.length : e + 1; continue }
      if (c === "'" || c === '"' || c === '`') {
        let j = i + 1
        while (j < raw.length && raw[j] !== c) { if (raw[j] === '\\') j++; j++ }
        out += raw.slice(i, j + 1); i = j; continue
      }
      out += c
      if (c === '(') depth++
      else if (c === ')') { depth--; if (depth === 0) return out }
    }
    return null
  }
  const CALL = /prisma\.expense\.(findMany|aggregate|groupBy)\(/g
  const WINDOW = /\bdate:\s*(monthDbRange|monthsDbRange|yearDbRange|dayDbRange|monthWindow|trendWindow|yearWindow|yearBackWindow|last3Window|window|monthFilter)\b/
  type Blk = { at: number; line: number; code: string; cash: boolean }
  function blocks(f: string, raw: string): Blk[] {
    const out: Blk[] = []
    for (const m of raw.matchAll(CALL)) {
      const at = m.index!
      const code = callBlock(raw, at + m[0].length - 1)
      const line = raw.slice(0, at).split('\n').length
      if (code == null) { src.push(`${f}:${line} — 지출 조회 인자 블록을 못 찾았다(괄호 불일치).`); continue }
      const above = raw.slice(0, at).split('\n').slice(-4).join('\n')
      out.push({ at, line, code, cash: /\/\/ 현금일 축:/.test(above) })
    }
    return out
  }
  const FILES = [
    'app/(app)/finance/actions.ts',
    'app/(app)/dashboard/getDashboardData.ts',
    'app/(app)/dashboard/actions.ts',
    'app/(app)/report/actions.ts',
  ]
  const byFile = new Map<string, { raw: string; bl: Blk[] }>()
  for (const f of FILES) {
    const raw = read(f)
    const bl = blocks(f, raw)
    byFile.set(f, { raw, bl })
    for (const b of bl) {
      if (b.cash) continue
      must(`${f}:${b.line} — 지출 조회가 date 달 창을 쓴다. targetMonthWhere(..) 를 쓰거나, 정말 현금일 축이면 바로 위에 '// 현금일 축:' 표지를 단다`, !WINDOW.test(b.code))
    }
    // 지출 월 키는 귀속월 정본으로 — date 의 달로 버킷을 만들면 9월분이 10월 막대에 선다.
    must(`${f} — 지출 월 키를 date 로 만들지 않는다(dbDateMonthKey(e.date)·yearOf(e.date))`, !/dbDateMonthKey\(e\.date\)|yearOf\(e\.date\)|inQ\(new Date\(e\.date\)\)/.test(raw))
  }
  /** 앵커 뒤 첫 지출 조회 블록 — 못 찾으면 위반. */
  function firstAfter(f: string, anchor: RegExp): Blk | null {
    const { raw, bl } = byFile.get(f)!
    const m = raw.match(anchor)
    if (!m || m.index == null) { src.push(`${f} — 앵커 ${anchor} 를 못 찾았다(이름이 바뀌었으면 그물도 고친다)`); return null }
    const b = bl.find(x => x.at > m.index!)
    if (!b) { src.push(`${f} — ${anchor} 뒤 지출 조회 블록을 못 찾았다`); return null }
    return b
  }
  {
    const f = 'app/(app)/finance/actions.ts'
    for (const fn of ['getExpenses', 'getExpenseCategoryTotals', 'getSettleableExpenses']) {
      const b = firstAfter(f, new RegExp(`export async function ${fn}\\(`))
      if (b) must(`${f} — ${fn} 가 귀속월 조각을 쓴다`, /targetMonthWhere\(/.test(b.code) && !b.cash)
    }
    const t = firstAfter(f, /export async function getOtherMonthPaidExpenses\(/)
    if (t) must(`${f} — 다른 달분 흔적 조회는 현금일 축 표지를 단다(결산 합계 아님)`, t.cash && /targetMonth:\s*\{\s*not:/.test(t.code))
  }
  {
    // 홈은 지출 조회 전부가 결산 축이다 — KPI·도넛(findMany·groupBy 한 쌍)·전월·전년·비고정 3개월·6개월 추이.
    // findMany 와 groupBy 가 갈리면 sum(categoryBreakdown) === expectedExpense 항등이 깨진다.
    const f = 'app/(app)/dashboard/getDashboardData.ts'
    const bl = byFile.get(f)!.bl
    must(`${f} — 지출 조회 6곳 이상이 전부 귀속월 조각(현재 ${bl.length})`, bl.length >= 6 && bl.every(b => /targetMonthWhere\(/.test(b.code)))
    must(`${f} — 추이 달 키가 귀속월 정본`, /expenseTargetMonth\(e\) === m/.test(byFile.get(f)!.raw))
  }
  {
    const f = 'app/(app)/dashboard/actions.ts'
    const bl = byFile.get(f)!.bl
    must(`${f} — 달 단위 막대 지출이 귀속월 조각`, bl.some(b => /targetMonthWhere\(/.test(b.code)))
    must(`${f} — 현금일 축 예외는 일간·주간 한 곳뿐`, bl.filter(b => b.cash).length <= 1)
  }
  {
    const f = 'app/(app)/report/actions.ts'
    const bl = byFile.get(f)!.bl
    must(`${f} — 연간·예측·12개월 추이 지출이 귀속월 조각(3곳)`, bl.filter(b => /targetMonthWhere\(/.test(b.code)).length >= 3)
    must(`${f} — 지출 달 키가 귀속월 정본`, (byFile.get(f)!.raw.match(/expenseTargetMonth\(e\)/g) ?? []).length >= 3)
  }
  {
    const f = 'app/(app)/card-settlement/CardSettlementClient.tsx'
    const s = read(f)
    must(`${f} — 품목 행 귀속월 칩이 공유 정본(components/ui/TargetMonthChip)`, /from '@\/components\/ui\/TargetMonthChip'/.test(s) && (s.match(/<TargetMonthChip e=\{item\} \/>/g) ?? []).length >= 2 && !/function TargetMonthChip/.test(s))
    const c = read('components/ui/TargetMonthChip.tsx')
    must(`components/ui/TargetMonthChip.tsx — §11 메타 칩 정본·판정은 targetMonthBadge·지연/선납 판정 없음·전 유형`,
      /targetMonthBadge\(e\)/.test(c) && /bg-\[var\(--canvas\)\][^"]*text-\[var\(--warm-muted\)\][^"]*ring-1 ring-\[var\(--warm-border\)\]/.test(c) && !/지연|선납|recurringExpenseId/.test(c.replace(/^\/\/.*$/gm, '')))
    must(`${f} — 청구월이 결제일 기준임을 안내한다`, /청구월은 결제일 기준입니다\./.test(s))
    must(`${f} — 청구월은 date 축 그대로(getBillMonth(item.date …))`, /getBillMonth\(/.test(s) && !/getBillMonth\([^)]*targetMonth/.test(s))
  }
}

// ── 3단계(2026-10-03): 엑셀·영수증 승인·일괄 수정 ──────────────────────
{
  // 일괄 수정의 귀속월은 행마다 그 행의 날짜로 접는다 — 같은 '9월분'도 9/30 행은 NULL, 10/1 행은 '2026-09'.
  const rows = [D('2026-09-30'), D('2026-10-01'), D('2026-08-31')]
  eq('일괄 귀속월 행별 접기', rows.map(d => targetMonthForSave('2026-09', d)), [null, '2026-09', '2026-09'])
  // 날짜도 같이 바꾸면 새 날짜로 접는다.
  eq('일괄 날짜+귀속월 — 새 날짜로 접기', targetMonthForSave('2026-09', D('2026-09-15')), null)
}
{
  const f = 'app/api/export/route.ts'
  const s = read(f)
  must(`${f} — 귀속월 정본을 가져온다`, /from '@\/lib\/expenseTargetMonth'/.test(s))
  must(`${f} — month 파라미터 필터가 귀속월 조각(targetMonthWhere(monthParam))`, /targetMonthWhere\(monthParam\)/.test(s) && !/monthDbRange\(monthParam\)/.test(s))
  must(`${f} — 월 시트 키가 귀속월 정본(date 의 달 키 없음)`, /const key = expenseTargetMonth\(e\)/.test(s) && !/expenseMonthKey|dbDateMonthKey/.test(s))
  must(`${f} — 지출 시트에 '귀속월' 열(정본)과 '날짜' 열이 함께 선다`, /'귀속월':\s*expenseTargetMonth\(e\)/.test(s) && /'날짜':\s*fmtDate\(e\.date\)/.test(s))
  // 날짜 창(date: …)을 거는 자리는 전부 현금일 축 표지를 단다 — from/to 날짜 범위, 전체 워크북.
  const lines = s.split('\n')
  lines.forEach((ln, i) => {
    if (!/\bdate:\s*(\{\s*gte:\s*ymdToDbDate|dateRange\b)/.test(ln)) return
    // 같은 조회 안의 다른 표(수납·기타수익·요청사항)는 지출이 아니다 — 지출 조회 또는 지출 기간 변수만 본다.
    const ctx = lines.slice(Math.max(0, i - 4), i + 1).join('\n')
    if (!/prisma\.expense\.findMany|expPeriodWhere/.test(ctx)) return
    must(`${f}:${i + 1} — 지출 날짜 창에 '// 현금일 축:' 표지가 없다(귀속월이면 targetMonthWhere 를 쓴다)`, /\/\/ 현금일 축:/.test(ctx))
  })
  const a = read('app/(app)/finance/actions.ts')
  const opt = fnBody(a, /export async function getExpenseExportOptions[\s\S]*?\n\}\n/)
  must(`app/(app)/finance/actions.ts — 엑셀 월 옵션이 귀속월 정본(expenseTargetMonth)`, /monthSet\.add\(expenseTargetMonth\(r\)\)/.test(opt) && /targetMonth: true/.test(opt) && !/getFullYear\(\)/.test(opt))
}
{
  const f = 'app/(app)/dashboard/pendingReceipt.ts'
  const s = read(f)
  const ap = fnBody(s, /export async function approvePendingReceipt[\s\S]*?\n\}\n/)
  must(`${f} — 영수증 승인이 귀속월을 받아 접어 저장한다`, /targetMonth\?: string/.test(ap) && /targetMonthForSave\(isMonthKey\(final\.targetMonth\)/.test(ap) && /^\s*targetMonth,/m.test(ap))
  const c = read('components/dashboard/PendingReceiptSection.tsx')
  must(`components/dashboard/PendingReceiptSection.tsx — 승인 카드가 정본 귀속월 행을 쓰고 값을 승인에 싣는다`,
    /from '@\/components\/ui\/ExpenseTargetMonthField'/.test(c) && /<ExpenseTargetMonthField date=\{date\} viewMonth=\{kstMonthStr\(\)\} onPick=\{setTargetMonth\} dense \/>/.test(c)
    && /targetMonth: targetMonth \?\? undefined/.test(c))
}
{
  const f = 'app/(app)/finance/actions.ts'
  const s = read(f)
  const b = fnBody(s, /export async function batchUpdateExpenses[\s\S]*?\n\}\n/)
  must(`${f} — 일괄 수정이 귀속월 형식을 검증한다`, /targetMonth\?: string/.test(b) && /isMonthKey\(data\.targetMonth\)/.test(b))
  must(`${f} — 일괄 수정 귀속월에서 고정지출 기록을 뺀다(같은 항목·같은 귀속월 가드 우회 금지)`, /\(changingDate \|\| changingTargetMonth\) && t\.recurringExpenseId/.test(b))
  must(`${f} — 일괄 수정 귀속월을 행별 날짜로 접는다`, /targetMonthForSave\(data\.targetMonth, changingDate \? new Date\(data\.date as string\) : t\.date\)/.test(b))
  must(`${f} — 일괄 수정 적용취소 스냅샷에 귀속월`, /if \(changingDate \|\| changingTargetMonth\) fields\.targetMonth = t\.targetMonth/.test(b))
  const c = read('app/(app)/finance/FinanceClient.tsx')
  const m = fnBody(c, /function BatchEditExpensesModal[\s\S]*?\n\}\n/)
  must(`app/(app)/finance/FinanceClient.tsx — 일괄 편집 귀속월 select('미변경' + 조회 달 ±1, N월분)·캡션·전송`,
    /shiftMonthKey\(viewMonth, n\)/.test(m) && /targetMonthLabel\(m, viewMonth\)/.test(m) && /날짜는 그대로, 어느 달 지출로 셀지만 바뀝니다\./.test(m) && /data\.targetMonth = tMonth/.test(m))
  must(`app/(app)/finance/FinanceClient.tsx — 일괄 편집 모달에 조회 달을 넘긴다`, /viewMonth=\{targetMonth\}/.test(c))
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
  console.error(`[지출 귀속월] 통과 ${pass} · 실패 ${fails.length + src.length}`)
  for (const f of fails) console.error(`  - ${f}`)
  for (const f of src) console.error(`  - 소스: ${f}`)
  process.exit(1)
}
console.log(`[지출 귀속월] 정본·조각 의미·중복 판정·합산·배지·결산 축·폼 전파·엑셀·영수증 승인·일괄 수정·소스 배선 통과 ${pass}`)
