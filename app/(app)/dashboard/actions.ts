'use server'

import { getPropertyAccess } from '@/lib/auth/propertyAccess'
import { consumeGeminiAccess } from '@/lib/geminiKey'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { getPaidRevenueByMonths, primaryTenantLease } from '@/lib/leaseStatus'
import { dbDateMonthKey, monthDbRange, monthsDbRange, ymdToDbDate, type DbDateRange } from '@/lib/kstDate'
import { daysInMonth, shiftMonth } from '@/lib/moveCalendar'
import type { DashboardData } from './DashboardClient'
import { computeUnpaidStatus } from './unpaid'

// ── 추이 차트 ────────────────────────────────────────────────────

export type TrendRange = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'biannual' | 'annual' | 'all'
export type TrendPoint = { label: string; revenue: number; expense: number; profit: number }

async function getTrendPropertyId(): Promise<string | null> {
  return (await getPropertyAccess())?.propertyId ?? null
}

function ds(d: Date) { return d.toISOString().slice(0, 10) }

// 납부일 축(일간·주간) 전용 조회. 귀속월 축(막대 모드)의 이용료는 lib/leaseStatus 정본이 만든다.
// 창은 lib/kstDate 정본(DbDateRange) 하나로 받는다 — 로컬 자정 Date 두 개로 받던 시절엔
// KST 기기에서 @db.Date 비교가 하루 밀려 말일 거래가 어느 막대에도 안 들어갔다.
async function fetchRangeData(propertyId: string, window: DbDateRange, acquisitionDate?: Date | null) {
  // 인수일 이후로 좁힐 때도 창의 끝은 그대로 둔다 — 시작만 늦춘다.
  const payWindow = acquisitionDate && acquisitionDate > window.gte ? { ...window, gte: acquisitionDate } : window
  return Promise.all([
    prisma.paymentRecord.findMany({
      // RESERVED 선납·취소분은 트렌드 매출에서 제외(조기 매출 노출 차단). CHECKED_OUT는 유지(단기·중도퇴실 매출 보존).
      where: { propertyId, payDate: payWindow, isDeposit: false, isPrevOwner: false, leaseTerm: { status: { notIn: ['RESERVED', 'CANCELLED'] } } },
      select: { targetMonth: true, payDate: true, actualAmount: true },
    }),
    ...fetchRangeExpenseIncome(propertyId, window),
  ])
}

// 지출·부가수익은 어느 축에서도 date 기준이다(ExtraIncome 에는 귀속월 칸 자체가 없다).
function fetchRangeExpenseIncome(propertyId: string, window: DbDateRange) {
  return [
    prisma.expense.findMany({
      where: { propertyId, date: window },
      select: { date: true, amount: true },
    }),
    prisma.extraIncome.findMany({
      where: { propertyId, date: window },
      select: { date: true, amount: true },
    }),
  ] as const
}

/**
 * 막대 모드(귀속월 축)의 달별 이용료 실수납 — 홈 KPI '실수납'과 같은 정본이다.
 *
 * 종전에는 그 달 귀속 record 의 actualAmount 무캡 합이었다. 캡이 없으니 과납·양도인 겹침이
 * 생기는 순간 같은 화면 같은 달을 두 숫자가 말한다(2026-08-12 회계 패널). 오늘 실데이터로는
 * 6개월 전부 차 0원이라 지금이 바꾸기 가장 안전한 시점이다.
 */
async function paidRevenueForMonths(propertyId: string, months: string[]): Promise<Map<string, number>> {
  const byMonth = await getPaidRevenueByMonths(prisma, propertyId, months)
  return new Map([...byMonth].map(([m, b]) => [m, b.total]))
}

