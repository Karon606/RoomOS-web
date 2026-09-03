// 사진 업로드 경로가 다시 원본을 통째로 보내거나 조용히 실패하는 것을 잡는 감지망.
// 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가(긴급 신고 2026-09-03). 입주자 등록에서 외국인등록증을 올리면 아무 반응 없이 튕기고
// 입력하던 정보가 통째로 날아갔다. 원인이 둘이었다.
//
//   · 원본을 그대로 base64 로 만들어 서버 액션에 실었다. 바이트를 하나씩 문자열에 붙이는 루프라
//     큰 사진에서 모바일 탭이 죽고, 죽으면 폼 값이 전부 사라진다.
//   · 핸들러가 `try { … } finally { … }` 뿐이라 던진 오류를 아무도 안 잡았다. **토스트조차 안 뜬다.**
//
// 형제 정본(영수증 스캔)은 이미 축소해서 보내고 있었다. 한 경로만 안 따라간 것이다.
//
//   ⓐ 클라이언트 코드가 base64 를 바이트 루프로 만들지 않는다. lib/ocrImage 가 정본이다.
//   ⓑ AI 인식 액션을 부르는 클라이언트 파일은 catch 를 갖는다. 없으면 실패가 침묵한다.
//   ⓒ 그 파일들은 lib/ocrImage 를 거친다(축소 또는 상한 판정).
//
// 그런데 축소만으로는 안 끝났다(같은 날 19:02 재발). 서버 액션 인자를 되읽는 React 직렬화기가
// 인자 전체의 슬롯을 1,000,000 개로 제한하는데, 문자열은 1자가 1슬롯이라 base64 인자는 원본
// 약 730KB 에서 터진다. next.config 의 bodySizeLimit 10MB 는 바깥 문이고 이것이 진짜 구속이었다.
// FormData 에 실은 File 은 슬롯을 그렇게 안 먹어 6MB 도 통과한다(실측). 그래서 축을 셋 더 세운다.
//
//   ⓓ 서버 액션 시그니처가 base64 류 문자열 파라미터를 받지 않는다.
//   ⓔ AI 인식 액션 호출의 첫 인자는 ocrForm(...) 이다.
//   ⓕ lib/ocrImage 는 base64 문자열을 만들지 않는다(toDataURL·readAsDataURL 금지).
//
// 실행: node scripts/check-upload-hygiene.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

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
const strip = s => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')

// AI 가 사진을 읽는 액션들 — 이것을 부르는 화면이 이 그물의 대상이다.
const AI_CALLS = /analyze(?:IdCard|Contract|Receipt)WithGemini\(|parseFloorPlanImage\(|uploadPendingReceipt\(/
// 파일 헤더 몇 바이트만 읽는 자리는 대상이 아니다(lib/docMime 의 매직넘버 판독).
const LOOP_ALLOW = ['lib/docMime.ts']

// ⓓ 문자열 인자로 남아도 되는 액션. 손글씨 서명 획 PNG 는 수십 KB 로 유계이고, 그 액션은
// 슬롯 한도 아래(900,000자)에 자체 문을 갖고 있다(app/sign/[token]/actions.ts).
const SIG_ALLOW = ['app/sign/[token]/actions.ts#submitRemoteSignature']
// 사진 바이트를 뜻하는 파라미터 이름들.
const IMG_PARAM = /(b64|base64|dataurl|imagedata)[a-z0-9_]*\s*:\s*string/i
// 'use server' 파일인가 — 첫 유효 줄로 판정(check-server-action-exports 와 같은 방식).
const isUseServer = src => /^\s*(?:'use server'|"use server")/.test(src.replace(/^\uFEFF/, ''))

const violations = []
const files = walk('app', walk('components', walk('lib', [])))

for (const f of files) {
  const src = strip(readFileSync(f, 'utf8'))

  // ⓐ 바이트 루프 금지.
  if (/String\.fromCharCode/.test(src) && !LOOP_ALLOW.includes(f)) {
    violations.push(`${f} 사진을 바이트 루프로 base64 로 만든다. lib/ocrImage 의 fileToOcrImage 를 쓴다(큰 사진에서 탭이 죽는다).`)
  }

  if (!AI_CALLS.test(src)) continue
  if (!/'use client'|"use client"/.test(src)) continue   // 서버 쪽 정의 파일은 대상 아님

  // ⓑ catch 가 있는가.
  if (!/\bcatch\s*[({]/.test(src)) {
    violations.push(`${f} AI 인식 액션을 부르면서 catch 가 없다. 전송이 실패하면 아무 말도 안 나온다.`)
  }
  // ⓒ 축소·상한 정본을 거치는가.
  if (!/from '@\/lib\/ocrImage'/.test(src)) {
    violations.push(`${f} lib/ocrImage 를 안 거친다. 원본을 그대로 보내면 서버 액션 상한에 걸린다.`)
  }

  // ⓔ AI 인식 액션의 첫 인자는 ocrForm(...) 이어야 한다. 문자열이 오면 슬롯 한도에서 터진다.
  //    uploadPendingReceipt 는 종전부터 FormData 를 직접 싸는 자리라 대상에서 뺀다.
  for (const m of src.matchAll(/(analyze(?:IdCard|Contract|Receipt)WithGemini|parseFloorPlanImage)\s*\(\s*([A-Za-z0-9_.]+\(?)/g)) {
    if (!m[2].startsWith('ocrForm(')) {
      violations.push(`${f} ${m[1]} 의 첫 인자가 ocrForm(...) 이 아니다(${m[2]}). 사진 바이트를 문자열로 실으면 서버 액션 인자 디코더가 던진다.`)
    }
  }
}

// ⓓ·ⓕ — 파일 단위 축.
for (const f of files) {
  const src = strip(readFileSync(f, 'utf8'))

  // ⓕ 정본이 base64 문자열을 만들지 않는가.
  if (f === 'lib/ocrImage.ts' && /toDataURL|readAsDataURL/.test(src)) {
    violations.push(`${f} base64 문자열을 만든다. 사진 바이트는 FormData 파일로만 싣는다(ocrForm).`)
  }

  // ⓓ 서버 액션 시그니처에 사진 base64 문자열 파라미터가 있는가.
  if (!isUseServer(src)) continue
  for (const m of src.matchAll(/export\s+async\s+function\s+([A-Za-z0-9_]+)\s*\(/g)) {
    // 여는 괄호부터 짝 닫는 괄호까지 통째로 뜬다 — 여러 줄 시그니처를 한 줄 정규식이 놓친다.
    let depth = 0, i = m.index + m[0].length - 1, end = -1
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++
      else if (src[i] === ')') { depth--; if (depth === 0) { end = i; break } }
    }
    if (end < 0) continue
    const params = src.slice(m.index + m[0].length, end)
    if (IMG_PARAM.test(params) && !SIG_ALLOW.includes(`${f}#${m[1]}`)) {
      violations.push(`${f} ${m[1]} 이 사진 base64 를 문자열 인자로 받는다. FormData 로 받고 readOcrImageForm 으로 되읽는다.`)
    }
  }
}

console.log(`[사진 업로드 위생] ${files.length}파일 검사 / 위반 ${violations.length}건`)
for (const v of violations.slice(0, 15)) console.error(`  - ${v}`)
process.exit(violations.length > 0 ? 1 : 0)
