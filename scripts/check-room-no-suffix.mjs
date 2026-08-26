// 호실번호에 '호'를 손으로 붙이는 자리 감지 — 실행: node scripts/check-room-no-suffix.mjs
//
// 규칙은 lib/roomNo.ts 한 줄이다. **숫자로만 이루어진 호실번호에만 '호'를 붙인다.**
// 이 영업장에는 roomNo 가 '사무실'인 방이 있고, 등록 폼은 'A동-3'·'옥탑방'을 예시로 권한다.
// 무조건 붙이면 '사무실호'가 되는데 그건 방 이름이 아니다(운영자 지적 2026-08-26, 홈 알림).
//
// 2026-08-12 에 손사본 13벌을 정본으로 모았는데, 그 뒤로 다시 85곳이 규칙을 모르고 태어났다.
// 그중 다섯 곳은 인라인 판정(/^\d+$/.test)까지 베껴 놨다. 사람이 규칙을 기억하는 방식으로는
// 이 클래스가 안 닫힌다 — 태어나는 순간 걸리게 한다.
//
// 잡는 것 둘.
//   · `${식}호` · `{식}호` — 정본을 안 거치고 '호'를 잇는 자리.
//   · /^\d+$/.test(...) 곁의 '호' — 정본과 같은 식을 손으로 다시 적은 자리.
//
// 예외는 파일 단위로만 둔다(정본 자신, 문자 치환 자리표지).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['app', 'lib', 'components']
const ALLOW = new Set([
  'lib/roomNo.ts',            // 정본 자신
  'lib/tenantAddress.ts',     // 서류 인쇄용 정본(같은 규칙을 스스로 판정한다)
])
// '{호수}' 는 문자 치환 자리표지지 호실번호가 아니다.
const PLACEHOLDER = /\{'\{호수\}'\}호/

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (n === 'node_modules' || n.startsWith('.')) continue
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(n)) out.push(p)
  }
  return out
}

const hits = []
for (const root of ROOTS) {
  for (const f of walk(root)) {
    if (ALLOW.has(f)) continue
    const lines = readFileSync(f, 'utf8').split('\n')
    lines.forEach((line, i) => {
      const t = line.trim()
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
      const cleaned = line.replace(PLACEHOLDER, '')
      if (/\}호/.test(cleaned) && !/fmtRoomNo/.test(cleaned)) {
        hits.push({ f, n: i + 1, line: t.slice(0, 110) })
      } else if (/\/\^\\d\+\$\/\.test\(/.test(cleaned) && /호/.test(cleaned)) {
        hits.push({ f, n: i + 1, line: t.slice(0, 110) })
      }
    })
  }
}

console.log(`\n[호실번호 '호'] 위반 ${hits.length}건`)
for (const h of hits) console.log(`  ${h.f}:${h.n}  ${h.line}`)
if (hits.length > 0) {
  console.log(`\n  '호'는 lib/roomNo.ts 의 fmtRoomNo 가 붙인다. 숫자가 아닌 호실('사무실')에는 안 붙는다.`)
  process.exit(1)
}
