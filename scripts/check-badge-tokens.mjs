// 배지 색이 §04 의미 토큰 트라이어드 밖으로 새는 것을 잡는 감지망. 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가. Badge 의 pale-green ring 이 차트 팔레트(--viz-3)에 알파 30% 를 얹은 값이었고
// pale-coral 은 --persimmon 계열에 알파 20% 였다. §04 는 "각 의미 = fg / bg / ring / solid" 이고
// 결정 6 이 "페일 틴트는 bg/fg/ring 트라이어드 1:1" 이다. 트라이어드 밖 값은 다크에서 §28 틴트표를
// 못 타고, 알파 슬래시는 토큰 값이 바뀌어도 따라가지 않는다(2026-09-03 정비).
//
//   ⓐ 배지 두 정본(Badge·StatusBadge)에 --viz-* 참조가 없다. 차트 팔레트는 배지 색이 아니다.
//   ⓑ hex 리터럴이 없다. 색은 토큰만.
//   ⓒ 토큰 뒤 알파 슬래시(/20 같은)가 없다. 반투명은 토큰 값 안에 있다.
//
// 실행: node scripts/check-badge-tokens.mjs
import { readFileSync } from 'node:fs'

const FILES = ['components/ui/Badge.tsx', 'components/ui/StatusBadge.tsx']
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/[^\n'"`]*$/gm, '')
const violations = []

for (const f of FILES) {
  const lines = stripComments(readFileSync(f, 'utf8')).split('\n')
  lines.forEach((line, i) => {
    const at = `${f}:${i + 1}`
    if (/--viz-\d/.test(line)) violations.push(`${at} 차트 팔레트(--viz-*)가 배지 색에 섰다. §04 의미 토큰 트라이어드로.`)
    if (/#[0-9a-fA-F]{3,8}\b/.test(line)) violations.push(`${at} hex 리터럴이 배지 색에 섰다. 토큰만(§04).`)
    if (/\]\/\d+/.test(line) || /var\(--[\w-]+\)\/\d+/.test(line)) violations.push(`${at} 토큰 뒤 알파 슬래시다. 반투명은 -bg/-ring 토큰 값 안에 있다(§04 결정 6).`)
  })
}

console.log(`[배지 토큰] ${FILES.length}파일 검사 / 위반 ${violations.length}건`)
for (const v of violations) console.error(`  - ${v}`)
process.exit(violations.length > 0 ? 1 : 0)
