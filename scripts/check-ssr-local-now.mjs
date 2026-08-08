// SSR 되는 화면 코드가 '오늘'을 런타임 로컬시각으로 만드는 자리를 잡는 감지망.
//
// 왜 있나 (신고 d4bd3aa5·9c09ca50, 2026-08-08 KST 01:13)
//   Vercel 서버는 UTC, 기기는 KST 다. new Date() 로 오늘을 만들면 KST 00~09 시 창에서
//   서버와 기기가 하루 다른 오늘을 본다. 퇴실일 8/19 가 서버 D-11 · 기기 D-10 으로 갈렸고,
//   그 텍스트 불일치가 React #418 하이드레이션 오류로 올라왔다.
//   같은 함정이 월 컨트롤(매월 1일 새벽 서버 8월 / 기기 9월)에도 잠복해 있었다.
//
// 정본은 lib/kstDate.ts — kstYmdStr() · kstMonthStr() · kstYmd() · kstDaysUntil().
// Intl Asia/Seoul 로 뽑으므로 실행 환경 타임존과 무관하게 서버·클라가 같은 값을 낸다.
//
// 무엇을 보나 (하이드레이션이 갈릴 수 있는 자리만)
//   1) 오늘 자정  — new Date().setHours(0…)  /  const t = new Date(); t.setHours(0…)
//   2) 오늘의 월  — `${new Date().getFullYear()}-${String(new Date().getMonth()+1)…}`
//   3) 오늘의 날짜 문자열 — new Date().toISOString().slice(0, 10)
//
// 무엇을 안 보나
//   - page.tsx · layout.tsx · route.ts · actions.ts 등 서버 전용 파일. 한 번만 렌더되니
//     하이드레이션이 갈리지 않는다(대신 UTC 로 오늘을 재는 별개 결함은 남는다 — 이 그물의 몫이 아니다).
//   - lib/kstDate.ts 자신.
//   - Date 를 '지금 시각'이 아니라 타임스탬프로 쓰는 자리(new Date().toISOString() 전체 등).

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCAN_DIRS = ['app', 'components', 'lib']
// 서버 전용 파일 — 하이드레이션 대상이 아니다.
const SERVER_ONLY = /(^|\/)(page|layout|route|actions|opengraph-image|icon|sitemap|robots)\.(ts|tsx)$/
const SKIP_FILE = /(^|\/)lib\/kstDate\.ts$/

/** @type {{file:string,line:number,rule:string,text:string}[]} */
const hits = []

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) { walk(p); continue }
    if (!/\.tsx?$/.test(name)) continue
    const rel = relative(ROOT, p).split('\\').join('/')
    if (SERVER_ONLY.test(rel) || SKIP_FILE.test(rel)) continue
    const src = readFileSync(p, 'utf8')
    // 'use server' 이거나 prisma 를 실제로(타입 말고) 들여오는 모듈은 서버에서만 돈다 — 하이드레이션 대상이 아니다.
    if (/^\s*['"]use server['"]/m.test(src)) continue
    if (/^import\s+(?!type\b)[^\n]*from\s+['"]@?\/?lib\/prisma['"]/m.test(src)) continue
    scan(rel, src)
  }
}

function scan(rel, src) {
  const lines = src.split('\n')
  // `const x = new Date()` 로 만든 변수 -> 선언 줄 번호.
  // 선언 직후(같은 줄 또는 다음 줄)의 x.setHours(0…) 만 '오늘 자정'이다. 그 사이에 setMonth·setDate 로
  // 다른 날로 옮겼으면 이미 '오늘'이 아니다(재고 overview 의 '7개월 전 1일 자정' 오탐 제거).
  const nowVars = new Map()
  lines.forEach((raw, i) => {
    const line = raw.replace(/\/\/.*$/, '')
    const at = (rule) => hits.push({ file: rel, line: i + 1, rule, text: raw.trim() })

    const m = line.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new Date\(\s*\)\s*(;|$)/)
    if (m) nowVars.set(m[1], i)

    // 1) 오늘 자정
    if (/new Date\(\s*\)\s*\.setHours\(\s*0/.test(line)) at('오늘 자정(new Date().setHours)')
    else for (const [v, declLine] of [...nowVars]) {
      if (new RegExp(`\\b${v}\\.set(Month|Date|FullYear|Time|UTC)`).test(line)) { nowVars.delete(v); continue }
      if (i - declLine <= 1 && new RegExp(`\\b${v}\\.setHours\\(\\s*0`).test(line)) { at('오늘 자정(로컬 now 변수.setHours)'); break }
    }

    // 2) 오늘의 월 문자열
    if (/new Date\(\s*\)\.getFullYear\(\)[\s\S]{0,40}new Date\(\s*\)\.getMonth\(\)/.test(line)) at('오늘의 월(new Date().getFullYear/getMonth)')

    // 3) 오늘의 날짜 문자열
    if (/new Date\(\s*\)\.toISOString\(\)\.(slice|substring|substr)\(\s*0\s*,\s*(7|10)\s*\)/.test(line)) at('오늘의 날짜(new Date().toISOString().slice)')
  })
}

for (const d of SCAN_DIRS) walk(join(ROOT, d))

if (hits.length) {
  console.error('SSR 화면 코드가 로컬 시각으로 오늘을 만듭니다 (React #418 하이드레이션 함정).')
  console.error('lib/kstDate.ts 의 kstYmdStr() · kstMonthStr() · kstYmd() · kstDaysUntil() 로 바꾸세요.\n')
  for (const h of hits) console.error(`  ${h.file}:${h.line}  [${h.rule}]\n    ${h.text}`)
  console.error(`\n총 ${hits.length}건`)
  process.exit(1)
}

console.log('check-ssr-local-now: OK (SSR 화면 코드에 로컬 오늘 없음)')
