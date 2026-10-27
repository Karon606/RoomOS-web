// 지출 결제수단 선택지와 결제 계정 표시명 정본(순수). 화면(지출 폼·작업·청소 폼)과 서버(작업·청소 결제수단 기본값)가 함께 쓴다.
//
// 종전에는 고정지출 기록 모달(app/(app)/finance/RecurringExpenseRecordModal.tsx, 'use client')에 있었다. 작업·청소 완료가
// 결제수단을 묻게 되면서(2026-10-27 운영자 지적) 서버도 같은 목록의 첫 값을 기본값으로 써야 해, 클라이언트 모듈 밖으로 옮겼다.
// 모달은 이 두 함수를 다시 내보내므로 종전 import 자리는 그대로다.

/** 계좌 표시명. 별칭이 있으면 '브랜드 (별칭)'. 지출의 financeName 칸에 적히는 글자다. */
export function accName(a: { brand: string; alias: string | null } | null) {
  if (!a) return ''
  return a.alias ? `${a.brand} (${a.alias})` : a.brand
}

/** 영업장 결제수단 목록에 등록된 선불 계정 브랜드를 자동으로 더한 선택지. 지출 폼 공통 파생. */
export function effectivePayMethods(
  paymentMethods: string[],
  accounts: { type: string; brand: string; alias: string | null }[],
) {
  const methods = [...paymentMethods]
  for (const acc of accounts.filter(a => a.type === 'PREPAID')) {
    const name = acc.brand ?? accName(acc)
    if (name && !methods.includes(name)) methods.push(name)
  }
  return methods
}

/** 이 결제수단이 고를 계정의 종류. 계좌이체는 통장, 카드는 카드, 선불 브랜드는 그 선불 계정. 없으면 null(계정을 안 묻는다). */
export function accountTypesFor(payMethod: string, accounts: { type: string; brand: string; alias: string | null }[]): string[] | null {
  if (payMethod === '계좌이체') return ['BANK_ACCOUNT']
  if (payMethod === '신용카드' || payMethod === '체크카드') return ['CREDIT_CARD', 'DEBIT_CARD']
  if (accounts.some(a => a.type === 'PREPAID' && (a.brand === payMethod || accName(a) === payMethod))) return ['PREPAID']
  return null
}
