// RoomOS 워드마크 — Brand Guide v2 (Floor Mark + Wordmark 통합)
//
// 사양 (Logo System § 01 WORDMARK):
//   font:        Plus Jakarta Sans — Room = weight 300, OS = weight 700
//   letter-spacing: -0.028em
//   mark:        Floor 4선 (100%/65%/100%/50%, persimmon + var(--ink))
//   불투명도:    선1=100%, 선2=38%, 선3=58%, 선4=22%
//
// 선 2-4와 텍스트는 var(--ink) CSS 변수 사용 → 라이트/다크 자동 대응
// 스플래시처럼 배경이 고정 다크(#1a1a1a)인 경우 컴포넌트 직접 SVG 인라인 권장.

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
  const VB_W = markOnly ? 56 : 440
  const VB_H = 56
  const w = height * (VB_W / VB_H)

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
      {/* Floor 마크 — 4선: 너비 100%/65%/100%/50%, 불투명도 100/38/58/22 */}
      <line x1="0" y1="6"  x2="48" y2="6"  stroke="#e84a1a"      strokeWidth="8" strokeLinecap="round"/>
      <line x1="0" y1="22" x2="31" y2="22" stroke="var(--ink, #1a1a1a)" strokeWidth="8" strokeLinecap="round" opacity="0.38"/>
      <line x1="0" y1="38" x2="48" y2="38" stroke="var(--ink, #1a1a1a)" strokeWidth="8" strokeLinecap="round" opacity="0.58"/>
      <line x1="0" y1="54" x2="24" y2="54" stroke="var(--ink, #1a1a1a)" strokeWidth="8" strokeLinecap="round" opacity="0.22"/>

      {/* 워드마크 텍스트 */}
      {!markOnly && (
        <text
          x="68"
          y="44"
          fontFamily="var(--font-plus-jakarta, 'Plus Jakarta Sans', sans-serif)"
          fontSize="44"
          letterSpacing="-1.2"
        >
          <tspan fontWeight="300" fill="var(--ink, #1a1a1a)">Room</tspan>
          <tspan fontWeight="700"  fill="#e84a1a">OS</tspan>
        </text>
      )}
    </svg>
  )
}
