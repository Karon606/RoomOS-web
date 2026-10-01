// 고정지출 기록의 귀속월 정본 — targetMonth(지정) 아니면 date 의 달, 회차 판정·중복 가드·합산이 전부 여기를 지난다.
//
// 지출에는 달 축이 둘이다(2026-10-01 운영자 승인 1안, knowledge/domain-expense-target-month).
//  · date        — 돈이 실제로 나간 날. 재무 월 합계·카테고리·손익·카드 청구월은 이 축이다.
//  · targetMonth — 이 기록이 치른 고정지출 회차의 달. 9월분 가스요금을 10/1 에 내면 '2026-09'.
//                  NULL 이면 date 의 달이다(이 칸이 생기기 전 기록 전부, 그리고 귀속월 = 납부 달인 기록).
// 소비처가 각자 `targetMonth ?? date 월` 을 쓰면 한 곳만 KST 를 틀려도 회차가 갈린다. 이 파일만 쓴다.

import { dbDateMonthKey, monthsDbRange } from './kstDate'

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

/** 'YYYY-MM' 형식인가 — 서버 입력 검증용. */
export function isMonthKey(s: unknown): s is string {
  return typeof s === 'string' && MONTH_RE.test(s)
}

/** 이 지출이 치른 고정지출 회차의 달 'YYYY-MM'. */
export function expenseTargetMonth(e: { targetMonth: string | null | undefined; date: Date | string }): string {
  return e.targetMonth ?? dbDateMonthKey(e.date)
}

/**
 * 저장할 targetMonth — 고른 귀속월이 date 의 달과 같으면 NULL 로 접는다.
 * 표현을 하나로 두려는 것이다: 값이 있으면 언제나 '납부 달과 다른 회차'라는 뜻이 되고,
 * 같은 달 기록은 이 칸이 생기기 전 기록과 똑같이 읽힌다.
 */
export function targetMonthForSave(month: string | null | undefined, date: Date | string): string | null {
  if (!month) return null
  return month === dbDateMonthKey(date) ? null : month
}

/**
 * 귀속월이 [from, to] 안인 지출 — Prisma where 조각. 다른 조건과 펼쳐 합친다(OR 키를 쓰므로 다른 OR 과 겹치면 안 된다).
 * 지정값이 있으면 그것으로, 없으면 date 가 그 달 창 안인지로 본다. 'YYYY-MM' 은 글자 순서가 곧 달 순서다.
 */
export function targetMonthWhere(from: string, to: string = from) {
  return {
    OR: [
      { targetMonth: from === to ? from : { gte: from, lte: to } },
      { targetMonth: null, date: monthsDbRange(from, to) },
    ],
  }
}

/** targetMonthWhere 와 같은 뜻의 메모리 판정 — 테스트·스크립트가 쿼리 의미를 검산하는 데 쓴다. */
export function inTargetMonthRange(e: { targetMonth: string | null; date: Date | string }, from: string, to: string = from): boolean {
  const m = expenseTargetMonth(e)
  return m >= from && m <= to
}

/** 'YYYY-MM' 에서 n 달 이동. */
export function shiftMonthKey(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const idx = y * 12 + (m - 1) + n
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}

/** '2026년 9월분' — 수납 귀속월 select 와 같은 표기. */
export function targetMonthLabel(month: string): string {
  return `${Number(month.slice(0, 4))}년 ${Number(month.slice(5, 7))}월분`
}

/**
 * 목록 배지 — 귀속월이 납부 달과 다를 때만 'N월분', 같으면 null. **지연·선납을 판정하지 않는다.**
 * 말일 자동이체는 주말이면 예정일 자체가 다음 달로 넘어가서(lib/recurringDueDate) 제때 낸 9월분도
 * 납부 달이 10월이다. 달만 비교해 '지연'이라 부르면 사실이 아니다(웹디자이너 패스 2026-10-01).
 */
export function targetMonthBadge(e: { targetMonth: string | null; date: Date | string }): string | null {
  const tm = expenseTargetMonth(e)
  if (tm === dbDateMonthKey(e.date)) return null
  return `${Number(tm.slice(5, 7))}월분`
}

/**
 * 한 달의 고정지출 기록을 항목별로 접는다. 같은 항목·같은 귀속월이 둘이면(분할 납부·가드 이전 데이터)
 * 금액은 합산, id·date 는 가장 최근 것(date desc, createdAt desc). Map.set 으로 마지막 한 건만 남기면
 * 조회 순서에 따라 금액 절반이 사라진다.
 */
export function foldRecordedByRecurring<T extends { id: string; recurringExpenseId: string | null; amount: number; date: Date; createdAt: Date }>(
  rows: T[],
): Map<string, { id: string; amount: number; date: Date; count: number }> {
  const out = new Map<string, { id: string; amount: number; date: Date; createdAt: Date; count: number }>()
  for (const r of rows) {
    if (!r.recurringExpenseId) continue
    const cur = out.get(r.recurringExpenseId)
    if (!cur) { out.set(r.recurringExpenseId, { id: r.id, amount: r.amount, date: r.date, createdAt: r.createdAt, count: 1 }); continue }
    const newer = r.date.getTime() > cur.date.getTime()
      || (r.date.getTime() === cur.date.getTime() && r.createdAt.getTime() > cur.createdAt.getTime())
    out.set(r.recurringExpenseId, {
      id: newer ? r.id : cur.id,
      date: newer ? r.date : cur.date,
      createdAt: newer ? r.createdAt : cur.createdAt,
      amount: cur.amount + r.amount,
      count: cur.count + 1,
    })
  }
  return new Map([...out].map(([k, v]) => [k, { id: v.id, amount: v.amount, date: v.date, count: v.count }]))
}
