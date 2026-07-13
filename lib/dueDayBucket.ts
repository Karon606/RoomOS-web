// 납부일(dueDay) 구간 버킷 공용 헬퍼 — 입주자·수납 관리 필터 패널이 같은 규칙을 공유.
// 표시 정본(fmtDueDay: 30 이상 = 매월 말일)과 일치시켜 '30일' 입주자가 필터에서 21~29에 떨어지는 불일치를 차단.

export type DueDayBucket = 'early' | 'mid' | 'late' | 'eom'

export const DUE_DAY_BUCKET_OPTIONS: { value: DueDayBucket; label: string }[] = [
  { value: 'early', label: '1~10일' },
  { value: 'mid',   label: '11~20일' },
  { value: 'late',  label: '21~29일' },
  { value: 'eom',   label: '말일' },
]

/**
 * dueDay 문자열을 구간 버킷으로 정규화한다. 매칭 불가(null·NaN)는 null — 필터 설정 시 제외.
 * - '말' 포함 또는 숫자 30 이상 = 말일(eom). 표시 정본 fmtDueDay와 동일 규칙.
 * - 날짜형('YYYY-MM-DD', 일회성 지정): targetMonth가 주어지고 그 달과 일치할 때만 일 성분으로 매칭,
 *   아니면 null(다음 달 지정이 이번 달 구간에 잡히는 오류 방지). targetMonth 없으면 항상 null.
 */
export function dueDayBucketOf(dueDay: string | null | undefined, targetMonth?: string): DueDayBucket | null {
  if (!dueDay) return null
  let day: number
  if (dueDay.includes('-')) {
    if (!targetMonth || dueDay.slice(0, 7) !== targetMonth) return null
    day = parseInt(dueDay.split('-')[2], 10)
  } else if (dueDay.includes('말')) {
    return 'eom'
  } else {
    day = parseInt(dueDay, 10)
  }
  if (isNaN(day)) return null
  if (day >= 30) return 'eom'
  if (day >= 21) return 'late'
  if (day >= 11) return 'mid'
  if (day >= 1) return 'early'
  return null
}
