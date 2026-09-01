// 사람 축 계약 조회가 `take: 1` 로 되돌아가는지 감시 — 읽기 전용, 위반 시 exit 1.
//
// 왜 소스를 보는가 (2026-08-13, 1인 다호실 시공 8단계 축 ⓑ).
//   한 사람이 방을 둘 쓰면 '그 사람의 계약'은 하나가 아니다. 그런데 사람 축 조회 열두 곳이
//   `leaseTerms: { take: 1 }` 로 계약을 잘라 읽고 있었고, 어느 쪽이 오는지는 조회마다 다른
//   정렬(createdAt desc · status asc · moveInDate desc · 정렬 없음)이 정했다. 같은 사람이
//   목록·검색·상세·시트에서 다른 계약으로 보이는 길이라 전부 걷고 primaryTenantLease 정본으로
//   바꿨다(3단계). 이 그물은 그 자리가 조용히 되돌아오는 것을 잡는다.
//
//   **데이터로는 못 잡는다.** 오늘 실데이터에는 계약이 둘인 고객이 0명이라 어떤 DB 검사도
//   통과한다. 잘못은 데이터가 아니라 코드의 모양에 있고, 발현은 601호 계약이 생기는 날이다.
//   그래서 모양만 본다 — check-server-action-exports 와 같은 종류의 그물이다.
//
// 방 축은 대상이 아니다. `room.leaseTerms` 를 하나로 자르는 것은 '이 방의 대표 계약'을 묻는
// 다른 질문이고, 거기엔 primaryRoomLease 라는 다른 정본이 있다.
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const ROOTS = ['app', 'components', 'lib']

// 의도적으로 하나만 읽는 자리 — 사람 축이지만 '메인 계약'을 묻는 질문이 아니다.
// 늘릴 때는 왜 메인 계약 질문이 아닌지를 여기 적는다.
const ALLOW = [
  // 퇴실자 시트는 '마지막 퇴실 계약' 한 줄이 곧 그 시트의 정의다(메인 계약을 묻지 않는다).
  { file: 'app/api/export/route.ts', needle: "status: { in: ['CHECKED_OUT', 'CANCELLED'] }" },
  // 목록의 '지금 사는 방' — 계약이 아니라 그 계약의 **열린 거주 구간**을 읽는다. 열린 구간은
  // 계약당 하나가 불변식이라 take: 1 이 자르는 게 아니라 정의다(2026-09-01, 위치 표기 통일).
  { file: 'app/(app)/tenants/actions.ts', needle: 'roomStays: { where: { endDate: null }, select: { room: { select: { roomNo: true, floor: true } } }, take: 1 }' },
]

const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (_, p) => p)

function walk(dir, out = []) {
  let entries
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(p)) out.push(p)
  }
  return out
}

/** `{` 에서 시작해 짝이 맞는 `}` 까지의 구간 끝 인덱스. 못 찾으면 -1. */
function blockEnd(src, open) {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) return i }
  }
  return -1
}

/**
 * 이 `leaseTerms:` 가 사람 축인가 — 앞쪽에서 가장 가까운 소유자 표식으로 판정한다.
 * `prisma.tenant.` · `tenant: {` 면 사람 축, `prisma.room.` · `room: {` · `prisma.leaseTerm.` 이면 아니다.
 */
function isTenantAxis(src, at) {
  const before = src.slice(0, at)
  const markers = [
    { re: /prisma\.tenant\./g, axis: 'tenant' },
    { re: /tenant:\s*\{/g, axis: 'tenant' },
    { re: /prisma\.room\./g, axis: 'room' },
    { re: /room:\s*\{/g, axis: 'room' },
    { re: /prisma\.leaseTerm\./g, axis: 'lease' },
  ]
  let best = { idx: -1, axis: null }
  for (const m of markers) {
    let hit
    m.re.lastIndex = 0
    while ((hit = m.re.exec(before)) !== null) {
      if (hit.index > best.idx) best = { idx: hit.index, axis: m.axis }
    }
  }
  return best.axis === 'tenant'
}

const files = ROOTS.flatMap(r => walk(r))
const violations = []
for (const file of files) {
  const raw = readFileSync(file, 'utf8')
  const src = strip(raw)
  let from = 0
  for (;;) {
    const at = src.indexOf('leaseTerms:', from)
    if (at === -1) break
    from = at + 1
    const open = src.indexOf('{', at)
    if (open === -1 || open > at + 40) continue
    const end = blockEnd(src, open)
    if (end === -1) continue
    const block = src.slice(open, end + 1)
    if (!/\btake:\s*1\b/.test(block)) continue
    if (!isTenantAxis(src, at)) continue
    // 존재 확인용 조회(select 가 id 하나뿐)는 '어느 계약인가'를 묻지 않는다 — some 과 같은 뜻이다.
    if (/select:\s*\{\s*id:\s*true\s*\}/.test(block)) continue
    if (ALLOW.some(a => file.endsWith(a.file) && block.includes(a.needle))) continue
    const line = src.slice(0, at).split('\n').length
    violations.push({ file, line })
  }
}

if (violations.length > 0) {
  console.error(`[사람 축 계약 잘림] 위반 ${violations.length}건 — 사람의 계약을 하나로 자르는 조회가 돌아왔다`)
  for (const v of violations) console.error(`  ${v.file}:${v.line}`)
  console.error("  조치: take 를 걷고 lib/leaseStatus 의 primaryTenantLease 로 메인 계약을 고른다.")
  console.error('  의도적으로 하나만 읽는 자리면 이 스크립트의 ALLOW 에 이유와 함께 등재한다.')
  process.exit(1)
}
console.log(`[사람 축 계약 잘림] 파일 ${files.length}개 검사 · 허용 ${ALLOW.length}건 / 위반 0건`)
