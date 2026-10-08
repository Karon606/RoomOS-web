'use client'

// 호실 도어락 마스터키 — 등록 여부 표시 · 보기(열람 기록) · 등록·변경·지우기 (2026-10-08, 운영자 승인).
//
// 소유자 전용이다(읽기 스코프 'security'). 막힌 역할에는 서버가 등록 여부부터 null 로 보내고,
// 이 위젯은 그때 아무것도 그리지 않는다. 화면 가드는 보조이고 최종 방어는 서버 액션이다.
//
// 평문은 [보기] 를 누를 때만 revealRoomMasterKey 로 받아 이 위젯의 상태에만 둔다. 방을 바꾸거나
// 프리즘을 닫으면 상태째 사라진다. 값은 토스트에도 콘솔에도 싣지 않고, 복사 버튼도 두지 않는다
// (클립보드는 앱이 지울 수 없는 자리다).

import { useEffect, useId, useState, useTransition } from 'react'
import { Btn } from '@/components/ui/Btn'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { useCanEdit, useCanReadScope } from '@/components/RoleContext'
import { useEntityModal } from '@/components/entity-modal/EntityModal'
import { fmtRoomNo } from '@/lib/roomNo'
import { withSave, pushToast } from '@/lib/saveStatus'
import {
  revealRoomMasterKey, updateRoomMasterKey, undoUpdateRoomMasterKey, type RoomMasterKeyUndo,
} from '@/app/(app)/room-manage/masterKeyActions'
import { InfoRow } from './InfoRow'
import { Section } from './Section'
import { formBoxCls, inputCls, labelCls } from './panelFormStyles'

const MASTER_KEY_MAX = 40

// §10 제출 중 — MemoSection 의 것과 같은 모양이다(스피너 14px · stroke 2.5 · 0.8s, 폭 고정).
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

