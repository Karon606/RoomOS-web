// 서명 획 판정 회귀 — 점은 몇 개든 거절, 실제 획은 통과.
import { signatureInkLength, isSignatureInkEnough, MIN_SIGNATURE_INK_PX } from '../lib/signatureInk'

let pass = 0
const fails: string[] = []
const eq = (name: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++
  else fails.push(`${name}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
}
const dot = (x: number, y: number) => ({ points: [{ x, y }] })
const line = (x1: number, y1: number, x2: number, y2: number, n = 8) => ({
  points: Array.from({ length: n }, (_, i) => ({ x: x1 + (x2 - x1) * i / (n - 1), y: y1 + (y2 - y1) * i / (n - 1) })),
})

eq('빈 배열은 0', signatureInkLength([]), 0)
eq('점 하나는 0', signatureInkLength([dot(10, 10)]), 0)
eq('점 다섯도 0 — 조정미님 실사례의 클래스', signatureInkLength([dot(1, 1), dot(2, 2), dot(3, 3), dot(4, 4), dot(5, 5)]), 0)
eq('점은 몇 개든 거절', isSignatureInkEnough([dot(1, 1), dot(9, 9)]), false)
eq('짧은 긁힘(20px)도 거절', isSignatureInkEnough([line(0, 0, 20, 0)]), false)
eq('가로 100px 획은 통과', isSignatureInkEnough([line(0, 0, 100, 0)]), true)
eq('체크 표시 수준(40+40)도 통과', isSignatureInkEnough([line(0, 0, 30, 28), line(30, 28, 58, 0)]), true)
eq('경계 바로 아래는 거절', isSignatureInkEnough([line(0, 0, MIN_SIGNATURE_INK_PX - 1, 0)]), false)
eq('경계 이상은 통과', isSignatureInkEnough([line(0, 0, MIN_SIGNATURE_INK_PX, 0)]), true)
eq('여러 획 합산', signatureInkLength([line(0, 0, 10, 0), line(0, 0, 0, 10)]), 20)

console.log(`\n서명 획 판정 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.error(`  - ${f}`)
process.exit(fails.length > 0 ? 1 : 0)
