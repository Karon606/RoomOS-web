// 방 점검(퇴실 점검·청소 검수·입실 전 점검)의 단계·상태·결과 라벨과 타입 정본 (2026-10-27, 신고 2911c217).
//
// **서버 액션 파일('use server')에는 async 함수만 내보낼 수 있다**(cleaningConstants 머리말과 같은 이유).
// 값과 타입은 여기, 동작은 inspectionActions.ts(화면이 부르는 문)와 lib/roomInspectionEnsure.ts(퇴실·청소가 부르는 생성)로 가른다.
//
// 점검 라벨은 이 파일 한 곳에 모은다. 단계 이름 셋은 운영자 결정 '퇴실 점검 / 청소 검수 / 입실 전 점검' 이고,
// 사람을 부르는 말은 용어 결정(퍼널 전체 '고객', 거주자 '입주자', 서류 '입실자')을 따른다.
import type { OptionListField } from '@/lib/optionLists'

export type InspectionStage = 'CHECKOUT' | 'AFTER_CLEANING' | 'BEFORE_MOVEIN'
export type InspectionStatus = 'PLANNED' | 'DONE' | 'SKIPPED'
export type InspectionItemResult = 'PENDING' | 'OK' | 'NG' | 'NA'
export type InspectionItemSource = 'TEMPLATE' | 'ASSET' | 'MANUAL'

/** 흐름 차례다(퇴실 · 청소 · 다음 입실). 카드 배지가 여럿 열린 점검 중 무엇을 말할지 이 차례로 고른다. */
export const INSPECTION_STAGES: readonly InspectionStage[] = ['CHECKOUT', 'AFTER_CLEANING', 'BEFORE_MOVEIN']
export const INSPECTION_STATUSES: readonly InspectionStatus[] = ['PLANNED', 'DONE', 'SKIPPED']
export const INSPECTION_RESULTS: readonly InspectionItemResult[] = ['PENDING', 'OK', 'NG', 'NA']
export const INSPECTION_SOURCES: readonly InspectionItemSource[] = ['TEMPLATE', 'ASSET', 'MANUAL']

export const INSPECTION_STAGE_LABEL: Record<InspectionStage, string> = {
  CHECKOUT: '퇴실 점검', AFTER_CLEANING: '청소 검수', BEFORE_MOVEIN: '입실 전 점검',
}
// 청소 행과 같은 상태 낱말이다(예정·완료·안 함). 같은 목록에 섞여 서므로 말이 갈리면 안 된다.
export const INSPECTION_STATUS_LABEL: Record<InspectionStatus, string> = {
  PLANNED: '예정', DONE: '완료', SKIPPED: '안 함',
}

/** 단계마다 항목을 베껴 올 영업장 목록 칸(분류 관리 '청소·작업' 묶음 카드). */
export const INSPECTION_TEMPLATE_FIELD: Record<InspectionStage, OptionListField> = {
  CHECKOUT: 'checkoutInspectionItems',
  AFTER_CLEANING: 'cleaningInspectionItems',
  BEFORE_MOVEIN: 'moveinInspectionItems',
}
/** 퇴실 점검에 저절로 넣지 않을 비품 품명 목록 칸. */
export const INSPECTION_EXCLUDED_FIELD: OptionListField = 'inspectionExcludedItems'
/** 그 방 비품 품명을 항목으로 넣는 단계. 운영자 승인 템플릿에서 '배정 비품은 자동 주입' 은 퇴실 점검뿐이다. */
export const INSPECTION_ASSET_STAGES: readonly InspectionStage[] = ['CHECKOUT']

/**
 * 홈 알림 끄기 키(alertMutes) 규약. 홈 알림·푸시는 2차라 이번에는 키 모양만 정해 둔다(knowledge/alert-mutes 의 '키는 만드는 쪽이').
 * 알림을 만드는 쪽이 이 함수 하나로 키를 낸다. 글자로 다시 조립하지 않는다.
 */
