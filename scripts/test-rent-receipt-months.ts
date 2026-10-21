// 납부 확인서 달 축 진리표 — 고를 수 있는 달·발행일 기본값·묶음 요청 검사·최신 판정(귀속월)·적용취소 토큰·서류 시트 행.
// 실행: npx tsx scripts/test-rent-receipt-months.ts   (실패 시 exit 1)
//
// 신고 2026-10-19(납부영수증 여러 달) 승인 범위의 규칙을 고정한다. 실데이터 흐름은 test-rent-receipt-flow 가 본다.
import {
  issuableRentMonths, issueDateDefaults, issueDateBeforePaymentError, batchRequestError, latestByTargetMonth, monthLabel, monthLabelShort, autoFormFields,
  canonicalRentReceiptUndo, parseRentReceiptUndo, rentReceiptRowUnchanged, RENT_RECEIPT_BATCH_MAX,
  type RentPaymentRow, type RentReceiptIssueRow,
} from '../lib/rentReceiptMonths'
import { buildDocBundle, DOC_WRITE_MANY_LABEL, type DocBundleFile, type DocBundleLease } from '../lib/docBundle'

let pass = 0, fail = 0
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; return }
  fail++
  console.error(`FAIL ${name}\n  기대: ${w}\n  실제: ${g}`)
}
const D = (s: string) => new Date(`${s}T00:00:00.000Z`)
const row = (o: Partial<RentPaymentRow> & { targetMonth: string | null }): RentPaymentRow =>
  ({ actualAmount: 150000, isBillingAdjust: false, memo: null, payDate: D('2026-09-18'), ...o })

// ── ① 고를 수 있는 달 ───────────────────────────────────────────────
const T1: [string, RentPaymentRow[], [string, number, string][]][] = [
  ['빈 입력', [], []],
  ['한 건', [row({ targetMonth: '2026-09' })], [['2026-09', 150000, '2026-09-18']]],
  ['같은 달 둘 = 합 + 늦은 입금일', [row({ targetMonth: '2026-08', actualAmount: 50000, payDate: D('2026-08-25') }), row({ targetMonth: '2026-08', actualAmount: 100000, payDate: D('2026-09-18') })], [['2026-08', 150000, '2026-09-18']]],
  ['입력 순서가 뒤집혀도 늦은 입금일', [row({ targetMonth: '2026-08', payDate: D('2026-09-18') }), row({ targetMonth: '2026-08', payDate: D('2026-08-25') })], [['2026-08', 300000, '2026-09-18']]],
  ['조정 전표는 실입금 아님', [row({ targetMonth: '2026-06', isBillingAdjust: true })], []],
  ['0원 행은 실입금 아님', [row({ targetMonth: '2026-06', actualAmount: 0 })], []],
  ['음수(환불) 행은 실입금 아님', [row({ targetMonth: '2026-06', actualAmount: -10000 })], []],
  ['납입일 변경 조정 행은 실입금 아님', [row({ targetMonth: '2026-10', memo: '[납입일변경] 21일→1일' })], []],
  ['다른 메모는 실입금', [row({ targetMonth: '2026-10', memo: '현금' })], [['2026-10', 150000, '2026-09-18']]],
  ['귀속월 없는 행은 무시', [row({ targetMonth: null })], []],
  ['형식이 틀린 귀속월은 무시', [row({ targetMonth: '2026-9' })], []],
  ['최근 달이 앞', [row({ targetMonth: '2026-07' }), row({ targetMonth: '2026-09' }), row({ targetMonth: '2026-08' })],
    [['2026-09', 150000, '2026-09-18'], ['2026-08', 150000, '2026-09-18'], ['2026-07', 150000, '2026-09-18']]],
  ['입금일은 KST 날짜(UTC 15시 = 다음날 KST)', [row({ targetMonth: '2026-09', payDate: new Date('2026-09-17T15:30:00.000Z') })], [['2026-09', 150000, '2026-09-18']]],
  ['해를 넘어도 달 순서', [row({ targetMonth: '2025-12' }), row({ targetMonth: '2026-01' })], [['2026-01', 150000, '2026-09-18'], ['2025-12', 150000, '2026-09-18']]],
]
for (const [name, rows, want] of T1) eq(`① ${name}`, issuableRentMonths(rows).map(m => [m.month, m.amount, m.lastPayDate]), want)

