// 오프셋 없는 '일시'(날짜+시각) 문자열과 로컬 시각 게터를 잡는 감지망.
//
// 왜 있나 (신고 54bce9c5, 2026-08-10)
//   입실 문의 시각을 고치면 저장할 때마다 9시간씩 뒤로 밀렸다. 폼은 "2026-08-05T14:46"
//   처럼 오프셋 없는 문자열(= 사용자가 본 KST)을 보내는데 서버(UTC)의 new Date() 가 그것을
//   UTC 로 읽어 저장하고, 화면은 기기(KST) 로컬 게터로 읽어 +9h 로 보여준다. 그 부풀린 값이
//   폼에 프리필돼 다시 저장되니 **저장할 때마다 9시간이 누적되는 래칫**이 됐다.
//
// 정본은 lib/kstDate.ts — 쓰기 kstDateTimeToUtc(ymd, hm) · 읽기 splitKstDateTime(d).
// 짝을 맞춰 쓰면 실행 환경 타임존과 무관하게 서버·기기가 같은 시각을 낸다.
//
// 형제 감지망: check-ssr-local-now.mjs 는 '오늘'(날짜)을, 이 파일은 '몇 시 몇 분'(시각)을 본다.
//
// 무엇을 보나
//   a) 시각 성분이 있는데 오프셋이 없는 문자열이 new Date() · Date.parse() 로 들어가는 자리.
//      날짜 전용 자정(T00:00:00 · T00:00:00Z · T00:00:00.000Z)은 화이트리스트 — 날짜만 뜻하는 관행이다.
//   a2) 폼이 보낸 일시 필드(formData.get('...At'))를 그대로 new Date() 로 파싱하는 자리.
//      이번 신고의 발화 지점이라 이름 기반으로 한 겹 더 건다.
//   b) Date 에서 로컬 시각 성분(getHours·getMinutes·getSeconds)을 뽑는 자리.
//      DB 에서 온 Date 는 UTC 로 들어 있어 서버·기기가 9시간 다른 값을 읽는다.
//
// 무엇을 안 보나
//   - lib/kstDate.ts 자신(정본이 +09:00 과 시프트를 직접 쓴다).
//   - +09:00 오프셋을 명시한 문자열, getUTC* 게터(정본이 쓰는 +9h 시프트 관행).

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCAN_DIRS = ['app', 'components', 'lib']
const SKIP_FILE = /(^|\/)lib\/kstDate\.ts$/

// 로컬 시각 게터가 정당한 자리 — '기기의 지금'이 곧 정답인 곳만 둔다(명단은 최소로 유지).
const LOCAL_TIME_ALLOW = [
  {
    file: 'components/theme/ThemeProvider.tsx',
    why: '기기 로컬 시각으로 라이트·다크를 정하는 자리 — 저장값이 아니라 사용자의 지금 낮/밤이다',
  },
]

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

// 날짜만 뜻하는 자정 — 'T00:00:00' · 'T00:00:00Z' · 'T00:00:00.000Z'
const DATE_ONLY_MIDNIGHT = /^T00:00:00(\.000)?Z?$/

function scan(rel, src) {
  const allowed = LOCAL_TIME_ALLOW.some(a => a.file === rel)
  const lines = src.split('\n')
  // 폼에서 꺼낸 일시 값(...At) -> 변수명. 이 변수를 new Date() 로 파싱하면 KST 가 UTC 로 저장된다.
  const formDateTimeVars = new Set()

  lines.forEach((raw, i) => {
    const line = raw.replace(/\/\/.*$/, '')
    const at = (rule) => hits.push({ file: rel, line: i + 1, rule, text: raw.trim() })

    const fv = line.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:formData|fd|form)\.get\(\s*['"`]([\w]*(?:At|DateTime))['"`]/)
    if (fv) formDateTimeVars.add(fv[1])

    // a) 오프셋 없는 일시 문자열 파싱
    for (const m of line.matchAll(/(?:new Date|Date\.parse)\(\s*([^)]*)\)?/g)) {
      const arg = m[1]
      if (/\+\s*09:?00/.test(arg)) continue                        // 오프셋 명시 — 정본 관행
      const times = [...arg.matchAll(/T(?:\$\{[^}]*\}|[\d:.]+Z?)/g)].map(t => t[0])
      if (times.length === 0) continue
      if (times.every(t => DATE_ONLY_MIDNIGHT.test(t))) continue   // 날짜 전용 자정
      at('오프셋 없는 일시 문자열(new Date/Date.parse)')
    }

    // a2) 폼이 보낸 일시 필드를 그대로 파싱
    for (const v of formDateTimeVars) {
      if (new RegExp(`(?:new Date|Date\\.parse)\\(\\s*${v}\\s*\\)`).test(line)) {
        at(`폼 일시 값 직접 파싱(${v})`)
      }
    }

    // b) 로컬 시각 성분 추출
    if (!allowed && /\.get(Hours|Minutes|Seconds)\(\)/.test(line)) at('로컬 시각 게터(getHours/getMinutes/getSeconds)')
  })
}

for (const d of SCAN_DIRS) walk(join(ROOT, d))

if (hits.length) {
  console.error('오프셋 없는 일시 문자열 · 로컬 시각 게터가 있습니다 (서버 UTC 와 기기 KST 가 9시간 갈립니다).')
  console.error('lib/kstDate.ts 의 kstDateTimeToUtc(ymd, hm) 로 저장하고 splitKstDateTime(d) 로 읽으세요.\n')
  for (const h of hits) console.error(`  ${h.file}:${h.line}  [${h.rule}]\n    ${h.text}`)
  console.error(`\n총 ${hits.length}건`)
  process.exit(1)
}

console.log(`check-naive-datetime: OK (오프셋 없는 일시·로컬 시각 게터 없음 · 허용 ${LOCAL_TIME_ALLOW.length}곳)`)
