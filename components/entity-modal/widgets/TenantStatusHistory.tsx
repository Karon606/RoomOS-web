'use client'

// 이 고객의 상태 이력 — TenantStatusLog 를 최신순으로. 신고 ad517231.
//
// 이 테이블은 167건이 쌓여 있는데 **읽는 화면이 하나도 없었다**(설정의 데이터 내보내기가 유일).
// 운영자가 입실 취소 사유를 적고 어디서도 못 찾아 신고했다. 취소 사유만 꽂으면 같은 테이블의
// 나머지가 그대로 안 보이므로 이력 전체를 연다.
//
// 사유는 있을 때만 둘째 줄에 붙인다. 없는 행에 대시를 찍지 않는다 —
// '기록 안 함'이 기본값이라 비어 있는 것이 정상 상태다.
// 대신 사유를 받는 전이(입실 취소·퇴실)인데 비어 있으면 [사유 기록] 으로 소급 입력을 연다.

import { useEffect, useState } from 'react'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { getTenantStatusHistory, updateStatusLogReason } from '@/app/(app)/rooms/actions'
import { Section } from './Section'
import { Modal } from '@/components/ui/Modal'
import { Btn } from '@/components/ui/Btn'
import { RowActionBtn } from '@/components/ui/RowActionBtn'
import { pushToast } from '@/lib/saveStatus'
import { STATUS_LABEL } from '@/lib/statusColors'
import { buildReason, parseReason, reasonsForStatus, reasonLabel, withRo } from '@/lib/statusReasons'

import { fmtDateDot } from '@/lib/fmtDate'   // 날짜 표기 정본

const RECENT = 5   // 최근 N건만 펼침, 초과분은 '이전 이력' 뒤로

type HistItem = Awaited<ReturnType<typeof getTenantStatusHistory>>['items'][number]

const label = (s: string) => STATUS_LABEL[s] ?? s

