'use client'

// 캘린더 구독(.ics) — 구독 URL 발급/복사/재발급. 구글·애플·아웃룩에 한 번 등록하면
// 납부 예정일·퇴실 예정일이 자동으로 동기화(읽기전용)된다.
import { useState, useTransition } from 'react'
import { getOrCreateCalendarToken, resetCalendarToken } from './actions'
import { pushToast } from '@/lib/saveStatus'
import { confirmDialog } from '@/components/ui/ConfirmDialog'

export function CalendarSubscribeCard() {
  const [token, setToken] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const httpUrl = token ? `${origin}/api/calendar/${token}` : ''
  const webcalUrl = token ? httpUrl.replace(/^https?:\/\//, 'webcal://') : ''
  const googleUrl = token ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(httpUrl)}` : ''

  const issue = () => {
    setOpen(true)
    if (token) return
    startTransition(async () => {
      const res = await getOrCreateCalendarToken()
      if (!res.ok) { pushToast('error', res.error); return }
      setToken(res.token)
    })
  }

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      pushToast('success', `${label} 복사됨`)
    } catch {
      pushToast('error', '복사에 실패했습니다. 길게 눌러 직접 복사해 주세요.')
    }
  }

  const reset = async () => {
    if (!(await confirmDialog({
      title: '구독 주소를 재발급할까요?',
      message: '기존 주소로 등록된 캘린더는 더 이상 동기화되지 않습니다. 새 주소로 다시 구독해야 합니다.',
      level: 'danger', confirmLabel: '재발급',
    }))) return
    startTransition(async () => {
      const res = await resetCalendarToken()
      if (!res.ok) { pushToast('error', res.error); return }
      setToken(res.token)
      pushToast('success', '새 구독 주소가 발급되었습니다')
    })
  }

  return (
    <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-6 mt-4">
      <h2 className="text-sm font-semibold text-[var(--warm-dark)] mb-1">캘린더 연동 (구독)</h2>
      <p className="text-xs text-[var(--warm-muted)] leading-relaxed mb-3">
        구독 주소를 구글·애플·아웃룩 캘린더에 한 번 등록하면, 월 이용료 납부 예정일과 퇴실 예정일이
        내 캘린더에 자동으로 표시되고 변경사항도 주기적으로 동기화됩니다(읽기 전용).
      </p>

      {!open ? (
        <button type="button" onClick={issue}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-xl bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] transition-colors">
          구독 주소 만들기 →
        </button>
      ) : pending && !token ? (
        <p className="text-xs text-[var(--warm-muted)]">발급 중…</p>
      ) : token ? (
        <div className="space-y-3">
          <div>
            <label className="block text-[0.6875rem] font-medium text-[var(--warm-muted)] mb-1">구독 주소</label>
            <div className="flex items-center gap-1.5">
              <input readOnly value={httpUrl} onFocus={e => e.currentTarget.select()}
                className="flex-1 min-w-0 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-2 text-[0.6875rem] text-[var(--warm-dark)] outline-none" />
              <button type="button" onClick={() => copy(httpUrl, '구독 주소')}
                className="shrink-0 px-3 py-2 text-xs font-medium rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] transition-colors">
                복사
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <a href={googleUrl} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] transition-colors">
              구글 캘린더에 추가
            </a>
            <a href={webcalUrl}
              className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] transition-colors">
              애플 캘린더에 추가
            </a>
            <button type="button" onClick={reset} disabled={pending}
              className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg text-[var(--danger-fg)] hover:bg-[var(--danger-bg)] disabled:opacity-40 transition-colors">
              주소 재발급
            </button>
          </div>

          <details className="text-[0.6875rem] text-[var(--warm-muted)]">
            <summary className="cursor-pointer select-none text-[var(--warm-dark)] font-medium">구독 방법 안내</summary>
            <ul className="mt-2 space-y-1.5 leading-relaxed list-disc pl-4">
              <li><b>아이폰·맥(애플 캘린더)</b> — “애플 캘린더에 추가”를 누르면 바로 구독됩니다. 안 되면 설정 → 캘린더 → 계정 → 캘린더 구독 추가에 구독 주소를 붙여넣으세요.</li>
              <li><b>구글 캘린더(PC)</b> — “구글 캘린더에 추가”를 누르거나, 다른 캘린더 → URL로 추가에 구독 주소를 붙여넣으세요. 동기화까지 몇 시간 걸릴 수 있습니다.</li>
              <li><b>윈도우(아웃룩)</b> — 캘린더 추가 → 웹에서 구독에 구독 주소를 붙여넣으세요.</li>
              <li>구독 주소에는 영업장 일정이 담겨 있으니 외부에 공유하지 마세요. 유출 시 “주소 재발급”으로 무효화할 수 있습니다.</li>
            </ul>
          </details>
        </div>
      ) : null}
    </div>
  )
}
