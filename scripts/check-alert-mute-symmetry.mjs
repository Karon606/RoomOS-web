// 알림을 끌 수 있으면 같은 자리에서 켤 수 있는지 보는 감지망. 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가(신고 C-1, 2026-09-03). 현금영수증 기한 알림은 요약 줄에서 8건을 한 번에 껐는데,
// 끈 목록의 그 줄에는 '다시 켜기'가 없었다. 끈 건을 합성 한 줄로 만들면서 키를 잃었기 때문이다.
// 대신 월 단위 탭으로 보냈는데, 그 탭은 링크가 고른 한 달만 조회해서 끈 건이 여러 달에 걸치면
// 나머지가 아예 안 보이고, 끈 목록 자체가 후보 목록 아래 접힌 한 줄이었다. 운영자는 못 찾았다.
//
// 끄기 버튼은 진작 단수·복수 키를 다 처리하고 있었다. 켜는 자리만 단수 전용이라 비대칭이었다.
// 가이드 §16 은 적용취소의 진입점 우선순위에서 '원위치'를 '상세 화면'보다 앞에 세운다.
//
//   ⓐ 끈 알림 목록에 미는 줄은 muteKey 또는 muteKeys 를 갖는다(켜는 문이 없는 줄을 만들지 않는다).
//   ⓑ 끈 알림 줄을 그리는 자리가 복수 키와 되살리기 액션을 함께 안다.
//   ⓒ 끄는 함수를 부르는 파일은 켜는 함수도 참조한다(한쪽만 있는 화면을 만들지 않는다).
//
// 실행: node scripts/check-alert-mute-symmetry.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const strip = s => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, m => m.replace(/[^\n]/g, ''))

const walk = (dir, out) => {
  let names
  try { names = readdirSync(dir) } catch { return out }
  for (const name of names) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { walk(full, out); continue }
    if (/\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

/** 여는 괄호부터 짝 닫는 괄호까지 통째로 뜬다 — 여러 줄 객체를 한 줄 정규식이 놓친다. */
const blockAt = (src, openIdx) => {
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')') { depth--; if (depth === 0) return src.slice(openIdx, i + 1) }
  }
  return null
}

const violations = []

