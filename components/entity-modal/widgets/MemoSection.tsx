'use client'

// 호실 메모 — 표시와 인라인 편집(2026-10-08, 운영자 승인). 호실 면 전용이다.
//
// 형제 면(TenantBody 의 메모 절)과 같은 표시 문법이다. 종전에는 InfoRow 였는데 그 값 칸은
// text-right 라 긴 메모가 오른쪽으로 뭉개지고 줄바꿈이 사라졌다. 메모는 길이를 모르는
// 자유 입력이라 좌우 한 줄 문법에 안 맞는다. 입주자 면은 자체 렌더라 이 파일을 안 쓴다.
//
// 비어 있어도 절을 그린다. 종전처럼 빈 메모에 절이 사라지면 '작성' 문이 앱 어디에도 없다
// (호실 관리 수정 폼까지 가야 했다). 편집 문법은 같은 면의 작업 이력 위젯과 같다 — 헤더 버튼으로
// 열고, formBoxCls 상자 안에서 [취소][저장], 저장 뒤 토스트 [적용취소].

import { useEffect, useState, useTransition } from 'react'
import { Btn } from '@/components/ui/Btn'
import { useCanEdit } from '@/components/RoleContext'
import { useEntityModal } from '@/components/entity-modal/EntityModal'
import { withSave, pushToast } from '@/lib/saveStatus'
import { updateRoomMemo } from '@/app/(app)/room-manage/masterKeyActions'
import { Section } from './Section'
import { formBoxCls, inputCls } from './panelFormStyles'

// §10 제출 중 — 스피너 14px · stroke 2.5 · 0.8s + '저장 중…'. 두 라벨을 한 칸에 겹쳐 두고 하나만
// 보이게 해서, 버튼 폭이 늘 넓은 쪽에 고정된다(라벨이 바뀌어도 옆 버튼이 밀리지 않는다).
function SaveLabel({ pending }: { pending: boolean }) {
  return (
    <span className="inline-grid place-items-center">
      <span className={`col-start-1 row-start-1 ${pending ? 'invisible' : ''}`}>저장</span>
      <span className={`col-start-1 row-start-1 inline-flex items-center gap-1.5 ${pending ? '' : 'invisible'}`} aria-hidden={!pending}>
        <svg className="animate-spin [animation-duration:0.8s]" width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9" /></svg>
        저장 중…
      </span>
    </span>
  )
}

