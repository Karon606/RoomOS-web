// --sand 를 글자색으로 쓰는 자리를 잡는 감지망 — 읽기 전용, 위반 시 exit 1.
//
// --sand 는 라이트에서 #F2D9B8(웜 페일 배경)이고 다크에서는 보조 버튼 hover 표면(#332619)으로 뒤집힌다. 어두운 면 위 밝은 강조
// 글자로 쓰면 다크에서 사라진다(2026-11-03, 선택 알약 카운트 1.11:1 · 마케팅 방문자 카드 1.25:1). 모드 불변 강조 글자는
// --on-solid-accent 다(globals.css 주석, §15 토스트 액션과 같은 처리). 바탕(bg-·background)으로 쓰는 것은 그대로 된다.
//
// 실행: node scripts/check-sand-text.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const walk = p => readdirSync(p).flatMap(n => { const f = join(p, n); return statSync(f).isDirectory() ? walk(f) : /\.(tsx|ts|css)$/.test(f) ? [f] : [] })
const violations = []
for (const f of [...walk('app'), ...walk('components')]) {
  const lines = readFileSync(f, 'utf8').split('\n')
  lines.forEach((l, i) => {
    // 글자·선 자리만: Tailwind text-[var(--sand)] · text-[color:var(--sand)] · text-sand · fill-sand · stroke-sand(뒤에 -2 같은 꼬리가 없는 낱말), 인라인 color: 'var(--sand)', CSS color: var(--sand)
    if (/\btext-\[(?:color:)?var\(--sand\)\]|\b(?:text|fill|stroke)-sand(?![-\w])|(?<![-\w])color:\s*['"]?var\(--sand\)/.test(l)) violations.push(`${f}:${i + 1}: --sand 를 글자색으로 쓴다. 다크에서 #332619 로 뒤집혀 사라진다(--on-solid-accent 를 쓸 것)`)
  })
}
console.log(`[--sand 글자색] 위반 ${violations.length}건`)
for (const v of violations) console.log('  - ' + v)
process.exit(violations.length ? 1 : 0)
