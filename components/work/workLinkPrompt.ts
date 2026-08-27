'use client'

// "이미 적어 둔 지출이 있는데 또 만들까" 를 묻는 자리 — 문답 정본.
//
// **호출부가 둘 이상이 될 것이 이미 정해져 있다.** 지금은 작업 완료 폼 하나지만 지출 저장 쪽도
// 같은 물음을 해야 한다(2단계). 문답을 베끼면 한쪽만 낡는다 — 호실 일정에서 팝업을 두 벌로
// 뒀다가 한쪽만 안 떠서 운영자가 갇혔던 그 자리다(knowledge/domain-room-schedule).
//
// **'중복'이라는 낱말을 쓰지 않는다.** 앱이 아는 것은 "같은 날 같은 방 같은 종류의 공임이
// 둘이다"까지다. 진짜 두 번 지불했는지는 운영자만 안다. 단정하면 [새로 만들기]가 틀린 답처럼
// 읽혀, 실제로 두 번 낸 경우에 운영자가 갇힌다.
//
// 갈래가 셋이라 확인창(2지)이 아니라 액션 시트(choiceDialog)를 쓴다(§14).

import { choiceDialog, confirmDialog } from '@/components/ui/ConfirmDialog'
import { fmtWon } from '@/lib/fmtMoney'
import { fmtDateDot } from '@/lib/fmtDate'
import { fmtRoomNo } from '@/lib/roomNo'

export type WorkLinkCandidateView = { id: string; date: string; amount: number; label: string; vendor: string | null }

/** 운영자가 고른 답. 'link' 는 있는 지출 걸기, 'create' 는 새로 만들기, null 은 그만두기. */
export type WorkLinkChoice = 'link' | 'create' | null

export async function askWorkLink(o: {
  roomNo: string
  kind: string
  candidates: WorkLinkCandidateView[]
}): Promise<WorkLinkChoice> {
  // 방별 분배는 한 번의 저장이 여러 줄을 만든다 — 창을 여러 번 띄우지 않고 한 창에 목록으로 낸다.
  const lines = o.candidates
    .map(c => `${fmtDateDot(c.date)} · ${c.label} ${fmtWon(c.amount)}${c.vendor ? ` · ${c.vendor}` : ''}`)
    .join('\n')
  const sum = o.candidates.reduce((s, c) => s + c.amount, 0)
  const many = o.candidates.length > 1

  const pick = await choiceDialog({
    title: `${fmtRoomNo(o.roomNo, '')} ${o.kind} 지출이 이미 있습니다`,
    message: `${lines}\n\n이 지출${many ? ` ${o.candidates.length}건(합계 ${fmtWon(sum)})` : ''}을 이 작업에 걸면 새로 만들지 않습니다. 실제로 따로 지불한 돈이라면 새로 만드세요.`,
    level: 'caution',
    confirmLabel: '있는 지출 걸기',
    altLabel: '새로 만들기',
  })
  return pick === 'confirm' ? 'link' : pick === 'alt' ? 'create' : null
}

export type WorkLinkGroupView = { workId: string; roomNo: string; kind: string; candidates: WorkLinkCandidateView[] }

/**
 * 반대 방향 — 지출을 저장한 뒤 "이 작업에 걸까요"를 묻는다.
 *
 * 첫 줄이 "지출은 저장했습니다"로 시작한다. 그 말이 없으면 [따로 두기]가 방금 저장한 것을
 * 되돌리는 것으로 읽힌다(roomBusyPrompt 가 세운 문법 그대로).
 *
 * **한 창에 목록으로 낸다.** 방별 분배는 한 번의 저장이 여러 방에 걸쳐 여러 줄을 만드는데
 * (실측 07:30 한 번이 4개 후보), 창을 네 번 연달아 띄우면 아무거나 눌러 치우게 된다.
 */
export async function askExpenseWorkLink(groups: WorkLinkGroupView[]): Promise<boolean> {
  if (groups.length === 0) return false
  const lines = groups.map(g => {
    const sum = g.candidates.reduce((s, c) => s + c.amount, 0)
    return `${fmtRoomNo(g.roomNo, '')} ${g.kind} · ${fmtWon(sum)}`
  }).join('\n')
  return confirmDialog({
    title: groups.length === 1 ? '이 지출을 작업에 걸까요' : `이 지출을 작업 ${groups.length}건에 걸까요`,
    message: `지출은 저장했습니다.\n\n${lines}\n\n걸어 두면 그 작업의 금액으로 잡히고, 나중에 완료 처리할 때 같은 돈을 두 번 적지 않습니다.`,
    level: 'caution',
    confirmLabel: '걸기',
    cancelLabel: '따로 두기',
  })
}
