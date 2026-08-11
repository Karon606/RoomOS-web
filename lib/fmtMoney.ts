// 한국식 금액 표기 — N만M원 (절삭 없음, 원 단위까지 정확 표기)
//   1만 미만: 콤마 + '원' (예: 5,000원 / 9,999원)
//   1만 이상: 만 단위 앞, 나머지는 그대로
//     예) 262,500  → "26만2500원"
//         2,543,100 → "254만3100원"
//         400,000   → "40만원"
//         39,000    → "3만9000원"
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
