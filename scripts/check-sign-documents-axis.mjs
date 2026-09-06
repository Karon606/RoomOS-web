// 추가 서류(제3 서류)의 서버 배선을 지키는 감지망. 읽기 전용, 위반 시 exit 1.
//
// 순수 함수(정본·이력·인쇄)는 진리표가 지킨다(test-sign-documents·test-contract-void·
// test-print-companion). 여기는 **서버 액션의 배선**만 본다 — 진리표가 못 보는 자리다.
//
//   ⓐ 서명 동결(newSnapshot)이 서류 목록을 담는다. 안 담으면 서명 뒤 재발급에서 그 장이 사라진다.
//   ⓑ 제출 저장이 커스텀 key 를 스냅샷 화이트리스트로 거른다. 안 거르면 아무 문자열로 고아
//     데이터를 쌓을 수 있다.
//   ⓒ moveVersion(폐기)이 documentSignatures 를 비운다. 안 비우면 폐기 뒤 재서명에서 옛 커스텀
//     서명이 새 버전에 눌어붙는다. 그리고 비우기는 Prisma.DbNull 이어야 한다({ set: null } 함정).
//   ⓓ 되돌리기가 documentSignatures 를 다시 쓴다.
//   ⓔ 이어받기(renew)가 docSignedAt 을 승계한다.
//   ⓕ 커스텀 저장이 인터랙티브 트랜잭션에서 읽고-병합-쓴다(통째 덮어쓰기 금지).
//
// 실행: node scripts/check-sign-documents-axis.mjs
import { readFileSync } from 'node:fs'

const strip = s => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')
const read = f => strip(readFileSync(f, 'utf8')).replace(/^\s*import\s[^\n]*$/gm, '')

const violations = []

/** 함수 본문. 반환 타입 주석의 `{` 를 본문으로 착각하지 않는다(check-sign-progress-axis 와 같은 규칙). */
function fnBody(src, at) {
  if (at < 0) return ''
  const m = /\{[^\S\n]*\n/g
  m.lastIndex = at
  const open = m.exec(src)
  if (!open) return ''
  let depth = 0
  for (let i = open.index; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open.index, i + 1) }
  }
  return src.slice(open.index)
}

// ⓐ·ⓑ·ⓕ — /sign 액션
{
  const f = 'app/sign/[token]/actions.ts'
  const src = read(f)
  const submit = fnBody(src, src.indexOf('export async function submitRemoteSignature'))
  if (submit.length < 500) violations.push(`${f} — submitRemoteSignature 본문을 못 떴다(${submit.length}자). 구조가 바뀌었으면 이 그물부터 고친다.`)
  else {
    if (!/signDocuments:\s*\(snap\.signDocuments \?\? \[\]\)/.test(submit)) {
      violations.push(`${f} — ⓐ 서명 동결이 서류 목록을 안 담는다. 서명 뒤 재발급에서 그 장이 통째로 사라진다.`)
    }
    if (!/snapDocKeys/.test(submit) || !/isValidDocKey\(target\)/.test(submit)) {
      violations.push(`${f} — ⓑ 커스텀 key 를 스냅샷 화이트리스트로 안 거른다. 아무 문자열로 고아 데이터가 쌓인다.`)
    }
    if (!/parseDocumentSignatures\(cur\?\.documentSignatures\)/.test(submit)) {
      violations.push(`${f} — ⓕ 커스텀 저장이 저장본을 읽어 병합하지 않는다. 동시 서명에서 나중 쓰기가 먼저 것을 덮는다.`)
    }
  }
}

// ⓒ·ⓓ — 폐기·되돌리기
{
  const f = 'app/contract/[tenantId]/actions.ts'
  const src = read(f)
  const move = fnBody(src, src.indexOf('async function moveVersion'))
  if (move.length < 500) violations.push(`${f} — moveVersion 본문을 못 떴다. 구조가 바뀌었으면 이 그물부터 고친다.`)
  else if (!/documentSignatures:\s*Prisma\.DbNull/.test(move)) {
    violations.push(`${f} — ⓒ 폐기가 documentSignatures 를 DbNull 로 안 비운다. 옛 커스텀 서명이 새 버전에 눌어붙는다.`)
  }
  if (!/documentSignatures:\s*f\.documentSignatures/.test(src)) {
    violations.push(`${f} — ⓓ 되돌리기가 documentSignatures 를 다시 안 쓴다. 복원된 버전에서 커스텀 서명만 빠진다.`)
  }
}

// ⓔ — 이어받기 승계
{
  const f = 'app/(app)/tenants/contractShare.ts'
  const src = read(f)
  const renew = fnBody(src, src.indexOf('export async function renewContractShareLink'))
  if (renew.length < 500) violations.push(`${f} — renewContractShareLink 본문을 못 떴다. 구조가 바뀌었으면 이 그물부터 고친다.`)
  else if (!/docSignedAt:\s*old\.docSignedAt/.test(renew)) {
    violations.push(`${f} — ⓔ 이어받기가 docSignedAt 을 승계하지 않는다. 커스텀만 서명한 링크가 새 링크에서 '서명 전'으로 읽힌다.`)
  }
}

console.log(`[추가 서류 축] ⓐ 동결 · ⓑ 화이트리스트 · ⓒ 폐기 비움 · ⓓ 복원 · ⓔ 승계 · ⓕ 병합 저장 / 위반 ${violations.length}건`)
for (const v of violations) console.error(`  - ${v}`)
process.exit(violations.length > 0 ? 1 : 0)
