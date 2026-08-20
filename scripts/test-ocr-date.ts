// 영수증 인식 날짜 타당성 회귀 — 실행: npx tsx scripts/test-ocr-date.ts
//
// 여기서 고정하는 것 둘(2026-08-20 긴급 신고).
//   · **결제일은 미래일 수 없다** — 영수증은 이미 결제된 종이다. 쿠팡 주문서의 '도착 예정일'을
//     결제일로 읽어 미래 날짜가 들어온 것이 이번 사고의 절반이다.
//   · **너무 먼 과거는 오독으로 본다** — 저장된 값은 2024-08-21(약 730일 과거)이었고, 지출
//     내역이 2026-08 창을 조회하므로 그 6건이 목록에서 통째로 사라졌다.
// 버리는 쪽으로 실패한다 — 틀린 날짜를 조용히 심는 것보다 빈 칸이 낫다.
import { plausibleOcrDate } from '../lib/receiptOcr'
import { fmtMDYearIfOther } from '../lib/fmtDate'

let pass = 0
let fail = 0
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; return }
  fail++
  console.error(`FAIL ${name}\n  기대: ${e}\n  실제: ${a}`)
}

const TODAY = '2026-08-20'

// ── 타당성 판정 ──
eq('오늘은 통과', plausibleOcrDate('2026-08-20', TODAY), '2026-08-20')
eq('며칠 전 영수증은 통과', plausibleOcrDate('2026-08-13', TODAY), '2026-08-13')
eq('작년 영수증도 통과(소급 입력)', plausibleOcrDate('2025-09-15', TODAY), '2025-09-15')

// 이번 사고의 두 얼굴
eq('내일(도착 예정일 오독)은 버린다', plausibleOcrDate('2026-08-21', TODAY), undefined)
eq('2년 전(이번 신고의 저장값)은 버린다', plausibleOcrDate('2024-08-21', TODAY), undefined)

// 경계 — 400일
eq('400일 전은 통과', plausibleOcrDate('2025-07-16', TODAY), '2025-07-16')
eq('401일 전은 버린다', plausibleOcrDate('2025-07-15', TODAY), undefined)

// 모양이 아닌 값
eq('빈 값', plausibleOcrDate('', TODAY), undefined)
eq('문자열 아님', plausibleOcrDate(20260820 as unknown, TODAY), undefined)
eq('null', plausibleOcrDate(null, TODAY), undefined)
eq('모양 어긋남', plausibleOcrDate('2026/08/20', TODAY), undefined)
eq('연도 두 자리', plausibleOcrDate('26-08-20', TODAY), undefined)
eq('시각이 붙어 와도 날짜부만', plausibleOcrDate('2026-08-19T05:00:00Z', TODAY), '2026-08-19')

// ── 표기 — 다른 해면 연도가 드러난다 ──
const today = new Date('2026-08-20T00:00:00.000Z')
eq('같은 해는 짧게', fmtMDYearIfOther('2026-08-21T00:00:00.000Z', today), '8/21')
eq('다른 해는 연도까지', fmtMDYearIfOther('2024-08-21T00:00:00.000Z', today), '2024. 8/21')
eq('빈 값은 줄표', fmtMDYearIfOther(null, today), '—')

console.log(`\n영수증 인식 날짜 회귀: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
