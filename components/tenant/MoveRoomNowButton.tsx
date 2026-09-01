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
import { choiceDialog, confirmDialog } from '@/components/ui/ConfirmDialog'
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
    // 청소 예정은 강제하지 않는다 — 만들지 여부를 같이 묻는다(운영자 지적 2026-09-01,
    // "옵션도 없이 만드는 것은 잘못된 것 같아"). §27 3지선다 정본이라 새 화면 문법이 없다.
    const pick = await choiceDialog({
      level: 'caution',
      title: `${tenantName}님 · ${to}로 오늘 이사할까요?`,
      message: early
        ? `예정일(${dot(nextAt)})을 오늘로 앞당기고, ${from}에서 나와 옮깁니다.`
        : `${from}에서 나와 옮깁니다.`,
      confirmLabel: `이사 + ${from} 청소 예정`,
      altLabel: '이사만',
    })
    if (pick === null || pick === 'back') return
    const withCleaning = pick === 'confirm'
    startTransition(async () => {
      let boundaryUndo: { leaseTermId: string; prevSchedule: unknown } | null = null
      if (early) {
        const b = await changeRoomMoveDate({ leaseTermId, moveYmd: today })
        if (!b.ok) { pushToast('error', b.error); return }
        boundaryUndo = b.undo
      }
      const r = await advanceRoomSchedule({ leaseTermId, moveDate: today, scheduleCleaning: withCleaning })
      if (!r.ok) {
        // 반쪽 상태 금지 — 경계만 당겨지고 이사가 안 됐으면 경계를 되돌린다.
        // 되돌림이 또 실패하면 침묵하지 않는다(§27.2) — 이사일만 오늘로 남은 상태를 사람이 알아야 고친다.
        const bu = boundaryUndo ? await undoChangeRoomMoveDate(boundaryUndo) : { ok: true as const }
        pushToast('error', bu.ok ? r.error : `${r.error} 이사일이 오늘로 당겨진 채 남았습니다. 이사일 바꾸기로 되돌려 주세요.`)
        return
      }
      pushToast('success', `${to}로 이사 처리했습니다`, {
        detail: [withCleaning ? `${from} 청소 예정을 만들었습니다.` : null, r.notice].filter(Boolean).join(' '),
        action: {
          label: '적용취소',
          run: () => { void (async () => {
            const u = await undoRoomMove({ leaseTermId, moveYmd: today })
            if (!u.ok) { pushToast('error', u.error); return }
            const bu = boundaryUndo ? await undoChangeRoomMoveDate(boundaryUndo) : { ok: true as const }
            pushToast('info', bu.ok
              ? `이사를 되돌렸습니다.${withCleaning ? ' 만들어 둔 청소 예정은 남습니다. 필요 없으면 청소 관리에서 지워 주세요.' : ''}`
              : '이사는 되돌렸지만 이사일이 오늘로 남았습니다. 홈 알림에서 다시 확인하거나 이사일 바꾸기로 고쳐 주세요.')
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

/**
 * 오늘 이사의 상시 적용취소 — 토스트(6초)가 지나가도 되돌릴 길이 남아야 한다(§16, 검토 패널).
 * 일정 경계는 안 건드린다 — 경계는 이미 오늘이라 홈 알림이 그날 다시 확인을 묻는다.
 */
export function UndoRoomMoveButton({ leaseTermId, movedYmd, onDone }: {
  leaseTermId: string
  movedYmd: string
  onDone: () => void
}) {
  const [pending, startTransition] = useTransition()
  const run = async () => {
    const ok = await confirmDialog({
      title: '오늘 한 이사를 적용취소할까요?',
      message: '오늘 옮긴 구간을 지우고 이전 방으로 되돌립니다. 청소 예정을 만들었다면 남고, 이사 예정은 오늘로 남아 홈 알림에서 다시 확인할 수 있습니다.',
      level: 'caution', confirmLabel: '적용취소',
    })
    if (!ok) return
    startTransition(async () => {
      const u = await undoRoomMove({ leaseTermId, moveYmd: movedYmd })
      if (!u.ok) { pushToast('error', u.error); return }
      pushToast('info', '이사를 되돌렸습니다. 청소 예정을 만들었다면 남습니다.')
      onDone()
    })
  }
  return (
    <button type="button" onClick={run} disabled={pending}
      className="text-[0.65625rem] px-2 py-1 rounded-md border border-[var(--warm-border)] text-[var(--warm-mid)] hover:bg-[var(--warm-border)]/40 transition-colors disabled:opacity-50">
      {pending ? '되돌리는 중…' : '이사 적용취소'}
    </button>
  )
}
