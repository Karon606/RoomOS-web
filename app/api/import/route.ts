import { canEdit } from '@/lib/role'
import { deleteExpense } from '@/app/(app)/finance/actions'
import { getPropertyAccess } from '@/lib/auth/propertyAccess'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { getRoomNoSnapshot } from '@/lib/requestRoomSnapshot'
import { ensureOpenStay, closeStay, isStayTerminalStatus } from '@/lib/roomStay'
import { isVacancyExcluded } from '@/lib/vacancy'
import { primaryTenantLease } from '@/lib/leaseStatus'
import { roomAssignmentBlockReason, ROOM_GUARD_STATUSES } from '@/lib/roomAssignment'
import * as XLSX from 'xlsx'
import { LeaseStatus } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'

type SheetResult = { imported: number; skipped: number; errors: string[] }
type Resolutions = Record<string, string>  // conflictId → 'overwrite' | 'keep' | 'archive'

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

const WINDOW_MAP: Record<string, string> = {
  '외창': 'OUTER', '내창': 'INNER',
  'OUTER': 'OUTER', 'INNER': 'INNER',
  'WINDOW': 'OUTER', 'NO_WINDOW': 'INNER',
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

function parseDay(val: unknown): number | null {
  const s = str(val)
  if (!s) return null
  if (s.includes('말')) return 31
  const n = parseInt(s.replace(/[^0-9]/g, ''))
  return isNaN(n) ? null : n
}

function fmtDate(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : ''
}

function sheetToRows(wb: XLSX.WorkBook, name: string): Record<string, unknown>[] {
  const ws = wb.Sheets[name]
  if (!ws) return []
  return XLSX.utils.sheet_to_json(ws, { defval: '' })
}

// ── 시트별 임포트 ────────────────────────────────────────────────

async function importRooms(rows: Record<string, unknown>[], propertyId: string, resolutions: Resolutions): Promise<SheetResult> {
  const result: SheetResult = { imported: 0, skipped: 0, errors: [] }
  for (const row of rows) {
    const roomNo = str(row['호실번호'])
    if (!roomNo) { result.skipped++; continue }
    try {
      const data = {
        type:       str(row['타입']) || null,
        baseRent:   parseNum(row['기본이용료']),
        windowType: WINDOW_MAP[str(row['채광'])] || null,
        direction:  DIRECTION_MAP[str(row['방향'])] || null,
        areaPyeong: row['면적(평)'] ? parseNum(row['면적(평)']) : null,
        areaM2:     row['면적(㎡)'] ? parseNum(row['면적(㎡)']) : null,
        memo:       str(row['메모']) || null,
      }

      const existing = await prisma.room.findUnique({
        where: { propertyId_roomNo: { propertyId, roomNo } },
      })

      if (existing) {
        const isExact =
          existing.type                  === data.type &&
          existing.baseRent              === data.baseRent &&
          (existing.windowType ?? null)  === data.windowType &&
          (existing.direction  ?? null)  === data.direction &&
          (existing.areaPyeong ?? null)  === data.areaPyeong &&
          (existing.areaM2     ?? null)  === data.areaM2 &&
          (existing.memo       ?? null)  === data.memo
        if (isExact) { result.skipped++; continue }

        const resolution = resolutions[`room:${roomNo}`] ?? 'keep'
        if (resolution === 'keep') { result.skipped++; continue }
        await prisma.room.update({ where: { id: existing.id }, data })
      } else {
        await prisma.room.create({ data: { ...data, propertyId, roomNo, isVacant: true } })
      }
      result.imported++
    } catch (e) {
      result.errors.push(`${roomNo}호: ${(e as Error).message}`)
    }
  }
  return result
}

async function importTenants(rows: Record<string, unknown>[], propertyId: string, resolutions: Resolutions): Promise<SheetResult> {
  const result: SheetResult = { imported: 0, skipped: 0, errors: [] }
  for (const row of rows) {
    const name = str(row['이름'])
    if (!name) { result.skipped++; continue }
    try {
      const existing = await prisma.tenant.findFirst({
        where: { propertyId, name },
        include: {
          // take: 1 을 뺐다 — 시트 한 줄이 덮을 계약은 정렬이 고른 아무 계약이 아니라 메인 계약이다.
          // 방을 둘 쓰는 사람에게 이용료·보증금을 창고 계약에 쓰는 사고를 막는다.
          leaseTerms: {
            where: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
            include: { room: { select: { id: true, roomNo: true } } },
          },
        },
      })

      if (existing) {
        const activeLease  = primaryTenantLease(existing.leaseTerms)
        const existingRoom = activeLease?.room?.roomNo ?? null
        const inRoomNo     = str(row['호실']) || null
        const inStatus     = inRoomNo ? (STATUS_MAP[str(row['계약상태'])] ?? 'ACTIVE') : null

        const isExact =
          (existing.englishName  ?? null)                === (str(row['영문명']) || null) &&
          fmtDate(existing.birthdate)                    === fmtDate(parseDate(row['생년월일'])) &&
          (existing.gender as string)                    === (GENDER_MAP[str(row['성별'])] ?? 'UNKNOWN') &&
          (existing.nationality  ?? null)                === (str(row['국적']) || null) &&
          (existing.job          ?? null)                === (str(row['직업']) || null) &&
          (existing.memo         ?? null)                === (str(row['메모']) || null) &&
          existingRoom                                   === inRoomNo &&
          ((activeLease?.status ?? null) as string|null) === inStatus &&
          (activeLease?.rentAmount    ?? 0)              === parseNum(row['이용료']) &&
          (activeLease?.depositAmount ?? 0)              === parseNum(row['보증금']) &&
          (activeLease?.cleaningFee   ?? 0)              === parseNum(row['청소비']) &&
          (activeLease?.dueDay        ?? null)           === (str(row['납부일']) || null) &&
          (activeLease?.payMethod     ?? null)           === (str(row['납부방법']) || null) &&
          fmtDate(activeLease?.moveInDate      ?? null)  === fmtDate(parseDate(row['입실일'])) &&
          fmtDate(activeLease?.expectedMoveOut ?? null)  === fmtDate(parseDate(row['퇴실 예정일']))
        if (isExact) { result.skipped++; continue }

        const resolution = resolutions[`tenant:${name}`] ?? 'keep'

        if (resolution === 'keep') { result.skipped++; continue }

        if (resolution === 'archive') {
          const activeLease = primaryTenantLease(existing.leaseTerms)
          if (activeLease) {
            await prisma.leaseTerm.update({
              where: { id: activeLease.id },
              data: { status: 'CHECKED_OUT', moveOutDate: new Date() },
            })
            // 거주 구간 이력 — 보관 처리(퇴실 확정)면 열린 구간을 퇴실일로 마감(추가 write).
            await closeStay(prisma, activeLease.id)
            if (activeLease.room?.id) {
              await prisma.room.update({
                where: { id: activeLease.room.id },
                data: { isVacant: true },
              })
            }
          }
          await createTenantAndLease(row, propertyId, result)
          continue
        }

        if (resolution === 'overwrite') {
          await prisma.tenant.update({
            where: { id: existing.id },
            data: {
              englishName: str(row['영문명']) || null,
              birthdate:   parseDate(row['생년월일']),
              gender:      (GENDER_MAP[str(row['성별'])] as any) ?? existing.gender,
              nationality: str(row['국적']) || null,
              job:         str(row['직업']) || null,
              memo:        str(row['메모']) || null,
            },
          })
          const activeLease = primaryTenantLease(existing.leaseTerms)
          if (activeLease && row['이용료']) {
            // 시트에 칸이 **없으면 미변경**이다. parseNum 은 빈칸을 0 으로 환원하므로,
            // 이용료 칸만 채운 시트를 올리면 기존 보증금·청소비가 0 으로 파괴적 갱신됐다(2026-08-02 조사).
            // 계약서 URL 이 이미 formData.has() 로 같은 방어를 하고 있다. 그 문법에 맞춘다.
            const has = (k: string) => k in row && String(row[k] ?? '').trim() !== ''
            await prisma.leaseTerm.update({
              where: { id: activeLease.id },
              data: {
                rentAmount:    parseNum(row['이용료']),
                ...(has('보증금') ? { depositAmount: parseNum(row['보증금']) } : {}),
                ...(has('청소비') ? { cleaningFee:   parseNum(row['청소비']) } : {}),
                dueDay:        str(row['납부일']) || null,
                payMethod:     str(row['납부방법']) || null,
              },
            })
          }
          result.imported++
          continue
        }
      }

      await createTenantAndLease(row, propertyId, result)
    } catch (e) {
      result.errors.push(`${name}: ${(e as Error).message}`)
    }
  }
  return result
}

/**
 * 방 배정 점유 가드 — 화면 경로(addTenant·updateTenant)와 같은 정본 판정(lib/roomAssignment)을 시트에도 건다.
 *
 * 종전에는 여기 가드가 문자 그대로 0 개였다. 거주자 이중 배정도, 415호 같은 비거주 점유 방 배정도
 * 전부 통과했고, 통과한 뒤 isVacant:false 덮어쓰기가 비거주 점유 표시까지 지웠다(2026-08-12 봉합).
 *
 * 겹침은 화면에서는 확인창이 묻는 운영 재량이지만 시트에는 물어볼 자리가 없다 — 묻지 못하면 거절하고
 * 실패 목록에 세워, 운영자가 시트를 고쳐 다시 올리게 한다. 막을 이유가 없으면 null.
 */
async function roomAssignmentBlock(
  room: { id: string; nonResidentVacant: boolean },
  status: string,
  moveIn: Date | null,
  moveOut: Date | null,
): Promise<string | null> {
  const leases = await prisma.leaseTerm.findMany({
    where: { roomId: room.id, status: { in: [...ROOM_GUARD_STATUSES] as LeaseStatus[] } },
    select: { status: true, moveInDate: true, expectedMoveOut: true, tenant: { select: { name: true } } },
  })
  return roomAssignmentBlockReason({
    incoming: { status, moveIn: fmtDate(moveIn) || null, moveOut: fmtDate(moveOut) || null },
    nonResidentOccupied: isVacancyExcluded(room),
    others: leases.map(l => ({
      status: l.status,
      moveIn: fmtDate(l.moveInDate) || null,
      moveOut: fmtDate(l.expectedMoveOut) || null,
      tenantName: l.tenant.name,
    })),
  })
}

async function createTenantAndLease(row: Record<string, unknown>, propertyId: string, result: SheetResult) {
  const name = str(row['이름'])
  const roomNo = str(row['호실'])
  const room = roomNo ? await prisma.room.findUnique({
    where: { propertyId_roomNo: { propertyId, roomNo } },
  }) : null

  // 방을 배정하는 유일한 자리다 — 아무것도 만들기 전에 먼저 묻는다. 뒤에서 막으면 주인 없는
  // 고객 정보만 남는다(덮어쓰기 갈래는 방을 옮기지 않으므로 이 가드의 대상이 아니다).
  if (room) {
    const status = (STATUS_MAP[str(row['계약상태'])] as string) ?? 'ACTIVE'
    const blocked = await roomAssignmentBlock(room, status, parseDate(row['입실일']), parseDate(row['퇴실 예정일']))
    if (blocked) {
      result.skipped++
      result.errors.push(`${name} (${roomNo}호): ${blocked}`)
      return
    }
  }

  const tenant = await prisma.tenant.create({
    data: {
      propertyId,
      name,
      englishName:      str(row['영문명']) || null,
      birthdate:        parseDate(row['생년월일']),
      gender:           (GENDER_MAP[str(row['성별'])] as any) ?? 'UNKNOWN',
      nationality:      str(row['국적']) || null,
      job:              str(row['직업']) || null,
      memo:             str(row['메모']) || null,
      isBasicRecipient: false,
    },
  })

  const contact = str(row['연락처'])
  if (contact) {
    await prisma.tenantContact.create({
      data: { tenantId: tenant.id, contactType: 'PHONE', contactValue: contact, isPrimary: true, isEmergency: false },
    })
  }
  const emergency = str(row['비상연락처'])
  if (emergency) {
    await prisma.tenantContact.create({
      data: {
        tenantId: tenant.id, contactType: 'PHONE', contactValue: emergency,
        isPrimary: false, isEmergency: true,
        emergencyRelation: str(row['비상연락처관계']) || null,
      },
    })
  }

  if (room) {
    const status = (STATUS_MAP[str(row['계약상태'])] as any) ?? 'ACTIVE'
    await prisma.leaseTerm.create({
      data: {
        propertyId,
        tenantId:        tenant.id,
        roomId:          room.id,
        status,
        rentAmount:      parseNum(row['이용료']),
        depositAmount:   parseNum(row['보증금']),
        cleaningFee:     parseNum(row['청소비']),
        dueDay:          str(row['납부일']) || null,
        payMethod:       str(row['납부방법']) || null,
        moveInDate:      parseDate(row['입실일']),
        expectedMoveOut: parseDate(row['퇴실 예정일']),
      },
    })
    if (['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'].includes(status)) {
      await prisma.room.update({ where: { id: room.id }, data: { isVacant: false } })
    }
    // 거주 구간 이력 — 임포트로 만든 계약도 열린 구간을 남긴다(종료 상태면 바로 마감, 추가 write).
    const newLease = await prisma.leaseTerm.findFirst({
      where: { tenantId: tenant.id }, orderBy: { createdAt: 'desc' }, select: { id: true },
    })
    if (newLease) {
      await ensureOpenStay(prisma, newLease.id)
      if (isStayTerminalStatus(status)) await closeStay(prisma, newLease.id)
    }
  }

  result.imported++
}

async function importExpenses(rows: Record<string, unknown>[], propertyId: string, resolutions: Resolutions): Promise<SheetResult> {
  const result: SheetResult = { imported: 0, skipped: 0, errors: [] }
  for (const row of rows) {
    const date     = parseDate(row['날짜'])
    const category = str(row['카테고리'])
    const amount   = parseNum(row['금액'])
    if (!date || !category || !amount) { result.skipped++; continue }
    try {
      const detail = str(row['세부항목']) || null

      // 완전 동일 항목은 자동 건너뜀
      const exactMatch = await prisma.expense.findFirst({
        where: { propertyId, date, category, amount, detail },
      })
      if (exactMatch) { result.skipped++; continue }

      const existing = await prisma.expense.findFirst({
        where: { propertyId, date, category, amount },
      })

      if (existing) {
        const resolution = resolutions[`expense:${existing.id}`] ?? 'keep'
        if (resolution === 'keep') { result.skipped++; continue }
        // 정본 삭제 경로 재사용(감사 잔여, 2026-07-22) — 직접 delete는 주문 묶음 고아·수령 자동점검
        // 정리를 건너뛰어 배송비 라인·빈 주문이 남았다. deleteExpense가 스코프 검증·정리를 일괄 수행.
        const del = await deleteExpense(existing.id)
        if (!del.ok) { result.errors.push(`${category} ${amount}: 기존 항목 교체 실패(${del.error})`); continue }
      }

      const payMethod = str(row['결제수단']) || '계좌이체'
      await prisma.expense.create({
        data: {
          propertyId, date, category, amount,
          detail,
          memo:        str(row['메모']) || null,
          payMethod,
          settleStatus: payMethod === '신용카드' ? 'UNSETTLED' : 'SETTLED',
        },
      })
      result.imported++
    } catch (e) {
      result.errors.push(`${category} ${amount}: ${(e as Error).message}`)
    }
  }
  return result
}

async function importIncomes(rows: Record<string, unknown>[], propertyId: string, resolutions: Resolutions): Promise<SheetResult> {
  const result: SheetResult = { imported: 0, skipped: 0, errors: [] }
  for (const row of rows) {
    const date     = parseDate(row['날짜'])
    const category = str(row['카테고리'])
    const amount   = parseNum(row['금액'])
    if (!date || !category || !amount) { result.skipped++; continue }
    try {
      const detail = str(row['세부항목']) || null

      // 완전 동일 항목은 자동 건너뜀
      const exactMatch = await prisma.extraIncome.findFirst({
        where: { propertyId, date, category, amount, detail },
      })
      if (exactMatch) { result.skipped++; continue }

      const existing = await prisma.extraIncome.findFirst({
        where: { propertyId, date, category, amount },
      })

      if (existing) {
        const resolution = resolutions[`income:${existing.id}`] ?? 'keep'
        if (resolution === 'keep') { result.skipped++; continue }
        await prisma.extraIncome.delete({ where: { id: existing.id } })
      }

      await prisma.extraIncome.create({
        data: {
          propertyId, date, category, amount,
          detail,
          memo:      str(row['메모']) || null,
          payMethod: str(row['입금수단']) || '계좌이체',
        },
      })
      result.imported++
    } catch (e) {
      result.errors.push(`${category} ${amount}: ${(e as Error).message}`)
    }
  }
  return result
}

async function importRequests(rows: Record<string, unknown>[], propertyId: string): Promise<SheetResult> {
  const result: SheetResult = { imported: 0, skipped: 0, errors: [] }
  for (const row of rows) {
    const tenantName = str(row['입주자명'])
    const content    = str(row['내용'])
    const date       = parseDate(row['작성일'])
    if (!tenantName || !content || !date) { result.skipped++; continue }
    try {
      const tenant = await prisma.tenant.findFirst({ where: { propertyId, name: tenantName } })
      if (!tenant) { result.skipped++; continue }

      const exactMatch = await prisma.tenantRequest.findFirst({
        where: { propertyId, tenantId: tenant.id, requestDate: date, content, deletedAt: null },
      })
      if (exactMatch) { result.skipped++; continue }

      const resolvedRaw = str(row['처리여부'])
      const resolvedAt  = resolvedRaw === '완료' ? (parseDate(row['해결일']) ?? new Date()) : parseDate(row['해결일'])

      await prisma.tenantRequest.create({
        data: {
          propertyId,
          tenantId:    tenant.id,
          content,
          requestDate: date,
          targetDate:  parseDate(row['처리예정일']),
          resolvedAt,
          roomNoSnapshot: await getRoomNoSnapshot(tenant.id),
        },
      })
      result.imported++
    } catch (e) {
      result.errors.push(`${tenantName} (${str(row['작성일'])}): ${(e as Error).message}`)
    }
  }
  return result
}

async function importSettings(rows: Record<string, unknown>[], propertyId: string, resolutions: Resolutions): Promise<SheetResult> {
  const result: SheetResult = { imported: 0, skipped: 0, errors: [] }
  for (const row of rows) {
    const brand = str(row['금융사'])
    if (!brand) { result.skipped++; continue }
    try {
      const type = (ACCOUNT_TYPE_MAP[str(row['타입'])] as any) ?? 'BANK_ACCOUNT'
      const alias = str(row['별칭']) || null
      const data = {
        type, brand, alias,
        identifier: str(row['계좌/카드번호']) || null,
        owner:      str(row['소유자']) || null,
        payDay:     parseDay(row['결제일']),
        cutOffDay:  parseDay(row['마감일']),
      }
      const existing = await prisma.financialAccount.findFirst({
        where: { propertyId, brand, alias: alias ?? undefined },
      })
      if (existing) {
        const isExact =
          (existing.type as string)       === data.type &&
          (existing.identifier ?? null)   === data.identifier &&
          (existing.owner      ?? null)   === data.owner &&
          (existing.payDay     ?? null)   === data.payDay &&
          (existing.cutOffDay  ?? null)   === data.cutOffDay
        if (isExact) { result.skipped++; continue }

        const resolution = resolutions[`setting:${existing.id}`] ?? 'keep'
        if (resolution === 'keep') { result.skipped++; continue }
        await prisma.financialAccount.update({ where: { id: existing.id }, data })
      } else {
        await prisma.financialAccount.create({ data: { ...data, propertyId } })
      }
      result.imported++
    } catch (e) {
      result.errors.push(`${brand}: ${(e as Error).message}`)
    }
  }
  return result
}

// ── 메인 핸들러 ──────────────────────────────────────────────────

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

  const resolutionsRaw = formData.get('resolutions') as string | null
  const resolutions: Resolutions = resolutionsRaw ? JSON.parse(resolutionsRaw) : {}

  const buffer = Buffer.from(await file.arrayBuffer())
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true })

  const results: Record<string, SheetResult> = {}

  if (wb.SheetNames.includes('호실관리'))
    results['호실관리'] = await importRooms(sheetToRows(wb, '호실관리'), propertyId, resolutions)

  if (wb.SheetNames.includes('입주자관리'))
    results['입주자관리'] = await importTenants(sheetToRows(wb, '입주자관리'), propertyId, resolutions)

  if (wb.SheetNames.includes('퇴실자')) {
    const r = await importTenants(sheetToRows(wb, '퇴실자'), propertyId, resolutions)
    if (results['입주자관리']) {
      results['입주자관리'].imported += r.imported
      results['입주자관리'].skipped  += r.skipped
      results['입주자관리'].errors.push(...r.errors)
    } else {
      results['퇴실자'] = r
    }
  }

  if (wb.SheetNames.includes('지출'))
    results['지출'] = await importExpenses(sheetToRows(wb, '지출'), propertyId, resolutions)

  // '부가수익'이 정본 시트명(2026-08-12 통일). 옛 내보내기 파일의 '기타수익' 시트도 계속 받는다.
  for (const incomeSheet of ['부가수익', '기타수익']) {
    if (!wb.SheetNames.includes(incomeSheet)) continue
    results[incomeSheet] = await importIncomes(sheetToRows(wb, incomeSheet), propertyId, resolutions)
    break
  }

  if (wb.SheetNames.includes('요청사항'))
    results['요청사항'] = await importRequests(sheetToRows(wb, '요청사항'), propertyId)

  if (wb.SheetNames.includes('설정'))
    results['설정'] = await importSettings(sheetToRows(wb, '설정'), propertyId, resolutions)

  return NextResponse.json(results)
}
