// 구독 캘린더 투어 표시 판정 회귀 검증 — 상태 6종 × 날짜 3종(과거·당일·미래) × 취소 fromStatus 매트릭스.
// 신고 ba74b5cd(송호준: 당일 투어 + 당일 거주중 전환 소실)를 고정 케이스로 박는다. 실행: npx tsx scripts/test-tour-feed.ts
import { shouldShowTourEvent } from '../lib/tourFeed'

const TODAY = '2026-07-29'
const DATES = { past: '2026-07-20', today: TODAY, future: '2026-08-05' } as const

let pass = 0, fail = 0
function check(name: string, got: boolean, want: boolean) {
  if (got === want) { pass++; return }
  fail++
  console.log(`실패: ${name} — 기대 ${want ? '표시' : '제외'}, 실제 ${got ? '표시' : '제외'}`)
}

// 비취소 상태 — 날짜 불문 무조건 표시 (지난 투어 이력 보존 + 진행 중 예정)
for (const status of ['WAITING_TOUR', 'TOUR_DONE', 'RESERVED', 'ACTIVE', 'CHECKOUT_PENDING', 'CHECKED_OUT', 'NON_RESIDENT']) {
  for (const [label, ymd] of Object.entries(DATES)) {
    check(`${status} · ${label}`, shouldShowTourEvent({ status, tourYmd: ymd, lastCancelFrom: null, todayYmd: TODAY }), true)
  }
}

// CANCELLED · 투어 전 취소(WAITING_TOUR발) — 날짜 불문 제외 (하려다 안 한 투어)
for (const [label, ymd] of Object.entries(DATES)) {
  check(`CANCELLED(투어 전 취소) · ${label}`, shouldShowTourEvent({ status: 'CANCELLED', tourYmd: ymd, lastCancelFrom: 'WAITING_TOUR', todayYmd: TODAY }), false)
}

// CANCELLED · 투어 후 취소(TOUR_DONE·RESERVED발, 로그 없음 포함) — 과거·당일 표시, 미래만 제외
for (const from of ['TOUR_DONE', 'RESERVED', null] as const) {
  check(`CANCELLED(${from ?? '로그 없음'}) · past`,   shouldShowTourEvent({ status: 'CANCELLED', tourYmd: DATES.past,   lastCancelFrom: from, todayYmd: TODAY }), true)
  check(`CANCELLED(${from ?? '로그 없음'}) · today`,  shouldShowTourEvent({ status: 'CANCELLED', tourYmd: DATES.today,  lastCancelFrom: from, todayYmd: TODAY }), true)
  check(`CANCELLED(${from ?? '로그 없음'}) · future`, shouldShowTourEvent({ status: 'CANCELLED', tourYmd: DATES.future, lastCancelFrom: from, todayYmd: TODAY }), false)
}

// 고정 회귀 케이스 — 송호준: 당일 투어(7/29) + 당일 WAITING_TOUR → ACTIVE 전환. 반드시 표시.
check('송호준(당일 투어 + 당일 거주중 전환)', shouldShowTourEvent({ status: 'ACTIVE', tourYmd: '2026-07-29', lastCancelFrom: null, todayYmd: '2026-07-29' }), true)
// 고정 케이스 — 김남열 자녀: WAITING_TOUR발 취소. 제외.
check('김남열 자녀(투어 전 취소)', shouldShowTourEvent({ status: 'CANCELLED', tourYmd: '2026-07-20', lastCancelFrom: 'WAITING_TOUR', todayYmd: TODAY }), false)
// 고정 케이스 — 박의균: TOUR_DONE발 취소, 지난 투어. 표시.
check('박의균(투어 완료 후 입실취소)', shouldShowTourEvent({ status: 'CANCELLED', tourYmd: '2026-07-25', lastCancelFrom: 'TOUR_DONE', todayYmd: TODAY }), true)

console.log(`투어 피드 판정 회귀: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
