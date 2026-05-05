// 한국식 금액 표기 — 천 백 십 원 단위까지 모두 표시 (반올림 왜곡 방지)
// 예) 263,500 → "26만3천5백원" / 100,500 → "10만5백원" / 50 → "50원"
export function fmtKorMoney(n: number, opts: { zero?: string } = {}): string {
  const r = Math.round(n)
  if (r === 0) return opts.zero ?? '0원'
  const sign = r < 0 ? '-' : ''
  let abs = Math.abs(r)

  // 1000원 미만은 그대로 (5십원, 5십5원 같은 어색한 표기 회피)
  if (abs < 1000) return sign + abs.toLocaleString() + '원'

  const eok = Math.floor(abs / 100_000_000)
  abs = abs % 100_000_000
  const man = Math.floor(abs / 10_000)
  let rem = abs % 10_000
  const cheon = Math.floor(rem / 1000); rem = rem % 1000
  const baek  = Math.floor(rem / 100);  rem = rem % 100
  const sip   = Math.floor(rem / 10);   rem = rem % 10
  const won   = rem

  const parts: string[] = []
  if (eok > 0) parts.push(`${eok.toLocaleString()}억`)
  if (man > 0) parts.push(`${man.toLocaleString()}만`)
  if (cheon > 0) parts.push(`${cheon}천`)
  if (baek > 0)  parts.push(`${baek}백`)
  if (sip > 0)   parts.push(`${sip}십`)
  if (won > 0)   parts.push(`${won}`)

  return sign + parts.join('') + '원'
}
