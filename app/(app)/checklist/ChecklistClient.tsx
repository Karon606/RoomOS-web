'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  type ChecklistRow,
  createChecklist,
  updateChecklist,
  deleteChecklist,
  markChecklistDone,
  deleteChecklistLog,
} from './actions'

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
    return { label: '점검 필요', color: '#dc2626', bg: 'rgba(220,38,38,0.1)' }
  }
  if (row.daysUntilDue < 0) {
    return { label: `${Math.abs(row.daysUntilDue)}일 경과`, color: '#dc2626', bg: 'rgba(220,38,38,0.1)' }
  }
  if (row.daysUntilDue === 0) {
    return { label: '오늘 점검', color: '#ea580c', bg: 'rgba(234,88,12,0.12)' }
  }
  if (row.daysUntilDue <= row.alertDaysBefore) {
    return { label: `D-${row.daysUntilDue}`, color: '#d4a847', bg: 'rgba(212,168,71,0.18)' }
  }
  return { label: `D-${row.daysUntilDue}`, color: '#16a34a', bg: 'rgba(34,197,94,0.12)' }
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold" style={{ color: 'var(--warm-dark)' }}>체크리스트</h1>
        <button
          onClick={() => { setMode('create'); setError('') }}
          className="px-4 py-2 bg-[var(--coral)] hover:opacity-90 text-white text-sm font-medium rounded-xl transition-colors">
          + 항목 추가
        </button>
      </div>

      <p className="text-xs leading-relaxed" style={{ color: 'var(--warm-muted)' }}>
        부식 잔량 확인, 청소 점검, 소모품 체크 등 운영 점검 To-Do입니다. 도래일 N일 이내(또는 경과)는 대시보드 알림에도 표시됩니다.
      </p>

      {/* 점검 필요 섹션 */}
      <Section title={`점검 필요 ${due.length}건`} hint="도래일 N일 이내 또는 경과">
        {due.length === 0 ? (
          <EmptyHint label="현재 점검이 필요한 항목이 없습니다." />
        ) : (
          <div className="space-y-2">
            {due.map(r => <Card key={r.id} row={r} onCheck={() => setMode({ mode: 'check', row: r })} onEdit={() => setMode({ mode: 'edit', row: r })} />)}
          </div>
        )}
      </Section>

      {ok.length > 0 && (
        <Section title={`여유 ${ok.length}건`}>
          <div className="space-y-2">
            {ok.map(r => <Card key={r.id} row={r} onCheck={() => setMode({ mode: 'check', row: r })} onEdit={() => setMode({ mode: 'edit', row: r })} />)}
          </div>
        </Section>
      )}

      {archive.length > 0 && (
        <Section title={`비활성 ${archive.length}건`}>
          <div className="space-y-2">
            {archive.map(r => <Card key={r.id} row={r} onCheck={() => setMode({ mode: 'check', row: r })} onEdit={() => setMode({ mode: 'edit', row: r })} muted />)}
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
                const res = await createChecklist(data)
                if (!res.ok) { setError(res.error); return }
              } else if (mode && typeof mode === 'object' && mode.mode === 'edit') {
                const res = await updateChecklist({ id: mode.row.id, ...data })
                if (!res.ok) { setError(res.error); return }
              }
              setMode(null)
              refresh()
            })
          }}
          onDelete={mode && typeof mode === 'object' && mode.mode === 'edit' ? () => {
            if (!confirm('이 체크리스트 항목과 모든 점검 이력을 삭제하시겠습니까?')) return
            startTransition(async () => {
              const res = await deleteChecklist((mode as { mode: 'edit'; row: ChecklistRow }).row.id)
              if (!res.ok) { setError(res.error); return }
              setMode(null)
              refresh()
            })
          } : undefined}
          onToggleActive={mode && typeof mode === 'object' && mode.mode === 'edit' ? () => {
            const row = (mode as { mode: 'edit'; row: ChecklistRow }).row
            startTransition(async () => {
              const res = await updateChecklist({
                id: row.id,
                title: row.title,
                memo: row.memo ?? '',
                intervalDays: row.intervalDays,
                alertDaysBefore: row.alertDaysBefore,
                isActive: !row.isActive,
              })
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
          onConfirm={(memo) => {
            startTransition(async () => {
              setError('')
              const res = await markChecklistDone({ id: mode.row.id, memo })
              if (!res.ok) { setError(res.error); return }
              setMode(null)
              refresh()
            })
          }}
          onDeleteLog={(logId) => {
            if (!confirm('이 점검 이력을 삭제하시겠습니까?')) return
            startTransition(async () => {
              const res = await deleteChecklistLog(logId)
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
        {hint && <span className="text-[10px]" style={{ color: 'var(--warm-muted)' }}>{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function EmptyHint({ label }: { label: string }) {
  return (
    <div className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-4 py-6 text-center text-xs" style={{ color: 'var(--warm-muted)' }}>
      {label}
    </div>
  )
}

// ── 카드
function Card({ row, onCheck, onEdit, muted }: { row: ChecklistRow; onCheck: () => void; onEdit: () => void; muted?: boolean }) {
  const chip = dueChip(row)
  return (
    <div className={`bg-[var(--cream)] border rounded-xl px-4 py-3 ${muted ? 'opacity-60' : ''}`}
      style={{ borderColor: chip.color === '#dc2626' ? '#fecaca' : 'var(--warm-border)' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold" style={{ color: 'var(--warm-dark)' }}>{row.title}</span>
            {row.isActive && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                style={{ background: chip.bg, color: chip.color }}>
                {chip.label}
              </span>
            )}
          </div>
          {row.memo && (
            <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--warm-muted)' }}>{row.memo}</p>
          )}
          <div className="flex items-center gap-2 text-[11px] flex-wrap mt-2" style={{ color: 'var(--warm-muted)' }}>
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
      <div className="flex gap-2 mt-3">
        <button onClick={onCheck}
          className="flex-1 py-2 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-80"
          style={{ background: 'var(--coral)' }}>
          점검 완료 기록
        </button>
        <button onClick={onEdit}
          className="px-3 py-2 rounded-lg text-xs font-medium border transition-opacity hover:opacity-70"
          style={{ borderColor: 'var(--warm-border)', color: 'var(--warm-mid)' }}>
          편집
        </button>
      </div>
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
  const [alertDaysBefore, setAlertDaysBefore] = useState(row?.alertDaysBefore ?? 3)
  const [customMode, setCustomMode] = useState(row ? !PRESETS.some(p => p.days === row.intervalDays) : false)

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[var(--warm-border)] flex items-center justify-between">
          <p className="text-base font-bold" style={{ color: 'var(--warm-dark)' }}>{row ? '체크리스트 편집' : '체크리스트 추가'}</p>
          <button onClick={onClose} aria-label="닫기" className="w-9 h-9 flex items-center justify-center rounded-lg text-[var(--warm-muted)] hover:text-[var(--warm-dark)] hover:bg-[var(--canvas)] text-xl leading-none">✕</button>
        </div>

        <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--warm-mid)' }}>제목 *</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="예: 부식 잔량 확인"
              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--warm-mid)' }}>메모</label>
            <textarea value={memo} onChange={e => setMemo(e.target.value)} rows={2}
              placeholder="위치, 기준, 비고 등 (선택)"
              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] resize-none" />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--warm-mid)' }}>점검 주기 *</label>
            <div className="flex gap-1.5 flex-wrap">
              {PRESETS.map(p => (
                <button key={p.days} type="button"
                  onClick={() => { setIntervalDays(p.days); setCustomMode(false) }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${intervalDays === p.days && !customMode ? 'bg-[var(--coral)] text-white' : 'bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-mid)]'}`}>
                  {p.label}
                </button>
              ))}
              <button type="button"
                onClick={() => setCustomMode(true)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${customMode ? 'bg-[var(--coral)] text-white' : 'bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-mid)]'}`}>
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
                  className="w-24 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
                <span className="text-xs" style={{ color: 'var(--warm-muted)' }}>일마다</span>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--warm-mid)' }}>알림 시작 (도래일 N일 전부터)</label>
            <div className="flex items-center gap-2">
              <input type="number" min={0} max={30} value={alertDaysBefore}
                onFocus={e => e.currentTarget.select()}
                onChange={e => {
                  const v = e.target.value
                  if (v === '') { setAlertDaysBefore(0); return }
                  const n = Number(v)
                  if (!isNaN(n) && n >= 0 && n <= 30) setAlertDaysBefore(n)
                }}
                className="w-24 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
              <span className="text-xs" style={{ color: 'var(--warm-muted)' }}>일 전부터 대시보드 알림</span>
            </div>
          </div>

          {row && onToggleActive && (
            <button type="button" onClick={onToggleActive} disabled={isPending}
              className="w-full py-2 rounded-lg text-xs font-medium border transition-opacity hover:opacity-70 disabled:opacity-50"
              style={{ borderColor: 'var(--warm-border)', color: 'var(--warm-mid)' }}>
              {row.isActive ? '비활성화 (알림 중단)' : '활성화'}
            </button>
          )}

          {error && <p className="text-red-500 text-xs">{error}</p>}
        </div>

        <div className="px-5 py-4 border-t border-[var(--warm-border)] flex gap-2">
          {row && onDelete && (
            <button type="button" onClick={onDelete} disabled={isPending}
              className="px-3 py-2.5 rounded-xl text-xs font-medium border border-red-200 text-red-500 transition-opacity hover:opacity-70 disabled:opacity-50">
              삭제
            </button>
          )}
          <button type="button" onClick={onClose} disabled={isPending}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium border transition-opacity hover:opacity-70 disabled:opacity-50"
            style={{ borderColor: 'var(--warm-border)', color: 'var(--warm-mid)' }}>
            취소
          </button>
          <button type="button"
            onClick={() => onSubmit({ title, memo, intervalDays, alertDaysBefore })}
            disabled={isPending || !title.trim() || intervalDays < 1}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80 disabled:opacity-50"
            style={{ background: 'var(--coral)' }}>
            {isPending ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
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
  onConfirm: (memo: string) => void
  onDeleteLog: (logId: string) => void
}) {
  const [memo, setMemo] = useState('')
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[var(--warm-border)] flex items-center justify-between">
          <div>
            <p className="text-base font-bold" style={{ color: 'var(--warm-dark)' }}>{row.title}</p>
            <p className="text-xs mt-1" style={{ color: 'var(--warm-muted)' }}>{intervalLabel(row.intervalDays)} · 마지막 {fmtRelative(row.lastCheckedAt)}</p>
          </div>
          <button onClick={onClose} aria-label="닫기" className="w-9 h-9 flex items-center justify-center rounded-lg text-[var(--warm-muted)] hover:text-[var(--warm-dark)] hover:bg-[var(--canvas)] text-xl leading-none">✕</button>
        </div>

        <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--warm-mid)' }}>점검 메모 (선택)</label>
            <textarea value={memo} onChange={e => setMemo(e.target.value)} rows={2}
              placeholder="확인 결과, 보충 필요한 항목 등"
              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] resize-none" />
          </div>

          {row.recentLogs.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium" style={{ color: 'var(--warm-mid)' }}>최근 점검 이력</p>
              <div className="space-y-1.5">
                {row.recentLogs.map(log => (
                  <div key={log.id} className="bg-[var(--canvas)] rounded-lg px-3 py-2 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium" style={{ color: 'var(--warm-dark)' }}>{fmtKorDate(log.checkedAt)}</p>
                      {log.memo && <p className="text-[11px] truncate" style={{ color: 'var(--warm-muted)' }}>{log.memo}</p>}
                    </div>
                    <button onClick={() => onDeleteLog(log.id)} disabled={isPending}
                      className="text-[10px] text-red-500 hover:text-red-600 px-2 py-1 disabled:opacity-50">
                      삭제
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && <p className="text-red-500 text-xs">{error}</p>}
        </div>

        <div className="px-5 py-4 border-t border-[var(--warm-border)] flex gap-2">
          <button type="button" onClick={onClose} disabled={isPending}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium border transition-opacity hover:opacity-70 disabled:opacity-50"
            style={{ borderColor: 'var(--warm-border)', color: 'var(--warm-mid)' }}>
            닫기
          </button>
          <button type="button" onClick={() => onConfirm(memo)} disabled={isPending}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80 disabled:opacity-50"
            style={{ background: 'var(--coral)' }}>
            {isPending ? '처리 중...' : '오늘 점검 완료'}
          </button>
        </div>
      </div>
    </div>
  )
}
