// 앱 코드가 '오늘'을 런타임 로컬시각으로 만드는 자리를 잡는 감지망.
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
// 서버 전용 파일도 본다 (2026-08-09 확대)
//   처음에는 page·layout·route·actions 와 'use server'·prisma 모듈을 제외했다 — 한 번만
//   렌더되니 하이드레이션이 갈리지 않기 때문이다. 그러나 갈리지 않을 뿐 **판정 자체가 하루
//   어긋난다**. 예약 임대료 적용(applyScheduledRents)이 적용일 당일 아침 9시까지 안 걸렸고,
//   연체일이 월초 새벽에 29일로 나왔으며, AI 월 한도가 매월 1일 9시간 일찍 리셋됐다.
//   서비스가 한국 전용이라 **서버에서 UTC 자정이 정당한 자리는 없다** — '오늘'은 언제나 KST 다.
//   순간 시각(생성 시각, N개월 전 구간 계산 등)은 아래 서명에 걸리지 않으므로 오탐이 아니다.
//
// 무엇을 보나
//   1) 오늘 자정  — new Date().setHours(0…)  /  const t = new Date(); t.setHours(0…)
//   2) 오늘의 월  — `${new Date().getFullYear()}-${String(new Date().getMonth()+1)…}` 과 그 변수형
//   3) 오늘의 날짜 문자열 — new Date().toISOString().slice(0, 7|10) 과 그 변수형
//   4) 오늘의 연/월/일 — new Date().getFullYear() / .getMonth() / .getDate()
//
// 무엇을 안 보나
//   - lib/kstDate.ts 자신.
//   - Date 를 '지금 시각'이 아니라 타임스탬프로 쓰는 자리(new Date().toISOString() 전체,
//     new Date(x) 로 저장값을 파싱하는 자리, 선언 뒤 setMonth·setDate 로 다른 날로 옮긴 변수).

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCAN_DIRS = ['app', 'components', 'lib']
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
    if (SKIP_FILE.test(rel)) continue
    scan(rel, readFileSync(p, 'utf8'))
  }
}

function scan(rel, src) {
  const lines = src.split('\n')
  // `const x = new Date()` 로 만든 변수 -> 선언 줄 번호.
  // 선언 직후(3줄 이내)의 x.setHours(0…) 만 '오늘 자정'이다. 그 사이에 setMonth·setDate 로
  // 다른 날로 옮겼으면 이미 '오늘'이 아니다(재고 overview 의 '7개월 전 1일 자정' 오탐 제거).
  const nowVars = new Map()
  lines.forEach((raw, i) => {
    const line = raw.replace(/\/\/.*$/, '')
    const at = (rule) => hits.push({ file: rel, line: i + 1, rule, text: raw.trim() })

    const m = line.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new Date\(\s*\)\s*(;|$)/)
    if (m) nowVars.set(m[1], i)

    // 1) 오늘 자정
    if (/new Date\(\s*\)\s*\.setHours\(\s*0/.test(line)) at('오늘 자정(new Date().setHours)')
    // 2~4) 로컬 now 변수에서 날짜 성분을 뽑는 자리
    for (const [v, declLine] of [...nowVars]) {
      if (i > declLine && new RegExp(`\\b${v}\\.set(Month|Date|FullYear|Time|UTC)`).test(line)) { nowVars.delete(v); continue }
      if (i - declLine > 3 || i < declLine) continue
      const V = `\\b${v}\\.`
      if (new RegExp(`${V}setHours\\(\\s*0`).test(line)) at('오늘 자정(로컬 now 변수.setHours)')
      if (new RegExp(`${V}toISOString\\(\\)\\.(slice|substring|substr)\\(\\s*0\\s*,\\s*(7|10)\\s*\\)`).test(line)) at('오늘의 날짜(로컬 now 변수.toISOString().slice)')
      if (new RegExp(`${V}getFullYear\\(\\)`).test(line) && /\.get(Month|Date)\(\)/.test(line)) at('오늘의 연월일(로컬 now 변수)')
    }

    // 2) 오늘의 월 문자열
    if (/new Date\(\s*\)\.getFullYear\(\)[\s\S]{0,40}new Date\(\s*\)\.getMonth\(\)/.test(line)) at('오늘의 월(new Date().getFullYear/getMonth)')

    // 3) 오늘의 날짜 문자열
    if (/new Date\(\s*\)\.toISOString\(\)\.(slice|substring|substr)\(\s*0\s*,\s*(7|10)\s*\)/.test(line)) at('오늘의 날짜(new Date().toISOString().slice)')

    // 4) 오늘의 연·월·일 단독 추출 — 달력 기본 뷰 연도가 연말 새벽에 지난해로 열리던 클래스(DatePicker).
    if (/new Date\(\s*\)\.get(FullYear|Month|Date)\(\)/.test(line)) at('오늘의 연·월·일(new Date().getFullYear/getMonth/getDate)')
  })
}

for (const d of SCAN_DIRS) walk(join(ROOT, d))

if (hits.length) {
  console.error("앱 코드가 로컬 시각으로 '오늘'을 만듭니다 (KST 00~09 시에 하루 어긋남 · React #418).")
  console.error('lib/kstDate.ts 의 kstYmdStr() · kstMonthStr() · kstYmd() · kstDaysUntil() 로 바꾸세요.\n')
  for (const h of hits) console.error(`  ${h.file}:${h.line}  [${h.rule}]\n    ${h.text}`)
  console.error(`\n총 ${hits.length}건`)
  process.exit(1)
}

console.log("check-ssr-local-now: OK (앱 코드에 로컬 '오늘' 없음)")
