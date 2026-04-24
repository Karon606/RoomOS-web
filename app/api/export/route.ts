import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import * as XLSX from 'xlsx'
import { NextRequest, NextResponse } from 'next/server'

function fmtDate(d: Date | null | undefined): string {
  if (!d) return ''
  return d.toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).replace(/\. /g, '-').replace('.', '')
}

function fmtAccount(acc: { brand: string; alias: string | null } | null | undefined): string {
  if (!acc) return ''
  return acc.alias ? `${acc.brand}(${acc.alias})` : acc.brand
}

const GENDER_LABEL: Record<string, string> = {
  MALE: '남', FEMALE: '여', OTHER: '기타', UNKNOWN: '',
}
const STATUS_LABEL: Record<string, string> = {
  ACTIVE: '거주중', RESERVED: '입실예정', CHECKOUT_PENDING: '퇴실예정',
  CHECKED_OUT: '퇴실', CANCELLED: '취소', NON_RESIDENT: '비거주',
}
const WINDOW_LABEL: Record<string, string> = {
  OUTER: '외창', INNER: '내창',
}
const DIRECTION_LABEL: Record<string, string> = {
  EAST: '동', WEST: '서', SOUTH: '남', NORTH: '북',
  SOUTHEAST: '남동', SOUTHWEST: '남서', NORTHEAST: '북동', NORTHWEST: '북서',
}
const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  BANK_ACCOUNT: '은행계좌', CREDIT_CARD: '신용카드', CHECK_CARD: '체크카드', OTHER: '기타',
}
const SETTLE_LABEL: Record<string, string> = { SETTLED: '정산완료', UNSETTLED: '미정산' }

function fmtDay(n: number | null | undefined): string {
  if (n == null) return ''
  return n === 31 ? '말일' : `${n}일`
}

