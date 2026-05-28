'use client'

import { useFormStatus } from 'react-dom'

// 슈퍼관리자 영업장 진입 제출 버튼 — 클릭 후 서버 액션 + 리다이렉트 동안 pending 표시.
export default function EnterButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-70 inline-flex items-center gap-1.5"
      style={{ background: 'var(--ink-2)', color: 'var(--cream)' }}
    >
      {pending && (
        <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
          <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      )}
      {pending ? '진입 중...' : '관리자 권한으로 진입 →'}
    </button>
  )
}
