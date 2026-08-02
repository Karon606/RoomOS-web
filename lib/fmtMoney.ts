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
