// 고정지출 추정액 정본(lib/recurringEstimate) 회귀 테스트 — DB 불필요, 순수 함수 케이스 고정.
// 재무 탭 예정 행·대시보드 예상지출·홈 알림·오늘 출금 알림·기록 모달 프리필이 이 한 식을 쓴다.
import { recurringEstimate, effectiveRecurringAmount, recurringAmountLabel } from '../lib/recurringEstimate'
import type { RecurringEstimateSource } from '../lib/recurringEstimate'

let pass = 0
const fails: string[] = []

function eq(label: string, got: unknown, want: unknown) {
  if (got === want) pass++
  else fails.push(`${label}: 기대 ${String(want)} / 실제 ${String(got)}`)
}

const src = (o: Partial<RecurringEstimateSource>): RecurringEstimateSource => ({
  amount: 100_000,
  isVariable: true,
  pendingAmount: null,
  priorYearActual: null,
  priorYearAmount: null,
  recentAvg: null,
  estimateMonth: '2026-08',
  ...o,
})

// ── 우선순위: 예약금액 > (비변동)계약액 > 작년 같은 달 > 수기 전년동월 > 최근 3개월 평균 > 기본액 ──
eq('예약금액이 모든 이력을 이긴다',
  effectiveRecurringAmount(src({ pendingAmount: 1_911_220, priorYearActual: 800_000, priorYearAmount: 770_000, recentAvg: 833_323 })), 1_911_220)
eq('예약금액 라벨',
  recurringAmountLabel(src({ pendingAmount: 1_911_220, priorYearActual: 800_000 })), '예약금액')

eq('작년 같은 달이 3개월 평균을 이긴다',
  effectiveRecurringAmount(src({ priorYearActual: 1_820_000, recentAvg: 833_323 })), 1_820_000)
eq('작년 같은 달 라벨은 조회월의 달을 적는다',
  recurringAmountLabel(src({ priorYearActual: 1_820_000, recentAvg: 833_323 })), '작년 8월')
eq('조회월이 바뀌면 라벨의 달도 따라간다',
  recurringAmountLabel(src({ estimateMonth: '2026-12', priorYearActual: 500_000 })), '작년 12월')
eq('한 자리 달도 앞의 0 없이',
  recurringAmountLabel(src({ estimateMonth: '2027-01', priorYearActual: 500_000 })), '작년 1월')

eq('작년 기록이 없으면 3개월 평균',
  effectiveRecurringAmount(src({ recentAvg: 682_700 })), 682_700)
eq('3개월 평균 라벨', recurringAmountLabel(src({ recentAvg: 682_700 })), '3개월 평균')

// ── 수기 전년동월(priorYearAmount) — 실기록 아래, 3개월 평균 위 (2026-08-19 운영자 지시) ──
// 운영자는 이 칸을 '작년 같은 달을 아는 수단'으로 쓴다. 진짜 작년 기록이 생기면 그쪽이 이기고,
// 아직 없을 때는 계절이 다른 3개월 평균보다 운영자가 아는 작년 값이 낫다.
eq('작년 실기록이 있으면 수기 값은 무시된다',
  effectiveRecurringAmount(src({ priorYearActual: 1_820_000, priorYearAmount: 900_000, recentAvg: 833_323 })), 1_820_000)
eq('실기록이 이겼으면 라벨도 실기록 쪽',
  recurringAmountLabel(src({ priorYearActual: 1_820_000, priorYearAmount: 900_000 })), '작년 8월')
eq('작년 실기록이 없으면 수기 값이 3개월 평균을 이긴다',
  effectiveRecurringAmount(src({ priorYearAmount: 900_000, recentAvg: 833_323 })), 900_000)
eq('수기 값 라벨은 달을 적지 않는다(연월 없는 정수라서)',
  recurringAmountLabel(src({ priorYearAmount: 900_000, recentAvg: 833_323 })), '전년동월')
eq('조회월이 바뀌어도 수기 값 라벨은 그대로',
  recurringAmountLabel(src({ estimateMonth: '2026-12', priorYearAmount: 900_000 })), '전년동월')
eq('수기 값만 있고 3개월 평균이 없어도 채택',
  effectiveRecurringAmount(src({ amount: 321_780, priorYearAmount: 900_000 })), 900_000)
eq('비변동은 수기 값보다 계약액이 먼저',
  effectiveRecurringAmount(src({ isVariable: false, amount: 3_960_000, priorYearAmount: 900_000 })), 3_960_000)
eq('비변동 계약액 채택이면 수기 값이 있어도 라벨 없음',
  recurringAmountLabel(src({ isVariable: false, amount: 3_960_000, priorYearAmount: 900_000 })), null)
eq('예약금액은 수기 값도 이긴다',
  effectiveRecurringAmount(src({ pendingAmount: 1_000_000, priorYearAmount: 900_000 })), 1_000_000)