function autoWidth(ws: XLSX.WorkSheet) {
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
  const widths: number[] = []
  for (let C = range.s.c; C <= range.e.c; C++) {
    let max = 8
    for (let R = range.s.r; R <= range.e.r; R++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })]
      if (cell?.v != null) max = Math.max(max, String(cell.v).length + 2)
    }
    widths.push(max)
  }
  ws['!cols'] = widths.map(w => ({ wch: w }))
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const cookieStore = await cookies()
  const propertyId = cookieStore.get('selected_property_id')?.value
  if (!propertyId) return NextResponse.json({ error: 'No property' }, { status: 400 })

  const { searchParams } = new URL(request.url)
  const targetMonth = searchParams.get('month') ??
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
  const scope = (searchParams.get('scope') ?? 'month') as 'month' | 'year' | 'all'

  const [yyyy, mm] = targetMonth.split('-').map(Number)
  const monthStart = new Date(yyyy, mm - 1, 1)
  const monthEnd   = new Date(yyyy, mm, 0, 23, 59, 59)
  const yearStart  = new Date(yyyy, 0, 1)
  const yearEnd    = new Date(yyyy, 11, 31, 23, 59, 59)

  const dateRange = scope === 'month'
    ? { gte: monthStart, lte: monthEnd }
    : scope === 'year'
      ? { gte: yearStart, lte: yearEnd }
      : undefined

  // ── 수납현황 ────────────────────────────────────────────────────
  let paymentSheet: object[]

  if (scope === 'month') {
    const leases = await prisma.leaseTerm.findMany({
      where: { propertyId, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
      include: {
        room: { select: { roomNo: true } },
        tenant: {
          select: {
            name: true,
            contacts: { where: { isPrimary: true }, take: 1, select: { contactValue: true } },
          },
        },
      },
      orderBy: { room: { roomNo: 'asc' } },
    })
    const payments = await prisma.paymentRecord.findMany({ where: { propertyId, targetMonth } })
    paymentSheet = leases.map(l => {
      const ps = payments.filter(p => p.leaseTermId === l.id)
      const totalPaid = ps.reduce((s, x) => s + x.actualAmount, 0)
      const effectiveDueDay =
        l.overrideDueDayMonth === targetMonth && l.overrideDueDay ? l.overrideDueDay : l.dueDay
      return {
        '호실':        l.room.roomNo,
        '입주자명':    l.tenant.name,
        '연락처':      l.tenant.contacts[0]?.contactValue ?? '',
        '이용료':      l.rentAmount,
        '보증금':      l.depositAmount,
        '총 수납액':   totalPaid,
        '잔액':        totalPaid - l.rentAmount,
        '납부일':      effectiveDueDay ? `매월 ${effectiveDueDay}일` : '',
        '납부방법':    l.payMethod ?? '',
        '상태':        totalPaid >= l.rentAmount ? '완납' : '미수납',
        '계약상태':    STATUS_LABEL[l.status] ?? l.status,
        '입실일':      fmtDate(l.moveInDate),
        '퇴실 예정일': fmtDate(l.expectedMoveOut),
      }
    })
  } else {
    const allPayments = await prisma.paymentRecord.findMany({
      where: {
        propertyId,
        ...(scope === 'year' ? { targetMonth: { startsWith: `${yyyy}-` } } : {}),
      },
      include: {
        leaseTerm: { include: { room: { select: { roomNo: true } } } },
        tenant: { select: { name: true } },
      },
      orderBy: [{ targetMonth: 'asc' }, { leaseTerm: { room: { roomNo: 'asc' } } }],
    })
    paymentSheet = allPayments.map(p => ({
      '월':       p.targetMonth,
      '호실':     p.leaseTerm.room.roomNo,
      '입주자명': p.tenant.name,
      '이용료':   p.expectedAmount,
      '납부액':   p.actualAmount,
      '잔액':     p.actualAmount - p.expectedAmount,
      '납부방법': p.payMethod ?? '',
      '수납상태': p.isPaid ? '완납' : '미수납',
      '납부일자': p.payDate ? fmtDate(p.payDate) : '',
      '메모':     p.memo ?? '',
    }))
  }

  // ── 공통 연락처 포함 입주자 조회 ──────────────────────────────────
  const contactSelect = {
    select: {
      contactType: true, contactValue: true,
      isPrimary: true, isEmergency: true, emergencyRelation: true,
    },
  }

  // ── 입주자관리 (현재 입주자: ACTIVE/RESERVED/CHECKOUT_PENDING) ───
  const activeTenants = await prisma.tenant.findMany({
    where: {
      propertyId,
      leaseTerms: { some: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } } },
    },
    include: {
      contacts: contactSelect,
      leaseTerms: {
        where: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
        include: { room: { select: { roomNo: true } } },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { name: 'asc' },
  })
  const tenantSheet = activeTenants.map(t => {
    const lease   = t.leaseTerms[0]
    const primary = t.contacts.find(c => c.isPrimary) ?? t.contacts[0]
    const emergency = t.contacts.find(c => c.isEmergency)
    return {
      '호실':           lease?.room.roomNo ?? '',
      '이름':           t.name,
      '영문명':         t.englishName ?? '',
      '연락처':         primary?.contactValue ?? '',
      '비상연락처':     emergency?.contactValue ?? '',
      '비상연락처관계': emergency?.emergencyRelation ?? '',
      '생년월일':       fmtDate(t.birthdate),
      '성별':           GENDER_LABEL[t.gender] ?? '',
      '국적':           t.nationality ?? '',
      '직업':           t.job ?? '',
      '이용료':         lease?.rentAmount ?? '',
      '보증금':         lease?.depositAmount ?? '',
      '청소비':         lease?.cleaningFee ?? '',
      '납부일':         lease?.dueDay ?? '',
      '납부방법':       lease?.payMethod ?? '',
      '입실일':         fmtDate(lease?.moveInDate),
      '퇴실 예정일':    fmtDate(lease?.expectedMoveOut),
      '계약상태':       STATUS_LABEL[lease?.status ?? ''] ?? '',
      '메모':           t.memo ?? '',
    }
  })

  // ── 퇴실자 (CHECKED_OUT/CANCELLED, 현재 활성 계약 없음) ──────────
  const exTenants = await prisma.tenant.findMany({
    where: {
      propertyId,
      leaseTerms: {
        none: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
        some: { status: { in: ['CHECKED_OUT', 'CANCELLED'] } },
      },
    },
    include: {
      contacts: contactSelect,
      leaseTerms: {
        where: { status: { in: ['CHECKED_OUT', 'CANCELLED'] } },
        include: { room: { select: { roomNo: true } } },
        orderBy: { moveOutDate: 'desc' },
        take: 1,
      },
    },
    orderBy: { name: 'asc' },
  })
  const exTenantSheet = exTenants.map(t => {
    const lease   = t.leaseTerms[0]
    const primary = t.contacts.find(c => c.isPrimary) ?? t.contacts[0]
    const emergency = t.contacts.find(c => c.isEmergency)
    return {
      '호실':           lease?.room.roomNo ?? '',
      '이름':           t.name,
      '영문명':         t.englishName ?? '',
      '연락처':         primary?.contactValue ?? '',
      '비상연락처':     emergency?.contactValue ?? '',
      '생년월일':       fmtDate(t.birthdate),
      '성별':           GENDER_LABEL[t.gender] ?? '',
      '국적':           t.nationality ?? '',
      '직업':           t.job ?? '',
      '이용료':         lease?.rentAmount ?? '',
      '보증금':         lease?.depositAmount ?? '',
      '청소비':         lease?.cleaningFee ?? '',
      '입실일':         fmtDate(lease?.moveInDate),
      '퇴실일':         fmtDate((lease as any)?.moveOutDate),
      '퇴실 예정일':    fmtDate(lease?.expectedMoveOut),
      '계약상태':       STATUS_LABEL[lease?.status ?? ''] ?? '',
      '메모':           t.memo ?? '',
    }
  })

  // ── 호실관리 ────────────────────────────────────────────────────
  const rooms = await prisma.room.findMany({
    where: { propertyId },
    orderBy: { roomNo: 'asc' },
  })
  const roomSheet = rooms.map(r => ({
    '호실번호':   r.roomNo,
    '타입':       r.type ?? '',
    '기본이용료': r.baseRent,
    '채광':       WINDOW_LABEL[r.windowType ?? ''] ?? r.windowType ?? '',
    '방향':       DIRECTION_LABEL[r.direction ?? ''] ?? r.direction ?? '',
    '면적(평)':   r.areaPyeong ?? '',
    '면적(㎡)':   r.areaM2 ?? '',
    '공실':       r.isVacant ? 'Y' : 'N',
    '메모':       r.memo ?? '',
  }))

  // ── 요청사항 ─────────────────────────────────────────────────────
  const requests = await prisma.tenantRequest.findMany({
    where: {
      propertyId,
      ...(dateRange ? { requestDate: dateRange } : {}),
    },
    include: {
      tenant: {
        select: {
          name: true,
          leaseTerms: {
            where: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
            include: { room: { select: { roomNo: true } } },
            take: 1,
          },
        },
      },
    },
    orderBy: { requestDate: 'desc' },
  })
  const requestSheet = requests.map(r => ({
    '작성일':     fmtDate(r.requestDate),
    '입주자명':   r.tenant.name,
    '호실':       r.tenant.leaseTerms[0]?.room.roomNo ?? '',
    '내용':       r.content,
    '처리예정일': fmtDate(r.targetDate),
    '해결일':     fmtDate(r.resolvedAt),
    '처리여부':   r.resolvedAt ? '완료' : '미완료',
  }))

  // ── 지출 ────────────────────────────────────────────────────────
  const expenses = await prisma.expense.findMany({
    where: { propertyId, ...(dateRange ? { date: dateRange } : {}) },
    include: { financialAccount: { select: { brand: true, alias: true } } },
    orderBy: { date: 'asc' },
  })
  const expenseSheet = expenses.map(e => ({
    '날짜':      fmtDate(e.date),
    '카테고리':  e.category,
    '세부항목':  e.detail ?? '',
    '금액':      e.amount,
    '결제수단':  e.payMethod ?? '',
    '카드/계좌': e.financeName || fmtAccount(e.financialAccount),
    '정산여부':  SETTLE_LABEL[e.settleStatus] ?? '',
    '메모':      e.memo ?? '',
  }))

  // ── 기타수익 ────────────────────────────────────────────────────
  const incomes = await prisma.extraIncome.findMany({
    where: { propertyId, ...(dateRange ? { date: dateRange } : {}) },
    include: { financialAccount: { select: { brand: true, alias: true } } },
    orderBy: { date: 'asc' },
  })
  const incomeSheet = incomes.map(i => ({
    '날짜':     fmtDate(i.date),
    '카테고리': i.category,
    '세부항목': i.detail ?? '',
    '금액':     i.amount,
    '입금수단': i.payMethod ?? '',
    '계좌':     fmtAccount(i.financialAccount),
    '메모':     i.memo ?? '',
  }))

  // ── 설정 (금융계좌) ──────────────────────────────────────────────
  const accounts = await prisma.financialAccount.findMany({
    where: { propertyId, isActive: true },
    include: { linkedAccount: { select: { brand: true, alias: true } } },
    orderBy: { createdAt: 'asc' },
  })
  const settingSheet = accounts.map(a => ({
    '타입':          ACCOUNT_TYPE_LABEL[a.type] ?? a.type,
    '금융사':        a.brand,
    '별칭':          a.alias ?? '',
    '계좌/카드번호': a.identifier ?? '',
    '소유자':        a.owner ?? '',
    '결제일':        fmtDay(a.payDay),
    '마감일':        fmtDay(a.cutOffDay),
    '연결계좌':      a.linkedAccount ? fmtAccount(a.linkedAccount) : '',
  }))

  // ── 워크북 생성 ──────────────────────────────────────────────────
  const wb = XLSX.utils.book_new()
  const sheets: [string, object[]][] = [
    ['수납현황',   paymentSheet],
    ['입주자관리', tenantSheet],
    ['퇴실자',     exTenantSheet],
    ['호실관리',   roomSheet],
    ['요청사항',   requestSheet],
    ['지출',       expenseSheet],
    ['기타수익',   incomeSheet],
    ['설정',       settingSheet],
  ]
  for (const [name, data] of sheets) {
    const ws = XLSX.utils.json_to_sheet(data)
    autoWidth(ws)
    XLSX.utils.book_append_sheet(wb, ws, name)
  }

  const filename = scope === 'month'
    ? `RoomOS_${targetMonth}.xlsx`
    : scope === 'year'
      ? `RoomOS_${yyyy}년.xlsx`
      : 'RoomOS_전체.xlsx'

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
}
