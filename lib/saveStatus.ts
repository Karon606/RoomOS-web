// 폼 저장 / 리프레시 진행 상태를 전역에서 추적·구독하는 경량 pub/sub.
// React Context 없이 모듈-스코프 변수로 운영해 어디서든 호출 가능.

// v2.0 §15 — 4종(success/error/info/urgent), 장문(detail)·액션(적용취소) 지원
export type ToastKind = 'success' | 'error' | 'info' | 'urgent'
export type ToastAction = { label: string; run: () => void }
export type Toast = {
  id: number
  kind: ToastKind
  message: string         // 1행 — 결과 (13px/600)
  detail?: string         // 2행 — 부가 설명 (장문형, v2.0 §15)
  action?: ToastAction    // 우측 텍스트 버튼 (v2.0 §15 — 적용취소 등)
  duration: number        // ms
}

// CSS 토큰(--toast-dur-*)과 동기 — 한쪽 수정 시 globals.css 도 함께
export const TOAST_DUR_SHORT = 2400
export const TOAST_DUR_LONG = 5200
export const TOAST_DUR_ACTION = 6000

let pendingCount = 0
const pendingListeners = new Set<(n: number) => void>()
const toastListeners = new Set<(t: Toast) => void>()
let toastId = 0

export function trackSave(): () => void {
  pendingCount++
  pendingListeners.forEach(l => l(pendingCount))
  let released = false
  return () => {
    if (released) return
    released = true
    pendingCount = Math.max(0, pendingCount - 1)
    pendingListeners.forEach(l => l(pendingCount))
  }
}

export function subscribePending(cb: (n: number) => void): () => void {
  pendingListeners.add(cb)
  cb(pendingCount)
  return () => { pendingListeners.delete(cb) }
}

export function pushToast(
  kind: ToastKind,
  message: string,
  opts?: { detail?: string; action?: ToastAction; duration?: number },
) {
  // 지속시간 자동 판정 — 액션형 6000 > 장문형 5200 > 1줄형 2400 (v2.0 §15·11.4)
  const duration = opts?.duration
    ?? (opts?.action ? TOAST_DUR_ACTION : (opts?.detail || message.length > 40) ? TOAST_DUR_LONG : TOAST_DUR_SHORT)
  const t: Toast = { id: ++toastId, kind, message, detail: opts?.detail, action: opts?.action, duration }
  toastListeners.forEach(l => l(t))
}

export function subscribeToast(cb: (t: Toast) => void): () => void {
  toastListeners.add(cb)
  return () => { toastListeners.delete(cb) }
}

/**
 * server action 호출을 trackSave + 자동 토스트로 감싼다.
 * - 성공/실패 토스트는 내부에서 처리 — 호출 측은 result만 사용
 * - startTransition 안에서 호출해 pending 상태와 함께 동작
 *
 * 예) startTransition(async () => {
 *   const res = await withSave(() => addExpense(fd), { success: '지출 등록됨' })
 *   if (!res.ok) return
 *   setShowModal(false); router.refresh()
 * })
 */
export async function withSave<T extends { ok: boolean; error?: string }>(
  action: () => Promise<T>,
  opts: { success?: string; silentError?: boolean } = {},
): Promise<T> {
  const release = trackSave()
  try {
    const res = await action()
    if (res.ok) {
      if (opts.success) pushToast('success', opts.success)
    } else if (!opts.silentError) {
      pushToast('error', res.error || '저장에 실패했습니다.')
    }
    return res
  } catch (err) {
    if (!opts.silentError) pushToast('error', (err as Error).message ?? '오류가 발생했습니다.')
    throw err
  } finally {
    release()
  }
}
