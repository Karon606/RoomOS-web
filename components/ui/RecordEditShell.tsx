'use client'

// 이력 목록 한 건 수정 Modal 의 공용 껍데기 — 작업·청소·점검 수정 폼 셋이 같은 머리·캡션·발끝·`관리` 메뉴를 쓴다(2026-10-27, 가이드 §27.1·§13).
//
// 왜 (운영자 지적 2026-10-27). "특정 내역만 수정하고 싶은데 편집을 누르니 내역 전체를 수정할 수 있게 되버리네… 다른 내역을 잘못 건드리면 바뀌어서 불안해".
// 목록 전체를 켜는 편집 모드를 걷고, 행 [수정] → 그 한 건만 고치는 Modal 로 바꿨다. 정본 선례는 상태 이력 사유 수정(TenantStatusHistory ReasonEditModal).
//
// 문법.
//   · 머리 = 제목('도배 수정') + 부제('522호 · 완료 10/4 (토)'), 본문 첫 줄 캡션 '이 기록 한 건만 고칩니다. 다른 기록은 그대로입니다.'
//   · 발끝 두 줄 고정(§13 모달 발끝 관리 메뉴, flex-wrap 없음). 윗줄 [취소] secondary md + `관리` secondary md(폭 44px 이상), 아랫줄 [저장] primary md 풀폭.
//     관리 항목이 없으면 윗줄은 [취소] 하나다.
//   · `관리` 메뉴는 재고 상세 발끝 메뉴(InventoryClient DetailManageMenu)와 한 문법이다. usePopoverAnchor + portal, 위로 먼저(placement 'above'),
//     오른쪽 끝 맞춤(align 'end'), r-xl·shadow-lift·p-2·행 44px, 파괴 항목은 구분선 아래 --danger-fg, 쓸 수 없는 항목은 부르는 쪽이 아예 안 넘긴다(숨김).
//     키보드: 열면 첫 행 포커스, Esc·바깥 누름·항목 실행으로 닫으면 트리거로 포커스, ↑↓ Home End 로 행 사이, Tab 은 닫고 트리거에서 이어 간다.
//   · dirty 면 배경 클릭 무시·Esc·X 는 닫기 확인(§12, Modal 정본이 한다). 저장 중에는 닫지 않는다.
//   · 저장 버튼이 막히면 그 위 한 줄로 이유를 말한다(§27.8 ③, saveReason).

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Modal } from '@/components/ui/Modal'
import { Btn } from '@/components/ui/Btn'
import { usePopoverAnchor } from '@/components/ui/usePopoverAnchor'
import { WhyCaption } from '@/components/ui/WhyCaption'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { pushToast } from '@/lib/saveStatus'
import { undoRoomRecordEdit } from '@/app/(app)/room-manage/recordEditActions'
import type { RoomRecordEditUndo } from '@/lib/roomRecordEditUndo'

/**
 * 관리 메뉴 한 줄. onSelect 는 폼을 고친 상태인지(dirty)를 받는다. 고친 상태면 확인창 문구에 RECORD_EDIT_DIRTY_NOTE 를 붙이고,
 * 확인창이 없던 항목도 그때는 한 번 묻는다(독립 검수 권고 6). 항목을 실행하면 창이 닫혀 고친 내용이 저장되지 않기 때문이다.
 */
export type RecordManageItem = { key: string; label: string; onSelect: (dirty: boolean) => void; danger?: boolean }

/** 고친 내용을 버리게 되는 관리 동작의 확인 문구에 붙는 한 줄. */
export const RECORD_EDIT_DIRTY_NOTE = '고친 내용은 저장되지 않습니다.'
/** 확인창이 없던 관리 항목을 고친 상태에서 실행할 때 한 번 묻는다. 고친 게 없으면 바로 참. */
export async function confirmDiscardEdits(dirty: boolean, action: string): Promise<boolean> {
  if (!dirty) return true
  return confirmDialog({ title: `${action}할까요?`, message: RECORD_EDIT_DIRTY_NOTE, confirmLabel: action, level: 'caution' })
}
/** 확인창 본문에 고친 내용 안내를 붙인다. */
export const withDirtyNote = (message: string, dirty: boolean) => (dirty ? `${message} ${RECORD_EDIT_DIRTY_NOTE}` : message)

/** 수정 저장 토스트의 적용취소 — 저장 직전 모습 전체로(서버가 서명한 토큰, undoRoomRecordEdit). 토큰이 없으면(운영 서명 키 없음) 버튼을 숨긴다. */
export function recordEditUndoAction(undo: RoomRecordEditUndo | null, what: string, onChanged: () => void) {
  return undo ? { action: { label: '적용취소', run: () => { void undoRoomRecordEdit(undo).then(res => {
    if (res.ok) { pushToast('info', `${what} 수정을 적용취소했습니다`); onChanged() }
    else pushToast('error', res.error)
  }).catch(() => pushToast('error', '처리 중 통신 오류가 발생했습니다')) } } } : undefined
}

export const RECORD_EDIT_CAPTION = '이 기록 한 건만 고칩니다. 다른 기록은 그대로입니다.'

