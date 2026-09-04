// 종이에 찍히는 성명이 서버가 정한 한 값에서만 나오는지 보는 감지망. 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가(2026-09-04, 413호 실측). 발급된 계약서에서 한 종이 안의 이름이 갈렸다.
// 상단 정보 표는 '쩐 티 투 창'(한글), 서명란 옆은 'Tran Thi Thu Trang'(영문).
// 정보 표는 서버가 계산하고 서명란은 클라이언트가 보낸 signatureName 이었기 때문이다.
//
// 자유 입력이 위험한 이유는 고칠 수 있다는 것보다 **무엇으로 고쳤는지 안 남는다**는 것이다.
// printedFacts 에 서명란 축이 없어 발급본 박제는 정보 표 이름만 기록한다. 법적 서류에서
// "고칠 수 있는데 기록은 안 남는다"는 가장 나쁜 조합이다.
//
//   ⓐ 발급 API 와 인쇄 HTML 의 타입에 signatureName 통로가 없다.
//   ⓑ 종이의 서명란 두 자리가 tenant.name 을 읽는다(한 자리만 되돌려도 잡히게 따로 본다).
//   ⓒ 화면에 자유 입력 state 가 없다.
//   ⓓ 표기 셀렉트가 서명본 화면에는 안 선다(눌러도 저장이 거절되는 자리다).
//
// 실행: node scripts/check-signature-name-server.mjs
import { readFileSync } from 'node:fs'

const strip = s => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, m => m.replace(/[^\n]/g, ''))
const read = f => strip(readFileSync(f, 'utf8')).replace(/^\s*import\s[^\n]*$/gm, '')

const violations = []

// ⓐ 통로 자체가 없어야 한다. 필드가 없으면 클라이언트 값이 흐를 길이 타입 자리에서 사라진다.
for (const f of ['app/api/contract/generate/route.ts', 'lib/contractPrintHtml.ts']) {
  if (/\bsignatureName\b/.test(read(f))) {
    violations.push(`${f} — signatureName 통로가 살아 있다. 클라이언트가 보낸 이름이 종이에 찍히면 정보 표와 갈린다.`)
  }
}

// ⓑ 서명란 두 자리. 계약서 서명란과 동의서 서명란을 따로 본다.
{
  const f = 'lib/contractPrintHtml.ts'
  const src = read(f)
  const marks = [
    [/class="dc-sign-line"[^>]*>\$\{([^}]*)\}/, '동의서 서명란'],
    [/sign-line[\s\S]{0,400}?<span class="val">\$\{([^}]*)\}/, '계약서 서명란'],
  ]
  for (const [rx, label] of marks) {
    const m = src.match(rx)
    if (!m) { violations.push(`${f} — ${label} 조판을 못 찾았다. 구조가 바뀌었으면 이 그물부터 고친다(침묵 통과 금지).`); continue }
    if (!/d\.tenant\.name/.test(m[1])) {
      violations.push(`${f} — ${label}이 서버 값(d.tenant.name)을 안 읽는다. 한 종이 안에서 이름이 갈린다.`)
    }
  }
}

// ⓒ·ⓓ 화면.
{
  const f = 'app/contract/[tenantId]/ContractView.tsx'
  const src = read(f)
  if (/const \[signatureName/.test(src)) {
    violations.push(`${f} — 서명란 자유 입력 state 가 살아 있다. 무엇으로 고쳤는지 기록이 안 남는다.`)
  }
  const picker = src.match(/const nameStylePicker = ([^\n]*)/)?.[1] ?? ''
  if (!picker) violations.push(`${f} — nameStylePicker 를 못 찾았다.`)
  else if (!/signedSnapshot/.test(picker)) {
    violations.push(`${f} — 표기 셀렉트가 서명본 화면에도 선다. 누르면 저장이 거절되는데 화면의 이름만 바뀐다.`)
  }
}

console.log(`[서명란 성명 서버 단일화] ⓐ 통로 · ⓑ 조판 두 자리 · ⓒ 자유 입력 · ⓓ 서명본 셀렉트 / 위반 ${violations.length}건`)
for (const v of violations.slice(0, 15)) console.error(`  - ${v}`)
process.exit(violations.length > 0 ? 1 : 0)