// 라벨이 68px(재무 탭 지출표 '금액' 칸 100px 에서 좌우 여백 32px 제외) 안에 들어가는지는
// 글자 수로 지킨다. 한글 4자 + 여백이 이 폭의 상한이다.
eq('수기 값 라벨 길이 상한', recurringAmountLabel(src({ priorYearAmount: 900_000 }))!.length <= 4, true)

eq('이력이 하나도 없으면 기본액', effectiveRecurringAmount(src({ amount: 321_780 })), 321_780)
eq('변동인데 이력이 없으면 기본액이라고 밝힌다', recurringAmountLabel(src({ amount: 321_780 })), '기본액')

// ── 비변동 항목은 이력보다 기본액(계약액)이 먼저 ──────────────
// 기본액은 추측이 아니라 운영자가 적어 둔 계약 금액이다. 이력을 위에 두면 임대료를 올린 달에
// 작년 임대료가 뜨고(인상이 1년 늦게 반영), 개시 첫 달 일할 청구가 다음 달 추정이 된다.
eq('비변동은 작년 기록보다 계약액',
  effectiveRecurringAmount(src({ isVariable: false, amount: 3_960_000, priorYearActual: 3_600_000 })), 3_960_000)
eq('비변동은 3개월 평균보다 계약액(첫 달 일할 오염 차단)',
  effectiveRecurringAmount(src({ isVariable: false, amount: 92_400, recentAvg: 14_900 })), 92_400)
eq('비변동 계약액에는 라벨을 붙이지 않는다',
  recurringAmountLabel(src({ isVariable: false, amount: 3_960_000, priorYearActual: 3_600_000 })), null)
eq('비변동이어도 예약금액은 이긴다',
  effectiveRecurringAmount(src({ isVariable: false, amount: 627_000, pendingAmount: 684_000 })), 684_000)
eq('비변동 예약금액에도 라벨이 붙는다',
  recurringAmountLabel(src({ isVariable: false, amount: 627_000, pendingAmount: 684_000 })), '예약금액')
// 기본액이 0인 비변동은 계약액이라 할 것이 없으니 이력으로 내려간다
eq('비변동 기본액 0이면 이력으로 내려간다',
  effectiveRecurringAmount(src({ isVariable: false, amount: 0, priorYearActual: 55_000 })), 55_000)
eq('비변동 기본액 0의 라벨은 이력 출처',
  recurringAmountLabel(src({ isVariable: false, amount: 0, priorYearActual: 55_000 })), '작년 8월')

// ── 0원 후보 방어 — 0 은 '무료'가 아니라 '모름'이라 건너뛰면 안 되고, 반대로 0이 추정으로
//    올라오면 운영자는 "이 달은 안 나간다"로 읽는다. 0 걸러내기는 산출부(recurringStatus)가 맡고
//    여기서는 예약금액 0(운영자가 명시적으로 0원이라 적은 값)만 그대로 존중한다.
eq('예약금액 0은 그대로 채택(?? 가 아니라 != null 판정)',
  effectiveRecurringAmount(src({ pendingAmount: 0, recentAvg: 500_000 })), 0)
eq('예약금액 0의 라벨도 예약금액', recurringAmountLabel(src({ pendingAmount: 0, recentAvg: 500_000 })), '예약금액')

// ── 금액과 라벨이 같은 항을 가리키는지 (전 조합 순회) ──────────
// 라벨만 갈라지면 '예상치'라 적힌 확정 금액 같은 사고가 다시 난다(2026-07-30 신고).
const basisAmount: Record<string, (s: RecurringEstimateSource) => number | null> = {
  pending:         s => s.pendingAmount,
  contract:        s => s.amount,
  priorYear:       s => s.priorYearActual,
  priorYearManual: s => s.priorYearAmount,
  recentAvg:       s => s.recentAvg,
  base:            s => s.amount,
}
let combos = 0
for (const pendingAmount of [null, 11_000]) {
  for (const isVariable of [true, false]) {
    for (const priorYearActual of [null, 22_000]) {
      for (const priorYearAmount of [null, 55_000]) {
        for (const recentAvg of [null, 33_000]) {
          for (const amount of [0, 44_000]) {
            const s = src({ pendingAmount, isVariable, priorYearActual, priorYearAmount, recentAvg, amount })
            const { amount: got, basis } = recurringEstimate(s)
            if (basisAmount[basis](s) !== got) {
              fails.push(`라벨-금액 불일치: basis=${basis} 금액=${got} (${JSON.stringify({ pendingAmount, isVariable, priorYearActual, priorYearAmount, recentAvg, amount })})`)
            } else combos++
          }
        }
      }
    }
  }
}
eq('전 조합에서 채택 근거와 금액이 같은 항', combos, 64)

console.log(`\n고정지출 추정액 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
