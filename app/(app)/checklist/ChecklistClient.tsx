'use client'

import { useState, useTransition } from 'react'
import { EmptyState } from '@/components/ui/EmptyState'
import { useRouter } from 'next/navigation'
import {
  type ChecklistRow,
  createChecklist,
  updateChecklist,
  deleteChecklist,
  markChecklistDone,
  deleteChecklistLog,
} from './actions'
import { DEFAULT_CHECKLIST_ALERT_DAYS_BEFORE } from '@/lib/appConfig'
import { withSave, pushToast } from '@/lib/saveStatus'
import { Btn } from '@/components/ui/Btn'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { Modal } from '@/components/ui/Modal'
import { DatePicker } from '@/components/ui/DatePicker'
import { kstYmdStr } from '@/lib/kstDate'

type Mode = 'create' | { mode: 'edit'; row: ChecklistRow } | { mode: 'check'; row: ChecklistRow } | null

const PRESETS: { label: string; days: number }[] = [
  { label: '매일',   days: 1 },
  { label: '매주',   days: 7 },
  { label: '격주',   days: 14 },
  { label: '매월',   days: 30 },
  { label: '분기',   days: 90 },
]

function fmtKorDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const DAYS = ['일','월','화','수','목','금','토']
  return `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일 (${DAYS[d.getDay()]})`
}

function fmtRelative(iso: string | null): string {
  if (!iso) return '점검 이력 없음'
  const d = new Date(iso)
  const now = Date.now()
  const diff = now - d.getTime()
  if (diff < 60_000) return '방금'
  if (diff < 3600_000) return `${Math.floor(diff/60_000)}분 전`
  if (diff < 86400_000) return `${Math.floor(diff/3600_000)}시간 전`
  if (diff < 30 * 86400_000) return `${Math.floor(diff/86400_000)}일 전`
  return fmtKorDate(iso)
}

function intervalLabel(days: number): string {
  const preset = PRESETS.find(p => p.days === days)
  if (preset) return preset.label
  return `${days}일마다`
}

function dueChip(row: ChecklistRow) {
  if (row.daysUntilDue == null) {
    return { label: '점검 필요', color: 'var(--danger-fg)', bg: 'var(--danger-bg)' }
  }
  if (row.daysUntilDue < 0) {
    return { label: `${Math.abs(row.daysUntilDue)}일 경과`, color: 'var(--danger-fg)', bg: 'var(--danger-bg)' }
  }
  if (row.daysUntilDue === 0) {
    return { label: '오늘 점검', color: 'var(--warning-fg)', bg: 'var(--warning-bg)' }
  }
  if (row.daysUntilDue <= row.alertDaysBefore) {
    return { label: `D-${row.daysUntilDue}`, color: 'var(--inspect-fg)', bg: 'var(--inspect-bg)' }
  }
  return { label: `D-${row.daysUntilDue}`, color: 'var(--success-fg)', bg: 'var(--success-bg)' }
}

