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

export type Conflict = RoomConflict | TenantConflict | ExpenseConflict | IncomeConflict

export type PreviewResult = {
  conflicts: Conflict[]
  counts: {
    rooms:    { new: number; conflict: number }
    tenants:  { new: number; conflict: number }
    expenses: { new: number; conflict: number }
    incomes:  { new: number; conflict: number }
    settings: { new: number }
  }
}
