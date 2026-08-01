'use server'

import { getPropertyAccess } from '@/lib/auth/propertyAccess'
import { consumeGeminiAccess } from '@/lib/geminiKey'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import type { DashboardData } from './DashboardClient'
import { computeUnpaidStatus } from './unpaid'

// ── 추이 차트 ────────────────────────────────────────────────────

export type TrendRange = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'biannual' | 'annual' | 'all'
export type TrendPoint = { label: string; revenue: number; expense: number; profit: number }

async function getTrendPropertyId(): Promise<string | null> {
  return (await getPropertyAccess())?.propertyId ?? null
}

function ds(d: Date) { return d.toISOString().slice(0, 10) }

function addMonths(m: string, delta: number): string {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

async function fetchRangeData(propertyId: string, startDate: Date, endDate: Date, months?: string[], acquisitionDate?: Date | null) {
  const acqFilter = acquisitionDate ? { payDate: { gte: acquisitionDate } } : {}
  return Promise.all([
    prisma.paymentRecord.findMany({
      // RESERVED 선납·취소분은 트렌드 매출에서 제외(조기 매출 노출 차단). CHECKED_OUT는 유지(단기·중도퇴실 매출 보존).
      where: months
        ? { propertyId, targetMonth: { in: months }, isDeposit: false, isPrevOwner: false, leaseTerm: { status: { notIn: ['RESERVED', 'CANCELLED'] } }, ...acqFilter }
        : { propertyId, payDate: { gte: acquisitionDate && acquisitionDate > startDate ? acquisitionDate : startDate, lte: endDate }, isDeposit: false, isPrevOwner: false, leaseTerm: { status: { notIn: ['RESERVED', 'CANCELLED'] } } },
      select: { targetMonth: true, payDate: true, actualAmount: true },
    }),
    prisma.expense.findMany({
      where: { propertyId, date: { gte: startDate, lte: endDate } },
      select: { date: true, amount: true },
    }),
    prisma.extraIncome.findMany({
      where: { propertyId, date: { gte: startDate, lte: endDate } },
      select: { date: true, amount: true },
    }),
  ])
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
    const startDate = new Date(tyear, tmonth - 1, 1)
    const endDate   = new Date(tyear, tmonth, 0)
    const [payments, expenses, incomes] = await fetchRangeData(propertyId, startDate, endDate, undefined, acquisitionDate)

    return Array.from({ length: endDate.getDate() }, (_, i) => {
      const dayStr = ds(new Date(tyear, tmonth - 1, i + 1))
      const revenue =
        payments.filter(p => p.payDate && ds(new Date(p.payDate)) === dayStr).reduce((s, p) => s + p.actualAmount, 0) +
        incomes.filter(i => ds(new Date(i.date)) === dayStr).reduce((s, i) => s + i.amount, 0)
      const expense = expenses.filter(e => ds(new Date(e.date)) === dayStr).reduce((s, e) => s + e.amount, 0)
      return { label: `${i + 1}일`, revenue, expense, profit: revenue - expense }
    })
  }

  // ── 주간: targetMonth 끝 기준 12주 ──────────────────────────
  if (range === 'weekly') {
    const endDate = new Date(tyear, tmonth, 0)
    const lastSat = new Date(endDate)
    lastSat.setDate(endDate.getDate() + (6 - endDate.getDay()))

    const weeks = Array.from({ length: 12 }, (_, i) => {
      const end   = new Date(lastSat); end.setDate(lastSat.getDate() - (11 - i) * 7)
      const start = new Date(end);     start.setDate(end.getDate() - 6)
      return { start, end }
    })

    const [payments, expenses, incomes] = await fetchRangeData(propertyId, weeks[0].start, weeks[11].end, undefined, acquisitionDate)
    return weeks.map(w => {
      const inW = (d: Date) => d >= w.start && d <= w.end
      const revenue =
        payments.filter(p => p.payDate && inW(new Date(p.payDate))).reduce((s, p) => s + p.actualAmount, 0) +
        incomes.filter(i => inW(new Date(i.date))).reduce((s, i) => s + i.amount, 0)
      const expense = expenses.filter(e => inW(new Date(e.date))).reduce((s, e) => s + e.amount, 0)
      return { label: `${w.start.getMonth() + 1}/${w.start.getDate()}`, revenue, expense, profit: revenue - expense }
    })
  }

  // ── 월간(12개월) / 반년(6개월) ───────────────────────────────
  if (range === 'monthly' || range === 'biannual') {
    const months = Array.from({ length: range === 'monthly' ? 12 : 6 }, (_, i) =>
      addMonths(targetMonth, i - (range === 'monthly' ? 11 : 5))
    )
    const [fy, fm] = months[0].split('-').map(Number)
    const [ly, lm] = months[months.length - 1].split('-').map(Number)
    const [payments, expenses, incomes] = await fetchRangeData(
      propertyId, new Date(fy, fm - 1, 1), new Date(ly, lm, 0), months, acquisitionDate
    )
    return months.map(m => {
      const [y, mo] = m.split('-').map(Number)
      const mStart = new Date(y, mo - 1, 1); const mEnd = new Date(y, mo, 0)
      const inM = (d: Date) => d >= mStart && d <= mEnd
      const revenue =
        payments.filter(p => p.targetMonth === m).reduce((s, p) => s + p.actualAmount, 0) +
        incomes.filter(i => inM(new Date(i.date))).reduce((s, i) => s + i.amount, 0)
      const expense = expenses.filter(e => inM(new Date(e.date))).reduce((s, e) => s + e.amount, 0)
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
    const [fy, fm] = quarters[0].months[0].split('-').map(Number)
    const [ly, lm] = quarters[7].months[2].split('-').map(Number)
    const [payments, expenses, incomes] = await fetchRangeData(
      propertyId, new Date(fy, fm - 1, 1), new Date(ly, lm, 0), allMonths, acquisitionDate
    )
    return quarters.map(({ year, q, months }) => {
      const [fy2, fm2] = months[0].split('-').map(Number)
      const [ly2, lm2] = months[2].split('-').map(Number)
      const qStart = new Date(fy2, fm2 - 1, 1); const qEnd = new Date(ly2, lm2, 0)
      const inQ = (d: Date) => d >= qStart && d <= qEnd
      const revenue =
        payments.filter(p => months.includes(p.targetMonth!)).reduce((s, p) => s + p.actualAmount, 0) +
        incomes.filter(i => inQ(new Date(i.date))).reduce((s, i) => s + i.amount, 0)
      const expense = expenses.filter(e => inQ(new Date(e.date))).reduce((s, e) => s + e.amount, 0)
      return { label: `${year}Q${q}`, revenue, expense, profit: revenue - expense }
    })
  }

  // ── 연간: 연도별 전체 ────────────────────────────────────────
  if (range === 'annual') {
    const [payments, expenses, incomes] = await Promise.all([
      // RESERVED 선납·취소분 제외 — 월별(fetchRangeData)과 같은 규칙. 연간·전체만 필터가 빠져 있어
      // 아직 입주도 안 한 예약자의 선납이 조기 매출로 잡혔다(A페이즈).
      prisma.paymentRecord.findMany({ where: { propertyId, isDeposit: false, isPrevOwner: false, leaseTerm: { status: { notIn: ['RESERVED', 'CANCELLED'] } }, ...(acquisitionDate ? { payDate: { gte: acquisitionDate } } : {}) }, select: { targetMonth: true, actualAmount: true } }),
      prisma.expense.findMany({ where: { propertyId }, select: { date: true, amount: true } }),
      prisma.extraIncome.findMany({ where: { propertyId }, select: { date: true, amount: true } }),
    ])
    const years = new Set<number>()
    payments.forEach(p => years.add(parseInt(p.targetMonth.slice(0, 4))))
    expenses.forEach(e => years.add(new Date(e.date).getFullYear()))
    incomes.forEach(i => years.add(new Date(i.date).getFullYear()))
    return [...years].sort().map(year => {
      const revenue =
        payments.filter(p => p.targetMonth.startsWith(`${year}`)).reduce((s, p) => s + p.actualAmount, 0) +
        incomes.filter(i => new Date(i.date).getFullYear() === year).reduce((s, i) => s + i.amount, 0)
      const expense = expenses.filter(e => new Date(e.date).getFullYear() === year).reduce((s, e) => s + e.amount, 0)
      return { label: `${year}년`, revenue, expense, profit: revenue - expense }
    })
  }

  // ── 전체: 모든 월 ────────────────────────────────────────────
  if (range === 'all') {
    const [payments, expenses, incomes] = await Promise.all([
      // RESERVED 선납·취소분 제외 — 월별(fetchRangeData)과 같은 규칙. 연간·전체만 필터가 빠져 있어
      // 아직 입주도 안 한 예약자의 선납이 조기 매출로 잡혔다(A페이즈).
      prisma.paymentRecord.findMany({ where: { propertyId, isDeposit: false, isPrevOwner: false, leaseTerm: { status: { notIn: ['RESERVED', 'CANCELLED'] } }, ...(acquisitionDate ? { payDate: { gte: acquisitionDate } } : {}) }, select: { targetMonth: true, actualAmount: true } }),
      prisma.expense.findMany({ where: { propertyId }, select: { date: true, amount: true } }),
      prisma.extraIncome.findMany({ where: { propertyId }, select: { date: true, amount: true } }),
    ])
    const monthSet = new Set<string>()
    payments.forEach(p => monthSet.add(p.targetMonth))
    expenses.forEach(e => { const d = new Date(e.date); monthSet.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`) })
    incomes.forEach(i => { const d = new Date(i.date); monthSet.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`) })
    const months = [...monthSet].sort()
    return months.map(m => {
      const [y, mo] = m.split('-').map(Number)
      const mStart = new Date(y, mo - 1, 1); const mEnd = new Date(y, mo, 0)
      const inM = (d: Date) => d >= mStart && d <= mEnd
      const revenue =
        payments.filter(p => p.targetMonth === m).reduce((s, p) => s + p.actualAmount, 0) +
        incomes.filter(i => inM(new Date(i.date))).reduce((s, i) => s + i.amount, 0)
      const expense = expenses.filter(e => inM(new Date(e.date))).reduce((s, e) => s + e.amount, 0)
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

  const paymentRate = (data.paidCount + data.unpaidCount) > 0
    ? Math.round((data.paidCount / (data.paidCount + data.unpaidCount)) * 100)
    : 0
  const occupancyRate = data.totalRooms > 0
    ? Math.round((data.occupiedRooms / data.totalRooms) * 100)
    : 0

  const trendText = data.trend.map(t =>
    `  ${t.month}: 수입 ${(t.revenue / 10000).toFixed(0)}만원 / 지출 ${(t.expense / 10000).toFixed(0)}만원 / 순수익 ${(t.profit / 10000).toFixed(0)}만원`
  ).join('\n')

  const categoryText = data.categoryBreakdown.length > 0
    ? data.categoryBreakdown.map(c =>
        `  ${c.category}: ${(c.amount / 10000).toFixed(0)}만원 (${c.percent}%)`
      ).join('\n')
    : '  지출 없음'

  const prompt = `
당신은 부동산 임대업 전문 재무 분석가입니다.
아래는 숙박업소(원룸/게스트하우스) 운영 현황 데이터입니다. 한국어로 간결하고 실용적인 재무 분석을 작성해주세요.

[분석 대상 월: ${targetMonth}]

■ 이달 재무 요약
- 총 수입: ${(data.totalRevenue / 10000).toFixed(1)}만원 (순수 이용료 ${(data.paidRevenue / 10000).toFixed(1)}만원)
- 총 지출: ${(data.totalExpense / 10000).toFixed(1)}만원
- 순수익: ${(data.netProfit / 10000).toFixed(1)}만원
- 보유 보증금: ${(data.totalDeposit / 10000).toFixed(0)}만원

■ 수납 현황
- 완납: ${data.paidCount}건 / 미납: ${data.unpaidCount}건 (수납률 ${paymentRate}%)

■ 지출 카테고리
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
// 납부일 경과 미납(daysOverdue>=1 · unpaidAmount>0)이 아니면 null → 고객 상세 독촉 버튼 미노출.
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
// 고객 문자(개인) 발송 플로우 — 고객 상세의 '문자' 버튼(신고 962c65d2)
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
        leaseTerms: {
          where: { roomId: { not: null } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { room: { select: { roomNo: true } } },
        },
      },
    })
    if (!tenant) return { ok: false, error: '고객 정보를 찾을 수 없습니다.' }
    const [prop, templates] = await Promise.all([
      prisma.property.findUnique({ where: { id: propertyId }, select: { bankAccount: true } }),
      prisma.smsTemplate.findMany({ where: { propertyId, kind: 'personal' }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true, name: true, body: true } }),
    ])
    return {
      ok: true,
      phone: tenant.contacts[0]?.contactValue?.trim() || null,
      tenantName: tenant.name,
      roomNo: tenant.leaseTerms[0]?.room?.roomNo ?? '',
      bankAccount: prop?.bankAccount ?? '',
      templates,
    }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '조회에 실패했습니다.' }
  }
}

// 고객 문자 발송 시도 기록 — 1행(kind: 'personal'). 실제 발송은 폰 문자앱에서 완료된다.
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
