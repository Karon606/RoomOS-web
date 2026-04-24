export type RoomConflict = {
  id: string
  sheet: 'rooms'
  roomNo: string
  existing: { type: string | null; baseRent: number; windowType: string | null }
  incoming: { type: string | null; baseRent: number; windowType: string | null }
}

export type TenantConflict = {
  id: string
  sheet: 'tenants'
  name: string
  incomingRoom: string | null
  existingRoom: string | null
  sameRoom: boolean
  existingStatus: string | null
}

export type ExpenseConflict = {
  id: string
  sheet: 'expenses'
  existingId: string
  date: string
  category: string
  amount: number
  detail: string | null
}

export type IncomeConflict = {
  id: string
  sheet: 'incomes'
  existingId: string
  date: string
  category: string
  amount: number
  detail: string | null
}

export type SettingConflict = {
  id: string
  sheet: 'settings'
  existingId: string
  brand: string
  alias: string | null
  existing: { type: string; identifier: string | null; owner: string | null }
  incoming: { type: string; identifier: string | null; owner: string | null }
}

export type Conflict = RoomConflict | TenantConflict | ExpenseConflict | IncomeConflict | SettingConflict

export type PreviewResult = {
  conflicts: Conflict[]
  hasPaymentSheet: boolean
  hasRequestSheet: boolean
  counts: {
    rooms:    { new: number; conflict: number }
    tenants:  { new: number; conflict: number }
    expenses: { new: number; conflict: number; autoSkipped: number }
    incomes:  { new: number; conflict: number; autoSkipped: number }
    settings: { new: number; conflict: number }
  }
}
