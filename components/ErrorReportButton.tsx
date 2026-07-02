'use client'

// 전역 '오류신고' 플로팅 버튼 — 오류 발생 즉시 눌러 직전 동작 자취 + 메모를 신고.
// 위치 이동: 꾹 누른 뒤(롱프레스) 끌면 원하는 곳으로 옮길 수 있고, 그 위치가 저장됨(모바일서 다른 UI 가림 방지).
// 짧게 탭 = 신고창 열기. (탭/이동 구분: 350ms 이상 누르면 이동 모드)
import { useState, useRef, useEffect } from 'react'
import { submitErrorReport } from '@/app/(app)/errorReports'
import { getCrumbs, lastError } from '@/lib/errorBreadcrumbs'
import { Modal } from '@/components/ui/Modal'
import { Btn } from '@/components/ui/Btn'
import { pushToast } from '@/lib/saveStatus'

const STORAGE_KEY = 'errorReportBtnPos'
const BTN_SIZE = 48          // w-12 h-12
const EDGE = 8               // 화면 가장자리 최소 여백
const LONG_PRESS_MS = 350    // 이 시간 이상 누르면 '이동 모드'
const MOVE_CANCEL = 8        // 이동 모드 진입 전 이만큼 움직이면(스크롤 등) 취소

export default function ErrorReportButton() {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [snapshot, setSnapshot] = useState<{ url: string; err: string | null; crumbs: { t: string; type: string; detail: string }[] }>({ url: '', err: null, crumbs: [] })

  // 이동(드래그) 상태 — pos=null 이면 기본 위치(우하단). 저장된 위치 있으면 그 좌표 사용.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [grabbing, setGrabbing] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const draggingRef = useRef(false)        // 이동 모드 진입 여부
  const movedRef = useRef(false)           // 실제로 옮겼는지
  const suppressClickRef = useRef(false)   // 이동 직후 뒤따르는 click(모달 열기) 억제
  const timerRef = useRef<number | null>(null)
  const pointerIdRef = useRef<number | null>(null)
  const startRef = useRef({ px: 0, py: 0, bx: 0, by: 0 })

  const clamp = (p: { x: number; y: number }) => {
    if (typeof window === 'undefined') return p
    const maxX = window.innerWidth - BTN_SIZE - EDGE
    const maxY = window.innerHeight - BTN_SIZE - EDGE
    return { x: Math.max(EDGE, Math.min(p.x, maxX)), y: Math.max(EDGE, Math.min(p.y, maxY)) }
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const p = JSON.parse(raw)
        if (typeof p?.x === 'number' && typeof p?.y === 'number') setPos(clamp(p))
      }
    } catch { /* noop */ }
    // 화면 회전·리사이즈 시 버튼이 화면 밖으로 나가지 않게 재보정
    const onResize = () => setPos(prev => (prev ? clamp(prev) : prev))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const clearTimer = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null } }

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const rect = btnRef.current?.getBoundingClientRect()
    startRef.current = { px: e.clientX, py: e.clientY, bx: rect?.left ?? 0, by: rect?.top ?? 0 }
    pointerIdRef.current = e.pointerId
    movedRef.current = false
    draggingRef.current = false
    clearTimer()
    timerRef.current = window.setTimeout(() => {
      // 꾹 누름 → 이동 모드 진입(시각 신호 + 포인터 캡처로 손가락이 버튼 밖으로 나가도 추적)
      draggingRef.current = true
      setGrabbing(true)
      try { if (pointerIdRef.current != null) btnRef.current?.setPointerCapture(pointerIdRef.current) } catch { /* noop */ }
    }, LONG_PRESS_MS)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const dx = e.clientX - startRef.current.px
    const dy = e.clientY - startRef.current.py
    if (!draggingRef.current) {
      if (Math.hypot(dx, dy) > MOVE_CANCEL) clearTimer()   // 이동 모드 전 움직임 = 탭/스크롤 → 진입 취소
      return
    }
    e.preventDefault()
    movedRef.current = true
    setPos(clamp({ x: startRef.current.bx + dx, y: startRef.current.by + dy }))
  }

  const endDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    clearTimer()
    if (draggingRef.current) {
      draggingRef.current = false
      setGrabbing(false)
      try { btnRef.current?.releasePointerCapture(e.pointerId) } catch { /* noop */ }
      // 이동 모드였으면(움직였든 아니든) 뒤따르는 click(모달)은 억제 — '탭=열기 / 길게=이동' 명확히
      suppressClickRef.current = true
      setTimeout(() => { suppressClickRef.current = false }, 60)
      if (movedRef.current) {
        setPos(prev => {
          if (prev) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prev)) } catch { /* noop */ } }
          return prev
        })
      }
    }
  }

  const openModal = () => {
    if (suppressClickRef.current) return   // 이동 직후 click 무시
    // 여는 순간의 맥락을 고정(이후 이동해도 신고엔 '그 순간'이 담김)
    setSnapshot({
      url: typeof window !== 'undefined' ? window.location.href : '',
      err: lastError(),
      crumbs: getCrumbs(),
    })
    setNote('')
    setOpen(true)
  }

  const submit = async () => {
    setPending(true)
    try {
      const res = await submitErrorReport({
        url: snapshot.url,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        breadcrumbs: snapshot.crumbs,
        errorText: snapshot.err ?? undefined,
        userNote: note || undefined,
      })
      if (res.ok) { pushToast('success', '오류가 신고되었습니다. 감사합니다!'); setOpen(false) }
      else pushToast('error', res.error)
    } finally { setPending(false) }
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={openModal}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onContextMenu={e => e.preventDefault()}
        aria-label="오류 신고 (길게 눌러 위치 이동)"
        title="오류 신고 — 길게 눌러 끌면 위치를 옮길 수 있어요"
        className={`fixed z-[var(--z-toast,9999)] w-12 h-12 rounded-full shadow-lift flex items-center justify-center ${grabbing ? 'scale-110 ring-4 ring-white/60 cursor-grabbing' : 'transition-transform hover:scale-105 active:scale-95'} ${pos ? '' : 'bottom-4 right-4'}`}
        style={{
          background: 'var(--coral)',
          color: '#fff',
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
          ...(pos ? { left: pos.x, top: pos.y } : {}),
        }}
      >
        {/* 버그/경고 아이콘 */}
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        </svg>
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="오류 신고" subtitle="방금 발생한 문제를 바로 신고하세요">
        <div className="p-4 space-y-3">
          <p className="text-xs text-[var(--warm-muted)]">
            현재 화면과 직전 동작 자취가 자동으로 함께 전송됩니다. 어떤 동작에서 문제가 생겼는지 적어주시면 더 빨리 고칠 수 있어요.
          </p>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={4}
            autoFocus
            placeholder="예: 수납 저장을 눌렀더니 금액이 0으로 바뀌었어요"
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] resize-none"
          />

          {/* 자동 캡처 맥락 미리보기 */}
          <details className="rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] px-3 py-2">
            <summary className="cursor-pointer text-[0.6875rem] font-semibold text-[var(--warm-mid)]">함께 보내는 정보 보기</summary>
            <div className="mt-2 space-y-1 text-[0.625rem] text-[var(--warm-muted)] break-all">
              <div><span className="text-[var(--warm-mid)]">화면:</span> {snapshot.url || '—'}</div>
              {snapshot.err && <div><span className="text-[var(--danger-fg)]">최근 에러:</span> {snapshot.err}</div>}
              <div className="text-[var(--warm-mid)] mt-1">직전 동작:</div>
              <ul className="space-y-0.5">
                {snapshot.crumbs.length === 0 ? <li>—</li> : snapshot.crumbs.slice(-8).reverse().map((c, i) => (
                  <li key={i}>· [{c.type}] {c.detail}</li>
                ))}
              </ul>
            </div>
          </details>

          <div className="flex gap-2 pt-1">
            <Btn type="button" variant="secondary" onClick={() => setOpen(false)} fullWidth>취소</Btn>
            <Btn type="button" variant="primary" onClick={submit} disabled={pending} fullWidth>
              {pending ? '신고 중...' : '신고 보내기'}
            </Btn>
          </div>
        </div>
      </Modal>
    </>
  )
}