export function inspectionMuteKey(inspectionId: string): string {
  return `inspection:${inspectionId}`
}

export const INSPECTION_GONE = '점검 기록을 찾을 수 없습니다.'
export const INSPECTION_ITEM_GONE = '점검 항목을 찾을 수 없습니다.'
// 끝냈거나 안 하기로 한 점검의 항목은 그대로 둔다. 고치려면 그 상태를 먼저 무른다(완료 적용취소·안 함 적용취소).
export const INSPECTION_LOCKED = '완료했거나 안 하기로 한 점검이라 항목을 고칠 수 없습니다. 그 상태를 먼저 적용취소하면 됩니다.'
/** 항목 이름 길이 상한. 한 줄에 서는 짧은 말이다. 손수 더하는 항목만 이 상한을 본다(목록 이름은 분류 관리가 정한다). */
export const INSPECTION_LABEL_MAX = 60

export type InspectionItemRow = {
  id: string
  label: string
  sortOrder: number
  source: InspectionItemSource
  result: InspectionItemResult
  note: string | null
  checkedAt: string | null
}

/** 목록 행. 항목은 펼칠 때 따로 읽는다(영업장 전체 목록에 항목을 다 실으면 기록이 쌓일수록 무거워진다). 수는 서버가 센다. */
export type InspectionRow = {
  id: string
  roomId: string
  roomNo: string
  leaseTermId: string | null
  cleaningId: string | null
  stage: InspectionStage
  status: InspectionStatus
  scheduledDate: string | null
  doneDate: string | null
  memo: string | null
  deletedAt: string | null
  total: number
  /** 결과를 고른 항목(확인·문제·해당 없음). */
  checked: number
  /** 문제(NG) 항목. 검수 미통과는 넷째 상태가 아니라 이 수에서 파생한다. */
  ng: number
}

/** 항목 삭제 적용취소가 되살릴 모양. 서버가 다시 검증한다(inspectionActions restoreInspectionItem). */
export type InspectionItemSnapshot = {
  inspectionId: string
  label: string
  sortOrder: number
  source: InspectionItemSource
  expenseId: string | null
  result: InspectionItemResult
  note: string | null
  checkedAt: string | null
}

/** 결과를 고친 항목의 이전 값. 적용취소가 이 값으로 같은 액션을 다시 부른다(inspectionActions setInspectionItemResult). */
export type InspectionItemPrev = { result: InspectionItemResult; note: string | null; checkedAt: string | null }

/**
 * 진행 수 문장 정본 '점검 N/M'(독립 검수 R2). 행·카드 보조줄('청소 필요'·'점검 남음')·입실 안내가 이 한 함수를 쓴다.
 * N 은 판정을 마친 항목(확인·문제·해당 없음) 수다. 항목 상자도 셋 모두 채워 보여 주므로(InspectionRowBody) 상자 수와 N 이 같다.
 */
export function inspectionProgressText(judged: number, total: number): string {
  return `점검 ${judged}/${total}`
}

/**
 * 입실 판정 정본(2026-10-27 독립 재검수 차단 1). 다음 상태가 거주중이고 이전 상태가 거주(거주중·퇴실 예정)가 아니면 입실이다.
 * 계약 생성은 이전 상태가 없다(null). 예약·투어·문의·입실 취소·비거주·퇴실 완료에서 거주중으로 가는 전이가 모두 입실이다.
 * 퇴실 예정에서 거주중으로 돌아오는 것(퇴실 예정 취소·자동 전환 되돌리기)은 계속 사는 것이라 입실이 아니다.
 * 상태 위젯·수정 폼·일괄 편집·홈 알림·호실 일정 입실·계약 생성·엑셀 가져오기가 이 한 함수로 가른다.
 */
