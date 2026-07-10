// 오류신고용 '직전 동작 자취' — 클라이언트 모듈 레벨 링버퍼.
// 화면 이동·자동 캡처된 JS 에러를 시간순으로 모아두고, 오류신고 시 함께 첨부한다.
// "오류 발생 직후 바로 신고" 흐름에서 "방금 뭘 했는지"를 자동으로 담는 게 목적.

export type Crumb = { t: string; type: 'nav' | 'error' | 'action'; detail: string }

const MAX = 25
const buf: Crumb[] = []

function nowIso(): string {
  // 클라이언트 런타임 — Date 사용 가능
  return new Date().toISOString()
}

export function recordCrumb(type: Crumb['type'], detail: string) {
  buf.push({ t: nowIso(), type, detail: detail.slice(0, 300) })
  if (buf.length > MAX) buf.shift()
}

export function getCrumbs(): Crumb[] {
  return [...buf]
}

// 가장 최근 에러 자취(있으면) — 신고 모달에서 자동 표시용
export function lastError(): string | null {
  for (let i = buf.length - 1; i >= 0; i--) {
    if (buf[i].type === 'error') return buf[i].detail
  }
  return null
}

let installed = false
export function installErrorCapture() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (e) => {
    const msg = e.message || '(no message)'
    const where = e.filename ? ` @ ${e.filename}:${e.lineno ?? '?'}` : ''
    recordCrumb('error', `${msg}${where}`)
  })
  window.addEventListener('unhandledrejection', (e) => {
    const reason = (e as PromiseRejectionEvent).reason
    // Error 객체는 message/stack이 열거 불가라 JSON.stringify가 '{}'가 됨 — message를 우선 추출
    const text = reason instanceof Error
      ? `${reason.name}: ${reason.message}`
      : typeof reason === 'object' && reason !== null
        ? ((reason as { message?: string }).message ?? JSON.stringify(reason))
        : String(reason)
    recordCrumb('error', `unhandledrejection: ${text.slice(0, 200)}`)
  })
}
