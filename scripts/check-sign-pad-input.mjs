// 서명 패드 입력 1단계 배선 감지망(신고 c6eb427d, 2026-10-26 운영자 승인). 읽기 전용, 위반 시 exit 1.
// 실행: node scripts/check-sign-pad-input.mjs
//
// 축.
//   ⓐ 법적 바닥. MIN_SIGNATURE_INK_PX 는 60 이상이고, 확인 경로가 isSignatureInkEnough(pad.toData()) 를 실제로 부른다
//     (import 만 남기고 호출을 지우면 걸린다, domain-contracts 체크리스트 F).
//   ⓑ 오버레이·모달 전체에 touch-action: none. 캔버스만 none 이면 패드 밖 두 번째 터치가 핀치로 빼앗긴다.
//   ⓒ 잉크가 있으면 배경 누름을 무시한다(가이드 §12). 확인 버튼은 disabled 로 잉크를 막지 않는다(회색에서 코랄로).
//   ⓓ 상태 줄은 사전 열쇠 넷(pad.stIdle·stDrawing·stOk·stShort)을 부르고 원격은 병기(bi)다.
//   ⓔ 계측은 수만 담는다. lib/signPadTrace 가 좌표·이미지(toData·toDataURL·points)를 읽지 않고, 오류신고가 그것을 덧붙인다.
import { readFileSync } from 'node:fs'

const violations = []
const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:\\'"`])\/\/.*$/gm, (m, pre) => pre)
const read = (f) => { try { return readFileSync(f, 'utf8') } catch { violations.push(`${f} — 파일을 못 읽었다`); return '' } }

// ⓐ
{
  const ink = strip(read('lib/signatureInk.ts'))
  const m = ink.match(/export const MIN_SIGNATURE_INK_PX = (\d+)/)
  if (!m || Number(m[1]) < 60) violations.push('lib/signatureInk.ts — 서명 인정 바닥(MIN_SIGNATURE_INK_PX)이 60 미만이거나 없다. 법적 바닥은 낮추지 않는다')
}
const CV = 'app/contract/[tenantId]/ContractView.tsx'
const cvRaw = read(CV)
const cv = strip(cvRaw)
{
  const at = cv.indexOf('const handleSignConfirm = async () => {')
  const body = at >= 0 ? cv.slice(at, at + 2500) : ''
  if (!body) violations.push(`${CV} — handleSignConfirm 을 못 찾았다`)
  else {
    if (!/if \(!isSignatureInkEnough\(pad\.toData\(\)\)\) \{/.test(body)) violations.push(`${CV} — 확인 경로가 isSignatureInkEnough(pad.toData()) 로 거절하지 않는다(점 몇 개가 서명으로 저장된다)`)
    if (!/pad\.isEmpty\(\)/.test(body)) violations.push(`${CV} — 확인 경로가 빈 패드를 거절하지 않는다`)
  }
}
// ⓑ
for (const sel of ['sig-overlay', 'sig-modal']) {
  const rule = cvRaw.match(new RegExp(`\\.${sel} \\{[^}]*\\}`))
  if (!rule || !/touch-action: none/.test(rule[0])) violations.push(`${CV} — .${sel} 에 touch-action: none 이 없다(패드 밖 터치가 핀치로 빼앗겨 획이 끊긴다)`)
}
if (!/\.sig-canvas \{[^}]*touch-action: none/.test(cvRaw)) violations.push(`${CV} — .sig-canvas 의 touch-action: none 이 사라졌다`)
if (!/@media \(max-width: 479px\) \{ \.sig-canvas-wrap \{ aspect-ratio: 16 \/ 9; min-height: calc\(180px \* var\(--sig-inv, 1\)\); \} \}/.test(cvRaw)) violations.push(`${CV} — 폰 폭 패드 키우기(16/9, 최소 180px)가 없다`)
// ⓒ
if (!/className="sig-overlay no-print" onClick=\{\(\) => \{ if \(sigPadRef\.current && !sigPadRef\.current\.isEmpty\(\)\) return; setSignOpen\(false\) \}\}/.test(cv)) violations.push(`${CV} — 잉크가 있는데 배경 누름으로 서명 모달이 닫힌다(가이드 §12 dirty 후 배경클릭 무시)`)
if (!/onClick=\{handleSignConfirm\} disabled=\{remoteSubmitting\} className=\{padInk === 'ok' \? 'toolbar-print' : 'toolbar-print sig-confirm-wait'\}/.test(cv)) violations.push(`${CV} — 확인 버튼이 잉크 상태로 회색·코랄을 가르지 않거나 disabled 로 잉크를 막는다`)
// ⓓ
if (!/const PAD_STATUS_KEY = \{ idle: 'pad\.stIdle', drawing: 'pad\.stDrawing', ok: 'pad\.stOk', short: 'pad\.stShort' \} as const/.test(cv)) violations.push(`${CV} — 상태 줄 열쇠 넷이 사전 열쇠가 아니다`)
if (!/\{remote \? bi\(signLang, PAD_STATUS_KEY\[padInk\]\) : t\('ko', PAD_STATUS_KEY\[padInk\]\)\}/.test(cv)) violations.push(`${CV} — 상태 줄이 사전(원격 병기)을 안 부른다`)
if (!/pad\.addEventListener\('beginStroke', onBegin\)/.test(cv) || !/pad\.addEventListener\('endStroke', onEnd\)/.test(cv)) violations.push(`${CV} — 상태 줄이 패드 공개 이벤트(beginStroke·endStroke)를 안 듣는다`)
if (!/isSignatureInkEnough\(strokes\) \? 'ok' : 'short'/.test(cv)) violations.push(`${CV} — 상태 줄 판정이 확인 버튼과 같은 정본(isSignatureInkEnough)이 아니다`)
// ⓔ
{
  const T = 'lib/signPadTrace.ts'
  const tr = strip(read(T))
  if (/toDataURL|toData\(|\.points\b|signatureImage|tenantName|\.name\b/.test(tr)) violations.push(`${T} — 계측이 좌표·이미지·이름을 읽는다(수만 담는다)`)
  if (!/writePadSession\(sess\)/.test(cv)) violations.push(`${CV} — 패드가 닫힐 때 계측을 남기지 않는다`)
  if (!/overlay\?\.addEventListener\('pointercancel', onPCancel, true\)/.test(cv)) violations.push(`${CV} — 빼앗긴 획(pointercancel)을 세지 않는다`)
  const ER = 'components/ErrorReportButton.tsx'
  const er = strip(read(ER))
  if (!/const padText = padTraceText\(readPadTrace\(\), Date\.now\(\)\)/.test(er) || !/`\[서명 패드\]\\n\$\{padText\}`/.test(er)) violations.push(`${ER} — 오류신고가 서명 패드 계측을 덧붙이지 않는다`)
  if (!/, pad\]\.filter\(Boolean\)\.join/.test(er)) violations.push(`${ER} — 서명 패드 계측이 메모 본문에 안 실린다`)
}

console.log(`[서명 패드 입력 1단계] 위반 ${violations.length}건`)
for (const v of violations) console.log('  - ' + v)
process.exit(violations.length ? 1 : 0)
