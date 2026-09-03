// 포커스 링이 다크에서 안 보이는 색으로 되돌아가는 것을 잡는 감지망. 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가. `--coral`(#a03c2e)은 다크 카드 표면(#1A130E) 위에서 **2.78:1** 이라 WCAG 1.4.11
// (비텍스트 3:1)에 못 미친다. 정본 처방은 `--tc-text` 이고 globals.css 482~512 가 그 판정을
// 이미 적어 두었는데, 앱 코드 45곳이 여전히 --coral·--persimmon 을 쓰고 있었다(2026-09-03 전수).
//
// **라이트는 한 픽셀도 안 바뀐다** — `--tc-text` 는 라이트에서 `var(--coral)` 그대로이고
// 다크에서만 #C9614C 로 밝아진다(§19 페어). 그래서 이 치환은 언제나 안전하고, 되돌릴 이유가 없다.
//
//   ⓐ focus·focus-visible 아웃라인·링 색에 --coral·--persimmon 이 오지 않는다.
//   ⓑ hover 는 대상이 아니다 — WCAG 필수 지시자가 아니고, 라이트에서 두 상태 색이 같아지면
//      오프셋이 그 몫을 진다(globals.css 주석의 판정 그대로).
//
// 실행: node scripts/check-focus-ring-token.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const walk = (dir, out) => {
  let names
  try { names = readdirSync(dir) } catch { return out }
  for (const name of names) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { walk(full, out); continue }
    if (/\.tsx?$/.test(name)) out.push(full)
  }
  return out
}
const strip = s => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')

// `focus:` 접두사도 같은 축이다 — 마우스 클릭에도 링을 세우려는 의도적 접두사일 뿐 색 판정은
// 같다. 첫 판이 focus-visible 만 봐서 6곳이 치환과 그물을 동시에 비껴갔고, 한 폼 안에서 날짜칸과
// 입력칸의 다크 링 색이 갈렸다(디자이너 지적 2026-09-03).
//
// **보더 축은 대상이 아니다.** §12 가 `--input-border-focus: var(--tc)` 를 문면으로 정본화했고,
// 입력 배경이 --canvas(다크 #000)라 코랄 보더는 3.18:1 로 3:1 을 넘는다. 260곳이 그 규칙대로 서 있다.
const BAD = /focus(?:-visible)?:(?:outline|ring)-\[(?:color:)?var\(--(?:coral|persimmon)\)\]/
const violations = []
const files = walk('app', walk('components', []))
for (const f of files) {
  strip(readFileSync(f, 'utf8')).split('\n').forEach((line, i) => {
    if (BAD.test(line)) {
      violations.push(`${f}:${i + 1} 포커스 링이 --coral 이다. 다크 카드 위 2.78:1 로 WCAG 3:1 미달 — --tc-text 를 쓴다(라이트 값은 같다).`)
    }
  })
}

console.log(`[포커스 링 토큰] ${files.length}파일 검사 / 위반 ${violations.length}건`)
for (const v of violations.slice(0, 15)) console.error(`  - ${v}`)
if (violations.length > 15) console.error(`  ... 외 ${violations.length - 15}건`)
process.exit(violations.length > 0 ? 1 : 0)
