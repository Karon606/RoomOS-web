// 입주자 폼 월 이용료 칸의 자동 채움과 칸 아래 안내 한 줄을 정하는 정본(순수). 저장된 계약 금액은 호실·상태를 바꿔도 덮지 않는다.
//
// 왜(2026-10-27 운영자 승인 '추천대로', 홍은주 602호 사건). 비거주 15만 원 계약을 입주자 수정 폼에서 602호(기본 3만, 비거주 이용료 없음)로
// 옮기자 호실 칸의 onChange 가 '비거주 이용료가 없으면 기본 이용료' 로 칸을 3만 원으로 덮었고, 경고 문장은 값이 바뀐 뒤에야 떴다.
// 그대로 저장돼 계약이 3만 원이 됐다. 규칙 셋.
//   1. 자동 채움은 새 계약과 빈 칸에만 한다. 저장된 금액이 있는 수정 폼은 호실·상태를 바꿔도 값을 그대로 둔다.
//   2. 비거주 이용료가 빈 방은 어느 경우에도 기본 이용료로 대체하지 않는다.
//   3. 값을 그대로 둔 자리는 칸 아래 WhyCaption 한 줄로 방 기준가를 알리고, 한 번 눌러 바꾸고 되살릴 수 있다.
// 단기 계약은 이 판정 밖이다(부르는 쪽이 먼저 빠진다, 수동 입력값이라 그대로 둔다).
import { fmtRoomNo } from '@/lib/roomNo'
import { withParticle } from '@/lib/koParticle'

export type RentRoom = { id: string; roomNo: string; baseRent: number; nonResidentRent: number | null }

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`

/** 방이 이 상태에 정한 기준가. 비거주인데 비거주 이용료가 없으면 null 이다(기본 이용료로 대체하지 않는다). */
export function roomStdRent(room: Pick<RentRoom, 'baseRent' | 'nonResidentRent'>, isNR: boolean): number | null {
  return isNR ? room.nonResidentRent : room.baseRent
}

/** 저장된 계약 금액. 수정 폼(계약 id 있음)이고 금액이 0보다 클 때만 값이다. 새 계약·빈 금액은 null. */
export function savedLeaseRent(lease: { id?: string | null; rentAmount?: number | null } | null | undefined): number | null {
  return lease?.id && lease.rentAmount != null && lease.rentAmount > 0 ? lease.rentAmount : null
}

/**
 * 호실이나 상태를 바꿀 때 칸에 넣을 값. 'keep' 이면 칸을 건드리지 않는다.
 * - 호실을 비우면: 저장된 금액이 있으면 그대로, 없으면 칸도 비운다(오류신고 d3bd5717, 자동으로 채웠던 값만 비운다).
 * - 방 기준가가 없으면(비거주 이용료 없는 방): 저장된 금액이 없고 칸 값이 폼이 자동으로 채웠던 값(autoFilled) 그대로면 비운다
 *   (거주로 3만 원을 채운 뒤 비거주로 바꾸면 그 3만 원이 비거주 금액으로 남던 자리, 독립 검수 B2, d3bd5717 원칙). 손으로 적은 값은 그대로.
 * - 저장된 금액이 있고 칸이 차 있으면: 그대로.
 * - 그 밖(새 계약, 빈 칸): 방 기준가로 채운다.
 */
export function nextRentOnChange(p: {
  saved: number | null
  current: number | undefined
  room: Pick<RentRoom, 'baseRent' | 'nonResidentRent'> | null
  isNR: boolean
  /** 폼이 마지막으로 자동으로 채운 값. 없으면 undefined. */
  autoFilled?: number
}): { kind: 'keep' } | { kind: 'set'; value: number | undefined } {
  if (!p.room) return p.saved != null ? { kind: 'keep' } : { kind: 'set', value: undefined }
  const std = roomStdRent(p.room, p.isNR)
  if (std == null) {
    const auto = p.saved == null && (p.current ?? 0) > 0 && p.current === p.autoFilled
    return auto ? { kind: 'set', value: undefined } : { kind: 'keep' }
  }
  if (p.saved != null && (p.current ?? 0) > 0) return { kind: 'keep' }
  return { kind: 'set', value: std }
}

/** 칸 아래 한 줄. 'swap' 은 '기준가로 바꾸기' 링크로 바꾼 직후의 기억이다(되살리기 값). */
export type RentSwap = { from: number; to: number; roomId: string; isNR: boolean }
export type RentCaption =
  | { kind: 'nr-missing'; text: string }
  | { kind: 'keep'; text: string; actionLabel: string; value: number }
  | { kind: 'swapped'; text: string; actionLabel: string; value: number }
  | null

export function rentFieldCaption(p: {
  /** 저장된 계약의 호실 번호와 금액(수정 폼). 새 계약이면 null. */
  saved: { roomNo: string | null; rent: number } | null
  current: number | undefined
  room: RentRoom | null
  isNR: boolean
  /** 폼을 연 뒤 호실이나 거주·비거주가 바뀌었는가. */
  changed: boolean
  swap: RentSwap | null
}): RentCaption {
  const room = p.room
  if (!room) return null
  const cur = p.current ?? 0
  const R = fmtRoomNo(room.roomNo)
  if (p.isNR && room.nonResidentRent == null) {
    return {
      kind: 'nr-missing',
      text: cur > 0
        ? `${R}에 비거주 이용료가 없어 지금 금액 ${withParticle(won(cur), '을/를')} 그대로 둡니다 · 호실 관리에서 정하면 됩니다`
        : `${R}에 비거주 이용료가 없어 칸을 비워 둡니다 · 호실 관리에서 정하면 됩니다`,
    }
  }
  const sw = p.swap
  if (sw && sw.roomId === room.id && sw.isNR === p.isNR && cur === sw.to) {
    return { kind: 'swapped', text: `${R} 기준 ${withParticle(won(sw.to), '으로/로')} 바꿨습니다`, actionLabel: `${won(sw.from)} 되살리기`, value: sw.from }
  }
  if (!p.saved || !p.changed || cur <= 0) return null
  const std = roomStdRent(room, p.isNR)
  if (std == null || std === cur) return null
  const head = cur === p.saved.rent && p.saved.roomNo
    ? `${fmtRoomNo(p.saved.roomNo)} ${won(cur)} 그대로입니다`
    : `지금 금액 ${won(cur)} 그대로입니다`
  return { kind: 'keep', text: head, actionLabel: `${R} 기준 ${withParticle(won(std), '으로/로')} 바꾸기`, value: std }
}

/**
 * 저장 때 서버가 함께 돌려주는 안내(거부 아님). 비거주 계약인데 방에 비거주 이용료가 없고 계약 금액이 기본 이용료와 같으면
 * 사건과 같은 모양이라 한 번 알린다. 단기 계약은 보지 않는다.
 */
export function nrRentEqualsBaseNotice(p: {
  status: string; isShortTerm: boolean; rentAmount: number
  room: { roomNo: string; baseRent: number; nonResidentRent: number | null } | null
}): string | null {
  if (p.status !== 'NON_RESIDENT' || p.isShortTerm || !p.room) return null
  if (p.room.nonResidentRent != null || p.rentAmount <= 0 || p.rentAmount !== p.room.baseRent) return null
  return `${fmtRoomNo(p.room.roomNo)}에 비거주 이용료가 없어 이 계약 이용료 ${withParticle(won(p.rentAmount), '이/가')} 기본 이용료와 같습니다. 비거주 금액이 맞는지 확인해 주세요.`
}
