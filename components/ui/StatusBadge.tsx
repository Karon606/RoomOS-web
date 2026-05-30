'use client'

// 상태 뱃지 — "이 카드에 지금 무슨 일이 있는가" (예외 상황) 표시.
// 정상 상태(거주중·완납 등)에는 쓰지 않는다 — 그건 카드 베이스(RoomCard)가 표현.
// 색은 브랜드 5계열 토큰만. 파란색·신호등 녹색 없음.

import type { ReactNode } from 'react'

// Brand Guide v1.1 상태색 — paid(Olive) / await(Blue) / unpaid(Amber) /
// overdue(Terracotta solid) / exit·movein(Camel) / info(중립)
export type BadgeTone = 'paid' | 'await' | 'unpaid' | 'overdue' | 'exit' | 'movein' | 'info'

// Status Row 패턴 (Brand Guide v1.2) — 카드/행 좌측 3px 팁 + 옅은 상태 틴트.
// 팁 색: 상태 액센트. 연체는 배지 fg(크림)가 아닌 테라코타.
export function statusTipColor(tone: BadgeTone): string {
  return tone === 'overdue' ? 'var(--coral)' : `var(--badge-${tone}-fg)`
}
// 행 배경 틴트 — §상태 5단계 bg 기준의 옅은 rgba (라이트·다크 공용).
const ROW_TINT: Record<BadgeTone, string> = {
  paid:    'rgba(85,108,58,0.10)',
  await:   'rgba(59,130,246,0.08)',
  unpaid:  'rgba(180,120,10,0.10)',
  overdue: 'rgba(160,60,46,0.09)',
  exit:    'rgba(200,160,125,0.16)',
  movein:  'rgba(200,160,125,0.16)',
  info:    'rgba(160,120,80,0.08)',
}
export function statusRowTint(tone: BadgeTone): string {
  return ROW_TINT[tone]
}

const BADGE: Record<BadgeTone, { bg: string; fg: string }> = {
  paid:    { bg: 'var(--badge-paid-bg)',    fg: 'var(--badge-paid-fg)'    }, // 완납·정상 — Warm Olive
  await:   { bg: 'var(--badge-await-bg)',   fg: 'var(--badge-await-fg)'   }, // 납부·입실 예정 — Blue
  unpaid:  { bg: 'var(--badge-unpaid-bg)',  fg: 'var(--badge-unpaid-fg)'  }, // 미납 — Amber
  overdue: { bg: 'var(--badge-overdue-bg)', fg: 'var(--badge-overdue-fg)' }, // 연체 — Terracotta 솔리드
  exit:    { bg: 'var(--badge-exit-bg)',    fg: 'var(--badge-exit-fg)'    }, // 퇴실 예정 — Camel
  movein:  { bg: 'var(--badge-movein-bg)',  fg: 'var(--badge-movein-fg)'  }, // 입실 예정 — Camel
  info:    { bg: 'var(--badge-info-bg)',    fg: 'var(--badge-info-fg)'    }, // 일반 정보 — 중립
}

// 뱃지 아래 보조 텍스트 색 — 행 배경(옅은 틴트) 위에 놓이므로 진한 톤(badge bg)으로.
// 흰색 fg 그대로 쓰면 옅은 배경에 묻혀 안 보임 (사용자 피드백 2026-05-30).
const SUB_FG: Record<BadgeTone, string> = {
  paid:    'var(--badge-paid-bg)',
  await:   'var(--badge-await-bg)',
  unpaid:  'var(--badge-unpaid-bg)',
  overdue: 'var(--coral)',
  exit:    'var(--badge-exit-bg)',
  movein:  'var(--badge-movein-bg)',
  info:    'var(--warm-mid)',
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
        <span className="text-[10px] font-semibold whitespace-nowrap" style={{ color: SUB_FG[tone] }}>
          {sub}
        </span>
      )}
    </span>
  )
}
