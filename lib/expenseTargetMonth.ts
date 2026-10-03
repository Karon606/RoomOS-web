// 지출의 귀속월 정본 — targetMonth(지정) 아니면 date 의 달. 지출 결산·고정지출 회차 판정·중복 가드·합산이 전부 여기를 지난다.
//
// 지출에는 달 축이 둘이다(knowledge/domain-expense-target-month).
//  · targetMonth — 이 지출이 속한 달(귀속월). 9월분 가스요금을 10/1 에 내면 '2026-09'.
//                  NULL 이면 date 의 달이다(이 칸이 생기기 전 기록 전부, 그리고 귀속월 = 납부 달인 기록).
//                  1안(2026-10-01)은 고정지출 회차 판정에만 썼고, 2안(2026-10-03 운영자 승인)부터
//                  지출 결산 전체(재무 목록·카테고리·홈 KPI·도넛·추이 월 막대·보고서)가 이 축이다.
//                  운영자 원문: "9월에 납부받아야할 돈도 10월에 늦게 받아도 9월 수납으로 처리되는 것처럼".
//  · date        — 돈이 실제로 나간 날. 카드 청구월·예비비 거래 원장·목록 날짜 머리·일별 합계·
//                  일간/주간 추이·엑셀 날짜 범위(from/to)·전체 워크북·전체 백업은 이 축이다.
//                  엑셀 month 필터·월별 시트·'귀속월' 열은 귀속월 축이다(3단계).
// 소비처가 각자 `targetMonth ?? date 월` 을 쓰면 한 곳만 KST 를 틀려도 달이 갈린다. 이 파일만 쓴다.

import { dbDateMonthKey, monthsDbRange } from './kstDate'

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

/** 'YYYY-MM' 형식인가 — 서버 입력 검증용. */
export function isMonthKey(s: unknown): s is string {
  return typeof s === 'string' && MONTH_RE.test(s)
}

/**
 * 이 지출의 귀속월 'YYYY-MM'.
 * targetMonth 는 `string | null` 이다(undefined 불가) — select 에서 targetMonth 를 빠뜨리면
 * 모든 행이 date 의 달로 조용히 읽히는데, 그 누락을 tsc 가 잡게 하려는 것이다.
 */
export function expenseTargetMonth(e: { targetMonth: string | null; date: Date | string }): string {
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
 * 귀속월이 [from, to] 안인 지출 — Prisma where 조각. 지정값이 있으면 그것으로, 없으면 date 가 그 달 창 안인지로 본다.
 * 'YYYY-MM' 은 글자 순서가 곧 달 순서다.
 *
 * 합치는 규칙: 이 조각은 OR 키를 쓴다. 다른 조건과는 `{ propertyId, ...targetMonthWhere(m) }` 로 펼쳐 합치되,
 * 그 where 에 이미 OR 이 있으면 펼치지 말고 `AND: [targetMonthWhere(m), { OR: [...] }]` 로 묶는다.
 * 펼치면 뒤의 OR 이 앞의 OR 을 소리 없이 덮어써 귀속월 조건이 사라진다.
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

/**
 * 귀속월 표기. 기준 달(relativeTo)을 주면 해가 같을 때 '9월분', 해가 다를 때만 '2025년 12월분'
 * (홈 이월 버킷 AgingList·PaymentRecordList 와 같은 판정 — 해가 갈리는 것만 연도를 붙인다).
 * 기준 없이 부르면 늘 연도를 붙인다.
 */
export function targetMonthLabel(month: string, relativeTo?: string): string {
  const m = `${Number(month.slice(5, 7))}월분`
  return relativeTo && relativeTo.slice(0, 4) === month.slice(0, 4) ? m : `${Number(month.slice(0, 4))}년 ${m}`
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