// ── ② 발행일 첫 상태(운영자 결정 2026-10-21: 값은 오늘, 하한은 그 달 몫 입금일, 달력은 그 입금일의 달) ──────────
const TODAY = '2026-10-20'
type D2 = { value: string; minDate: string | null; openMonth: string | null }
const T2: [string, string | null | undefined, D2][] = [
  ['입금 있는 달 = 값 오늘 · 하한 입금일 · 달력 입금일의 달', '2026-09-18', { value: TODAY, minDate: '2026-09-18', openMonth: '2026-09' }],
  ['8월분을 9월에 받음 = 달력은 9월', '2026-09-18', { value: TODAY, minDate: '2026-09-18', openMonth: '2026-09' }],
  ['오늘 입금', TODAY, { value: TODAY, minDate: TODAY, openMonth: '2026-10' }],
  ['미래 입금일(방어) = 하한·달력 오늘로 자름', '2026-11-01', { value: TODAY, minDate: TODAY, openMonth: '2026-10' }],
  ['실입금 없음(null) = 하한·달력 없음', null, { value: TODAY, minDate: null, openMonth: null }],
  ['undefined = 하한·달력 없음', undefined, { value: TODAY, minDate: null, openMonth: null }],
  ['빈 문자열 = 하한·달력 없음', '', { value: TODAY, minDate: null, openMonth: null }],
  ['형식이 틀리면 하한·달력 없음', '2026-9-18', { value: TODAY, minDate: null, openMonth: null }],
]
for (const [name, v, want] of T2) eq(`② ${name}`, issueDateDefaults(v, TODAY), want)
const T2b: [string, string, string | null, string | null][] = [
  ['입금일 당일 = 통과', '2026-09-18', '2026-09-18', null],
  ['입금일 뒤 = 통과', '2026-10-01', '2026-09-18', null],
  ['입금일 앞(423호 8월분 8/21) = 거절', '2026-08-21', '2026-09-18', '2026년 8월분의 발행일이 입금일(2026.09.18)보다 앞섭니다.'],
  ['입금 기록 없음 = 막을 근거 없음', '2026-08-21', null, null],
]
for (const [name, d, pay, want] of T2b) eq(`② ${name}`, issueDateBeforePaymentError('2026-08', d, pay), want)
eq('② 여러 달 검사도 같은 문장', batchRequestError([{ month: '2026-08', issueDate: '2026-08-21' }], [{ month: '2026-08', amount: 1, lastPayDate: '2026-09-18' }], TODAY),
  issueDateBeforePaymentError('2026-08', '2026-08-21', '2026-09-18'))