export function isMoveInTransition(prev: string | null, next: string): boolean {
  return next === 'ACTIVE' && prev !== 'ACTIVE' && prev !== 'CHECKOUT_PENDING'
}
/**
 * 입실의 정확한 역(2026-10-27 재확인 차단 2). 지금 상태(current)에서 복원할 상태(restored)로 가는 것이
 * 복원할 상태에서 지금 상태로 간 입실(isMoveInTransition)을 되돌리는 것이면 참이다. 비거주·퇴실 완료에서 거주중으로 간 입실의 역도 잡힌다.
 * 되돌림이 확실한 경로(일괄 수정 적용취소)만 이 판정으로 되연다.
 */
export function undoesMoveIn(current: string, restored: string): boolean {
  return isMoveInTransition(restored, current)
}
const PRE_MOVE_IN_STATUSES = ['RESERVED', 'TOUR_DONE', 'WAITING_TOUR', 'CANCELLED']
/**
 * 입실 되돌리기 판정(일반 전이용). 정확한 역(undoesMoveIn) 가운데 입주 전 단계(예약·투어·입실 취소)로 가는 것만 참이다.
 * 상태 위젯·수정 폼·일괄 편집 저장은 그 전이가 되돌림인지 진짜 전이인지 모른다. 거주중에서 비거주·퇴실 완료로 가는 것은 진짜 전이일 수 있어
 * 여기서 빼고(진짜 퇴실이 입실 전 점검을 되열면 안 된다), 거주중에서 입주 전 단계로 가는 것은 입실을 무르는 것밖에 없어 넣는다.
 */
export function isMoveInUndoTransition(prev: string | null, next: string): boolean {
  return prev !== null && undoesMoveIn(prev, next) && PRE_MOVE_IN_STATUSES.includes(next)
}

/** 입실 전 점검을 닫은 쪽. 입실(상태 전이·계약 생성·호실 일정 입실)과 방 이동(일정 이사·수정 폼 호실 변경)을 표식으로 가른다. */
export type MoveInCloser = 'movein' | 'move'
/**
 * 입실 전 점검을 자동으로 닫은 표식(doneBy 로그 칸). 적용취소가 이 표식으로 그 처리가 닫은 점검만 되연다(운영자 결정 ③).
 * 입실 적용취소는 `auto-movein:` 만, 이사 적용취소는 `auto-move:` 중 옮겨 들어간 방 것만 본다(재확인 차단 2). 그래서 입실을 무를 때
 * 나중에 일정 이사로 닫은 다른 방 점검은 안 열린다.
 */
export function moveInClosedMarker(leaseTermId: string, by: MoveInCloser = 'movein'): string {
  return by === 'move' ? `auto-move:${leaseTermId}` : `auto-movein:${leaseTermId}`
}

/** 결과를 고른 항목 수(확인·문제·해당 없음). 화면이 항목을 들고 있을 때 서버 수와 같은 규칙으로 센다. */
export function countChecked(items: readonly { result: InspectionItemResult }[]): number {
  return items.filter(i => i.result !== 'PENDING').length
}

/**
 * 입실 처리가 열린 입실 전 점검을 닫을 때의 둘째 줄(운영자 결정 ③, §15 장문형 둘째 줄). 남은 항목이 없으면 닫았다는 사실만 말한다.
 */
export function moveInInspectionClosedText(pending: number): string {
  return pending > 0
    ? `입실 전 점검 ${pending}항목이 남은 채 닫혔습니다 · 입실을 적용취소하면 다시 열립니다`
    : '입실 전 점검을 완료 기록 없이 닫았습니다 · 입실을 적용취소하면 다시 열립니다'
}
/** '입실 처리' 버튼 앞 안내 줄(§27.8 WhyCaption 문형). 막지 않는다. 입실하면 그 점검이 닫힌다는 것을 미리 말한다. */
export function moveInInspectionCaption(judged: number, total: number): string {
  // '점검' 을 두 번 말하지 않게 진행은 항목 수로 적는다(디자이너 재검수).
  return `입실 전 점검이 끝나지 않았습니다(${total}항목 중 ${judged}항목 판정). 입실 처리하면 '안 함'으로 닫힙니다`
}
