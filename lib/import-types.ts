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
  /**
   * 입실 때 청소비를 이미 받았는데 시트의 보증금이 저장값과 다른 입주자 수(2026-08-10).
   * 청소비가 보증금 안의 몫인 영업장에서는 그 몫이 두 번 잡히는 길이라 미리 알린다. 차단은 하지 않는다.
   */
  cleaningDepositWarn: number
  counts: {
    rooms:    { new: number; conflict: number; autoSkipped: number }
    tenants:  { new: number; conflict: number; autoSkipped: number }
    expenses: { new: number; conflict: number; autoSkipped: number }
    incomes:  { new: number; conflict: number; autoSkipped: number }
    settings: { new: number; conflict: number; autoSkipped: number }
    requests: { new: number; autoSkipped: number; noTenant: number }
  }
}