export default function ChecklistClient({ initialRows }: { initialRows: ChecklistRow[] }) {
  const router = useRouter()
  // prop을 그대로 사용 — useState로 캡처하면 router.refresh() 후 새 데이터가 반영되지 않음
  const rows = initialRows
  const [mode, setMode] = useState<Mode>(null)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  // 상단 분류: 점검 필요(due) / 여유 / 비활성
  const due     = rows.filter(r => r.isActive && (r.daysUntilDue == null || r.daysUntilDue <= r.alertDaysBefore))
  const ok      = rows.filter(r => r.isActive && r.daysUntilDue != null && r.daysUntilDue > r.alertDaysBefore)
  const archive = rows.filter(r => !r.isActive)

  const refresh = () => router.refresh()

  // 적용취소 — 로그 삭제가 곧 되돌리기다(ChecklistLog 에 수정 문이 없다).
  // **지운 로그의 시각·메모를 받아 두었다가 되살린다.** 종전에는 되돌렸다 다시 완료하면
  // 오늘이 박혀, 어제로 적어 둔 점검일이 사라졌다(현금영수증 prevIssuedAt 과 같은 처방).
  const undoDone = async (checklistId: string, logId: string) => {
    const r = await deleteChecklistLog(logId)
    if (!r.ok) { pushToast('error', r.error); return }
    const prev = r.prev
    pushToast('info', '점검 완료를 적용취소했습니다', {
      action: { label: '적용취소', run: () => { void markChecklistDone({
        id: checklistId, memo: prev.memo ?? '', restoreCheckedAt: prev.checkedAt,
      }).then(rr => { if (rr.ok) refresh(); else pushToast('error', rr.error) }) } },
    })
    refresh()
  }

  // 카드에서 점검 완료 — **완료일을 먼저 받는다**(운영자 지시 2026-09-17).
  // 매일 누르는 자리라 묻지 말자는 안도 있었지만, 요청 완료·현금영수증과 같은 문법이 되는 쪽을 골랐다.
  // 메모·이력은 종전대로 '이력·메모' 버튼에서 다룬다.
  const handleQuickDone = (row: ChecklistRow, doneDate: string) => {
    startTransition(async () => {
      const res = await withSave(() => markChecklistDone({ id: row.id, memo: '', doneDate }))
      if (!res.ok) return
      const logId = res.logId
      pushToast('success', `점검 완료로 기록했습니다 · 완료일 ${doneDate}`, {
        action: { label: '적용취소', run: () => { void undoDone(row.id, logId) } },
      })
      refresh()
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold" style={{ color: 'var(--warm-dark)' }}>체크리스트</h1>
        <Btn variant="primary" size="md" onClick={() => { setMode('create'); setError('') }}>
          + 항목 추가
        </Btn>
      </div>

      <p className="text-xs leading-relaxed" style={{ color: 'var(--warm-muted)' }}>
        쌀·김치 같은 부식 잔량 확인, 청소 점검, 소모품 체크 등 운영 점검 To-Do입니다. 예정일이 N일 이내(또는 지난) 항목은 대시보드 알림에도 표시됩니다.
      </p>

      {/* 점검 필요 섹션 */}
      <Section title={`점검 필요 ${due.length}건`} hint="예정일 N일 이내 또는 지남">
        {rows.length === 0 ? (
          <EmptyState
            title="아직 체크리스트가 없습니다"
            description="쌀·김치 잔량, 청소, 소모품 같은 반복 점검 항목을 추가해 보세요."
            action={
              <Btn variant="primary" size="sm" onClick={() => { setMode('create'); setError('') }}>
                + 항목 추가
              </Btn>
            }
          />
        ) : due.length === 0 ? (
          <EmptyState title="현재 점검이 필요한 항목이 없습니다" />
        ) : (
          <div className="space-y-2">
            {due.map(r => <Card key={r.id} row={r} isPending={isPending} onQuickDone={d => handleQuickDone(r, d)} onCheck={() => setMode({ mode: 'check', row: r })} onEdit={() => setMode({ mode: 'edit', row: r })} />)}
          </div>
        )}
      </Section>

      {ok.length > 0 && (
        <Section title={`여유 ${ok.length}건`}>
          <div className="space-y-2">
            {ok.map(r => <Card key={r.id} row={r} isPending={isPending} onQuickDone={d => handleQuickDone(r, d)} onCheck={() => setMode({ mode: 'check', row: r })} onEdit={() => setMode({ mode: 'edit', row: r })} />)}
          </div>
        </Section>
      )}

      {archive.length > 0 && (
        <Section title={`비활성 ${archive.length}건`}>
          <div className="space-y-2">
            {archive.map(r => <Card key={r.id} row={r} isPending={isPending} onQuickDone={d => handleQuickDone(r, d)} onCheck={() => setMode({ mode: 'check', row: r })} onEdit={() => setMode({ mode: 'edit', row: r })} muted />)}
          </div>
        </Section>
      )}

      {/* 추가/편집 모달 */}
      {(mode === 'create' || (mode && typeof mode === 'object' && mode.mode === 'edit')) && (
        <FormModal
          row={mode === 'create' ? null : (mode as { mode: 'edit'; row: ChecklistRow }).row}
          error={error}
          isPending={isPending}
          onClose={() => { setMode(null); setError('') }}
          onSubmit={(data) => {
            startTransition(async () => {
              setError('')
              if (mode === 'create') {
                const res = await withSave(() => createChecklist(data), { success: '체크리스트 추가됨' })
                if (!res.ok) { setError(res.error); return }
              } else if (mode && typeof mode === 'object' && mode.mode === 'edit') {
                const res = await withSave(() => updateChecklist({ id: mode.row.id, ...data }), { success: '체크리스트 수정됨' })
                if (!res.ok) { setError(res.error); return }
              }
              setMode(null)
              refresh()
            })
          }}
          onDelete={mode && typeof mode === 'object' && mode.mode === 'edit' ? async () => {
            if (!(await confirmDialog({ title: '이 체크리스트 항목을 삭제할까요?', message: '모든 점검 이력도 함께 삭제됩니다.', level: 'danger', confirmLabel: '삭제' }))) return
            startTransition(async () => {
              const res = await withSave(() => deleteChecklist((mode as { mode: 'edit'; row: ChecklistRow }).row.id), { success: '체크리스트 삭제됨' })
              if (!res.ok) { setError(res.error); return }
              setMode(null)
              refresh()
            })
          } : undefined}
          onToggleActive={mode && typeof mode === 'object' && mode.mode === 'edit' ? () => {
            const row = (mode as { mode: 'edit'; row: ChecklistRow }).row
            startTransition(async () => {
              const res = await withSave(() => updateChecklist({
                id: row.id,
                title: row.title,
                memo: row.memo ?? '',
                intervalDays: row.intervalDays,
                alertDaysBefore: row.alertDaysBefore,
                isActive: !row.isActive,
              }), { success: row.isActive ? '비활성화됨' : '활성화됨' })
              if (!res.ok) { setError(res.error); return }
              setMode(null)
              refresh()
            })
          } : undefined}
        />
      )}

      {/* 점검 처리 모달 */}
      {mode && typeof mode === 'object' && mode.mode === 'check' && (
        <CheckModal
          row={mode.row}
          error={error}
          isPending={isPending}
          onClose={() => { setMode(null); setError('') }}
          onConfirm={(memo, doneDate) => {
            startTransition(async () => {
              setError('')
              const res = await withSave(() => markChecklistDone({ id: mode.row.id, memo, doneDate }), { success: '점검 완료 기록됨' })
              if (!res.ok) { setError(res.error); return }
              setMode(null)
              refresh()
            })
          }}
          onDeleteLog={async (logId) => {
            if (!(await confirmDialog({ title: '이 점검 이력을 삭제할까요?', level: 'danger', confirmLabel: '삭제' }))) return
            startTransition(async () => {
              const res = await withSave(() => deleteChecklistLog(logId), { success: '점검 이력 삭제됨' })
              if (!res.ok) { setError(res.error); return }
              setMode(null)
              refresh()
            })
          }}
        />
      )}
    </div>
  )
}

// ── 섹션 타이틀
function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--warm-mid)' }}>{title}</h2>
        {hint && <span className="text-[0.65625rem]" style={{ color: 'var(--warm-muted)' }}>{hint}</span>}
      </div>
      {children}
    </div>
  )
}