// ── ③ 묶음 요청 검사 ───────────────────────────────────────────────
const ISS = [
  { month: '2026-09', amount: 150000, lastPayDate: '2026-09-18' },
  { month: '2026-08', amount: 150000, lastPayDate: '2026-09-18' },
  { month: '2026-07', amount: 100000, lastPayDate: '2026-07-15' },
]
const ok = (m: string, d: string) => ({ month: m, issueDate: d })
const T3: [string, { month: string; issueDate: string }[], boolean][] = [
  ['세 달 기본값', [ok('2026-07', '2026-07-15'), ok('2026-08', '2026-09-18'), ok('2026-09', '2026-09-18')], true],
  ['한 달', [ok('2026-09', '2026-09-18')], true],
  ['발행일을 입금일보다 늦게 고침', [ok('2026-07', '2026-10-01')], true],
  ['발행일 = 오늘', [ok('2026-09', TODAY)], true],
  ['빈 묶음', [], false],
  ['실입금 없는 달', [ok('2026-06', '2026-06-21')], false],
  ['같은 달 두 번', [ok('2026-09', '2026-09-18'), ok('2026-09', '2026-09-19')], false],
  ['미래 발행일', [ok('2026-09', '2026-10-21')], false],
  ['입금일보다 앞선 발행일(423호 8월분 8/21)', [ok('2026-08', '2026-08-21')], false],
  ['빈 발행일', [ok('2026-09', '')], false],
  ['달 형식 오류', [ok('2026-9', '2026-09-18')], false],
  [`상한 ${RENT_RECEIPT_BATCH_MAX} 초과`, Array.from({ length: RENT_RECEIPT_BATCH_MAX + 1 }, (_, i) => ok(`2025-${String((i % 12) + 1).padStart(2, '0')}`, '2026-09-18')), false],
]
for (const [name, picks, want] of T3) eq(`③ ${name}`, batchRequestError(picks, ISS, TODAY) === null, want)
eq('③ 오류 문장은 한국어 한 문장', batchRequestError([ok('2026-06', '2026-06-21')], ISS, TODAY), '2026년 6월분은 실제 입금 기록이 없어 묶음으로 발급할 수 없습니다.')
eq('③ 달 표기', monthLabel('2026-08'), '2026년 8월분')
eq('③ 같은 해면 연도를 뗀다', monthLabelShort('2026-08', '2026-10'), '8월분')
eq('③ 다른 해면 연도를 붙인다', monthLabelShort('2025-12', '2026-01'), '2025년 12월분')
eq('③ 묶음 상한 6(함수 시간 상한 안)', RENT_RECEIPT_BATCH_MAX, 6)

// ── ④ 최신 판정(귀속월) ─────────────────────────────────────────────
type F = { id: string; targetMonth?: string | null; at: Date }
const T4: [string, F[], string | undefined][] = [
  ['빈 입력', [], undefined],
  ['한 장', [{ id: 'a', targetMonth: '2026-09', at: D('2026-09-18') }], 'a'],
  ['귀속월이 발행일을 이긴다(10월에 7월분을 늦게 발급)', [{ id: '7', targetMonth: '2026-07', at: D('2026-10-18') }, { id: '9', targetMonth: '2026-09', at: D('2026-10-10') }], '9'],
  ['같은 귀속월이면 늦은 발행일', [{ id: 'old', targetMonth: '2026-09', at: D('2026-09-18') }, { id: 'new', targetMonth: '2026-09', at: D('2026-09-20') }], 'new'],
  ['같은 귀속월·같은 발행일이면 앞선 입력(최신순 입력의 첫 건)', [{ id: 'first', targetMonth: '2026-09', at: D('2026-09-18') }, { id: 'second', targetMonth: '2026-09', at: D('2026-09-18') }], 'first'],
  ['귀속월 없는 옛 장은 발행일의 달', [{ id: 'legacy', targetMonth: null, at: D('2026-09-05') }, { id: 'aug', targetMonth: '2026-08', at: D('2026-09-30') }], 'legacy'],
  ['선납 9월분(8월 발행) vs 8월분(9월 발행)', [{ id: 'aug', targetMonth: '2026-08', at: D('2026-09-02') }, { id: 'sep', targetMonth: '2026-09', at: D('2026-08-28') }], 'sep'],
  ['입력 순서 무관', [{ id: '9', targetMonth: '2026-09', at: D('2026-10-10') }, { id: '7', targetMonth: '2026-07', at: D('2026-10-18') }], '9'],
]
for (const [name, files, want] of T4) eq(`④ ${name}`, latestByTargetMonth(files)?.id, want)

