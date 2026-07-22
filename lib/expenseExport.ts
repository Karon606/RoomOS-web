// 지출 내보내기 공용 헬퍼 — API 엑셀 라우트와 서버 액션(옵션 조회)이 같은 카드·계좌 그룹 키 정의를 쓰도록 단일 소스로 둔다.

type AccountBrief = { brand: string; alias: string | null } | null | undefined

// 금융계좌 표시명 — 별칭 있으면 'brand(alias)', 없으면 brand.
export function fmtAccount(acc: AccountBrief): string {
  if (!acc) return ''
  return acc.alias ? `${acc.brand}(${acc.alias})` : acc.brand
}

// 지출 카드·계좌별 그룹 키 — '카드/계좌' 열과 동일 표시값(financeName || 계좌표시), 없으면 결제수단명, 그것도 없으면 '미지정'.
export function expenseAccountKey(e: {
  financeName: string | null
  financialAccount: AccountBrief
  payMethod: string | null
}): string {
  const name = e.financeName || fmtAccount(e.financialAccount)
  if (name) return name
  if (e.payMethod) return e.payMethod
  return '미지정'
}
