// 한국식 금액 표기 — N만M원 (절삭 없음, 원 단위까지 정확 표기)
//   1만 미만: 콤마 + '원' (예: 5,000원 / 9,999원)
//   1만 이상: 만 단위 앞, 나머지는 그대로
//     예) 262,500  → "26만2500원"
//         2,543,100 → "254만3100원"
//         400,000   → "40만원"
//         39,000    → "3만9000원"
import { kstMonthStr } from './kstDate'

export function fmtKorMoney(n: number, opts: { zero?: string } = {}): string {
  const r = Math.round(n)
  if (r === 0) return opts.zero ?? '0원'
  const sign = r < 0 ? '−' : ''   // v2.0 §06 음수는 U+2212
  const abs = Math.abs(r)

  if (abs < 10_000) return sign + abs.toLocaleString() + '원'

  const man = Math.floor(abs / 10_000)
  const rest = abs % 10_000

  if (rest === 0) return sign + man.toLocaleString() + '만원'
  return sign + man.toLocaleString() + '만' + rest + '원'
}

// v2.0 §06 표준 원화 표기 — 콤마 + '원', 음수는 '−'(U+2212). 인라인 toLocaleString()+'원' 직접 호출 금지의 단일 경로.
export function fmtWon(n: number): string {
  const r = Math.round(n)
  const sign = r < 0 ? '−' : ''
  return sign + Math.abs(r).toLocaleString('ko-KR') + '원'
}

// v2.0 §06 격자 타일 축약 — 홈 방 현황·비거주자 현황처럼 한 칸 글자 폭이 100px 미만인 자리 전용.
// 운영자 표기 그대로 "55만 · 32.9만"(2026-08-11). '원'·'₩' 는 붙이지 않는다 — §06 축약 예시(1,234만)와
// 같은 형태이고, 320px 3열에서 글자 폭이 70.7px 뿐이라 두 글자가 아깝다.
//
// 만 단위로 나눠 **소수 첫째 자리에서 반올림**한다. 절사는 늘 실제보다 적게 말해 미수 판단을 흐린다
// (최대 오차 500원 — 정확한 값은 타일을 열면 나오는 상세·수납 관리가 말한다).
//
// 올림이 아니라 반올림인 이유 — 이 타일에는 방향이 반대인 두 종류의 돈이 같이 선다. 청구·미납은
// 많게 말하는 쪽이 안전하지만, 제시가·가격 예고(fmtOfferRentAhead)는 많게 말하면 내놓은 값보다
// 비싸게 적히는 거짓말이 된다. 한쪽으로 미는 규칙은 반드시 다른 쪽에서 틀린다.
// §06 은 종전에 표에는 '반올림', 본문에는 '올림'이라 적어 스스로 갈려 있었다 — 절사를 막자는 뜻이
// 방향 지시로 굳은 것이라, 2026-08-12 에 본문을 반올림으로 정합했다(실측 37종 표기 차이 0종).
// 트레일링 '.0' 은 뗀다: 1,570,000 은 '157.0만'이 아니라 '157만'이다.
//
// 1만 미만은 축약하지 않고 콤마 + '원'. '0.7만'은 §06 어디에도 없는 형태이고 읽는 데 더 걸린다.
// 단위 글자('만' / '원')가 그 자리에서 자릿수를 스스로 말하므로 한 열에 섞여도 오독이 없다.
//
// 0원 표시는 부르는 쪽이 정한다 — 방 현황 타일은 빈 슬롯(NBSP)으로 높이만 지킨다(§06 '대상 없음').
// 음수는 §06 대로 −(U+2212). 이 자리(청구액·방 이용료)에는 나오지 않지만 규칙을 갈라 두지 않는다.
export function fmtManShort(n: number): string {
  const r = Math.round(n)
  const sign = r < 0 ? '−' : ''
  const abs = Math.abs(r)
  if (abs < 10_000) return sign + abs.toLocaleString('ko-KR') + '원'
  const man = Math.round(abs / 1_000) / 10   // 소수 첫째 자리 반올림 (toFixed 의 이진 오차 회피)
  return sign + man.toLocaleString('ko-KR') + '만'
}

