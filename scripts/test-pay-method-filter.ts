// 수납 관리 '수납 방법' 필터(lib/payMethodFilter) 진리표 + 서버·화면이 같은 정본을 부르는지 정적 검사. 실행 npx tsx scripts/test-pay-method-filter.ts
//
// 고정하는 것(신고 390345ad, 2026-11-02 운영자 '추천대로' 승인).
//   · 축은 입금일(payDate). 귀속월이 다른 달이어도 이 달에 받았으면 든다(보조줄에 '(9월분)').
//   · 이용료만. 보증금·양도인 몫·청구 조정 전표·납입일 변경 조정 행·0원 이하·고를 수 없는 수단(보유 보증금·양도인 정산)은 뺀다.
//   · 수단이 비면 '수단 미기록' 칸.
//   · 항등식: 카드 수납 줄 = 신용카드 칸 + 결제선생 칸 + 카드로 받은 보증금(카드 줄만 보증금을 넣는다, 2026-08-24 운영자 확인).
//   · 소스: 서버 집계와 행 목록이 정본을 부르고, 화면은 필터·요약·보조줄을 정본으로 그린다. 한정어 '입금일 기준'은 숫자 앞
//     상시 텍스트, 필터 라벨은 '수납 방법', 수단별 색 없음.
import fs from 'node:fs'
import path from 'node:path'
import {
  aggregateMonthPayments, cardLikeMethodSum, methodPaymentKey, methodPaysOf, methodPayLine, rowHasMethodPay, payMethodKey,
  PAY_METHOD_FILTER_OPTIONS, PAY_METHOD_UNRECORDED, type MethodPaymentRow,
} from '../lib/payMethodFilter'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  const a = JSON.stringify(got), b = JSON.stringify(want)
  if (a === b) { pass++; return }
  fails.push(`${name}: 기대 ${b} / 실제 ${a}`)
}
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; return }
  fails.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// payDate 는 @db.Date. UTC 자정 저장
