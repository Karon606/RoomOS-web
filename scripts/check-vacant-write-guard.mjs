// 방을 공실로 쓰는 자리가 점유 확인 뒤에서만 쓰는지 감시하는 소스 그물 — 읽기 전용, 위반 시 exit 1.
//
// 왜 소스를 보는가 (2026-10-01, 513호).
//   퇴실 부수 처리 정본(applyCheckoutSideEffects)이 isVacant: true 를 점유 확인 없이 무조건 썼다.
//   10/5 입주 예약이 걸린 513호가 퇴실 처리 한 번에 공실이 됐고, 홈 공실 수·타일·배치도·입주자 폼
//   '(공실)'·웹사이트 '올릴 방' 권유가 함께 틀어졌다. 엑셀 가져오기 보관 경로도 같은 무가드 쓰기를
//   들고 있었다. DB 감시(check-wish-match-drift 축 1)는 사고가 난 뒤에야 울린다. 잘못은 코드의
//   모양에 있으므로 모양을 본다.
//
// 규칙: prisma(또는 tx)의 room 갱신(update·updateMany·upsert)이 data 에 isVacant 를 false 가 아닌 값
//   (true 또는 변수·식)으로 쓰면, 같은 최상위 함수 안에서 그 쓰기 앞 WINDOW 줄 안에 점유 정본
//   (lib/roomOccupancy 의 roomStillOccupied) 호출이 있어야 한다.
//   신규 생성(room.create)은 대상이 아니다. 계약이 하나도 없는 새 방이라 비어 있는 것이 사실이다.
//
// 못 보는 것: data 객체를 변수로 먼저 만들어 넘기는 쓰기, 스냅샷 필드를 통째로 되돌리는 적용취소.
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const ROOTS = ['app', 'lib']
const WINDOW = 15

// 점유 정본 대신 자기 확인을 쓰는 자리 — 늘릴 때는 왜 정본으로 못 바꾸는지를 여기 적는다.
const ALLOW = [
  // 입주자 삭제. 그 사람의 계약 전부가 함께 사라지므로 '계약 하나 제외'인 정본으로는 못 묻고
  // tenantId 로 뺀다. 남은 계약에 비거주까지 세어 정본보다 엄격하다(공실로 덜 쓴다).
  { file: 'app/(app)/tenants/actions.ts', fn: 'deleteTenant', needle: "tenantId: { not: tenantId }, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] }" },
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

/** at 을 감싸는 가장 안쪽의 열린 `{` 인덱스. 못 찾으면 -1. */
function enclosingOpen(src, at) {
  let depth = 0
  for (let i = at - 1; i >= 0; i--) {
    if (src[i] === '}') depth++
    else if (src[i] === '{') { if (depth === 0) return i; depth-- }
  }
  return -1
}

/** at 앞에서 가장 가까운 최상위 함수 선언 — { name, idx }. */
function enclosingTopFn(src, at) {
  const re = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm
  let best = { name: null, idx: 0 }
  let m
  while ((m = re.exec(src)) !== null && m.index < at) best = { name: m[1], idx: m.index }
  return best
}

const files = ROOTS.flatMap(r => walk(r))
const violations = []
let writes = 0
let allowed = 0
for (const file of files) {
  const src = strip(readFileSync(file, 'utf8'))
  const re = /\bisVacant\s*:\s*([^,}\n]+)/g
  let m
  while ((m = re.exec(src)) !== null) {
    const value = m[1].trim()
    if (value === 'false') continue
    const open = enclosingOpen(src, m.index)
    if (open === -1) continue
    // data: { ... } 안이어야 쓰기다. select·where·반환 객체는 읽기다.
    if (!/\bdata\s*:\s*$/.test(src.slice(Math.max(0, open - 20), open))) continue
    // 어느 모델의 어느 연산인가 — data 앞에서 가장 가까운 prisma/tx 호출.
    const before = src.slice(0, open)
    const calls = [...before.matchAll(/\b(?:prisma|tx|db)\.(\w+)\.(\w+)\(/g)]
    const call = calls[calls.length - 1]
    if (!call || call[1] !== 'room') continue
    if (call[2] === 'create' || call[2] === 'createMany') continue
    writes++
    const fn = enclosingTopFn(src, m.index)
    const line = src.slice(0, m.index).split('\n').length
    const fnBody = src.slice(fn.idx, m.index)
    const allow = ALLOW.find(a => file.endsWith(a.file) && a.fn === fn.name && fnBody.includes(a.needle))
    if (allow) { allowed++; continue }
    const lines = src.split('\n')
    const fnStartLine = src.slice(0, fn.idx).split('\n').length
    const from = Math.max(fnStartLine, line - WINDOW)
    const windowText = lines.slice(from - 1, line).join('\n')
    if (!/\broomStillOccupied\(/.test(windowText)) {
      violations.push({ file, line, fn: fn.name, value })
    }
  }
}

if (violations.length > 0) {
  console.error(`[공실 쓰기 가드] 위반 ${violations.length}건 — 점유 확인 없이 방을 공실로 쓴다`)
  for (const v of violations) console.error(`  ${v.file}:${v.line} (${v.fn ?? '?'}) isVacant: ${v.value}`)
  console.error('  조치: 쓰기 바로 앞에서 lib/roomOccupancy 의 roomStillOccupied(roomId, 자기 계약 id) 로 묻고')
  console.error('        isVacant: !occupied 로 쓴다. 다음 입실 예약이 걸린 방이 공실로 덮인다(513호, 2026-10-01).')
  console.error('  정본으로 못 묻는 자리면 이 스크립트의 ALLOW 에 이유와 함께 등재한다.')
  process.exit(1)
}
console.log(`[공실 쓰기 가드] 파일 ${files.length}개 · 공실 쓰기 ${writes}곳 검사 · 허용 ${allowed}건 / 위반 0건`)
