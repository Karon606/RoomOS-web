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
  // 어느 퇴실 건인가 — 퇴실 청소만 값이 있다. 받은 청소비 잔고를 계약별로 묶는 키다.
  leaseTermId: string | null
  reason: CleaningReason
  status: CleaningStatus
  scheduledDate: string | null
  doneDate: string | null
  performer: CleaningPerformer | null
  performerName: string | null
  memo: string | null
  cost: number | null
  fromCleaningFund: boolean
  // 소프트삭제 시각. 살아 있는 행은 null 이다.
  // 영업장 목록 조회만 삭제분을 함께 실어 온다 — 복원 진입점('삭제됨 보기')이 그 화면에 있고,
  // 그 6건은 토스트 6초를 놓치면 닿을 길이 없었다(§16 은 토스트 밖 진입점을 요구한다).
  deletedAt: string | null
}

// 받은 청소비 잔고 — **파생값이라 어디에도 저장하지 않는다.**
// 받은 청소비는 반환의무가 없는 확정 수입이고(운영자 확정 2026-08-05), 잔고는 그 돈을
// 얼마나 청소에 썼는지 보여주는 관리용 숫자일 뿐이다. 칸을 만들어 두면 수납·몰취·지출
// 어느 쪽이 바뀌어도 갈린다.
export type CleaningFundLease = {
  leaseTermId: string
  realizedIncome: number      // 받은 청소비(부가수익) + 보증금에서 뗀 청소비(몰취)
  contractFee: number         // 계약서상 청소비 — 아직 정산 전일 때 쓰는 예상액
  fundedExpenseTotal: number  // 그 계약에 '받은 청소비로 부담' 으로 단 청소 지출 합
}

export type CleaningFundStatus = {
  leases: CleaningFundLease[]
  // 완료 시점에 서버가 고를 퇴실 계약. 미리보기가 같은 답을 써야 체크 전후 표시가 안 갈린다.
  checkoutLeaseTermId: string | null
}