const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`)
type Row = MethodPaymentRow & { targetMonth: string }
const R = (p: Partial<Row> & { payDate: Date }): Row => ({
  payMethod: '계좌이체', actualAmount: 100_000, isDeposit: false, isPrevOwner: false, isBillingAdjust: false, memo: null, targetMonth: '2026-10', ...p,
})

// ── 선택지 ─────────────────────────────────────────────
eq('선택지 = 사람이 고르는 수단 + 미기록', PAY_METHOD_FILTER_OPTIONS, ['계좌이체', '현금', '신용카드', '결제선생', '기타', '수단 미기록'])
eq('빈 수단은 수단 미기록', [payMethodKey(null), payMethodKey(''), payMethodKey('  ')], [PAY_METHOD_UNRECORDED, PAY_METHOD_UNRECORDED, PAY_METHOD_UNRECORDED])

// ── 드는 행 판정 ───────────────────────────────────────
const D = day('2026-10-03')
eq('현금 이용료는 현금 칸', methodPaymentKey(R({ payDate: D, payMethod: '현금' })), '현금')
eq('수단 없음은 미기록 칸', methodPaymentKey(R({ payDate: D, payMethod: null })), '수단 미기록')
eq('보증금은 안 든다', methodPaymentKey(R({ payDate: D, isDeposit: true })), null)
eq('양도인 몫은 안 든다', methodPaymentKey(R({ payDate: D, isPrevOwner: true })), null)
eq('청구 조정 전표는 안 든다', methodPaymentKey(R({ payDate: D, isBillingAdjust: true })), null)
eq('납입일 변경 조정 행은 안 든다(양수여도)', methodPaymentKey(R({ payDate: D, memo: '[납입일변경] 9일→2일 조정', actualAmount: 130_000 })), null)
eq('0원(전액 환불)은 안 든다', methodPaymentKey(R({ payDate: D, actualAmount: 0 })), null)
eq('보유 보증금은 안 든다', methodPaymentKey(R({ payDate: D, payMethod: '보유 보증금' })), null)
eq('양도인 정산 표식은 안 든다', methodPaymentKey(R({ payDate: D, payMethod: '양도인 정산' })), null)

// ── 월 집계 + 항등식 ───────────────────────────────────
const rows: Row[] = [
  R({ payDate: day('2026-10-03'), payMethod: '현금', actualAmount: 130_000 }),
  R({ payDate: day('2026-10-20'), payMethod: '현금', actualAmount: 50_000, targetMonth: '2026-09' }),   // 9월분을 10월에 받음
  R({ payDate: day('2026-09-30'), payMethod: '현금', actualAmount: 70_000, targetMonth: '2026-10' }),   // 10월분을 9월에 받음, 10월 칸 아님
  R({ payDate: day('2026-10-01'), payMethod: '현금', actualAmount: 20_000 }),                            // 달 첫날(UTC 자정 경계)
  R({ payDate: day('2026-10-31'), payMethod: '현금', actualAmount: 10_000 }),                            // 달 끝날
  R({ payDate: day('2026-10-05'), payMethod: '신용카드', actualAmount: 300_000 }),
  R({ payDate: day('2026-10-06'), payMethod: '결제선생', actualAmount: 200_000 }),
  R({ payDate: day('2026-10-07'), payMethod: '신용카드', actualAmount: 100_000, isDeposit: true }),       // 카드 보증금
  R({ payDate: day('2026-10-08'), payMethod: '현금', actualAmount: 500_000, isDeposit: true }),           // 현금 보증금
  R({ payDate: day('2026-10-09'), payMethod: null, actualAmount: 40_000 }),
  R({ payDate: day('2026-10-09'), payMethod: '신용카드', actualAmount: 0, isBillingAdjust: true }),
  R({ payDate: day('2026-10-10'), payMethod: '보유 보증금', actualAmount: 90_000 }),
]
const agg = aggregateMonthPayments(rows, '2026-10')
eq('현금 칸 = 입금일이 10월인 이용료만', agg.byMethod['현금'], { sum: 210_000, count: 4 })
eq('신용카드 칸은 보증금 제외', agg.byMethod['신용카드'], { sum: 300_000, count: 1 })
eq('결제선생 칸', agg.byMethod['결제선생'], { sum: 200_000, count: 1 })
eq('미기록 칸', agg.byMethod['수단 미기록'], { sum: 40_000, count: 1 })
eq('보유 보증금 칸은 없다', agg.byMethod['보유 보증금'], undefined)
eq('카드 줄은 종전 그대로(보증금 포함, 조정 전표 제외)', [agg.cardSum, agg.cardCount], [600_000, 3])
eq('카드로 받은 보증금 몫', agg.cardDepositSum, 100_000)
eq('항등식: 카드 줄 = 신용카드 칸 + 결제선생 칸 + 카드 보증금', agg.cardSum, cardLikeMethodSum(agg.byMethod) + agg.cardDepositSum)
eq('9월로 세면 9/30 현금만', aggregateMonthPayments(rows, '2026-09').byMethod['현금'], { sum: 70_000, count: 1 })

// ── 행 목록·보조줄 ─────────────────────────────────────
const pays = methodPaysOf(rows, '2026-10')
eq('행 목록은 입금일 순, 그 달 것만', pays.map(p => p.payDate), ['2026-10-01', '2026-10-03', '2026-10-05', '2026-10-06', '2026-10-09', '2026-10-20', '2026-10-31'])
ok('필터: 현금 받은 행', rowHasMethodPay(pays, '현금'))
ok('필터: 기타 없음', !rowHasMethodPay(pays, '기타'))
ok('필터: 목록 없음은 거름', !rowHasMethodPay(undefined, '현금'))
eq('보조줄 한 건', methodPayLine([{ method: '현금', payDate: '2026-10-03', amount: 130_000, targetMonth: '2026-10' }], '현금', '2026-10'), '현금 · 10/3 130,000원')
eq('보조줄 여러 건·다른 달분', methodPayLine(pays, '현금', '2026-10'), '현금 · 10/1 20,000원 · 10/3 130,000원 · 10/20 50,000원 (9월분) · 10/31 10,000원')
eq('보조줄 다른 해 귀속', methodPayLine([{ method: '현금', payDate: '2026-01-02', amount: 1_000, targetMonth: '2025-12' }], '현금', '2026-01'), '현금 · 1/2 1,000원 (2025년 12월분)')
eq('보조줄 그 수단 없음', methodPayLine(pays, '기타', '2026-10'), null)

// ── 소스 그물 ─────────────────────────────────────────
{
  const root = path.resolve(__dirname, '..')
  const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8')
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  const act = strip(read('app/(app)/rooms/actions.ts'))
  const aggBody = act.match(/export async function getMonthPaymentAggregates[\s\S]*?\n}/)?.[0] ?? ''
  ok('서버 월 집계가 정본 aggregateMonthPayments 를 부른다', /aggregateMonthPayments\(cardRows, targetMonth\)/.test(aggBody))
  ok('서버 월 집계가 카드 판정을 손으로 다시 하지 않는다', !/paymentCardMonth\(|CARD_LIKE_METHODS/.test(aggBody))
  ok('서버 월 집계가 보증금·양도인·메모를 읽는다(정본 판정 재료)', /isDeposit: true, isPrevOwner: true, memo: true/.test(aggBody))
  ok('서버 월 집계가 byMethod 를 돌려준다', /return \{[^}]*byMethod[^}]*\}/.test(aggBody))
  ok('행 목록은 이미 읽은 기록에서 정본으로, 분기보다 먼저(검수 B1)', /const methodPays = methodPaysOf\(allRecordsThruMonth\.filter\(/.test(act)
    && act.indexOf('const methodPays = methodPaysOf(') < act.indexOf("if (lease.status === 'RESERVED') {"))
  ok('진행 중 계약 행의 네 반환이 모두 methodPays 를 싣는다', (act.match(/^\s+methodPays,$/gm) ?? []).length === 4)

  const ui = strip(read('app/(app)/rooms/RoomsClient.tsx'))
  ok("필터 라벨 '수납 방법'(필터 select 바로 위)", /<label[^>]*>수납 방법<\/label>\s*<select value=\{methodFilter\}/.test(ui))
  ok('선택지는 정본 목록', /PAY_METHOD_FILTER_OPTIONS\.map\(/.test(ui))
  ok('행 거름은 정본 rowHasMethodPay', /activeMethod && !rowHasMethodPay\(r\.methodPays, activeMethod\)/.test(ui))
  ok('카드·표 보조줄 둘 다 정본 methodPayLine', (ui.match(/methodPayLine\(room\.methodPays, activeMethod, targetMonth\)/g) ?? []).length >= 4)
  ok("요약 줄 한정어 '입금일 기준'이 숫자 앞 상시 텍스트", /입금일 기준 \{activeMethod\} 수납 <span[^>]*>\{fmtWon\(payAggregates\.byMethod\[activeMethod\]/.test(ui))
  ok('요약 값은 서버 집계(행으로 되계산 금지)', !/displayed\.reduce\([^)]*methodPays/.test(ui) && !/filtered\.reduce\([^)]*methodPays/.test(ui))
  ok('공실 보기에선 필터가 꺼진다', /const activeMethod = panelPayFiltersValid \? methodFilter : ''/.test(ui))
  ok('필터 개수·초기화에 들어간다', /panelPayFiltersValid && methodFilter \? 1 : 0/.test(ui) && /setMethodFilter\(''\)/.test(ui))
  ok('수단별 색 없음', !/methodColor|METHOD_COLOR|PAY_METHOD_TONE/.test(ui))
}

console.log(`[수납 방법 필터] 통과 ${pass} / 실패 ${fails.length}`)
for (const f of fails) console.error(`  - ${f}`)
process.exit(fails.length > 0 ? 1 : 0)
