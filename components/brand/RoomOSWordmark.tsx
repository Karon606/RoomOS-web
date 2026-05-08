// RoomOS 워드마크 — 가이드 명시 형식 "Room`O`S" (가운데 O만 persimmon)
// SVG <text>로 구현. Pretendard 로딩이 실패해도 system bold로 일관 렌더.
// height만 받아 width는 자동 계산 (텍스트 길이에 맞춰).
//
// 가이드 사양:
//   font: Pretendard 800~900
//   letter-spacing: -0.045em ~ -0.07em (display)
//   ink color: var(--ink) #1a1a1a
//   accent O: var(--persimmon) #e84a1a

export function RoomOSWordmark({
  height = 24,
  weight = 800,
  className,
  style,
}: {
  height?: number
  weight?: number
  className?: string
  style?: React.CSSProperties
}) {
  // viewBox 비율: 가이드 워드마크 비율과 비슷하게 (대략 "RoomOS" 6글자 * 0.55 = 3.3:1)
  const w = height * 3.1
  const h = height
  // SVG 내부 좌표 — 1000 기준
  const VB_W = 1000
  const VB_H = 320
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      className={className}
      style={style}
      role="img"
      aria-label="RoomOS"
    >
      <text
        x="0"
        y={VB_H * 0.78}
        fontFamily="'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif"
        fontWeight={weight}
        fontSize={VB_H * 0.95}
        letterSpacing="-12"
        fill="var(--ink, #1a1a1a)"
      >
        Room<tspan fill="var(--persimmon, #e84a1a)">O</tspan>S
      </text>
    </svg>
  )
}
