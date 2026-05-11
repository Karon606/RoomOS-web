// RoomOS 워드마크 — Brand Guide v2 (Floor Mark + Wordmark 통합)
//
// 사양 (Logo System § 01 WORDMARK):
//   font:        Plus Jakarta Sans — Room = weight 300, OS = weight 700
//   letter-spacing: -0.028em
//   mark:        Floor 4선 (100%/65%/100%/50%, persimmon/ink, 100%/38%/58%/22%)
//   구성:        mark 선들(x 0~48) + 간격(68) + 텍스트 → viewBox 0 0 440 56
//
// Props:
//   height  — 렌더 높이(px). 너비는 비율 자동계산.
//   variant — 'light'(기본, 크림배경), 'dark'(다크배경), 'mono'(단색 인쇄용)
//   markOnly — true이면 선 마크만 (텍스트 없음)

type Variant = 'light' | 'dark' | 'mono'

const CONFIGS: Record<Variant, { text: string; l2: string; l3: string; l4: string; os: string }> = {
  light: { text: '#1a1a1a', l2: '#1a1a1a', l3: '#1a1a1a', l4: '#1a1a1a', os: '#e84a1a' },
  dark:  { text: '#fbf6ee', l2: '#fbf6ee', l3: '#fbf6ee', l4: '#fbf6ee', os: '#e84a1a' },
  mono:  { text: '#1a1a1a', l2: '#1a1a1a', l3: '#1a1a1a', l4: '#1a1a1a', os: '#1a1a1a' },
}

export function RoomOSWordmark({
  height = 24,
  variant = 'light',
  markOnly = false,
  className,
  style,
}: {
  height?: number
  variant?: Variant
  markOnly?: boolean
  className?: string
  style?: React.CSSProperties
}) {
  const VB_W = markOnly ? 56 : 440
  const VB_H = 56
  const w = height * (VB_W / VB_H)
  const c = CONFIGS[variant]

  return (
    <svg
      width={w}
      height={height}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      fill="none"
      className={className}
      style={style}
      role="img"
      aria-label="RoomOS"
    >
      {/* Floor 마크 — 4선: 100%/65%/100%/50%, 불투명도 100/38/58/22 */}
      <line x1="0" y1="6"  x2="48" y2="6"  stroke="#e84a1a" strokeWidth="8" strokeLinecap="round"/>
      <line x1="0" y1="22" x2="31" y2="22" stroke={c.l2}    strokeWidth="8" strokeLinecap="round" opacity="0.38"/>
      <line x1="0" y1="38" x2="48" y2="38" stroke={c.l3}    strokeWidth="8" strokeLinecap="round" opacity="0.58"/>
      <line x1="0" y1="54" x2="24" y2="54" stroke={c.l4}    strokeWidth="8" strokeLinecap="round" opacity="0.22"/>

      {/* 워드마크 텍스트 */}
      {!markOnly && (
        <text
          x="68"
          y="44"
          fontFamily="var(--font-plus-jakarta, 'Plus Jakarta Sans', sans-serif)"
          fontSize="44"
          letterSpacing="-1.2"
        >
          <tspan fontWeight="300" fill={c.text}>Room</tspan>
          <tspan fontWeight="700"  fill={c.os}>OS</tspan>
        </text>
      )}
    </svg>
  )
}
