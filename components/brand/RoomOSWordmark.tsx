// 스테이음(Stayeum) 워드마크 — Brand Guide v2 (Floor Mark + Wordmark 통합)
//
// 사양 (Logo System § 01 WORDMARK):
//   font:        Plus Jakarta Sans — Stay = weight 300, eum = weight 700
//   letter-spacing: -0.028em
//   mark:        Floor 4선 (100%/65%/100%/50%), opacity 100/38/58/22%
//
// 색상 전략:
//   Line 1 & "eum": #e84a1a persimmon 고정
//   Line 2-4 & "Stay": currentColor 사용 → svg에 color: var(--ink) 설정
//     → 라이트모드=#1a1a1a, 다크모드=#fbf6ee 자동 전환

export function RoomOSWordmark({
  height = 24,
  markOnly = false,
  className,
  style,
}: {
  height?: number
  markOnly?: boolean
  className?: string
  style?: React.CSSProperties
}) {
  const VB_W = markOnly ? 56 : 460
  const VB_H = 56
  const w = height * (VB_W / VB_H)

  return (
    <svg
      width={w}
      height={height}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      fill="none"
      className={className}
      style={{ color: 'var(--ink, #1a1a1a)', ...style }}
      role="img"
      aria-label="스테이음"
    >
      {/* Line 1: persimmon 고정 */}
      <line x1="0" y1="6"  x2="48" y2="6"  stroke="#e84a1a"      strokeWidth="8" strokeLinecap="round"/>
      {/* Lines 2-4: currentColor (var(--ink) 자동 상속) */}
      <line x1="0" y1="22" x2="31" y2="22" stroke="currentColor" strokeWidth="8" strokeLinecap="round" opacity="0.38"/>
      <line x1="0" y1="38" x2="48" y2="38" stroke="currentColor" strokeWidth="8" strokeLinecap="round" opacity="0.58"/>
      <line x1="0" y1="54" x2="24" y2="54" stroke="currentColor" strokeWidth="8" strokeLinecap="round" opacity="0.22"/>

      {!markOnly && (
        <text
          x="68"
          y="44"
          fontFamily="var(--font-plus-jakarta, 'Plus Jakarta Sans', sans-serif)"
          fontSize="44"
          letterSpacing="-1.2"
        >
          <tspan fontWeight="300" fill="currentColor">Stay</tspan>
          <tspan fontWeight="700"  fill="#e84a1a">eum</tspan>
        </text>
      )}
    </svg>
  )
}
