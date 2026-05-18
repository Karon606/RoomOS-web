'use client'

// 상태 뱃지 — "이 카드에 지금 무슨 일이 있는가" (예외 상황) 표시.
// 정상 상태(거주중·완납 등)에는 쓰지 않는다 — 그건 카드 베이스(RoomCard)가 표현.
// 색은 브랜드 5계열 토큰만. 파란색·신호등 녹색 없음.

import type { ReactNode } from 'react'

export type BadgeTone = 'unpaid' | 'await' | 'exit' | 'movein' | 'info'

const BADGE: Record<BadgeTone, { bg: string; fg: string }> = {
  unpaid: { bg: 'var(--badge-unpaid-bg)', fg: 'var(--badge-unpaid-fg)' }, // 미납 — Terracotta 솔리드
  await:  { bg: 'var(--badge-await-bg)',  fg: 'var(--badge-await-fg)'  }, // 납부 예정 — Sand
  exit:   { bg: 'var(--badge-exit-bg)',   fg: 'var(--badge-exit-fg)'   }, // 퇴실 예정 — Camel
  movein: { bg: 'var(--badge-movein-bg)', fg: 'var(--badge-movein-fg)' }, // 입실 예정 — Camel
  info:   { bg: 'var(--badge-info-bg)',   fg: 'var(--badge-info-fg)'   }, // 일반 정보 — 중립
}

export function StatusBadge({
  tone,
  children,
  sub,
  className,
}: {
  tone: BadgeTone
  children: ReactNode
  /** 뱃지 아래 작은 보조 텍스트 (예: "3일 초과", "D-1 (5/19)") */
  sub?: string
  className?: string
}) {
  const s = BADGE[tone]
  return (
    <span className={`inline-flex flex-col items-end gap-0.5 ${className ?? ''}`}>
      <span
        className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold tracking-tight whitespace-nowrap"
        style={{ background: s.bg, color: s.fg }}
      >
        {children}
      </span>
      {sub && (
        <span className="text-[10px] font-medium whitespace-nowrap" style={{ color: s.fg, opacity: 0.85 }}>
          {sub}
        </span>
      )}
    </span>
  )
}
