// 결제·입금 수단 공용 상수 — 수납(PaymentEntryForm)·부가수익(IncomeSection) 공유.
// 기존 저장값 합집합(계좌이체·현금·신용카드·보유 보증금·기타)이라 옵션에서 사라지는 값이 없다.
// 저장되는 문자열 값은 기존과 동일 — 충당·정산 로직 불변.
export const PAYMENT_METHODS = ['계좌이체', '현금', '신용카드', '보유 보증금', '기타'] as const
