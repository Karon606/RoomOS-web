import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import * as XLSX from 'xlsx'
import { NextRequest, NextResponse } from 'next/server'
import { WindowType, Direction } from '@prisma/client'

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
        windowType: (WINDOW_MAP[str(row['채광'])] as WindowType) || null,
        direction:  (DIRECTION_MAP[str(row['방향'])] as Direction) || null,
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
          leaseTerms: {
            where: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
            include: { room: { select: { id: true, roomNo: true } } },
            take: 1,
          },
        },
      })

      if (existing) {
        const activeLease  = existing.leaseTerms[0]
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
          const activeLease = existing.leaseTerms[0]
          if (activeLease) {
            await prisma.leaseTerm.update({
              where: { id: activeLease.id },
              data: { status: 'CHECKED_OUT', moveOutDate: new Date() },
            })
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
          const activeLease = existing.leaseTerms[0]
          if (activeLease && row['이용료']) {
            await prisma.leaseTerm.update({
              where: { id: activeLease.id },
              data: {
                rentAmount:    parseNum(row['이용료']),
                depositAmount: parseNum(row['보증금']),
                cleaningFee:   parseNum(row['청소비']),
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

async function createTenantAndLease(row: Record<string, unknown>, propertyId: string, result: SheetResult) {
  const name = str(row['이름'])
  const roomNo = str(row['호실'])
  const room = roomNo ? await prisma.room.findUnique({
    where: { propertyId_roomNo: { propertyId, roomNo } },
  }) : null

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
        await prisma.expense.delete({ where: { id: existing.id } })
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
        where: { propertyId, tenantId: tenant.id, requestDate: date, content },
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

  if (wb.SheetNames.includes('기타수익'))
    results['기타수익'] = await importIncomes(sheetToRows(wb, '기타수익'), propertyId, resolutions)

  if (wb.SheetNames.includes('요청사항'))
    results['요청사항'] = await importRequests(sheetToRows(wb, '요청사항'), propertyId)

  if (wb.SheetNames.includes('설정'))
    results['설정'] = await importSettings(sheetToRows(wb, '설정'), propertyId, resolutions)

  return NextResponse.json(results)
}
