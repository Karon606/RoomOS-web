'use client'

// 전역 '오류신고' 플로팅 버튼 — 오류 발생 즉시 눌러 직전 동작 자취 + 메모를 신고.
// (UI 위치/형태는 추후 최적화 검토. 우선 우하단 플로팅.)
import { useState } from 'react'
import { submitErrorReport } from '@/app/(app)/errorReports'
import { getCrumbs, lastError } from '@/lib/errorBreadcrumbs'
import { Modal } from '@/components/ui/Modal'
import { Btn } from '@/components/ui/Btn'
import { pushToast } from '@/lib/saveStatus'

export default function ErrorReportButton() {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [snapshot, setSnapshot] = useState<{ url: string; err: string | null; crumbs: { t: string; type: string; detail: string }[] }>({ url: '', err: null, crumbs: [] })

  const openModal = () => {
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
        type="button"
        onClick={openModal}
        aria-label="오류 신고"
        title="오류 신고"
        className="fixed bottom-4 right-4 z-[var(--z-toast,9999)] w-12 h-12 rounded-full shadow-lift flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
        style={{ background: 'var(--coral)', color: '#fff' }}
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
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] resize-none"
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
