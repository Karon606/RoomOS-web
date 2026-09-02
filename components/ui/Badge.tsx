'use client'

import React from 'react'

// M7 가이드 정식 4톤 (솔리드, 강조용 — 미납·완료·경고·중립)
type SemanticTone = 'success' | 'warn' | 'danger' | 'neutral'
// 페일 톤 (부드러운 라벨용 — 거주중·예약·요청 등 상태 표시)
// pale-coral 은 폐기 예정이다. danger 색이 곧 테라코타라(§04 결정 1) "danger 아닌 코랄 라벨 톤"이
// 시각적으로 성립하지 않고, 코랄 채움은 CTA·연체·부유 액션 몫이다(§03). 쓰던 네 자리(분류 라벨)는
// pale-neutral 로 옮겼다. 새로 쓰지 말 것(디자이너 패스 2026-09-03).
// inspect = v2.0 §04 in-progress(점검·처리 중) b-inspect — v2.0 §22 재고 카드 전용 과정 상태
type PaleTone = 'pale-coral' | 'pale-green' | 'pale-amber' | 'pale-blue' | 'pale-red' | 'pale-teal' | 'pale-purple' | 'pale-neutral' | 'inspect'
// 호환 alias (기존 코드)
type LegacyTone = 'coral' | 'green' | 'amber' | 'blue' | 'red' | 'teal' | 'purple'

type Tone = SemanticTone | PaleTone | LegacyTone

// Brand Guide v1.1 솔리드 톤 — 강조용. mono uppercase 권장
const SOLID_CLS: Record<SemanticTone, string> = {
  success: 'bg-[var(--success-solid)] text-[var(--on-solid)]',   // v2.0 §04 — 시맨틱 솔리드(#4E6834), viz·순백 대신
  warn:    'bg-[var(--warning-solid)] text-[var(--on-solid)]',    // v2.0 §04 — 시맨틱 솔리드(#8B5E0A), honey 새 hue 대신
  danger:  'bg-[var(--persimmon)] text-[var(--on-solid)]',
  neutral: 'bg-[var(--cream-3)] text-[var(--ink-3)]',
}

// 페일 톤 — 일반 라벨용. 구분은 -bg 농도와 -fg 가 진다(2026-09 개정으로 ring 폐지, §11).
// 색은 §04 의미 토큰의 -bg/-fg/-ring 트라이어드만 쓴다. coral 은 §04 결정 1(danger 는 테라코타로 흡수)에
// 따라 --danger-* 이고, viz 팔레트·hex·알파 슬래시는 여기 오지 않는다(scripts/check-badge-tokens, 2026-09-03).
const PALE_CLS: Record<string, string> = {
  'pale-coral':  'bg-[var(--danger-bg)] text-[var(--danger-fg)]',
  'pale-green':  'bg-[var(--success-bg)] text-[var(--success-fg)]',
  'pale-amber':  'bg-[var(--warning-bg)] text-[var(--warning-fg)]',
  'pale-blue':   'bg-[var(--info-bg)] text-[var(--info-fg)]',
  'pale-red':    'bg-[var(--danger-bg)] text-[var(--danger-fg)]',
  'pale-teal':   'bg-[var(--reserve-bg)] text-[var(--reserve-fg)]',
  'pale-purple': 'bg-[var(--deposit-bg)] text-[var(--deposit-fg)]',
  // neutral 틴트 — 솔리드 neutral 은 r-sm·mono·굵기가 달라 pale 형제와 모양이 어긋난다(디자이너 패스 2026-08-02)
  'pale-neutral': 'bg-[var(--neutral-bg)] text-[var(--neutral-fg)]',
  'inspect':     'bg-[var(--inspect-bg)] text-[var(--inspect-fg)]',
  // legacy alias — 기존 코드 호환
  'coral':       'bg-[var(--danger-bg)] text-[var(--danger-fg)]',
  'green':       'bg-[var(--success-bg)] text-[var(--success-fg)]',
  'amber':       'bg-[var(--warning-bg)] text-[var(--warning-fg)]',
  'blue':        'bg-[var(--info-bg)] text-[var(--info-fg)]',
  'red':         'bg-[var(--danger-bg)] text-[var(--danger-fg)]',
  'teal':        'bg-[var(--reserve-bg)] text-[var(--reserve-fg)]',
  'purple':      'bg-[var(--deposit-bg)] text-[var(--deposit-fg)]',
}

export function Badge({
  tone = 'neutral',
  size = 'sm',
  icon,
  mono = false,
  children,
  className = '',
}: {
  tone?: Tone
  size?: 'sm' | 'md'
  icon?: React.ReactNode
  /** M7 가이드 솔리드 톤일 때 mono+uppercase로 표시. 페일 톤은 기본 false. */
  mono?: boolean
  children: React.ReactNode
  className?: string
}) {
  const isSolid = tone in SOLID_CLS
  // 모르는 tone 의 안전 착지는 무신호 중립이다. 종전 폴백 pale-coral 은 이제 danger 라 의미가 실린다.
  const toneCls = isSolid ? SOLID_CLS[tone as SemanticTone] : (PALE_CLS[tone as string] ?? PALE_CLS['pale-neutral'])
  const sizeCls = size === 'md' ? 'text-xs px-2.5 py-1' : 'text-[0.6875rem] px-2 py-0.5'
  // 솔리드 톤은 항상 mono+uppercase (가이드 명시). 페일 톤은 mono prop으로 opt-in.
  const fontCls = (isSolid || mono)
    ? 'mono tnum font-bold uppercase tracking-wider'
    : 'font-medium'
  // 배지는 전부 r-sm(6px)다 — §07 radius 표("r-sm 6 = 뱃지")의 정합 회복(2026-08-25 §11 개정).
  // 종전에는 페일 톤만 알약(r-pill)이라 형제끼리도 갈렸고, 글자를 담은 알약이 화면마다 서서
  // 운영자가 지목한 'AI 가 만든 앱' 인상의 큰 몫이었다. 원은 도형이 기능일 때만 쓴다.
  // 틴트 면에 같은 색 1px 테두리를 또 얹는 것은 이중 강조였다(§11 2026-09 개정으로 ring 폐지).
  // -ring 토큰 자체는 폼 에러 박스·Status Row·선택 보더에 존속한다.
  const radiusCls = 'rounded-sm'
  return (
    <span className={`inline-flex items-center gap-1 ${radiusCls} ${toneCls} ${sizeCls} ${fontCls} ${className}`}>
      {icon && <span className="leading-none">{icon}</span>}
      {children}
    </span>
  )
}
