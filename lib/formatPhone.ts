/**
 * 숫자 문자열을 한국 전화번호 형식으로 포맷
 * 02-XXXX-XXXX / 010-XXXX-XXXX 등
 */
export function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 11)
  if (!digits) return ''

  if (digits.startsWith('02')) {
    if (digits.length <= 2) return digits
    if (digits.length <= 5)  return `${digits.slice(0, 2)}-${digits.slice(2)}`
    if (digits.length <= 9)  return `${digits.slice(0, 2)}-${digits.slice(2, digits.length - 4)}-${digits.slice(-4)}`
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}`
  }

  // 3자리 지역번호 (010, 011, 031 …)
  if (digits.length <= 3)  return digits
  if (digits.length <= 6)  return `${digits.slice(0, 3)}-${digits.slice(3)}`
  if (digits.length <= 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`
}
