// 고정지출 '그 달 현황'(기록 여부·추정 금액) 단일 원천 — 'use server' 아님(클라이언트 비노출).
//
// 재무 지출 탭의 예정 행, 홈 AlertsStrip, 그리고 푸시·인앱 종의 '오늘 출금·납부' 알림이
// **모두 이 함수 하나**를 쓴다. 재무 화면은 세션에서 영업장을 푸는 얇은 서버액션
// (finance/actions getRecurringExpensesWithStatus)을 거치고, 세션이 없는 크론은 propertyId 를
// 직접 넘겨 부른다. '이번 달 기록이 있으면 예정 행이 사라진다'는 판정을 알림이 손으로 다시 쓰면
// 재무 화면에선 사라진 항목이 알림에만 남는다(신고 568633fb).

import prisma from '@/lib/prisma'

export type RecurringExpenseWithStatus = {
  id: string
  title: string
  amount: number
  category: string
  dueDay: number
  payMethod: string | null
  financialAccountId: string | null
  isAutoDebit: boolean
  isVariable: boolean
  alertDaysBefore: number
  activeSince: string | null
  isPending: boolean        // activeSince가 이번 달 이후 → 아직 활성화 전
  memo: string | null
  // 이번 달 기록 여부
  recordedExpenseId: string | null
  recordedAmount: number | null
  recordedDate: string | null
  // 변동 항목 과거 평균
  historicalAvg: number | null
  // 미리 입력된 예약 금액 — 결제일 모달에서 prefill될 값. 기록 시 자동 클리어
  pendingAmount: number | null
  // #6: 가장 최근 실제 기록의 결제수단·계좌 — 기록 모달 기본값으로 사용(지난달 처리 방식 자동 대기). 없으면 null
  lastPayMethod: string | null
  lastFinancialAccountId: string | null
  // #1: 세부항목(있으면 '관리비 묶음' 부모). 합계 = 세부 amount 합, 변동 = 하나라도 변동.
  items: { id: string; name: string; amount: number; isVariable: boolean; sortOrder: number }[]
}

export async function computeRecurringExpensesWithStatus(propertyId: string, month: string): Promise<RecurringExpenseWithStatus[]> {
  const [year, m] = month.split('-').map(Number)
  const startDate = new Date(year, m - 1, 1)
  const endDate   = new Date(year, m, 0)

  const [allRecurring, recordedThisMonth] = await Promise.all([
    prisma.recurringExpense.findMany({
      where: { propertyId, isActive: true },
      orderBy: { dueDay: 'asc' },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    }),
    prisma.expense.findMany({
      where: { propertyId, recurringExpenseId: { not: null }, date: { gte: startDate, lte: endDate } },
      select: { id: true, recurringExpenseId: true, amount: true, date: true },
    }),
  ])

  // activeSince: 이번 달 마지막 날보다 미래면 isPending=true (목록엔 표시하되 기록 불가)
  const recurringList = allRecurring

  const recordedMap = new Map(recordedThisMonth.map(e => [e.recurringExpenseId!, e]))

  // #6: 각 고정지출의 '가장 최근 실제 기록'의 결제수단·계좌 — 기록 모달 기본값(지난달 처리 방식 자동 대기)
  const recurringIds = recurringList.map(re => re.id)
  const lastRecords = recurringIds.length > 0
    ? await prisma.expense.findMany({
        where: { propertyId, recurringExpenseId: { in: recurringIds } },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        select: { recurringExpenseId: true, payMethod: true, financialAccountId: true },
      })
    : []
  const lastRecordMap = new Map<string, { payMethod: string | null; financialAccountId: string | null }>()
  for (const e of lastRecords) {
    const id = e.recurringExpenseId!
    if (!lastRecordMap.has(id)) lastRecordMap.set(id, { payMethod: e.payMethod, financialAccountId: e.financialAccountId })
  }

  // 변동 항목 최근 3개월 평균 + 전년동월 수치 (isPending 항목 제외)
  const variableIds = recurringList.filter(re => (re as any).isVariable && !(new Date((re as any).activeSince ?? 0) > endDate)).map(re => re.id)
  const threeMonthsAgo = new Date(year, m - 4, 1) // 3개월 전 1일
  const pastExpenses = variableIds.length > 0
    ? await prisma.expense.findMany({
        where: { propertyId, recurringExpenseId: { in: variableIds }, date: { gte: threeMonthsAgo, lt: startDate } },
        select: { recurringExpenseId: true, amount: true },
      })
    : []

  const varSum: Record<string, number> = {}
  const varCnt: Record<string, number> = {}
  for (const e of pastExpenses) {
    const id = e.recurringExpenseId!
    varSum[id] = (varSum[id] ?? 0) + e.amount
    varCnt[id] = (varCnt[id] ?? 0) + 1
  }

  return recurringList.map(re => {
    const recorded = recordedMap.get(re.id)
    const isVar = (re as any).isVariable as boolean
    const priorYearAmt = (re as any).priorYearAmount as number | null
    const recentCnt = varCnt[re.id] ?? 0
    const recentSum = varSum[re.id] ?? 0
    let historicalAvgVal: number | null = null
    if (isVar) {
      const dataPoints: number[] = []
      if (recentCnt >= 1) dataPoints.push(Math.round(recentSum / recentCnt))
      if (priorYearAmt) dataPoints.push(priorYearAmt)
      if (dataPoints.length >= 1) {
        historicalAvgVal = Math.round(dataPoints.reduce((s, v) => s + v, 0) / dataPoints.length)
      }
    }
    const as = (re as any).activeSince as Date | null
    const isPending = !!(as && new Date(as) > endDate)
    return {
      id:                re.id,
      title:             re.title,
      amount:            re.amount,
      category:          re.category,
      dueDay:            re.dueDay,
      payMethod:         re.payMethod,
      financialAccountId: re.financialAccountId,
      isAutoDebit:       re.isAutoDebit,
      isVariable:        isVar,
      alertDaysBefore:   re.alertDaysBefore,
      activeSince:       as ? new Date(as).toISOString().slice(0, 10) : null,
      isPending,
      memo:              re.memo,
      recordedExpenseId: isPending ? null : (recorded?.id ?? null),
      recordedAmount:    isPending ? null : (recorded?.amount ?? null),
      recordedDate:      isPending ? null : (recorded ? new Date(recorded.date).toISOString().slice(0, 10) : null),
      historicalAvg:     historicalAvgVal,
      pendingAmount:     (re as any).pendingAmount ?? null,
      lastPayMethod:        lastRecordMap.get(re.id)?.payMethod ?? null,
      lastFinancialAccountId: lastRecordMap.get(re.id)?.financialAccountId ?? null,
      items: ((re as any).items ?? []).map((it: { id: string; name: string; amount: number; isVariable: boolean; sortOrder: number }) => ({
        id: it.id, name: it.name, amount: it.amount, isVariable: it.isVariable, sortOrder: it.sortOrder,
      })),
    }
  })
}
