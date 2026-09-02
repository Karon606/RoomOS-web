// 장식 그라데이션이 화면에 되살아나는 것을 잡는 감지망. 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가. §09 는 그라데이션·글로우를 금지하고 §29 점검표는 그것을 §09 정본으로 넘긴다. 그런데
// 그 규칙을 지키는 그물이 없었다. 지금 코드에는 0건인데, 다음 사람이 히어로 배경·버튼·카드 상단에
// 그라데이션을 하나 깔면 그것이 곧 'AI 가 만든 앱' 인상이다(2026-09-03 정비).
//
// 무엇을 보는가.
//   ⓐ tsx·ts 에 'gradient' 문자열이 없다(Tailwind bg-gradient-*·from-*·via-*·to-* 와 style 의
//      linear-gradient/radial-gradient/conic-gradient 전부 이 한 단어에 걸린다).
//   ⓑ css 의 linear-gradient 는 mask-image(-webkit- 포함) 값으로만 선다. 마스크는 가장자리 페이드
//      (스크롤 힌트)라 색이 아니고, 그 밖의 gradient 는 장식이다.
//   허용 하나. 차트 파일(이름에 Chart)의 SVG <linearGradient> 요소는 영역 차트의 채움 페이드
//   (recharts Area fill, §31 차트)라 데이터 시각화이지 UI 장식이 아니다. 다른 파일에서는 그것도 위반.
//
// 실행: node scripts/check-gradient.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['app', 'components', 'lib']
const files = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { walk(full); continue }
    if (/\.(tsx?|css)$/.test(name)) files.push(full)
  }
}
for (const r of ROOTS) walk(r)

const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const violations = []
for (const f of files) {
  const lines = stripComments(readFileSync(f, 'utf8')).split('\n')
  const isCss = f.endsWith('.css')
  lines.forEach((line, i) => {
    if (!/gradient/i.test(line)) return
    if (isCss && /^\s*(-webkit-)?mask-image\s*:/.test(line)) return
    if (!isCss && /Chart/.test(f) && /<\/?linearGradient\b/.test(line)) return
    violations.push(`${f}:${i + 1} ${isCss ? 'mask-image 밖의 그라데이션이다' : '그라데이션 문자열이다'}. 장식 그라데이션 금지(§09·§29).`)
  })
}

console.log(`[그라데이션] ${files.length}파일 검사 / 위반 ${violations.length}건`)
for (const v of violations.slice(0, 15)) console.error(`  - ${v}`)
if (violations.length > 15) console.error(`  ... 외 ${violations.length - 15}건`)
process.exit(violations.length > 0 ? 1 : 0)