export function RoomMasterKeyInfo({ roomId, roomNo, doorMasterKeySet, onChanged }: {
  roomId: string
  /** 확인창 제목에 쓴다 — 무엇을 지우는지 이름으로 말한다(§14). */
  roomNo: string | null
  /** 등록 여부. 'security' 스코프가 없는 역할에는 서버가 null 을 보낸다. */
  doorMasterKeySet: boolean | null
  /** 저장·지우기·적용취소 뒤 부모가 호실 상세를 다시 읽는다. */
  onChanged: () => void
}) {
  const canRead = useCanReadScope('security')
  const canEdit = useCanEdit()
  const uid = useId()
  // 드러난 값은 방 id 와 같이 쥔다. [보기] 응답이 오기 전에 방을 바꾸면 앞 방의 번호가 새 방 자리에
  // 서게 되는데, 그 자체가 유출이다. 지금 방의 것일 때만 그린다.
  const [revealedFor, setRevealed] = useState<{ roomId: string; value: string } | null>(null)
  const revealed = revealedFor?.roomId === roomId ? revealedFor.value : null
  const [revealing, setRevealing] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [pending, startTransition] = useTransition()
  // 저장 직후 재조회가 오기 전까지의 등록 여부. 없으면 등록하자마자 '미등록' 이 한 번 비친다.
  // 부모가 같은 값을 내려 주면 걷는다(렌더 중 조정, MemoSection 과 같은 문법).
  const [keySetFor, setKeySetOverride] = useState<{ roomId: string; set: boolean } | null>(null)
  const keySetOverride = keySetFor?.roomId === roomId ? keySetFor.set : null
  if (keySetOverride !== null && keySetOverride === doorMasterKeySet) setKeySetOverride(null)
  // 방을 바꾸면 드러난 값·폼을 걷는다. 앞 방의 번호가 새 방 화면에 남으면 그 자체가 유출이다.
  // effect 가 아니라 렌더 중 조정이다(RoomCleaningPanel 과 같은 문법). 프리즘을 닫으면 위젯이 내려가 상태째 사라진다.
  const [syncedRoom, setSyncedRoom] = useState(roomId)
  if (syncedRoom !== roomId) {
    setSyncedRoom(roomId); setRevealed(null); setRevealing(false); setFormOpen(false); setDraft(''); setKeySetOverride(null)
  }

  // 반쯤 친 마스터키가 있으면 셸에 알린다 — 배경 탭·X·Esc 가 확인창을 거친다(§12, MemoSection 과 같은 문법).
  const { markDirty } = useEntityModal()
  const dirty = formOpen && draft.trim().length > 0
  const [syncedDirty, setSyncedDirty] = useState(false)
  if (syncedDirty !== dirty) { setSyncedDirty(dirty); markDirty('room-master-key', dirty) }
  useEffect(() => () => markDirty('room-master-key', false), [markDirty])

  if (!canRead || doorMasterKeySet === null) return null
  const isSet = keySetOverride ?? doorMasterKeySet

  const reveal = async () => {
    if (revealing) return
    setRevealing(true)
    try {
      const res = await revealRoomMasterKey(roomId)
      if (!res.ok) { pushToast('error', res.error); return }
      setRevealed({ roomId, value: res.value })
      pushToast('info', '열람 기록이 남았습니다.')
    } catch {
      pushToast('error', '처리 중 통신 오류가 발생했습니다')
    } finally { setRevealing(false) }
  }

  const openForm = () => { setRevealed(null); setDraft(''); setFormOpen(true) }
  // 취소·Esc 는 무변경이다(§27.5).
  const cancel = () => { if (!pending) { setFormOpen(false); setDraft('') } }

  // 저장과 지우기가 같은 길을 탄다. 적용취소 토큰은 이전 암호문이라 평문은 이 위젯 밖으로 안 나간다.
  const commit = (value: string | null, okMsg: string) => {
    startTransition(async () => {
      const res = await withSave(() => updateRoomMasterKey(roomId, value))
      if (!res.ok) return
      const u: RoomMasterKeyUndo = res.undo
      // 적용취소 결과 문장은 무엇을 물렀는지로 갈린다(§16 "{목적어}를 적용취소했습니다 · {복귀}"). 값은 싣지 않는다.
      const undoneMsg = u.prevEnc === null ? '마스터키 등록을 적용취소했습니다 · 미등록으로 복원'
        : value === null ? '마스터키 지움을 적용취소했습니다 · 이전 마스터키로 복원'
        : '마스터키 변경을 적용취소했습니다 · 이전 마스터키로 복원'
      setKeySetOverride({ roomId, set: value !== null })
      setFormOpen(false); setDraft(''); setRevealed(null)
      pushToast('success', okMsg, {
        action: {
          label: '적용취소',
          run: () => { void undoUpdateRoomMasterKey(u).then(r => {
            if (r.ok) { setKeySetOverride(null); setRevealed(null); pushToast('info', undoneMsg); onChanged() }
            else pushToast('error', r.error)
          }).catch(() => pushToast('error', '처리 중 통신 오류가 발생했습니다')) },
        },
      })
      onChanged()
    })
  }

  const save = () => {
    const v = draft.trim()
    if (!v || v.length > MASTER_KEY_MAX) return
    commit(v, '마스터키 저장됨')
  }

  const clear = async () => {
    // 되돌릴 길은 토스트가 떠 있는 동안뿐이다 — 상시 복구처럼 약속하지 않는다(가짜 undo 금지).
    const ok = await confirmDialog({
      title: `${fmtRoomNo(roomNo, '이 방')} 마스터키를 지울까요?`,
      message: '지운 직후 알림의 적용취소로만 되돌릴 수 있습니다. 알림이 사라지면 다시 입력해야 합니다.',
      level: 'caution', confirmLabel: '지우기',
    })
    if (!ok) return
    commit(null, '마스터키 지움')
  }

  // 헤더 버튼은 전부 secondary — 외국인등록번호 칸([보기][변경] secondary, [삭제] ghost)과 같은 위계다.
  // 편집 중에는 null 을 넘겨 슬롯만 비우고 행 높이는 지킨다(Section). 드러난 상태에도 [변경]을 둔다 — 바꾸려고
  // 먼저 가릴 필요가 없다. 소유자만 오는 절이라 canEdit 은 보조 가드다.
  const action = formOpen ? null
    : !isSet ? (canEdit ? <Btn variant="secondary" size="sm" onClick={openForm}>등록</Btn> : null)
    : (
      <div className="flex gap-2">
        {revealed !== null
          ? <Btn variant="secondary" size="sm" onClick={() => setRevealed(null)}>가리기</Btn>
          : <Btn variant="secondary" size="sm" disabled={revealing} aria-busy={revealing} onClick={() => void reveal()}>보기</Btn>}
        {canEdit && <Btn variant="secondary" size="sm" onClick={openForm}>변경</Btn>}
      </div>
    )

  return (
    <Section title="도어락" action={action}>
      {formOpen ? (
        <form className={formBoxCls} onSubmit={e => { e.preventDefault(); save() }}>
          {/* 라벨과 입력은 한 묶음(space-y-1.5, §12 라벨 간격) — DepositStatusPanel 의 금액 칸과 같은 문법. */}
          <div className="space-y-1.5">
            <label className={`block ${labelCls}`} htmlFor={`${uid}-key`}>{isSet ? '새 마스터키' : '마스터키'}</label>
            {/* 코드에 영문이 섞일 수 있어 첫 글자 자동 대문자·자동 고침을 끈다. 바뀐 채 저장되면 문이 안 열린다. */}
            <input id={`${uid}-key`} type="text" value={draft} onChange={e => setDraft(e.target.value)} maxLength={MASTER_KEY_MAX}
              autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} autoFocus
              readOnly={pending}
              onKeyDown={e => {
                // 셸 모달이 창 전체에서 Esc 를 듣는다. 여기서 끊지 않으면 폼 취소가 아니라 프리즘이 닫힌다.
                if (e.key !== 'Escape' || e.nativeEvent.isComposing) return
                e.stopPropagation()
                cancel()
              }}
              className={`${inputCls} tabular-nums`} />
          </div>
          <div className={`flex items-center gap-2 ${isSet ? 'justify-between' : 'justify-end'}`}>
            {isSet && (
              <Btn variant="ghost" size="sm" disabled={pending} onClick={() => void clear()}
                style={{ color: 'var(--danger-fg)' }}>지우기</Btn>
            )}
            <div className="flex gap-2">
              {/* subtle — --cream-soft 면 위 취소는 subtle 이 정본이다(MemoSection 과 같은 판정, §10). */}
              <Btn variant="subtle" size="sm" disabled={pending} onClick={cancel}>취소</Btn>
              <Btn type="submit" variant="primary" size="sm" disabled={pending || !draft.trim()} aria-busy={pending}>
                <SaveLabel pending={pending} />
              </Btn>
            </div>
          </div>
        </form>
      ) : (
        <InfoRow label="마스터키" value={
          !isSet ? '미등록'
            // 드러난 값은 다른 InfoRow 값과 같은 14px 이다(16px 이면 보기 ↔ 가리기 때 행 높이가 바뀐다).
            // 가린 값은 고정 여섯 자(길이를 흘리지 않는다). 별표는 Pretendard 에서 작고 위로 떠 비밀번호 마스크로 안 읽혀 가운뎃점을 쓴다.
            : revealed !== null ? <span className="text-sm font-medium tabular-nums tracking-wide">{revealed}</span>
            : <span className="tracking-widest" aria-label="가려진 마스터키">••••••</span>
        } />
      )}
    </Section>
  )
}
