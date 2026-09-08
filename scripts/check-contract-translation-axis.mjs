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

// ── 2단계 배선(화면·종이) ──────────────────────────────────────────
//
//   ⓗ 서명 화면 카드가 **박제**를 읽고 그 칸이 없으면 안 그린다. 지금 사전을 다시 해석하면
//     입주자가 본 문안과 화면이 갈리고, 그 순간 박제는 증거이기를 그만둔다.
//   ⓘ 그 카드에 읽음 확인 요소가 없다. 체크박스·입력·서명 어느 것도 두면 안 된다 —
//     번역본에 효력을 준 것처럼 읽히면 안 된다는 것이 법률 관점의 판정이다.
//   ⓙ 우선 조항이 화면과 인쇄 **양쪽에** 같은 판정으로 붙는다. 한쪽만 붙이면 미리보기와
//     종이가 갈리고, 조건을 호출부마다 손으로 적으면 언젠가 다른 조건이 된다.
//   ⓚ 박제본이 번역본을 물려준다(resolveSignedBody). 안 하면 서명 뒤 재발급에서 우선 조항이
//     통째로 사라진다(형제 특약 둘과 같은 클래스).
//   ⓛ ContractData 가 **없으면 칸 자체를 안 만든다**. null 을 담으면 그 값이 링크 발급의
//     templateSnapshot 으로 흘러가 번역본을 안 쓰는 영업장의 스냅샷이 이 기능 전과 달라진다.
//     이 단계 무회귀의 급소다.
//   ⓜ 발급이 번역 축을 종이·박제 양쪽에 같은 값으로 싣는다.
//   ⓝ 발급 상세가 박제 전문을 **같은 컴포넌트**로 연다. 두 벌을 만들면 운영자가 보는 문안과
//     입주자가 본 문안이 언젠가 갈린다.
//   ⓞ 발급 피커의 캡션이 고르는 것을 막지 않는다(운영자 오더 — 캡션만이다).

