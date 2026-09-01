'use client'
// '오늘 이사 처리' 정본 버튼 — 일정보다 일찍(청소가 일찍 끝나는 등) 방을 옮길 때 한 번에 처리한다.
//
// 왜 한 벌인가. 이 버튼은 프리즘 일정 행과 입주자 수정 폼의 일정 박스 두 자리에 선다.
// 각자 적으면 확인 문구·경계 이동·적용취소가 갈린다(운영자 요청 2026-09-01 — "예상보다 404호
// 청소를 일찍해서 오늘 옮기려고 해").
//
// 하는 일. 이사일이 아직 안 왔으면 경계를 오늘로 앞당기고(changeRoomMoveDate — 겹침·연속성
// 검증을 그 정본이 한다), 이어서 실제 이사를 기록한다(advanceRoomSchedule — 구간 마감·개설,
// 공실 갱신, 떠난 방 청소 예정). 두 번째가 실패하면 앞당긴 경계를 즉시 되돌려 반쪽 상태를
// 남기지 않는다. 적용취소는 이사 기록(undoRoomMove)과 경계(undoChangeRoomMoveDate)를 함께 되돌린다.

import { useTransition } from 'react'
import { changeRoomMoveDate, undoChangeRoomMoveDate, advanceRoomSchedule, undoRoomMove } from '@/app/(app)/tenants/actions'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { pushToast } from '@/lib/saveStatus'
import { kstYmdStr } from '@/lib/kstDate'
import { fmtRoomNo } from '@/lib/roomNo'

export function MoveRoomNowButton({ leaseTermId, tenantName, fromRoomNo, nextRoomNo, nextAt, onDone }: {
  leaseTermId: string
  tenantName: string
  fromRoomNo: string | null
  nextRoomNo: string | null
  /** 예정된 이사일 'YYYY-MM-DD' — 오늘보다 뒤면 경계를 오늘로 앞당긴다. */
  nextAt: string
  onDone: () => void
}) {
  const [pending, startTransition] = useTransition()
  const dot = (ymd: string) => ymd.replaceAll('-', '.')
  const run = async () => {
    const today = kstYmdStr()
    const early = nextAt > today
    const from = fmtRoomNo(fromRoomNo, '지금 방')
    const to = fmtRoomNo(nextRoomNo, '다음 방')
    const ok = await confirmDialog({
      level: 'caution',
      title: `${tenantName}님 · ${to}로 오늘 이사할까요?`,
      message: early
        ? `예정일(${dot(nextAt)})을 오늘로 앞당기고, ${from}에서 나와 옮깁니다. ${from} 청소 예정을 함께 만듭니다.`
        : `${from}에서 나와 옮기고, ${from} 청소 예정을 함께 만듭니다.`,
      confirmLabel: '오늘 이사 처리',
    })
    if (!ok) return
    startTransition(async () => {
      let boundaryUndo: { leaseTermId: string; prevSchedule: unknown } | null = null
      if (early) {
        const b = await changeRoomMoveDate({ leaseTermId, moveYmd: today })
        if (!b.ok) { pushToast('error', b.error); return }
        boundaryUndo = b.undo
      }
      const r = await advanceRoomSchedule({ leaseTermId, moveDate: today, scheduleCleaning: true })
      if (!r.ok) {
        // 반쪽 상태 금지 — 경계만 당겨지고 이사가 안 됐으면 경계를 되돌린다.
        if (boundaryUndo) await undoChangeRoomMoveDate(boundaryUndo)
        pushToast('error', r.error)
        return
      }
      pushToast('success', `${to}로 이사 처리했습니다`, {
        detail: [`${from} 청소 예정을 만들었습니다.`, r.notice].filter(Boolean).join(' '),
        action: {
          label: '적용취소',
          run: () => { void (async () => {
            const u = await undoRoomMove({ leaseTermId, moveYmd: today })
            if (!u.ok) { pushToast('error', u.error); return }
            if (boundaryUndo) await undoChangeRoomMoveDate(boundaryUndo)
            pushToast('info', '이사를 되돌렸습니다. 만들어 둔 청소 예정은 남습니다 — 필요 없으면 청소 관리에서 지워 주세요.')
            onDone()
          })() },
        },
      })
      onDone()
    })
  }
  return (
    <button type="button" onClick={run} disabled={pending}
      className="text-[0.65625rem] px-2 py-1 rounded-md border border-[var(--coral)]/45 text-[var(--coral)] hover:bg-[var(--coral)]/10 transition-colors disabled:opacity-50">
      {pending ? '옮기는 중…' : '오늘 이사 처리'}
    </button>
  )
}
