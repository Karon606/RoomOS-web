// 루프 안 조회(N+1) 재발 감지 — 홈 대시보드·재고 개요가 다시 품목·구간마다 왕복하지 않게 세운 그물.
//
// 배경: 재고 개요가 품목 28 × 구간 최대 80 × 3회 = 렌더 한 번에 약 2,300 쿼리였다(2026-09-11 실측).
// 계산 결과는 맞았으므로 어떤 대조 검사도 이것을 잡지 못했다 — 모양을 보는 그물이 따로 필요하다.
//
// 규칙: 아래 파일들에서 루프(for · .map(async · forEach) 안에 `await prisma` 또는 `sum*(` 호출이
// 하나라도 있으면 실패. 주석은 걷고 본다(주석 속 예시 코드에 걸리지 않게).
import fs from 'node:fs'

const TARGETS = [
  'app/(app)/inventory/overview.ts',
  'app/(app)/dashboard/page.tsx',
  'app/(app)/dashboard/getDashboardData.ts',
]

// 문자열·템플릿 리터럴 안의 // 를 주석으로 오인하지 않도록 상태를 들고 걷는다.
// 걷어낸 자리는 공백으로 채워 오프셋(줄 번호)을 보존한다.
function stripComments(src) {
  let out = ''
  let i = 0
  let state = 'code'   // code | line | block | sq | dq | tpl
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; out += '  '; i += 2; continue }
      if (c === '/' && n === '*') { state = 'block'; out += '  '; i += 2; continue }
      if (c === "'") state = 'sq'
      else if (c === '"') state = 'dq'
      else if (c === '`') state = 'tpl'
      out += c; i++; continue
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c } else out += ' '
      i++; continue
    }
    if (state === 'block') {
      if (c === '*' && n === '/') { state = 'code'; out += '  '; i += 2; continue }
      out += c === '\n' ? c : ' '
      i++; continue
    }
    // 문자열 안 — 이스케이프만 건너뛴다.
    if (c === '\\') { out += c + (n ?? ''); i += 2; continue }
    if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) state = 'code'
    out += c; i++
  }
  return out
}

// start 위치의 여는 괄호부터 짝이 맞는 닫는 괄호까지의 끝 인덱스. 못 찾으면 -1.
function matchFrom(src, start, open, close) {
  let depth = 0
  for (let i = start; i < src.length; i++) {
    if (src[i] === open) depth++
    else if (src[i] === close) { depth--; if (depth === 0) return i }
  }
  return -1
}

const QUERY_RE = /await\s+prisma\b|\bsum[A-Z]\w*\s*\(/g

function lineOf(src, idx) {
  return src.slice(0, idx).split('\n').length
}

function scan(file) {
  const raw = fs.readFileSync(file, 'utf8')
  const src = stripComments(raw)
  const hits = []

  const bodies = []
  // for (...) { ... }  — of·in·고전형 모두
  for (const m of src.matchAll(/\bfor\s*\(/g)) {
    const parenEnd = matchFrom(src, m.index + m[0].length - 1, '(', ')')
    if (parenEnd < 0) continue
    const braceStart = src.indexOf('{', parenEnd)
    if (braceStart < 0) continue
    // 여는 중괄호가 바로 뒤가 아니면 한 줄짜리 본문 — 그 줄만 본다.
    if (src.slice(parenEnd + 1, braceStart).trim() !== '') {
      const nl = src.indexOf('\n', parenEnd)
      bodies.push({ kind: 'for', from: parenEnd, to: nl < 0 ? src.length : nl })
      continue
    }
    const braceEnd = matchFrom(src, braceStart, '{', '}')
    if (braceEnd < 0) continue
    bodies.push({ kind: 'for', from: braceStart, to: braceEnd })
  }
  // .map(async ... )  /  .forEach( ... )
  for (const m of src.matchAll(/\.map\s*\(\s*async\b|\.forEach\s*\(/g)) {
    const parenIdx = src.indexOf('(', m.index)
    const end = matchFrom(src, parenIdx, '(', ')')
    if (end < 0) continue
    bodies.push({ kind: m[0].includes('forEach') ? 'forEach' : 'map(async', from: parenIdx, to: end })
  }

  for (const b of bodies) {
    const body = src.slice(b.from, b.to)
    QUERY_RE.lastIndex = 0
    let q
    while ((q = QUERY_RE.exec(body)) !== null) {
      hits.push({
        file,
        line: lineOf(src, b.from + q.index),
        loop: b.kind,
        what: q[0].trim(),
      })
    }
  }
  return hits
}

let failed = 0
for (const f of TARGETS) {
  if (!fs.existsSync(f)) {
    console.error(`FAIL  대상 파일이 없다: ${f}`)
    failed++
    continue
  }
  const hits = scan(f)
  if (hits.length === 0) {
    console.log(`OK    ${f} — 루프 안 조회 0`)
    continue
  }
  failed += hits.length
  for (const h of hits) {
    console.error(`FAIL  ${h.file}:${h.line} — ${h.loop} 안에서 ${h.what}`)
  }
}

if (failed > 0) {
  console.error(`\n루프 안 조회 ${failed}건. 일괄 조회 후 메모리 합산으로 바꿔라(선례: app/(app)/inventory/overview.ts 의 sumPurchasesMem·sumLedgerMem).`)
  process.exit(1)
}
console.log('루프 안 조회 없음.')