export function MemoSection({ memo, roomId, onChanged }: {
  memo: string | null | undefined
  roomId: string
  /** 저장·적용취소 뒤 부모가 호실 상세를 다시 읽는다. */
  onChanged: () => void
}) {
  const canEdit = useCanEdit()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [pending, startTransition] = useTransition()
  // 저장 직후 재조회가 오기 전까지 보여 줄 값. 이게 없으면 폼이 닫히는 순간 옛 메모가 한 번 비쳤다가
  // 새 메모로 바뀐다. 부모가 같은 값을 내려 주면 걷는다(렌더 중 조정). 방 id 를 같이 쥐는 이유는
  // 저장이 도는 사이 방을 바꾸면 앞 방의 메모가 새 방 자리에 서기 때문이다.
  const [shownOverride, setShownOverride] = useState<{ roomId: string; memo: string | null } | null>(null)
  const override = shownOverride?.roomId === roomId ? shownOverride : null
  if (override && override.memo === (memo ?? null)) setShownOverride(null)
  // 방을 바꾸면(방 전환 세그먼트) 편집을 접는다 — 앞 방에서 쓰던 글이 새 방 메모로 저장되면 안 된다.
  // effect 가 아니라 렌더 중 조정이다(RoomCleaningPanel 과 같은 문법).
  const [syncedRoom, setSyncedRoom] = useState(roomId)
  if (syncedRoom !== roomId) { setSyncedRoom(roomId); setEditing(false); setDraft(''); setShownOverride(null) }

  const shown = override ? override.memo : (memo ?? null)

  // 쓰다 만 글이 있으면 셸에 알린다 — 배경을 탭해도 그냥 안 닫히고 확인창을 거친다(§12, TenantRequestsTab 과 같은 문법).
  // 아이폰에서 키보드를 내리려고 칸 밖을 누르는 것이 관습이라 실수로 닿기 쉬운 자리다. 렌더 중 조정이고,
  // '바뀌었나'가 바뀔 때만 상태를 쓴다. 방 전환이 editing 을 접으면 dirty 도 같이 내려간다.
  const { markDirty } = useEntityModal()
  const dirty = editing && draft.trim() !== (shown ?? '')
  const [syncedDirty, setSyncedDirty] = useState(false)
  if (syncedDirty !== dirty) { setSyncedDirty(dirty); markDirty('room-memo', dirty) }
  useEffect(() => () => markDirty('room-memo', false), [markDirty])

  const open = () => { setDraft(shown ?? ''); setEditing(true) }
  // 취소·Esc 는 무변경이다(§27.5).
  const cancel = () => { if (!pending) { setEditing(false); setDraft('') } }

  const save = () => {
    const next = draft.trim() ? draft.trim() : null
    if (next === shown) { setEditing(false); setDraft(''); return }
    startTransition(async () => {
      const res = await withSave(() => updateRoomMemo(roomId, next))
      if (!res.ok) return
      const u = res.undo
      setShownOverride({ roomId, memo: next })
      setEditing(false); setDraft('')
      pushToast('success', '메모 저장됨', {
        action: {
          label: '적용취소',
          run: () => { void updateRoomMemo(u.roomId, u.prevMemo).then(r => {
            if (r.ok) { setShownOverride(null); pushToast('info', '메모 변경을 적용취소했습니다 · 이전 내용으로 복원'); onChanged() }
            else pushToast('error', r.error)
          }).catch(() => pushToast('error', '처리 중 통신 오류가 발생했습니다')) },
        },
      })
      onChanged()
    })
  }

  return (
    <Section title="메모" action={!canEdit ? undefined : editing ? null
      : <Btn variant="secondary" size="sm" onClick={open}>{shown ? '수정' : '작성'}</Btn>}>
      {editing ? (
        <div className={formBoxCls}>
          {/* placeholder 는 호실 관리 폼의 메모 칸과 같은 말이다. autoFocus 는 탭 핸들러 안에서 여는 자리라 iOS 에서도 키보드가 선다. */}
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={3} autoComplete="off" autoFocus
            placeholder="방 컨디션 메모" aria-label="메모" readOnly={pending}
            onKeyDown={e => {
              // 셸 모달이 창 전체에서 Esc 를 듣는다. 여기서 끊지 않으면 편집 취소가 아니라 프리즘이 닫힌다.
              if (e.key !== 'Escape' || e.nativeEvent.isComposing) return
              e.stopPropagation()
              cancel()
            }}
            className={`${inputCls} resize-none leading-relaxed`} />
          <div className="flex justify-end gap-2">
            {/* subtle — 면(formBoxCls)이 --cream-soft 라 ghost 는 누름 배경이 면과 같은 색이 되고 테두리도 없어
                버튼으로 안 읽힌다(DepositStatusPanel 의 취소 셋과 같은 판정, §10). */}
            <Btn variant="subtle" size="sm" disabled={pending} onClick={cancel}>취소</Btn>
            <Btn variant="primary" size="sm" disabled={pending} aria-busy={pending} onClick={save}>
              <SaveLabel pending={pending} />
            </Btn>
          </div>
        </div>
      ) : shown ? (
        <p className="text-sm text-[var(--warm-dark)] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{shown}</p>
      ) : (
        <p className="text-xs text-[var(--warm-muted)]">메모가 없습니다.</p>
      )}
    </Section>
  )
}
