'use client'

// 문의 칸의 이메일 주소 복사 버튼 — 복사하면 2초 동안 표시가 바뀌고 화면 읽기 프로그램에도 알린다

import { useState } from 'react'

export function CopyEmailButton({ email }: { email: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(email)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 권한이 막힌 브라우저 — 주소가 화면에 그대로 있으니 길게 눌러 복사할 수 있다.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? '복사했어요' : '이메일 주소 복사'}
      className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-lg border border-[var(--warm-border)] bg-[var(--cream)] px-3 text-xs font-medium text-[var(--ink-3)] hover:bg-[var(--sand)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tc-text)]"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15V5a1 1 0 0 1 1-1h10" />
      </svg>
      <span aria-live="polite">{copied ? '복사했어요' : '복사'}</span>
    </button>
  )
}
