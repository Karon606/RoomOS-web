// 재고 소모 추이 표기 순수층 — 진행 중인 달 라벨('23일까지')과 하루당 비교 캡션. 'use server' 아님. 진리표 scripts/test-consumption-series.ts.
//
// 왜 있나(2026-10-26 운영자 승인, 신고 9d26a7ee "10월달에도 많이 소모된 것 같은데 그래프는 지난달보다 줄어든 추세로 보이거든?").
// 숫자는 맞았다(9월 190봉 30일, 10월 23일까지 138봉). 진행 중인 달 막대가 만월 옆에 그대로 섰고 '(진행 중)' 은 hover 툴팁뿐이라
// 폰에서 안 보였다. 하루당은 지어낸 값이 아니다(그 달에 귀속된 구간 일수 합이 분모). 예측 막대는 그리지 않는다(2026-07-17 결정 유지).

export type MonthSlot = { month: string; qty: number | null; days: number | null; lastDate: string | null }

/** 하루당 표기. 소수 첫째 자리 고정('6.0봉'). 일수가 없으면 null. */
export function perDayText(qty: number | null, days: number | null, unit: string | null): string | null {
  if (qty == null || !days || days <= 0) return null
  return `${(Math.round((qty / days) * 10) / 10).toFixed(1)}${unit ?? ''}`
}

/** 진행 중인 달 축 라벨의 둘째 줄('23일까지'). 그 달 점검이 있을 때만. 판정은 시계가 아니라 마지막 슬롯(구조적)이다. */
export function partialMonthTail(slot: MonthSlot, isCurrent: boolean): string | null {
  if (!isCurrent || slot.qty == null || !slot.lastDate) return null
  if (slot.lastDate.slice(0, 7) !== slot.month) return null
  return `${Number(slot.lastDate.slice(8, 10))}일까지`
}

/** 카드 캡션 '이번 달 하루 6.0봉 · 지난달 6.3봉'. 이번 달 값이 없으면 null(캡션을 안 단다), 지난달이 없으면 앞 토막만. */
export function perDayCaption(series: readonly MonthSlot[], unit: string | null): string | null {
  const cur = series[series.length - 1]
  const prev = series[series.length - 2]
  const a = cur ? perDayText(cur.qty, cur.days, unit) : null
  if (!a) return null
  const b = prev ? perDayText(prev.qty, prev.days, unit) : null
  return b ? `이번 달 하루 ${a} · 지난달 ${b}` : `이번 달 하루 ${a}`
}