export async function getTrendData(range: TrendRange, targetMonth: string): Promise<TrendPoint[]> {
  const propertyId = await getTrendPropertyId()
  if (!propertyId) return []

  const prop = await prisma.property.findUnique({ where: { id: propertyId }, select: { acquisitionDate: true, prevOwnerCutoffDate: true } })
  const acquisitionDate = prop?.prevOwnerCutoffDate
    ? new Date(prop.prevOwnerCutoffDate)
    : prop?.acquisitionDate ? new Date(prop.acquisitionDate) : null

  const [tyear, tmonth] = targetMonth.split('-').map(Number)

  // ── 일간: targetMonth의 날짜별 ───────────────────────────────
  if (range === 'daily') {
    const [payments, expenses, incomes] = await fetchRangeData(propertyId, monthDbRange(targetMonth), acquisitionDate)

    // 날짜 키는 문자열로 만든다 — 로컬 Date 를 ds() 로 찍던 시절엔 KST 기기에서 1일 막대가
    // '전월 말일' 키를 들고 있어 그 달 어느 막대와도 짝이 안 맞았다.
    return Array.from({ length: daysInMonth(targetMonth) }, (_, i) => {
      const dayStr = `${targetMonth}-${String(i + 1).padStart(2, '0')}`
      const revenue =
        payments.filter(p => p.payDate && ds(new Date(p.payDate)) === dayStr).reduce((s, p) => s + p.actualAmount, 0) +
        incomes.filter(i => ds(new Date(i.date)) === dayStr).reduce((s, i) => s + i.amount, 0)
      const expense = expenses.filter(e => ds(new Date(e.date)) === dayStr).reduce((s, e) => s + e.amount, 0)
      return { label: `${i + 1}일`, revenue, expense, profit: revenue - expense }
    })
  }

  // ── 주간: targetMonth 끝 기준 12주 ──────────────────────────
  if (range === 'weekly') {
    // 주 경계는 UTC 자정으로만 센다 — @db.Date 저장값과 같은 축이라 경계일이 밀리지 않는다.
    // KST 는 서머타임이 없어 하루 = 정확히 86400000ms 이므로 날짜 산술도 밀리초 덧셈으로 족하다.
    const monthEnd = new Date(Date.UTC(tyear, tmonth, 0))
    const lastSat  = new Date(monthEnd.getTime() + (6 - monthEnd.getUTCDay()) * 86400000)

    const weeks = Array.from({ length: 12 }, (_, i) => {
      const end   = new Date(lastSat.getTime() - (11 - i) * 7 * 86400000)
      const start = new Date(end.getTime() - 6 * 86400000)
      return { start, end }
    })

    const window = { gte: weeks[0].start, lt: new Date(weeks[11].end.getTime() + 86400000) }
    const [payments, expenses, incomes] = await fetchRangeData(propertyId, window, acquisitionDate)
    return weeks.map(w => {
      const inW = (d: Date) => d >= w.start && d <= w.end
      const revenue =
        payments.filter(p => p.payDate && inW(new Date(p.payDate))).reduce((s, p) => s + p.actualAmount, 0) +
        incomes.filter(i => inW(new Date(i.date))).reduce((s, i) => s + i.amount, 0)
      const expense = expenses.filter(e => inW(new Date(e.date))).reduce((s, e) => s + e.amount, 0)
      return { label: `${w.start.getUTCMonth() + 1}/${w.start.getUTCDate()}`, revenue, expense, profit: revenue - expense }
    })
  }

  // ── 월간(12개월) / 반년(6개월) ───────────────────────────────
  if (range === 'monthly' || range === 'biannual') {
    const months = Array.from({ length: range === 'monthly' ? 12 : 6 }, (_, i) =>
      shiftMonth(targetMonth, i - (range === 'monthly' ? 11 : 5))
    )
    const [paid, expenses, incomes] = await Promise.all([
      paidRevenueForMonths(propertyId, months),
      ...fetchRangeExpenseIncome(propertyId, monthsDbRange(months[0], months[months.length - 1])),
    ])
    return months.map(m => {
      const revenue =
        (paid.get(m) ?? 0) +
        incomes.filter(i => dbDateMonthKey(i.date) === m).reduce((s, i) => s + i.amount, 0)
      const expense = expenses.filter(e => dbDateMonthKey(e.date) === m).reduce((s, e) => s + e.amount, 0)
      return { label: `${parseInt(m.slice(5))}월`, revenue, expense, profit: revenue - expense }
    })
  }

  // ── 분기: 최근 8분기 ─────────────────────────────────────────
  if (range === 'quarterly') {
    const currentQ = Math.ceil(tmonth / 3)
    const quarters: { year: number; q: number; months: string[] }[] = []
    let qy = tyear, qq = currentQ
    for (let i = 0; i < 8; i++) {
      const sm = (qq - 1) * 3 + 1
      quarters.unshift({
        year: qy, q: qq,
        months: [0, 1, 2].map(d => `${qy}-${String(sm + d).padStart(2, '0')}`),
      })
      if (--qq === 0) { qq = 4; qy-- }
    }
    const allMonths = quarters.flatMap(q => q.months)
    const [paid, expenses, incomes] = await Promise.all([
      paidRevenueForMonths(propertyId, allMonths),
      ...fetchRangeExpenseIncome(propertyId, monthsDbRange(quarters[0].months[0], quarters[7].months[2])),
    ])
    return quarters.map(({ year, q, months }) => {
      const inQ = (d: Date) => months.includes(dbDateMonthKey(d))
      // 분기 = 그 세 달의 달별 정본 합이다. 분기 단위로 다시 캡하면 달마다 갈린 과납이 상쇄돼 값이 달라진다.
      const revenue =
        months.reduce((s, m) => s + (paid.get(m) ?? 0), 0) +
        incomes.filter(i => inQ(new Date(i.date))).reduce((s, i) => s + i.amount, 0)
      const expense = expenses.filter(e => inQ(new Date(e.date))).reduce((s, e) => s + e.amount, 0)
      return { label: `${year}Q${q}`, revenue, expense, profit: revenue - expense }
    })
  }

  // ── 연간·전체: 기간 전체 ─────────────────────────────────────
  // 두 범위는 월 목록이 미리 없다. 그래서 귀속월을 먼저 훑어 목록을 만든 뒤 정본에 묻는다.
  // 목록에 여분의 달이 섞여도 무해하다 — 그 달 정본 값이 0으로 돌아올 뿐이다.
  if (range === 'annual' || range === 'all') {
    const [payMonthRows, expenses, incomes] = await Promise.all([
      prisma.paymentRecord.groupBy({
        by: ['targetMonth'],
        where: { propertyId, isDeposit: false, isPrevOwner: false, ...(acquisitionDate ? { payDate: { gte: acquisitionDate } } : {}) },
        _count: { _all: true },
      }),
      // 전 기간 센티널 — 실제 데이터가 들어올 리 없는 양끝이라 하루 단위 정밀도는 의미가 없다.
      ...fetchRangeExpenseIncome(propertyId, { gte: ymdToDbDate('1970-01-01'), lt: ymdToDbDate('9999-12-31') }),
    ])
    const yearOf = (d: Date | string) => dbDateMonthKey(d).slice(0, 4)
    const payMonths = payMonthRows.map(r => r.targetMonth)
    const paid = await paidRevenueForMonths(propertyId, payMonths)

    if (range === 'annual') {
      const years = new Set<number>()
      payMonths.forEach(m => years.add(parseInt(m.slice(0, 4))))
      expenses.forEach(e => years.add(Number(yearOf(e.date))))
      incomes.forEach(i => years.add(Number(yearOf(i.date))))
      return [...years].sort().map(year => {
        const revenue =
          payMonths.filter(m => m.startsWith(`${year}`)).reduce((s, m) => s + (paid.get(m) ?? 0), 0) +
          incomes.filter(i => yearOf(i.date) === `${year}`).reduce((s, i) => s + i.amount, 0)
        const expense = expenses.filter(e => yearOf(e.date) === `${year}`).reduce((s, e) => s + e.amount, 0)
        return { label: `${year}년`, revenue, expense, profit: revenue - expense }
      })
    }

    const monthSet = new Set<string>(payMonths)
    expenses.forEach(e => monthSet.add(dbDateMonthKey(e.date)))
    incomes.forEach(i => monthSet.add(dbDateMonthKey(i.date)))
    return [...monthSet].sort().map(m => {
      const [y, mo] = m.split('-').map(Number)
      const revenue =
        (paid.get(m) ?? 0) +
        incomes.filter(i => dbDateMonthKey(i.date) === m).reduce((s, i) => s + i.amount, 0)
      const expense = expenses.filter(e => dbDateMonthKey(e.date) === m).reduce((s, e) => s + e.amount, 0)
      return { label: `${String(y).slice(2)}/${mo}`, revenue, expense, profit: revenue - expense }
    })
  }

  return []
}

