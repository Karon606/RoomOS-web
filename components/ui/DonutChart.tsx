// 도넛 차트 정본 — 홈 대시보드·재무 카테고리 분석이 같은 도넛을 쓴다.
//
// SVG 원 하나에 strokeDasharray 로 조각을 얹는다. recharts 를 안 쓰는 이유는 이 도넛이
// 조각 다섯 개와 가운데 글자 두 줄이 전부라, 라이브러리를 태우면 번들만 늘고 색·글자 규약을
// 다시 맞춰야 하기 때문이다. 색은 부르는 쪽이 lib/chartColors 정본에서 골라 넘긴다.
//
// 값이 전부 0 이면 회색 고리 하나를 그린다 — 빈 자리를 비워 두면 카드 높이가 무너진다.
//
// 왜 정본으로 올렸나 — 같은 함수가 세 벌 복사돼 있었다(DashboardClient·FinanceClient·StatsClient,
// 2026-08-12 구조 부채 정리). 조각을 그리는 코드는 세 벌이 한 글자도 다르지 않았고, 갈린 것은
// 가운데 글자 크기뿐이었다(홈 15px · 재무 13px). 재무 도넛이 홈보다 **큰데**(150 대 140) 글자는
// 작았으므로 갈림 자체가 결함이었다 — 정본은 홈 쪽 수치로 모은다.
// StatsClient 사본은 도달 불가라 수렴 대상이 아니라 삭제 대상이었다(page 가 redirect).

export function DonutChart({
  segments, centerLabel, centerSub, size = 140, strokeWidth = 22,
}: {
  segments: { value: number; color: string }[]
  centerLabel?: string; centerSub?: string; size?: number; strokeWidth?: number
}) {
  const r = (size - strokeWidth) / 2
  const cx = size / 2; const cy = size / 2
  const C = 2 * Math.PI * r
  const total = segments.reduce((s, seg) => s + seg.value, 0)
  let cumulativeAngle = -90
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {total === 0 ? (
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--cream-3)" strokeWidth={strokeWidth} />
      ) : (
        segments.filter(s => s.value > 0).map((seg, i) => {
          const pct = seg.value / total
          const dashLength = pct * C
          const angle = cumulativeAngle
          cumulativeAngle += pct * 360
          return (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={seg.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${dashLength} ${C - dashLength}`}
              transform={`rotate(${angle}, ${cx}, ${cy})`} />
          )
        })
      )}
      {centerLabel && <text x={cx} y={cy + 6} textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--ink-2)">{centerLabel}</text>}
      {centerSub && <text x={cx} y={cy + 22} textAnchor="middle" fontSize="10" fill="var(--neutral-fg)">{centerSub}</text>}
    </svg>
  )
}
