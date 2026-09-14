// 호실을 떼는 저장 무회귀 그물 — 읽기 전용, 위반 시 exit 1.
//
// 왜 이 그물이 필요한가. updateTenant 는 호실을 `roomId || prevRoomId` 로 읽었다. 폼이 빈 값을
// 보내면 falsy 라 이전 방으로 되돌아갔고, 그대로 저장됐다 — 운영자가 "조건만 남기고 호실은 지웠다"
// 고 믿은 계약에 옛 호실이 계속 붙어 있었다(신고 c120bd32, 박효림 님 건, 잔존 8건).
// 같은 파일이 parentLeaseTermId·contractUrl·homeCountryContact 에서는 "undefined = 안 건드림,
// '' = 지움" 규약을 formData.has 가드로 지키는데 호실만 빠져 있었다.
//
// 데이터로는 못 잡는다 — 리드에 호실이 붙어 있는 것 자체는 위반이 아니다(문의 단계 배정은 계속
// 쓴다). 그래서 소스의 모양을 본다. 축은 셋이고 셋이 한 벌로 성립해야 한다.
//   축 ⓐ updateTenant 가 호실에 formData.has 가드를 쥐고 있는가.
//   축 ⓑ 폼이 name="roomId" 를 **조건 없이** 그리는가 — 조건부로 숨으면 가드가 거짓 보존이 된다.
//        (칸이 없는 저장은 '안 건드림'이 정답이므로, 칸을 숨기는 순간 그 화면은 방을 못 뗀다.)
//   축 ⓒ 희망 호실/조건 초기화가 newRoomId 진릿값을 함께 보는가 — 안 보면 방을 **떼는** 저장이
//        남기려던 희망 조건까지 지운다(신고를 고치려다 신고를 더 나쁘게 만드는 자리).
//
// 실행: node scripts/check-tenant-room-clear.mjs
import { readFileSync } from 'node:fs'

const ACTIONS = 'app/(app)/tenants/actions.ts'
const FORM    = 'app/(app)/tenants/TenantClient.tsx'

const violations = []
const fail = (axis, msg, fix) => violations.push({ axis, msg, fix })

const read = path => {
  try { return readFileSync(path, 'utf8') } catch { return null }
}

// 주석을 공백으로 지운다 — 설명하려고 적은 낱말이 그물에 걸리면 그물이 주석을 못 쓰게 만든다.
// 블록 주석은 주석으로만 읽히는 자리에서만 연다(check-settings-slug-guard 의 accept="image/*" 교훈).
const strip = s => s
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, m => m.replace(/[^\n]/g, ' '))
  .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (_, p) => p)

/** export 하나의 본문을 잘라 낸다 — 다음 최상위 export 직전까지. 못 찾으면 null(= 위반). */
const cutExport = (src, name) => {
  const at = src.indexOf(`export async function ${name}`)
  if (at === -1) return null
  const next = src.indexOf('\nexport ', at + 1)
  return src.slice(at, next === -1 ? src.length : next)
}

// ── 축 ⓐ · ⓒ ────────────────────────────────────────────────────────
const actionsRaw = read(ACTIONS)
if (!actionsRaw) {
  fail('ⓐ', `${ACTIONS} 를 읽을 수 없다`, '경로가 바뀌었으면 이 스크립트의 상수를 함께 옮긴다.')
} else {
  const body = cutExport(strip(actionsRaw), 'updateTenant')
  if (!body) {
    fail('ⓐ', `${ACTIONS} 에서 updateTenant 를 못 찾았다`, '함수 이름이 바뀌었으면 이 스크립트도 함께 고친다.')
  } else {
    // 가드는 두 조각이다 — has 확인과, newRoomId 가 그 확인을 실제로 쓰는 것.
    // 확인만 있고 안 쓰면 이름만 남은 가드고, 쓰는 쪽만 보면 이름을 바꿔 무력화할 수 있다.
    const decl = body.match(/const\s+roomFieldPresent\s*=\s*([^\n]*)/)
    if (!decl || !decl[1].includes("formData.has('roomId')")) {
      fail('ⓐ', `${ACTIONS} updateTenant 에 roomId 의 formData.has 가드가 없다`,
        "const roomFieldPresent = formData.has('roomId') 로 '칸 없음'과 '비웠음'을 가른다. 안 가르면 방을 떼는 저장이 옛 방으로 되돌아간다.")
    }
    const nr = body.match(/const\s+newRoomId\s*=\s*([^\n]*)/)
    if (!nr) {
      fail('ⓐ', `${ACTIONS} updateTenant 에서 newRoomId 선언을 못 찾았다`,
        '이름이 바뀌었으면 이 스크립트도 함께 고친다. 못 읽는 그물은 통과가 아니라 위반이다.')
    } else if (!/roomFieldPresent/.test(nr[1])) {
      fail('ⓐ', `${ACTIONS} updateTenant 의 newRoomId 가 가드를 안 거친다 — ${nr[1].trim()}`,
        "roomFieldPresent ? (roomId || null) : prevRoomId 로 쓴다. `roomId || prevRoomId` 는 빈 값이 falsy 라 방을 떼는 저장을 조용히 되돌린다(신고 c120bd32).")
    }

    // 축 ⓒ — 희망 초기화는 '방이 새로 정해졌을 때'만이다.
    for (const field of ['wishRooms', 'wishConditions']) {
      const line = body.match(new RegExp(`^\\s*${field}:[^\\n]*`, 'm'))
      if (!line) {
        fail('ⓒ', `${ACTIONS} updateTenant 에서 ${field} 저장 줄을 못 찾았다`,
          '이름이나 모양이 바뀌었으면 이 스크립트도 함께 고친다.')
        continue
      }
      if (!/newRoomId\s*&&\s*newRoomId\s*!==\s*prevRoomId/.test(line[0])) {
        fail('ⓒ', `${ACTIONS} updateTenant 의 ${field} 초기화가 newRoomId 진릿값을 안 본다`,
          "(newRoomId && newRoomId !== prevRoomId && ...) 로 좁힌다. 방을 떼는 순간에도 '바뀜'이 참이라, 조건만 남기려던 저장이 그 조건을 지운다.")
      }
    }
  }
}

