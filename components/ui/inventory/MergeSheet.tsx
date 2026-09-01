'use client'

// v2.0 §22 MergeSheet — 합치기 단일 바텀시트. 카드 액션·상세·선택 알약 어디서 열어도 같은 컴포넌트.
// 방향 고지 필수(v2.0 §14 파괴적 확인 정신): 무엇이 사라지고 무엇이 남는지 명시.
// 적용취소는 실행 후 v2.0 §16 undo 토스트 — 환경설정에 숨기지 않음(호출부가 토스트로 처리).
import React, { useEffect, useRef, useState } from 'react'
import { useVisibleBand } from '@/lib/useVisibleBand'

export type MergeTarget = { id: string; label: string; meta?: string }

export function MergeSheet({
  open, onClose, sourceLabel, sourceId, sourceMeta, targets,
  title = '합치기', description, note, confirmLabel = '합치기',
  onConfirm, pending = false, z = 200,
}: {
  open: boolean
  onClose: () => void
  sourceLabel: string          // 사라질(합쳐질) 쪽 — "이 품목" 또는 "선택 N개"
  /** 1대1 진입점에서만 전달 — 주면 방향 바꾸기 버튼이 켜지고 이 쪽도 '남을' 쪽이 될 수 있다. */
  sourceId?: string
  sourceMeta?: string          // 이 쪽 식별 메타 1줄(구매일·구매처·수량·금액)
  targets: MergeTarget[]       // 남을(대표) 후보
  title?: string
  description?: React.ReactNode
  note?: React.ReactNode       // 세트→개수 환산 등 추가 안내(강조 톤)
  confirmLabel?: string
  onConfirm: (destId: string, srcId?: string) => void
  pending?: boolean
  /** 모달 위에서 열 때 260(=--z-modal-2). 기본은 페이지 레벨(--z-modal). */
  z?: 200 | 260
}) {
  const [destId, setDestId] = useState('')
  const [shown, setShown] = useState(false)
  const [flipped, setFlipped] = useState(false)   // 방향 뒤집힘 — 고른 쪽이 사라지고 이 품목이 남는다
  useEffect(() => {
    if (open) { setDestId(''); setFlipped(false); const t = setTimeout(() => setShown(true), 10); return () => clearTimeout(t) }
    setShown(false)
  }, [open])
  // 보이는 띠 정본(useVisibleBand) — 인셋 두 항 + 시트 상한. 키보드 패널 2026-09-02 2단계.
  const overlayRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  useVisibleBand({ active: open, overlayRef, panelRef })
  if (!open) return null
  const dest = targets.find(t => t.id === destId)
  const canFlip = !!sourceId
  // 라벨은 고정(위=사라짐 / 아래=남음), 내용만 자리를 바꾼다
  const gone = flipped && dest ? { label: dest.label, meta: dest.meta } : { label: sourceLabel, meta: sourceMeta }
  const keep = flipped ? { label: sourceLabel, meta: sourceMeta } : { label: dest?.label ?? '', meta: dest?.meta }

  return (
    // 하단 시트라 위·아래 인셋이 시트를 키보드(대상 선택 select 의 iOS 피커) 위 보이는 띠로
    // 밀어 올린다(정본 useVisibleBand, 키보드 패널 2026-09-02 2단계). 딤 배경은 absolute
    // inset-0 이라 패딩과 무관하게 전면을 덮는다.
    <div ref={overlayRef} className={`fixed inset-0 ${z === 260 ? 'z-[var(--z-modal-2)]' : 'z-[var(--z-modal)]'} flex items-end justify-center`}
      style={{ paddingTop: 'var(--vv-top, 0px)', paddingBottom: 'var(--vv-bottom, 0px)' }} role="dialog" aria-modal="true">
      <div className={`absolute inset-0 bg-[rgba(31,26,23,.45)] transition-opacity duration-200 ${shown ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose} />
      <div ref={panelRef} className={`relative flex w-full max-w-md flex-col rounded-t-[20px] bg-[var(--cream)] px-[18px] pb-5 pt-2 shadow-[0_-8px_32px_-12px_rgba(0,0,0,.35)] transition-transform duration-200 ${shown ? 'translate-y-0' : 'translate-y-full'}`}
        // 시트 상한 = 보이는 띠 — 키보드·피커가 서도 제목과 버튼줄이 화면 밖으로 안 나간다.
        style={{ maxHeight: 'calc(var(--vv-h, 100dvh) - 1rem)' }}>
        <div className="mx-auto mb-3 h-1 w-[38px] rounded-full bg-[var(--warm-mid)]/40 shrink-0" />
        {/* 본문만 스크롤 — 버튼줄은 아래 shrink-0 로 항상 보인다 */}
        <div className="min-h-0 overflow-y-auto overscroll-contain">
        <h2 className="text-base font-bold text-[var(--warm-dark)]">{title}</h2>
        {description && <p className="mt-1 text-[0.78125rem] leading-relaxed text-[var(--warm-mid)]">{description}</p>}
        {note && (
          <p className="mt-2 rounded-lg border border-[var(--coral)]/30 bg-[var(--coral-pale)] px-3 py-2 text-[0.75rem] leading-relaxed text-[var(--warm-dark)]">{note}</p>
        )}

        {/* 대상 선택 — 방향을 바꿀 수 있는 진입점에서는 '남을 쪽'을 단정하지 않는다 */}
        <label className="mt-4 block text-xs font-medium text-[var(--warm-mid)]">{canFlip ? '합칠 상대' : '합칠 대상 (남을 품목)'}</label>
        <select value={destId} onChange={e => setDestId(e.target.value)} disabled={pending}
          className="mt-1.5 h-11 w-full rounded-lg border-[1.5px] border-[var(--warm-border)] bg-[var(--canvas)] px-3 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
          <option value="">{canFlip ? '상대 품목 선택…' : '대표(남을 품목) 선택…'}</option>
          {targets.map(t => <option key={t.id} value={t.id}>{t.meta ? `${t.label} · ${t.meta}` : t.label}</option>)}
        </select>

        {/* 방향 고지 — 세로 2행(위 사라짐 / 아래 남음). 같은 이름 다른 규격을 메타로 구분한다(신고 9a9ed836). */}
        {dest && (
          <div className="mt-3 rounded-xl border border-[var(--warm-border)] bg-[var(--canvas)] p-2">
            <div className="rounded-lg px-2.5 py-2 transition-colors duration-[var(--dur-base)]">
              <p className="text-[0.65625rem] text-[var(--warm-muted)]">합쳐질(사라짐)</p>
              <p className="text-[0.8125rem] font-semibold leading-snug text-[var(--warm-dark)]">{gone.label}</p>
              {gone.meta && <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-[var(--warm-muted)]">{gone.meta}</p>}
            </div>
            <div className="flex items-center justify-center">
              {canFlip ? (
                <button type="button" onClick={() => setFlipped(f => !f)} disabled={pending}
                  aria-label="합쳐질 품목과 남을 품목 방향 바꾸기"
                  className="inline-flex h-11 min-w-[44px] items-center justify-center gap-1.5 rounded-lg px-2.5 text-[var(--warm-mid)] transition-colors duration-[var(--dur-base)] hover:bg-[var(--cream-2)] hover:text-[var(--coral)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tc)]/30 focus-visible:ring-offset-2 disabled:opacity-50">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M12 5v14M6 13l6 6 6-6" />
                  </svg>
                  <span className="text-[10.5px] leading-none">방향 바꾸기</span>
                </button>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--coral)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="my-1" aria-hidden>
                  <path d="M12 5v14M6 13l6 6 6-6" />
                </svg>
              )}
            </div>
            <div className="rounded-lg bg-[var(--coral-pale)] px-2.5 py-2 transition-colors duration-[var(--dur-base)]">
              <p className="text-[0.65625rem] text-[var(--coral)]">남을(대표)</p>
              <p className="text-[0.8125rem] font-semibold leading-snug text-[var(--warm-dark)]">{keep.label}</p>
              {keep.meta && <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-[var(--warm-mid)]">{keep.meta}</p>}
            </div>
          </div>
        )}

        </div>

        <div className="mt-4 flex gap-2 shrink-0">
          <button type="button" onClick={onClose} disabled={pending}
            className="h-[46px] flex-1 rounded-lg border border-[var(--warm-border)] bg-[var(--canvas)] text-sm font-semibold text-[var(--warm-dark)] transition-colors hover:bg-[var(--cream-2)] disabled:opacity-50">취소</button>
          <button type="button" onClick={() => { if (!dest) return; if (flipped && sourceId) onConfirm(sourceId, dest.id); else onConfirm(dest.id) }} disabled={pending || !dest}
            className="h-[46px] flex-[1.6] rounded-lg bg-[var(--coral)] text-sm font-semibold text-[var(--on-solid)] transition-colors hover:bg-[var(--coral-dark)] disabled:opacity-50">
            {pending ? '합치는 중…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
