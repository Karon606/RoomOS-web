import { canEdit } from '@/lib/role'
import { getPropertyAccess } from '@/lib/auth/propertyAccess'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import * as XLSX from 'xlsx'
import { NextRequest, NextResponse } from 'next/server'
import type { RoomConflict, TenantConflict, ExpenseConflict, IncomeConflict, SettingConflict, Conflict, PreviewResult } from '@/lib/import-types'
import { CLEANING_FEE_RECEIVED_WHERE } from '@/lib/incomeCategories'
import { isVacancyExcluded } from '@/lib/vacancy'
import { roomAssignmentBlockReason, ROOM_GUARD_STATUSES, type RoomAssignmentOccupant } from '@/lib/roomAssignment'
import { LeaseStatus } from '@prisma/client'

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

function parseDay(val: unknown): number | null {
  const s = str(val)
  if (!s) return null
  if (s.includes('말')) return 31
  const n = parseInt(s.replace(/[^0-9]/g, ''))
  return isNaN(n) ? null : n
}

const WINDOW_MAP: Record<string, string> = {
  '외창': 'OUTER', '내창': 'INNER', 'OUTER': 'OUTER', 'INNER': 'INNER',
}
const DIRECTION_MAP: Record<string, string> = {
  '동': 'EAST', '서': 'WEST', '남': 'SOUTH', '북': 'NORTH',
  '남동': 'SOUTHEAST', '남서': 'SOUTHWEST', '북동': 'NORTHEAST', '북서': 'NORTHWEST',
  'EAST': 'EAST', 'WEST': 'WEST', 'SOUTH': 'SOUTH', 'NORTH': 'NORTH',
  'SOUTHEAST': 'SOUTHEAST', 'SOUTHWEST': 'SOUTHWEST', 'NORTHEAST': 'NORTHEAST', 'NORTHWEST': 'NORTHWEST',
}
const GENDER_MAP: Record<string, string> = {
  '남': 'MALE', '여': 'FEMALE', '기타': 'OTHER', 'MALE': 'MALE', 'FEMALE': 'FEMALE',
}
// 적용 경로(app/api/import/route.ts)의 STATUS_MAP 과 같은 표여야 한다 — 종전에는 '비거주'만 여기 없어서
// 미리보기가 명의 계약을 거주중으로 읽었고, 그래서 바뀔 것이 없는 행도 늘 변경 충돌로 섰다.
const STATUS_MAP: Record<string, string> = {
  '거주중': 'ACTIVE', '입실예정': 'RESERVED', '퇴실예정': 'CHECKOUT_PENDING',
  '퇴실': 'CHECKED_OUT', '취소': 'CANCELLED', '비거주': 'NON_RESIDENT',
  'ACTIVE': 'ACTIVE', 'RESERVED': 'RESERVED', 'CHECKOUT_PENDING': 'CHECKOUT_PENDING',
  'CHECKED_OUT': 'CHECKED_OUT', 'CANCELLED': 'CANCELLED', 'NON_RESIDENT': 'NON_RESIDENT',
}
const ACCOUNT_TYPE_MAP: Record<string, string> = {
  '은행계좌': 'BANK_ACCOUNT', '신용카드': 'CREDIT_CARD', '체크카드': 'CHECK_CARD', '기타': 'OTHER',
  'BANK_ACCOUNT': 'BANK_ACCOUNT', 'CREDIT_CARD': 'CREDIT_CARD', 'CHECK_CARD': 'CHECK_CARD', 'OTHER': 'OTHER',
}

// ── 시트별 충돌 감지 ─────────────────────────────────────────────

async function previewRooms(rows: Record<string, unknown>[], propertyId: string) {
  const conflicts: RoomConflict[] = []
  let newCount = 0
  let autoSkipped = 0

  for (const row of rows) {
    const roomNo = str(row['호실번호'])
    if (!roomNo) continue

    const existing = await prisma.room.findUnique({
      where: { propertyId_roomNo: { propertyId, roomNo } },
    })

    if (existing) {
      const inType       = str(row['타입']) || null
      const inBaseRent   = parseNum(row['기본이용료'])
      const inWindowType = WINDOW_MAP[str(row['채광'])] || null
      const inDirection  = DIRECTION_MAP[str(row['방향'])] || null
      const inAreaPy     = row['면적(평)'] ? parseNum(row['면적(평)']) : null
      const inAreaM2     = row['면적(㎡)'] ? parseNum(row['면적(㎡)']) : null
      const inMemo       = str(row['메모']) || null

      const isExact =
        existing.type       === inType &&
        existing.baseRent   === inBaseRent &&
        (existing.windowType ?? null) === inWindowType &&
        (existing.direction  ?? null) === inDirection &&
        (existing.areaPyeong ?? null) === inAreaPy &&
        (existing.areaM2     ?? null) === inAreaM2 &&
        (existing.memo       ?? null) === inMemo

      if (isExact) { autoSkipped++; continue }

      conflicts.push({
        id: `room:${roomNo}`,
        sheet: 'rooms',
        roomNo,
        existing: { type: existing.type, baseRent: existing.baseRent, windowType: existing.windowType },
        incoming: { type: inType, baseRent: inBaseRent, windowType: str(row['채광']) || null },
      })
    } else {
      newCount++
    }
  }

  return { conflicts, newCount, autoSkipped }
}

