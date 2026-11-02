// 상세 셸 [수정] 편집 문 배선 감지(신고 352716da) — 실행: node scripts/check-edit-door-wiring.mjs
//
// 결함의 모양. 같은 페이지 안에서도 '?edit=1' 로 내비게이션했고, 목적지 훅은 대상 id 만 키로 들어 한 번 연 뒤
// 정리 신호를 놓치면 다음 [수정]을 건너뛰었다. 그사이 1.5초 상한 타이머가 상세 창만 닫아 '튕김'으로 보였다.
//
// 지키는 것.
//   ⓐ edit= 를 싣는 주소는 lib/editDoor 한 곳에서만 만든다(클릭마다 nonce). 다른 파일에 'edit=' 글자가 서면 위반.
//   ⓑ 목적지 훅(입주자·호실)은 shouldOpenEdit 로 판정하고(id:nonce 키), registerEditOpener 로 제자리 opener 를 건다.
//      edit 을 고정값('1')과 견주는 자리가 남으면 위반.
//   ⓒ 상세 셸의 [수정] 두 손잡이는 openEditDoor 를 거친다(제자리 opener 먼저, 없으면 nonce 주소).
//      openEditDoor 는 openEditInPlace 와 editHref 를 쓴다.
//   ⓓ 상세 셸의 상한 닫기 타이머는 5초 이상이고 언마운트 때 걷힌다(고정 짧은 setTimeout 닫기 재발 감지).
//
// 그물은 주석을 안 본다 — 설명 글자가 걸리거나 통과시키지 않게 주석을 먼저 걷는다.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DOOR = 'lib/editDoor.ts'
const MODAL = 'components/entity-modal/EntityModal.tsx'
const DESTS = ['app/(app)/tenants/TenantClient.tsx', 'app/(app)/room-manage/RoomManageClient.tsx']

const strip = src => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

function blockAfter(src, anchor) {
  const at = src.indexOf(anchor)
  if (at < 0) return null
  const open = src.indexOf('{', at + anchor.length - 1)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open, i + 1) }
  }
  return null
}

const errs = []

// ⓐ edit= 주소 생산자 전수
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (f === 'node_modules' || f.startsWith('.')) continue
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx?|mjs)$/.test(f)) out.push(p)
  }
  return out
}
for (const p of [...walk('app'), ...walk('components'), ...walk('lib')]) {
  if (p === DOOR) continue
  const src = strip(readFileSync(p, 'utf8'))
  src.split('\n').forEach((line, i) => {
    if (/[?&]edit=/.test(line)) errs.push(`ⓐ ${p}:${i + 1} edit= 주소는 lib/editDoor editHref 로만 만든다 :: ${line.trim().slice(0, 120)}`)
  })
}
const door = strip(readFileSync(DOOR, 'utf8'))
if (!/edit=\$\{n\}/.test(door) || !/editNonce\(\)/.test(door)) errs.push('ⓐ lib/editDoor editHref 가 nonce 를 싣지 않는다')

// ⓑ 목적지 훅
for (const p of DESTS) {
  const src = strip(readFileSync(p, 'utf8'))
  if (!/shouldOpenEdit\(/.test(src)) errs.push(`ⓑ ${p} 목적지 훅이 shouldOpenEdit 로 판정하지 않는다`)
  if (!/registerEditOpener\(/.test(src)) errs.push(`ⓑ ${p} 제자리 opener(registerEditOpener)가 없다`)
  if (/get\('edit'\)\s*[!=]==?\s*'1'/.test(src)) errs.push(`ⓑ ${p} edit 을 고정값 '1' 과 견준다`)
}

// ⓒ 상세 셸 손잡이
const modal = strip(readFileSync(MODAL, 'utf8'))
for (const h of ['const handleEditRoom = () =>', 'const handleEditTenant = () =>']) {
  const body = blockAfter(modal, h)
  if (!body) { errs.push(`ⓒ ${MODAL} ${h} 를 못 찾음`); continue }
  if (!/openEditDoor\(/.test(body)) errs.push(`ⓒ ${MODAL} ${h} 가 openEditDoor 를 거치지 않는다`)
  if (/navigateThenClose\(/.test(body)) errs.push(`ⓒ ${MODAL} ${h} 가 내비게이션을 직접 부른다(제자리 opener 를 건너뜀)`)
}
const doorFn = blockAfter(modal, 'const openEditDoor = (')
if (!doorFn) errs.push(`ⓒ ${MODAL} openEditDoor 를 못 찾음`)
else {
  const inPlace = doorFn.indexOf('openEditInPlace(')
  const nav = doorFn.indexOf('navigateThenClose(')
  if (inPlace < 0 || nav < 0 || inPlace > nav) errs.push(`ⓒ ${MODAL} openEditDoor 는 openEditInPlace 를 먼저 보고 나서 이동해야 한다`)
  if (!/editHref\(/.test(doorFn)) errs.push(`ⓒ ${MODAL} openEditDoor 가 editHref(nonce) 를 쓰지 않는다`)
}

// ⓓ 상한 닫기 타이머
const nav = blockAfter(modal, 'const navigateThenClose = (')
if (!nav) errs.push(`ⓓ ${MODAL} navigateThenClose 를 못 찾음`)
else {
  const cap = modal.match(/NAV_CLOSE_CAP_MS\s*=\s*(\d+)/)
  if (!cap || Number(cap[1]) < 5000) errs.push(`ⓓ ${MODAL} 상한(NAV_CLOSE_CAP_MS)이 5초 미만이거나 없다`)
  if (/setTimeout\([\s\S]*?,\s*\d+\s*\)/.test(nav)) errs.push(`ⓓ ${MODAL} navigateThenClose 안에 고정 숫자 setTimeout 닫기가 있다`)
  if (!/clearTimeout\(capTimer\.current\)/.test(modal.replace(nav, ''))) errs.push(`ⓓ ${MODAL} 언마운트 때 상한 타이머를 걷지 않는다`)
}

console.log(`[편집 문 배선] 축 ⓐ edit= 생산자 한 곳 · ⓑ 목적지 nonce 키·제자리 opener · ⓒ 셸 손잡이 · ⓓ 상한 타이머 / 위반 ${errs.length}건`)
if (errs.length) { for (const e of errs) console.error('  ' + e); process.exit(1) }
