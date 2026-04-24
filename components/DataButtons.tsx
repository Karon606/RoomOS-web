'use client'

import { useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import type { Conflict, PreviewResult } from '@/lib/import-types'

type SheetResult = { imported: number; skipped: number; errors: string[] }
type Resolution = 'overwrite' | 'keep' | 'archive'
type ResolutionMap = Record<string, Resolution>

type Step =
  | { type: 'idle' }
  | { type: 'previewing' }
  | { type: 'conflict'; preview: PreviewResult; file: File }
  | { type: 'applying' }
  | { type: 'done'; results: Record<string, SheetResult> }

const SHEET_LABELS: Record<string, string> = {
  rooms: '호실관리', tenants: '입주자관리', expenses: '지출', incomes: '기타수익', settings: '설정',
}

const WINDOW_LABEL: Record<string, string> = { OUTER: '외창', INNER: '내창' }
const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  BANK_ACCOUNT: '은행계좌', CREDIT_CARD: '신용카드', CHECK_CARD: '체크카드', OTHER: '기타',
}

function fmtMoney(n: number) {
  return n.toLocaleString('ko-KR') + '원'
}

// ── 충돌 항목 1개 ────────────────────────────────────────────────

function ConflictRow({
  conflict,
  resolution,
  onChange,
}: {
  conflict: Conflict
  resolution: Resolution
  onChange: (id: string, r: Resolution) => void
}) {
  const isTenant = conflict.sheet === 'tenants'
  const isExpenseOrIncome = conflict.sheet === 'expenses' || conflict.sheet === 'incomes'
  const isSetting = conflict.sheet === 'settings'

  const desc = (() => {
    if (conflict.sheet === 'rooms') {
      const e = conflict.existing, i = conflict.incoming
      return (
        <div className="text-xs text-[var(--warm-muted)] space-y-0.5">
          <p>기존: {e.type ?? '—'} / {fmtMoney(e.baseRent)} / {e.windowType ? (WINDOW_LABEL[e.windowType] ?? e.windowType) : '—'}</p>
          <p>새값: {i.type ?? '—'} / {fmtMoney(i.baseRent)} / {i.windowType ? (WINDOW_LABEL[i.windowType] ?? i.windowType) : '—'}</p>
        </div>
      )
    }
    if (conflict.sheet === 'tenants') {
      return (
        <div className="text-xs text-[var(--warm-muted)] space-y-0.5">
          <p>기존 호실: {conflict.existingRoom ?? '없음'} ({conflict.existingStatus ?? '—'})</p>
          <p>새 호실: {conflict.incomingRoom ?? '없음'}</p>
          {conflict.sameRoom && <p className="text-amber-400">같은 호실 — 기존 입주자 퇴실 처리 필요</p>}
        </div>
      )
    }
    if (isExpenseOrIncome) {
      return (
        <p className="text-xs text-[var(--warm-muted)]">
          {conflict.date} · {conflict.category} · {fmtMoney(conflict.amount)}
          {conflict.detail ? ` · ${conflict.detail}` : ''}
        </p>
      )
    }
    if (conflict.sheet === 'settings') {
      const e = conflict.existing, i = conflict.incoming
      return (
        <div className="text-xs text-[var(--warm-muted)] space-y-0.5">
          <p>기존: {ACCOUNT_TYPE_LABEL[e.type] ?? e.type} / {e.identifier ?? '—'} / {e.owner ?? '—'}</p>
          <p>새값: {ACCOUNT_TYPE_LABEL[i.type] ?? i.type} / {i.identifier ?? '—'} / {i.owner ?? '—'}</p>
        </div>
      )
    }
    return null
  })()

  const label = (() => {
    if (conflict.sheet === 'rooms') return `${conflict.roomNo}호`
    if (conflict.sheet === 'tenants') return conflict.name
    if (conflict.sheet === 'settings') return conflict.alias ? `${conflict.brand} (${conflict.alias})` : conflict.brand
    return `${conflict.date} ${conflict.category}`
  })()

  return (
    <div className="bg-[var(--canvas)] rounded-xl p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1 flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--warm-dark)]">{label}</p>
          {desc}
        </div>
        <div className="flex gap-1.5 shrink-0 flex-wrap justify-end">
          {isExpenseOrIncome || isSetting ? (
            <>
              <ResBtn active={resolution === 'keep'} onClick={() => onChange(conflict.id, 'keep')} label="기존 유지" />
              <ResBtn active={resolution === 'overwrite'} onClick={() => onChange(conflict.id, 'overwrite')} label="새값으로" color="coral" />
            </>
          ) : isTenant ? (
            <>
              <ResBtn active={resolution === 'keep'} onClick={() => onChange(conflict.id, 'keep')} label="유지" />
              <ResBtn active={resolution === 'overwrite'} onClick={() => onChange(conflict.id, 'overwrite')} label="덮어쓰기" color="coral" />
              <ResBtn active={resolution === 'archive'} onClick={() => onChange(conflict.id, 'archive')} label="퇴실→신규" color="amber" />
            </>
          ) : (
            <>
              <ResBtn active={resolution === 'keep'} onClick={() => onChange(conflict.id, 'keep')} label="유지" />
              <ResBtn active={resolution === 'overwrite'} onClick={() => onChange(conflict.id, 'overwrite')} label="덮어쓰기" color="coral" />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ResBtn({ active, onClick, label, color = 'default' }: {
  active: boolean; onClick: () => void; label: string; color?: 'default' | 'coral' | 'amber'
}) {
  const baseStyle = 'text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors border'
  const activeStyle =
    color === 'coral' ? 'bg-[var(--coral)] border-[var(--coral)] text-[var(--warm-dark)]' :
    color === 'amber' ? 'bg-amber-500 border-amber-500 text-white' :
    'bg-[var(--warm-dark)] border-[var(--warm-dark)] text-[var(--canvas)]'
  const inactiveStyle = 'bg-transparent border-[var(--warm-border)] text-[var(--warm-muted)] hover:text-[var(--warm-dark)]'
  return (
    <button type="button" onClick={onClick} className={`${baseStyle} ${active ? activeStyle : inactiveStyle}`}>
      {label}
    </button>
  )
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────

export default function DataButtons() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const month = searchParams.get('month') ??
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`

  const fileRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>({ type: 'idle' })
  const [resolutions, setResolutions] = useState<ResolutionMap>({})

  const [showExportModal, setShowExportModal] = useState(false)
  const [exportScope, setExportScope] = useState<'month' | 'year' | 'all'>('month')

  const handleExportClick = () => { setExportScope('month'); setShowExportModal(true) }
  const doExport = () => {
    window.location.href = `/api/export?month=${month}&scope=${exportScope}`
    setShowExportModal(false)
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setStep({ type: 'previewing' })
    setResolutions({})

    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/import/preview', { method: 'POST', body: fd })
      const preview: PreviewResult = await res.json()

      const defaults: ResolutionMap = {}
      for (const c of preview.conflicts) {
        defaults[c.id] = 'keep'
      }
      setResolutions(defaults)

      if (preview.conflicts.length === 0 && !preview.hasPaymentSheet) {
        await applyImport(file, {})
      } else {
        setStep({ type: 'conflict', preview, file })
      }
    } catch {
      setStep({ type: 'done', results: { '오류': { imported: 0, skipped: 0, errors: ['파일 처리 중 오류가 발생했습니다.'] } } })
    }
  }

  const applyImport = async (file: File, res: ResolutionMap) => {
    setStep({ type: 'applying' })
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('resolutions', JSON.stringify(res))
      const r = await fetch('/api/import', { method: 'POST', body: fd })
      const data = await r.json()
      setStep({ type: 'done', results: data })
      router.refresh()
    } catch {
      setStep({ type: 'done', results: { '오류': { imported: 0, skipped: 0, errors: ['가져오기 중 오류가 발생했습니다.'] } } })
    }
  }

  const setResolution = (id: string, r: Resolution) => {
    setResolutions(prev => ({ ...prev, [id]: r }))
  }

  const setBulk = (sheet: Conflict['sheet'], r: Resolution) => {
    if (step.type !== 'conflict') return
    const ids = step.preview.conflicts.filter(c => c.sheet === sheet).map(c => c.id)
    setResolutions(prev => {
      const next = { ...prev }
      for (const id of ids) next[id] = r
      return next
    })
  }

  const close = () => setStep({ type: 'idle' })

  const isLoading = step.type === 'previewing' || step.type === 'applying'

  // ── 충돌 해결 모달 ────────────────────────────────────────────

  const ConflictModal = () => {
    if (step.type !== 'conflict') return null
    const { preview, file } = step
    const conflictsBySheet = (['rooms', 'tenants', 'expenses', 'incomes', 'settings'] as const).map(sheet => ({
      sheet,
      label: SHEET_LABELS[sheet],
      items: preview.conflicts.filter(c => c.sheet === sheet),
    })).filter(g => g.items.length > 0)

    const c = preview.counts
    const summaryParts: string[] = []
    if (c.rooms.new)      summaryParts.push(`호실 ${c.rooms.new}개 신규`)
    if (c.rooms.conflict) summaryParts.push(`호실 ${c.rooms.conflict}개 변경`)
    if (c.tenants.new)      summaryParts.push(`입주자 ${c.tenants.new}명 신규`)
    if (c.tenants.conflict) summaryParts.push(`입주자 ${c.tenants.conflict}명 변경`)
    if (c.expenses.new)        summaryParts.push(`지출 ${c.expenses.new}건 신규`)
    if (c.expenses.conflict)   summaryParts.push(`지출 ${c.expenses.conflict}건 충돌`)
    if (c.expenses.autoSkipped) summaryParts.push(`지출 ${c.expenses.autoSkipped}건 자동건너뜀`)
    if (c.incomes.new)        summaryParts.push(`수익 ${c.incomes.new}건 신규`)
    if (c.incomes.conflict)   summaryParts.push(`수익 ${c.incomes.conflict}건 충돌`)
    if (c.incomes.autoSkipped) summaryParts.push(`수익 ${c.incomes.autoSkipped}건 자동건너뜀`)
    if (c.settings.new)      summaryParts.push(`계좌 ${c.settings.new}개 신규`)
    if (c.settings.conflict) summaryParts.push(`계좌 ${c.settings.conflict}개 변경`)
    if (c.requests?.new)        summaryParts.push(`요청사항 ${c.requests.new}건 신규`)
    if (c.requests?.autoSkipped) summaryParts.push(`요청사항 ${c.requests.autoSkipped}건 자동건너뜀`)
    if (c.requests?.noTenant)   summaryParts.push(`요청사항 ${c.requests.noTenant}건 입주자 미매칭`)

    const hasConflicts = preview.conflicts.length > 0

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}
        onClick={close}>
        <div className="w-full max-w-lg bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl flex flex-col max-h-[88vh]"
          onClick={e => e.stopPropagation()}>

          {/* 헤더 */}
          <div className="flex items-start justify-between px-6 py-4 border-b border-[var(--warm-border)] shrink-0">
            <div>
              <h3 className="font-semibold text-[var(--warm-dark)]">
                {hasConflicts ? '중복 데이터 발견' : '가져오기 확인'}
              </h3>
              {summaryParts.length > 0 && (
                <p className="text-xs text-[var(--warm-muted)] mt-0.5">{summaryParts.join(' · ')}</p>
              )}
              {hasConflicts && (
                <p className="text-xs text-[var(--warm-muted)] mt-0.5">충돌 {preview.conflicts.length}건 — 각 항목의 처리 방법을 선택하세요</p>
              )}
            </div>
            <button onClick={close} className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-xl leading-none ml-4">✕</button>
          </div>

          {/* 내보내기 전용 시트 안내 */}
          {preview.hasPaymentSheet && (
            <div className="mx-6 mt-4 px-4 py-3 rounded-xl text-xs text-amber-700 bg-amber-50 border border-amber-200">
              <span className="font-semibold">수납현황</span> 시트는 내보내기 전용입니다. 가져오기 시 무시됩니다.
            </div>
          )}

          {/* 충돌 목록 */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
            {conflictsBySheet.length === 0 && !preview.hasPaymentSheet && (
              <p className="text-sm text-[var(--warm-muted)] text-center py-4">충돌 없음 — 모든 데이터를 가져올 수 있습니다.</p>
            )}
            {conflictsBySheet.length === 0 && preview.hasPaymentSheet && (
              <p className="text-sm text-[var(--warm-muted)] text-center py-4">충돌이 없습니다. 아래 버튼으로 가져오기를 진행하세요.</p>
            )}
            {conflictsBySheet.map(({ sheet, label, items }) => (
              <div key={sheet} className="space-y-2">
                {/* 시트 헤더 + 일괄 버튼 */}
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-[var(--warm-mid)]">{label} ({items.length}건)</p>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => setBulk(sheet, 'keep')}
                      className="text-xs px-2 py-1 rounded-lg border border-[var(--warm-border)] text-[var(--warm-muted)] hover:text-[var(--warm-dark)] transition-colors">
                      전체 유지
                    </button>
                    <button type="button" onClick={() => setBulk(sheet, 'overwrite')}
                      className="text-xs px-2 py-1 rounded-lg border border-[var(--warm-border)] text-[var(--warm-muted)] hover:text-[var(--coral)] transition-colors">
                      전체 덮어쓰기
                    </button>
                    {sheet === 'tenants' && (
                      <button type="button" onClick={() => setBulk(sheet, 'archive')}
                        className="text-xs px-2 py-1 rounded-lg border border-[var(--warm-border)] text-[var(--warm-muted)] hover:text-amber-400 transition-colors">
                        전체 퇴실→신규
                      </button>
                    )}
                  </div>
                </div>
                {/* 개별 충돌 항목 */}
                <div className="space-y-2">
                  {items.map(c => (
                    <ConflictRow key={c.id} conflict={c} resolution={resolutions[c.id] ?? 'keep'} onChange={setResolution} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* 푸터 */}
          <div className="border-t border-[var(--warm-border)] px-6 py-4 flex gap-2 shrink-0">
            <button onClick={close}
              className="flex-1 py-2.5 bg-[var(--canvas)] text-[var(--warm-dark)] text-sm rounded-xl transition-colors">
              취소
            </button>
            <button onClick={() => applyImport(file, resolutions)}
              className="flex-1 py-2.5 bg-[var(--coral)] text-white text-sm font-medium rounded-xl transition-colors">
              가져오기 적용
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── 결과 모달 ─────────────────────────────────────────────────

  const ResultModal = () => {
    if (step.type !== 'done') return null
    const results = step.results
    const totalImported = Object.values(results).reduce((s, r) => s + r.imported, 0)
    const allErrors = Object.entries(results).flatMap(([sheet, r]) => r.errors.map(e => `[${sheet}] ${e}`))

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }}
        onClick={close}>
        <div className="w-full max-w-sm bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-6 space-y-4"
          onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm text-[var(--warm-dark)]">가져오기 완료</h3>
            <button onClick={close} className="text-[var(--warm-muted)]">✕</button>
          </div>
          <div className="space-y-2">
            {Object.entries(results).map(([sheet, r]) => (
              <div key={sheet} className="flex items-center justify-between text-sm">
                <span className="text-[var(--warm-mid)]">{sheet}</span>
                <span style={{ color: r.imported > 0 ? 'var(--coral)' : 'var(--warm-muted)' }}>
                  {r.imported}건 처리 {r.skipped > 0 ? `· ${r.skipped}건 건너뜀` : ''}
                </span>
              </div>
            ))}
          </div>
          <div className="pt-2 border-t border-[var(--warm-border)]">
            <p className="text-sm font-semibold text-[var(--warm-dark)]">총 {totalImported}건 처리됨</p>
          </div>
          {allErrors.length > 0 && (
            <div className="rounded-xl p-3 space-y-1" style={{ background: 'rgba(239,68,68,0.06)' }}>
              <p className="text-xs font-medium text-red-500">오류 {allErrors.length}건</p>
              {allErrors.slice(0, 5).map((e, i) => <p key={i} className="text-xs text-red-400">{e}</p>)}
              {allErrors.length > 5 && <p className="text-xs text-red-400">외 {allErrors.length - 5}건...</p>}
            </div>
          )}
          <button onClick={close} className="w-full py-2.5 rounded-xl text-sm font-medium"
            style={{ background: 'var(--coral)', color: '#fff' }}>
            확인
          </button>
        </div>
      </div>
    )
  }

  // ── 렌더 ─────────────────────────────────────────────────────

  return (
    <>
      <div className="flex items-center gap-2">
        <button onClick={handleExportClick}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors"
          style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)', color: 'var(--warm-mid)' }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M7 1v8M4 6l3 3 3-3M2 11h10"/>
          </svg>
          내보내기
        </button>
        <button onClick={() => fileRef.current?.click()} disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
          style={{ background: 'var(--coral)', color: '#fff' }}>
          {isLoading ? (
            <>
              <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              {step.type === 'previewing' ? '분석 중...' : '가져오는 중...'}
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M7 9V1M4 4l3-3 3 3M2 11h10"/>
              </svg>
              가져오기
            </>
          )}
        </button>
        <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={handleFileSelect} />
      </div>

      {/* ── 내보내기 범위 선택 모달 ── */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4"
          onClick={() => setShowExportModal(false)}>
          <div className="bg-[var(--cream)] rounded-2xl shadow-2xl w-full max-w-sm"
            onClick={e => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-4">
              <h3 className="text-base font-bold mb-1" style={{ color: 'var(--warm-dark)' }}>내보내기 범위</h3>
              <p className="text-xs mb-4" style={{ color: 'var(--warm-muted)' }}>
                {month.slice(0, 4)}년 {parseInt(month.slice(5))}월 기준
              </p>
              <div className="space-y-2">
                {([
                  { value: 'month', label: '해당 월',   desc: `${month.slice(0, 4)}년 ${parseInt(month.slice(5))}월 데이터` },
                  { value: 'year',  label: '해당 연도', desc: `${month.slice(0, 4)}년 전체 데이터` },
                  { value: 'all',   label: '전체 기간', desc: '모든 기간의 데이터' },
                ] as const).map(opt => (
                  <button key={opt.value} onClick={() => setExportScope(opt.value)}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors"
                    style={{
                      background: exportScope === opt.value ? 'rgba(244,98,58,0.08)' : 'var(--canvas)',
                      border: `1.5px solid ${exportScope === opt.value ? 'var(--coral)' : 'var(--warm-border)'}`,
                    }}>
                    <div className="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0"
                      style={{ borderColor: exportScope === opt.value ? 'var(--coral)' : 'var(--warm-border)' }}>
                      {exportScope === opt.value && (
                        <div className="w-2 h-2 rounded-full" style={{ background: 'var(--coral)' }} />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-medium" style={{ color: 'var(--warm-dark)' }}>{opt.label}</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--warm-muted)' }}>{opt.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2 px-6 pb-6">
              <button onClick={() => setShowExportModal(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium"
                style={{ background: 'var(--canvas)', color: 'var(--warm-mid)' }}>
                취소
              </button>
              <button onClick={doExport}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white"
                style={{ background: 'var(--coral)' }}>
                내보내기
              </button>
            </div>
          </div>
        </div>
      )}

      <ConflictModal />
      <ResultModal />
    </>
  )
}
