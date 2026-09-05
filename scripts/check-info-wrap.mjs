// 긴 값이 이웃 칸을 침범하거나 잘리는 것을 막는 감지망. 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가(신고 d03a6c1f, 2026-09-06). 입주자 상세에서 긴 이메일이 오른쪽 성별 칸을
// 덮고, 연락처에서는 마지막 글자가 잘렸다. 원인은 정본 둘에 있었다.
//
//   · grid/flex 자식은 기본 min-width 가 auto 라 내용보다 안 줄어든다. 끊을 자리가 없는
//     긴 토큰(이메일·URL)은 그대로 셀 밖으로 그려진다.
//   · 값에 줄바꿈 허용이 없으면 넘친 채로 남는다.
//
// 영문 이름·현지 표기 이름·비상연락처·직업이 전부 이 정본 둘을 지나므로, 여기만 지키면
// 긴 값 클래스가 한 번에 막힌다. **break-all 은 쓰지 않는다** — 일반 문장까지 쪼갠다.
//
// 실행: node scripts/check-info-wrap.mjs
import { readFileSync } from 'node:fs'

const strip = s => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, m => m.replace(/[^\n]/g, ''))
const read = f => strip(readFileSync(f, 'utf8'))

const violations = []

// 값을 그리는 자리가 줄어들 수 있고(min-w-0) 넘칠 때 끊는가(overflow-wrap).
const TARGETS = [
  ['components/entity-modal/widgets/Section.tsx', 'export function Item', '기본 정보 2열 그리드'],
  ['components/entity-modal/widgets/InfoRow.tsx', 'export function InfoRow', '프리즘 표시 한 줄'],
]
for (const [f, anchor, label] of TARGETS) {
  const src = read(f)
  const at = src.indexOf(anchor)
  if (at < 0) { violations.push(`${f} — ${anchor} 를 못 찾았다. 구조가 바뀌었으면 이 그물부터 고친다(침묵 통과 금지).`); continue }
  const body = src.slice(at, at + 900)
  if (!/min-w-0/.test(body)) {
    violations.push(`${f} — ${label}의 값이 min-w-0 없이 선다. 긴 이메일이 이웃 칸을 침범한다.`)
  }
  if (!/overflow-wrap:anywhere/.test(body)) {
    violations.push(`${f} — ${label}의 값에 줄바꿈 허용이 없다. 끊을 자리가 없는 토큰이 넘친 채로 남는다.`)
  }
  if (/\bbreak-all\b/.test(body)) {
    violations.push(`${f} — ${label}에 break-all 이 있다. 일반 문장까지 아무 데서나 쪼갠다. anywhere 를 쓴다.`)
  }
}

console.log(`[긴 값 줄바꿈] 정본 ${TARGETS.length}곳 / 위반 ${violations.length}건`)
for (const v of violations.slice(0, 10)) console.error(`  - ${v}`)
process.exit(violations.length > 0 ? 1 : 0)