/**
 * 이 행이 만들 계약이 방 배정 가드에 막히는가 — 적용 경로와 같은 정본 판정(lib/roomAssignment).
 *
 * `pendingByRoom` 은 같은 파일에서 이 행보다 앞선 행이 그 방에 넣기로 한 계약이다. 적용은 행을
 * 차례로 저장하므로 두 번째 행은 첫 행이 만든 계약과 부딪힌다 — 그 순서를 여기서도 재현하지 않으면
 * 미리보기가 통과라 말한 파일이 적용에서 실패한다. 막히지 않은 행만 뒤 행의 입력으로 쌓는다.
 */
async function previewRoomBlock(
  row: Record<string, unknown>,
  name: string,
  propertyId: string,
  pendingByRoom: Map<string, RoomAssignmentOccupant[]>,
): Promise<{ roomNo: string; reason: string } | null> {
  const roomNo = str(row['호실'])
  if (!roomNo) return null
  const room = await prisma.room.findUnique({
    where: { propertyId_roomNo: { propertyId, roomNo } },
    select: { id: true, nonResidentVacant: true },
  })
  // 방이 시트에만 있고 아직 없으면 계약도 안 만들어진다 — 막을 배정 자체가 없다.
  if (!room) return null

  const dbLeases = await prisma.leaseTerm.findMany({
    where: { roomId: room.id, status: { in: [...ROOM_GUARD_STATUSES] as LeaseStatus[] } },
    select: { status: true, moveInDate: true, expectedMoveOut: true, tenant: { select: { name: true } } },
  })
  const pending = pendingByRoom.get(room.id) ?? []
  const others: RoomAssignmentOccupant[] = [
    ...dbLeases.map(l => ({
      status: l.status as string,
      moveIn: fmtDate(l.moveInDate) || null,
      moveOut: fmtDate(l.expectedMoveOut) || null,
      tenantName: l.tenant.name,
    })),
    ...pending,
  ]
  const incoming = {
    status: STATUS_MAP[str(row['계약상태'])] ?? 'ACTIVE',
    moveIn: fmtDate(parseDate(row['입실일'])) || null,
    moveOut: fmtDate(parseDate(row['퇴실 예정일'])) || null,
  }
  const reason = roomAssignmentBlockReason({
    incoming,
    // 앞선 행이 얹은 명의도 센다 — 적용은 그 계약을 이미 저장한 뒤에 이 행을 만난다.
    nonResidentOccupied: isVacancyExcluded(room),
    others,
  })
  if (reason) return { roomNo, reason }
  pendingByRoom.set(room.id, [...pending, { ...incoming, tenantName: name }])
  return null
}