export async function analyzeDashboardWithGemini(
  data: DashboardData,
  targetMonth: string
): Promise<string> {
  const ai = await consumeGeminiAccess()
  if (!ai.ok) return `[오류] ${ai.error}`
  const apiKey = ai.apiKey

  // 수납률은 서버 정본(page.tsx paymentRate)을 그대로 읽는다. 여기서 다시 나누던 시절엔
  // 분모에 수납예정이 빠져 있어, 화면 도넛이 61% 인 달에 프롬프트가 100% 라고 적었다(2026-08).
  const paymentRate = data.paymentRate
  const occupancyRate = data.totalRooms > 0
    ? Math.round((data.occupiedRooms / data.totalRooms) * 100)
    : 0

  const trendText = data.trend.map(t =>
    `  ${t.month}: 수입 ${(t.revenue / 10000).toFixed(0)}만원 / 지출 ${(t.expense / 10000).toFixed(0)}만원 / 순수익 ${(t.profit / 10000).toFixed(0)}만원`
  ).join('\n')

  // 카테고리 금액은 화면 도넛과 같은 축이다 — 기록된 지출 + 고정 지출 (예정), 분모는 예상 지출.
  // 기록분만 적던 시절엔 프롬프트가 임대료 없는 지출 구성을 읽고 "임대료 부담이 없다"고 답할 수 있었다.
  const categoryText = data.categoryBreakdown.length > 0
    ? data.categoryBreakdown.map(c =>
        `  ${c.category}: ${(c.amount / 10000).toFixed(0)}만원 (${c.percent}%)${c.pending > 0 ? ` — 이 중 예정 ${(c.pending / 10000).toFixed(0)}만원` : ''}`
      ).join('\n')
    : '  지출 없음'

  const prompt = `
당신은 부동산 임대업 전문 재무 분석가입니다.
아래는 숙박업소(원룸/게스트하우스) 운영 현황 데이터입니다. 한국어로 간결하고 실용적인 재무 분석을 작성해주세요.

[분석 대상 월: ${targetMonth}]

■ 이달 재무 요약
- 총 수입: ${(data.totalRevenue / 10000).toFixed(1)}만원 (순수 이용료 ${(data.paidRevenue / 10000).toFixed(1)}만원)
- 기록된 지출: ${(data.totalExpense / 10000).toFixed(1)}만원
- 운영이익: ${(data.netProfit / 10000).toFixed(1)}만원
- 보유 보증금: ${(data.totalDeposit / 10000).toFixed(0)}만원

■ 수납 현황
- 완납: ${data.paidCount}건 / 수납예정: ${data.awaitingCount}건 / 미납: ${data.unpaidCount}건 (수납률 ${paymentRate}%)

■ 지출 카테고리 (예상 지출 기준 — 기록분 + 미기록 고정 지출 예정분)
${categoryText}

■ 6개월 트렌드
${trendText}

■ 입주 현황
- 전체 호실: ${data.totalRooms}실 / 입주중: ${data.occupiedRooms}실 / 공실: ${data.vacantRooms}실 (입주율 ${occupancyRate}%)
- 거주중: ${data.statusCounts.active}명 / 입실예정: ${data.statusCounts.reserved}명 / 퇴실예정: ${data.statusCounts.checkout}명

아래 항목을 포함해 분석해주세요:
1. 이달 재무 상태 총평 (수익성, 지출 적정성)
2. 수납 현황 진단 (미납 리스크)
3. 트렌드 기반 주목할 변화
4. 공실/입주율 관련 운영 리스크
5. 개선 포인트 1~2가지 (구체적이고 실행 가능한 제안)

분석 결과는 항목별 소제목을 사용하되, 각 항목을 2~3문장으로 간결하게 작성해주세요.
`.trim()

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
      }),
    }
  )

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    return `[오류] Gemini API 응답 실패 (${res.status})${errBody ? ': ' + errBody.slice(0, 200) : ''}`
  }
  const json = await res.json()
  const parts: { text?: string; thought?: boolean }[] = json.candidates?.[0]?.content?.parts ?? []
  const text = parts.find(p => p.text && !p.thought)?.text ?? parts.find(p => p.text)?.text
  return text ?? '분석 결과를 가져올 수 없습니다.'
}