// ── 카드
function Card({ row, isPending, onQuickDone, onCheck, onEdit, muted }: { row: ChecklistRow; isPending: boolean; onQuickDone: (doneDate: string) => void; onCheck: () => void; onEdit: () => void; muted?: boolean }) {
  const chip = dueChip(row)
  // 완료 확인 줄 — 누르면 바로 기록하지 않고 완료일부터 받는다(운영자 지시 2026-09-17).
  // 요청·컴플레인 카드, 수납 내역 행과 같은 인라인 문법이다.
  const [askOpen, setAskOpen] = useState(false)
  const [askDate, setAskDate] = useState(kstYmdStr())
  return (
    <div className={`bg-[var(--cream)] border rounded-xl px-4 py-3 ${muted ? 'opacity-60' : ''}`}
      style={{ borderColor: chip.color === 'var(--danger-fg)' ? 'var(--danger-ring)' : 'var(--warm-border)' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold" style={{ color: 'var(--warm-dark)' }}>{row.title}</span>
            {row.isActive && (
              <span className="text-[0.65625rem] font-medium px-2 py-0.5 rounded-sm"
                style={{ background: chip.bg, color: chip.color }}>
                {chip.label}
              </span>
            )}
          </div>
          {row.memo && (
            <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--warm-muted)' }}>{row.memo}</p>
          )}
          <div className="flex items-center gap-2 text-[0.6875rem] flex-wrap mt-2" style={{ color: 'var(--warm-muted)' }}>
            <span>{intervalLabel(row.intervalDays)}</span>
            <span>·</span>
            <span>마지막 {fmtRelative(row.lastCheckedAt)}</span>
            {row.nextDueAt && (
              <>
                <span>·</span>
                <span>다음 {fmtKorDate(row.nextDueAt)}</span>
              </>
            )}
          </div>
        </div>
      </div>
      {askOpen ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--warm-mid)' }}>
            완료일
            {/* 껍데기는 이 카드의 버튼들과 같은 한 벌이다(rounded-lg px-3 py-2 text-xs) —
                안 넘기면 테두리 없는 맨글자로 그려진다(오류신고 c2ab5b83). */}
            <DatePicker value={askDate} onChange={setAskDate} maxDate={kstYmdStr()}
              className="flex-1 min-w-0 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg px-3 py-2 text-xs text-[var(--warm-dark)]" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setAskOpen(false) }}
              className="px-3 py-2 rounded-lg text-xs font-medium border transition-opacity hover:opacity-70"
              style={{ borderColor: 'var(--warm-border)', color: 'var(--warm-mid)' }}>
              취소
            </button>
            <button onClick={() => { onQuickDone(askDate); setAskOpen(false) }} disabled={isPending}
              className="flex-1 py-2 rounded-lg text-xs font-semibold text-[var(--on-solid)] transition-opacity hover:opacity-80 disabled:opacity-50"
              style={{ background: 'var(--coral)' }}>
              완료 기록
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2 mt-3">
          <button onClick={() => { setAskDate(kstYmdStr()); setAskOpen(true) }} disabled={isPending}
            className="flex-1 py-2 rounded-lg text-xs font-semibold text-[var(--on-solid)] transition-opacity hover:opacity-80 disabled:opacity-50"
            style={{ background: 'var(--coral)' }}>
            점검 완료
          </button>
          <button onClick={onCheck}
            className="px-3 py-2 rounded-lg text-xs font-medium border transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--warm-border)', color: 'var(--warm-mid)' }}>
            이력·메모
          </button>
          <button onClick={onEdit}
            className="px-3 py-2 rounded-lg text-xs font-medium border transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--warm-border)', color: 'var(--warm-mid)' }}>
            편집
          </button>
        </div>
      )}
    </div>
  )
}