// 메뉴 행 — 재고 상세 발끝 메뉴와 같은 값. 파괴 행은 글자색을 갈아 끼운 별도 상수다(한 클래스에 글자색 둘을 얹으면 생성 CSS 차례가 이긴다).
const MENU_ROW_BOX = 'w-full flex items-center gap-2.5 min-h-[44px] px-2 py-1.5 rounded-lg text-left text-sm disabled:opacity-40 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tc-text)]'
const MENU_ROW = `${MENU_ROW_BOX} text-[var(--warm-dark)] hover:bg-[var(--cream-soft)]`
const MENU_ROW_DANGER = `${MENU_ROW_BOX} text-[var(--danger-fg)] hover:bg-[var(--danger-bg)]`

function menuKeyNav(e: React.KeyboardEvent<HTMLElement>, onTab: () => void) {
  if (e.key === 'Tab') { onTab(); return }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
  if (items.length === 0) return
  e.preventDefault()
  const i = items.indexOf(document.activeElement as HTMLButtonElement)
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
    : e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
  items[next]?.focus()
}

function ManageMenu({ items, disabled, dirty }: { items: RecordManageItem[]; disabled?: boolean; dirty: boolean }) {
  const [open, setOpen] = useState(false)
  const plain = items.filter(i => !i.danger)
  const danger = items.filter(i => i.danger)
  // 높이 예측 = 테두리 2 + p-2 16 + 행 44·n (+ 구분선 9). 위로 뜰 자리를 이 값으로 정한다.
  const { pos, triggerRef, measure } = usePopoverAnchor<HTMLSpanElement>({
    minWidth: 208, estimatedHeight: 18 + 44 * items.length + (plain.length && danger.length ? 9 : 0), placement: 'above', align: 'end',
  })
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    panelRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation(); setOpen(false); triggerRef.current?.querySelector('button')?.focus()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, triggerRef])
  const close = () => { setOpen(false); triggerRef.current?.querySelector('button')?.focus() }
  const run = (f: (dirty: boolean) => void) => { close(); f(dirty) }
  return (
    <>
      <span ref={triggerRef} className="shrink-0">
        <Btn variant="secondary" size="md" className="min-w-11 whitespace-nowrap" aria-expanded={open} disabled={disabled}
          onClick={() => { if (!open) measure(); setOpen(v => !v) }}>관리</Btn>
      </span>
      {open && typeof window !== 'undefined' && createPortal(
        <>
          <div className="fixed inset-0 z-[var(--z-lightbox)]" onClick={close} />
          <div ref={panelRef} onKeyDown={e => menuKeyNav(e, close)}
            className="fixed z-[calc(var(--z-lightbox)+1)] bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl shadow-lift p-2"
            style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: '70vh', overflowY: 'auto' }}>
            {plain.map(i => <button key={i.key} type="button" className={MENU_ROW} onClick={() => run(i.onSelect)}>{i.label}</button>)}
            {plain.length > 0 && danger.length > 0 && <div className="my-1 border-t border-[var(--warm-border)]" />}
            {danger.map(i => <button key={i.key} type="button" className={MENU_ROW_DANGER} onClick={() => run(i.onSelect)}>{i.label}</button>)}
          </div>
        </>,
        document.body,
      )}
    </>
  )
}

export function RecordEditShell({
  title, subtitle, z, dirty, pending, saveReason, onSave, onClose, manage, children,
}: {
  title: string
  subtitle: string
  /** 방 모달(EntityModal) 안에서는 260, 페이지에서는 200. 부르는 쪽이 자리를 안다. */
  z: 200 | 260
  dirty: boolean
  pending: boolean
  /** 저장을 막는 까닭(§27.8 ③). 있으면 저장 버튼 위 한 줄로 말하고 버튼은 aria-disabled 로 막힌다. */
  saveReason?: string | null
  onSave: () => void
  onClose: () => void
  /** 이 건의 되돌림·파괴 동작(완료 적용취소·안 하기로·안 함 적용취소·삭제). 쓸 수 없는 것은 넘기지 않는다. */
  manage: RecordManageItem[]
  children: ReactNode
}) {
  const reasonId = useId()
  return (
    <Modal open z={z} width="sm" dirty={dirty} onClose={() => { if (!pending) onClose() }}
      title={title} subtitle={subtitle}
      footer={
        <div className="space-y-2">
          {saveReason && <WhyCaption id={reasonId}>{saveReason}</WhyCaption>}
          <div className="flex gap-2">
            <Btn variant="secondary" size="md" onClick={onClose} disabled={pending} className="flex-1">취소</Btn>
            {manage.length > 0 && <ManageMenu items={manage} disabled={pending} dirty={dirty} />}
          </div>
          <Btn variant="primary" size="md" fullWidth onClick={onSave} disabled={pending} reason={saveReason ? reasonId : undefined}>
            {pending ? '저장 중…' : '저장'}
          </Btn>
        </div>
      }>
      <div className="space-y-3">
        <p className="text-[0.65625rem] leading-relaxed text-[var(--warm-muted)] break-keep">{RECORD_EDIT_CAPTION}</p>
        {children}
      </div>
    </Modal>
  )
}