async function previewTenants(
  rows: Record<string, unknown>[],
  propertyId: string,
  pendingByRoom: Map<string, RoomAssignmentOccupant[]>,
) {
  const conflicts: TenantConflict[] = []
  const roomBlocked: PreviewResult['roomBlocked'] = []
  let newCount = 0
  let autoSkipped = 0
  // 입실 청소비를 이미 받았는데 시트 보증금이 저장값과 다른 건 — 청소비가 보증금 안의 몫인 영업장에서는
  // 그 몫이 두 번 잡히는 길이다. 미리 알리기만 하고 막지 않는다(2026-08-10).
  let cleaningDepositWarn = 0

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
      const activeLease  = existing.leaseTerms[0]
      const existingRoom = activeLease?.room?.roomNo ?? null

      const inEnglishName = str(row['영문명']) || null
      const inGender      = (GENDER_MAP[str(row['성별'])] ?? 'UNKNOWN') as string
      const inNationality = str(row['국적']) || null
      const inJob         = str(row['직업']) || null
      const inMemo        = str(row['메모']) || null
      const inStatus      = incomingRoom ? (STATUS_MAP[str(row['계약상태'])] ?? 'ACTIVE') : null
      const inRent        = parseNum(row['이용료'])
      const inDeposit     = parseNum(row['보증금'])
      const inCleaning    = parseNum(row['청소비'])
      const inDueDay      = str(row['납부일']) || null
      const inPayMethod   = str(row['납부방법']) || null
      const inMoveIn      = fmtDate(parseDate(row['입실일']))
      const inMoveOut     = fmtDate(parseDate(row['퇴실 예정일']))

      const isExact =
        (existing.englishName  ?? null)               === inEnglishName &&
        fmtDate(existing.birthdate ?? null)            === fmtDate(parseDate(row['생년월일'])) &&
        (existing.gender as string)                    === inGender &&
        (existing.nationality  ?? null)                === inNationality &&
        (existing.job          ?? null)                === inJob &&
        (existing.memo         ?? null)                === inMemo &&
        existingRoom                                   === incomingRoom &&
        ((activeLease?.status ?? null) as string|null) === inStatus &&
        (activeLease?.rentAmount    ?? 0)              === inRent &&
        (activeLease?.depositAmount ?? 0)              === inDeposit &&
        (activeLease?.cleaningFee   ?? 0)              === inCleaning &&
        (activeLease?.dueDay        ?? null)           === inDueDay &&
        (activeLease?.payMethod     ?? null)           === inPayMethod &&
        fmtDate(activeLease?.moveInDate      ?? null)  === inMoveIn &&
        fmtDate(activeLease?.expectedMoveOut ?? null)  === inMoveOut

      if (isExact) { autoSkipped++; continue }

      if ((activeLease?.depositAmount ?? 0) !== inDeposit) {
        const cleaning = await prisma.extraIncome.aggregate({
          where: { propertyId, tenantId: existing.id, ...CLEANING_FEE_RECEIVED_WHERE, deletedAt: null },
          _sum: { amount: true },
        })
        if ((cleaning._sum.amount ?? 0) > 0) cleaningDepositWarn++
      }

      conflicts.push({
        id: `tenant:${name}`,
        sheet: 'tenants',
        name,
        incomingRoom,
        existingRoom,
        sameRoom: !!incomingRoom && incomingRoom === existingRoom,
        existingStatus: activeLease?.status ?? null,
      })
    } else {
      newCount++
      // 새 고객 행은 반드시 방 배정이 일어난다 — 적용 전에 막힐 행을 미리 지목한다.
      // 기존 고객 행은 처리 방법(유지·덮어쓰기·퇴실→신규)에 따라 배정 여부가 갈려 아직 단정할 수 없다.
      const blocked = await previewRoomBlock(row, name, propertyId, pendingByRoom)
      if (blocked) roomBlocked.push({ name, ...blocked })
    }
  }

  return { conflicts, newCount, autoSkipped, cleaningDepositWarn, roomBlocked }
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
      where: { propertyId, tenantId: tenant.id, requestDate: date, content, deletedAt: null },
    })
    if (exactMatch) { autoSkipped++; continue }

    newCount++
  }

  return { newCount, autoSkipped, noTenant }
}

async function previewSettings(rows: Record<string, unknown>[], propertyId: string) {
  const conflicts: SettingConflict[] = []
  let newCount = 0
  let autoSkipped = 0

  for (const row of rows) {
    const brand = str(row['금융사'])
    if (!brand) continue
    const alias = str(row['별칭']) || null

    const existing = await prisma.financialAccount.findFirst({
      where: { propertyId, brand, alias: alias ?? undefined },
    })

    if (existing) {
      const inType       = ACCOUNT_TYPE_MAP[str(row['타입'])] || 'BANK_ACCOUNT'
      const inIdentifier = str(row['계좌/카드번호']) || null
      const inOwner      = str(row['소유자']) || null
      const inPayDay     = parseDay(row['결제일'])
      const inCutOffDay  = parseDay(row['마감일'])

      const isExact =
        (existing.type as string)         === inType &&
        (existing.identifier ?? null)     === inIdentifier &&
        (existing.owner      ?? null)     === inOwner &&
        (existing.payDay     ?? null)     === inPayDay &&
        (existing.cutOffDay  ?? null)     === inCutOffDay

      if (isExact) { autoSkipped++; continue }

      conflicts.push({
        id: `setting:${existing.id}`,
        sheet: 'settings',
        existingId: existing.id,
        brand,
        alias,
        existing: { type: existing.type, identifier: existing.identifier, owner: existing.owner },
        incoming: {
          type: inType,
          identifier: inIdentifier,
          owner: inOwner,
        },
      })
    } else {
      newCount++
    }
  }

  return { conflicts, newCount, autoSkipped }
}

