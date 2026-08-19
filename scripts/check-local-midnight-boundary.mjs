// 로컬 자정 Date 를 '경계'로 쓰는 자리를 잡는 감지망.
//
// 왜 있나 (2026-08-19 날짜 경계 전역 수정)
//   `new Date(y, m - 1, 1)` 은 **실행 환경의 자정**이다. KST 기기에서 그것은 전날 15:00Z 이고,
//   @db.Date 비교는 UTC 날짜부만 보므로 창이 통째로 하루 앞으로 밀린다. 8월 창이
//   [7/31 .. 8/30] 이 되어 7/31 전기요금 1,040,980원이 8월 지출로 세어졌고 8/31 기록은
//   어느 달에도 안 잡혔다. Vercel(UTC)에서는 맞게 나오므로 **프로덕션에서만 맞는 코드**라
//   눈에 안 띄는 것이 이 결함의 성질이다 — 그래서 사람 눈이 아니라 감지망이 지켜야 한다.
//
//   in-JS 비교도 같은 모양이다. `d >= mStart && d <= mEnd` 를 로컬 자정으로 재면 말일
//   레코드가 양쪽 버킷에서 탈락한다(증발).
//
// 정본은 lib/kstDate.ts — 창은 monthDbRange · monthsDbRange · yearDbRange · dayDbRange,
// 월 귀속은 dbDateMonthKey. 끝은 lte 말일이 아니라 lt 다음 달 1일이다.
//
// 형제 감지망: check-ssr-local-now.mjs 는 '오늘'(날짜)을, check-naive-datetime.mjs 는
// '몇 시 몇 분'(시각)을, 이 파일은 '창의 양끝'(경계)을 본다.
//
// 무엇을 보나 — 인자가 둘 이상인 `new Date(y, m, d…)`(= 로컬 달력 Date)가
//   ⓐ Prisma 비교 키(gte·lte·lt·gt)의 값으로 바로 들어가는 자리
//   ⓑ 변수에 담긴 뒤 그 비교 키의 값이 되거나 부등호(>= <= > <) 비교에 쓰이는 자리
//
// 무엇을 안 보나
//   - lib/kstDate.ts 자신.
//   - new Date(Date.UTC(...)) — 바깥 인자가 하나라 애초에 안 걸린다(정본 관행).
//   - 달력 산술 전용 로컬 Date(월 문자열 만들기, 말일 세기 등) — 비교에 안 쓰이면 무해하다.
//   - 아래 ALLOW 에 사람 판단으로 등재한 자리.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCAN_DIRS = ['app', 'components', 'lib']
const SKIP_FILE = /(^|\/)lib\/kstDate\.ts$/

