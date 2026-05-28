export const TRACKED_CATEGORIES = ['부식비', '소모품비', '폐기물 처리비'] as const

export type PendingPurchase = {
  id: string
  date: Date
  qtyValue: number
  specValue: number | null
  specUnit: string | null
  qtyUnit: string | null
  amount: number
  vendor: string | null
  memo: string | null
}

export type InventoryRow = {
  id: string
  category: string
  label: string
  specUnit: string | null
  qtyUnit: string | null
  alertThresholdDays: number
  reorderMemo: string | null
  purchaseUrl: string | null       // 구매 링크 (쿠팡·아마존 등)
  memo: string | null              // 재고 파악 기준 등 자유 메모
  trackUnit: 'spec' | 'qty'        // 'spec' = qty×spec 환산 (쌀, 물티슈), 'qty' = qty만 (폐기물 봉투)
  isArchived: boolean
  lastCheckId: string | null
  lastCheckDate: Date | null
  lastCheckCreatedAt: Date | null
  lastRemainingQty: number | null
  currentStock: number | null
  avgDaily: number | null
  daysUntilEmpty: number | null
  lastPeriodConsumption: number | null
  lastPeriodDays: number | null
  avgUnitPrice: number | null   // 최근 12개월 구매 평균 단가 (원/qtyUnit)
  lastUnitPrice: number | null  // 가장 최근 구매의 단가
  pendingPurchases: PendingPurchase[]  // 수령 대기 중인 구매 내역
  locations: StorageLocationItem[]    // 이 품목이 보관되는 위치 목록
  lastCheckLocationBreakdown: LocationQtyEntry[]  // 최신 실사의 위치별 잔량
}

export type PricePoint = {
  date: Date
  unitPrice: number    // amount / qtyValue
  qty: number
  amount: number
}

export type MonthlyInflowRow = {
  month: string                // "YYYY-MM"
  purchaseQty: number
  additionQty: number
  totalQty: number
  purchaseAmount: number
}

export type StorageLocationItem = {
  id: string
  name: string
  sortOrder: number
  isHub: boolean
}

export type LocationQtyEntry = {
  locationId: string
  locationName: string
  qty: number               // "보충 후" 잔량
  restockedQty?: number     // 이 점검에서 이 위치에 보충한 양 ("전" = qty - restockedQty)
  fromHubQty?: number       // (레거시) 명시적 이동 유입 수량
  fromLocationId?: string   // (레거시) 이동 유입 출처
}

// 영수증→재고 자동등록 시, 새 라벨에 대한 병합 후보(기존 카드)
export type MergeCandidate = { itemId: string; label: string }
// 사용자 확인이 필요한 병합 결정 — 새 라벨 + 후보 카드들
export type MergeDecision = {
  newLabel: string          // 새로 만들려던 라벨
  category: string
  expenseIds: string[]      // 이 결정에 묶인 지출들
  specUnit: string | null
  qtyUnit: string | null
  candidates: MergeCandidate[]
}
// 병합 규칙 (관리 UI용) — LINK: 추천 연결 / MUTE: 추천 안 함(거절 기억)
export type MergeRuleRow = {
  id: string
  category: string
  sourceLabel: string
  kind: 'LINK' | 'MUTE'
  targetItemId: string
  targetLabel: string | null   // 대상 카드가 삭제됐으면 null
}

export type TimelineEntry =
  | { type: 'check';    id: string; date: Date; createdAt: Date; remainingQty: number; memo: string | null; locationBreakdown: LocationQtyEntry[]; isHub?: boolean }
  | { type: 'purchase'; id: string; date: Date; createdAt: Date; qtyValue: number; qtyUnit: string | null; specValue: number | null; specUnit: string | null; amount: number; vendor: string | null; memo: string | null; receivedAt: Date | null; receivedLocationName: string | null }
  | { type: 'addition'; id: string; date: Date; createdAt: Date; addedQty: number; source: string | null; memo: string | null; storageLocationId: string | null; storageLocationName: string | null }