// ============================================================
// 미납 안내 문자 발송 플로우 (/docs/stayeum_payment_spec.md Phase 1)
//   실제 발송은 운영자 폰 문자앱(sms: 링크) — 여기서는 컨텍스트 조회와 '발송 시도' 이력만.
// ============================================================
export type UnpaidSmsContext = {
  ok: true
  phone: string | null          // 없으면 발송 불가 안내
  tenantName: string
  roomNo: string
  dueDayLabel: string           // "15일" | "말일" | ''
  bankAccount: string           // 환경설정 입금 계좌 (없으면 '')
  templates: { id: string; name: string; body: string }[]
} | { ok: false; error: string }

export async function getUnpaidSmsContext(leaseId: string): Promise<UnpaidSmsContext> {
  try {
    const access = await getPropertyAccess()
    if (!access) return { ok: false, error: '접근 권한이 없습니다.' }
    const propertyId = access.propertyId
    const lease = await prisma.leaseTerm.findFirst({
      where: { id: leaseId, propertyId },
      select: {
        dueDay: true,
        room: { select: { roomNo: true } },
        tenant: { select: { name: true, contacts: { where: { contactType: 'PHONE' }, orderBy: { createdAt: 'asc' }, select: { contactValue: true }, take: 1 } } },
      },
    })
    if (!lease) return { ok: false, error: '입주 정보를 찾을 수 없습니다.' }
    const [prop, templates] = await Promise.all([
      prisma.property.findUnique({ where: { id: propertyId }, select: { bankAccount: true } }),
      prisma.smsTemplate.findMany({ where: { propertyId, kind: 'unpaid' }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true, name: true, body: true } }),
    ])
    const rawDue = (lease.dueDay ?? '').trim()
    const dueDayLabel = rawDue ? (/^\d+$/.test(rawDue) ? `${rawDue}일` : rawDue) : ''
    return {
      ok: true,
      phone: lease.tenant.contacts[0]?.contactValue?.trim() || null,
      tenantName: lease.tenant.name,
      roomNo: lease.room?.roomNo ?? '',
      dueDayLabel,
      bankAccount: prop?.bankAccount ?? '',
      templates,
    }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '조회에 실패했습니다.' }
  }
}

