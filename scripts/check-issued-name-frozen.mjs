// 발급본 성명 표기가 발급 시점에 박제되고 이후 재해석되지 않는지 보는 감지망. 위반 시 exit 1.
//
// 왜 필요한가(신고 2026-09-04, 413호). 입주자가 영문 계약서 화면에서 서명했는데 발급본은
// 한글로 나갔다. 서명 후 경로가 contractLeaseFields 의 병합값을 읽었기 때문이다. 그 값은
// 자동값 'ko' 가 깔려 있어 **"안 골랐음"과 "한글을 골랐음"이 같은 답**이 된다.
// 운영자 원칙은 "발행한 계약서는 손대면 안 되지"다.
//
// 그리고 뇌가 둘이었다. 화면은 buildContractData 의 해석값을, 종이는 병합값을 따로 계산했다.
//
//   ⓔ 서명 후 분기가 signedDocNameStyle 을 부르고 병합값(fields.nameStyle)을 안 읽는다.
//   ⓕ 발급 API 가 표기를 손계산하지 않는다. 종이와 태그가 같은 변수에서 나온다.
//   ⓖ 서명 시점 박제가 표기와 인쇄 문자열을 담는다.
//   ⓗ signedDocNameStyle 의 인자에 재해석 입력(국적·형제·available)이 없다.
//
// **import 만 있고 안 쓰는 것은 통과가 아니다.** 오늘 다른 그물이 정확히 그렇게 뚫렸다.
// 그래서 각 축은 import 줄을 지운 뒤 값이 실제로 흐르는 자리를 본다.
//
// 실행: node scripts/check-issued-name-frozen.mjs
import { readFileSync } from 'node:fs'

const strip = s => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')
const read = f => strip(readFileSync(f, 'utf8')).replace(/^\s*import\s[^\n]*$/gm, '')

const violations = []

// ⓔ 서명 후 분기 — 삼항의 참쪽만 떠서 본다.
{
  const f = 'lib/contractData.ts'
  const src = read(f)
  const at = src.indexOf('signedAlready')
  const branch = at < 0 ? '' : src.slice(at, src.indexOf(': resolveDocNameStyle', at))
  if (!branch) {
    violations.push(`${f} — 서명 후 분기를 못 찾았다. 구조가 바뀌었으면 이 그물부터 고친다(침묵 통과 금지).`)
  } else {
    if (!/signedDocNameStyle\s*\(/.test(branch)) {
      violations.push(`${f} — 서명 후 분기가 signedDocNameStyle 을 안 부른다. 서명한 종이의 표기가 다시 해석된다.`)
    }
    if (/fields\??\.\s*nameStyle/.test(branch)) {
      violations.push(`${f} — 서명 후 분기가 병합값(fields.nameStyle)을 읽는다. 자동값 'ko' 가 "안 골랐음"을 덮는다.`)
    }
  }
}

// ⓕ 발급 API — 종이와 태그가 한 변수에서 나오는가.
{
  const f = 'app/api/contract/generate/route.ts'
  const src = read(f)
  const m = src.match(/const printedTenantName = documentName\(tenant,\s*([A-Za-z0-9_.?]+)/)
  if (!m) violations.push(`${f} — printedTenantName 조립을 못 찾았다.`)
  else if (!/^printedNameStyle$/.test(m[1])) {
    violations.push(`${f} — 종이 이름이 정본이 아닌 값(${m[1]})으로 조립된다. 화면과 종이가 갈린다.`)
  }
  if (!/contractNameStyle\s*\(/.test(src)) {
    violations.push(`${f} — contractNameStyle 정본을 안 부른다. 발급이 표기를 손계산하면 화면과 갈린다.`)
  }
  if (/nameStyle:\s*leaseFields\??\.\s*nameStyle/.test(src)) {
    violations.push(`${f} — 발급본 태그가 병합값으로 저장된다. 태그와 종이가 갈린다.`)
  }
  const tag = src.match(/nameStyle:\s*([A-Za-z0-9_]+),/)
  if (tag && tag[1] !== 'printedNameStyle') {
    violations.push(`${f} — 태그(${tag[1]})가 종이와 다른 변수에서 나온다. 한 변수여야 갈리지 않는다.`)
  }
}

// ⓖ 서명 시점 박제 — 표기와 인쇄 문자열을 담는가.
for (const [f, label] of [
  ['app/sign/[token]/actions.ts', '원격 서명'],
  ['app/api/contract/generate/route.ts', '대면 서명'],
]) {
  const src = read(f)
  const at = src.indexOf('signedContractSnapshot')
  const blk = at < 0 ? '' : src.slice(at, at + 2000)
  if (!blk) { violations.push(`${f} — ${label} 박제 블록을 못 찾았다.`); continue }
  if (!/\bnameStyle:/.test(blk)) violations.push(`${f} — ${label} 박제에 nameStyle 이 없다. 그때 무엇을 봤는지 안 남는다.`)
  if (!/\bprintedName:/.test(blk)) violations.push(`${f} — ${label} 박제에 printedName 이 없다. 개명하면 그때 이름을 못 되짚는다.`)
}

// ⓗ 정본 시그니처에 재해석 입력이 없는가 — 타입 자리에서 봉인한다.
{
  const f = 'lib/documentName.ts'
  const src = read(f)
  const at = src.indexOf('SignedNameStyleContext')
  const blk = at < 0 ? '' : src.slice(at, src.indexOf('}', at))
  if (!blk) violations.push(`${f} — SignedNameStyleContext 를 못 찾았다.`)
  else for (const bad of ['nationality', 'siblings', 'available', 'hasForeignRegNo']) {
    if (new RegExp(`\\b${bad}\\b`).test(blk)) {
      violations.push(`${f} — signedDocNameStyle 인자에 ${bad} 가 있다. 서명 뒤에는 재해석하지 않는다는 계약이 깨진다.`)
    }
  }
}

console.log(`[발급본 표기 박제] 축 ⓔ 서명 후 · ⓕ 발급 정본 · ⓖ 서명 박제 · ⓗ 재해석 봉인 / 위반 ${violations.length}건`)
for (const v of violations.slice(0, 15)) console.error(`  - ${v}`)
process.exit(violations.length > 0 ? 1 : 0)
