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
// 2026-09-16 에 축이 셋 더 늘었다. 위 여섯은 **AI 에게 보내는** 사진만 보고 있었는데, 같은 종류의
// 사고가 **저장하는** 사진에서 따로 터졌다. 아이폰 HEIC 를 그대로 올리면 사업자등록증은 열리지
// 않는 첨부로 나가고, 도장은 pdf-lib 이 못 읽어 실거주 확인서 발급을 통째로 실패시키며, 계약서는
// 도장 없이 조용히 나간다. 정본은 lib/uploadImage 이고 대상은 AI 호출부가 아니라 **업로드 입구**다.
//
//   ⓖ 업로드 세션을 부르는 화면은 lib/uploadImage 를 거친다.
//   ⓗ 그 화면이 **고른 파일 원본을 그대로** 세션·PUT 에 싣지 않는다(변환 건너뛰기 차단).
//   ⓘ lib/uploadImage 는 디코드 실패에 원본을 돌려주지 않는다(조용한 원본 통과 차단).
//   ⓙ 그 세션을 받는 서버 액션은 mime 화이트리스트를 지난다(HEIC 가 저장되는 길 차단).
//   ⓚ 저장된 도장이 깨져도 서류 발급은 산다(embed 가 try 안에 있다).
//
// ⓚ 가 이 그물에 있는 이유: 사진이 들어오는 문과 그 사진이 쓰이는 문은 같은 사고의 양쪽 끝이다.
// HEIC 도장 하나가 실거주 확인서 발급을 통째로 실패시켰고, 그건 입구를 막아도 이미 저장된
// 파일에는 소용이 없다. 두 문을 같은 자리에서 본다.
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
// 파일을 Drive 에 올리는 입구들(ⓖ~ⓗ). 앱 로고(createAppLogoUploadSession)는 뺀다 — 크롭 모달이
// 캔버스로 다시 그려 PNG 로만 내보내므로 이미 정규화된 자리다.
const UPLOAD_SESSIONS = /create(?:BizCert|Stamp|Logo|ContractScan)UploadSession\s*\(/
// 고른 파일 원본이 그대로 실리는 모양 — 이번에 고친 네 입구가 전부 이 모양이었다.
// (PUT 인자까지 보려면 앱 로고 경로의 지역 변수 이름과 부딪혀 그 자리는 세션 인자로 잰다.)
const RAW_IN_SESSION = /create(?:BizCert|Stamp|Logo|ContractScan)UploadSession\s*\(\s*\{[^}]*fileName:\s*file\.name/
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

  // ⓖ·ⓗ 업로드 입구 — 밖으로 나갈 파일을 만드는 자리는 변환 정본을 거친다.
  if (UPLOAD_SESSIONS.test(src) && /'use client'|"use client"/.test(src)) {
    if (!/from '@\/lib\/uploadImage'/.test(src)) {
      violations.push(`${f} 업로드 세션을 부르면서 lib/uploadImage 를 안 거친다. 아이폰 HEIC 가 그대로 저장돼 첨부·발급이 깨진다.`)
    }
    if (RAW_IN_SESSION.test(src)) {
      violations.push(`${f} 고른 파일 원본을 그대로 업로드 세션에 싣는다. fileToUploadPdf·fileToUploadImage 가 돌려준 File 을 써야 한다.`)
    }
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

  // ⓘ 변환 정본이 디코드 실패에 원본을 돌려주지 않는가.
  //    lib/ocrImage 는 실패해도 원본을 그대로 보내는 것이 옳다(Gemini 가 HEIC 를 읽는다).
  //    여기는 반대다 — 그 바이트가 **저장**되면 첨부·발급이 깨지므로 던져야 한다.
  if (f === 'lib/uploadImage.ts') {
    if (/catch\s*(?:\([^)]*\))?\s*\{[^}]*return/.test(src)) {
      violations.push(`${f} 디코드 실패 분기에서 원본을 돌려준다. 저장되는 파일이라 실패는 던져야 한다.`)
    }
    if (!/throw new Error\(UPLOAD_DECODE_FAIL\)/.test(src)) {
      violations.push(`${f} 디코드 실패에 사람 말로 던지는 자리가 없다(UPLOAD_DECODE_FAIL).`)
    }
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

// ⓙ 업로드 세션 서버 액션의 mime 문 — 지목한 자리만 본다(파일이 크고 문이 정확히 둘이다).
//    스캔 계약서는 **종전에 이 문이 아예 없어** 크기만 보고 HEIC 를 통과시켰다.
const MIME_GATES = [
  ['app/(app)/settings/actions.ts', 'createBizCertUploadSession', 'BIZ_CERT_MIME_OK'],
  ['app/(app)/tenants/actions.ts', 'createContractScanUploadSession', 'SCAN_MIME_OK'],
]
for (const [file, fn, gate] of MIME_GATES) {
  let src
  try { src = strip(readFileSync(file, 'utf8')) } catch { violations.push(`${file} 를 못 읽는다(ⓙ 대상 파일이 옮겨졌나).`); continue }
  const def = src.match(new RegExp(`const\\s+${gate}\\s*=\\s*\\(([^)]*)\\)\\s*=>([^\\n]*)`))
  if (!def) { violations.push(`${file} ${gate} 정의가 없다. 업로드 mime 화이트리스트가 사라지면 HEIC 가 저장된다.`); continue }
  // 'image/' 전체 허용은 HEIC 를 그대로 들여보낸다 — 이번 사고의 원래 모양이다.
  if (/startsWith\(\s*['"]image\//.test(def[2])) {
    violations.push(`${file} ${gate} 가 image/* 를 통째로 받는다. HEIC 가 저장되면 첨부·발급이 깨진다.`)
  }
  const body = src.slice(src.indexOf(`export async function ${fn}`))
  if (!new RegExp(`${gate}\\s*\\(`).test(body.slice(0, 2000))) {
    violations.push(`${file} ${fn} 이 ${gate} 를 안 지난다. 문을 만들어 두고 안 지나면 없는 것과 같다.`)
  }
}

// ⓚ 저장된 도장이 깨져도 서류는 나가는가 — embed 가 try 안에 있어야 한다.
//    HEIC 도장 하나로 실거주 확인서 발급이 통째로 실패했다(형제 rentReceiptPdf 에는 이미 있던 방어).
for (const file of ['lib/residenceCertOverlay.ts', 'lib/rentReceiptPdf.ts']) {
  let src
  try { src = strip(readFileSync(file, 'utf8')) } catch { violations.push(`${file} 를 못 읽는다(ⓚ 대상 파일이 옮겨졌나).`); continue }
  if (!/embed(?:Png|Jpg)\s*\(/.test(src)) continue   // 도장을 안 얹게 됐으면 볼 것이 없다
  if (!/try\s*\{[^}]*embed(?:Png|Jpg)\s*\(/.test(src)) {
    violations.push(`${file} 도장 임베드가 try 밖에 있다. 도장 하나가 깨지면 서류 발급 전체가 실패한다.`)
  }
}

console.log(`[사진 업로드 위생] ${files.length}파일 검사 / 위반 ${violations.length}건`)
for (const v of violations.slice(0, 15)) console.error(`  - ${v}`)
process.exit(violations.length > 0 ? 1 : 0)
