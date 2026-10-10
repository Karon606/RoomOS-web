// 보간한 값 뒤에 조사를 손으로 박는 자리 감지 — 실행: node scripts/check-korean-particle.mjs
//
// `${값}이` 처럼 조사를 고정으로 붙이면 값의 받침이 바뀌는 순간 틀린 말이 나간다. 서류 이름이
// '계약서'·'보증금 영수증'으로 갈려 '보증금 영수증를'이 실제로 나갔고, 호실명이 '사무실'이면
// '사무실는'이 나갈 자리가 여럿이었다(2026-10-10 전수 조사, 운영자 오더 '같은 클래스까지 전수').
// 사람이 받침을 기억하는 방식으로는 이 클래스가 안 닫힌다 — 태어나는 순간 걸리게 한다.
//
// 고치는 법은 정본 한 벌이다.
//   · 일반       lib/koParticle withParticle(값, '이/가' | '을/를' | '은/는' | '과/와' | '으로/로')
//   · 호실 방향  lib/roomNo roomNoWithRo(호실번호)
//
// 통과시키는 것 — 끝 글자가 언제나 같은 포매터 뒤의 **그 받침에 맞는** 조사만.
//   · fmtWon(…)                       '원'(ㄴ)  이·을·은·과·으로  (`import { fmtWon as won }` 같은 별칭도 같은 함수로 본다)
//   · monLabel(…) · targetMonthLabel(…)  '분'(ㄴ)  이·을·은·과·으로
//   · fmtDateKor(…)                   '일'(ㄹ, 괄호 요일은 앞말에 맞춘다)  이·을·은·과·로
// 같은 포매터라도 받침과 안 맞는 조사(`${fmtWon(x)}로`)는 그대로 걸린다.
//
// 그물은 주석을 안 본다 — 설명 글자가 걸리거나 통과시키지 않게 주석을 먼저 걷는다.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['app', 'components', 'lib']
const PATTERN = /\$\{[^}]*\}(이|가|을|를|은|는|과|와|으로|로)(?=[\s.,·?)]|$)/gm

const ALLOW = [
  { fn: /^fmtWon\(/, ok: ['이', '을', '은', '과', '으로'] },
  { fn: /^(monLabel|targetMonthLabel)\(/, ok: ['이', '을', '은', '과', '으로'] },
  { fn: /^fmtDateKor\(/, ok: ['이', '을', '은', '과', '로'] },
]

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (n === 'node_modules' || n.startsWith('.')) continue
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(n)) out.push(p)
  }
  return out
}

/** 주석을 걷되 줄 수는 지킨다 — 위반 행 번호가 원본과 맞아야 한다. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** 한 덩이 소스에서 위반 목록. */
function particleHits(src) {
  const code = stripComments(src)
  // 포매터를 별칭으로 들여온 파일(`import { fmtWon as won }`)은 별칭을 원래 이름으로 읽는다.
  // 별칭 하나 때문에 맞는 조사를 헬퍼로 감싸게 하면, 그 문장을 글자째 지키는 형제 그물이 깨진다.
  const alias = new Map([...code.matchAll(/\b(fmtWon|monLabel|targetMonthLabel|fmtDateKor)\s+as\s+(\w+)/g)].map(a => [a[2], a[1]]))
  const hits = []
  for (const m of code.matchAll(PATTERN)) {
    // `${a ? ` …${fmtWon(x)}` : ''}은` 처럼 겹친 보간은 마지막 `${` 가 조사 바로 앞 값이다.
    const head = m[0].slice(0, m[0].length - m[1].length)
    const raw = head.slice(head.lastIndexOf('${') + 2, -1).trim()
    const fn = raw.match(/^(\w+)\(/)?.[1]
    const expr = fn && alias.has(fn) ? `${alias.get(fn)}${raw.slice(fn.length)}` : raw
    if (ALLOW.some(a => a.fn.test(expr) && a.ok.includes(m[1]))) continue
    const line = code.slice(0, m.index).split('\n').length
    hits.push({ line, text: m[0] })
  }
  return hits
}

const all = []
for (const root of ROOTS) {
  for (const f of walk(root)) {
    for (const h of particleHits(readFileSync(f, 'utf8'))) all.push({ f, ...h })
  }
}
console.log(`\n[조사 고정 붙임] 위반 ${all.length}건`)
for (const h of all) console.log(`  ${h.f}:${h.line}  ${h.text}`)
if (all.length > 0) {
  console.log(`\n  조사는 값의 받침을 따라간다. lib/koParticle withParticle(값, '이/가') 로 붙이고,`)
  console.log(`  호실 방향 조사는 lib/roomNo roomNoWithRo 를 쓴다.`)
  process.exit(1)
}