// ⓐ 끈 알림 목록에 미는 줄은 켜는 키를 갖는다.
const PAGE = 'app/(app)/dashboard/page.tsx'
{
  const src = strip(readFileSync(PAGE, 'utf8'))
  const pushes = [...src.matchAll(/mutedAlerts\.push\s*\(/g)]
  if (pushes.length === 0) {
    violations.push(`${PAGE} mutedAlerts.push 를 못 찾았다. 구조가 바뀌었으면 이 그물부터 고친다(침묵 통과 금지).`)
  }
  for (const m of pushes) {
    const block = blockAt(src, m.index + m[0].length - 1)
    if (!block) { violations.push(`${PAGE} mutedAlerts.push 블록의 괄호 짝을 못 찾았다.`); continue }
    if (!/\bmuteKeys?\s*:/.test(block)) {
      violations.push(`${PAGE} 끈 알림 줄에 muteKey·muteKeys 가 없다. 켜는 문이 없는 줄은 끄기만 되는 줄이다(§16).`)
    }
  }
}

// ⓑ 끈 알림 줄을 그리는 자리가 복수 키와 되살리기를 함께 안다.
const CLIENT = 'app/(app)/dashboard/DashboardClient.tsx'
{
  const src = strip(readFileSync(CLIENT, 'utf8'))
  const at = src.indexOf('function MutedAlertRows')
  if (at < 0) {
    violations.push(`${CLIENT} MutedAlertRows 를 못 찾았다. 구조가 바뀌었으면 이 그물부터 고친다.`)
  } else {
    const body = src.slice(at, at + 4000)
    // 키 추출은 정본 헬퍼(keysOf)를 거치거나 본문이 직접 봐야 한다. 헬퍼를 쓴다면 그 헬퍼가
    // 복수 키를 아는지까지 본다 — 헬퍼가 단수만 보면 부르는 쪽은 통과해도 묶음은 못 켠다.
    const usesHelper = /\bkeysOf\s*\(/.test(body)
    const helperDef = src.match(/const keysOf\s*=\s*[^\n]*\n?[^\n]*/)
    const helperKnowsPlural = !!helperDef && /\bmuteKeys\b/.test(helperDef[0])
    const seesPlural = /\bmuteKeys\b/.test(body) || (usesHelper && helperKnowsPlural)
    if (!seesPlural) {
      violations.push(`${CLIENT} MutedAlertRows 가 복수 키(muteKeys)를 안 본다. 묶음으로 끈 알림을 묶음으로 못 켠다.`)
    }
    if (!/unmuteHomeAlert\s*\(/.test(body)) {
      violations.push(`${CLIENT} MutedAlertRows 에 되살리기 호출이 없다.`)
    }
  }
}

// ⓒ 끄는 함수를 부르는 파일은 켜는 함수도 참조한다.
const PAIRS = [['muteHomeAlert', 'unmuteHomeAlert'], ['muteReceiptAlert', 'unmuteReceiptAlert']]
for (const f of walk('app', walk('components', []))) {
  const src = strip(readFileSync(f, 'utf8'))
  for (const [off, on] of PAIRS) {
    // 정의 파일은 둘 다 내보내므로 자연 통과한다. 부르는 쪽만 본다.
    if (!new RegExp(`\\b${off}\\s*\\(`).test(src)) continue
    if (!new RegExp(`\\b${on}\\b`).test(src)) {
      violations.push(`${f} ${off} 로 끄면서 ${on} 을 안 쓴다. 끈 것을 그 화면에서 못 켠다(§16).`)
    }
  }
}

// ⓓ 컷오프 키 문법의 집은 한 파일이다. 손으로 조립하는 병행 구현이 생기면 두 문법이 갈린다.
for (const f of walk('app', walk('components', walk('lib', [])))) {
  if (f === 'lib/alertCutoff.ts') continue
  if (/['\`]cutoff:/.test(strip(readFileSync(f, 'utf8')))) {
    violations.push(`${f} — 컷오프 키를 손으로 조립한다. lib/alertCutoff 의 cutoffKeyOf 를 쓴다.`)
  }
}

// ⓔ 알림 조립이 컷오프를 실제로 태우는가. import 만으로는 통과 못 한다.
{
  const f = 'app/(app)/dashboard/page.tsx'
  const src = strip(readFileSync(f, 'utf8')).replace(/^\s*import\s[^\n]*$/gm, '')
  // **필터 블록만 떠서 본다.** 창을 넉넉히 잡았더니 아래 wouldRestoreCount 의 호출까지
  // 들어와, 필터를 통째로 지운 역주입이 그 호출에 걸려 통과했다(2026-09-06 드릴에서 실제로 놓쳤다).
  // 그물이 검사 대상을 헐겁게 잡으면 통과가 증거가 되지 않는다.
  const at = src.indexOf('const crAll')
  const filterEnd = at < 0 ? -1 : src.indexOf('.map(', at)
  if (at < 0 || filterEnd < 0) {
    violations.push(`${f} — crAll 필터 블록을 못 찾았다. 구조가 바뀌었으면 이 그물부터 고친다(침묵 통과 금지).`)
  } else if (!/isReceiptBeforeCutoff\s*\(/.test(src.slice(at, filterEnd))) {
    violations.push(`${f} — crAll 필터가 컷오프를 안 본다. 지운 알림이 다시 뜬다.`)
  }
  if (!/readAlertCutoffYmd\s*\(/.test(src)) {
    violations.push(`${f} — 컷오프 값을 안 읽는다.`)
  }
}

// ⓕ 되돌릴 문이 있는가. 그리고 필수 인자에 기본값을 붙여 타입 강제를 무력화하지 않았는가.
{
  const f = 'app/(app)/dashboard/DashboardClient.tsx'
  const src = strip(readFileSync(f, 'utf8')).replace(/^\s*import\s[^\n]*$/gm, '')
  if (!/setAlertCutoff\s*\(\s*'receipt'\s*,\s*null\s*\)/.test(src)) {
    violations.push(`${f} — 컷오프를 해제하는 문이 없다. 지운 알림을 되살릴 길이 사라진다(§16).`)
  }
  const sig = strip(readFileSync('lib/cashReceipt.ts', 'utf8')).match(/cutoffYmd\s*:\s*string \| null\s*(=)?/)
  if (sig && sig[1]) {
    violations.push(`lib/cashReceipt.ts — liveMutedReceiptKeys 의 cutoffYmd 에 기본값이 붙었다. 호출부가 조용히 컷오프를 빠뜨린다.`)
  }
}

console.log(`[알림 끄기 대칭] 축 ⓐ 끈 줄의 키 · ⓑ 묶음 되살리기 · ⓒ 끄기·켜기 짝 · ⓓ 컷오프 문법 · ⓔ 배선 · ⓕ 되돌림 / 위반 ${violations.length}건`)
for (const v of violations.slice(0, 15)) console.error(`  - ${v}`)
process.exit(violations.length > 0 ? 1 : 0)
