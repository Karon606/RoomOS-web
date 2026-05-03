export const TRACKED_CATEGORIES = ['부식비', '소모품비', '폐기물 처리비'] as const

export type InventoryRow = {
  id: string
  category: string
  label: string
  specUnit: string | null
  qtyUnit: string | null
  alertThresholdDays: number
  reorderMemo: string | null
  isArchived: boolean
  lastCheckDate: Date | null
  lastRemainingQty: number | null
  currentStock: number | null
  avgDaily: number | null
  daysUntilEmpty: number | null
  lastPeriodConsumption: number | null
  lastPeriodDays: number | null
  avgUnitPrice: number | null   // 최근 12개월 구매 평균 단가 (원/qtyUnit)
  lastUnitPrice: number | null  // 가장 최근 구매의 단가
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

export type TimelineEntry =
  | { type: 'check';    id: string; date: Date; remainingQty: number; memo: string | null }
  | { type: 'purchase'; id: string; date: Date; qtyValue: number; qtyUnit: string | null; specValue: number | null; specUnit: string | null; amount: number; vendor: string | null; memo: string | null }
  | { type: 'addition'; id: string; date: Date; addedQty: number; source: string | null; memo: string | null }