// ⓗ·ⓙ — 서명 화면 카드와 화면 쪽 우선 조항
{
  const f = 'app/contract/[tenantId]/ContractView.tsx'
  const src = read(f)
  // 원천은 박제 하나다. 파서를 한 번 태운 값(translation)으로 카드와 절이 **같은 판정**을 쓴다 —
  // 둘이 다른 값을 보면 카드는 떴는데 종이에 우선 조항이 없는 상태가 생긴다.
  if (!/const translation = asResolvedContractTranslation\(data\.translation\)/.test(src)) {
    violations.push(`${f} — ⓗ 박제를 파서 정본으로 안 읽는다. 원격 화면의 data 는 공개 링크 JSON 을 통째로 캐스팅한 것이라, 모양이 아닌 값에서 화면이 깨진다.`)
  }
  if (!/remote && translation &&/.test(src) || !/<ContractTranslationCard/.test(src)) {
    violations.push(`${f} — ⓗ 번역본 카드가 원격 화면에서 박제를 조건으로 서지 않는다. 카드가 안 뜨거나 번역본 없는 링크에도 빈 카드가 선다.`)
  }
  if (/resolveContractTranslation\(/.test(src)) {
    violations.push(`${f} — ⓗ 화면이 사전을 다시 해석한다. 표시 원천은 박제 하나여야 한다(입주자가 본 문안과 갈리면 증거가 무너진다).`)
  }
  if (!/appendSubLeaseAddendum\([^\n]*contractTranslationAddendum\(translation\)\)/.test(src)) {
    violations.push(`${f} — ⓙ 화면 종이에 우선 조항 호출부가 없다. 입주자가 서명하는 종이에 '한국어 원본이 우선한다'는 근거가 안 실린다.`)
  }
}

// ⓘ — 카드에 읽음 확인이 없다
{
  const f = 'components/doc/ContractTranslationView.tsx'
  const raw = readFileSync(f, 'utf8')
  const src = read(f)
  for (const [pat, what] of [
    [/type=["']checkbox["']/, '체크박스'],
    [/<input/, '입력칸'],
    [/onSubmit/, '제출 핸들러'],
    [/SignaturePad/, '서명 패드'],
  ]) {
    if (pat.test(src)) {
      violations.push(`${f} — ⓘ 번역본 카드에 읽음 확인 요소(${what})가 있다. 확인을 받으면 번역본에 효력을 준 것으로 읽힌다.`)
    }
  }
  // 서명 진행 판정과 **무관**해야 한다 — 슬롯을 건드리면 번역본이 제출 게이트의 일부가 된다.
  if (/disposalSignGate|signStageSlots|missingSlots|submitRemoteSignature/.test(raw)) {
    violations.push(`${f} — ⓘ 카드가 서명 진행·제출 게이트를 참조한다. 번역본은 서명 슬롯과 무관해야 한다.`)
  }
  // 지금 사전을 다시 해석하지 않는다 — 파서만 쓴다.
  if (/resolveContractTranslation\(|parseContractTranslations\(/.test(raw)) {
    violations.push(`${f} — ⓘ 카드가 사전을 다시 해석한다. 박제된 해석 완료본만 읽어야 한다.`)
  }
}

// ⓙ — 인쇄 쪽 우선 조항
{
  const f = 'lib/contractPrintHtml.ts'
  const src = read(f)
  if (!/appendSubLeaseAddendum\([^\n]*contractTranslationAddendum\(asResolvedContractTranslation\(d\.translation\)\)\)/.test(src)) {
    violations.push(`${f} — ⓙ 인쇄 종이에 우선 조항 호출부가 없다. 화면에는 있고 발급 PDF 에는 없는 절이 생긴다.`)
  }
}

// ⓚ — 박제본 승계
{
  const f = 'lib/contract.ts'
  const src = read(f)
  if (!/translation:\s*snap\.translation \?\? null/.test(src)) {
    violations.push(`${f} — ⓚ resolveSignedBody 가 박제본의 번역본을 안 물려준다. 서명 뒤 재발급에서 우선 조항이 사라진다.`)
  }
}

// ⓛ — ContractData 의 조건부 담기(무회귀 급소)
{
  const f = 'lib/contractData.ts'
  const src = read(f)
  if (!/asResolvedContractTranslation\(body\.translation\)/.test(src)) {
    violations.push(`${f} — ⓛ 박제본의 번역본을 안 읽는다. 서명이 끝난 계약서의 화면과 종이가 갈린다.`)
  }
  // 조건부 스프레드여야 한다. `translation,` 이나 `translation: x ?? null` 은 칸을 만든다.
  if (!/\.\.\.\(translationFrozen \? \{ translation: translationFrozen \} : \{\}\)/.test(src)) {
    violations.push(`${f} — ⓛ 번역본을 조건부로 안 담는다. 이 값이 링크 스냅샷으로 흘러가므로, 번역본 없는 영업장의 스냅샷이 이 기능 전과 달라진다.`)
  }
}

// ⓜ — 발급이 종이와 박제에 같은 값을 싣는다
{
  const f = 'app/api/contract/generate/route.ts'
  const src = read(f)
  if (!/translation: body_\.translation/.test(src)) {
    violations.push(`${f} — ⓜ 인쇄 데이터에 번역본이 안 실린다. 발급 PDF 에만 우선 조항이 빠진다.`)
  }
  if (!/translation: printData\.translation/.test(src)) {
    violations.push(`${f} — ⓜ 발급본 박제에 번역 축이 안 실린다. 발급 상세가 읽을 기록이 없어 '전문 보기'가 영영 안 뜬다.`)
  }
}

// ⓝ — 발급 상세의 전문 열람
{
  const f = 'components/doc/IssuedContractSheet.tsx'
  const src = read(f)
  if (!/<ContractTranslationBody/.test(src)) {
    violations.push(`${f} — ⓝ 전문 열람이 공용 본문 컴포넌트를 안 쓴다. 운영자가 보는 문안과 입주자가 본 문안이 갈린다.`)
  }
  if (!/asResolvedContractTranslation\(/.test(src)) {
    violations.push(`${f} — ⓝ 박제를 파서 정본으로 안 읽는다. 모양이 아닌 옛 기록에서 화면이 깨진다.`)
  }
}

// ⓞ — 피커 캡션은 막지 않는다
{
  const f = 'components/doc/SignRequestLangPicker.tsx'
  const src = read(f)
  if (!/translationProgress\(/.test(src)) {
    violations.push(`${f} — ⓞ 언어별 번역 진행을 안 보여준다. 운영자가 반쯤 번역된 언어로 링크를 보내고도 모른다.`)
  }
  if (/disabled/.test(src)) {
    violations.push(`${f} — ⓞ 피커가 언어를 막는다. 미완인 언어로 보낼지는 운영자가 정한다(캡션만이다).`)
  }
}

// ── 3단계 배선(외부 번역기 왕복·고아 목록) ──────────────────────────
//
//   ⓟ 복사와 되붙이기가 **같은 lines 한 벌**을 판정 정본에 넘긴다. 두 벌로 세면 창은
//     "26줄이어야 합니다"라 적어 놓고 복사는 27줄을 내주는 상태가 된다.
//   ⓠ 화면이 줄을 손으로 나누지 않는다. 인라인으로 두면 역주입이 안 잡히는 죽은 테스트가 된다.
//   ⓡ 되붙이기가 **저장을 안 부른다**. 화면 상태만 채우고 운영자가 눈으로 본 뒤 저장을 눌러야
//     종이에 실린다 — 기계 번역이 조항 자리를 옮겨 놓은 것을 사람이 한 번은 봐야 한다.
//   ⓢ 고아 목록에 **지우는 길이 없다**. 조항을 되돌리면 그 번역이 저절로 되살아나야 하고,
//     지우면 그 되돌림이 손번역을 다시 치는 일이 된다(1단계 결정).
{
  const f = 'app/(app)/settings/SettingsForm.tsx'
  const src = read(f)
  const card = fnBody(src, src.indexOf('function ContractTranslationCard()'))
  if (card.length < 1000) {
    violations.push(`${f} — ContractTranslationCard 본문을 못 떴다. 구조가 바뀌었으면 이 그물부터 고친다.`)
  } else {
    // ⓟ — 두 방향이 같은 집합을 센다.
    if (!/translationCopyText\(lines\)/.test(card)) {
      violations.push(`${f} — ⓟ 복사가 판정 정본에 화면과 같은 lines 를 안 넘긴다. 복사 줄 수와 기대 줄 수가 갈린다.`)
    }
    if (!/applyTranslationPaste\(lines,/.test(card)) {
      violations.push(`${f} — ⓟ 되붙이기가 판정 정본에 화면과 같은 lines 를 안 넘긴다. 기대 줄 수가 복사한 줄 수와 갈린다.`)
    }
    // ⓠ — 손 파싱 금지. 줄 나누기·개수 대조는 lib/contractTranslation 한 자리에만 있다.
    if (/\.split\(\s*['"`]\\n/.test(card)) {
      violations.push(`${f} — ⓠ 화면이 줄을 손으로 나눈다. 판정은 순수 함수 정본에만 두어야 역주입이 잡힌다.`)
    }
    // ⓢ — 고아를 보여 주기만 한다.
    if (!/orphanTranslationKeys\(/.test(card)) {
      violations.push(`${f} — ⓢ 고아 목록이 정본으로 안 뽑힌다. 어떤 번역이 갈 곳을 잃었는지 화면이 말하지 못한다.`)
    }
    if (/삭제|\bdelete\b/.test(card)) {
      violations.push(`${f} — ⓢ 번역본 카드에 지우는 길이 있다. 고아는 세고 보여 주기만 한다(조항을 되돌리면 되살아나야 한다).`)
    }
  }

  // ⓡ — 되붙이기가 저장을 안 부른다.
  const applyPaste = fnBody(src, src.indexOf('const applyPaste ='))
  if (applyPaste.length < 200) {
    violations.push(`${f} — applyPaste 본문을 못 떴다. 구조가 바뀌었으면 이 그물부터 고친다.`)
  } else {
    if (/saveContractTranslationLang|setContractTranslationEnabled/.test(applyPaste)) {
      violations.push(`${f} — ⓡ 되붙이기가 저장을 부른다. 확인 없이 종이에 실릴 문안이 바뀐다.`)
    }
    if (!/setDraft\(/.test(applyPaste)) {
      violations.push(`${f} — ⓡ 되붙이기가 화면 입력칸을 안 채운다. 채우는 것이 이 창의 유일한 일이다.`)
    }
  }
}

// ── 4단계 배선(자리표시자 치환·가변 절·보호) ────────────────────────
//
//   ⓣ 번역본 본문이 조항의 {{변수}} 를 **종이와 같은 정본·같은 순서로** 치환한다.
//     이것이 배포돼 있던 결함이다 — 카드가 stripClauseBullet 만 불러 `{{청소비조항}}` 이
//     글자 그대로 떴다(제기역점 저장 본문에 실재). 순서도 축이다: 치환이 먼저, 글머리 제거가
//     나중이라야 값이 글머리로 시작하는 조항에서 종이와 안 갈린다.
//   ⓤ 절 번호를 **손으로 세지 않는다.** 종이와 같은 정본(appendSubLeaseAddendum)이 매겨야
//     "몇 조 몇 항"이 두 종이에서 같은 줄을 가리킨다.
//   ⓥ 서명 화면이 카드에 **종이가 쓰는 그 vars** 를 넘긴다. 다른 값을 만들어 넘기면 같은
//     화면 위아래에서 두 금액이 싸운다.
//   ⓦ 발급·드리프트가 **그 계약에 실린 절만** 넘긴다. 안 넘기면 특약 번역이 박제에서 통째로
//     빠지고, 한쪽만 넘기면 특약 붙은 계약 전건이 오경보로 뜬다.
//   ⓧ 저장이 병합의 **거부를 실제로 읽는다.** 안 읽으면 자리표시자 빠진 번역이 그대로 저장돼
//     값 없는 조항이 종이에 실린다 — 조용히 실패하는 종류다.
//   ⓨ 분모 둘이 서로 다른 입력을 받는다. 편집기는 영업장 기준, 피커는 그 계약 기준이다.

// ⓣ·ⓤ — 번역본 본문의 치환과 절 번호
{
  const f = 'components/doc/ContractTranslationView.tsx'
  const src = read(f)
  if (!/renderContractText\(/.test(src)) {
    violations.push(`${f} — ⓣ 카드가 조항의 {{변수}} 를 안 채운다. 자리표시자가 글자 그대로 뜬다(2026-09-08 배포 결함의 재발).`)
  }
  // 종이(lib/contractPrintHtml)의 순서 그대로여야 한다 — stripClauseBullet(renderContractText(..)).
  if (!/stripClauseBullet\(render\(/.test(src)) {
    violations.push(`${f} — ⓣ 치환과 글머리 제거의 순서가 종이와 다르다. 값이 글머리로 시작하는 조항에서 카드와 종이가 갈린다.`)
  }
  if (!/appendSubLeaseAddendum\(translation\.sections/.test(src)) {
    violations.push(`${f} — ⓤ 절 번호를 종이와 같은 정본으로 안 매긴다. 번역본만 번호가 밀려 "몇 조 몇 항"이 다른 줄을 가리킨다.`)
  }
  // 원문 쪽도 **같은 함수로** 세워야 표식 판정의 index 가 1:1 로 맞는다.
  if (!/srcSections = appendSubLeaseAddendum\(/.test(src)) {
    violations.push(`${f} — ⓤ 표식 대조용 원문을 같은 정본으로 안 세운다. 특약 절에서 '원문' 표식이 엉뚱한 줄에 붙는다.`)
  }
}

// ⓥ — 서명 화면이 종이의 vars 를 그대로 넘긴다
{
  const f = 'app/contract/[tenantId]/ContractView.tsx'
  const src = read(f)
  // 종이가 쓰는 그 객체(vars)를 펼쳐 넘긴다. 새로 조립하면 종이와 갈린다.
  if (!/vars=\{\{ \.\.\.vars,/.test(src)) {
    violations.push(`${f} — ⓥ 카드에 종이의 vars 를 안 넘긴다. 카드가 자리표시자를 그대로 보이거나 종이와 다른 값을 보인다.`)
  }
  if (!/sourceAddenda=\{contractAddendaForTranslation\(data\)\}/.test(src)) {
    violations.push(`${f} — ⓥ 표식 대조용 특약 원문을 정본으로 안 넘긴다. 특약 절이 늘 '원문'으로 표시되거나 표식이 안 붙는다.`)
  }
}

// ⓦ — 발급과 드리프트가 그 계약에 실린 절만 넘긴다
{
  const f = 'app/(app)/tenants/contractShare.ts'
  const src = read(f)
  const issue = fnBody(src, src.indexOf('export async function issueContractShareLink'))
  if (issue.length >= 500 && !/contractAddendaForTranslation\(snapshot\)/.test(issue)) {
    violations.push(`${f} — ⓦ 발급이 그 계약의 가변 절을 안 넘긴다. 특약 번역이 박제에서 통째로 빠져 서명 화면에 한국어 원문으로 뜬다.`)
  }
  const drift = fnBody(src, src.indexOf('export async function checkContractShareDrift'))
  if (drift.length >= 300 && !/contractAddendaForTranslation\(current\)/.test(drift)) {
    violations.push(`${f} — ⓦ 드리프트 비교가 가변 절을 안 넘긴다. 특약이 붙은 계약 전건이 "특약 번역이 사라졌다"로 뜬다.`)
  }
}

// ⓧ·ⓨ — 저장의 거부와 분모 둘
{
  const f = 'app/(app)/settings/actions.ts'
  const src = read(f)

  const saveLang = fnBody(src, src.indexOf('export async function saveContractTranslationLang'))
  if (saveLang.length >= 200) {
    // 거부를 실제로 읽고 **쓰기를 건너뛴다**. `merged.next` 만 꺼내 쓰면 거부가 죽은 값이 된다.
    if (!/if \(!merged\.ok\)/.test(saveLang) || !/merged\.next/.test(saveLang)) {
      violations.push(`${f} — ⓧ 저장이 병합의 거부를 안 읽는다. 자리표시자가 빠진 번역이 그대로 저장돼 값 없는 조항이 종이에 실린다.`)
    }
    if (!/return \{ ok: false, error: rejected \}/.test(saveLang)) {
      violations.push(`${f} — ⓧ 거부를 화면에 안 돌려준다. 저장이 조용히 실패해 운영자가 저장된 줄 안다.`)
    }
  }

  const get = fnBody(src, src.indexOf('export async function getContractTranslationSettings'))
  if (get.length < 200) violations.push(`${f} — getContractTranslationSettings 본문을 못 떴다. 구조가 바뀌었으면 이 그물부터 고친다.`)
  else if (!/propertyContractAddenda\(property,/.test(get)) {
    violations.push(`${f} — ⓨ 편집기 분모가 영업장 기준이 아니다. 계약 기준으로 좁히면 다른 계약에 붙는 절은 칸조차 안 서서 영영 번역되지 않는다.`)
  }
  // 계약 조립을 이 파일로 끌어오면 finance/actions 를 거쳐 /api/import 번들에 계약서 렌더가
  // 딸려 들어간다(2026-09-08 실측 — check-print-selfcontained 축 2 가 걸렸다).
  // **원문을 본다** — read() 는 import 줄을 지우므로 그 위에서는 이 검사가 영영 안 걸린다.
  if (/from '@\/lib\/contractData'/.test(readFileSync(f, 'utf8'))) {
    violations.push(`${f} — ⓨ 환경설정 액션이 계약 조립 모듈을 끌어온다. /api/import 번들이 무거워지고 폰트 자립 감지망이 깨진다. 계약 기준 목록은 app/contract/[tenantId]/actions 의 출구를 쓴다.`)
  }
}

// ⓨ — 계약 기준 분모는 발급과 같은 조립을 지난다
{
  const f = 'app/contract/[tenantId]/actions.ts'
  const src = read(f)
  const fn = fnBody(src, src.indexOf('export async function getContractTranslationAddenda'))
  if (fn.length < 100) violations.push(`${f} — getContractTranslationAddenda 본문을 못 떴다. 구조가 바뀌었으면 이 그물부터 고친다.`)
  else {
    if (!/buildContractData\(tenantId, propertyId, leaseTermId\)/.test(fn) || !/contractAddendaForTranslation\(data\)/.test(fn)) {
      violations.push(`${f} — ⓨ 계약 기준 목록이 발급과 같은 조립을 안 지난다. 캡션이 센 수와 링크에 실리는 수가 갈린다.`)
    }
    if (!/canReadScope\(role, 'money'\)/.test(fn)) {
      violations.push(`${f} — ⓨ 캡션 출구가 발급보다 넓은 문을 연다. 같은 게이트를 지나야 한다.`)
    }
  }
}

// ⓨ — 편집기와 피커가 각자의 분모를 실제로 쓴다
{
  const f = 'app/(app)/settings/SettingsForm.tsx'
  const src = read(f)
  const card = fnBody(src, src.indexOf('function ContractTranslationCard()'))
  if (card.length >= 1000) {
    if (!/translationSourceLines\(template, addenda\)/.test(card)) {
      violations.push(`${f} — ⓨ 편집기가 가변 절을 분모에 안 넣는다. 특약은 종이에 실리는데 번역할 칸이 아예 안 선다.`)
    }
    if (!/orphanTranslationKeys\(stored, template, lang, addenda\)/.test(card)) {
      violations.push(`${f} — ⓨ 고아 판정이 분모와 다른 집합을 본다. 특약 번역 전건이 고아로 잡힌다.`)
    }
    // 자리표시자 경고는 저장·되붙이기와 **같은 함수**로 낸다. 손으로 세면 세 곳의 답이 갈린다.
    if (!/translationPlaceholderMisses\(draft\)/.test(card)) {
      violations.push(`${f} — ⓧ 편집기가 자리표시자 검사를 정본으로 안 한다. 저장이 거부할 것을 화면이 미리 말하지 못한다.`)
    }
  }
}
{
  const f = 'components/doc/SignRequestLangPicker.tsx'
  const src = read(f)
  // 계약 기준(mine)이 있으면 그것, 없으면 영업장 기준으로 떨어진다.
  if (!/translationProgress\(r\.translations, r\.template, lang, mine \?\? r\.addenda\)/.test(src)) {
    violations.push(`${f} — ⓨ 피커 캡션이 가변 절을 분모에 안 넣는다. 특약까지 다 번역한 언어가 영영 미완으로 보인다.`)
  }
  if (!/getContractTranslationAddenda\(tenantId, leaseTermId\)/.test(src)) {
    violations.push(`${f} — ⓨ 피커가 계약 지목으로 분모를 안 좁힌다. 그 계약에 안 붙는 절까지 세어 다 번역한 언어가 영영 미완으로 보인다.`)
  }
}

if (violations.length) {
  console.error('참고용 번역본 배선 위반:')
  for (const v of violations) console.error(`  - ${v}`)
  process.exit(1)
}
console.log('참고용 번역본 배선: 이상 없음 (발급 박제 · 조건부 · 서명 동결 · 드리프트 · 축 · 발급 시트 · 병합 정본 · 서명 화면 카드 · 읽음확인 0 · 우선 조항 화면/인쇄 · 박제 승계 · 조건부 담기 · 발급 축 · 전문 열람 · 피커 캡션 · 왕복 정본 · 손 파싱 0 · 되붙이기 저장 0 · 고아 삭제 0 · 카드 치환 · 절 번호 정본 · 종이 vars · 계약분 특약 · 저장 거부 · 분모 둘)')
