// 안내 문안이 사전 밖으로 새는 것을 잡는 그물. 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가(2026-09-06). 입주자 노출 문자열을 lib/signGuideText 사전으로 전량 이관했다.
// 하드코딩이 하나라도 되돌아오면 그 문장만 번역이 없어 그 언어 입주자에게 한국어 단독으로
// 뜬다 — 눈에 안 띄어 아무도 모른다. 그래서 /sign 세 파일은 한글 리터럴 자체를 봉인한다.
//
//   ⓐ /sign 세 파일의 한글 조각은 허용 목록(주석·운영자 푸시 문안)뿐이어야 한다.
//     **주석을 안 지우고 전체를 스캔한다** — 주석은 목록에 올리면 되고, 지우다 실수하면
//     문자열 안 // 가 코드째 사라진다.
//   ⓑ ContractView 원격 분기에서 이관이 끝난 문장이 리터럴로 되살아나면 잡는다.
//     이 트립와이어는 **새 문장의 유입은 못 잡는다**(운영자 문자열과 섞인 파일이라 전량
//     봉인이 불가능하다). 잡는 범위를 정직하게 적어 둔다.
//   ⓒ 세 파일이 사전을 실제로 부른다(bi/biLine/t — import 만으로는 통과 못 한다).
//
// 실행: node scripts/check-sign-guide-wiring.mjs
import { readFileSync } from 'node:fs'

const violations = []

// ⓐ 한글 봉인 — 허용 목록 밖의 한글 조각이 생기면 실패.
const ALLOW_FRAGMENTS = new Set([
  // 운영자에게 가는 웹푸시 — 입주자 표면이 아니라 사전 대상이 아니다(설계 7절).
  '입주자', '계약서 서명 제출', '님이 입실 계약서에 서명했습니다',
])
for (const f of ['app/sign/[token]/page.tsx', 'app/sign/[token]/BirthdateGate.tsx', 'app/sign/[token]/actions.ts']) {
  // 블록 주석({/* */}·/** */)만 지운다 — 줄 구조는 유지(빈칸 치환). // 는 안 지운다(위 주석).
  const src = readFileSync(f, 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, m => m.replace(/[^\n]/g, ' '))
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  for (const [i, line] of src.split('\n').entries()) {
    const frags = [...line.matchAll(/[가-힣][가-힣 .,·()?!']*[가-힣.]/g)].map(m => m[0].trim())
    if (frags.length === 0) continue
    // 주석 줄·코드 뒤 주석은 허용 — 한글이 // 뒤에만 있는지 본다.
    const at = line.indexOf('//')
    const codePart = at >= 0 ? line.slice(0, at) : line
    for (const fr of [...codePart.matchAll(/[가-힣][가-힣 .,·()?!']*[가-힣.]/g)].map(m => m[0].trim())) {
      // 꼬리 문장부호는 떼고 대조한다 — '…했습니다' 와 '…했습니다.' 가 다른 조각이 되지 않게.
      if (!ALLOW_FRAGMENTS.has(fr.replace(/[.,·?!']+$/, ''))) {
        violations.push(`${f}:${i + 1} — 한글 리터럴 "${fr}" 이 사전 밖에 있다. 이 문장은 그 언어 입주자에게 한국어 단독으로 뜬다.`)
      }
    }
  }
}

// ⓑ ContractView 트립와이어 — 이관이 끝나 리터럴로 남아 있으면 안 되는 문장들.
{
  const f = 'app/contract/[tenantId]/ContractView.tsx'
  const src = readFileSync(f, 'utf8')
  for (const needle of [
    '서명하러 가기', '계약서를 제출할까요?', '제출하면 이 링크는 닫힙니다',
    '아직 하나 남았습니다', '모두 완료됐습니다.\'', '서류가 두 장 있습니다',
    '남았습니다\'', 'of 2 signed', 'signature required', 'signatures required',
  ]) {
    if (src.includes(needle)) {
      violations.push(`${f} — 이관이 끝난 문장 "${needle}" 이 리터럴로 되살아났다. 사전(t/bi)을 지나야 한다.`)
    }
  }
}

// ⓒ 사전을 실제로 부르는가.
for (const [f, fn] of [
  ['app/sign/[token]/page.tsx', 'bi('],
  ['app/sign/[token]/BirthdateGate.tsx', 'bi('],
  ['app/sign/[token]/actions.ts', 'bi('],
  ['app/contract/[tenantId]/ContractView.tsx', 'biLine('],
]) {
  const src = readFileSync(f, 'utf8').replace(/^\s*import\s[^\n]*$/gm, '')
  if (!src.includes(fn)) violations.push(`${f} — 사전(${fn})을 안 부른다. 안내가 한국어 하드코딩으로 되돌아갔다는 뜻이다.`)
}

console.log(`[안내 문안 배선] ⓐ 한글 봉인 · ⓑ 재유입 트립와이어 · ⓒ 사전 호출 / 위반 ${violations.length}건`)
for (const v of violations.slice(0, 10)) console.error(`  - ${v}`)
process.exit(violations.length > 0 ? 1 : 0)
