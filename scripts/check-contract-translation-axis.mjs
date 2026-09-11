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
    // 해석 인자 조립은 정본 헬퍼 하나다(6단계) — 직접 부르면 화면·발급 API 와 규칙이 갈린다.
    if (!/resolveContractTranslationFor\(/.test(issue) || !/asTranslationLang\(signLang\)/.test(issue)) {
      violations.push(`${f} — ⓐ 발급이 그 링크의 언어로 번역본을 정본 헬퍼로 해석하지 않는다. 서명 화면이 읽을 근거가 스냅샷에 안 남는다.`)
    }
    // 조건부 스프레드여야 한다. `translation,` 이나 `translation: translation` 은 null 을 박는다.
    if (!/\.\.\.\(translation \? \{ translation \} : \{\}\)/.test(issue)) {
      violations.push(`${f} — ⓑ 번역본을 조건부로 안 담는다. 번역본 없는 영업장의 링크 스냅샷이 이 기능 전과 달라진다.`)
    }
  }

  const drift = fnBody(src, src.indexOf('export async function checkContractShareDrift'))
  if (drift.length < 300) violations.push(`${f} — checkContractShareDrift 본문을 못 떴다. 구조가 바뀌었으면 이 그물부터 고친다.`)
  else {
    if (!/resolveContractTranslationFor\(/.test(drift) || !/translation: currentTranslation/.test(drift)) {
      violations.push(`${f} — ⓓ 드리프트 비교가 지금 번역본을 정본 헬퍼로 다시 해석해 넣지 않는다. 번역본이 실린 링크 전건이 오경보로 뜬다.`)
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
  // 6단계에서 `remote &&` 를 걷었다 — 대면 서명은 운영자 화면이 곧 입주자가 읽는 화면이다.
  // 조건은 translation 하나뿐이라야 한다. 다시 화면을 가르면 대면에서 카드가 사라지고,
  // 조건을 지우면 번역본 없는 계약에 빈 카드가 선다(무회귀 급소).
  if (!/\{translation && \(\n/.test(src) || !/<ContractTranslationCard/.test(src)) {
    violations.push(`${f} — ⓗ 번역본 카드가 'translation 이 있으면 선다' 하나로 서지 않는다. 대면 서명에서 카드가 사라지거나 번역본 없는 계약에 빈 카드가 선다.`)
  }
  if (/remote && translation/.test(src)) {
    violations.push(`${f} — ⓗ 카드 조건에 원격 갈림이 되살아났다. 운영자가 기기를 건네 받는 대면 서명에서 번역본이 안 뜬다(2026-09-08 오더).`)
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
  if (!/\.\.\.\(translationOut \? \{ translation: translationOut \} : \{\}\)/.test(src)) {
    violations.push(`${f} — ⓛ 번역본을 조건부로 안 담는다. 이 값이 링크 스냅샷으로 흘러가므로, 번역본 없는 영업장의 스냅샷이 이 기능 전과 달라진다.`)
  }
  // 6단계 — 동결본이 라이브 해석을 **이긴다**. 순서가 뒤집히면 서명이 끝난 계약의 문안이
  // 지금 사전으로 바뀌어, 입주자가 서명한 종이와 화면이 갈린다.
  if (!/const translationOut = translationFrozen \?\? translationLive/.test(src)) {
    violations.push(`${f} — ⓛ 동결본이 라이브 해석을 안 이긴다. 서명이 끝난 계약의 번역본이 지금 사전으로 덮인다.`)
  }
}

// ⓜ — 발급이 종이와 박제에 같은 값을 싣는다
{
  const f = 'app/api/contract/generate/route.ts'
  const src = read(f)
  // 6단계 — 서명 전 계약은 화면이 보낸 언어로 서버가 다시 해석한 것이 선다(대면 서명).
  // 박제본이 있으면 그것이 이긴다(`??` 의 왼쪽) — 서명이 끝난 종이는 사전과 무관하다.
  if (!/translation: body_\.translation \?\? liveTranslation/.test(src)) {
    violations.push(`${f} — ⓜ 인쇄 데이터에 번역본이 안 실리거나 동결본이 안 이긴다. 발급 PDF 에만 우선 조항이 빠지거나, 서명이 끝난 종이의 문안이 지금 사전으로 바뀐다.`)
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
  const card = fnBody(src, src.indexOf('function ContractTranslationCard('))
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
  // 종이가 쓰는 그 객체(vars)를 정본으로 이어 넘긴다. 손으로 조립하면 종이와 갈리고,
  // 발급 상세의 전문 보기와도 갈린다(둘이 같은 정본을 쓴다 — 5단계 ⓩ).
  if (!/vars=\{translationDisplayVars\(vars, data\.roomScheduleText\)\}/.test(src)) {
    violations.push(`${f} — ⓥ 카드에 종이의 vars 를 안 넘긴다. 카드가 자리표시자를 그대로 보이거나 종이와 다른 값을 보인다.`)
  }
  if (!/sourceAddenda=\{contractAddendaForTranslation\(data\)\}/.test(src)) {
    violations.push(`${f} — ⓥ 표식 대조용 특약 원문을 정본으로 안 넘긴다. 특약 절이 늘 '원문'으로 표시되거나 표식이 안 붙는다.`)
  }
}

// ⓦ — 그 계약에 실린 절만 번역본에 선다
//
// 6단계에서 이 규칙이 **정본 헬퍼 안으로 들어갔다.** 종전에는 호출부마다 손으로 넘겨서
// 발급·드리프트 둘이 각자 같은 줄을 적고 있었고, 화면·발급 API 가 늘면 넷이 될 참이었다.
// 규칙이 갈리면 종이에 없는 절이 번역본에 서서 조항 번호가 통째로 밀린다(번호는 자리로 매긴다).
{
  const f = 'lib/contractTranslation.ts'
  const src = read(f)
  // fnBody 를 못 쓴다 — 이 함수는 인자 타입이 `d: {` 로 시작해서, 그 여는 괄호를 본문으로
  // 착각한다. 최상위 닫는 괄호(줄머리 `}`)까지 자른다.
  const helperAt = src.indexOf('export function resolveContractTranslationFor')
  const helper = helperAt < 0 ? '' : src.slice(helperAt, src.indexOf('\n}', helperAt) + 2)
  if (helper.length < 100) violations.push(`${f} — ⓦ resolveContractTranslationFor 본문을 못 떴다. 구조가 바뀌었으면 이 그물부터 고친다.`)
  else {
    if (!/contractAddendaForTranslation\(d\)/.test(helper)) {
      violations.push(`${f} — ⓦ 정본 헬퍼가 그 계약의 가변 절을 종이와 같은 정본으로 안 고른다. 특약 번역이 박제에서 빠지거나 없는 절이 번역본에 선다.`)
    }
    if (!/d\.refundClauseInContract/.test(helper)) {
      violations.push(`${f} — ⓦ 정본 헬퍼가 환불 조항 토글을 안 넘긴다. 종이에 안 실리는 문장이 번역본에 서거나, 실리는데 한국어로만 남는다.`)
    }
    // 언어가 없으면 해석 자체를 안 한다 — 한국어 계약서가 이 기능 전과 문자 단위로 같아야 한다.
    if (!/if \(!lang\) return null/.test(helper)) {
      violations.push(`${f} — ⓦ 언어가 없을 때 null 로 안 떨어진다. 한국어를 고른 계약서에 카드와 우선 조항이 선다.`)
    }
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
  const card = fnBody(src, src.indexOf('function ContractTranslationCard('))
  if (card.length >= 1000) {
    if (!/translationSourceLines\(template, addenda, refundClauseInContract, 'property'\)/.test(card)) {
      violations.push(`${f} — ⓨ 편집기가 가변 절·환불 조항 토글·청소비 갈래를 분모에 안 넣는다. 종이에 실리는데 번역할 칸이 아예 안 선다. 청소비는 **영업장 전부**('property')라야 한다 — 한 갈래로 좁히면 다른 갈래 계약의 조항이 영영 번역되지 않는다.`)
    }
    if (!/orphanTranslationKeys\(stored, template, lang, addenda, refundClauseInContract, 'property'\)/.test(card)) {
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
  // 계약 기준(mine)이 있으면 그것, 없으면 영업장 기준으로 떨어진다. 두 축(가변 절·환불 조항
  // 토글) 다 그렇게 떨어져야 한다 — 한 축만 좁히면 분모가 두 기준을 섞는다.
  if (!/translationProgress\(r\.translations, r\.template, lang,\s*mine\?\.addenda \?\? r\.addenda, mine\?\.refundClauseInContract \?\? r\.refundClauseInContract,\s*mine\?\.cleaningFee \?\? 'property'\)/.test(src)) {
    violations.push(`${f} — ⓨ 피커 캡션이 가변 절·환불 조항 토글을 분모에 안 넣는다. 다 번역한 언어가 영영 미완으로 보인다.`)
  }
  if (!/getContractTranslationAddenda\(tenantId, leaseTermId\)/.test(src)) {
    violations.push(`${f} — ⓨ 피커가 계약 지목으로 분모를 안 좁힌다. 그 계약에 안 붙는 절까지 세어 다 번역한 언어가 영영 미완으로 보인다.`)
  }
}

// ── 5단계 배선(발급 박제 vars · 환불 규정 변수 줄) ──────────────────
//
//   ⓩ 발급 박제가 치환 재료를 **facts 밖에** 담고, 재료는 종이와 같은 함수에서 나온다.
//     facts 안에 넣으면 그 축은 드리프트가 통비교하는 JSON 이라, 조항을 한 글자도 안 고친
//     발급본 전건이 허위 드리프트로 뜬다(1~4단계가 지켜 온 규칙).
//   ① 조판 vars 가 인쇄와 박제의 **한 정본**이다. 인라인으로 되돌리면 박제가 쓸 길이 없어져
//     전문 보기에 자리표시자가 다시 글자 그대로 뜬다(4단계 잔존 결함의 재발).
//   ② 발급 상세가 그 재료를 본문에 넘기고, **없는 발급본에는 사실을 한 줄로 말한다.**
//     지금 값을 계산해 채우면 그것은 증거가 아니라 오늘의 값이다.
//   ③ 환불 규정 변수 줄이 **종이와 같은 조건**으로 선다(토글 + 본문에 자리). 그리고 화면이
//     '빈 칸 = 권장'을 말하고, 경고가 막지 않는다(운영자 오더 — 유도하되 막지 않는다).

// ⓩ·① — 발급 박제의 치환 재료와 조판 정본
{
  const f = 'lib/contractPrintHtml.ts'
  const src = read(f)
  if (!/export function contractPrintVars\(/.test(src)) {
    violations.push(`${f} — ① 조판 vars 가 함수로 안 서 있다. 발급 박제가 같은 재료를 못 써서 전문 보기에 자리표시자가 글자 그대로 뜬다.`)
  }
  const build = fnBody(src, src.indexOf('export function buildContractPrintHtml'))
  if (build.length < 500) violations.push(`${f} — buildContractPrintHtml 본문을 못 떴다. 구조가 바뀌었으면 이 그물부터 고친다.`)
  else if (!/const vars: Record<string, string> = contractPrintVars\(d\)/.test(build)) {
    violations.push(`${f} — ① 인쇄가 그 정본을 안 쓴다. 종이와 박제가 두 벌의 재료를 갖게 되어 언젠가 다른 값을 그린다.`)
  }
}
{
  const f = 'app/api/contract/generate/route.ts'
  const src = read(f)
  const post = fnBody(src, src.indexOf('export async function POST'))
  if (post.length < 2000) violations.push(`${f} — POST 본문을 못 떴다. 구조가 바뀌었으면 이 그물부터 고친다.`)
  else {
    // 조건부 스프레드여야 한다. `translationVars: x` 는 번역본 없는 발급본에도 칸을 만든다.
    if (!/\.\.\.\(printData\.translation\s*\?\s*\{ translationVars: translationDisplayVars\(contractPrintVars\(printData\), printData\.roomScheduleText\) \}\s*:\s*\{\}\)/.test(post)) {
      violations.push(`${f} — ⓩ 발급 박제가 치환 재료를 조건부로 안 담는다(또는 정본을 안 쓴다). 전문 보기가 자리표시자를 그대로 보이거나, 번역본 없는 발급본의 박제가 이 칸 이전과 달라진다.`)
    }
    // facts 안에 들어가면 안 된다 — 그 축은 통비교라 모양이 바뀌면 전건이 드리프트다.
    const facts = fnBody(post, post.indexOf('facts: printedFacts('))
    if (facts.length > 0 && /translationVars/.test(facts)) {
      violations.push(`${f} — ⓩ 치환 재료가 printedFacts 축 안에 있다. 인쇄 사실 축이 바뀌어 이미 나간 링크·발급본 전건이 허위 드리프트로 뜬다.`)
    }
  }
}
{
  const f = 'lib/contractPrintedFacts.ts'
  const src = readFileSync(f, 'utf8')
  // 축은 15개 그대로다. 재료가 사실 축으로 새어 들어가면 통비교가 흔들린다.
  if (/translationVars/.test(src)) {
    violations.push(`${f} — ⓩ 인쇄 사실 사영이 치환 재료를 축으로 들었다. 이 축은 JSON 통비교라 모양이 바뀌면 옛 박제 전건이 드리프트로 뜬다.`)
  }
}

// ② — 발급 상세가 재료를 넘기고, 없으면 사실을 말한다
{
  const f = 'components/doc/IssuedContractSheet.tsx'
  const src = read(f)
  if (!/vars=\{snap\?\.translationVars\}/.test(src)) {
    violations.push(`${f} — ② 전문 보기가 박제된 치환 재료를 본문에 안 넘긴다. {{청소비조항}} 같은 표시가 글자 그대로 뜬다.`)
  }
  if (!/!snap\?\.translationVars &&/.test(src)) {
    violations.push(`${f} — ② 재료가 없는 옛 발급본에 사실을 안 말한다. 자리표시자만 덩그러니 남아 화면이 고장난 것으로 읽힌다.`)
  }
  // 지금 값을 계산해 채우면 그것은 증거가 아니라 오늘의 값이다.
  if (/contractPrintVars\(|buildContractData\(/.test(src)) {
    violations.push(`${f} — ② 발급 상세가 치환 재료를 지금 다시 만든다. 박제는 얼어 있는 값만 보여야 한다.`)
  }
  // 이름만 있는지 보지 않는다 — 표식을 **실제로 읽어 그 언어의 줄에 붙이는지**를 본다.
  // 순서는 이름 배열이 정하고 이름은 정본 한 벌에서 온다(피커 캡션과 같은 문법).
  if (!/TRANSLATION_VAR_NAMES\.filter\(n => frozen\.has\(n\)\)\.map\(n => TRANSLATION_VAR_LABEL\[n\]\)/.test(src)
    || !/\$\{customNames\.join\(' · '\)\} 직접 번역/.test(src)) {
    violations.push(`${f} — ③ 발급 상세가 '… 직접 번역' 표식을 안 읽는다. 왜 기준 문구와 다른 문안이 나갔는지 답할 자리가 없다.`)
  }
}

// ③ — 환불 규정 변수 줄: 종이와 같은 조건 · 빈 칸은 권장 · 막지 않는다
{
  const f = 'lib/contractTranslation.ts'
  const src = read(f)
  // 열쇠는 종이가 넣는 그 문장이다. 사본을 만들면 문구가 바뀔 때 조용히 갈린다.
  if (!/export function refundTranslationKey\(\): string \{\s*return buildRefundClause\(\)/.test(src)) {
    violations.push(`${f} — ③ 변수 줄의 열쇠가 종이의 정본 문장이 아니다. 문구가 바뀌면 저장된 번역이 통째로 고아가 된다.`)
  }
  // 변수 줄은 **명세 목록 하나**를 돌며 선다. 이름별 분기를 손으로 적으면 줄이 늘 때마다
  // 조건이 늘고, 언젠가 한 줄만 조건이 갈려 종이와 다른 칸이 선다.
  if (!/for \(const spec of translationVarSpecs\(template, addenda, refundClauseInContract, cleaning\)\) pushVar\(spec\)/.test(src)) {
    violations.push(`${f} — ③ 변수 줄이 명세 목록으로 안 돈다. 이름마다 손 분기를 두면 종이와 같은 조건이라는 보장이 한 줄씩 흩어진다.`)
  }
  // 조건이 둘이다 — 토글과 본문의 자리. 하나만 보면 종이와 갈린다.
  if (!/if \(refundClauseInContract && templateHasPlaceholder\(template, addenda, REFUND_VAR_PLACEHOLDER\)\)/.test(src)) {
    violations.push(`${f} — ③ 환불 변수 줄이 종이와 같은 조건으로 안 선다. 종이에 안 실리는 문장을 번역하라고 칸이 서거나, 실리는데 칸이 안 선다.`)
  }
  // 빈 칸 = 권장. 이 폴백이 없으면 이 줄만 한국어 원문으로 남는다.
  // **권장이 빈 언어는 칸을 안 만든다** — 빈 값을 얹으면 종이의 한국어 문장을 빈 문자열로 덮어
  // 그 조항이 통째로 사라진다(한국어로 남는 것보다 나쁘다).
  if (!/const text = saved \?\? \(spec\.recommended\[lang\] \|\| undefined\)/.test(src)
    || !/if \(text !== undefined\) vars\[name\] = translationVarValue\(spec, text\)/.test(src)) {
    violations.push(`${f} — ③ 빈 칸일 때 권장 번역으로 안 떨어지거나, 권장이 빈 언어에서 빈 값을 얹는다. 앞은 유도하려고 만든 줄이 아무것도 안 내보내는 것이고, 뒤는 종이의 한국어 조항을 빈 문자열로 지우는 것이다.`)
  }
  // 권장과 같은 값은 저장에서 걷는다 — 안 걷으면 사실이 아닌 '직접 번역' 경고가 계속 선다.
  // 권장이 빈 줄은 걷지 않는다 — 그 값이 그 언어의 유일한 번역이라 걷으면 손문안이 사라진다.
  if (!/const spec = translationVarSpecByKey\(k\)\s*\n\s*if \(spec && spec\.recommended\[lang\] && !isCustomVarTranslation\(lang, spec, v\)\) \{ delete dict\[k\]/.test(src)) {
    violations.push(`${f} — ③ 권장과 같은 값을 저장에서 안 비우거나, 권장이 없는 줄의 손문안까지 비운다. 앞은 사실이 아닌 '직접 번역' 경고를 남기고, 뒤는 운영자가 친 문안을 저장 한 번에 지운다.`)
  }
  // 8언어 전량 선언이 누락 감지망이다(Partial 금지 — TRANSLATION_NOTICE 와 같은 규칙).
  if (!/RECOMMENDED_REFUND_TRANSLATION: Record<TranslationLang, string>/.test(src)) {
    violations.push(`${f} — ③ 권장 문안이 Record 전량 선언이 아니다. 언어가 늘었을 때 tsc 가 누락을 못 잡는다.`)
  }
}
{
  const f = 'app/(app)/settings/SettingsForm.tsx'
  const src = read(f)
  const card = fnBody(src, src.indexOf('function ContractTranslationCard('))
  if (card.length >= 1000) {
    // 명세를 **실제로 계산하는지**부터 본다. 아래 검사들은 전부 '그 문자열이 소스에 있는가'라,
    // 호출만 지우고 빈 배열을 두면(import 는 남겨 둔 채) 전부 통과하면서 권장 문안·경고가
    // 조용히 사라진다 — 2026-09-11 역주입 ⑤ 로 실제로 뚫렸다(체크리스트 F 가 경고한 수법).
    // 한 정규식으로 **이어서** 본다. 따로 찾으면 같은 파일 다른 자리의 호출이 대신 걸린다.
    if (!/const varSpecs = useMemo\(\s*\n?\s*\(\) => \(template \? translationVarSpecs\(template, addenda, refundClauseInContract, 'property'\) : \[\]\),/.test(card)) {
      violations.push(`${f} — ③ 편집기가 변수 줄 명세를 정본으로 안 만든다(또는 영업장 기준이 아니다). 권장 문안·경고·되돌리기가 한꺼번에 조용히 사라진다.`)
    }
    // 줄마다 **제 명세**를 찾아 쓴다. 이름으로 문안을 고르면 줄이 늘 때마다 분기가 늘고,
    // 언젠가 청소비 칸에 환불 권장 번역이 선다.
    if (!/const spec = l\.kind === 'var' \? varSpecs\.find\(s => s\.key === l\.text\) : undefined/.test(card)
      || !/const recommended = spec\?\.recommended\[lang\] \?\? ''/.test(card)) {
      violations.push(`${f} — ③ 줄이 제 명세를 안 찾는다. 권장 문안·경고가 다른 줄의 것으로 서거나 아예 안 선다.`)
    }
    // 미리 채우면 검토 없이 저장된다(운영자 오더) — placeholder 로만 보인다.
    // **그 줄의 권장 문안이라야 한다.** 변수 줄이 여럿인데 한 문안을 쓰면 청소비 칸에 환불
    // 권장 번역이 보이고, 운영자는 그것을 지우거나 그대로 저장한다.
    if (!/placeholder=\{recommended\s*\n?\s*\|\| \(l\.kind === 'var' \? '비워 두면 이 줄은 한국어 원문 그대로 나갑니다\.' : '비워 두면 이 줄은 한국어 원문 그대로 보입니다\.'\)\}/.test(card)) {
      violations.push(`${f} — ③ 그 줄의 권장 전문을 placeholder 로 안 보인다. 비워 둔 칸이 무엇을 내보내는지 화면에서 읽을 수 없거나, 다른 줄의 문안이 보인다.`)
    }
    // 라벨이 갈래를 가르고, `· 권장 번역 있음` 은 **그 언어에 권장이 있을 때만** 붙는다.
    // 무조건 붙이면 바로 아래 캡션의 '권장 번역은 아직 없습니다' 와 한 줄 사이로 모순된다
    // (디자이너 차단 2026-09-11). 청소비 세 줄이 같은 라벨로 서는 문제도 여기서 함께 풀린다.
    if (!/return recommended \? `\$\{spec\.label\} · \$\{TRANSLATION_KIND_LABEL\.var\}` : spec\.label/.test(src)) {
      violations.push(`${f} — A 변수 줄 라벨이 갈래를 안 가르거나, 권장이 없는 줄에도 '권장 번역 있음'을 붙인다. 라벨과 바로 아래 캡션이 서로 다른 말을 한다.`)
    }
    // 금액 캡션의 조건은 일반(translationPlaceholders)인데 문안만 한 이름으로 박으면, 다른
    // 자리표시자를 품은 줄에서 화면이 없는 이름을 말한다.
    if (!/\{translationPlaceholders\(l\.text\)\.join\(' · '\)\} 자리에 금액이 들어갑니다/.test(card)) {
      violations.push(`${f} — 금액 캡션이 그 줄의 실제 자리표시자를 안 말한다. 조건은 일반인데 문안만 고정이면 다른 표시를 품은 줄에서 거짓을 말한다.`)
    }
    // 계수는 정본 하나다. 여기서 손으로 세면 화면은 '0줄 남음'인데 종이에 한국어가 남는다.
    if (!/const translated = lines\.filter\(l => translationLineDone\(lang, l, draft\[l\.text\]\)\)\.length/.test(card)) {
      violations.push(`${f} — B 편집기 계수가 정본(translationLineDone)을 안 쓴다. 권장 없는 변수 줄이 완료로 잡혀 다 채운 언어가 거짓으로 100% 가 된다.`)
    }
    if (/setDraft\(p => \(\{ \.\.\.p, \[[^\]]+\]: (RECOMMENDED_|spec\.recommended)/.test(card)) {
      violations.push(`${f} — ③ 편집기가 권장 문안을 칸에 미리 채운다. 검토 없이 저장되는 길이라 운영자 오더로 금지된 방식이다.`)
    }
    // '빈 칸 = 권장'을 그 칸 아래에서 말한다 — 다른 줄은 '빈 칸 = 원문'이라 규칙이 갈린다.
    // 권장이 아직 없는 언어에는 **그 사실**을 말한다. 같은 문장을 쓰면 화면이 거짓을 말한다.
    if (!/비워 두면 권장 번역이 쓰입니다/.test(card)) {
      violations.push(`${f} — ③ '빈 칸 = 권장'을 화면이 말하지 않는다. 다른 줄과 규칙이 갈리는데 같은 모양의 칸이라 운영자가 미번역으로 읽는다.`)
    }
    if (!/recommended\s*\n?\s*\? '비워 두면 권장 번역이 쓰입니다[\s\S]{0,200}권장 번역은 아직 없습니다/.test(card)) {
      violations.push(`${f} — ③ 권장 문안이 아직 없는 언어에도 '비워 두면 권장 번역이 쓰입니다'라고 말한다. 비우면 한국어가 남는데 번역이 나간다고 거짓을 말하는 것이다.`)
    }
    // 경고는 알리기만 한다. 저장을 막거나 확인창을 세우면 운영자의 방식을 앱이 가로막는다.
    // 문안도 **그 줄의 것**이라야 한다 — 청소비 칸에 공정위 기준 설명이 서면 이유가 거짓이다.
    if (!/customVarKeys\.has\(l\.text\) &&/.test(card) || !/\{spec\.warning\}/.test(card)) {
      violations.push(`${f} — ③ 직접 번역 경고가 칸 옆에 안 서거나 그 줄의 이유를 안 말한다. 권장과 다른 문안이 아무 말 없이 종이로 나간다.`)
    }
    if (/customVarKeys[\s\S]{0,200}confirmDialog|disabled=\{[^}]*customVarKeys/.test(card)) {
      violations.push(`${f} — ③ 경고가 확인창을 세우거나 저장을 막는다. 운영자의 방식이 있을 수 있어 유도만 한다(막지 않는다).`)
    }
    // 화면과 서버가 같은 정본으로 판정해야 저장 뒤에도 '저장 안 함'이 안 남는다.
    if (!/const spec = translationVarSpecByKey\(k\)\s*\n\s*return !\(spec && spec\.recommended\[lang\] && !isCustomVarTranslation\(lang, spec, v\)\)/.test(card)) {
      violations.push(`${f} — ③ 화면 저장본이 서버 병합과 다른 규칙으로 칸을 걷는다. 저장 직후에도 '저장하지 않은 변경'이 남는다.`)
    }
  }
}
{
  const f = 'components/doc/SignRequestLangPicker.tsx'
  const src = read(f)
  // 이름은 정본 한 벌(TRANSLATION_VAR_LABEL)에서 오고 중복은 접는다 — 청소비 두 줄이 같은
  // 이름이라 안 접으면 '청소비 · 청소비 직접 번역'이 된다.
  if (!/const customNames = \[\.\.\.new Set\(p\.customVars\.map\(v => TRANSLATION_VAR_LABEL\[v\]\)\)\]/.test(src)
    || !/\$\{customNames\.join\(' · '\)\} 직접 번역/.test(src)) {
    violations.push(`${f} — ③ 피커 캡션이 '… 직접 번역'을 정본 이름으로 안 덧붙인다. 보내기 직전에 그 사실을 볼 자리가 없거나, 같은 이름이 두 번 선다.`)
  }
}

// ── 6단계 배선(대면 서명 · 본문 수정 알림) ──────────────────────────
//
//   ㉮ 운영자 계약서 페이지가 `?lang` 을 받아 그 출구로만 넘긴다. 언어 목록은 ContractData 에
//     안 싣는다 — 그 값이 링크 발급 스냅샷으로 흘러가 번역본과 무관한 링크의 바이트가 달라진다.
//   ㉯ 번역본을 세우는 것은 **옵션을 넘긴 호출뿐**이다. 안 넘긴 호출(링크 발급·드리프트·변수
//     미리보기)은 이 기능 전과 바이트로 같다. 무회귀 급소가 여기로 옮겨 왔다.
//   ㉰ 해석 호출부가 정본 헬퍼만 쓴다. lib 밖에서 resolveContractTranslation 을 직접 부르면
//     규칙이 네 벌이 된다.
//   ㉱ 발급 API 가 **번역 내용을 안 받는다.** 언어 코드와 지문만 받고 서버가 다시 해석한다 —
//     받으면 API 를 직접 불러 아무 문안이나 종이에 박을 수 있다(성명·금액 봉인과 같은 규칙).
//   ㉲ 지문 게이트가 **채번보다 먼저** 선다. 뒤에 두면 거절할 요청이 계약번호 한 자리를 먹는다.
//     서명이 끝난 계약(SNAPSHOT)은 예외다 — 그 종이는 동결본이라 사전과 무관하다.
//   ㉳ 대면 박제가 번역본을 **조건부로** 담는다. 대면은 서명 저장과 박제가 이 요청 한 번이라
//     여기서 안 담으면 그 사람이 무엇을 읽었는지 어디에도 안 남는다.
//   ㉴ 툴바 셀렉트가 외국인·공개 언어일 때만 서고, 서명이 들어오면 잠긴다. 언어를 바꿀 때
//     토스트를 안 띄운다(저장이 아니라 보기 상태다).
//   ㉵ 본문 저장이 정본 계수를 쓰고 **사전을 한 글자도 안 건드린다.**

// ㉮ — 페이지의 ?lang 과 언어 목록의 자리
{
  const f = 'app/contract/[tenantId]/page.tsx'
  const src = read(f)
  if (!/searchParams: Promise<\{[^}]*lang\?: string[^}]*\}>/.test(src)) {
    violations.push(`${f} — ㉮ 페이지가 ?lang 을 안 받는다. 운영자가 건네기 전에 언어를 맞출 길이 없다.`)
  }
  if (!/getContractData\(tenantId, leaseTermId \?\? null, lang \?\? null\)/.test(src)) {
    violations.push(`${f} — ㉮ 페이지가 언어를 계약서 출구에 안 넘긴다. 셀렉트를 바꿔도 화면이 안 바뀐다.`)
  }
  if (!/getContractTranslationLangs\(\)/.test(src) || !/translationLangs=\{translationLangs\}/.test(src)) {
    violations.push(`${f} — ㉮ 셀렉트가 세울 언어 목록을 화면에 안 내린다. 목록을 ContractData 에 실으면 링크 스냅샷 바이트가 달라진다.`)
  }
}
{
  const f = 'lib/contractData.ts'
  const src = readFileSync(f, 'utf8')
  // 목록을 ContractData 에 실으면 그 값이 링크 발급 스프레드를 타고 스냅샷으로 흘러간다.
  if (/translationLangs/.test(src)) {
    violations.push(`${f} — ㉮ ContractData 가 언어 목록을 들었다. 그 값이 링크 스냅샷으로 흘러가 번역본과 무관한 링크의 박제 바이트가 달라진다.`)
  }
}

// ㉯ — 번역본은 옵션을 넘긴 호출만 세운다
{
  const f = 'lib/contractData.ts'
  const src = read(f)
  const build = fnBody(src, src.indexOf('export async function buildContractData'))
  if (build.length < 1000) violations.push(`${f} — buildContractData 본문을 못 떴다. 구조가 바뀌었으면 이 그물부터 고친다.`)
  else if (!/\(!translation \|\| body\.source === 'SNAPSHOT'\) \? null : resolveContractTranslationFor\(/.test(build)) {
    violations.push(`${f} — ㉯ 번역 해석이 '옵션을 넘긴 LIVE 호출' 조건을 안 지킨다. 옵션 없는 호출까지 세우면 링크 발급 스냅샷이 이 기능 전과 달라지고, SNAPSHOT 에서 세우면 서명이 끝난 종이의 문안이 바뀐다.`)
  }
  // 링크 발급·드리프트는 옵션을 안 넘긴다. 넘기는 순간 그 스냅샷에 번역본이 두 경로로 들어간다.
  const share = read('app/(app)/tenants/contractShare.ts')
  if (/buildContractData\([^)]*,\s*\{\s*lang/.test(share)) {
    violations.push(`app/(app)/tenants/contractShare.ts — ㉯ 링크 발급·드리프트가 번역 옵션을 넘긴다. 스냅샷에 번역본이 두 경로로 들어가 한국어 링크에도 번역본이 실린다.`)
  }
  // 외국인 판정은 서명 요청과 같은 축이다. 다른 축을 쓰면 같은 사람이 두 화면에서 갈린다.
  const langForSrc = read('lib/contractTranslation.ts')
  const langFor = fnBody(langForSrc, langForSrc.indexOf('export function contractTranslationLangFor'))
  if (langFor.length < 50) violations.push(`lib/contractTranslation.ts — contractTranslationLangFor 본문을 못 떴다. 구조가 바뀌었으면 이 그물부터 고친다.`)
  else {
    if (!/isForeignForDocuments\(/.test(langFor) || !/if \(!foreign\) return 'ko'/.test(langFor)) {
      violations.push(`lib/contractTranslation.ts — ㉯ 외국인 판정을 서명 요청과 같은 축으로 안 한다(또는 내국인에게 언어가 선다). 내국인 계약서의 화면·종이가 이 기능 전과 달라진다.`)
    }
    if (!/signLangForNationality\(/.test(langFor)) {
      violations.push(`lib/contractTranslation.ts — ㉯ 기본값이 국적에서 안 온다. 건네기 전에 이미 맞아 있어야 한다는 것이 이 기능의 전제다.`)
    }
  }
}

// ㉰ — 해석 호출부는 정본 헬퍼만 쓴다
{
  for (const f of [
    'app/(app)/tenants/contractShare.ts',
    'lib/contractData.ts',
    'app/api/contract/generate/route.ts',
    'app/contract/[tenantId]/ContractView.tsx',
  ]) {
    const src = read(f)
    if (/resolveContractTranslation\(/.test(src)) {
      violations.push(`${f} — ㉰ 해석 정본을 직접 부른다. 인자 조립이 호출부마다 흩어지면 언젠가 한 곳만 가변 절이나 환불 토글을 빠뜨린다(헬퍼 resolveContractTranslationFor 를 쓴다).`)
    }
  }
}

// ㉱·㉲·㉳ — 발급 API 의 언어 코드 · 지문 게이트 · 대면 박제
{
  const f = 'app/api/contract/generate/route.ts'
  const src = read(f)
  const post = fnBody(src, src.indexOf('export async function POST'))
  if (post.length < 2000) violations.push(`${f} — POST 본문을 못 떴다. 구조가 바뀌었으면 이 그물부터 고친다.`)
  else {
    // ㉱ — 언어 코드만 받는다. **해석에 넘기는 그 자리**를 본다 — 파일 어딘가에 있기만 하면
    // 되는 검사는 지문 게이트 쪽 호출이 대신 걸려 눈을 감는다(역주입 ⑪로 실측).
    if (!/asTranslationLang\(body\.lang\),\s*\n\s*\)/.test(post)) {
      violations.push(`${f} — ㉱ 해석에 넘기는 언어가 화이트리스트를 안 지난다. 한국어나 아무 문자열이 해석 경로로 들어간다.`)
    }
    if (/body\.lang as /.test(post)) {
      violations.push(`${f} — ㉱ 언어 코드를 캐스트로 통과시킨다. 화이트리스트 파서 하나만 지나야 한다.`)
    }
    // 번역 문안을 몸통으로 받으면 API 를 직접 불러 아무 문안이나 종이에 박을 수 있다.
    if (/body\.translation\b/.test(post)) {
      violations.push(`${f} — ㉱ 발급 몸통에서 번역 **내용**을 읽는다. 클라이언트가 보낸 종이 내용을 믿으면 API 를 직접 불러 아무 문안이나 박을 수 있다(성명 봉인과 같은 규칙).`)
    }
    // ㉲ — 지문 게이트. SNAPSHOT 예외가 없으면 서명본 재발급이 통째로 막힌다.
    const gate = /if \(asTranslationLang\(body\.lang\) && body_\.source !== 'SNAPSHOT'\s*\n?\s*&& translationDigest\(liveTranslation\) !== \(body\.translationDigest \?\? null\)\)/
    if (!gate.test(post)) {
      violations.push(`${f} — ㉲ 지문 게이트가 없거나 조건이 다르다. 로드와 발급 사이에 사전이 바뀌면 입주자가 읽은 것과 다른 문안이 조용히 종이에 박힌다.`)
    }
    if (!/code: 'TRANSLATION_STALE'/.test(post)) {
      violations.push(`${f} — ㉲ 거절에 코드가 없다. 화면이 새로고침 안내를 못 골라내고 막다른 실패로 보인다(DUE_DAY_REQUIRED 문법).`)
    }
    // 게이트가 채번보다 앞이어야 한다. 뒤면 거절할 요청이 계약번호 한 자리를 먹고 지워진다.
    const gateAt = post.search(gate)
    const reserveAt = post.indexOf('contractNo: no')
    if (gateAt >= 0 && reserveAt >= 0 && gateAt > reserveAt) {
      violations.push(`${f} — ㉲ 지문 게이트가 채번 뒤에 선다. 거절할 요청이 계약번호를 먹고 지워져 번호가 건너뛴다(신고 e7c09f2d 와 같은 클래스).`)
    }
    // ㉳ — 대면 박제. 조건부여야 한다. `translation: x` 는 번역본 없는 대면 서명 전건의 바이트를 바꾼다.
    if (!/\.\.\.\(printData\.translation \? \{ translation: printData\.translation as unknown as object \} : \{\}\)/.test(post)) {
      violations.push(`${f} — ㉳ 대면 서명 박제에 번역본을 조건부로 안 담는다. 그 사람이 무엇을 읽고 서명했는지가 안 남거나(재발급에서 우선 조항까지 사라진다), 번역본 없는 대면 서명 전건의 박제 바이트가 달라진다.`)
    }
  }
}

// ㉴ — 툴바 셀렉트
{
  const f = 'app/contract/[tenantId]/ContractView.tsx'
  const src = read(f)
  // 한 정규식으로 **이어서** 본다. 외국인 판정을 따로 찾으면 같은 파일의 서명 요청 쪽 호출이
  // 대신 걸려, 셀렉트에서 그 판정을 빼도 그물이 눈을 감는다(역주입 ②로 실측).
  if (!/const canPickTranslation = !remote && !signedSnapshot && translationLangs\.length > 0\s*\n?\s*&& isForeignForDocuments\(\{ nationality: data\.tenant\.nationality, hasForeignRegNo: data\.tenant\.hasForeignRegNo \}\)/.test(src)) {
    violations.push(`${f} — ㉴ 셀렉트가 '외국인이고 공개 언어가 있을 때만' 서지 않는다. 내국인·번역본 끈 영업장의 화면이 이 기능 전과 달라진다.`)
  }
  if (!/const translationLocked = bodyLocked \|\| docSlots\.some\(x => x\.signed\)/.test(src)) {
    violations.push(`${f} — ㉴ 서명이 들어온 화면에서 셀렉트가 안 잠긴다. 이미 서명한 사람이 읽은 문안이 바뀌고, 소프트 내비가 정보 표 폼과 조항 작업본을 서버 값으로 되돌린다.`)
  }
  // 버튼 모양을 통째로 못박는다. '토스트를 부르는가'만 보면 클래스를 갈아도 안 걸린다(역주입 ⑥).
  if (!/translationLocked \?/.test(src)
    || !/<button type="button" className="toolbar-locked" onClick=\{\(\) => pushToast\(\s*\n?\s*'info', translationLockMessage\(/.test(src)) {
    violations.push(`${f} — ㉴ 잠긴 셀렉트가 형제 문법(toolbar-locked + 이유 토스트)을 안 쓴다. 눌러도 아무 일이 없으면 화면이 고장난 것으로 읽힌다.`)
  }
  const pick = fnBody(src, src.indexOf('const pickTranslationLang ='))
  if (pick.length < 50) violations.push(`${f} — pickTranslationLang 본문을 못 떴다. 구조가 바뀌었으면 이 그물부터 고친다.`)
  else {
    // 저장이 아니라 보기 상태다. 카드가 서는 것 자체가 피드백이라 토스트를 띄우면 소음이다.
    if (/pushToast\(/.test(pick)) {
      violations.push(`${f} — ㉴ 언어를 바꿀 때 토스트를 띄운다. 저장이 아니라 보기 상태이고, 카드가 서는 것 자체가 피드백이다(운영자 오더).`)
    }
    // 한국어도 명시해 남긴다. 지우는 갈래를 함께 막는다 — set 만 보면 'ko 일 때만 지운다' 를
    // 덧붙여도 안 걸리고, 그 한 줄이 정확히 이 규칙을 깨는 방식이다(역주입 ⑤로 실측).
    if (!/params\.set\('lang', v\)/.test(pick) || /params\.delete\(/.test(pick)) {
      violations.push(`${f} — ㉴ 고른 언어를 URL 에 명시해 안 남긴다. 한국어를 고르면 국적 기본값으로 되돌아가 선택이 저절로 풀린다.`)
    }
    // 발화 시점의 실제 URL 로 재구성한다(형제 useUrlState 규칙) — 스냅샷을 쓰면 그 사이 붙은
    // 파라미터(?leaseTermId 등)를 지워 다른 계약의 계약서로 착지한다.
    if (!/new URLSearchParams\(window\.location\.search\)/.test(pick)) {
      violations.push(`${f} — ㉴ URL 을 발화 시점 값으로 재구성하지 않는다. 캡처해 둔 스냅샷을 쓰면 ?leaseTermId 가 지워져 다른 계약의 계약서로 착지한다.`)
    }
  }
}

// ㉵ — 본문 저장이 알리기만 한다
{
  const f = 'app/(app)/settings/actions.ts'
  const src = read(f)
  const save = fnBody(src, src.indexOf('export async function saveContractTemplate'))
  if (save.length < 300) violations.push(`${f} — saveContractTemplate 본문을 못 떴다. 구조가 바뀌었으면 이 그물부터 고친다.`)
  else {
    if (!/translationStaleAfterEdit\(/.test(save)) {
      violations.push(`${f} — ㉵ 본문 저장이 번역 손실을 안 센다. 다 번역해 둔 계약서가 조용히 반쪽이 된다(운영자 지적 2026-09-08).`)
    }
    // **세기만 한다.** 사전을 건드리면 조항을 되돌렸을 때 손번역이 안 되살아난다(구조 규칙 4).
    // 쓰는 자리는 update 의 data 하나뿐이라 그것이 본문만 담는지 본다(select 의 조회는 무해하다).
    if (!/data: \{ contractTemplate: template as unknown as object \},/.test(save)) {
      violations.push(`${f} — ㉵ 본문 저장이 번역 사전에 쓴다. 고아는 세고 알리기만 한다 — 지우면 조항을 되돌려도 손번역이 안 되살아난다.`)
    }
    // 0 이면 칸 자체가 없다 — 화면이 종전과 같은 한 줄 토스트를 띄운다.
    if (!/lost\.lines > 0 \? \{ ok: true, translationLost: lost \} : \{ ok: true \}/.test(save)) {
      violations.push(`${f} — ㉵ 잃은 줄이 0 일 때도 칸을 만든다(또는 안 돌려준다). 0 이면 아무 말도 안 하는 것이 종전과 같은 저장이다.`)
    }
    // 분모는 편집기와 같은 집합이다. 좁히면 특약 줄의 번역이 잃은 줄로 안 잡힌다.
    if (!/propertyContractAddenda\(before,/.test(save)) {
      violations.push(`${f} — ㉵ 계수 분모가 편집기와 다른 집합이다. 특약 줄의 번역이 사라져도 계수가 침묵한다.`)
    }
  }
}
{
  const f = 'app/(app)/settings/SettingsForm.tsx'
  const src = read(f)
  const save = fnBody(src, src.indexOf('const handleSaveTemplate ='))
  if (save.length < 200) violations.push(`${f} — handleSaveTemplate 본문을 못 떴다. 구조가 바뀌었으면 이 그물부터 고친다.`)
  else {
    if (!/res\.translationLost/.test(save)) {
      violations.push(`${f} — ㉵ 저장 화면이 번역 손실을 안 말한다. 서버가 세어 보내도 운영자는 못 본다.`)
    }
    // 알리기만 하고 길이 없으면 "그래서 어디서 고치나"가 남는다. 같은 화면 안이라 스크롤이면 된다.
    if (!/dv-contract-translation/.test(save)) {
      violations.push(`${f} — ㉵ 알림에서 번역 편집으로 가는 길이 없다. 알림은 고칠 자리를 함께 말해야 한다.`)
    }
  }
  // 카드가 본문 저장 뒤 제 데이터를 다시 읽는다. 안 읽으면 "번역을 다시 채워 주세요"가 데려온
  // 자리에서 옛 숫자를 보인다(카드는 마운트 때 한 번만 읽는다).
  if (!/<ContractTranslationCard reloadKey=/.test(src)) {
    violations.push(`${f} — ㉵ 번역본 카드가 본문 저장 신호를 안 받는다. 알림이 데려온 자리가 저장 전 숫자를 보인다.`)
  }
  const card = fnBody(src, src.indexOf('function ContractTranslationCard('))
  if (card.length >= 1000) {
    // 다시 읽을 때 편집 중인 입력칸을 덮으면 알림이 사고를 만든다.
    if (!/if \(initial\) \{/.test(card)) {
      violations.push(`${f} — ㉵ 다시 읽기가 편집 중인 언어·입력칸을 덮는다. 본문 저장이 운영자가 치던 번역을 지운다.`)
    }
    // 원문 폴백이 생긴 언어를 한자리에서 말한다. 계수는 해석·피커와 같은 정본이다.
    if (!/translationProgress\(stored, template, l, addenda, refundClauseInContract, 'property'\)/.test(card)) {
      violations.push(`${f} — ㉵ 언어별 원문 폴백을 정본으로 안 센다. 변수 줄을 따로 세면 다 채운 언어가 영영 미완으로 보인다.`)
    }
    if (!/fallbackLangs\.length > 0 &&/.test(card) || !/--warning-fg/.test(card)) {
      violations.push(`${f} — ㉵ 원문 폴백이 생긴 언어가 눈에 안 띈다. 언어를 하나씩 눌러 봐야 본문 수정이 어느 번역을 비웠는지 알 수 있다.`)
    }
  }
}


// ㉶ 줄바꿈 규칙은 언어가 정한다 — 번역본 카드는 break-keep 을 쓰면 안 된다.
//
// word-break: keep-all 은 어절 사이에 띄어쓰기가 있는 언어에서만 옳다. 일본어·중국어는
// 띄어쓰기가 없어 문장 하나가 통째로 끊을 수 없는 덩어리가 되고, 구두점에서만 끊겨 나머지가
// 칸 밖으로 흘러 **글이 잘린다**(운영자 긴급 신고 2026-09-08, 일본어 조항). 잘린 계약 조항은
// 읽을 수 없는 것과 같아서 이 카드가 존재하는 이유가 무너진다.
{
  const f = 'components/doc/ContractTranslationView.tsx'
  const src = readFileSync(f, 'utf8')
  // 주석 안의 언급은 봐준다 — 왜 안 쓰는지 적어 두는 것이 이 저장소의 관례다.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  if (/break-keep/.test(code)) {
    violations.push(`${f} — 번역본 카드에 break-keep 이 되살아났다. 일본어·중국어 조항이 칸을 넘어 잘린다.`)
  }
  if (!/wordBreak:\s*noSpaceScript/.test(code)) {
    violations.push(`${f} — 언어별 줄바꿈 판정(noSpaceScript)이 없다. ja·zh·zht 는 normal 이어야 한다.`)
  }
  if (!/overflowWrap:\s*'anywhere'/.test(code)) {
    violations.push(`${f} — overflow-wrap 안전망이 없다. 넘칠 때 글이 잘리는 길이 다시 열린다.`)
  }
}

// ── 7단계 배선(툴바 선택을 서명 요청으로 잇기) ──────────────────────
//
//   ㉷ 서명 요청 피커의 기본값이 **툴바에서 보고 있는 번역본**에서 온다. 판정은 정본 하나
//     (signRequestDefaultLang)이고 값은 **발화 시점의 URL** 에서 읽는다. 화면이 해석한 언어
//     (translationLangNow)를 읽으면 비공개 언어에서 ko 로 떨어져, 운영자가 고른 것과 다른
//     언어가 기본값이 된다.
//   ㉸ 그 값은 **피커 기본값까지만** 간다. URL 값을 issueContractShareLink 에 직접 넘기면
//     피커를 건너뛰는 길이 생긴다 — 화면이 필요로 하는 값과 종이가 지고 갈 값은 같지 않다.
//     서버로 가는 것은 피커가 돌려준 pickedLang 뿐이라야 한다.
//   ㉹ 왜 이 언어가 기본으로 잡혔는지 캡션이 말한다. 기존 '국적 기본값'과 **같은 슬롯**이라
//     줄이 늘지 않는다(카드 높이가 그 언어만 달라지던 지적과 같은 자리).
{
  const f = 'app/contract/[tenantId]/ContractView.tsx'
  const src = read(f)
  const h = fnBody(src, src.indexOf('const handleSignRequest ='))
  if (h.length < 500) violations.push(`${f} — handleSignRequest 본문을 못 떴다. 구조가 바뀌었으면 이 그물부터 고친다.`)
  else {
    // ㉷ — 정본 판정 + 발화 시점 URL. 둘을 **이어서** 본다. 따로 찾으면 같은 파일의
    // pickTranslationLang 쪽 URL 재구성이 대신 걸려, 여기서 URL 을 안 읽어도 눈을 감는다.
    if (!/signRequestDefaultLang\(\s*\n?\s*new URLSearchParams\(window\.location\.search\)\.get\('lang'\), data\.tenant\.nationality\)/.test(h)) {
      violations.push(`${f} — ㉷ 서명 요청이 툴바에서 보고 있는 번역본을 정본 판정으로 안 이어받는다(또는 발화 시점 URL 을 안 읽는다). 방금 고른 언어가 다음 화면에서 사라진다.`)
    }
    if (/translationLangNow/.test(h)) {
      violations.push(`${f} — ㉷ 기본값을 화면이 해석한 언어에서 읽는다. 비공개 언어면 ko 로 떨어져 운영자가 고른 것과 다른 언어가 기본값이 된다.`)
    }
    if (!/askSignLang\(def\.lang, def\.fromView\)/.test(h)) {
      violations.push(`${f} — ㉷ 피커에 기본값과 그 출처를 안 넘긴다. 캡션이 왜 이 언어인지 말할 근거가 없다.`)
    }
    // ㉸ — 서버로 가는 값은 피커가 돌려준 것 하나뿐이다.
    for (const m of h.matchAll(/issueContractShareLink\(([^)]*)\)/g)) {
      if (!/,\s*pickedLang\s*$/.test(m[1])) {
        violations.push(`${f} — ㉸ 발급 호출이 피커가 돌려준 값(pickedLang) 말고 다른 언어를 넘긴다: ${m[0]}. URL 값이 곧장 가면 피커를 건너뛰는 길이 생긴다.`)
      }
    }
    for (const m of h.matchAll(/(?<!let )pickedLang\s*=\s*([^\n]+)/g)) {
      if (m[1].trim() !== 'pick') {
        violations.push(`${f} — ㉸ pickedLang 에 피커의 답이 아닌 값이 들어간다: ${m[0].trim()}. 서버로 가는 언어는 운영자가 실제로 고른 것 하나여야 한다.`)
      }
    }
    if (!/let pickedLang: SignLang \| undefined/.test(h) || !/pickedLang = pick/.test(h)) {
      violations.push(`${f} — ㉸ 고른 값을 담는 자리가 없다. 내국인 발급이 언어 없이 종전 호출 그대로 지나가는 구조가 이 두 줄이다.`)
    }
  }
  // ㉹ — 화면이 출처를 넘긴다.
  if (!/defaultFromView=\{langPick\.fromView\}/.test(src)) {
    violations.push(`${f} — ㉹ 피커에 기본값의 출처를 안 넘긴다. 툴바에서 고른 언어인데도 캡션이 '국적 기본값'이라 거짓을 말한다.`)
  }
}
{
  const f = 'components/doc/SignRequestLangPicker.tsx'
  const src = read(f)
  // 문구를 못박는다. 같은 슬롯·같은 join 이라야 줄이 안 늘고 자릿수도 안 흔들린다(§11 tnum).
  if (!/defaultFromView \? '지금 보는 번역본' : '국적 기본값'/.test(src)) {
    violations.push(`${f} — ㉹ 기본값의 이유를 캡션이 안 가른다. 툴바에서 고른 언어에도 '국적 기본값'이라 적힌다.`)
  }
  if (!/\.filter\(Boolean\)\.join\(' · '\)/.test(src) || !/tabular-nums/.test(src)) {
    violations.push(`${f} — ㉹ 캡션이 한 줄 병기 문법을 벗었다(가운뎃점 병기 · tnum). 기본값 언어만 카드 높이가 달라지거나 숫자 세로줄이 흔들린다.`)
  }
}

// ── 8단계 배선(설정의 저장 전 미리보기) ─────────────────────────────
//
//   ㉺ 환경설정 미리보기가 **입주자에게 나가는 그 두 정본**으로만 선다 — 해석은
//     resolveContractTranslation, 본문은 ContractTranslationBody 다. 해석이든 본문이든 한 벌
//     더 세우면 운영자가 보고 확인한 문안과 입주자가 실제로 받는 문안이 갈리고, 그 순간 이
//     창은 확인이 아니라 착각이 된다. 원천도 화면 입력칸(draft)이라야 한다 — 저장본을 읽으면
//     '저장 전에 본다'는 이 창의 이유가 사라진다.
//   ㉻ 그 본문에 **vars 를 넘기지 않는다.** 계약이 없는 자리라 넘길 값은 지어낸 값뿐이고,
//     미리보기가 오늘 지어낸 금액을 보이면 종이보다 나쁘다(ContractTranslationView 의 vars 규칙).
//     환불 규정만 해석이 제 값을 들고 오고 나머지 자리표시자는 글자 그대로 남아야 한다.
{
  const f = 'app/(app)/settings/SettingsForm.tsx'
  const raw = readFileSync(f, 'utf8')
  const src = read(f)

  // 정본 둘을 불러오는지부터 본다. import 줄은 read 가 걷으므로 원본에서 찾는다.
  if (!/import\s*\{[^}]*\bContractTranslationBody\b[^}]*\}\s*from\s*'@\/components\/doc\/ContractTranslationView'/.test(raw)) {
    violations.push(`${f} — ㉺ 미리보기가 본문 정본(ContractTranslationBody)을 안 불러온다. 본문이 두 벌이면 운영자가 본 문안과 입주자가 받는 문안이 갈린다.`)
  }

  const memo = fnBody(src, src.indexOf('const preview = useMemo('))
  if (memo.length < 100) {
    violations.push(`${f} — ㉺ 미리보기 해석(preview useMemo) 본문을 못 떴다. 구조가 바뀌었으면 이 그물부터 고친다.`)
  } else {
    if (!/resolveContractTranslation\(/.test(memo)) {
      violations.push(`${f} — ㉺ 미리보기가 해석 정본(resolveContractTranslation)을 안 쓴다. 자체 해석을 세우면 창과 종이의 규칙이 두 벌이 된다.`)
    }
    // 화면 입력칸을 공개 켜진 사전 모양으로 싸서 그대로 넣는다.
    if (!/published:\s*true,\s*dict:\s*draft/.test(memo)) {
      violations.push(`${f} — ㉺ 미리보기가 화면 입력칸(draft)을 공개 켠 사전으로 싸서 넣지 않는다. 저장 전 문안을 보는 창인데 저장본을 보인다.`)
    }
    // 정본을 부르는 창은 사전을 직접 훑을 일이 없다. 훑고 있으면 해석이 한 벌 더 선 것이다.
    if (/\.map\(/.test(memo) || /\bdict\[/.test(memo)) {
      violations.push(`${f} — ㉺ 미리보기가 사전·조항을 직접 훑는다. 해석은 정본 하나가 진다.`)
    }
  }

  // ㉻ — 이 파일에서 본문이 서는 자리는 미리보기 하나뿐이고, 거기에 vars 가 붙으면 안 된다.
  const uses = src.match(/<ContractTranslationBody[^>]*>/g) ?? []
  if (uses.length !== 1) {
    violations.push(`${f} — ㉻ 미리보기 본문이 ${uses.length}곳에 선다. 이 파일에서 그 자리는 하나여야 한다.`)
  }
  for (const u of uses) {
    if (/\bvars=/.test(u)) {
      violations.push(`${f} — ㉻ 미리보기가 본문에 vars 를 넘긴다: ${u.trim()}. 계약이 없는 자리라 그 값은 지어낸 값이고, 미리보기가 거짓을 보인다.`)
    }
    // 원문으로 남은 줄의 회색 표식은 원문 두 벌을 넘겨야 선다(표식이 없으면 다 번역된 것처럼 읽힌다).
    if (!/source=\{template\}/.test(u) || !/sourceAddenda=\{addenda\}/.test(u)) {
      violations.push(`${f} — ㉻ 미리보기가 원문(source·sourceAddenda)을 안 넘긴다. 한국어로 남는 줄에 '원문' 표식이 안 서서 다 번역된 것처럼 보인다.`)
    }
  }
}

// ── 9단계 배선(청소비 변수 줄 · 치환 두 겹) ─────────────────────────
//
//   ㉼ 청소비 열쇠는 **치환 전 문안**이다. 종이가 쓰는 완성 문장을 열쇠로 삼으면 금액이 다른
//     계약에서 그 사전이 한 번도 안 맞아, 다 번역한 영업장에서도 그 조항만 한국어로 남는다.
//     그리고 종이 문장과 열쇠가 **같은 상수 하나**에서 나와야 한다 — 두 벌이면 문안을 고칠 때
//     종이만 바뀌고 사전은 옛 문장에 묶인 채 번역이 통째로 고아가 된다.
//   ㉽ 편집기가 **줄 셋을 세운다**(있음 · 없음 · 공제 꼬리). 청소비는 계약별이라 한 영업장에
//     두 갈래가 실제로 공존하고, 한 갈래만 세우면 다른 갈래 계약이 영영 번역되지 않는다.
//   ㉾ 번역본 본문의 치환이 **두 겹**이다. 주입한 값 안의 자리표시자를 종이 vars 로 먼저 채운
//     뒤 덮어야 한다. 한 패스면 번역문이 지킨 `{{청소비}}` 가 두 번째 패스를 못 만나 글자
//     그대로 화면에 찍힌다(2026-09-11 봉합 — 환불은 값에 자리표시자가 없어 안 드러났을 뿐이다).
{
  const f = 'lib/contract.ts'
  const src = read(f)
  // 상수가 자리표시자를 품은 그대로여야 한다. 금액을 박아 두면 그 순간 계약별 열쇠가 된다.
  if (!/clause: '\[청소비\] 청소비 \{\{청소비\}\}은/.test(src) || !/deduct: '\(보증금 내 청소비 \{\{청소비\}\} 별도 공제\)'/.test(src)) {
    violations.push(`${f} — ㉼ 청소비 치환 전 문안에 금액 자리(\`{{청소비}}\`)가 없다. 열쇠가 계약별로 갈려 그 사전은 어느 계약에서도 안 맞는다.`)
  }
  // 종이 문장이 그 상수에서 나온다 — 문자열을 다시 적으면 두 벌이 되어 언젠가 갈린다.
  // fnBody 도 최상위 `}` 찾기도 못 쓴다 — 이 함수는 반환 타입 주석이 `{` 로 열리고 `\n} {` 로
  // 닫혀, 둘 다 그 한 줄에서 멈춘다. 짧은 함수라 선언 자리부터 넉넉히 잘라 본다.
  const varsAt = src.indexOf('export function cleaningFeeVars')
  const vars = varsAt < 0 ? '' : src.slice(varsAt, varsAt + 1200)
  if (vars.length < 100) violations.push(`${f} — cleaningFeeVars 본문을 못 떴다. 구조가 바뀌었으면 이 그물부터 고친다.`)
  else if (!/청소비조항: CLEANING_FEE_SOURCE\.none/.test(vars)
    || !/청소비조항: fill\(CLEANING_FEE_SOURCE\.clause\)/.test(vars)
    || !/청소비공제: ` \$\{fill\(CLEANING_FEE_SOURCE\.deduct\)\}`/.test(vars)) {
    violations.push(`${f} — ㉼ 종이 문장이 치환 전 문안 정본에서 안 나온다. 두 벌이 되면 문안을 고칠 때 종이만 바뀌고 저장된 번역이 통째로 고아가 된다.`)
  }
}
{
  const f = 'lib/contractTranslation.ts'
  const src = read(f)
  // 열쇠는 lib/contract 의 상수 그대로다. 여기서 문자열을 다시 적으면 사본이 하나 더 선다.
  if (!/return \{ clause: CLEANING_FEE_SOURCE\.clause, none: CLEANING_FEE_SOURCE\.none, deduct: CLEANING_FEE_SOURCE\.deduct \}/.test(src)) {
    violations.push(`${f} — ㉼ 청소비 열쇠가 종이의 정본 상수가 아니다. 문구가 바뀌면 저장된 번역이 통째로 고아가 된다.`)
  }
  // 해석 헬퍼는 **그 계약의 금액**을 넘긴다. 편집기 기준('property')을 넘기면 두 갈래가 다 서고
  // 앞선 갈래가 이겨, 청소비 0원 계약의 번역본에 '청소비 20,000원은…' 조항이 실린다
  // (2026-09-11 역주입 ⑥ 으로 실제로 뚫렸다). 한 정규식으로 이어서 본다.
  if (!/return resolveContractTranslation\(\s*\n?\s*stored, d\.template, lang, contractAddendaForTranslation\(d\), d\.refundClauseInContract,\s*\n?\s*d\.lease\?\.cleaningFee \?\? 0\)/.test(src)) {
    violations.push(`${f} — ㉽ 해석 정본 헬퍼가 그 계약의 청소비를 안 넘긴다. 편집기 기준이 들어가면 종이와 다른 갈래의 조항이 번역본에 실린다.`)
  }
  // 줄 셋 — 있음·없음·공제 꼬리. 공제는 **있음 갈래에만** 선다(없음 갈래의 종이 값은 빈 문자열).
  const specs = fnBody(src, src.indexOf('export function translationVarSpecs'))
  if (specs.length < 200) violations.push(`${f} — translationVarSpecs 본문을 못 떴다. 구조가 바뀌었으면 이 그물부터 고친다.`)
  else {
    if (!/if \(paid\) out\.push\(all\.cleaningClause\)/.test(specs)
      || !/if \(everyBranch \|\| cleaning <= 0\) out\.push\(all\.cleaningNone\)/.test(specs)) {
      violations.push(`${f} — ㉽ 청소비 조항 두 갈래가 안 선다. 영업장 편집기는 둘 다, 계약은 그 계약 갈래만이라야 종이와 안 갈린다.`)
    }
    if (!/if \(paid && templateHasPlaceholder\(template, addenda, CLEANING_DEDUCT_PLACEHOLDER\)\) \{\s*\n\s*out\.push\(all\.cleaningDeduct\)/.test(specs)) {
      violations.push(`${f} — ㉽ 공제 꼬리가 '있음 갈래 + 본문에 자리' 조건으로 안 선다. 종이에 아무것도 안 나가는 문장을 번역하라고 칸이 서거나, 나가는데 칸이 안 선다.`)
    }
    // 본문에 자리가 없으면 종이에 안 들어간다 — 조건을 빼면 그 영업장에 헛칸이 선다.
    if (!/templateHasPlaceholder\(template, addenda, CLEANING_CLAUSE_PLACEHOLDER\)/.test(specs)) {
      violations.push(`${f} — ㉽ 청소비 조항 줄이 본문의 자리를 안 본다. 그 조항을 지운 영업장에 번역할 칸이 선다.`)
    }
  }
}
{
  const f = 'components/doc/ContractTranslationView.tsx'
  const src = read(f)
  // 두 겹 치환. 주입값을 **먼저** 종이 vars 로 채우고 그 다음에 덮는다. 순서를 뒤집으면
  // 종이의 한국어 문장이 번역문을 도로 덮는다.
  if (!/for \(const \[k, v\] of Object\.entries\(translation\.vars \?\? \{\}\)\) \{\s*\n\s*if \(typeof v === 'string'\) injected\[k\] = renderContractText\(v, paperVars\)/.test(src)) {
    violations.push(`${f} — ㉾ 주입값 안의 자리표시자를 종이 vars 로 안 채운다. 치환이 한 패스라 번역문이 지킨 {{청소비}} 가 글자 그대로 찍힌다.`)
  }
  if (!/const renderVars = vars \|\| translation\.vars \? \{ \.\.\.paperVars, \.\.\.injected \} : null/.test(src)) {
    violations.push(`${f} — ㉾ 번역본 값이 종이 값을 안 덮거나, 종이 값이 나중에 얹혀 번역문을 도로 덮는다. 다 번역한 번역본에서 그 문단만 한국어로 남는다.`)
  }
}

if (violations.length) {
  console.error('참고용 번역본 배선 위반:')
  for (const v of violations) console.error(`  - ${v}`)
  process.exit(1)
}
console.log('참고용 번역본 배선: 이상 없음 (발급 박제 · 조건부 · 서명 동결 · 드리프트 · 축 · 발급 시트 · 병합 정본 · 서명 화면 카드 · 읽음확인 0 · 우선 조항 화면/인쇄 · 박제 승계 · 조건부 담기 · 발급 축 · 전문 열람 · 피커 캡션 · 왕복 정본 · 손 파싱 0 · 되붙이기 저장 0 · 고아 삭제 0 · 카드 치환 · 절 번호 정본 · 종이 vars · 계약분 특약 · 저장 거부 · 분모 둘 · 박제 vars 조건부 · facts 무접촉 · 조판 정본 · 옛 발급본 안내 · 변수 줄 조건 · 빈 칸=권장 · 미리채움 0 · 경고 비차단 · 페이지 lang · 옵션 옵트인 · 국적 기본값 · 해석 헬퍼 단일 · 언어 코드만 · 지문 게이트 · 대면 박제 · 툴바 셀렉트 · 본문 저장 알림 · 피커 기본값 이어받기 · 발급 직접 전달 0 · 기본값 캡션 · 설정 미리보기 정본 · 미리보기 vars 0 · 청소비 열쇠 치환 전 · 청소비 줄 셋 · 치환 두 겹)')
