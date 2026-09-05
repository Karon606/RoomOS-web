// 서명 진행 판정이 네 표시 자리에서 갈리지 않는지 보는 감지망. 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가(2026-09-04). 어제 두 입주자가 각각 한쪽만 서명하고 끝났는데, 계약서만 서명한
// 쪽에는 "원격 서명 완료" 알림이 뜨고 동의서만 서명한 쪽(506호)은 화면 어디에도 안 나왔다.
// 링크 쿼리가 `signedAt: { not: null }` 로 걸러 그것을 통째로 떨어뜨렸기 때문이다.
//
//   ⓐ 정본이 signStage 를 내보낸다.
//   ⓑ 표시 자리가 signStage 를 **호출**한다(import 만으로는 통과 못 한다).
//   ⓒ 링크 조회가 계약서 서명만 보지 않는다. '서명본을 본다'는 두 자리만 예외.
//   ⓓ hasContractSignature: true 리터럴 앞에 그것을 증명하는 가드가 있다.
//   ⓔ AlertCategory 를 더했을 때 다섯 자리를 다 채웠다. **order 배열은 타입 검사에 안 걸린다.**
//   ⓕ 푸시가 카테고리를 손으로 세지 않는다.
//
// 실행: node scripts/check-sign-progress-axis.mjs
import { readFileSync } from 'node:fs'

const strip = s => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, m => m.replace(/[^\n]/g, ''))
// import 줄을 지우고 본다 — 정본을 들여오기만 하고 안 써도 통과하던 그물이 실제로 뚫렸다.
const read = f => strip(readFileSync(f, 'utf8')).replace(/^\s*import\s[^\n]*$/gm, '')

const violations = []

// ⓐ
{
  const src = read('lib/disposalSignGate.ts')
  for (const fn of ['signStage', 'missingSignatures', 'disposalSignatureMissing']) {
    if (!new RegExp(`export function ${fn}\\b`).test(src)) {
      violations.push(`lib/disposalSignGate.ts — ${fn} 이 없다. 판정 정본이 무너지면 표시 자리가 각자 센다.`)
    }
  }
}

