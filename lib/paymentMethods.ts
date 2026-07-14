// 결제·입금 수단 공용 상수 — 수납(PaymentEntryForm)·부가수익(IncomeSection) 공유.
// 기존 저장값 합집합(계좌이체·현금·신용카드·보유 보증금·기타)이라 옵션에서 사라지는 값이 없다.
// 저장되는 문자열 값은 기존과 동일 — 충당·정산 로직 불변.
export const PAYMENT_METHODS = ['계좌이체', '현금', '신용카드', '결제선생', '보유 보증금', '기타'] as const

// 카드 계열 수단 — 카드 수납 합계 등 집계에서 신용카드와 동일 취급(운영자 지시 2026-07-14).
// 결제선생 = 카드 정기결제 대행 서비스.
export const CARD_LIKE_METHODS: readonly string[] = ['신용카드', '결제선생']