// 사람이 판단해 통과시킨 자리. line 이 아니라 **그 줄의 코드 조각**으로 건다 —
// 줄 번호는 무관한 편집에도 밀리고, 코드가 바뀌면 다시 판단해야 하기 때문이다.
const ALLOW = [
  {
    file: 'app/(app)/dashboard/page.tsx',
    code: 'const today = new Date(kst.year, kst.month - 1, kst.day)',
    why: "daysUntil — 같은 줄 아래에서 로컬 자정으로 만든 targetDay 와만 뺀다(로컬끼리라 상쇄)",
  },
  {
    file: 'app/(app)/dashboard/page.tsx',
    code: 'const today     = new Date(kstToday.year, kstToday.month - 1, kstToday.day)',
    why: '납부 예정일·요청 기한·소진 예상일의 in-JS 일수 계산 전용(전부 로컬 자정끼리). DB 창은 같은 k 에서 뽑은 todayDb 가 따로 맡는다',
  },
  {
    file: 'app/(app)/dashboard/page.tsx',
    code: 'const todayCopy = new Date(ty, tm - 1, td)',
    why: '연체일 계산 — 같은 함수 안에서 로컬 자정으로 만든 dueDate 와만 뺀다',
  },
  {
    file: 'app/(app)/dashboard/page.tsx',
    code: 'const today = new Date(ty, tm - 1, td)',
    why: '납부일 유예 경과일 — overrideAbsDate 가 만든 로컬 자정과만 뺀다',
  },
  {
    file: 'app/(app)/rooms/actions.ts',
    code: 'const todayKstEnd = new Date(kst.year, kst.month - 1, kst.day, 23, 59, 59, 999)',
    why: '단기 자동 퇴실 판정 상한 — KST 그날 끝은 UTC 로도 그날 안이라 날짜부가 안 밀린다',
  },
  {
    file: 'app/(app)/rooms/actions.ts',
    code: '{ payDate: { lte: new Date(yyyy, mm, 0, 23, 59, 59, 999) } },',
    why: "끝 경계만 있는 창 — KST·UTC 어느 쪽이든 그날 23:59 은 그날 안이라 날짜부가 안 밀린다",
  },
  {
    file: 'app/(app)/rooms/actions.ts',
    code: 'const dueDate = new Date(yyyy, mm - 1, Math.min(dueDay, new Date(yyyy, mm, 0).getDate()))',
    why: '지연납부 판정 — 바로 아래에서 23:59:59.999 로 늘려 그날 끝으로 쓴다(끝 경계만이라 무해)',
  },
  {
    file: 'app/api/calendar/[token]/route.ts',
    code: 'const thisMonthStart = new Date(ty, tm - 1, 1)',
    why: 'lib/dueDate resolveDueRaw 가 낸 로컬 자정과만 비교한다(로컬끼리라 상쇄)',
  },
  {
    file: 'lib/prorate.ts',
    code: 'const limit = new Date(y2, m2 - 1, Math.min(td, lastDay))',
    why: "isMoveOutNear — 같은 함수의 로컬 자정 mo 와만 비교한다(로컬끼리라 상쇄)",
  },
  {
    file: 'app/(app)/report/actions.ts',
    code: 'const monthStart = new Date(my, mm - 1, 1)',
    why: '입주·퇴실 월 판정 — 짝인 monthEnd 가 그날 끝(23:59:59.999)이라 KST·UTC 어느 쪽에서도 그 달 레코드를 정확히 담는다',
  },
  {
    file: 'app/(app)/report/actions.ts',
    code: 'const monthEnd = new Date(my, mm, 0); monthEnd.setHours(23, 59, 59, 999)',
    why: '위 monthStart 와 한 쌍 — 끝이 그날 끝이라 말일 입주가 안 잘린다',
  },
]

/** @type {{file:string,line:number,rule:string,text:string}[]} */
const hits = []
const usedAllow = new Set()

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

// 한 줄에서 `new Date(...)` 호출을 괄호 짝을 세어 찾는다. 인자에 top-level 쉼표가 있으면
// 로컬 달력 Date(y, m, d…) 다. new Date(Date.UTC(...)) 는 바깥 쉼표가 없어 걸리지 않는다.
function localCalendarDates(line) {
  const out = []
  const re = /new Date\(/g
  let m
  while ((m = re.exec(line)) !== null) {
    let depth = 1, i = m.index + m[0].length, comma = false
    let quote = null
    for (; i < line.length && depth > 0; i++) {
      const c = line[i]
      if (quote) { if (c === quote && line[i - 1] !== '\\') quote = null; continue }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue }
      if (c === '(' || c === '[' || c === '{') depth++
      else if (c === ')' || c === ']' || c === '}') depth--
      else if (c === ',' && depth === 1) comma = true
    }
    if (depth === 0 && comma) out.push({ start: m.index, end: i })
  }
  return out
}

const CMP_KEY = /\b(gte|lte|lt|gt)\s*:\s*$/

