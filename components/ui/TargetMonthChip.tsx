// 지출의 귀속월이 날짜의 달과 다를 때만 서는 'N월분' 메타 칩 — 재무 목록·카드 정산이 같은 모양을 쓴다(§11 메타 칩 정본).
//
// 정보 칩이다. 지연·선납을 판정하지 않는다(말일 자동이체가 주말이면 제때 내도 다음 달 날짜다,
// lib/expenseTargetMonth targetMonthBadge). 그래서 상태 배지 톤이 아니라 메타 칩 톤이다.
import { targetMonthBadge } from '@/lib/expenseTargetMonth'

export function TargetMonthChip({ e }: { e: { targetMonth: string | null; date: Date | string } }) {
  const text = targetMonthBadge(e)
  if (!text) return null
  return (
    <span className="shrink-0 whitespace-nowrap rounded-sm bg-[var(--canvas)] px-1.5 py-0.5 text-[0.65625rem] text-[var(--warm-muted)] ring-1 ring-[var(--warm-border)]">{text}</span>
  )
}
