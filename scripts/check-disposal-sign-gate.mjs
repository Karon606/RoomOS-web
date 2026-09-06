// 동의서 서명 게이트가 네 자리에 배선돼 있는지 보는 감지망. 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가(신고 2026-09-03, 413호). 입주자가 원격 링크에서 계약서에만 서명하고 멈췄는데
// 홈 알림이 "원격 서명 완료 · 계약서 발급 필요"라고 점등했다. 운영자는 그 알림을 믿고 발급했고
// 잔여 소지품 동의서 장은 서명란이 빈 채로 나갔다. 처분 근거가 없는 종이다.
//
// 알림 판정이 link.signedAt 하나만 봤기 때문이다. 동의서 서명도 제출 여부도 안 봤다.
// **운영자는 앱이 시킨 대로 했다. 앱이 완료가 아닌 것을 완료라고 불렀다.**
//
// 판정 정본은 lib/disposalSignGate 하나이고, 네 자리가 그것을 배선한다.
//   ⓐ 제출(app/sign/[token]/actions.ts) — 하드 차단. 클라이언트 canSubmit 의 서버 거울이다.
//   ⓑ 발급(app/api/contract/generate/route.ts) — 확인창 승낙 없이는 409.
//   ⓒ 홈 알림(app/(app)/dashboard/alerts.ts) — 반쪽이면 반쪽이라고 말한다.
//   ⓓ 발급 대기(app/(app)/contracts/actions.ts) — 같은 판정으로 행에 표시한다.
//   ⓔ 서명 화면(ContractView) 의 canSubmit 이 동의서 항을 유지한다.
//   ⓕ 계약서 패널(ContractFilesPanel) 배지 — 이 자리를 빠뜨렸다가 디자이너 패스에서 잡혔다.
//      정본 주석에는 배선했다고 적어 놓고 실제로는 안 했다. 그물 목록에도 없어 통과했다.
//
// 실행: node scripts/check-disposal-sign-gate.mjs
import { readFileSync } from 'node:fs'

const strip = s => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, m => m.replace(/[^\n]/g, ''))

// import 줄은 지우고 본다. 정본을 들여오기만 하고 쓰지 않아도 통과하던 그물이라, 게이트를
// 통째로 지운 역주입이 import 하나에 걸려 빠져나갔다(2026-09-04 드릴에서 실제로 놓쳤다).
const read = f => strip(readFileSync(f, 'utf8')).replace(/^\s*import\s[^\n]*$/gm, '')
const violations = []

/**
 * 그 위치가 catch 붙은 try 블록 **안에** 있는가. 구조로 본다.
 *
 * 종전에는 호출 지점에서 1400자 안에 `} catch (` 가 있는지로 봤다. 그 창은 주석 몇 줄만
 * 늘어나도 밖으로 밀려 **멀쩡한 코드에 경보가 울리고**, 반대로 남의 try 의 catch 가 창에
 * 들어오면 안 감싼 호출도 통과한다. 거리로 재는 그물은 어느 쪽으로든 거짓말을 한다.
 */
