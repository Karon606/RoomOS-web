// 방 청소 이력의 상수·타입 (2026-08-05).
//
// **서버 액션 파일('use server')에는 async 함수만 내보낼 수 있다.** 상수·타입을 같이 내보내면
// 그 모듈을 불러오는 순간 깨지고, 화면 하나가 아니라 그것을 쓰는 트리 전체가 죽는다.
// 실제로 방 상세가 통째로 안 떠서 호실·고객·수납이 전부 막혔다(운영자 신고 2026-08-05).
// 그래서 값은 여기, 동작은 cleaningActions.ts 로 가른다.

export type CleaningReason = 'CHECKOUT' | 'AFTER_WORK' | 'DURING_STAY' | 'OTHER'
export type CleaningStatus = 'PLANNED' | 'DONE' | 'SKIPPED'
export type CleaningPerformer = 'SELF' | 'VENDOR' | 'THIRD_PARTY'

// 지출 카테고리는 이미 영업장 목록에 있는 것을 쓴다. 새로 만들면 카테고리가 또 하나 늘고,
// 지금도 목록에 없는 고아 카테고리('청소비' 1건)가 떠 있다.
export const CLEANING_EXPENSE_CATEGORY = '청소용역비'

export const CLEANING_REASON_LABEL: Record<CleaningReason, string> = {
  CHECKOUT: '퇴실 청소', AFTER_WORK: '공사·도배 후', DURING_STAY: '입실 중 요청', OTHER: '기타',
}
export const CLEANING_PERFORMER_LABEL: Record<CleaningPerformer, string> = {
  SELF: '직접', VENDOR: '업체', THIRD_PARTY: '제3자',
}

export type CleaningRow = {
  id: string
  roomId: string
  roomNo: string
  reason: CleaningReason
  status: CleaningStatus
  scheduledDate: string | null
  doneDate: string | null
  performer: CleaningPerformer | null
  performerName: string | null
  memo: string | null
  cost: number | null
  fromCleaningFund: boolean
}
