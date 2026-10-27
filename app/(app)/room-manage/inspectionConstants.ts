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

/** 진행 수 문장. 행·배지·안내가 같은 모양으로 쓴다. */
export function inspectionProgressText(checked: number, total: number): string {
  return `확인 ${checked}/${total}`
}

/** 결과를 고른 항목 수(확인·문제·해당 없음). 화면이 항목을 들고 있을 때 서버 수와 같은 규칙으로 센다. */
export function countChecked(items: readonly { result: InspectionItemResult }[]): number {
  return items.filter(i => i.result !== 'PENDING').length
}

/**
 * 입실을 막지 않고 알리는 문장 둘(운영자 결정 3: 경고만). 입실 처리 결과 안내(notice)와 '입실 처리' 버튼 앞 안내 줄이 쓴다.
 * 버튼 앞 줄은 이유 한 마디 뒤에 '점검 열기' 링크가 푸는 법이다(가이드 §27.8 WhyCaption 문형).
 */
export function moveInInspectionNotice(checked: number, total: number): string {
  return `입실 전 점검이 끝나지 않았습니다(${inspectionProgressText(checked, total)}). 입실은 처리했고, 호실 작업 이력에서 점검을 마치면 됩니다.`
}
export function moveInInspectionCaption(checked: number, total: number): string {
  return `입실 전 점검이 끝나지 않았습니다(${inspectionProgressText(checked, total)}). 입실 처리는 그대로 할 수 있습니다`
}
