// 한국식 금액 표기 — 가독성 우선
//   1만 미만: 콤마 + '원' (예: 5,000원 / 9,999원)
//   1만 이상: 억/만/천 단위만 표기, 백·십·원 단위는 절삭
//     예) 14,930,000 → "1,493만원"
//         7,879,615  → "787만9천원" (절사 615)
//         150,000,000 → "1억5,000만원"
//         28,500     → "2만8천원" (절사 500)
//   원본 정확한 금액이 필요한 곳(영수증·잔액 정산 등)은 toLocaleString 사용 권장.
export function fmtKorMoney(n: number, opts: { zero?: string } = {}): string {
  const r = Math.round(n)
  if (r === 0) return opts.zero ?? '0원'
  const sign = r < 0 ? '-' : ''
  const abs = Math.abs(r)

  // 1만 미만 — 콤마 형태로 (절사 시 정보 손실이 큼)
  if (abs < 10_000) return sign + abs.toLocaleString() + '원'

  // 1만 이상 — 억/만/천 단위로 (백·십·원 단위 절삭)
  const eok = Math.floor(abs / 100_000_000)
  const restAfterEok = abs % 100_000_000
  const man = Math.floor(restAfterEok / 10_000)
  const cheon = Math.floor((restAfterEok % 10_000) / 1000)

  const parts: string[] = []
  if (eok > 0) parts.push(`${eok.toLocaleString()}억`)
  if (man > 0) parts.push(`${man.toLocaleString()}만`)
  if (cheon > 0) parts.push(`${cheon}천`)

  if (parts.length === 0) return sign + abs.toLocaleString() + '원'
  return sign + parts.join('') + '원'
}