// 홈 방 현황 타일의 가격 변경 예고 — '9월 36만'. 아직 제시가에 안 실린 예약 인상·인하를 미리 말한다.
// 발화 판정은 lib/billing offerRentChangeAfterMonth 가 하고, 여기는 그 결과를 글자로만 옮긴다.
//
// 왜 '부터'를 안 쓰는가 — 타일의 '부터'는 이미 입주 가능일이 쓰고 있다(availableFromLabel "8/30부터").
// 같은 타일에서 같은 조사가 사람·방의 시점과 돈을 동시에 가리키면 뒤엣것이 상태 전환일로 읽힌다.
// 운영자가 "9/1부터 36만"을 걱정한 지점이 정확히 이것이다(2026-08-12) — "8/30부터" 옆에 "9/1"이
// 서면 그 날 다른 예약이 들어온다는 뜻이 된다.
//
// 왜 일(M/D)이 아니라 달(M월)인가 — 두 가지가 같은 답을 낸다.
//  ① 정직성. offerRentForMonth 가 달 단위라 적용일이 9/20 이어도 9월분은 전부 인상가다.
//     "9/20부터"라고 적으면 엔진이 지키지 않는 약속이 된다.
//  ② 구분. 타일의 날짜 문법은 예외 없이 슬래시를 낀다("8/14 퇴실"·"8/17 입실"·"8/30부터").
//     슬래시 없는 토큰은 읽기 전에 "저건 상태 날짜가 아니다"로 갈린다.
//
// 왜 '9월분'이 아니라 '9월'인가 — 귀속월 어휘('분')가 뜻으로는 더 정확하지만 10.5px 에서 9.08px 을
// 더 먹고, 그 9px 이 320px 폭(글자 70.67px)에서 절단을 만든다. 실측 "12월분 132.9만" 71.23px 부.
// 월세 132.9만은 상용화 대상(원룸·오피스텔)에서 흔한 값이라, '분'을 쓰면 같은 방이 9월엔 멀쩡하고
// 10월엔 잘리는 달 의존 절단이 된다. "12월 999.9만" 62.16px 까지 무절단인 쪽을 쓴다.
// 잘린 값은 없는 값보다 나쁘다(lib/leaseStatus checkoutDateLabel 이 D-day 를 뗀 것과 같은 판단).
export function fmtOfferRentAhead(month: string, rent: number): string {
  return `${Number(month.slice(5))}월 ${fmtManShort(rent)}`
}

// 예약 이용료가 언제부터 청구되는가 — '9월분부터'. 호실 상세·호실 카드가 이 한 문장을 같이 쓴다.
//
// 왜 달인가 — fmtOfferRentAhead 와 같은 이유다. effectiveBaseRent 가 `mon >= 적용월` 이라 적용일이
// 9/20 이어도 9월분 청구는 전부 인상가고, 선납해도 인상가다(운영자 확정 규칙). 두 화면이 종전에
// "(2026-09-20 적용)"·"(2026.09.20)" 으로 일 단위를 말해, 엔진이 지키지 않는 약속을 적고 있었다.
// 운영자 혼동의 뿌리라고 패널 2인이 독립으로 지적한 자리다(2026-08-12).
//
// 왜 여기는 '분'을 쓰고 홈 타일(fmtOfferRentAhead)은 안 쓰는가 — 폭이다. 타일은 밴드가 68px 이라
// '분' 9px 이 절단을 만들지만(위 주석의 실측), 이 두 자리는 카드 꼬리 158px·모달 값 칸 172px 이라
// 여유가 있다. 그래서 정본 귀속월 어휘 'N월분'(할인 위젯·수납 유예·fmtNoBillCovered 가 쓰는 그 말)을
// 그대로 쓴다. '부터'를 붙이는 것도 같은 이유다 — 그 달 하나가 아니라 그 달 이후 전부이므로,
// 떼면 과소 진술이 된다. 타일이 '부터'를 못 쓰는 것은 밴드 안에서 입주 가능일의 '부터'와 겹치기 때문이다.
//
// 해가 넘어가면 4자리 연도를 앞에 붙인다 — '2027년 1월분부터'. 안 붙이면 지난 1월로 읽힌다.
// 기준 '지금'은 KST 정본(kstMonthStr)이다. new Date() 로 연도를 뽑으면 서버(UTC)와 기기(KST)가
// 연말 09시 창에서 다른 해를 봐 하이드레이션이 갈린다.
export function fmtRentApplyFrom(month: string, nowMonth: string = kstMonthStr()): string {
  const yearPrefix = month.slice(0, 4) === nowMonth.slice(0, 4) ? '' : `${month.slice(0, 4)}년 `
  return `${yearPrefix}${Number(month.slice(5))}월분부터`
}

// 청구 없는 달의 '그 달을 덮은 수납' 캡션 — '7월분 7/7 수납 470,000원'.
// 수납관리 카드·표, 수납 모달 3카드, 고객정보 요약 네 곳이 같은 문구를 써야 해서 여기로 모았다.
// 귀속월을 반드시 앞에 붙인다. '총 수납 0원' 밑에 금액만 있으면 이번 달 수납으로 읽힌다.
export function fmtNoBillCovered(
  args: { month?: string | null; date?: string | null; amount?: number | null },
): string | null {
  if (!args.amount) return null
  const mon = args.month ? `${Number(args.month.slice(5))}월분 ` : ''
  if (!args.date) return `${mon}${fmtWon(args.amount)} 수납됨`
  return `${mon}${Number(args.date.slice(5, 7))}/${Number(args.date.slice(8))} 수납 ${fmtWon(args.amount)}`
}
