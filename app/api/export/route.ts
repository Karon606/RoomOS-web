import { getPropertyAccess } from '@/lib/auth/propertyAccess'
import { canReadScope } from '@/lib/auth/routeScope'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import * as XLSX from 'xlsx'
import { NextRequest, NextResponse } from 'next/server'
import { fmtAccount, expenseAccountKey } from '@/lib/expenseExport'
import { billForLeaseMonth } from '@/lib/billing'

function fmtDate(d: Date | null | undefined): string {
  if (!d) return ''
  return d.toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).replace(/\. /g, '-').replace('.', '')
}

const GENDER_LABEL: Record<string, string> = {
  MALE: '남', FEMALE: '여', OTHER: '기타', UNKNOWN: '',
}
const STATUS_LABEL: Record<string, string> = {
  ACTIVE: '거주중', RESERVED: '입실예약', CHECKOUT_PENDING: '퇴실예정',
  CHECKED_OUT: '퇴실', CANCELLED: '입실취소', NON_RESIDENT: '비거주',
  WAITING_TOUR: '투어예정', TOUR_DONE: '투어완료',
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

// 지출 시트 1행 매핑 — 전체 워크북 '지출' 시트와 지출 전용 내보내기가 공유(중복 제거).
type ExpenseRow = {
  date: Date | null
  category: string
  detail: string | null
  vendor: string | null
  vendorBizNo: string | null
  amount: number
  payMethod: string | null
  financeName: string | null
  financialAccount: { brand: string; alias: string | null } | null
  settleStatus: string
  memo: string | null
}
function mapExpenseRow(e: ExpenseRow) {
  return {
    '날짜':      fmtDate(e.date),
    '카테고리':  e.category,
    '세부항목':  e.detail ?? '',
    '구매처':    e.vendor ?? '',
    '사업자등록번호': e.vendorBizNo ?? '',
    '금액':      e.amount,
    '결제수단':  e.payMethod ?? '',
    '카드/계좌': e.financeName || fmtAccount(e.financialAccount),
    '정산여부':  SETTLE_LABEL[e.settleStatus] ?? '',
    '메모':      e.memo ?? '',
  }
}

// 지출 전용 내보내기 결제수단 분류 — '계좌이체'·'신용카드' 외(현금·서울페이·결제선생·null 등)는 모두 '기타'.
function classifyExpensePayMethod(payMethod: string | null): '계좌이체' | '신용카드' | '기타' {
  if (payMethod === '계좌이체') return '계좌이체'
  if (payMethod === '신용카드') return '신용카드'
  return '기타'
}

// 지출 시트 1장 생성 — 데이터 행 + 마지막 합계 행. 0건이어도 헤더+합계 0으로 생성(시트 누락 방지).
function buildExpenseSheet(rows: ExpenseRow[]): XLSX.WorkSheet {
  const data: Record<string, string | number>[] = rows.map(mapExpenseRow)
  const total = rows.reduce((s, e) => s + e.amount, 0)
  data.push({
    '날짜': '합계', '카테고리': '', '세부항목': '', '금액': total,
    '결제수단': '', '카드/계좌': '', '정산여부': '', '메모': '',
  })
  const ws = XLSX.utils.json_to_sheet(data)
  autoWidth(ws)
  return ws
}

// 지출 월별 그룹 키 — 날짜 기준 'YYYY-MM'.
function expenseMonthKey(d: Date | null): string {
  if (!d) return '날짜없음'
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// 엑셀 시트명 제약 준수 — 금지문자(\ / ? * [ ] :) 제거, 31자 이내, 빈 값은 '미지정'.
function sanitizeSheetName(raw: string): string {
  const cleaned = raw.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31).trim()
  return cleaned || '미지정'
}

// 시트명 중복 방지 — 이미 쓴 이름이면 숫자 접미(-2, -3 …), 31자 넘지 않게 잘라 붙인다.
function uniqueSheetName(base: string, used: Set<string>): string {
  if (!used.has(base)) { used.add(base); return base }
  for (let i = 2; ; i++) {
    const suffix = `-${i}`
    const name = base.slice(0, 31 - suffix.length) + suffix
    if (!used.has(name)) { used.add(name); return name }
  }
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await getPropertyAccess()
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  // 금액 읽기 차단(제한 스태프) — 엑셀은 금액 시트 다수라 내보내기 전면 차단.
  if (!canReadScope(access.role, 'money')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const propertyId = access.propertyId

  const { searchParams } = new URL(request.url)

  // ── 지출 전용 내보내기 — 시트 구분(결제수단별/카드·계좌별/월별). 인증·권한 가드 통과 후에만 분기 ──
  if (searchParams.get('only') === 'expenses') {
    const monthParam = searchParams.get('month')   // 하위 호환 — from/to가 있으면 무시
    const fromParam = searchParams.get('from')      // 'YYYY-MM-DD', KST 로컬 파싱
    const toParam = searchParams.get('to')          // 'YYYY-MM-DD', KST 로컬 파싱
    const groupParam = (searchParams.get('group') ?? 'method') as 'method' | 'account' | 'month'
    let expDateRange: { gte: Date; lte: Date } | undefined
    if (fromParam && toParam) {
      // 직접 지정·빠른 선택 — from 00:00 ~ to 23:59:59 (기존 month 파싱과 동일한 로컬 new Date 문법).
      const [fy, fm, fd] = fromParam.split('-').map(Number)
      const [ty, tm, td] = toParam.split('-').map(Number)
      expDateRange = { gte: new Date(fy, fm - 1, fd), lte: new Date(ty, tm - 1, td, 23, 59, 59) }
    } else if (monthParam) {
      const [ey, em] = monthParam.split('-').map(Number)
      expDateRange = { gte: new Date(ey, em - 1, 1), lte: new Date(ey, em, 0, 23, 59, 59) }
    }
    // 카드·계좌 필터 — 쉼표 구분 accountKey 목록(각 값 encodeURIComponent). 있으면 공용 accountKey(시트 그룹핑과 동일 정의)로 걸러낸다.
    const accountsParam = searchParams.get('accounts')
    const wantedAccounts = accountsParam
      ? new Set(accountsParam.split(',').map(s => decodeURIComponent(s)))
      : null

    const allExpenses = await prisma.expense.findMany({
      where: { propertyId, ...(expDateRange ? { date: expDateRange } : {}) },
      include: { financialAccount: { select: { brand: true, alias: true } } },
      orderBy: { date: 'asc' },
    })
    const expenses = wantedAccounts
      ? allExpenses.filter(e => wantedAccounts.has(expenseAccountKey(e)))
      : allExpenses

    const wb = XLSX.utils.book_new()

    if (groupParam === 'account') {
      // 카드·계좌별 — 표시값으로 묶고, 금액 합 내림차순으로 시트 배치. 시트명은 sanitize + 중복 접미.
      const buckets = new Map<string, ExpenseRow[]>()
      for (const e of expenses) {
        const key = expenseAccountKey(e)
        const arr = buckets.get(key); if (arr) arr.push(e); else buckets.set(key, [e])
      }
      const ordered = [...buckets.entries()].sort(
        (a, b) => b[1].reduce((s, e) => s + e.amount, 0) - a[1].reduce((s, e) => s + e.amount, 0),
      )
      const used = new Set<string>()
      for (const [key, rows] of ordered) {
        XLSX.utils.book_append_sheet(wb, buildExpenseSheet(rows), uniqueSheetName(sanitizeSheetName(key), used))
      }
      // 0건이면 시트가 없어 빈 워크북 쓰기가 실패 — 헤더+합계 0 시트 1장 보장.
      if (ordered.length === 0) XLSX.utils.book_append_sheet(wb, buildExpenseSheet([]), '지출')
    } else if (groupParam === 'month') {
      // 월별 — 'YYYY-MM' 키로 묶고 오름차순 배치. month 파라미터와 조합되면 그 달 1시트만 나온다(정상).
      const buckets = new Map<string, ExpenseRow[]>()
      for (const e of expenses) {
        const key = expenseMonthKey(e.date)
        const arr = buckets.get(key); if (arr) arr.push(e); else buckets.set(key, [e])
      }
      const ordered = [...buckets.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
      for (const [key, rows] of ordered) {
        XLSX.utils.book_append_sheet(wb, buildExpenseSheet(rows), key)
      }
      if (ordered.length === 0) XLSX.utils.book_append_sheet(wb, buildExpenseSheet([]), '지출')
    } else {
      // 결제수단별(기본) — 계좌이체·신용카드·기타 3시트(현행 동작 유지).
      const groups: Record<'계좌이체' | '신용카드' | '기타', ExpenseRow[]> = {
        계좌이체: [], 신용카드: [], 기타: [],
      }
      for (const e of expenses) groups[classifyExpensePayMethod(e.payMethod)].push(e)
      XLSX.utils.book_append_sheet(wb, buildExpenseSheet(groups['계좌이체']), '지출-계좌이체')
      XLSX.utils.book_append_sheet(wb, buildExpenseSheet(groups['신용카드']), '지출-신용카드')
      XLSX.utils.book_append_sheet(wb, buildExpenseSheet(groups['기타']),   '지출-기타')
    }

    const periodLabel = (fromParam && toParam) ? `${fromParam}~${toParam}` : monthParam ?? '전체'
    const groupLabel = groupParam === 'account' ? '카드계좌별' : groupParam === 'month' ? '월별' : '결제수단별'
    // 계좌 필터 표시 — 없으면 생략, 1개면 그 이름(sanitize), 2개 이상이면 'N곳'.
    let accountSuffix = ''
    if (wantedAccounts && wantedAccounts.size > 0) {
      const names = [...wantedAccounts]
      accountSuffix = names.length === 1 ? `_${sanitizeSheetName(names[0])}` : `_${names.length}곳`
    }
    const filename = `지출내역_${periodLabel}_${groupLabel}${accountSuffix}.xlsx`
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    return new NextResponse(buf, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    })
  }

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
    const [leases, payments, property] = await Promise.all([
      prisma.leaseTerm.findMany({
        where: { propertyId, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
        include: {
          // 잔액·상태를 청구 정본(billForLeaseMonth)으로 계산하기 위해 할인·예약 인상 필드까지 가져온다
          room: { select: { roomNo: true, scheduledRent: true, rentUpdateDate: true, nonResidentScheduled: true, nonResidentRentDate: true } },
          discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
          tenant: {
            select: {
              name: true,
              contacts: { where: { isPrimary: true }, take: 1, select: { contactValue: true } },
            },
          },
        },
        orderBy: { room: { roomNo: 'asc' } },
      }),
      prisma.paymentRecord.findMany({ where: { propertyId, targetMonth, isDeposit: false } }),
      prisma.property.findUnique({
        where: { id: propertyId },
        select: { acquisitionDate: true, prevOwnerCutoffDate: true },
      }),
    ])

    const cutoffDate: Date | null = property?.prevOwnerCutoffDate
      ? new Date(property.prevOwnerCutoffDate)
      : property?.acquisitionDate ? new Date(property.acquisitionDate) : null
    const cutoffMonthStr = cutoffDate
      ? `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}`
      : null
    const cutoffDay = cutoffDate?.getDate() ?? 0

    paymentSheet = leases.map(l => {
      const ps = payments.filter(p => p.leaseTermId === l.id)
      const totalPaid = ps.reduce((s, x) => s + x.actualAmount, 0)
      const effectiveDueDay =
        l.overrideDueDayMonth === targetMonth && l.overrideDueDay ? l.overrideDueDay : l.dueDay

      // 양도인 귀속 여부 판단 (actions.ts의 prevPaidThisMonth와 동일 로직)
      let prevPaidThisMonth = false
      if (cutoffDate && cutoffMonthStr && targetMonth === cutoffMonthStr) {
        const preAcqPaid = ps.filter(p => new Date(p.payDate) < cutoffDate).reduce((s, p) => s + p.actualAmount, 0)
        const dueDayNum = effectiveDueDay?.includes('-')
          ? new Date(effectiveDueDay + 'T00:00:00').getDate()
          : effectiveDueDay?.includes('말') ? 31 : Number(effectiveDueDay ?? '1')
        const dueDayBeforeCutoff = dueDayNum < cutoffDay
        prevPaidThisMonth = preAcqPaid >= l.rentAmount || dueDayBeforeCutoff
      }

      // 단기는 입주월 1회 청구 — 다른 달 시트에선 청구 0 (lib/billing 단기 규칙과 동일).
      // '이용료' 컬럼은 가져오기 매칭 키(rentAmount 대조)라 값을 바꾸지 않고 잔액·상태만 보정.
      // 청구 정본 경유 — 종전에는 원가(rentAmount)를 직산해 할인·청구락·퇴실 일할·예약 인상이 전부 빠졌고,
      // 그 결과 엑셀의 잔액·상태가 수납 화면과 다르게 나왔다(A페이즈). 락은 그 달 record 의 최대 expectedAmount.
      const lockedForMonth = ps.reduce((m, p) => Math.max(m, p.expectedAmount), 0) || null
      // 예약(RESERVED)은 아직 입주 전이라 미납·수금 집계에서 뺀다 — 화면과 동일 정본
      // (balance 0 · isPaid true). 이 규칙 없이 청구만 정본화하면 예약자가 엑셀에서 미납으로 잡힌다.
      const isReserved = l.status === 'RESERVED'
      const monthBill = isReserved ? 0 : billForLeaseMonth(l, targetMonth, lockedForMonth)
      const balance = (prevPaidThisMonth || isReserved) ? 0 : totalPaid - monthBill
      const isPaid  = prevPaidThisMonth || isReserved || totalPaid >= monthBill

      return {
        '호실':        l.room?.roomNo ?? '',
        '입주자명':    l.tenant.name,
        '연락처':      l.tenant.contacts[0]?.contactValue ?? '',
        '이용료':      l.rentAmount,
        '보증금':      l.depositAmount,
        '총 수납액':   totalPaid,
        '잔액':        balance,
        '납부일':      effectiveDueDay ? `매월 ${effectiveDueDay}일` : '',
        '납부방법':    l.payMethod ?? '',
        '상태':        isPaid ? '완납' : '미수납',
        '계약상태':    STATUS_LABEL[l.status] ?? l.status,
        '입실일':      fmtDate(l.moveInDate),
        '퇴실 예정일': fmtDate(l.expectedMoveOut),
      }
    })
  } else {
    // 청구 조정 전표(isBillingAdjust)는 납부 행이 아니라 청구 락 조정용이라 행 나열에서 제외
    // (수납 합계는 actualAmount=0 이라 영향 없음).
    const allPayments = await prisma.paymentRecord.findMany({
      where: {
        propertyId,
        isBillingAdjust: false,
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
      '호실':     p.leaseTerm.room?.roomNo ?? '',
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

  // ── 입주자관리 (현재 입주자: ACTIVE/RESERVED/CHECKOUT_PENDING/NON_RESIDENT) ───
  const activeTenants = await prisma.tenant.findMany({
    where: {
      propertyId,
      leaseTerms: { some: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } } },
    },
    include: {
      contacts: contactSelect,
      leaseTerms: {
        where: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
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
      '호실':           lease?.room?.roomNo ?? '',
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
      '호실':           lease?.room?.roomNo ?? '',
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
    include: { leaseTerms: { where: { status: 'NON_RESIDENT' }, select: { id: true }, take: 1 } },
  })
  const roomSheet = rooms.map(r => ({
    '호실번호':   r.roomNo,
    '타입':       r.type ?? '',
    '기본이용료': r.baseRent,
    '채광':       WINDOW_LABEL[r.windowType ?? ''] ?? r.windowType ?? '',
    '방향':       DIRECTION_LABEL[r.direction ?? ''] ?? r.direction ?? '',
    '면적(평)':   r.areaPyeong ?? '',
    '면적(㎡)':   r.areaM2 ?? '',
    // 집계 제외 방(비거주 점유 + 공실 표시 안 함)은 N — 화면 공실 정의(lib/vacancy)와 통일(신고 9d844226 잔여)
    '공실':       r.isVacant && !(r.leaseTerms.length > 0 && !r.nonResidentVacant) ? 'Y' : 'N',
    '메모':       r.memo ?? '',
  }))

  // ── 요청사항 ─────────────────────────────────────────────────────
  const requests = await prisma.tenantRequest.findMany({
    where: {
      propertyId,
      deletedAt: null,
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
    '입주자명':   r.tenant?.name ?? '공용',
    // 등록 시점 스냅샷 우선 — 없으면(구 데이터) 현행 호실로 폴백.
    '호실':       r.roomNoSnapshot ?? r.tenant?.leaseTerms[0]?.room?.roomNo ?? '',
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
  const expenseSheet = expenses.map(mapExpenseRow)

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
    ? `Stayeum_${targetMonth}.xlsx`
    : scope === 'year'
      ? `Stayeum_${yyyy}년.xlsx`
      : 'Stayeum_전체.xlsx'

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
}
