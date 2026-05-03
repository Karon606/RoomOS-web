export const TRACKED_CATEGORIES = ['부식비', '소모품비', '폐기물 처리비'] as const

export type InventoryRow = {
  id: string
  category: string
  label: string
  specUnit: string | null
  qtyUnit: string | null
  isArchived: boolean
  lastCheckDate: Date | null
  lastRemainingQty: number | null
  currentStock: number | null
  avgDaily: number | null
  daysUntilEmpty: number | null
  lastPeriodConsumption: number | null
  lastPeriodDays: number | null
}

export type TimelineEntry =
  | { type: 'check';    id: string; date: Date; remainingQty: number; memo: string | null }
  | { type: 'purchase'; id: string; date: Date; qtyValue: number; qtyUnit: string | null; amount: number; vendor: string | null; memo: string | null }
  | { type: 'addition'; id: string; date: Date; addedQty: number; source: string | null; memo: string | null }
