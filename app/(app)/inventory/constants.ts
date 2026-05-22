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

export type TimelineEntry =
  | { type: 'check';    id: string; date: Date; createdAt: Date; remainingQty: number; memo: string | null; locationBreakdown: LocationQtyEntry[]; isHub?: boolean }
  | { type: 'purchase'; id: string; date: Date; createdAt: Date; qtyValue: number; qtyUnit: string | null; specValue: number | null; specUnit: string | null; amount: number; vendor: string | null; memo: string | null; receivedAt: Date | null; receivedLocationName: string | null }
  | { type: 'addition'; id: string; date: Date; createdAt: Date; addedQty: number; source: string | null; memo: string | null; storageLocationId: string | null; storageLocationName: string | null }