function wrappedInTryCatch(src, at) {
  for (const m of src.matchAll(/\btry\s*\{/g)) {
    if (m.index > at) break
    let depth = 0, end = -1
    for (let i = src.indexOf('{', m.index); i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break } }
    }
    if (end < 0 || end < at) continue          // 이 try 는 호출 앞에서 이미 닫혔다
    if (/^\s*catch\s*[({]/.test(src.slice(end + 1))) return true
  }
  return false
}


const WIRED = [
  // 제출 게이트는 슬롯 정본으로 옮겼다(2026-09-06, 제3 서류 일반화). 링크 축이 맞는 자리다 —
  // 입주자 앞의 종이는 그 링크의 스냅샷이고 그 위의 서명은 그 링크의 자국이다.
  ['app/sign/[token]/actions.ts', 'linkSignSlots(', 'ⓐ 제출이 남은 서명을 안 본다. 액션을 직접 부르면 반쪽 서명으로 제출이 통과한다.'],
  ['app/api/contract/generate/route.ts', 'disposalSignatureMissing(', 'ⓑ 발급이 동의서 서명을 안 본다. 서명란이 빈 동의서가 아무 말 없이 나간다.'],
  // 아래 셋은 2026-09-06 에 슬롯 정본으로 옮겼다. **needle 은 배선을 따라 옮긴다** — 안 옮기면
  // 그물이 헛울리고, 헛울리는 그물은 곧 무시당해 진짜 결함도 못 잡는다.
  ['app/(app)/dashboard/alerts.ts', 'signProgressLabelSlots(', 'ⓒ 홈 알림이 반쪽 서명을 완료라고 부른다. 운영자가 그것을 믿고 발급한다.'],
  ['app/(app)/contracts/actions.ts', 'signStageSlots(', 'ⓓ 발급 대기 행이 반쪽 서명을 구분하지 않는다.'],
  // 배지는 서버가 계약 축으로 판정해 내려준 값을 쓴다. 클라이언트에 서명 이미지가 없어 여기서
  // 셀 수가 없다 — 축은 '정본을 부르는가'가 아니라 '서버 판정을 읽는가'다.
  ['components/entity-modal/widgets/ContractFilesPanel.tsx', 'link.signStage', 'ⓕ 계약서 패널 배지가 반쪽 서명을 서명 완료라고 부른다.'],
]
for (const [f, needle, msg] of WIRED) {
  if (!read(f).includes(needle)) violations.push(`${f} — ${msg}`)
}

// ⓑ 는 승낙 운반체까지 있어야 확인창 관용구가 성립한다(막지 않고 묻기로 한 결정, 2026-09-04).
{
  const f = 'app/api/contract/generate/route.ts'
  const src = read(f)
  if (!/disposalUnsignedAck/.test(src)) {
    violations.push(`${f} — 확인창 승낙(disposalUnsignedAck)을 안 본다. 막거나 그냥 지나가거나 둘 중 하나가 된다.`)
  }
  if (!/DISPOSAL_SIGNATURE_REQUIRED/.test(src)) {
    violations.push(`${f} — 409 코드가 없다. 클라이언트가 확인창을 띄울 신호를 못 받는다.`)
  }
}

// ⓔ 서명 화면의 제출 버튼 판정에 동의서 항이 살아 있는가.
{
  const f = 'app/contract/[tenantId]/ContractView.tsx'
  const src = read(f)
  // canSubmit 이 정본 판정을 거치는가. 종전에는 이 한 줄이 disposalConsent.enabled 와
  // disposalSignature 를 직접 봤는데, 지금은 signStage 가 그 둘을 쥔다(2026-09-04).
  // **정본을 부르는 것이 축이지 이 줄에 어떤 낱말이 있느냐가 축은 아니다.**
  const m = src.match(/const canSubmit = [^\n]*/)
  if (!m) violations.push(`${f} — canSubmit 을 못 찾았다. 구조가 바뀌었으면 이 그물부터 고친다(침묵 통과 금지).`)
  else if (/disposalConsent\.enabled/.test(m[0]) && /disposalSignature/.test(m[0])) {
    // 옛 모양(직접 판정)도 통과시킨다 — 되돌아간 것이 아니라 아직 안 옮긴 상태일 수 있다.
  } else if (!/signStage|stage === 'complete'/.test(m[0])) {
    violations.push(`${f} — canSubmit 이 서명 진행 정본을 안 거친다. 화면이 알림·발급과 다른 답을 낸다.`)
  }
  // 그리고 화면이 정본을 실제로 부르는가(import 만으로는 통과 못 한다).
  // 슬롯 정본으로 옮겼다(2026-09-06). needle 은 배선을 따라 옮긴다.
  if (!/signStageSlots\s*\(/.test(src)) {
    violations.push(`${f} — 화면이 signStageSlots 를 안 부른다. 서명 진행을 손으로 세면 다른 자리와 갈린다.`)
  }
  // 원격 서명·제출 호출이 실패를 삼키지 않는가. 침묵하면 입주자가 저장된 줄 알고 창을 닫는다.
  //    호출을 **전수로** 본다. 종전에는 indexOf 로 첫 호출만 봐서, 두 번째 호출을 안 감싸도
  //    그물이 조용했다 — 첫 자리가 멀쩡하면 뒤는 안 보는 그물은 통과가 증거가 되지 않는다.
  for (const fn of ['submitRemoteSignature', 'finalizeRemoteSubmission']) {
    const calls = [...src.matchAll(new RegExp(`await ${fn}\\(`, 'g'))]
    if (calls.length === 0) { violations.push(`${f} — ${fn} 호출을 못 찾았다.`); continue }
    for (const c of calls) {
      if (!wrappedInTryCatch(src, c.index)) {
        violations.push(`${f} — ${fn} 호출이 catch 없이 돈다(${src.slice(0, c.index).split('\n').length}번째 줄). 전송이 실패해도 입주자 화면에 아무 말이 없다.`)
      }
    }
  }
}

console.log(`[동의서 서명 게이트] 축 ⓐ 제출 · ⓑ 발급 · ⓒ 알림 · ⓓ 대기 · ⓔ 화면 · ⓕ 패널 / 위반 ${violations.length}건`)
for (const v of violations.slice(0, 15)) console.error(`  - ${v}`)
process.exit(violations.length > 0 ? 1 : 0)