function scan(rel, src) {
  const lines = src.split('\n')
  const allowFor = ALLOW.filter(a => a.file === rel)
  // 로컬 달력 Date 가 담긴 변수 -> { 선언 줄, 그 자리의 중괄호 깊이 }.
  // 깊이가 선언 시점보다 얕아지면 그 블록을 벗어난 것이라 추적을 끝낸다 — 같은 이름의
  // 다른 변수(흔한 d·t)가 아래쪽 함수에서 오탐으로 잡히지 않게.
  const boundaryVars = new Map()
  let depth = 0

  lines.forEach((raw, i) => {
    const line = raw.replace(/\/\/.*$/, '')
    const trimmed = raw.trim()
    const depthBefore = depth
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length

    for (const [v, info] of boundaryVars) if (depthBefore < info.depth) boundaryVars.delete(v)

    const allow = allowFor.find(a => trimmed.includes(a.code))
    if (allow) { usedAllow.add(`${allow.file}::${allow.code}`); return }
    const at = (rule) => hits.push({ file: rel, line: i + 1, rule, text: trimmed })

    const checkVarUse = (v, text) => {
      const V = `\\b${v}\\b`
      if (new RegExp(`\\b(gte|lte|lt|gt)\\s*:\\s*${V}`).test(text)) {
        at(`Prisma 비교 경계에 로컬 자정 Date 변수(${v})`)
      } else if (new RegExp(`${V}\\s*(>=|<=|>|<)[^=]|(>=|<=|>|<)\\s*${V}`).test(text)) {
        at(`부등호 비교에 로컬 자정 Date 변수(${v})`)
      }
    }

    // 앞선 줄에서 선언된 경계 변수의 쓰임새
    for (const [v, info] of boundaryVars) if (info.line < i + 1) checkVarUse(v, line)

    for (const d of localCalendarDates(line)) {
      const before = line.slice(0, d.start)
      // ⓐ 비교 키에 바로 대입
      if (CMP_KEY.test(before)) { at('Prisma 비교 경계에 로컬 자정 Date'); continue }
      // ⓑ 변수에 담김 — 아래에서 쓰임새를 본다. Date 그 자체를 담은 경우만이다
      //    (`new Date(y, m, 0).getDate()` 처럼 숫자를 뽑아 담으면 경계가 아니다).
      const rest = line.slice(d.end)
      if (!/^\s*(;|$)/.test(rest)) continue
      const decl = before.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/)
      if (decl) boundaryVars.set(decl[1], { line: i + 1, depth: depthBefore, from: d.end })
    }

    // 같은 줄 뒤쪽에서 바로 쓰는 형태(`const s = new Date(...); const e = …; arr.filter(d => d >= s)`)
    for (const [v, info] of boundaryVars) if (info.line === i + 1) checkVarUse(v, line.slice(info.from))
  })
}

for (const d of SCAN_DIRS) walk(join(ROOT, d))

const stale = ALLOW.filter(a => !usedAllow.has(`${a.file}::${a.code}`))

if (hits.length || stale.length) {
  if (hits.length) {
    console.error('로컬 자정 Date 를 창의 경계로 쓰고 있습니다 (KST 기기에서 창이 하루 앞으로 밀립니다).')
    console.error('창은 lib/kstDate 의 monthDbRange · monthsDbRange · yearDbRange · dayDbRange 로,')
    console.error('월 귀속 비교는 dbDateMonthKey 로 바꾸세요.\n')
    for (const h of hits) console.error(`  ${h.file}:${h.line}  [${h.rule}]\n    ${h.text}`)
    console.error(`\n총 ${hits.length}건`)
  }
  if (stale.length) {
    console.error('\n허용 목록이 실제 코드와 안 맞습니다 — 그 자리가 바뀌었으니 다시 판단하세요.')
    for (const a of stale) console.error(`  ${a.file}  ${a.code}`)
  }
  process.exit(1)
}

console.log(`check-local-midnight-boundary: OK (창 경계에 로컬 자정 없음 · 허용 ${ALLOW.length}곳)`)