// ── 추가/편집 모달
function FormModal({
  row, error, isPending, onClose, onSubmit, onDelete, onToggleActive,
}: {
  row: ChecklistRow | null
  error: string
  isPending: boolean
  onClose: () => void
  onSubmit: (data: { title: string; memo: string; intervalDays: number; alertDaysBefore: number }) => void
  onDelete?: () => void
  onToggleActive?: () => void
}) {
  const [title, setTitle] = useState(row?.title ?? '')
  const [memo, setMemo] = useState(row?.memo ?? '')
  const [intervalDays, setIntervalDays] = useState(row?.intervalDays ?? 7)
  const [alertDaysBefore, setAlertDaysBefore] = useState(row?.alertDaysBefore ?? DEFAULT_CHECKLIST_ALERT_DAYS_BEFORE)
  const [customMode, setCustomMode] = useState(row ? !PRESETS.some(p => p.days === row.intervalDays) : false)

  // v2.0 §12 dirty — 초기값 대비 변경이 있으면 배경클릭 무시 + 닫기 확인
  const dirty =
    title !== (row?.title ?? '') ||
    memo !== (row?.memo ?? '') ||
    intervalDays !== (row?.intervalDays ?? 7) ||
    alertDaysBefore !== (row?.alertDaysBefore ?? DEFAULT_CHECKLIST_ALERT_DAYS_BEFORE)

  return (
    <Modal open onClose={onClose} width="sm" dirty={dirty}
      title={row ? '체크리스트 편집' : '체크리스트 추가'}
      footer={
        <div className="flex gap-2">
          {row && onDelete && (
            <Btn variant="danger" size="sm" onClick={onDelete} disabled={isPending}>
              삭제
            </Btn>
          )}
          <Btn variant="secondary" size="md" className="flex-1" onClick={onClose} disabled={isPending}>
            취소
          </Btn>
          <Btn variant="primary" size="md" className="flex-1"
            onClick={() => onSubmit({ title, memo, intervalDays, alertDaysBefore })}
            disabled={isPending || !title.trim() || intervalDays < 1}>
            {isPending ? '저장 중…' : '저장'}
          </Btn>
        </div>
      }>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--warm-mid)' }}>제목 *</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="예: 부식 잔량 확인"
              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--warm-mid)' }}>메모</label>
            <textarea value={memo} onChange={e => setMemo(e.target.value)} rows={2}
              placeholder="위치, 기준, 비고 등 (선택)"
              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] resize-none" />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--warm-mid)' }}>점검 주기 *</label>
            <div className="flex gap-1.5 flex-wrap">
              {PRESETS.map(p => (
                <button key={p.days} type="button"
                  onClick={() => { setIntervalDays(p.days); setCustomMode(false) }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${intervalDays === p.days && !customMode ? 'bg-[var(--coral)] text-[var(--on-solid)]' : 'bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-mid)]'}`}>
                  {p.label}
                </button>
              ))}
              <button type="button"
                onClick={() => setCustomMode(true)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${customMode ? 'bg-[var(--coral)] text-[var(--on-solid)]' : 'bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-mid)]'}`}>
                직접 입력
              </button>
            </div>
            {customMode && (
              <div className="flex items-center gap-2">
                <input type="number" min={1} value={intervalDays}
                  onFocus={e => e.currentTarget.select()}
                  onChange={e => {
                    const v = e.target.value
                    if (v === '') { setIntervalDays(1); return }
                    const n = Number(v)
                    if (!isNaN(n) && n >= 1) setIntervalDays(n)
                  }}
                  className="w-24 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
                <span className="text-xs" style={{ color: 'var(--warm-muted)' }}>일마다</span>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--warm-mid)' }}>알림 시작 (예정일 N일 전부터)</label>
            <div className="flex items-center gap-2">
              <input type="number" min={0} max={30} value={alertDaysBefore}
                onFocus={e => e.currentTarget.select()}
                onChange={e => {
                  const v = e.target.value
                  if (v === '') { setAlertDaysBefore(0); return }
                  const n = Number(v)
                  if (!isNaN(n) && n >= 0 && n <= 30) setAlertDaysBefore(n)
                }}
                className="w-24 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
              <span className="text-xs" style={{ color: 'var(--warm-muted)' }}>일 전부터 대시보드 알림</span>
            </div>
          </div>

          {row && onToggleActive && (
            <Btn variant="secondary" size="sm" fullWidth onClick={onToggleActive} disabled={isPending}>
              {row.isActive ? '비활성화 (알림 중단)' : '활성화'}
            </Btn>
          )}

          {error && <p className="text-[var(--danger-fg)] text-xs">{error}</p>}
        </div>
    </Modal>
  )
}

// ── 점검 완료 모달
function CheckModal({
  row, error, isPending, onClose, onConfirm, onDeleteLog,
}: {
  row: ChecklistRow
  error: string
  isPending: boolean
  onClose: () => void
  onConfirm: (memo: string, doneDate: string) => void
  onDeleteLog: (logId: string) => void
}) {
  const [memo, setMemo] = useState('')
  // 완료일 — 기본은 오늘이고 지난 날짜로 고칠 수 있다(운영자 지시 2026-09-17).
  // 종전 버튼 라벨이 '오늘 점검 완료'라 오늘 고정을 명시하고 있었다.
  const [doneDate, setDoneDate] = useState(kstYmdStr())
  return (
    <Modal open onClose={onClose} width="sm" dirty={memo.trim() !== '' || doneDate !== kstYmdStr()}
      title={row.title}
      subtitle={`${intervalLabel(row.intervalDays)} · 마지막 ${fmtRelative(row.lastCheckedAt)}`}
      footer={
        <div className="flex gap-2">
          <Btn variant="secondary" size="md" className="flex-1" onClick={onClose} disabled={isPending}>
            닫기
          </Btn>
          <Btn variant="primary" size="md" className="flex-1" onClick={() => onConfirm(memo, doneDate)} disabled={isPending}>
            {isPending ? '처리 중…' : '점검 완료 기록'}
          </Btn>
        </div>
      }>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--warm-mid)' }}>완료일</label>
            {/* 껍데기는 아래 메모칸과 같은 한 벌이다(§12 한 폼 안 입력 높이 혼용 금지). */}
            <DatePicker value={doneDate} onChange={setDoneDate} maxDate={kstYmdStr()}
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--warm-mid)' }}>점검 메모 (선택)</label>
            <textarea value={memo} onChange={e => setMemo(e.target.value)} rows={2}
              placeholder="확인 결과, 보충 필요한 항목 등"
              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] resize-none" />
          </div>

          {row.recentLogs.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium" style={{ color: 'var(--warm-mid)' }}>최근 점검 이력</p>
              <div className="space-y-1.5">
                {row.recentLogs.map(log => (
                  <div key={log.id} className="bg-[var(--canvas)] rounded-lg px-3 py-2 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium" style={{ color: 'var(--warm-dark)' }}>{fmtKorDate(log.checkedAt)}</p>
                      {log.memo && <p className="text-[0.6875rem] truncate" style={{ color: 'var(--warm-muted)' }}>{log.memo}</p>}
                    </div>
                    <button onClick={() => onDeleteLog(log.id)} disabled={isPending}
                      className="text-[0.65625rem] text-[var(--danger-fg)] hover:text-[var(--danger-fg)] px-2 py-1 disabled:opacity-50">
                      삭제
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && <p className="text-[var(--danger-fg)] text-xs">{error}</p>}
        </div>
    </Modal>
  )
}
