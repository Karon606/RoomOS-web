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
}

console.log(`[사진 업로드 위생] ${files.length}파일 검사 / 위반 ${violations.length}건`)
for (const v of violations.slice(0, 15)) console.error(`  - ${v}`)
process.exit(violations.length > 0 ? 1 : 0)
