// 참고용 번역본의 서버 배선을 지키는 감지망. 읽기 전용, 위반 시 exit 1.
//
// 순수 함수(파서·해석·고아·병합)는 진리표가 지킨다(test-contract-translation).
// 여기는 **배선**만 본다 — 진리표가 못 보는 자리다.
//
//   ⓐ 링크 발급이 그 링크의 언어로 번역본을 해석해 스냅샷에 담는다. 안 담으면 서명 화면이
//     읽을 근거가 없고, 나중에 "무엇을 보여줬나"를 아무도 말할 수 없다.
//   ⓑ 그 담기가 **조건부**다. 번역본이 없을 때 null 을 박으면 번역본을 안 쓰는 영업장의 링크
//     스냅샷이 이 기능 전과 달라진다(무회귀 게이트가 여기서 깨진다).
//   ⓒ 서명 동결이 번역본을 승계한다. 안 하면 서명 당시 문안이 증거로 안 남는다.
//   ⓓ 드리프트 비교가 링크 언어로 지금 번역본을 다시 해석해 견준다. 안 하면 curFacts 쪽이 늘
//     비어 **번역본이 실린 링크 전건이 오경보**로 뜬다.
//   ⓔ printedFacts 의 번역 축이 '없으면 undefined' 규칙을 지킨다. 빈 값을 박으면 옛 박제 전건이
//     드리프트로 뜬다(추가 서류·특약 축과 같은 규칙).
//   ⓕ 설정 저장이 병합 정본만 지난다. 통째 덮어쓰기를 열면 고아 번역이 조용히 사라진다.
//
// 실행: node scripts/check-contract-translation-axis.mjs
import { readFileSync } from 'node:fs'

const strip = s => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')
const read = f => strip(readFileSync(f, 'utf8')).replace(/^\s*import\s[^\n]*$/gm, '')

const violations = []

/** 함수 본문. 반환 타입 주석의 `{` 를 본문으로 착각하지 않는다(형제 그물들과 같은 규칙). */
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

