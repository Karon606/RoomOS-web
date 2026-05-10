// RoomOS 워드마크 — Brand Guide v1.0 명시 형식 "Room`O`S" (가운데 O만 persimmon)
// SVG <text>로 구현. Pretendard 로딩이 실패해도 system Black weight로 일관 렌더.
// height만 받아 width는 자동 계산 (텍스트 길이에 맞춰).
//
// 가이드 사양 (Brand Guide § 02 LOGO):
//   font:        Pretendard 900 (Black)        — cover-title / logo-wm 모두 900
//   letter-spacing: -0.06em (logo-wm) ~ -0.07em (display)
//   ink color:   var(--ink)       #1a1a1a
//   accent O:    var(--persimmon) #e84a1a

export function RoomOSWordmark({
  height = 24,
  weight = 900,
  className,
  style,
}: {
  height?: number
  weight?: number
  className?: string
  style?: React.CSSProperties
}) {
  // viewBox: 1280 폭이면 RoomOS 6글자가 -0.06em 압축에서도 안전하게 들어감 (S 잘림 방지)
  const VB_W = 1280
  const VB_H = 320
  const FONT = VB_H * 0.95            // ≈ 304
  const LETTER_SPACING = -FONT * 0.06 // -0.06em → -18.24 (가이드 logo-wm 사양)
  const w = height * (VB_W / VB_H)
  const h = height
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
        fontFamily="'Pretendard Black', 'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif"
        fontWeight={weight}
        fontSize={FONT}
        letterSpacing={LETTER_SPACING}
        style={{ fontVariationSettings: `'wght' ${weight}` }}
        fill="var(--ink, #1a1a1a)"
      >
        Room<tspan fill="var(--persimmon, #e84a1a)">O</tspan>S
      </text>
    </svg>
  )
}