// ⓑ 표시 자리가 정본을 부르는가.
for (const [f, msg] of [
  ['app/(app)/dashboard/alerts.ts', '홈 알림이 서명 진행을 손으로 센다.'],
  ['app/(app)/contracts/actions.ts', '발급 대기가 서명 진행을 손으로 센다.'],
  ['components/entity-modal/widgets/ContractFilesPanel.tsx', '계약서 패널 배지가 서명 진행을 손으로 센다.'],
]) {
  if (!/signStage\s*\(/.test(read(f))) violations.push(`${f} — ${msg}`)
}

// ⓒ 링크 조회가 동의서 서명도 보는가.
//    '서명본을 본다'는 축은 계약서 서명만 보는 것이 맞다(그 종이가 서명본인지가 물음이다).
const LINK_QUERY_ALLOW = ['checkContractShareDrift', 'getSignedSnapshot']
for (const f of [
  'app/(app)/dashboard/alerts.ts',
  'app/(app)/contracts/actions.ts',
  'app/(app)/tenants/contractShare.ts',
]) {
  const src = read(f)
  for (const m of src.matchAll(/contractShareLink\.(?:findMany|findFirst)\s*\(\s*\{/g)) {
    // 이 조회가 어느 함수 안인가 — 앞쪽에서 가장 가까운 export 함수 이름.
    const before = src.slice(0, m.index)
    const fn = [...before.matchAll(/export async function (\w+)/g)].pop()?.[1] ?? ''
    if (LINK_QUERY_ALLOW.includes(fn)) continue
    // where 블록만 떠서 본다.
    const at = src.indexOf('where:', m.index)
    if (at < 0 || at > m.index + 600) continue
    let depth = 0, end = -1
    for (let i = src.indexOf('{', at); i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break } }
    }
    const where = end > 0 ? src.slice(at, end + 1) : ''
    if (/signedAt/.test(where) && !/disposalSignedAt/.test(where)) {
      violations.push(`${f} ${fn} — 링크 조회가 계약서 서명만 본다. 동의서만 서명된 계약이 목록에서 통째로 빠진다.`)
    }
  }
}

// ⓓ 리터럴 true 는 그것을 증명한 가드 뒤에서만.
for (const f of ['app/(app)/dashboard/alerts.ts', 'app/(app)/contracts/actions.ts', 'app/sign/[token]/actions.ts']) {
  const src = read(f)
  for (const m of src.matchAll(/hasContractSignature:\s*true/g)) {
    const win = src.slice(Math.max(0, m.index - 600), m.index)
    if (!/if\s*\(!\s*link\.signedAt\)|signedAt.*return|!\s*l\.signedAt/.test(win)) {
      violations.push(`${f} — hasContractSignature: true 리터럴 앞에 계약서 서명을 증명한 가드가 없다. 쿼리를 넓힌 순간 이 리터럴은 거짓말이 된다.`)
    }
  }
}

// ⓔ 카테고리 다섯 자리. order 배열이 타입 검사에 안 걸리는 유일한 자리다.
{
  const a = read('app/(app)/dashboard/alerts.ts')
  const bell = read('components/layout/NotificationBell.tsx')
  const union = a.match(/export type AlertCategory =([^\n]*)/)?.[1] ?? ''
  const n = (union.match(/'/g) || []).length / 2
  const order = a.match(/const order: AlertCategory\[\] = \[([^\]]*)\]/)?.[1] ?? ''
  const orderN = (order.match(/'/g) || []).length / 2
  const byCat = a.match(/const byCategory = \{([^}]*)\}/)?.[1] ?? ''
  const byCatN = (byCat.match(/:/g) || []).length
  const label = a.match(/CATEGORY_LABEL[^=]*=\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
  const labelN = (label.match(/:/g) || []).length
  const dot = bell.match(/const DOT: Record<AlertCategory, string> = \{([\s\S]*?)\n\}/)?.[1] ?? ''
  const dotN = (dot.match(/:/g) || []).length
  // order 는 푸시 요약 순서라 일부러 빼는 카테고리가 있다. 그 예외만 근거와 함께 허용한다.
  //   contact — '연락할 때'는 아침 푸시에 넣지 않는다(운영자 관례, 이 그물 신설 전부터).
  const ORDER_ALLOW = 1
  if (!n) violations.push('app/(app)/dashboard/alerts.ts — AlertCategory 유니온을 못 찾았다.')
  else {
    for (const [name, got] of [['byCategory 초기값', byCatN], ['CATEGORY_LABEL', labelN], ['NotificationBell DOT', dotN]]) {
      if (got !== n) violations.push(`카테고리 ${n}종인데 ${name} 은 ${got}종이다. 빠진 자리는 화면이나 푸시에서만 조용히 침묵한다.`)
    }
    if (orderN !== n - ORDER_ALLOW) {
      violations.push(`카테고리 ${n}종인데 order 배열은 ${orderN}종이다(허용 제외 ${ORDER_ALLOW}). **이 배열은 타입 검사에 안 걸린다** — 빠지면 종은 울리는데 푸시에서만 침묵한다.`)
    }
  }
}

// ⓖ 필수 판정의 축이 셋 다 링크 스냅샷인가.
//    라이브 설정을 보면 영업장이 서류를 새로 켜는 순간 **과거 계약 전부가 소급으로 반쪽**이
//    되어 알림이 도배된다. 기준은 "그 사람이 무엇을 보고 서명했나"이고 그것은 스냅샷에 있다.
//    지금은 판정이 갈리는 링크가 0건이라 무변동이지만, 서류를 늘리는 순간 드러난다.
for (const [f, msg] of [
  ['app/(app)/dashboard/alerts.ts', '홈 알림'],
  ['app/(app)/contracts/actions.ts', '발급 대기'],
]) {
  const src = read(f)
  if (/disposalConsentTemplate/.test(src)) {
    violations.push(`${f} — ${msg}이 라이브 영업장 설정으로 필수 여부를 판정한다. 서류를 켜면 과거가 소급으로 반쪽이 된다. 링크 templateSnapshot 을 본다.`)
  }
  if (!/templateSnapshot/.test(src)) {
    violations.push(`${f} — ${msg}이 링크 스냅샷을 안 읽는다. 세 화면의 축이 갈리면 어느 것을 봤느냐에 따라 다른 사실을 듣는다.`)
  }
}

// ⓘ 알림이 "지금 말할 때인가"를 정본에 묻는가. import 만으로는 통과 못 한다.
{
  const f = 'app/(app)/dashboard/alerts.ts'
  const src = read(f)
  if (!/signAlertDue\s*\(/.test(src)) {
    violations.push(`${f} — signAlertDue 를 안 부른다. 입주자가 아직 마칠 수 있는 건까지 알림이 뜬다(신고 09da7f29).`)
  }
  for (const need of ['submittedAt', 'expiresAt', 'lockedAt']) {
    if (!new RegExp(`${need}:\\s*true`).test(src)) {
      violations.push(`${f} — 링크 조회가 ${need} 를 안 읽는다. 살았는지 죽었는지 모르면 침묵 판정이 성립하지 않는다.`)
    }
  }
}

// ⓙ 재요청 유지 갈래가 옛 스냅샷을 그대로 승계하는가.
//    새로 조립하면 남은 서명이 다른 내용 위에 놓이는데 서명 시점 격리본은 재동결되지 않아
//    **증거와 화면이 갈린다.** 이 축이 그 클래스의 재발을 막는다.
{
  const f = 'app/(app)/tenants/contractShare.ts'
  const src = read(f)
  const at = src.indexOf('export async function renewContractShareLink')
  if (at < 0) {
    violations.push(`${f} — renewContractShareLink 를 못 찾았다. 구조가 바뀌었으면 이 그물부터 고친다(침묵 통과 금지).`)
  } else {
    const body = src.slice(at, src.indexOf('\n}', at))
    if (!/templateSnapshot:\s*old\.templateSnapshot/.test(body)) {
      violations.push(`${f} — 유지 갈래가 옛 스냅샷을 승계하지 않는다. 서명한 내용과 다른 종이가 나간다.`)
    }
    if (/buildContractData\s*\(/.test(body)) {
      violations.push(`${f} — 유지 갈래가 내용을 새로 조립한다. 그 순간 증거(격리본)와 화면이 갈린다.`)
    }
    if (!/signedAt:\s*old\.signedAt/.test(body)) {
      violations.push(`${f} — 서명 자국을 승계하지 않는다. 입주자가 이미 한 서명이 새 링크에서 안 보인다.`)
    }
  }
}

// ⓕ 푸시가 정본 요약을 그대로 쓰는가.
{
  const f = 'app/api/cron/push-alerts/route.ts'
  const src = read(f)
  if (!/summarizeAlerts\s*\(/.test(src)) violations.push(`${f} — summarizeAlerts 를 안 쓴다. 종과 푸시가 다른 판정을 하게 된다.`)
  if (/byCategory\s*\[\s*'/.test(src)) violations.push(`${f} — 카테고리를 손으로 센다. 정본 요약을 그대로 써야 종과 갈리지 않는다.`)
}

console.log(`[서명 진행 축] ⓐ 정본 · ⓑ 배선 · ⓒ 링크 조회 · ⓓ 리터럴 가드 · ⓔ 카테고리 · ⓕ 푸시 · ⓖ 스냅샷 축 · ⓘ 알림 시점 · ⓙ 유지 승계 / 위반 ${violations.length}건`)
for (const v of violations.slice(0, 15)) console.error(`  - ${v}`)
process.exit(violations.length > 0 ? 1 : 0)
