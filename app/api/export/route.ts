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

  const [yyyy, mm] = targetMonth.split('-').map(Number)
  const monthStart = new Date(yyyy, mm - 1, 1)
  const monthEnd   = new Date(yyyy, mm, 0)

  // ─── ① 수납 현황 ────────────────────────────────────────────────
  const leases = await prisma.leaseTerm.findMany({
    where: {
      propertyId,
      status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] },
    },
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

  const payments = await prisma.paymentRecord.findMany({
    where: { propertyId, targetMonth },
  })

  const paymentSheet = leases.map(l => {
    const ps = payments.filter(p => p.leaseTermId === l.id)
    const totalPaid = ps.reduce((s, x) => s + x.actualAmount, 0)
    const balance   = totalPaid - l.rentAmount
    const effectiveDueDay =
      l.overrideDueDayMonth === targetMonth && l.overrideDueDay
        ? l.overrideDueDay
        : l.dueDay

    return {
      '호실':     l.room.roomNo,
      '입주자명': l.tenant.name,
      '연락처':   l.tenant.contacts[0]?.contactValue ?? '',
      '이용료':   l.rentAmount,
      '보증금':   l.depositAmount,
      '총 수납액': totalPaid,
      '잔액':     balance,
      '납부일':   effectiveDueDay ? `매월 ${effectiveDueDay}일` : '',
      '납부방법': l.payMethod ?? '',
      '상태':     balance >= 0 ? '완납' : '미수납',
      '계약상태': l.status,
      '입실일':   fmtDate(l.moveInDate),
      '퇴실 예정일': fmtDate(l.expectedMoveOut),
    }
  })

  // ─── ② 입주자 정보 ───────────────────────────────────────────────
  const tenants = await prisma.tenant.findMany({
    where: { propertyId },
    include: {
      contacts: { select: { contactType: true, contactValue: true, isPrimary: true } },
      leaseTerms: {
        where: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
        include: { room: { select: { roomNo: true } } },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { name: 'asc' },
  })

  const GENDER_LABEL: Record<string, string> = {
    MALE: '남', FEMALE: '여', OTHER: '기타', UNKNOWN: '미상',
  }

  const tenantSheet = tenants.map(t => {
    const lease = t.leaseTerms[0]
    const primary = t.contacts.find(c => c.isPrimary) ?? t.contacts[0]
    return {
      '호실':     lease?.room.roomNo ?? '',
      '이름':     t.name,
      '영문명':   t.englishName ?? '',
      '연락처':   primary?.contactValue ?? '',
      '생년월일': fmtDate(t.birthdate),
      '성별':     GENDER_LABEL[t.gender] ?? '',
      '국적':     t.nationality ?? '',
      '직업':     t.job ?? '',
      '이용료':   lease?.rentAmount ?? '',
      '보증금':   lease?.depositAmount ?? '',
      '청소비':   lease?.cleaningFee ?? '',
      '입실일':   fmtDate(lease?.moveInDate),
      '퇴실 예정일': fmtDate(lease?.expectedMoveOut),
      '계약상태': lease?.status ?? '',
      '메모':     t.memo ?? '',
    }
  })

  // ─── ③ 지출 ────────────────────────────────────────────────────
  const expenses = await prisma.expense.findMany({
    where: {
      propertyId,
      date: { gte: monthStart, lte: monthEnd },
    },
    include: {
      financialAccount: { select: { brand: true, alias: true } },
    },
    orderBy: { date: 'asc' },
  })

  const SETTLE_LABEL: Record<string, string> = { SETTLED: '정산완료', UNSETTLED: '미정산' }

  const expenseSheet = expenses.map(e => ({
    '날짜':       fmtDate(e.date),
    '카테고리':   e.category,
    '세부 항목':  e.detail ?? '',
    '금액':       e.amount,
    '결제수단':   e.payMethod ?? '',
    '카드/계좌':  e.financeName || fmtAccount(e.financialAccount),
    '정산여부':   SETTLE_LABEL[e.settleStatus] ?? '',
    '메모':       e.memo ?? '',
  }))

  // ─── ④ 부가수입 ──────────────────────────────────────────────────
  const incomes = await prisma.extraIncome.findMany({
    where: {
      propertyId,
      date: { gte: monthStart, lte: monthEnd },
    },
    include: {
      financialAccount: { select: { brand: true, alias: true } },
    },
    orderBy: { date: 'asc' },
  })

  const incomeSheet = incomes.map(i => ({
    '날짜':      fmtDate(i.date),
    '카테고리':  i.category,
    '세부 항목': i.detail ?? '',
    '금액':      i.amount,
    '입금수단':  i.payMethod ?? '',
    '계좌':      fmtAccount(i.financialAccount),
    '메모':      i.memo ?? '',
  }))

  // ─── 워크북 생성 ──────────────────────────────────────────────────
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(paymentSheet),  '수납현황')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tenantSheet),   '입주자정보')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(expenseSheet),  '지출')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(incomeSheet),   '부가수입')

  // 각 시트 컬럼 너비 자동 조정
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
    const colWidths: number[] = []
    for (let C = range.s.c; C <= range.e.c; C++) {
      let max = 10
      for (let R = range.s.r; R <= range.e.r; R++) {
        const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })]
        if (cell?.v != null) {
          const len = String(cell.v).length
          if (len > max) max = len
        }
      }
      colWidths.push(max + 2)
    }
    ws['!cols'] = colWidths.map(w => ({ wch: w }))
  }

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="RoomOS_${targetMonth}.xlsx"`,
    },
  })
}