// ⓐ·ⓑ·ⓓ — 링크 발급과 드리프트 비교
{
  const f = 'app/(app)/tenants/contractShare.ts'
  const src = read(f)

  const issue = fnBody(src, src.indexOf('export async function issueContractShareLink'))
  if (issue.length < 500) violations.push(`${f} — issueContractShareLink 본문을 못 떴다. 구조가 바뀌었으면 이 그물부터 고친다.`)
  else {
    if (!/resolveContractTranslation\(/.test(issue) || !/asTranslationLang\(signLang\)/.test(issue)) {
      violations.push(`${f} — ⓐ 발급이 그 링크의 언어로 번역본을 해석하지 않는다. 서명 화면이 읽을 근거가 스냅샷에 안 남는다.`)
    }
    // 조건부 스프레드여야 한다. `translation,` 이나 `translation: translation` 은 null 을 박는다.
    if (!/\.\.\.\(translation \? \{ translation \} : \{\}\)/.test(issue)) {
      violations.push(`${f} — ⓑ 번역본을 조건부로 안 담는다. 번역본 없는 영업장의 링크 스냅샷이 이 기능 전과 달라진다.`)
    }
  }

  const drift = fnBody(src, src.indexOf('export async function checkContractShareDrift'))
  if (drift.length < 300) violations.push(`${f} — checkContractShareDrift 본문을 못 떴다. 구조가 바뀌었으면 이 그물부터 고친다.`)
  else {
    if (!/resolveContractTranslation\(/.test(drift) || !/translation: currentTranslation/.test(drift)) {
      violations.push(`${f} — ⓓ 드리프트 비교가 지금 번역본을 다시 해석해 넣지 않는다. 번역본이 실린 링크 전건이 오경보로 뜬다.`)
    }
  }
}

// ⓒ — 서명 동결
{
  const f = 'app/sign/[token]/actions.ts'
  const src = read(f)
  const submit = fnBody(src, src.indexOf('export async function submitRemoteSignature'))
  if (submit.length < 500) violations.push(`${f} — submitRemoteSignature 본문을 못 떴다. 구조가 바뀌었으면 이 그물부터 고친다.`)
  else if (!/translation:\s*\(snap\.translation \?\? null\)/.test(submit)) {
    violations.push(`${f} — ⓒ 서명 동결이 번역본을 승계하지 않는다. 서명 당시 보여준 문안이 증거로 안 남는다.`)
  }
}

// ⓔ — 인쇄 사실 사영의 축
{
  const f = 'lib/contractPrintedFacts.ts'
  const src = read(f)
  if (!/'translation',/.test(src)) {
    violations.push(`${f} — ⓔ PRINTED_FACT_KEYS 에 translation 축이 없다. 번역이 바뀌어도 드리프트가 침묵한다.`)
  }
  if (!/translation:\s*d\.translation \? JSON\.stringify\(d\.translation\) : undefined/.test(src)) {
    violations.push(`${f} — ⓔ 번역 축이 '없으면 undefined' 규칙을 안 지킨다. 이 칸을 모르는 옛 박제 전건이 드리프트로 뜬다.`)
  }
}

// ⓖ — 발급 상세 시트. 축을 늘리면 이 시트가 **전건에** 줄을 하나 더 그린다.
{
  const f = 'components/doc/IssuedContractSheet.tsx'
  const src = read(f)
  if (!/k !== 'translation'/.test(src)) {
    violations.push(`${f} — ⓖ 표시값 표가 번역 축을 안 걸러낸다. 번역본을 안 쓰는 발급본 전건의 시트에 '기록 없음' 빈 줄이 는다.`)
  }
  if (!/snap\.facts\.translation !== undefined/.test(src)) {
    violations.push(`${f} — ⓖ 번역본이 실린 발급본에만 줄을 세우는 조건이 없다. 쓰기만 하고 안 읽는 축이 되거나 전건에 빈 줄이 선다.`)
  }
}

// ⓕ — 설정 저장의 병합 정본
{
  const f = 'app/(app)/settings/actions.ts'
  const src = read(f)

  const onOff = fnBody(src, src.indexOf('export async function setContractTranslationEnabled'))
  if (onOff.length < 200) violations.push(`${f} — setContractTranslationEnabled 본문을 못 떴다. 구조가 바뀌었으면 이 그물부터 고친다.`)
  else if (!/withTranslationEnabled\(cur\?\.contractTranslations/.test(onOff)) {
    violations.push(`${f} — ⓕ 운영 스위치가 병합 정본을 안 지난다. 토글 한 번이 언어 사전을 통째로 덮는다.`)
  }

  const saveLang = fnBody(src, src.indexOf('export async function saveContractTranslationLang'))
  if (saveLang.length < 200) violations.push(`${f} — saveContractTranslationLang 본문을 못 떴다. 구조가 바뀌었으면 이 그물부터 고친다.`)
  else {
    if (!/mergeTranslationLang\(cur\?\.contractTranslations/.test(saveLang)) {
      violations.push(`${f} — ⓕ 사전 저장이 병합 정본을 안 지난다. 화면이 안 보낸 고아 번역이 조용히 사라진다.`)
    }
    if (!/asTranslationLang\(input\.lang\)/.test(saveLang)) {
      violations.push(`${f} — ⓕ 언어를 화이트리스트로 안 거른다. 한국어나 아무 문자열로 고아 사전이 쌓인다.`)
    }
  }
  // 읽고-병합-쓰기는 인터랙티브 트랜잭션이어야 한다. 아니면 두 저장이 겹칠 때 나중 쓰기가
  // 먼저 것을 통째로 덮는다(Json 병합 유실 클래스, check-sign-documents-axis ⓕ 와 같은 규칙).
  for (const [name, body] of [['setContractTranslationEnabled', onOff], ['saveContractTranslationLang', saveLang]]) {
    if (body.length >= 200 && !/\$transaction\(async tx =>/.test(body)) {
      violations.push(`${f} — ⓕ ${name} 이 읽고-병합-쓰기를 트랜잭션으로 안 묶는다. 동시 저장에서 나중 쓰기가 먼저 것을 덮는다.`)
    }
  }
}

if (violations.length) {
  console.error('참고용 번역본 배선 위반:')
  for (const v of violations) console.error(`  - ${v}`)
  process.exit(1)
}
console.log('참고용 번역본 배선: 이상 없음 (발급 박제 · 조건부 · 서명 동결 · 드리프트 · 축 · 발급 시트 · 병합 정본)')