// 특정 입주자 1명의 미납 독촉 대상 — 정본 computeUnpaidStatus 를 tenantId 로 필터(계산 로직 복제 금지).
// 납부일 경과 미납(daysOverdue>=1 · unpaidAmount>0)이 아니면 null → 입주자 상세 독촉 버튼 미노출.
// 반환 구조는 UnpaidSmsModal 의 UnpaidSmsTarget 과 동일(그대로 넘겨 재사용).
export type TenantUnpaidTarget = {
  leaseId: string; tenantId: string; tenantName: string; roomNo: string
  unpaidAmount: number; daysOverdue: number | null
}
export async function getTenantUnpaidTarget(tenantId: string): Promise<TenantUnpaidTarget | null> {
  try {
    const access = await getPropertyAccess()
    if (!access) return null
    const { unpaidLeases } = await computeUnpaidStatus(access.propertyId)
    const l = unpaidLeases.find(x => x.tenantId === tenantId && x.unpaidAmount > 0 && (x.daysOverdue ?? -1) >= 1)
    if (!l) return null
    return { leaseId: l.leaseId, tenantId: l.tenantId, tenantName: l.tenantName, roomNo: l.roomNo, unpaidAmount: l.unpaidAmount, daysOverdue: l.daysOverdue }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return null
  }
}