export function TenantStatusHistory({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getTenantStatusHistory>> | null>(null)
  const [showOlder, setShowOlder] = useState(false)
  const [edit, setEdit] = useState<HistItem | null>(null)

  // 실패해도 스켈레톤이 영구 잔존하지 않게 빈 목록으로 떨어뜨린다(§27.2)
  const load = () => { getTenantStatusHistory(tenantId).then(setData).catch(() => setData({ items: [] })) }
  useEffect(() => {
    let active = true
    getTenantStatusHistory(tenantId)
      .then(d => { if (active) setData(d) })
      .catch(() => { if (active) setData({ items: [] }) })
    return () => { active = false }
  }, [tenantId])

  if (data === null) {
    return <Section title="상태 이력"><SkeletonRows rows={2} className="py-1" /></Section>
  }
  // 이사 이력과 달리 1건이어도 보여준다 — 이사 1건은 '안 옮겼다'는 뜻이지만 상태 이력 1건은 그 자체가 답이다.
  if (data.items.length === 0) return null

  const recent = data.items.slice(0, RECENT)
  const older  = data.items.slice(RECENT)

  return (
    <Section title="상태 이력">
      <ul className="space-y-1.5">
        {recent.map(it => <HistRow key={it.id} item={it} onEdit={setEdit} />)}
      </ul>
      {older.length > 0 && (
        <div className="mt-2">
          <button type="button" onClick={() => setShowOlder(v => !v)}
            className="text-xs font-medium text-[var(--warm-muted)] flex items-center gap-1">
            이전 이력 {older.length}건 <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 transition-transform ${showOlder ? 'rotate-180' : ''}`} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          {showOlder && (
            <ul className="mt-2 space-y-1.5">
              {older.map(it => <HistRow key={it.id} item={it} onEdit={setEdit} />)}
            </ul>
          )}
        </div>
      )}
      {edit && <ReasonEditModal item={edit} onClose={() => setEdit(null)} onDone={load} />}
    </Section>
  )
}

function HistRow({ item, onEdit }: { item: HistItem; onEdit: (it: HistItem) => void }) {
  // 사유를 받지 않는 전이의 reason 은 시스템 라벨('단기 연장')이라 '퇴실 사유:' 를 붙이지 않는다.
  const rLabel = reasonLabel(item.toStatus)
  return (
    <li>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="min-w-0 truncate font-medium text-[var(--warm-dark)]">
          {item.isCreated ? `${withRo(label(item.toStatus))} 등록` : `${label(item.fromStatus)}에서 ${withRo(label(item.toStatus))}`}
        </span>
        <span className="shrink-0 whitespace-nowrap tabular-nums text-[var(--warm-muted)]">{fmtDateDot(item.changedAt)}</span>
      </div>
      {item.reason && (
        <div className="mt-0.5 flex items-center justify-between gap-2 pl-2">
          <span className="min-w-0 truncate text-[0.65625rem] text-[var(--warm-muted)]">{rLabel ? `${rLabel}: ` : ''}{item.reason}</span>
          {item.editable && (
            <RowActionBtn tone="accent" className="shrink-0" onClick={() => onEdit(item)}>수정</RowActionBtn>
          )}
        </div>
      )}
      {/* 기록 진입은 가장 최근 종료 전이 한 행에만 — 퇴실 예정·퇴실 두 행에 다 뜨면
          어느 쪽이 정본인지 화면에 단서가 없다(서버가 canRecord 로 정한다) */}
      {!item.reason && item.canRecord && rLabel && (
        <div className="mt-0.5 pl-2">
          <RowActionBtn tone="accent" onClick={() => onEdit(item)}>{rLabel} 기록</RowActionBtn>
        </div>
      )}
    </li>
  )
}

// 사유 편집 — 전환 미니폼과 같은 문법(select + '기타' 자유 입력). 새 문법을 만들지 않는다.
function ReasonEditModal({ item, onClose, onDone }: { item: HistItem; onClose: () => void; onDone: () => void }) {
  const init = parseReason(item.reason)
  const [sel, setSel] = useState(init.selected)
  const [etc, setEtc] = useState(init.etcText)
  const [pending, setPending] = useState(false)
  const opts = reasonsForStatus(item.toStatus) ?? []
  const dirty = sel !== init.selected || etc !== init.etcText

  const save = async () => {
    if (pending) return
    setPending(true)
    try {
      const next = buildReason(sel, etc) || null
      const res = await updateStatusLogReason(item.id, next)
      if (!res.ok) { pushToast('error', res.error); return }
      const prev = res.prev
      const lab = reasonLabel(item.toStatus) ?? '사유'
      pushToast('success', next ? `${lab}를 저장했습니다` : `${lab}를 지웠습니다`, {
        // 상시 진입점은 같은 [수정] 버튼이다 — 텍스트는 되돌려 쓰는 것이 곧 적용취소라(§16)
        // 여기 토스트는 즉시 되돌리기용 편의다.
        action: { label: '적용취소', run: () => { void updateStatusLogReason(item.id, prev).then(u => {
          if (u.ok) { pushToast('info', '사유를 되돌렸습니다'); onDone() }
          else pushToast('error', u.error)
        }).catch(() => pushToast('error', '되돌리기 중 통신 오류가 발생했습니다')) } },
      })
      onClose()
      onDone()
    } finally { setPending(false) }
  }

  return (
    <Modal open z={260} width="sm" dirty={dirty} onClose={() => { if (!pending) onClose() }}
      title={reasonLabel(item.toStatus) ?? '사유'}
      subtitle={`${label(item.fromStatus)}에서 ${withRo(label(item.toStatus))} · ${fmtDateDot(item.changedAt)}`}
      footer={
        <div className="flex gap-2">
          <Btn variant="secondary" size="md" onClick={onClose} disabled={pending} className="flex-1">취소</Btn>
          <Btn variant="primary" size="md" onClick={save} disabled={pending} className="flex-1">{pending ? '저장 중…' : '저장'}</Btn>
        </div>
      }>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--warm-mid)]">{reasonLabel(item.toStatus) ?? '사유'} <span className="font-normal opacity-60">(선택)</span></label>
        <select value={sel} onChange={e => setSel(e.target.value)}
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
          <option value="">기록 안 함</option>
          {opts.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        {sel === '기타' && (
          <input type="text" value={etc} onChange={e => setEtc(e.target.value)}
            placeholder="사유를 직접 입력하세요"
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
        )}
        <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed">
          이 항목의 사유만 고칩니다. 상태와 변경 시각은 그대로 남습니다.
        </p>
      </div>
    </Modal>
  )
}
