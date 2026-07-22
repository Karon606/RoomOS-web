// 사업자등록번호 정규화·표시 포맷 순수 함수 — 서버(저장·정규화)와 클라(입력 중 자동 하이픈)가 공유

// 저장용 정규화 — 숫자만 추출해 10자리면 000-00-00000 로 포맷, 아니면 null(빈 값·잘못된 길이).
export function normalizeBizNo(raw: string | null | undefined): string | null {
  const digits = String(raw ?? '').replace(/[^0-9]/g, '')
  if (digits.length !== 10) return null
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`
}

// 입력 중 표시 포맷 — 숫자만 남겨 10자리까지, 채워지는 만큼 3-2-5 로 하이픈을 넣는다(normalizeBizNo 와 짝).
export function formatBizNoInput(raw: string): string {
  const d = String(raw ?? '').replace(/[^0-9]/g, '').slice(0, 10)
  if (d.length <= 3) return d
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`
}
