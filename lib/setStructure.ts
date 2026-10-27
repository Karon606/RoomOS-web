// 규격으로 이미 나뉜 세트(규격 N개)를 비품에서 개수로 환산할지 묻기 위한 순수 판정·산식 — 지출 등록·홈 승인 공용
//
// 왜 있나(2026-10-27 독립 검수 B1). 영수증 프롬프트가 '40개 묶음 x 4' 를 규격 40개 · 수량 4 로 나눠 주게 되자(신고 bc5bae0c),
// 세트 의심(lib/setHint computeSetHint)은 '규격이 이미 있으면 되묻지 않는다' 첫 줄 때문에 서지 않는다. 소모품은 그것이 맞다(재고
// 수학이 규격 곱이다). 그러나 비품은 수량이 곧 개수·방 배정 단위라, '의자 4개 세트 x 1' 이 의자 1개로 저장된다(신고 91b812ce 의
// 비품 세트 확인창이 안 뜬다). 그래서 비품이면 규격 N개(단위 '개', N ≥ 2)를 세트 확인 대상으로 삼는다. 영수증에서 온 품목만이다
// (손으로 적은 규격·지난 저장 행을 수정 때마다 다시 묻지 않는다).
export function specSetCount(it: { specValue?: string | number | null; specUnit?: string | null }): number | null {
  const v = Number(it.specValue)
  return (it.specUnit ?? '').trim() === '개' && Number.isInteger(v) && v >= 2 && v <= 200 ? v : null
}

/** 비품 세트 개수 환산 — 수량 × N 개, 개당 단가 = 금액 ÷ 새 수량(총액 불변). */
export function durableSetCount(qtyValue: string | number | null | undefined, count: number, amount: number | null | undefined): { qty: number; unitPrice: number | null } {
  const qty = (Number(qtyValue) || 1) * count
  return { qty, unitPrice: amount != null ? Math.round(amount / qty) : null }
}