// ── ⑤ 적용취소 토큰 ────────────────────────────────────────────────
const R: RentReceiptIssueRow = {
  id: 'r1', driveFileId: 'd1', fileName: 'f.pdf', receiptNo: '20260918-001', issuedAt: '2026-09-18T00:00:00.000Z',
  kind: 'rent', targetMonth: '2026-09', tenantId: 't', leaseTermId: 'l', nameStyle: null,
}
const U = { v: 1 as const, rows: [R] }
eq('⑤ 모양이 맞으면 통과', parseRentReceiptUndo(JSON.parse(JSON.stringify(U))) !== null, true)
eq('⑤ 빈 묶음 거절', parseRentReceiptUndo({ v: 1, rows: [] }), null)
eq('⑤ 버전 거절', parseRentReceiptUndo({ ...U, v: 2 }), null)
eq('⑤ 같은 id 두 번 거절', parseRentReceiptUndo({ v: 1, rows: [R, R] }), null)
eq('⑤ 상한 초과 거절', parseRentReceiptUndo({ v: 1, rows: Array.from({ length: RENT_RECEIPT_BATCH_MAX + 1 }, (_, i) => ({ ...R, id: `r${i}` })) }), null)
eq('⑤ 시각 형식 거절', parseRentReceiptUndo({ v: 1, rows: [{ ...R, issuedAt: 'x' }] }), null)
eq('⑤ 서명 타입 거절', parseRentReceiptUndo({ ...U, sig: 3 }), null)
eq('⑤ null 거절', parseRentReceiptUndo(null), null)
eq('⑤ 정본 문자열은 시각 표기와 무관', canonicalRentReceiptUndo(U) === canonicalRentReceiptUndo({ v: 1, rows: [{ ...R, issuedAt: '2026-09-18T09:00:00+09:00' }] }), true)
eq('⑤ 정본 문자열은 칸이 바뀌면 달라진다', canonicalRentReceiptUndo(U) === canonicalRentReceiptUndo({ v: 1, rows: [{ ...R, fileName: 'g.pdf' }] }), false)
const DB = { ...R, issuedAt: D('2026-09-18'), deletedAt: null as Date | null }
eq('⑤ 그대로면 같다', rentReceiptRowUnchanged(DB, R), true)
eq('⑤ 지워졌으면 다르다', rentReceiptRowUnchanged({ ...DB, deletedAt: new Date() }, R), false)
for (const k of ['driveFileId', 'fileName', 'receiptNo', 'kind', 'targetMonth', 'tenantId', 'leaseTermId', 'nameStyle'] as const) {
  eq(`⑤ ${k} 가 바뀌면 다르다`, rentReceiptRowUnchanged({ ...DB, [k]: 'zz' }, R), false)
}
eq('⑤ 발행일이 바뀌면 다르다', rentReceiptRowUnchanged({ ...DB, issuedAt: D('2026-09-19') }, R), false)

// ── ⑥ 자동값 → 종이 칸 ─────────────────────────────────────────────
eq('⑥ 금액은 천 단위 쉼표, 0 은 빈칸', [
  autoFormFields({ room: '423호', period: 'p', targetMonth: '2026년 9월분', amount: 150000, payDate: 'x', payMethod: 'y', note: 'n', recipientName: 'r' }, '홍길동').amount,
  autoFormFields({ room: '423호', period: 'p', targetMonth: '2026년 9월분', amount: 0, payDate: 'x', payMethod: 'y', note: 'n', recipientName: 'r' }, '홍길동').amount,
], ['150,000', ''])

// ── ⑦ 서류 시트 행 ────────────────────────────────────────────────
const NOW = new Date('2026-10-20T03:00:00.000Z')
const lease = (p: Partial<DocBundleLease> & { id: string }): DocBundleLease =>
  ({ status: 'ACTIVE', moveInDate: D('2026-04-21'), depositAmount: 0, parentLeaseTermId: null, roomNo: p.id, ...p })
const rf = (leaseTermId: string, at: string, targetMonth: string | null): DocBundleFile =>
  ({ driveFileId: `d-${leaseTermId}-${targetMonth}-${at}`, leaseTermId, at: D(at), note: null, targetMonth })