// ── 축 ⓑ ────────────────────────────────────────────────────────────
// 중괄호 짝을 문자열·템플릿을 건너뛰며 센다. 거리로 위치를 근사하지 않는다(2026-08-03 교훈).
const braceMap = src => {
  const pairs = []
  const open = []
  const frames = [{ kind: 'code', depth: 0 }]
  let i = 0
  while (i < src.length) {
    const f = frames[frames.length - 1]
    const c = src[i]
    if (f.kind === 'str') {
      if (c === '\\') { i += 2; continue }
      if (c === f.q || c === '\n') { frames.pop(); i++; continue }   // 안 닫힌 따옴표는 줄에서 끊는다
      i++; continue
    }
    if (f.kind === 'tpl') {
      if (c === '\\') { i += 2; continue }
      if (c === '`') { frames.pop(); i++; continue }
      if (c === '$' && src[i + 1] === '{') { frames.push({ kind: 'code', depth: 0 }); i += 2; continue }
      i++; continue
    }
    if (c === "'" || c === '"') { frames.push({ kind: 'str', q: c }); i++; continue }
    if (c === '`') { frames.push({ kind: 'tpl' }); i++; continue }
    if (c === '{') { open.push(i); f.depth++; i++; continue }
    if (c === '}') {
      if (f.depth === 0 && frames.length > 1) { frames.pop(); i++; continue }   // 템플릿 보간 닫기
      const o = open.pop()
      if (o != null) pairs.push([o, i])
      f.depth--; i++; continue
    }
    i++
  }
  return pairs
}

/** JSX 조건부 컨테이너인가 — `{조건 && (` · `{조건 ? (` 처럼 깊이 0 에 논리·삼항이 선 중괄호. */
const isConditionalContainer = (src, o) => {
  // 여는 자리가 JSX 자식 위치인가. 화살표 함수 본문(`=> {`)과 속성값(`={`)은 뺀다.
  let p = o - 1
  while (p >= 0 && /\s/.test(src[p])) p--
  if (p < 0) return false
  const prev = src[p]
  const before = p > 0 ? src[p - 1] : ''
  if (!((prev === '>' && before !== '=') || prev === '}')) return false
  // 내용을 깊이 0 에서 훑어 논리·삼항을 찾는다. ?. 와 ?? 는 조건이 아니다.
  let d = 0, i = o + 1
  const frames = [{ kind: 'code' }]
  while (i < src.length) {
    const f = frames[frames.length - 1]
    const c = src[i]
    if (f.kind === 'str') {
      if (c === '\\') { i += 2; continue }
      if (c === f.q || c === '\n') { frames.pop(); i++; continue }
      i++; continue
    }
    if (f.kind === 'tpl') {
      if (c === '\\') { i += 2; continue }
      if (c === '`') { frames.pop(); i++; continue }
      i++; continue
    }
    if (c === "'" || c === '"') { frames.push({ kind: 'str', q: c }); i++; continue }
    if (c === '`') { frames.push({ kind: 'tpl' }); i++; continue }
    if (c === '(' || c === '[' || c === '{') { d++; i++; continue }
    if (c === ')' || c === ']') { d--; i++; continue }
    if (c === '}') { if (d === 0) return false; d--; i++; continue }
    if (d === 0) {
      if (c === '&' && src[i + 1] === '&') return true
      if (c === '|' && src[i + 1] === '|') return true
      if (c === '?' && src[i + 1] !== '.' && src[i + 1] !== '?') return true
    }
    i++
  }
  return false
}

const formRaw = read(FORM)
if (!formRaw) {
  fail('ⓑ', `${FORM} 를 읽을 수 없다`, '경로가 바뀌었으면 이 스크립트의 상수를 함께 옮긴다.')
} else {
  const src = strip(formRaw)
  const spots = []
  for (let at = src.indexOf('name="roomId"'); at !== -1; at = src.indexOf('name="roomId"', at + 1)) spots.push(at)
  if (spots.length === 0) {
    fail('ⓑ', `${FORM} 에 name="roomId" 가 없다`,
      '칸이 사라지면 서버는 늘 이전 방을 보존한다 — 방을 뗄 길이 아예 없어진다.')
  }
  const pairs = braceMap(src)
  for (const at of spots) {
    const wrap = pairs.find(([o, c]) => o < at && at < c && isConditionalContainer(src, o))
    if (wrap) {
      const head = src.slice(wrap[0], wrap[0] + 60).replace(/\s+/g, ' ').trim()
      fail('ⓑ', `${FORM} 의 name="roomId" 가 조건부로 그려진다 — ${head}…`,
        "호실 셀렉트는 상태와 무관하게 그린다. 숨는 순간 그 화면의 저장은 formData 에 칸이 없어 '안 건드림'이 되고, 운영자는 뗐다고 믿은 방이 그대로 남는다.")
    }
  }
}

if (violations.length > 0) {
  console.error(`[호실 떼기] 위반 ${violations.length}건`)
  for (const v of violations) {
    console.error(`  축 ${v.axis} · ${v.msg}`)
    console.error(`      조치: ${v.fix}`)
  }
  process.exit(1)
}
console.log('[호실 떼기] 축 ⓐ has 가드 · ⓑ 폼 상시 렌더 · ⓒ 희망 초기화 진릿값 / 위반 0건')
