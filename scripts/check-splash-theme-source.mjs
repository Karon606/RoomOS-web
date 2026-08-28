// 테마 판정 주체가 둘로 갈리는 것을 잡는 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 이 앱의 테마 주체는 html.dark 클래스 하나다(components/theme/ThemeProvider). 시작 화면과
// FOUC 방지 CSS 가 거기에 OS 미디어쿼리를 두 번째 주체로 얹고 있었다. 그러면 앱 테마가
// 라이트인데 기기 외관이 다크일 때 밝은 앱 위에 새까만 시작 화면이 뜬다(2026-08-28 진단).
// themeBootstrapScript 가 <head> 안에서 동기로 .dark 를 확정하므로 미디어쿼리가 지킬 창이 없다.
//
// 주체가 둘인 한 조합에 따라 반드시 갈린다. 그래서 케이스가 아니라 규칙으로 막는다.
//
// 실행: node scripts/check-splash-theme-source.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const TARGETS = ['components/brand', 'app/layout.tsx']
// 상태바 색은 OS 를 따라도 화면이 안 갈린다 — themeColor 는 페이지를 칠하지 않는다.
const ALLOW = /media: '\(prefers-color-scheme/

function files(p) {
  const st = statSync(p)
  if (st.isFile()) return [p]
  return readdirSync(p).flatMap(n => files(join(p, n))).filter(f => /\.(tsx?|css)$/.test(f))
}

const violations = []
let checked = 0
for (const t of TARGETS) {
  for (const f of files(t)) {
    checked++
    const src = readFileSync(f, 'utf8')
    src.split('\n').forEach((line, i) => {
      if (!line.includes('prefers-color-scheme')) return
      if (ALLOW.test(line)) return
      violations.push(`${f}:${i + 1} — 배경을 OS 외관으로 정한다. html.dark 하나만 보게 고칠 것`)
    })
  }
}

console.log(`[테마 주체] 파일 ${checked}개 검사 / 위반 ${violations.length}건`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error('  테마 판정 주체는 html.dark 하나다. 미디어쿼리를 더하면 앱과 시작 화면이 서로 다른 테마로 갈린다.')
  process.exit(1)
}