const build = (leases: DocBundleLease[], rents: DocBundleFile[], pastLeases?: DocBundleLease[], paid: string[] = []) =>
  buildDocBundle({ tenantName: 't', leases, contracts: [], rents, deposits: [], certs: [], rentPaidLeaseIds: paid, pastLeases, now: NOW })
const rentOf = (b: ReturnType<typeof build>, id: string) => b.groups.find(gp => gp.leaseTermId === id)?.rows.find(r => r.docType === 'rent')
{
  // 발행일 최신순 입력(조회 정렬)인데 7월분이 맨 앞 — 시트는 9월분을 세운다.
  const b = build([lease({ id: 'A' })], [rf('A', '2026-10-18', '2026-07'), rf('A', '2026-10-10', '2026-09'), rf('A', '2026-10-09', '2026-08')])
  eq('⑦ 시트 최신 = 귀속월 9월분', rentOf(b, 'A')?.driveFileId, 'd-A-2026-09-2026-10-10')
  eq("⑦ 단기 아닌 계약에 '여러 달 작성'", rentOf(b, 'A')?.writeMany, true)
  eq('⑦ 라벨 상수', DOC_WRITE_MANY_LABEL, '여러 달 작성')
}
{
  const b = build([lease({ id: 'S', isShortTerm: true })], [rf('S', '2026-09-01', '2026-08')], undefined, ['S'])
  eq("⑦ 단기에는 '여러 달 작성' 없음", rentOf(b, 'S')?.writeMany, undefined)
  eq("⑦ 단기에는 '이번 달' 문도 없음", rentOf(b, 'S')?.canWriteNew, undefined)
}
{
  // 이번 달(10월)분이 이미 있으면 stale 이 아니다 — 발행일이 9월이어도(선납) 귀속월로 본다.
  const b = build([lease({ id: 'A' })], [rf('A', '2026-09-28', '2026-10'), rf('A', '2026-10-05', '2026-09')], undefined, ['A'])
  eq('⑦ 귀속월 이번 달 = 문 닫힘 판정 대상 아님', rentOf(b, 'A')?.canWriteNew, undefined)
}
{
  const out = lease({ id: 'O', status: 'CHECKED_OUT', moveInDate: D('2025-01-01') })
  const b = build([lease({ id: 'A' })], [rf('O', '2025-03-01', '2025-02')], [out])
  eq('⑦ 퇴실 계약 그룹은 진행 중 계약 뒤', b.groups.map(gp => [gp.kind, gp.leaseTermId, gp.status]), [['lease', 'A', 'ACTIVE'], ['lease', 'O', 'CHECKED_OUT']])
  eq('⑦ 퇴실 계약 그룹 = 납부 확인서 한 행', b.groups[1].rows.map(r => [r.docType, r.driveFileId, r.writeMany, r.canWriteNew ?? null]), [['rent', 'd-O-2025-02-2025-03-01', true, null]])
  eq('⑦ 그 종이를 중립 그룹에 또 세우지 않는다', b.groups.some(gp => gp.kind === 'other'), false)
}
{
  const b = build([], [], [lease({ id: 'O', status: 'CHECKED_OUT' })])
  eq('⑦ 발급본 없는 퇴실 계약도 행이 선다(작성 문)', b.groups.map(gp => [gp.leaseTermId, gp.rows[0].driveFileId]), [['O', null]])
}
{
  const out = lease({ id: 'O', status: 'CHECKED_OUT', isShortTerm: true })
  const b = build([], [], [out])
  eq("⑦ 단기 퇴실 계약에는 '여러 달 작성' 없음", b.groups[0].rows[0].writeMany, undefined)
}
{
  // 진행 중 계약으로 이미 선 계약이 pastLeases 에 섞여 와도 한 번만 선다.
  const A = lease({ id: 'A' })
  const b = build([A], [], [A])
  eq('⑦ 중복 계약은 한 그룹', b.groups.length, 1)
}

console.log(`[납부 확인서 달 축] ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
