// 서명 획 판정 정본 — 점 몇 개를 서명으로 받지 않는다.
//
// 왜 있나(2026-09-06). 서명 패드의 확인이 isEmpty() 만 봐서 탭 한 번(점)도 서명으로
// 저장됐다. 실사례 — 조정미님 임의처분동의서에 점 2개가 서명으로 남았다. 법적 근거가 되는
// 종이에 점 두 개는 서명이 아니다.
//
// 판정은 획의 **총 길이**다. 획 수나 점 수로 재면 점을 여러 번 찍은 것과 짧은 서명을 못
// 가른다. 막으려는 것은 실수로 찍힌 점이지 간단한 서명이 아니므로 바닥은 낮게 잡는다.

export type InkPoint = { x: number; y: number }
export type InkStroke = { points: InkPoint[] }

/** 서명으로 인정하는 최소 총 획 길이(CSS px). 체크 표시 수준의 짧은 서명도 넉넉히 넘는다. */
export const MIN_SIGNATURE_INK_PX = 60

/** 획의 총 길이. 점(길이 0)은 몇 개를 찍어도 0 이다. */
export function signatureInkLength(strokes: InkStroke[]): number {
  let sum = 0
  for (const s of strokes) {
    const pts = s.points
    for (let i = 1; i < pts.length; i++) sum += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  }
  return sum
}

export function isSignatureInkEnough(strokes: InkStroke[]): boolean {
  return signatureInkLength(strokes) >= MIN_SIGNATURE_INK_PX
}
