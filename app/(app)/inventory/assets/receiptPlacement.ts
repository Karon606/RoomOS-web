// 비품 수령의 판정 순수층(소모품 거부). 'use server' 아님. 진리표는 scripts/test-asset-receipt.ts.
//
// 왜 뺐나. 서버 액션(assets/actions)은 async 함수만 내보낼 수 있어 그 안의 판정에 진리표가 못 붙는다
// (scripts/check-server-action-exports). aggregate.ts·lineage.ts 와 같은 배치다.

// ── S1 소모품 거부 ─────────────────────────────────────────────────────
// 비품 화면의 수령 버튼은 비품 모집단(durableExpenseWhere)에 든 행만 그린다. 그런데 화면을 연 뒤 다른
// 탭에서 카테고리를 소모품으로 바꾸면 그 id 가 그대로 날아온다. true 쪽은 자동 점검 없이 receivedAt 만
// 찍혀 유령수령이 되고, false 쪽은 자동 점검을 남긴 채 receivedAt 만 지워 다시 받을 때 입고가 두 번 잡힌다
// (cancelReceiptCore 우회 뒷문). 소모품 수령은 재고 화면의 정본(confirmReceipt) 한 길뿐이다.
export const ASSET_RECEIPT_DENY_TRACKED = '소모품으로 바뀐 품목입니다. 새로고침한 뒤 재고 화면에서 수령해 주세요.'
// 비품 모집단 밖인데 소모품도 아닌 행(지워졌거나 배송비·서비스로 바뀐 행). 어느 쪽이든 화면이 낡았다.
export const ASSET_RECEIPT_DENY_STALE = '비품 목록이 바뀌었습니다. 새로고침한 뒤 다시 시도해 주세요.'

export type ReceiptGateRow = { id: string; category: string }

/**
 * 비품 수령(받음·수령 대기로) 거부 판정. 통과면 null.
 * @param found      요청 id 중 이 영업장에서 찾은 행(카테고리와 함께)
 * @param inPopulation 그중 비품 모집단(durableExpenseWhere)에 든 id
 */
export function assetReceiptDenial(
  requestedIds: string[], found: ReceiptGateRow[], inPopulation: Set<string>, trackedCats: string[],
): string | null {
  const ids = [...new Set(requestedIds)]
  if (found.some(r => trackedCats.includes(r.category))) return ASSET_RECEIPT_DENY_TRACKED
  if (found.length !== ids.length || ids.some(id => !inPopulation.has(id))) return ASSET_RECEIPT_DENY_STALE
  return null
}
