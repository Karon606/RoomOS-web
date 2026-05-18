// 스테이음(Stayeum) 워드마크 — Brand Guide (Arch Symbol + Wordmark)
//
// 사양:
//   symbol:  Arch Symbol — 단일 filled path (path coords x 8–121 / y 8–82)
//   font:    Plus Jakarta Sans — stay = weight 300, eum = weight 700
//   letter-spacing: -0.028em
//
// 색상 전략:
//   Arch & "eum": var(--persimmon) Terracotta 고정
//   "stay": currentColor → svg에 color: var(--ink) 설정
//     → 라이트=#3d2418 / 다크=#fbf6ef 자동 전환
//
// viewBox는 콘텐츠에 딱 맞게 잘라(8 8 …) height prop = 실제 로고 높이가 되도록 함.

/** Arch Symbol — 단일 filled path. 브랜드 심볼의 단일 출처. */
export const ARCH_PATH =
  'M 8 82 C 8 32 22 8 55 8 C 88 8 121 32 121 82 A 8.5 8.5 0 0 1 104 82 C 104 44 80 26 55 26 C 30 26 28 44 28 82 A 10 10 0 0 1 8 82 Z'

export function StayeumWordmark({
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
  // 콘텐츠 타이트 viewBox: x 8 시작, y 8–82 (74 높이)
  // full 폭 366 = arch(~121) + gap + "stayeum" 텍스트 여유분 (글리프 클리핑 방지)
  const VB = markOnly ? '8 8 113 74' : '8 8 366 74'
  const VB_W = markOnly ? 113 : 366
  const w = height * (VB_W / 74)

  return (
    <svg
      width={w}
      height={height}
      viewBox={VB}
      fill="none"
      className={className}
      style={{ color: 'var(--ink, #3d2418)', ...style }}
      role="img"
      aria-label="스테이음"
    >
      {/* Arch Symbol — Terracotta 고정 */}
      <path d={ARCH_PATH} fill="var(--persimmon, #a03c2e)" />

      {!markOnly && (
        <text
          x="143"
          y="66"
          fontFamily="var(--font-plus-jakarta, 'Plus Jakarta Sans', sans-serif)"
          fontSize="56"
          letterSpacing="-1.5"
        >
          <tspan fontWeight="300" fill="currentColor">stay</tspan>
          <tspan fontWeight="700" fill="var(--persimmon, #a03c2e)">eum</tspan>
        </text>
      )}
    </svg>
  )
}
