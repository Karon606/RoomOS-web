// 생년월일 숫자 연속 입력 순수함수 — 8자리 숫자를 "YYYY.MM.DD" 로 자동 포맷·검증·ISO 변환.
// 서명 게이트(독립 인라인 스타일)와 입주자 폼(BirthdateInput)이 UI 는 각자 두되 이 로직만 공유한다.

// 입력에서 숫자만 추려 8자리로 자른다.
function onlyDigits(raw: string): string {
  return (raw ?? '').replace(/\D/g, '').slice(0, 8)
}

// 타이핑 중 표시용 부분 포맷 — 완성 전에도 자연스럽게 점을 끼운다.
//  "1970"     → "1970"
//  "197009"   → "1970.09"
//  "19700928" → "1970.09.28"
export function formatBirthdateDigits(raw: string): string {
  const d = onlyDigits(raw)
  if (d.length <= 4) return d
  if (d.length <= 6) return `${d.slice(0, 4)}.${d.slice(4)}`
  return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}`
}

// 8자리 + 월 1~12 + 일 1~31 을 만족하는지. (월별 일수는 스펙 범위 밖 — 느슨한 검증)
export function isValidBirthdate(raw: string): boolean {
  const d = onlyDigits(raw)
  if (d.length !== 8) return false
  const mm = Number(d.slice(4, 6))
  const dd = Number(d.slice(6, 8))
  return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31
}

// 유효한 8자리면 "YYYY-MM-DD"(ISO), 아니면 null. 점 포맷·ISO·부분 입력 모두 허용해 정규화 용도로 쓴다.
export function digitsToIso(raw: string): string | null {
  const d = onlyDigits(raw)
  if (!isValidBirthdate(d)) return null
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
}
