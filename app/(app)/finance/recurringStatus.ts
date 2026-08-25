// 고정지출 '그 달 현황'(기록 여부·추정 금액) 단일 원천 — 'use server' 아님(클라이언트 비노출).
//
// 재무 지출 탭의 예정 행, 홈 AlertsStrip, 그리고 푸시·인앱 종의 '오늘 출금·납부' 알림이
// **모두 이 함수 하나**를 쓴다. 재무 화면은 세션에서 영업장을 푸는 얇은 서버액션
// (finance/actions getRecurringExpensesWithStatus)을 거치고, 세션이 없는 크론은 propertyId 를
// 직접 넘겨 부른다. '이번 달 기록이 있으면 예정 행이 사라진다'는 판정을 알림이 손으로 다시 쓰면
// 재무 화면에선 사라진 항목이 알림에만 남는다(신고 568633fb).

import prisma from '@/lib/prisma'
import { dbDateMonthKey, monthDbRange, monthsDbRange } from '@/lib/kstDate'
import { isRecurringDueMonth, nextRecurringDueMonth } from '@/lib/recurringDueDate'

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
  // 주기(신고 7e7da5c4) — 1=매월 · 2=격월 · 3=분기 · 6=반기 · 12=연1회.
  intervalMonths: number
  anchorMonth: number | null
  createdAt: string
  // 이 달에 도래하는가 — **판정은 여기 한 번뿐이다.** 화면·알림이 다시 계산하면 갈린다.
  // interval 1(기존 전건)은 항상 true 라 얹어도 거동이 한 글자도 안 바뀐다.
  isDueThisMonth: boolean
  // 이 달에 안 나가면 다음은 언제인가 'YYYY-MM' — 재무 화면이 "사라진 게 아니다"를 말하는 근거.
  nextDueMonth: string
  memo: string | null
  // 이번 달 기록 여부
  recordedExpenseId: string | null
  recordedAmount: number | null
  recordedDate: string | null
  // 작년 같은 달 실제 기록의 그 달 합계 (없으면 null)
  priorYearActual: number | null
  // 운영자가 고정지출 폼에 손으로 적어 둔 전년 동월 실적 (없으면 null)
  priorYearAmount: number | null
  // 직전 3개월 중 기록이 있는 달의 '월 합계' 평균 (없으면 null)
  recentAvg: number | null
  // 이 현황이 어느 달의 것인지 'YYYY-MM' — 추정 라벨의 '작년 8월'이 여기서 나온다
  estimateMonth: string
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
  // '이번 달' 창 — lib/kstDate 정본. 로컬 자정으로 잡던 시절엔 KST 기기에서 창이 하루 밀려
  // 7/31 전기요금이 8월 기록으로 판정됐고, 그 바람에 예정 행이 사라졌다(2026-08 실측).
  const thisMonth = monthDbRange(month)

  const [allRecurring, recordedThisMonth] = await Promise.all([
    prisma.recurringExpense.findMany({
      where: { propertyId, isActive: true },
      orderBy: { dueDay: 'asc' },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    }),
    prisma.expense.findMany({
      where: { propertyId, recurringExpenseId: { not: null }, date: thisMonth },
      select: { id: true, recurringExpenseId: true, amount: true, date: true },
    }),
  ])

  // activeSince: 이번 달보다 뒤의 달이면 isPending=true (목록엔 표시하되 기록 불가)
  const recurringList = allRecurring

  const recordedMap = new Map(recordedThisMonth.map(e => [e.recurringExpenseId!, e]))

  // ── 이력 창 ──────────────────────────────────────────────────
  // 창은 '진짜 달력 달'로 잡는다. @db.Date 칸은 UTC 자정으로 저장되고 Prisma 는 경계 Date 의 날짜부만
  // 비교에 쓰므로, KST 기기에서 new Date(y, m - 1, 1) 로 경계를 만들면 창이 하루씩 앞으로 밀린다
  // (2026-08 실측: '최근 3개월'에 4/30 기록이 딸려 들어오고 7/31 기록이 빠졌다). 정본은 lib/kstDate.
  const ymKey = (y: number, mo: number) => `${y}-${String(mo).padStart(2, '0')}`
  // 직전 3개월 — 연말을 넘어가도 어긋나지 않게 0-based 월 인덱스로 센다
  const recentMonths = [3, 2, 1].map(back => {
    const idx = (m - 1) - back
    return { y: year + Math.floor(idx / 12), mo: (((idx % 12) + 12) % 12) + 1 }
  })
  const recentRange = monthsDbRange(
    ymKey(recentMonths[0].y, recentMonths[0].mo),
    ymKey(recentMonths[2].y, recentMonths[2].mo),
  )

  const recurringIds = recurringList.map(re => re.id)
  // 활성화 예정 판정은 '달' 단위다 — activeSince 가 이번 달보다 뒤면 아직 볼 이력이 없다.
  // Date 부등호로 재던 시절엔 말일 경계에서 실행 환경 타임존만큼 판정이 갈렸다.
  const isPendingOf = (re: { activeSince: Date | null }) => !!(re.activeSince && dbDateMonthKey(re.activeSince) > month)
  // 아직 활성 전(isPending)인 항목은 볼 이력이 없다
  const historyIds = recurringList.filter(re => !isPendingOf(re)).map(re => re.id)

  // #6: 각 고정지출의 '가장 최근 실제 기록'의 결제수단·계좌 — 기록 모달 기본값(지난달 처리 방식 자동 대기)
  // 세 조회 모두 위의 recurringList 하나에만 의존하므로 병렬로 묶는다 — 이력 조회가 늘어도 왕복은 그대로다.
  const [lastRecords, recentExpenses, priorYearExpenses] = await Promise.all([
    recurringIds.length > 0
      ? prisma.expense.findMany({
          where: { propertyId, recurringExpenseId: { in: recurringIds } },
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          select: { recurringExpenseId: true, payMethod: true, financialAccountId: true },
        })
      : Promise.resolve([]),
    historyIds.length > 0
      ? prisma.expense.findMany({
          where: { propertyId, recurringExpenseId: { in: historyIds }, date: recentRange },
          select: { recurringExpenseId: true, amount: true, date: true },
        })
      : Promise.resolve([]),
    historyIds.length > 0
      ? prisma.expense.findMany({
          where: { propertyId, recurringExpenseId: { in: historyIds }, date: monthDbRange(ymKey(year - 1, m)) },
          select: { recurringExpenseId: true, amount: true },
        })
      : Promise.resolve([]),
  ])

  const lastRecordMap = new Map<string, { payMethod: string | null; financialAccountId: string | null }>()
  for (const e of lastRecords) {
    const id = e.recurringExpenseId!
    if (!lastRecordMap.has(id)) lastRecordMap.set(id, { payMethod: e.payMethod, financialAccountId: e.financialAccountId })
  }

  // 최근 3개월 — 건수가 아니라 **월 합계**를 모아 기록이 있는 달 수로 나눈다.
  // 건수로 나누면 한 달에 두 번 낸 항목(분할·소급 납부)의 그 달 유출액이 절반으로 세어진다.
  const monthSum = new Map<string, number>()   // `${recurringId}|${YYYY-MM}` → 그 달 합계
  for (const e of recentExpenses) {
    const key = `${e.recurringExpenseId!}|${dbDateMonthKey(e.date)}`
    monthSum.set(key, (monthSum.get(key) ?? 0) + e.amount)
  }
  // 작년 같은 달 — 그 달에 실제로 나간 총액이므로 합계다(평균이 아니다).
  const priorYearSum: Record<string, number> = {}
  for (const e of priorYearExpenses) {
    const id = e.recurringExpenseId!
    priorYearSum[id] = (priorYearSum[id] ?? 0) + e.amount
  }

  return recurringList.map(re => {
    const recorded = recordedMap.get(re.id)
    const isVar = (re as any).isVariable as boolean
    // 0 이하는 추정 근거로 쓰지 않는다 — 취소·상계로 남은 0원 기록이 그대로 '이번 달 예상'이 되면
    // 운영자는 "이 달은 안 나간다"로 읽는다.
    const priorYearActual = (priorYearSum[re.id] ?? 0) > 0 ? priorYearSum[re.id] : null
    const monthly = recentMonths
      .map(({ y, mo }) => monthSum.get(`${re.id}|${ymKey(y, mo)}`))
      .filter((v): v is number => v != null && v > 0)
    const recentAvg = monthly.length > 0
      ? Math.round(monthly.reduce((s, v) => s + v, 0) / monthly.length)
      : null
    const as = (re as any).activeSince as Date | null
    const isPending = isPendingOf({ activeSince: as })
    // 주기 판정 — lib/recurringDueDate 정본 하나가 답한다(화면·알림은 이 값을 읽기만 한다).
    const row = re as { intervalMonths?: number | null; anchorMonth?: number | null; createdAt: Date }
    const cycle = {
      intervalMonths: row.intervalMonths ?? 1,
      anchorMonth: row.anchorMonth ?? null,
      activeSince: as,
      createdAt: row.createdAt,
    }
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
      intervalMonths:    cycle.intervalMonths,
      anchorMonth:       cycle.anchorMonth,
      createdAt:         new Date(cycle.createdAt).toISOString(),
      isDueThisMonth:    isRecurringDueMonth(cycle, month),
      nextDueMonth:      nextRecurringDueMonth(cycle, month),
      memo:              re.memo,
      recordedExpenseId: isPending ? null : (recorded?.id ?? null),
      recordedAmount:    isPending ? null : (recorded?.amount ?? null),
      recordedDate:      isPending ? null : (recorded ? new Date(recorded.date).toISOString().slice(0, 10) : null),
      priorYearActual,
      // 수기 값도 0 은 '무료'가 아니라 '안 적었다'로 읽는다. 0 이 추정으로 올라오면 그 달은 안 나가는 것처럼 보인다.
      priorYearAmount:   (re.priorYearAmount ?? 0) > 0 ? re.priorYearAmount : null,
      recentAvg,
      estimateMonth:     month,
      pendingAmount:     (re as any).pendingAmount ?? null,
      lastPayMethod:        lastRecordMap.get(re.id)?.payMethod ?? null,
      lastFinancialAccountId: lastRecordMap.get(re.id)?.financialAccountId ?? null,
      items: ((re as any).items ?? []).map((it: { id: string; name: string; amount: number; isVariable: boolean; sortOrder: number }) => ({
        id: it.id, name: it.name, amount: it.amount, isVariable: it.isVariable, sortOrder: it.sortOrder,
      })),
    }
  })
}
