import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import * as XLSX from 'xlsx'
import { NextRequest, NextResponse } from 'next/server'
import type { RoomConflict, TenantConflict, ExpenseConflict, IncomeConflict, SettingConflict, Conflict, PreviewResult } from '@/lib/import-types'

export type { RoomConflict, TenantConflict, ExpenseConflict, IncomeConflict, SettingConflict, Conflict, PreviewResult }

// ── 헬퍼 ────────────────────────────────────────────────────────

function parseDate(val: unknown): Date | null {
  if (!val) return null
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val
  if (typeof val === 'number') {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000))
    return isNaN(d.getTime()) ? null : d
  }
  const s = String(val).trim()
  if (!s) return null
  const m = s.match(/(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/)
  if (m) {
    const d = new Date(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`)
    return isNaN(d.getTime()) ? null : d
  }
  return null
}

function parseNum(val: unknown): number {
  if (typeof val === 'number') return val
  const n = Number(String(val ?? '').replace(/[^0-9.]/g, ''))
  return isNaN(n) ? 0 : n
}

function str(val: unknown): string {
  return val == null ? '' : String(val).trim()
}

function fmtDate(d: Date | null): string {
  if (!d) return ''
  return d.toISOString().slice(0, 10)
}

function sheetToRows(wb: XLSX.WorkBook, name: string): Record<string, unknown>[] {
  const ws = wb.Sheets[name]
  if (!ws) return []
  return XLSX.utils.sheet_to_json(ws, { defval: '' })
}

// ── 시트별 충돌 감지 ─────────────────────────────────────────────

async function previewRooms(rows: Record<string, unknown>[], propertyId: string) {
  const conflicts: RoomConflict[] = []
  let newCount = 0

  for (const row of rows) {
    const roomNo = str(row['호실번호'])
    if (!roomNo) continue

    const existing = await prisma.room.findUnique({
      where: { propertyId_roomNo: { propertyId, roomNo } },
    })

    if (existing) {
      conflicts.push({
        id: `room:${roomNo}`,
        sheet: 'rooms',
        roomNo,
        existing: { type: existing.type, baseRent: existing.baseRent, windowType: existing.windowType },
        incoming: {
          type: str(row['타입']) || null,
          baseRent: parseNum(row['기본이용료']),
          windowType: str(row['채광']) || null,
        },
      })
    } else {
      newCount++
    }
  }

  return { conflicts, newCount }
}

async function previewTenants(rows: Record<string, unknown>[], propertyId: string) {
  const conflicts: TenantConflict[] = []
  let newCount = 0

  for (const row of rows) {
    const name = str(row['이름'])
    if (!name) continue

    const existing = await prisma.tenant.findFirst({
      where: { propertyId, name },
      include: {
        leaseTerms: {
          where: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
          include: { room: { select: { roomNo: true } } },
          take: 1,
        },
      },
    })

    if (existing) {
      const incomingRoom = str(row['호실']) || null
      const existingRoom = existing.leaseTerms[0]?.room.roomNo ?? null
      conflicts.push({
        id: `tenant:${name}`,
        sheet: 'tenants',
        name,
        incomingRoom,
        existingRoom,
        sameRoom: !!incomingRoom && incomingRoom === existingRoom,
        existingStatus: existing.leaseTerms[0]?.status ?? null,
      })
    } else {
      newCount++
    }
  }

  return { conflicts, newCount }
}

async function previewExpenses(rows: Record<string, unknown>[], propertyId: string) {
  const conflicts: ExpenseConflict[] = []
  let newCount = 0
  let autoSkipped = 0

  for (const row of rows) {
    const date = parseDate(row['날짜'])
    const category = str(row['카테고리'])
    const amount = parseNum(row['금액'])
    if (!date || !category || !amount) continue

    const detail = str(row['세부항목']) || null

    // 완전 동일 항목(날짜+카테고리+금액+세부항목)은 자동 건너뜀
    const exactMatch = await prisma.expense.findFirst({
      where: { propertyId, date, category, amount, detail },
    })
    if (exactMatch) { autoSkipped++; continue }

    // 부분 일치(날짜+카테고리+금액만 같고 세부항목 다름)는 충돌
    const existing = await prisma.expense.findFirst({
      where: { propertyId, date, category, amount },
    })

    if (existing) {
      conflicts.push({
        id: `expense:${existing.id}`,
        sheet: 'expenses',
        existingId: existing.id,
        date: fmtDate(date),
        category,
        amount,
        detail,
      })
    } else {
      newCount++
    }
  }

  return { conflicts, newCount, autoSkipped }
}

async function previewIncomes(rows: Record<string, unknown>[], propertyId: string) {
  const conflicts: IncomeConflict[] = []
  let newCount = 0
  let autoSkipped = 0

  for (const row of rows) {
    const date = parseDate(row['날짜'])
    const category = str(row['카테고리'])
    const amount = parseNum(row['금액'])
    if (!date || !category || !amount) continue

    const detail = str(row['세부항목']) || null

    // 완전 동일 항목은 자동 건너뜀
    const exactMatch = await prisma.extraIncome.findFirst({
      where: { propertyId, date, category, amount, detail },
    })
    if (exactMatch) { autoSkipped++; continue }

    const existing = await prisma.extraIncome.findFirst({
      where: { propertyId, date, category, amount },
    })

    if (existing) {
      conflicts.push({
        id: `income:${existing.id}`,
        sheet: 'incomes',
        existingId: existing.id,
        date: fmtDate(date),
        category,
        amount,
        detail,
      })
    } else {
      newCount++
    }
  }

  return { conflicts, newCount, autoSkipped }
}

async function previewRequests(rows: Record<string, unknown>[], propertyId: string) {
  let newCount = 0
  let autoSkipped = 0
  let noTenant = 0

  for (const row of rows) {
    const tenantName = str(row['입주자명'])
    const content    = str(row['내용'])
    const date       = parseDate(row['작성일'])
    if (!tenantName || !content || !date) continue

    const tenant = await prisma.tenant.findFirst({ where: { propertyId, name: tenantName } })
    if (!tenant) { noTenant++; continue }

    const exactMatch = await prisma.tenantRequest.findFirst({
      where: { propertyId, tenantId: tenant.id, requestDate: date, content },
    })
    if (exactMatch) { autoSkipped++; continue }

    newCount++
  }

  return { newCount, autoSkipped, noTenant }
}

async function previewSettings(rows: Record<string, unknown>[], propertyId: string) {
  const conflicts: SettingConflict[] = []
  let newCount = 0

  for (const row of rows) {
    const brand = str(row['금융사'])
    if (!brand) continue
    const alias = str(row['별칭']) || null

    const existing = await prisma.financialAccount.findFirst({
      where: { propertyId, brand, alias: alias ?? undefined },
    })

    if (existing) {
      conflicts.push({
        id: `setting:${existing.id}`,
        sheet: 'settings',
        existingId: existing.id,
        brand,
        alias,
        existing: { type: existing.type, identifier: existing.identifier, owner: existing.owner },
        incoming: {
          type: str(row['타입']) || 'BANK_ACCOUNT',
          identifier: str(row['계좌/카드번호']) || null,
          owner: str(row['소유자']) || null,
        },
      })
    } else {
      newCount++
    }
  }

  return { conflicts, newCount }
}

// ── 핸들러 ──────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const cookieStore = await cookies()
  const propertyId = cookieStore.get('selected_property_id')?.value
  if (!propertyId) return NextResponse.json({ error: 'No property' }, { status: 400 })

  const hasAccess = await prisma.userPropertyRole.findFirst({
    where: { userId: user.id, propertyId, role: { in: ['OWNER', 'MANAGER'] } },
  })
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

  const buffer = Buffer.from(await file.arrayBuffer())
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true })

  const allConflicts: Conflict[] = []
  const counts: PreviewResult['counts'] = {
    rooms:    { new: 0, conflict: 0 },
    tenants:  { new: 0, conflict: 0 },
    expenses: { new: 0, conflict: 0, autoSkipped: 0 },
    incomes:  { new: 0, conflict: 0, autoSkipped: 0 },
    settings: { new: 0, conflict: 0 },
    requests: { new: 0, autoSkipped: 0, noTenant: 0 },
  }

  if (wb.SheetNames.includes('호실관리')) {
    const { conflicts, newCount } = await previewRooms(sheetToRows(wb, '호실관리'), propertyId)
    allConflicts.push(...conflicts)
    counts.rooms = { new: newCount, conflict: conflicts.length }
  }

  if (wb.SheetNames.includes('입주자관리')) {
    const { conflicts, newCount } = await previewTenants(sheetToRows(wb, '입주자관리'), propertyId)
    allConflicts.push(...conflicts)
    counts.tenants = { new: newCount, conflict: conflicts.length }
  }

  if (wb.SheetNames.includes('퇴실자')) {
    const { conflicts, newCount } = await previewTenants(sheetToRows(wb, '퇴실자'), propertyId)
    allConflicts.push(...conflicts)
    counts.tenants = {
      new: counts.tenants.new + newCount,
      conflict: counts.tenants.conflict + conflicts.length,
    }
  }

  if (wb.SheetNames.includes('지출')) {
    const { conflicts, newCount, autoSkipped } = await previewExpenses(sheetToRows(wb, '지출'), propertyId)
    allConflicts.push(...conflicts)
    counts.expenses = { new: newCount, conflict: conflicts.length, autoSkipped }
  }

  if (wb.SheetNames.includes('기타수익')) {
    const { conflicts, newCount, autoSkipped } = await previewIncomes(sheetToRows(wb, '기타수익'), propertyId)
    allConflicts.push(...conflicts)
    counts.incomes = { new: newCount, conflict: conflicts.length, autoSkipped }
  }

  if (wb.SheetNames.includes('설정')) {
    const { conflicts, newCount } = await previewSettings(sheetToRows(wb, '설정'), propertyId)
    allConflicts.push(...conflicts)
    counts.settings = { new: newCount, conflict: conflicts.length }
  }

  if (wb.SheetNames.includes('요청사항')) {
    const { newCount, autoSkipped, noTenant } = await previewRequests(sheetToRows(wb, '요청사항'), propertyId)
    counts.requests = { new: newCount, autoSkipped, noTenant }
  }

  const hasPaymentSheet = wb.SheetNames.includes('수납현황')

  return NextResponse.json({ conflicts: allConflicts, counts, hasPaymentSheet } satisfies PreviewResult)
}
