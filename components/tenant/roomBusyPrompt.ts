'use client'

// "입주일에 계약 호실이 아직 차 있다"를 묻는 자리 — 문답 정본.
//
// **입주 희망일을 바꾸는 길이 둘이다.** 입주자 수정 폼(updateTenant)과 예약 확정 미니폼
// (applyStatusTransition). 한쪽에만 물음을 달았더니 운영자가 어느 길로 갔느냐에 따라 물음을
// 못 봤다(실측 2026-08-26). 문답을 여기 하나로 두고 두 호출부가 같이 쓴다.
//
// 갈래는 셋이다.
//   · **당일 넘겨받기** — 앞사람이 나가는 바로 그날 들어온다. 오전에 비우고 청소한 뒤 오후에
//     들어오는 것도 실제로 되는 일이라 앱이 정하지 않는다(운영자 확정). 그대로 두는 쪽이
//     무변경이라 primary 다.
//   · **며칠 겹침** — 당일 넘겨받기가 성립하지 않아 한 갈래만 준다.
//   · **언제 비는지 모름** — 앞사람 퇴실 예정일이 없다. 이름만 알려주고 끝내지 않고 그 사람을 연다.
//
// 저장은 이미 끝난 뒤에 뜬다. 그래서 본문 첫 줄이 "입주일은 이미 저장했습니다"로 시작한다 —
// 그 말이 없으면 왼쪽 버튼이 방금 바꾼 날짜를 되돌리는 것으로 읽힌다(§14·§27.5).

import { confirmDialog, choiceDialog } from '@/components/ui/ConfirmDialog'
import { fmtDateKor as fmtDate } from '@/lib/fmtDate'

export type RoomBusyInfo = {
  roomNo: string
  moveInYmd: string
  freeFrom: string | null
  occupantName: string | null
  occupantTenantId: string | null
  sameDayHandover: boolean
}

/** 운영자가 고른 다음 걸음. 'plan' 은 일정 짜기, 'occupant' 는 앞사람 카드 열기. */
export type RoomBusyChoice = 'plan' | 'occupant' | null

export async function askRoomBusy(b: RoomBusyInfo): Promise<RoomBusyChoice> {
  const who = b.occupantName ? `${b.occupantName}님이 ` : ''

  if (!b.freeFrom) {
    const go = await confirmDialog({
      title: `${b.roomNo}호가 언제 비는지 정해지지 않았습니다`,
      message: `입주일은 이미 저장했습니다. ${who}살고 있는데 퇴실 예정일이 없어 그때까지 지낼 방을 정할 수 없습니다. 퇴실 예정일을 먼저 정해 주세요.`,
      level: 'caution',
      confirmLabel: '퇴실 예정일 정하기',
      cancelLabel: '나중에',
    })
    return go && b.occupantTenantId ? 'occupant' : null
  }

  if (b.sameDayHandover) {
    const pick = await choiceDialog({
      title: `${b.roomNo}호를 ${fmtDate(b.moveInYmd)}에 넘겨받나요?`,
      message: `입주일은 이미 저장했습니다. ${who}그날 나가고 같은 날 들어오게 됩니다. 오전에 비우고 청소한 뒤 들어오면 그대로 두시고, 그날 밤 잘 곳이 필요하면 다른 방을 정해 두시면 됩니다.`,
      level: 'caution',
      confirmLabel: '그대로 두기',
      altLabel: '다른 방 정하기',
    })
    return pick === 'alt' ? 'plan' : null
  }

  const go = await confirmDialog({
    title: `${b.roomNo}호가 ${fmtDate(b.freeFrom)}에 빕니다`,
    message: `입주일은 이미 저장했습니다. ${who}그때까지 살고 있어서 ${fmtDate(b.moveInYmd)}에는 들어갈 수 없습니다. 그때까지 지낼 방을 지금 정해 둘까요? 정해 두면 계약서에도 적히고, 입주일에는 입실 처리만 누르면 됩니다.`,
    level: 'caution',
    confirmLabel: '방 정하기',
    cancelLabel: '나중에',
  })
  return go ? 'plan' : null
}