// ── 핸들러 ──────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await getPropertyAccess()
  if (!access || !canEdit(access.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const propertyId = access.propertyId

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

  const buffer = Buffer.from(await file.arrayBuffer())
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true })

  const allConflicts: Conflict[] = []
  const counts: PreviewResult['counts'] = {
    rooms:    { new: 0, conflict: 0, autoSkipped: 0 },
    tenants:  { new: 0, conflict: 0, autoSkipped: 0 },
    expenses: { new: 0, conflict: 0, autoSkipped: 0 },
    incomes:  { new: 0, conflict: 0, autoSkipped: 0 },
    settings: { new: 0, conflict: 0, autoSkipped: 0 },
    requests: { new: 0, autoSkipped: 0, noTenant: 0 },
  }

  if (wb.SheetNames.includes('호실관리')) {
    const { conflicts, newCount, autoSkipped } = await previewRooms(sheetToRows(wb, '호실관리'), propertyId)
    allConflicts.push(...conflicts)
    counts.rooms = { new: newCount, conflict: conflicts.length, autoSkipped }
  }

  let cleaningDepositWarn = 0
  const roomBlocked: PreviewResult['roomBlocked'] = []
  // 두 시트를 한 파일로 적용하므로 앞선 배정 누적은 시트를 가로질러 이어져야 한다.
  const pendingByRoom = new Map<string, RoomAssignmentOccupant[]>()

  if (wb.SheetNames.includes('입주자관리')) {
    const r = await previewTenants(sheetToRows(wb, '입주자관리'), propertyId, pendingByRoom)
    allConflicts.push(...r.conflicts)
    counts.tenants = { new: r.newCount, conflict: r.conflicts.length, autoSkipped: r.autoSkipped }
    cleaningDepositWarn += r.cleaningDepositWarn
    roomBlocked.push(...r.roomBlocked)
  }

  if (wb.SheetNames.includes('퇴실자')) {
    const r = await previewTenants(sheetToRows(wb, '퇴실자'), propertyId, pendingByRoom)
    allConflicts.push(...r.conflicts)
    counts.tenants = {
      new: counts.tenants.new + r.newCount,
      conflict: counts.tenants.conflict + r.conflicts.length,
      autoSkipped: counts.tenants.autoSkipped + r.autoSkipped,
    }
    cleaningDepositWarn += r.cleaningDepositWarn
    roomBlocked.push(...r.roomBlocked)
  }

  if (wb.SheetNames.includes('지출')) {
    const { conflicts, newCount, autoSkipped } = await previewExpenses(sheetToRows(wb, '지출'), propertyId)
    allConflicts.push(...conflicts)
    counts.expenses = { new: newCount, conflict: conflicts.length, autoSkipped }
  }

  // '부가수익'이 정본 시트명(2026-08-12 통일). 옛 내보내기 파일의 '기타수익' 시트도 계속 받는다.
  const incomeSheetName = wb.SheetNames.includes('부가수익') ? '부가수익' : wb.SheetNames.includes('기타수익') ? '기타수익' : null
  if (incomeSheetName) {
    const { conflicts, newCount, autoSkipped } = await previewIncomes(sheetToRows(wb, incomeSheetName), propertyId)
    allConflicts.push(...conflicts)
    counts.incomes = { new: newCount, conflict: conflicts.length, autoSkipped }
  }

  if (wb.SheetNames.includes('설정')) {
    const { conflicts, newCount, autoSkipped } = await previewSettings(sheetToRows(wb, '설정'), propertyId)
    allConflicts.push(...conflicts)
    counts.settings = { new: newCount, conflict: conflicts.length, autoSkipped }
  }

  if (wb.SheetNames.includes('요청사항')) {
    const { newCount, autoSkipped, noTenant } = await previewRequests(sheetToRows(wb, '요청사항'), propertyId)
    counts.requests = { new: newCount, autoSkipped, noTenant }
  }

  const hasPaymentSheet = wb.SheetNames.includes('수납현황')

  return NextResponse.json({ conflicts: allConflicts, counts, hasPaymentSheet, cleaningDepositWarn, roomBlocked } satisfies PreviewResult)
}