// ============================================================
// 입주자 문자(개인) 발송 플로우 — 입주자 상세의 '문자' 버튼(신고 962c65d2)
//   미납 흐름과 달리 청구 정보 없이 이름·호수·계좌번호 3종만 치환. 실제 발송은 폰 문자앱.
// ============================================================
export type PersonalSmsContext = {
  ok: true
  phone: string | null          // 없으면 발송 불가 안내
  tenantName: string
  roomNo: string                // 현재/최근 방 배정 (없으면 '')
  bankAccount: string           // 환경설정 입금 계좌 (없으면 '')
  templates: { id: string; name: string; body: string }[]
} | { ok: false; error: string }

export async function getPersonalSmsContext(tenantId: string): Promise<PersonalSmsContext> {
  try {
    const access = await getPropertyAccess()
    if (!access) return { ok: false, error: '접근 권한이 없습니다.' }
    const propertyId = access.propertyId
    const tenant = await prisma.tenant.findFirst({
      where: { id: tenantId, propertyId },
      select: {
        name: true,
        contacts: { where: { contactType: 'PHONE' }, orderBy: { createdAt: 'asc' }, select: { contactValue: true }, take: 1 },
        // take: 1 을 뺐다 — 방을 둘 쓰는 사람에게 문자 머리말이 창고 호실을 적으면 안 된다.
        // 메인 계약(primaryTenantLease)의 호실이 그 사람의 호실이다.
        leaseTerms: {
          where: { roomId: { not: null } },
          orderBy: { createdAt: 'desc' },
          select: { status: true, moveInDate: true, room: { select: { roomNo: true } } },
        },
      },
    })
    if (!tenant) return { ok: false, error: '입주자 정보를 찾을 수 없습니다.' }
    const [prop, templates] = await Promise.all([
      prisma.property.findUnique({ where: { id: propertyId }, select: { bankAccount: true } }),
      prisma.smsTemplate.findMany({ where: { propertyId, kind: 'personal' }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true, name: true, body: true } }),
    ])
    return {
      ok: true,
      phone: tenant.contacts[0]?.contactValue?.trim() || null,
      tenantName: tenant.name,
      roomNo: primaryTenantLease(tenant.leaseTerms)?.room?.roomNo ?? '',
      bankAccount: prop?.bankAccount ?? '',
      templates,
    }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '조회에 실패했습니다.' }
  }
}

// 입주자 문자 발송 시도 기록 — 1행(kind: 'personal'). 실제 발송은 폰 문자앱에서 완료된다.
export async function logPersonalSmsAttempt(input: {
  tenantId: string
  renderedBody: string
  templateId?: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const access = await getPropertyAccess()
    if (!access) return { ok: false, error: '접근 권한이 없습니다.' }
    if (!input.renderedBody.trim()) return { ok: false, error: '본문이 비어 있습니다.' }
    await prisma.smsLog.create({ data: {
      propertyId: access.propertyId,
      tenantId: input.tenantId,
      templateId: input.templateId ?? null,
      renderedBody: input.renderedBody,
      sentVia: 'manual_sms',
      kind: 'personal',
    } })
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '이력 기록에 실패했습니다.' }
  }
}

export async function logSmsAttempt(input: {
  tenantId: string; leaseTermId: string | null; templateId: string | null
  renderedBody: string; overdueAmount: number | null; overdueDays: number | null
  paymentCheckConfirmedAt: string   // ISO — 기능1 확인 다이얼로그 통과 시각
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const access = await getPropertyAccess()
    if (!access) return { ok: false, error: '접근 권한이 없습니다.' }
    if (!input.renderedBody.trim()) return { ok: false, error: '본문이 비어 있습니다.' }
    await prisma.smsLog.create({ data: {
      propertyId: access.propertyId,
      tenantId: input.tenantId,
      leaseTermId: input.leaseTermId,
      templateId: input.templateId,
      renderedBody: input.renderedBody,
      overdueAmount: input.overdueAmount,
      overdueDays: input.overdueDays,
      paymentCheckConfirmedAt: new Date(input.paymentCheckConfirmedAt),
      sentVia: 'manual_sms',
    } })
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '이력 기록에 실패했습니다.' }
  }
}
