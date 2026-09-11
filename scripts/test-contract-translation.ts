// 참고용 번역본 정본 회귀 — 파서 방어·원문 폴백·고아 계수·꺼짐이면 null 을 진리표로 못박는다.
import {
  TRANSLATION_LANGS, asTranslationLang, parseContractTranslations, translationSourceLines,
  resolveContractTranslation, orphanTranslationKeys, withTranslationEnabled, mergeTranslationLang,
  TRANSLATION_NOTICE, translationNoticeBi, TRANSLATION_NOTICE_ADDENDUM, contractTranslationAddendum,
  asResolvedContractTranslation, translationProgress, TRANSLATION_LANG_ENDONYM,
  translationCopyLine, translationCopyText, applyTranslationPaste,
  translationPlaceholders, missingTranslationPlaceholders, translationPlaceholderMessage,
  RECOMMENDED_REFUND_TRANSLATION, isCustomVarTranslation, refundTranslationKey,
  REFUND_VAR_PLACEHOLDER, REFUND_VAR_NAME, translationDisplayVars,
  resolveContractTranslationFor, translationDigest, contractTranslationLangFor, translationStaleAfterEdit,
  signRequestDefaultLang,
  cleaningTranslationKeys, RECOMMENDED_CLEANING_TRANSLATION, translationVarSpecs, translationVarSpecByKey,
  translationLineDone,
  CLEANING_CLAUSE_PLACEHOLDER, CLEANING_DEDUCT_PLACEHOLDER, TRANSLATION_VAR_NAMES, TRANSLATION_VAR_LABEL,
  type TranslationVarSpec, type TranslationLang,
} from '../lib/contractTranslation'
import { SIGN_LANGS } from '../lib/signGuideText'
import {
  appendSubLeaseAddendum, buildRoomScheduleAddendum, buildRefundClause, cleaningFeeVars,
  contractAddendaForTranslation, renderContractText, stripClauseBullet, CLEANING_FEE_SOURCE,
  DEFAULT_CONTRACT_TEMPLATE, DEFAULT_SUB_LEASE_ADDENDUM, DEFAULT_SHORT_STAY_ADDENDUM,
  DEFAULT_EARLY_CHECKOUT_ADDENDUM, DEFAULT_ROOM_SCHEDULE_ADDENDUM, DEFAULT_DISPOSAL_CONSENT,
  type ContractTemplate, type SubLeaseAddendum,
} from '../lib/contract'
import { printedFacts } from '../lib/contractPrintedFacts'
import { contractPrintVars, type PrintContractData } from '../lib/contractPrintHtml'

let pass = 0
const fails: string[] = []
const eq = (name: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) pass++
  else fails.push(`${name}: 기대 ${w} / 실제 ${g}`)
}
// 배열·객체를 짚는 자리는 전부 옵셔널로 읽는다. 역주입으로 값이 비면 크래시가 아니라 문장으로
// 실패해야 어느 진리표가 깨졌는지 보인다(test-sign-documents 와 같은 규칙).

/** 진리표용 본문. 번역 대상 문자열은 7개다(제목 1 + 절 제목 2 + 항목 3 + 서약문 1). */
const T: ContractTemplate = {
  title: '단기숙소계약서',
  sections: [
    { id: 'lease', title: '1. 입실 계약', items: ['1인 1실을 원칙으로 합니다.', '입실료는 매월 선납합니다.'] },
    { id: 'out', title: '2. 퇴실 및 환불', items: ['퇴실 7일 전에 알려주어야 합니다.'] },
  ],
  oathText: '상기 규칙을 숙지하였음을 서약합니다.',
}

// ── 언어 목록 ───────────────────────────────────────────────
eq('언어 목록에 ko 가 없다', TRANSLATION_LANGS.includes('ko' as never), false)
eq('안내 언어에서 ko 하나만 뺀 것', TRANSLATION_LANGS.length, SIGN_LANGS.length - 1)
eq('ko 는 번역 언어가 아니다', asTranslationLang('ko'), undefined)
eq('en 은 번역 언어다', asTranslationLang('en'), 'en')
eq('모르는 코드는 버린다', asTranslationLang('xx'), undefined)
eq('문자열 아니면 버린다', asTranslationLang(123), undefined)

// ── 파서 방어. 알 수 없는 키·타입은 버린다 ───────────────────
eq('null 은 빈 상태', parseContractTranslations(null), { enabled: false, langs: {} })
eq('배열이면 빈 상태', parseContractTranslations([1, 2]), { enabled: false, langs: {} })
eq('문자열이면 빈 상태', parseContractTranslations('on'), { enabled: false, langs: {} })
eq('enabled 는 true 만 참', parseContractTranslations({ enabled: 'true' }).enabled, false)
eq('langs 가 배열이면 버린다', parseContractTranslations({ enabled: true, langs: [] }).langs, {})
eq('모르는 언어 키는 버린다',
  Object.keys(parseContractTranslations({ langs: { zz: { published: true, dict: {} } } }).langs), [])
eq('ko 언어 키도 버린다',
  Object.keys(parseContractTranslations({ langs: { ko: { published: true, dict: {} } } }).langs), [])
eq('entry 가 객체가 아니면 버린다',
  Object.keys(parseContractTranslations({ langs: { en: 'x' } }).langs), [])
eq('published 는 true 만 참',
  parseContractTranslations({ langs: { en: { published: 1, dict: {} } } }).langs.en?.published, false)
eq('dict 값이 문자열 아니면 버린다',
  parseContractTranslations({ langs: { en: { published: true, dict: { A: 1, B: 'ok' } } } }).langs.en?.dict,
  { B: 'ok' })
eq('빈 번역은 버린다(아직 번역 안 함)',
  parseContractTranslations({ langs: { en: { published: true, dict: { A: '   ', B: 'ok' } } } }).langs.en?.dict,
  { B: 'ok' })
eq('빈 열쇠는 버린다',
  parseContractTranslations({ langs: { en: { published: true, dict: { '': 'x' } } } }).langs.en?.dict, {})
eq('dict 가 없어도 entry 는 선다',
  parseContractTranslations({ langs: { en: { published: true } } }).langs.en?.dict, {})

// ── 번역 대상 문자열 ────────────────────────────────────────
{
  const lines = translationSourceLines(T)
  eq('종이 순서대로 7줄', lines.map(l => l.kind),
    ['title', 'sectionTitle', 'item', 'item', 'sectionTitle', 'item', 'oath'])
  eq('첫 줄은 계약서 제목', lines[0]?.text, '단기숙소계약서')
  eq('마지막 줄은 서약문', lines[6]?.text, '상기 규칙을 숙지하였음을 서약합니다.')
  eq('절 순번이 붙는다', lines[4]?.sectionIndex, 1)

  const dup = translationSourceLines({
    title: '같은 문장', sections: [{ id: 'a', title: '같은 문장', items: ['같은 문장', ' '] }], oathText: '끝',
  })
  eq('같은 문장은 한 번만(열쇠가 문장이라 칸이 둘이면 나중 것이 앞 것을 덮는다)',
    dup.map(l => l.text), ['같은 문장', '끝'])
  eq('빈 문자열은 번역 대상이 아니다', dup.filter(l => !l.text.trim()).length, 0)
}

// ── 해석. 꺼짐·null 이면 결과가 null ─────────────────────────
eq('저장값이 null 이면 해석도 null', resolveContractTranslation(null, T, 'en'), null)
eq('운영 스위치가 꺼져 있으면 null',
  resolveContractTranslation({ enabled: false, langs: { en: { published: true, dict: { 단기숙소계약서: 'Contract' } } } }, T, 'en'), null)
eq('그 언어가 없으면 null',
  resolveContractTranslation({ enabled: true, langs: { en: { published: true, dict: {} } } }, T, 'vi'), null)
eq('미공개면 null(미완인 언어를 안 내보낸다)',
  resolveContractTranslation({ enabled: true, langs: { en: { published: false, dict: { 단기숙소계약서: 'Contract' } } } }, T, 'en'), null)

// ── 해석. 번역 있음·없음이 섞였을 때 ─────────────────────────
{
  const raw = {
    enabled: true,
    langs: {
      en: {
        published: true,
        dict: {
          단기숙소계약서: 'Short-stay Accommodation Contract',
          '1. 입실 계약': '1. Move-in',
          '1인 1실을 원칙으로 합니다.': 'One person per room as a rule.',
        },
      },
    },
  }
  const r = resolveContractTranslation(raw, T, 'en')
  eq('언어가 결과에 박힌다', r?.lang, 'en')
  eq('있는 번역은 그것', r?.title, 'Short-stay Accommodation Contract')
  eq('절 제목도 번역', r?.sections[0]?.title, '1. Move-in')
  eq('있는 항목은 번역', r?.sections[0]?.items[0], 'One person per room as a rule.')
  eq('없는 항목은 **한국어 원문 그대로**(감추지 않는다)', r?.sections[0]?.items[1], '입실료는 매월 선납합니다.')
  eq('없는 절 제목도 원문 그대로', r?.sections[1]?.title, '2. 퇴실 및 환불')
  eq('서약문도 원문 그대로', r?.oathText, '상기 규칙을 숙지하였음을 서약합니다.')
  eq('총수는 7', r?.totalCount, 7)
  eq('원문으로 남은 것은 4', r?.fallbackCount, 4)
  eq('절 개수가 안 줄어든다', r?.sections.length, 2)
  eq('항목 개수도 안 줄어든다', r?.sections.map(s => s.items.length), [2, 1])

  const none = resolveContractTranslation({ enabled: true, langs: { en: { published: true, dict: {} } } }, T, 'en')
  eq('사전이 비어도 절은 그대로 선다(조항 번호 대응)', none?.sections.map(s => s.items.length), [2, 1])
  eq('사전이 비면 전부 원문', none?.fallbackCount, 7)
  eq('그때 제목도 원문', none?.title, '단기숙소계약서')
}

// 빈 항목은 자리를 지킨다 — 감추면 "3조 2항"이 번역본에서 다른 줄을 가리킨다.
{
  const withBlank: ContractTemplate = {
    title: '계약서', sections: [{ id: 'a', title: '1. 절', items: ['첫 줄', '', '셋째 줄'] }], oathText: '서약',
  }
  const r = resolveContractTranslation({ enabled: true, langs: { en: { published: true, dict: { '첫 줄': 'first' } } } }, withBlank, 'en')
  eq('빈 항목도 자리를 지킨다', r?.sections[0]?.items, ['first', '', '셋째 줄'])
  // 제목 · 절 제목 · 항목 둘(빈 줄 제외) · 서약문 = 5. 빈 줄은 번역할 것이 없어 총수에서 빠진다.
  eq('빈 항목은 총수에 안 든다(번역할 것이 없다)', r?.totalCount, 5)
}

// ── 고아 계수. 세기만 하고 안 지운다 ─────────────────────────
{
  const raw = {
    enabled: true,
    langs: {
      en: { published: true, dict: { 단기숙소계약서: 'Contract', '옛 조항입니다.': 'Old clause.', '또 다른 옛 줄': 'Another.' } },
    },
  }
  eq('원문에서 사라진 번역이 고아', orphanTranslationKeys(raw, T, 'en'), ['옛 조항입니다.', '또 다른 옛 줄'])
  eq('고아는 fallbackCount 에 안 섞인다', resolveContractTranslation(raw, T, 'en')?.fallbackCount, 6)
  eq('없는 언어의 고아는 0건', orphanTranslationKeys(raw, T, 'vi'), [])
  eq('고아는 저장본에 그대로 남는다',
    Object.keys(parseContractTranslations(raw).langs.en?.dict ?? {}).length, 3)
}

// ── 저장 병합. 삭제 경로가 없다는 것이 이 블록의 전부다 ──────
{
  const stored = {
    enabled: true,
    langs: {
      en: { published: true, dict: { A: 'a', 고아: 'orphan' } },
      vi: { published: false, dict: { A: 'av' } },
    },
  }
  eq('운영 스위치만 바꾸면 사전은 그대로',
    withTranslationEnabled(stored, false).langs, parseContractTranslations(stored).langs)
  eq('운영 스위치가 실제로 바뀐다', withTranslationEnabled(stored, false).enabled, false)

  /** 성공만 골라 읽는다 — 거부인데 값을 읽으면 undefined 로 실패해야 어느 진리표가 깨졌는지 보인다. */
  const merged = (r: ReturnType<typeof mergeTranslationLang>) => (r.ok ? r.next : null)

  const m = merged(mergeTranslationLang(stored, 'en', { published: true, dict: { A: 'a2' } }))
  eq('payload 에 없는 열쇠(고아)는 안 지워진다', m?.langs.en?.dict, { A: 'a2', 고아: 'orphan' })
  eq('남의 언어는 안 건드린다', m?.langs.vi?.dict, { A: 'av' })
  eq('운영 스위치도 안 건드린다', m?.enabled, true)

  eq('빈 값으로 오면 그 열쇠만 걷는다(번역 취소)',
    merged(mergeTranslationLang(stored, 'en', { dict: { A: '  ' } }))?.langs.en?.dict, { 고아: 'orphan' })
  eq('공개만 바꿔도 사전은 그대로',
    merged(mergeTranslationLang(stored, 'en', { published: false }))?.langs.en?.dict, { A: 'a', 고아: 'orphan' })
  eq('공개가 실제로 바뀐다', merged(mergeTranslationLang(stored, 'en', { published: false }))?.langs.en?.published, false)
  eq('없던 언어를 새로 만든다',
    merged(mergeTranslationLang(stored, 'ja', { published: true, dict: { A: 'aj' } }))?.langs.ja, { published: true, dict: { A: 'aj' } })
  eq('null 저장본 위에도 선다',
    merged(mergeTranslationLang(null, 'en', { published: true, dict: { A: 'a' } }))?.langs.en?.published, true)
}

// ── 우선 조항과 고지 사전 ────────────────────────────────────
eq('고지 사전은 8언어 전량', Object.keys(TRANSLATION_NOTICE).length, SIGN_LANGS.length)
eq('빠진 언어가 없다', SIGN_LANGS.filter(l => !TRANSLATION_NOTICE[l]?.trim()), [])
eq('병기는 한국어 줄이 앞선다', translationNoticeBi('en').split('\n')[0], TRANSLATION_NOTICE.ko)
eq('그 언어 줄이 뒤따른다', translationNoticeBi('en').split('\n')[1], TRANSLATION_NOTICE.en)
eq('번역본 없으면 절도 없다', contractTranslationAddendum(null), null)
eq('undefined 도 마찬가지', contractTranslationAddendum(undefined), null)
{
  const r = resolveContractTranslation({ enabled: true, langs: { en: { published: true, dict: {} } } }, T, 'en')
  eq('번역본이 있으면 고정 문안이 붙는다', contractTranslationAddendum(r), TRANSLATION_NOTICE_ADDENDUM)
  eq('절 제목은 고정', TRANSLATION_NOTICE_ADDENDUM.title, '번역본과 언어')
  eq('절 본문은 한 항목', TRANSLATION_NOTICE_ADDENDUM.items.length, 1)
}

// 무회귀의 근거 — 번역본이 없으면 절 배열이 **같은 객체 그대로** 돌아온다(새 배열도 안 만든다).
{
  const secs = [{ title: '1. 입실 계약', items: ['x'] }]
  eq('번역본 없는 계약서의 절 배열은 안 움직인다',
    appendSubLeaseAddendum(secs, contractTranslationAddendum(null)) === secs, true)
}

// ── 인쇄 사실 사영의 번역 축 ────────────────────────────────
// 여기가 무회귀의 급소다. 축을 늘리면 **이미 나간 종이 전건**이 드리프트로 뜰 수 있다.
eq('번역본 없으면 축 자체가 없다', printedFacts({}).translation, undefined)
eq('null 이어도 축이 없다', printedFacts({ translation: null }).translation, undefined)
eq('번역본이 있으면 통비교 문자열', typeof printedFacts({ translation: { lang: 'en' } }).translation, 'string')
eq('문장 한 줄이 바뀌면 축도 바뀐다',
  printedFacts({ translation: { lang: 'en', title: 'A' } }).translation
  !== printedFacts({ translation: { lang: 'en', title: 'B' } }).translation, true)
eq('언어가 바뀌어도 축이 바뀐다',
  printedFacts({ translation: { lang: 'en' } }).translation
  !== printedFacts({ translation: { lang: 'vi' } }).translation, true)
// 발급본 박제(issuedSnapshot.facts)는 이 객체를 그대로 직렬화한다. undefined 키는 JSON 에 안
// 실리므로, 번역본이 없는 발급본의 박제는 이 축이 생기기 전과 **바이트가 같다.**
eq('축이 없으면 JSON 에 글자 하나도 안 남는다',
  JSON.stringify(printedFacts({ lease: { rentAmount: 1 } })).includes('translation'), false)

// ── 2단계. 박제 읽기 — 화면이 사전을 다시 해석하지 않는다 ────
//
// 이 블록이 지키는 것 하나. **카드가 보여주는 것은 얼어 있는 문안이다.** 파서가 사전도
// 템플릿도 안 받는다는 사실 자체가 재해석을 구조적으로 막는다(인자가 없어서 못 한다).
{
  // 지금 사전과 **다른** 문안을 얼려 둔 상태. 재해석이 섞이면 여기서 값이 바뀐다.
  const frozen = {
    lang: 'en',
    title: 'FROZEN TITLE',
    sections: [{ title: 'FROZEN SECTION', items: ['frozen item', '입실료는 매월 선납합니다.'] }],
    oathText: 'FROZEN OATH',
    fallbackCount: 1,
    totalCount: 7,
  }
  const r = asResolvedContractTranslation(frozen)
  eq('박제한 제목이 그대로 나온다', r?.title, 'FROZEN TITLE')
  eq('박제한 절 제목도 그대로', r?.sections[0]?.title, 'FROZEN SECTION')
  eq('박제한 항목도 그대로', r?.sections[0]?.items, ['frozen item', '입실료는 매월 선납합니다.'])
  eq('박제한 서약문도 그대로', r?.oathText, 'FROZEN OATH')
  eq('세어 둔 수도 그대로', [r?.fallbackCount, r?.totalCount], [1, 7])
  eq('언어도 그대로', r?.lang, 'en')
}

// 스냅샷에 칸이 없으면 카드를 안 그린다 — 화면의 조건이 이 null 하나다.
eq('칸이 없으면 null', asResolvedContractTranslation(undefined), null)
eq('null 이면 null', asResolvedContractTranslation(null), null)
eq('배열이면 null', asResolvedContractTranslation([1]), null)
eq('문자열이면 null', asResolvedContractTranslation('en'), null)
eq('언어가 없으면 null', asResolvedContractTranslation({ title: 'x' }), null)
eq('모르는 언어면 null', asResolvedContractTranslation({ lang: 'xx', title: 'x' }), null)
eq('한국어는 번역본이 아니라 null', asResolvedContractTranslation({ lang: 'ko', title: 'x' }), null)

// 오염 방어. 모양이 아닌 조각은 빈 값으로 착지하되 **줄 수는 안 줄인다**(조항 번호 대응).
{
  const r = asResolvedContractTranslation({
    lang: 'vi', title: 123, sections: [{ title: null, items: ['ok', 7, null] }, 'not-an-object'],
    oathText: {}, fallbackCount: -3, totalCount: 'many',
  })
  eq('문자열 아닌 제목은 빈 문자열', r?.title, '')
  eq('절이 객체가 아니어도 자리는 남는다', r?.sections.length, 2)
  eq('항목 수가 안 줄어든다(번호 대응)', r?.sections[0]?.items, ['ok', '', ''])
  eq('모양 아닌 절은 빈 절', r?.sections[1], { title: '', items: [] })
  eq('음수 계수는 0', r?.fallbackCount, 0)
  eq('숫자 아닌 총수도 0', r?.totalCount, 0)
}

// ── 원문 폴백 표식의 근거 ────────────────────────────────────
//
// 카드는 '번역문 === 그 자리의 한국어 원문' 일 때 회색 `원문` 표식을 단다. 그 판정이 옳다는
// 근거가 이것이다 — 해석이 없는 줄에 원문을 **그대로** 두므로 두 문자열이 정확히 같고,
// 같은 줄의 개수가 fallbackCount 와 일치한다. 감추지 않으니 줄 수는 언제나 그대로다.
{
  const raw = {
    enabled: true,
    langs: { en: { published: true, dict: { 단기숙소계약서: 'Contract', '1인 1실을 원칙으로 합니다.': 'One per room.' } } },
  }
  const r = resolveContractTranslation(raw, T, 'en')
  const pairs: [string, string][] = [
    [r?.title ?? '', T.title],
    ...T.sections.flatMap((s, i): [string, string][] => [
      [r?.sections[i]?.title ?? '', s.title],
      ...s.items.map((it, j): [string, string] => [r?.sections[i]?.items[j] ?? '', it]),
    ]),
    [r?.oathText ?? '', T.oathText],
  ]
  eq('원문으로 남은 줄 수 = fallbackCount', pairs.filter(([a, b]) => a === b).length, r?.fallbackCount)
  eq('번역된 줄은 원문과 다르다', pairs.filter(([a, b]) => a !== b).length, 2)
  eq('표식을 달아도 줄은 하나도 안 사라진다', pairs.length, 7)
}

// ── 발급 피커의 번역 진행 ────────────────────────────────────
//
// 세는 집합이 해석과 **같아야** 한다. 갈리면 피커는 "26/26" 인데 종이에는 원문이 남는다.
{
  const raw = {
    enabled: true,
    langs: {
      en: { published: true, dict: { 단기숙소계약서: 'Contract', '1인 1실을 원칙으로 합니다.': 'One per room.', 옛줄: 'orphan' } },
      vi: { published: false, dict: { 단기숙소계약서: 'Hợp đồng' } },
    },
  }
  const p = translationProgress(raw, T, 'en')
  eq('총수는 해석과 같은 집합에서 나온다', p.total, translationSourceLines(T).length)
  eq('센 것과 안 센 것을 더하면 총수', p.done + (resolveContractTranslation(raw, T, 'en')?.fallbackCount ?? -1), p.total)
  eq('고아는 진행에 안 섞인다', p.done, 2)
  eq('공개 여부가 그대로 나온다', p.published, true)
  eq('비공개 언어도 진행은 센다(운영자에게 사실을 말한다)',
    [translationProgress(raw, T, 'vi').done, translationProgress(raw, T, 'vi').published], [1, false])
  eq('없는 언어는 hasEntry=false', translationProgress(raw, T, 'ja').hasEntry, false)
  eq('없는 언어의 진행은 0', translationProgress(raw, T, 'ja').done, 0)
  // 운영 스위치가 꺼져도 진행은 센다 — 캡션을 지울지는 화면이 enabled 로 정한다.
  eq('꺼져 있어도 사전은 그대로 세어진다',
    translationProgress({ ...raw, enabled: false }, T, 'en').done, 2)
}

// ── 우선 조항이 붙는 자리 ────────────────────────────────────
//
// 화면·인쇄가 같은 함수에 **같은 순서**로 넘긴다. 마지막에 붙어 앞 절 번호가 안 밀린다.
{
  const secs = [{ title: '1. 입실 계약', items: ['x'] }, { title: '2. 퇴실', items: ['y'] }]
  const r = resolveContractTranslation({ enabled: true, langs: { en: { published: true, dict: {} } } }, T, 'en')
  const out = appendSubLeaseAddendum(secs, null, null, null, contractTranslationAddendum(r))
  eq('번역본이 있으면 절이 하나 는다', out.length, 3)
  eq('번호는 앞 절 개수로 이어진다', out[2]?.title, '3. 번역본과 언어')
  eq('앞 절은 한 글자도 안 바뀐다', [out[0], out[1]], secs)
  eq('번역본이 없으면 배열 자체가 안 움직인다',
    appendSubLeaseAddendum(secs, null, null, null, contractTranslationAddendum(null)) === secs, true)
  // 형제 절이 함께 있어도 번역 절이 맨 뒤다 — 화면과 인쇄가 같은 순서라야 종이가 안 갈린다.
  const withSibling = appendSubLeaseAddendum(secs, { title: '추가 호실 특약', items: ['a'] }, null, null, contractTranslationAddendum(r))
  eq('형제 절이 먼저, 번역 절이 뒤', withSibling.map(s => s.title),
    ['1. 입실 계약', '2. 퇴실', '3. 추가 호실 특약', '4. 번역본과 언어'])
}

// ── 언어의 자기 이름 ────────────────────────────────────────
eq('자기 이름 사전은 번역 언어 전량', Object.keys(TRANSLATION_LANG_ENDONYM).length, TRANSLATION_LANGS.length)
eq('빠진 언어가 없다', TRANSLATION_LANGS.filter(l => !TRANSLATION_LANG_ENDONYM[l]?.trim()), [])
eq('한국어는 없다(정본이라 번역 대상이 아니다)',
  Object.keys(TRANSLATION_LANG_ENDONYM).includes('ko'), false)
// 운영자용 라벨을 쪼개 쓰지 않는다는 근거 — 자기 이름은 라벨의 부분 문자열일 뿐 규칙이 아니다.
eq('베트남어 자기 이름', TRANSLATION_LANG_ENDONYM.vi, 'Tiếng Việt')

// ── 3단계. 외부 번역기 왕복 ─────────────────────────────────
//
// 짝을 맞추는 근거가 줄 번호뿐이라 이 블록이 지키는 것은 하나다 — **어긋나면 아무것도 안 채운다.**
// 부분 반영이 가장 나쁜 결말이다. 번역이 통째로 한 칸 밀려 엉뚱한 조항에 들어가고, 그 종이가
// 나간 뒤에는 어디서부터 밀렸는지 아무도 모른다.

// 한 줄로 눕히는 규칙 자체.
eq('문장 안 줄바꿈은 한 칸으로 눕는다', translationCopyLine('앞줄입니다.\n  뒷줄입니다.'), '앞줄입니다. 뒷줄입니다.')
eq('빈 줄이 겹쳐도 한 칸', translationCopyLine('가\n\n나'), '가 나')
eq('CRLF 도 한 칸', translationCopyLine('가\r\n나'), '가 나')
eq('앞뒤 공백은 다듬는다', translationCopyLine('  가운데  '), '가운데')
eq('문장 안 여러 칸은 그대로 둔다(원문 대조의 기준이라 건드리면 안 된다)',
  translationCopyLine('가  나'), '가  나')

{
  const lines = translationSourceLines(T)
  const copyLines = translationCopyText(lines).split('\n')
  const paste = (raw: string) => applyTranslationPaste(lines, raw)
  /** 성공만 골라 읽는다 — 거부인데 값을 읽으면 크래시가 아니라 undefined 로 실패해야 보인다. */
  const okOf = (r: ReturnType<typeof applyTranslationPaste>) => (r.ok ? r : null)
  const notOk = (r: ReturnType<typeof applyTranslationPaste>) => (r.ok ? null : r)

  // 복사 문자열의 줄 수가 곧 기대 줄 수다. 둘이 갈리면 "7줄이어야 합니다"라 적어 놓고 8줄을
  // 복사해 주는 상태가 된다 — 같은 lines 한 벌에서 나온다는 것을 여기서 못박는다.
  eq('복사 줄 수 = 번역 대상 수', copyLines.length, lines.length)
  eq('기대 줄 수도 같은 정본에서 나온다', notOk(paste(''))?.expected, copyLines.length)
  eq('번호·머리말·빈 줄이 없다', copyLines.filter(s => !s.trim()).length, 0)
  eq('첫 줄은 계약서 제목', copyLines[0], T.title)
  eq('마지막 줄은 서약문(종이 순서 그대로)', copyLines[6], T.oathText)

  // 거부. 모자라도 남아도 아무것도 안 채운다.
  const short = paste(copyLines.slice(0, 6).map((_, i) => `T${i}`).join('\n'))
  eq('줄이 모자라면 거부', short.ok, false)
  eq('몇 줄이어야 하는데 몇 줄인지 말한다', [notOk(short)?.expected, notOk(short)?.got], [7, 6])
  eq('거부는 채울 값을 아예 안 만든다', 'filled' in short, false)
  const long = paste([...copyLines.map((_, i) => `T${i}`), '남는 줄'].join('\n'))
  eq('줄이 남아도 거부', long.ok, false)
  eq('남는 개수도 그대로', [notOk(long)?.expected, notOk(long)?.got], [7, 8])
  eq('빈 덩어리는 0줄로 거부(빈 사전으로 덮지 않는다)', notOk(paste('   '))?.got, 0)

  // 줄 수가 맞으면 채운다. 열쇠는 눕히기 전 원문이라 값이 제자리에 들어간다.
  const all = paste(copyLines.map((_, i) => `T${i}`).join('\n'))
  eq('줄 수가 맞으면 채운다', okOf(all)?.filledCount, 7)
  eq('열쇠는 눕히기 전 원문이다', okOf(all)?.filled[T.title], 'T0')
  eq('마지막 줄도 제자리', okOf(all)?.filled[T.oathText], 'T6')
  eq('앞뒤 공백은 다듬어 담는다',
    okOf(paste(copyLines.map((_, i) => `  T${i}\t`).join('\n')))?.filled[T.title], 'T0')
  eq('꼬리 개행은 잡음이라 거부 사유가 아니다',
    okOf(paste(copyLines.map((_, i) => `T${i}`).join('\n') + '\n'))?.filledCount, 7)
  eq('CRLF 로 와도 같은 판정', okOf(paste(copyLines.map((_, i) => `T${i}`).join('\r\n')))?.filledCount, 7)

  // 빈 줄은 건너뛴다 — 번역기가 못 옮긴 줄로 이미 있는 손번역을 지우면 안 된다.
  const blank = paste(copyLines.map((_, i) => (i === 1 ? '' : `T${i}`)).join('\n'))
  eq('빈 줄은 채우지 않는다(그 항목의 기존 값을 유지)', okOf(blank)?.filled[lines[1]?.text ?? ''], undefined)
  eq('빈 줄을 센다', okOf(blank)?.blankCount, 1)
  eq('나머지는 채운다', okOf(blank)?.filledCount, 6)
  eq('공백만 있는 줄도 빈 줄이다',
    okOf(paste(copyLines.map((_, i) => (i === 1 ? '   ' : `T${i}`)).join('\n')))?.blankCount, 1)

  // 원문과 글자가 같은 줄은 번역이 아니다. 채워 두면 '번역 없음' 폴백과 구분이 안 된다.
  const same = paste(copyLines.map((s, i) => (i === 0 ? s : `T${i}`)).join('\n'))
  eq('원문과 같은 줄은 안 채운다', okOf(same)?.filled[T.title], undefined)
  eq('그 줄을 원문으로 센다', okOf(same)?.sameCount, 1)
  eq('나머지 여섯은 채운다', okOf(same)?.filledCount, 6)
  eq('빈 줄과 원문 줄을 따로 센다',
    [okOf(paste(['', copyLines[1] ?? '', 'T2', 'T3', 'T4', 'T5', 'T6'].join('\n')))?.blankCount,
      okOf(paste(['', copyLines[1] ?? '', 'T2', 'T3', 'T4', 'T5', 'T6'].join('\n')))?.sameCount], [1, 1])
}

// 줄바꿈을 품은 원문(2026-09-08 실측 — 기본 템플릿 '3. 생활 수칙'의 항목 둘).
// 이 왕복의 전제가 '한 문자열 = 한 줄'이라, 그 전제가 실제 종이에서도 서는지 여기서 본다.
{
  const lines = translationSourceLines(DEFAULT_CONTRACT_TEMPLATE)
  eq('기본 템플릿에 줄바꿈을 품은 항목이 있다', lines.filter(l => /[\r\n]/.test(l.text)).length > 0, true)
  const copyLines = translationCopyText(lines).split('\n')
  eq('그래도 복사는 한 문자열이 한 줄', copyLines.length, lines.length)
  eq('복사한 줄에 줄바꿈이 하나도 없다', copyLines.filter(s => /[\r\n]/.test(s)).length, 0)
  eq('빈 줄도 안 생긴다', copyLines.filter(s => !s.trim()).length, 0)
  // 왕복 항등 — 내보낸 그대로 되붙이면 한 칸도 안 채운다(전부 '원문 그대로'로 걸린다).
  const back = applyTranslationPaste(lines, copyLines.join('\n'))
  eq('전문을 그대로 되붙이면 한 칸도 안 채운다', back.ok ? back.filledCount : -1, 0)
  eq('전부 원문 그대로로 센다', back.ok ? back.sameCount : -1, lines.length)
}

// ── 4단계 ① 카드의 자리표시자 치환 ──────────────────────────
//
// 배포된 결함이었다. 카드가 stripClauseBullet 만 부르고 renderContractText 를 안 불러
// `{{청소비조항}}` 이 글자 그대로 떴다(제기역점 저장 본문에 실재, 실측 2026-09-08).
//
// 여기서 못박는 것은 **카드가 종이와 같은 문자열을 만든다**는 것이다. 카드는 컴포넌트라
// 진리표가 그리지 못하므로, 종이(contractPrintHtml)가 쓰는 그 두 함수를 같은 순서로 태워
// 결과가 같음을 본다. 순서가 급소다 — 뒤집으면 값이 글머리로 시작하는 조항에서 갈린다.
{
  const vars = { ...cleaningFeeVars(20000), 일정: '3월 1일까지 301호' }
  // 종이의 조립(lib/contractPrintHtml 의 renderSection) · 카드의 조립(ContractTranslationView)
  const paper = (s: string) => stripClauseBullet(renderContractText(s, vars))
  const card = (s: string) => stripClauseBullet(renderContractText(s, vars))

  eq('자리표시자가 값으로 바뀐다',
    card('- {{청소비조항}}').startsWith('[청소비] 청소비 20,000원은'), true)
  eq('치환 결과에 자리표시자가 안 남는다', /\{\{/.test(card('- {{청소비조항}}')), false)
  eq('문장 끝에 붙은 자리표시자도 채워진다',
    card('퇴실 시 환불은 기준에 따릅니다.{{청소비공제}}'),
    '퇴실 시 환불은 기준에 따릅니다. (보증금 내 청소비 20,000원 별도 공제)')
  eq('카드와 종이가 같은 문자열을 만든다',
    ['- {{청소비조항}}', '{{청소비공제}}', '입실자는 다음 일정에 따라 거주합니다. {{일정}}']
      .every(s => card(s) === paper(s)), true)
  // 순서가 뒤집히면 갈린다는 근거 — 값이 글머리로 시작하면 벗기기가 값의 첫 글자를 먹는다.
  eq('치환이 먼저, 글머리 제거가 나중이다(뒤집으면 값이 잘린다)',
    stripClauseBullet(renderContractText('{{머리}}', { 머리: '- 값입니다.' }))
    !== renderContractText(stripClauseBullet('{{머리}}'), { 머리: '- 값입니다.' }), true)
  // vars 를 안 주면 지어내지 않는다 — 발급 상세처럼 값을 못 만드는 자리의 착지다.
  eq('vars 가 없으면 저장 문안 그대로', renderContractText('{{청소비조항}}', {}), '{{청소비조항}}')
}

// ── 4단계 ② 자리표시자뿐인 줄은 번역 대상이 아니다 ──────────
//
// 번역할 글자가 없다. 칸을 세우면 운영자가 거기에 번역을 적고, 그 번역은 자리표시자를 잃어
// 값이 안 들어간다 — 조용히 실패하는 종류다.
{
  const only: ContractTemplate = {
    title: '계약서',
    sections: [{
      id: 'a', title: '1. 절',
      items: ['- {{청소비조항}}', '{{청소비공제}}', '  {{환불규정}}  ', '청소비는 {{청소비}} 입니다.'],
    }],
    oathText: '서약',
  }
  const texts = translationSourceLines(only).map(l => l.text)
  eq('자리표시자뿐인 줄은 빠진다(글머리가 붙어 있어도)',
    texts.includes('- {{청소비조항}}') || texts.includes('{{청소비공제}}') || texts.includes('  {{환불규정}}  '), false)
  eq('글자가 섞인 줄은 남는다', texts.includes('청소비는 {{청소비}} 입니다.'), true)
  eq('남는 것은 제목·절 제목·그 한 줄·서약문 넷', texts.length, 4)
  // 실측 근거 — 기본 템플릿의 '{{청소비조항}}' 항목이 정확히 이 규칙에 걸린다.
  eq('기본 템플릿에서도 자리표시자뿐인 줄이 빠진다',
    translationSourceLines(DEFAULT_CONTRACT_TEMPLATE).some(l => /^\s*(?:[-–•·]\s?)?\{\{[^}]+\}\}\s*$/.test(l.text)), false)
}

// ── 4단계 ③ 가변 절이 번역 대상에 들어간다 ──────────────────
{
  const A1: SubLeaseAddendum = { title: '추가 호실 특약', items: ['보관 용도로만 씁니다.', '고가품은 안 됩니다.'] }
  const A2: SubLeaseAddendum = { title: '단기 입실 특약', items: ['주 단위로 정합니다. {{단기요금표}}'] }

  const base = translationSourceLines(T)
  const withA = translationSourceLines(T, [A1, A2])
  eq('특약을 안 넘기면 종전과 같다(무회귀)', base.length, 7)
  eq('특약 제목과 항목이 대상에 든다', withA.length, base.length + 5)
  // 본문 절 뒤, **서약문 앞**이다. 서약문은 절이 아니라 종이 맨 끝에 서는 한 문장이라,
  // 특약이 그 뒤로 가면 번역본의 줄 순서가 종이와 어긋난다.
  eq('본문 절 뒤 · 서약문 앞에 선다(종이 순서)', withA.slice(6, 11).map(l => l.text),
    ['추가 호실 특약', '보관 용도로만 씁니다.', '고가품은 안 됩니다.', '단기 입실 특약', '주 단위로 정합니다. {{단기요금표}}'])
  eq('절 제목은 sectionTitle, 항목은 item', [withA[6]?.kind, withA[7]?.kind], ['sectionTitle', 'item'])
  eq('절 순번이 본문 뒤로 이어진다', [withA[6]?.sectionIndex, withA[9]?.sectionIndex], [2, 3])
  eq('서약문은 여전히 맨 끝', withA[withA.length - 1]?.text, T.oathText)
  eq('문안은 치환 전 그대로다(자리표시자를 품은 것이 열쇠)',
    withA.some(l => l.text.includes('{{단기요금표}}')), true)

  // 중복 제거는 특약을 건너서도 산다 — 본문과 같은 문장을 쓰는 특약이 칸을 두 번 세우면
  // 같은 열쇠에 값을 두 번 쓰게 되어 나중 것이 앞 것을 조용히 덮는다.
  const dupA: SubLeaseAddendum = { title: '1. 입실 계약', items: ['1인 1실을 원칙으로 합니다.', '새 줄'] }
  eq('본문과 겹치는 특약 문장은 한 번만',
    translationSourceLines(T, [dupA]).length, base.length + 1)
  eq('빈 절은 아무것도 안 더한다', translationSourceLines(T, [{ title: '  ', items: [] }]).length, base.length)
}

// ── 4단계 ④ 해석은 그 계약에 실린 절만, 비면 칸이 없다 ──────
//
// 조항 번호를 자리로 매기므로(appendSubLeaseAddendum), 종이에 없는 절이 번역본에 서면
// 그 아래 번호가 통째로 밀려 "3조 2항"이 다른 줄을 가리킨다.
{
  const A1: SubLeaseAddendum = { title: '추가 호실 특약', items: ['보관 용도로만 씁니다.'] }
  const raw = {
    enabled: true,
    langs: { en: { published: true, dict: { '추가 호실 특약': 'Storage Room Rider', '보관 용도로만 씁니다.': 'Storage use only.' } } },
  }

  const none = resolveContractTranslation(raw, T, 'en')
  eq('특약을 안 넘기면 박제에 칸이 없다', none?.addenda, undefined)
  eq('그때 JSON 에 글자 하나도 안 남는다(이미 나간 링크 전건의 무회귀)',
    JSON.stringify(none).includes('addenda'), false)
  eq('안 실린 절은 총수에도 안 든다', none?.totalCount, 7)

  const one = resolveContractTranslation(raw, T, 'en', [A1])
  eq('실린 절만 선다', one?.addenda?.length, 1)
  eq('절 제목도 번역된다', one?.addenda?.[0]?.title, 'Storage Room Rider')
  eq('절 항목도 번역된다', one?.addenda?.[0]?.items, ['Storage use only.'])
  eq('총수가 그만큼 는다', one?.totalCount, 9)
  eq('번역이 있으니 원문으로 남은 수는 그대로', one?.fallbackCount, none?.fallbackCount)

  // 번역이 없는 절은 원문 그대로 — 감추지 않는다(구조 규칙 2 가 특약에도 그대로 산다).
  const A2: SubLeaseAddendum = { title: '단기 입실 특약', items: ['주 단위로 정합니다.'] }
  const two = resolveContractTranslation(raw, T, 'en', [A1, A2])
  eq('번역 없는 절은 한국어 원문 그대로', two?.addenda?.[1], { title: '단기 입실 특약', items: ['주 단위로 정합니다.'] })
  eq('절 개수가 안 줄어든다(번호 대응)', two?.addenda?.length, 2)
  eq('그 두 줄이 fallbackCount 에 잡힌다', (two?.fallbackCount ?? 0) - (one?.fallbackCount ?? 0), 2)

  // 번호는 종이와 같은 정본이 매긴다 — 카드가 그 함수를 그대로 쓴다.
  const numbered = appendSubLeaseAddendum(two?.sections ?? [], ...(two?.addenda ?? []))
  eq('본문 절 뒤로 번호가 이어진다', numbered.slice(2).map(s => s.title),
    ['3. Storage Room Rider', '4. 단기 입실 특약'])
  // 이 사전에는 본문 번역이 없어 두 절이 원문 그대로다 — 그래도 번호가 안 밀리는 것이 요점이다.
  eq('앞 절은 한 글자도 안 바뀐다', numbered.slice(0, 2).map(s => s.title), ['1. 입실 계약', '2. 퇴실 및 환불'])
}

// 박제 읽기도 같은 규칙 — 없으면 칸을 안 만든다.
eq('칸이 없던 박제는 읽어도 칸이 안 생긴다',
  asResolvedContractTranslation({ lang: 'en', title: 'x', sections: [] })?.addenda, undefined)
eq('빈 배열로 얼어 있어도 칸을 안 만든다(재직렬화 바이트 보존)',
  JSON.stringify(asResolvedContractTranslation({ lang: 'en', addenda: [] })).includes('addenda'), false)
{
  const r = asResolvedContractTranslation({
    lang: 'en', addenda: [{ title: 'T', items: ['a', 7] }, 'not-an-object'],
  })
  eq('박제한 특약이 그대로 나온다', r?.addenda?.[0], { title: 'T', items: ['a', ''] })
  eq('모양 아닌 절도 자리는 남는다(번호 대응)', r?.addenda?.length, 2)
}

// ── 4단계 ⑤ 그 계약에 실릴 절을 고르는 정본 ─────────────────
//
// 실릴지 아닐지는 종이와 **같은 함수**가 정하고, 열쇠로 쓰는 문안은 치환 전 저장본이다.
{
  const sub: SubLeaseAddendum = { title: '추가 호실 특약', items: ['보관 용도'] }
  const rate: SubLeaseAddendum = { title: '단기 입실 특약', items: ['주 단위'] }
  const sched: SubLeaseAddendum = { title: '거주 호실 일정', items: ['다음 일정입니다. {{일정}}'] }

  eq('아무것도 없으면 빈 목록', contractAddendaForTranslation({}), [])
  eq('종이 순서 그대로(추가 호실 · 요금 · 일정)',
    contractAddendaForTranslation({ subLeaseAddendum: sub, rateAddendum: rate, roomScheduleText: '3월까지 301호', roomScheduleAddendum: sched })
      .map(a => a.title), ['추가 호실 특약', '단기 입실 특약', '거주 호실 일정'])
  eq('일정이 없는 계약은 그 절이 안 선다(종이와 같은 판정)',
    contractAddendaForTranslation({ roomScheduleAddendum: sched }), [])
  eq('영업장이 그 절을 안 쓰면 일정이 있어도 안 선다',
    contractAddendaForTranslation({ roomScheduleText: '3월까지 301호', roomScheduleAddendum: null }), [])
  // 급소 — 열쇠가 치환 후면 계약마다 달라져 사전이 한 번도 안 맞는다.
  eq('일정 절의 문안은 **치환 전**이다',
    contractAddendaForTranslation({ roomScheduleText: '3월까지 301호', roomScheduleAddendum: sched })[0]?.items,
    ['다음 일정입니다. {{일정}}'])
  eq('종이가 싣는 절은 치환 후다(둘이 다른 것이 요점)',
    buildRoomScheduleAddendum('3월까지 301호', sched)?.items, ['다음 일정입니다. 3월까지 301호'])
}

// ── 4단계 ⑥ 분모 둘이 다르다 ────────────────────────────────
//
// 편집기는 영업장이 쓸 수 있는 전부, 피커·박제는 그 계약에 실릴 것. **세는 함수는 하나이고
// 입력만 다르다** — 두 함수로 세면 편집기가 "34칸 다 채웠다"는데 피커는 "26/34"를 말한다.
{
  const all: SubLeaseAddendum[] = [
    { title: '추가 호실 특약', items: ['보관 용도'] },
    { title: '단기 입실 특약', items: ['주 단위'] },
    { title: '조기 퇴실 시 요금 적용', items: ['단기 요금표를 적용합니다.'] },
    { title: '거주 호실 일정', items: ['다음 일정입니다. {{일정}}'] },
  ]
  // 그 계약에는 넷 중 둘만 붙는다(단기 계약이라 조기 퇴실은 안 붙고, 일정도 없다).
  const mine = contractAddendaForTranslation({ subLeaseAddendum: all[0], rateAddendum: all[1] })

  const raw = { enabled: true, langs: { en: { published: true, dict: {} } } }
  const editor = translationProgress(raw, T, 'en', all)
  const picker = translationProgress(raw, T, 'en', mine)
  eq('편집기 분모가 더 크다', editor.total > picker.total, true)
  eq('편집기 분모는 전부', editor.total, translationSourceLines(T, all).length)
  eq('피커 분모는 그 계약분', picker.total, translationSourceLines(T, mine).length)
  eq('둘 다 같은 함수에서 나온다(세는 곳이 하나)',
    [editor.total, picker.total], [T ? 15 : 0, 11])
  eq('박제의 총수는 피커와 같다',
    resolveContractTranslation(raw, T, 'en', mine)?.totalCount, picker.total)
  // 고아 판정도 같은 집합을 본다 — 안 맞추면 특약 번역이 통째로 고아로 뜬다.
  const orphanRaw = { enabled: true, langs: { en: { published: true, dict: { '보관 용도': 'Storage only' } } } }
  eq('대상에 든 특약 번역은 고아가 아니다', orphanTranslationKeys(orphanRaw, T, 'en', mine), [])
  eq('특약을 안 넘기면 그 번역이 고아로 잡힌다', orphanTranslationKeys(orphanRaw, T, 'en'), ['보관 용도'])
}

// ── 4단계 ⑦ 자리표시자 보호 — 조용히 실패하면 안 된다 ───────
//
// 번역기가 `{{청소비조항}}` 을 번역하거나 지우면 그 조항은 종이에서 값을 잃는다. 아무 소리도
// 안 나는 실패라, 뽑는 함수를 하나 두고 붙여넣기·편집기·저장이 그것 하나를 본다.
eq('자리표시자를 뽑는다', translationPlaceholders('청소비 {{청소비}} 와 {{환불규정}}'), ['{{청소비}}', '{{환불규정}}'])
eq('같은 것이 두 번 나와도 하나로', translationPlaceholders('{{a}} 와 {{a}}'), ['{{a}}'])
eq('안쪽 공백은 다듬어 견준다', translationPlaceholders('{{ 청소비 }}'), ['{{청소비}}'])
eq('없으면 빈 배열', translationPlaceholders('평범한 문장입니다.'), [])
eq('문자열이 아니면 빈 배열', translationPlaceholders(undefined as unknown as string), [])
eq('그대로 옮겼으면 빠진 것이 없다',
  missingTranslationPlaceholders('청소비 {{청소비}} 입니다.', 'Cleaning fee {{청소비}}.'), [])
eq('번역돼 사라지면 잡는다',
  missingTranslationPlaceholders('청소비 {{청소비}} 입니다.', 'Cleaning fee applies.'), ['{{청소비}}'])
eq('이름이 번역되면 다른 자리표시자라 잡는다',
  missingTranslationPlaceholders('{{청소비조항}}', '{{Cleaning Fee Clause}}'), ['{{청소비조항}}'])
eq('원문에 없던 것을 더한 것은 막지 않는다(값이 안 빠지는 방향)',
  missingTranslationPlaceholders('평범한 문장', '{{청소비}}'), [])
eq('순서가 바뀌어도 통과한다(문장 구조는 언어마다 다르다)',
  missingTranslationPlaceholders('{{a}} 그리고 {{b}}', '{{b}} and {{a}}'), [])

// 저장이 최종 벽 — 병합 정본이 거부한다.
{
  const stored = { enabled: true, langs: { en: { published: true, dict: { A: 'a' } } } }
  const bad = mergeTranslationLang(stored, 'en', { published: true, dict: { '청소비 {{청소비}} 입니다.': 'Cleaning fee applies.' } })
  eq('자리표시자가 빠진 번역은 저장 거부', bad.ok, false)
  eq('거부는 저장할 값을 아예 안 만든다', 'next' in bad, false)
  eq('무엇이 빠졌는지 말한다', bad.ok ? null : bad.missing,
    [{ text: '청소비 {{청소비}} 입니다.', placeholders: ['{{청소비}}'] }])
  eq('거부해도 저장본은 한 글자도 안 바뀐다(읽고-병합-쓰기에서 쓰기를 안 한다)',
    parseContractTranslations(stored).langs.en?.dict, { A: 'a' })
  eq('사유 문장에 빠진 이름이 들어간다',
    translationPlaceholderMessage(bad.ok ? [] : bad.missing).includes('{{청소비}}'), true)

  eq('그대로 옮긴 번역은 통과',
    mergeTranslationLang(stored, 'en', { dict: { '청소비 {{청소비}} 입니다.': '{{청소비}} cleaning fee.' } }).ok, true)
  eq('번역 취소(빈 값)는 거부 사유가 아니다',
    mergeTranslationLang(stored, 'en', { dict: { '청소비 {{청소비}} 입니다.': '  ' } }).ok, true)
  eq('자리표시자 없는 문장은 늘 통과',
    mergeTranslationLang(stored, 'en', { dict: { 평범: 'plain' } }).ok, true)
  eq('공개만 바꾸는 저장은 사전을 안 보내므로 통과',
    mergeTranslationLang(stored, 'en', { published: false }).ok, true)
}

// 붙여넣기도 같은 함수로 잡는다 — 두 곳이 각자 세면 붙여넣기는 통과하고 저장만 거부한다.
{
  const P: ContractTemplate = {
    title: '계약서',
    sections: [{ id: 'a', title: '1. 절', items: ['청소비 {{청소비}} 입니다.', '평범한 줄'] }],
    oathText: '서약',
  }
  const lines = translationSourceLines(P)
  const copyLines = translationCopyText(lines).split('\n')
  eq('그 본문의 번역 대상은 5줄', lines.length, 5)

  const lost = applyTranslationPaste(lines, ['제목', '1. Section', 'Cleaning fee applies.', 'plain', 'oath'].join('\n'))
  eq('자리표시자를 잃은 줄이 있으면 거부', lost.ok, false)
  eq('거부는 채울 값을 아예 안 만든다', 'filled' in lost, false)
  eq('줄 수는 맞았다고 말한다(사유가 다르다)',
    lost.ok ? null : [lost.expected, lost.got], [5, 5])
  eq('어느 열쇠가 무엇을 잃었는지 말한다', lost.ok ? null : lost.missing,
    [{ text: '청소비 {{청소비}} 입니다.', placeholders: ['{{청소비}}'] }])

  const kept = applyTranslationPaste(lines, ['제목', '1. Section', '{{청소비}} cleaning fee.', 'plain', 'oath'].join('\n'))
  eq('그대로 옮겼으면 채운다', kept.ok && kept.filledCount, 5)
  // 줄 수 거부는 자리표시자를 보기 전에 착지한다 — 사유가 섞이면 화면이 엉뚱한 말을 한다.
  eq('줄 수가 어긋나면 자리표시자 사유는 비어 있다',
    (r => (r.ok ? null : r.missing))(applyTranslationPaste(lines, 'a\nb')), [])
  // 전문을 그대로 되붙이는 왕복은 여전히 통과해야 한다(원문 그대로라 채울 것이 없다).
  const back = applyTranslationPaste(lines, copyLines.join('\n'))
  eq('되붙이기 항등은 그대로 산다', back.ok && back.sameCount, lines.length)
}

// ── 5단계 ① 환불 규정은 '변수 줄'이다 ───────────────────────────
//
// 환불 규정은 절도 항목도 아니고 **변수값**이다. 본문에는 {{환불규정}} 자리만 있고 문장은
// 코드가 만든다. 그래서 종이가 그 값을 넣는 조건과 **같은 조건**일 때만 번역 대상 줄이 선다.
{
  const R: ContractTemplate = {
    title: '계약서',
    sections: [{ id: 'out', title: '2. 퇴실 및 환불', items: ['환불은 기준에 따릅니다.{{환불규정}}', '평범한 줄'] }],
    oathText: '서약',
  }
  const N: ContractTemplate = { ...R, sections: [{ id: 'out', title: '2. 퇴실 및 환불', items: ['환불은 기준에 따릅니다.', '평범한 줄'] }] }
  const key = refundTranslationKey()

  eq('열쇠는 종이가 넣는 그 문장이다(사본 금지)', key, buildRefundClause())
  eq('자리표시자 이름은 종이의 vars 열쇠와 같다', REFUND_VAR_PLACEHOLDER, `{{${REFUND_VAR_NAME}}}`)

  eq('토글 켜짐 + 본문에 자리 = 변수 줄이 선다',
    translationSourceLines(R, undefined, true).map(l => l.kind),
    ['title', 'sectionTitle', 'item', 'item', 'oath', 'var'])
  eq('변수 줄은 맨 끝이다(절 사이에 끼우면 줄 대조가 밀린다)',
    translationSourceLines(R, undefined, true).at(-1)?.text, key)
  eq('토글 꺼짐이면 안 선다(종이에도 그 문장이 안 들어간다)',
    translationSourceLines(R, undefined, false).some(l => l.kind === 'var'), false)
  eq('토글을 안 넘겨도 안 선다(기본은 안 세움)',
    translationSourceLines(R).some(l => l.kind === 'var'), false)
  eq('본문에 자리가 없으면 토글을 켜도 안 선다',
    translationSourceLines(N, undefined, true).some(l => l.kind === 'var'), false)
  // 급소 — 줄 전체가 자리표시자인 항목은 번역 대상에서 빠지지만 종이에는 값이 들어간다.
  // 대상 목록만 훑으면 그런 본문에서 칸이 안 서고 그 문단만 영영 한국어로 남는다.
  {
    const only: ContractTemplate = { ...R, sections: [{ id: 'out', title: '2. 퇴실', items: ['{{환불규정}}'] }] }
    eq('줄 전체가 자리표시자여도 변수 줄은 선다(걷어낸 줄까지 본다)',
      translationSourceLines(only, undefined, true).some(l => l.kind === 'var'), true)
    eq('그 줄 자체는 여전히 번역 대상이 아니다',
      translationSourceLines(only, undefined, true).some(l => l.text === '{{환불규정}}'), false)
  }
  // 가변 절에만 자리가 있어도 선다 — 종이가 그 절에도 같은 vars 로 치환한다.
  eq('가변 절의 자리도 본다',
    translationSourceLines(N, [{ title: '요금', items: ['{{환불규정}} 를 따릅니다.'] }], true)
      .some(l => l.kind === 'var'), true)

  // ── 5단계 ② 빈 칸 = 권장 번역 (이 줄만 규칙이 갈린다) ──────────
  const rawEmpty = { enabled: true, langs: { en: { published: true, dict: {} } } }
  const rEmpty = resolveContractTranslation(rawEmpty, R, 'en', undefined, true)
  eq('빈 칸이면 권장 번역이 나간다',
    rEmpty?.vars?.환불규정, ' ' + RECOMMENDED_REFUND_TRANSLATION.en)
  eq('값이 종이와 같은 모양이다(앞 한 칸이 문장을 잇는다)',
    rEmpty?.vars?.환불규정.startsWith(' '), true)
  eq('권장을 쓴 것은 직접 번역이 아니다(표식 없음)', rEmpty?.customVars, undefined)
  eq('변수 줄은 폴백으로 안 센다(한국어가 안 남는다)', rEmpty?.fallbackCount, 5)
  eq('그래도 분모에는 선다', rEmpty?.totalCount, 6)

  const rawCustom = { enabled: true, langs: { en: { published: true, dict: { [key]: 'MY OWN REFUND RULE' } } } }
  const rCustom = resolveContractTranslation(rawCustom, R, 'en', undefined, true)
  eq('값이 있으면 그 값이 나간다', rCustom?.vars?.환불규정, ' MY OWN REFUND RULE')
  eq('직접 번역이면 표식이 남는다', rCustom?.customVars, ['환불규정'])
  eq('직접 번역도 폴백은 아니다', rCustom?.fallbackCount, 5)

  const rawSame = { enabled: true, langs: { en: { published: true, dict: { [key]: RECOMMENDED_REFUND_TRANSLATION.en } } } }
  eq('권장과 같은 값은 직접 번역이 아니다(사실이 아닌 경고를 막는다)',
    resolveContractTranslation(rawSame, R, 'en', undefined, true)?.customVars, undefined)

  eq('토글이 꺼지면 vars 칸 자체가 없다',
    resolveContractTranslation(rawCustom, R, 'en', undefined, false)?.vars, undefined)
  eq('그때는 표식도 없다',
    resolveContractTranslation(rawCustom, R, 'en', undefined, false)?.customVars, undefined)
  // 급소 — 늘 담으면 이 칸을 모르는 옛 박제 전건이 내용 변화 없이 드리프트로 뜬다.
  eq('변수 줄이 없는 번역본에는 vars·customVars 키가 아예 없다',
    Object.keys(resolveContractTranslation(rawEmpty, N, 'en', undefined, true) ?? {}).filter(k => k === 'vars' || k === 'customVars'),
    [])

  // ── 5단계 ③ 직접 번역 판정은 '권장과 다른 값' 하나뿐 ──────────
  // 명세는 그 줄이 들고 다닌다 — 화면·저장·박제가 같은 객체를 본다.
  const refundSpec = translationVarSpecs(R, undefined, true).find(x => x.name === '환불규정') as TranslationVarSpec
  eq('환불 명세를 줄에서 꺼낼 수 있다', refundSpec?.key, key)
  eq('열쇠로도 같은 명세를 찾는다(템플릿 없는 저장 병합이 쓰는 길)',
    translationVarSpecByKey(key)?.name, '환불규정')
  eq('빈 값은 직접 번역이 아니다', isCustomVarTranslation('en', refundSpec, ''), false)
  eq('공백뿐인 값도 아니다', isCustomVarTranslation('en', refundSpec, '   '), false)
  eq('없는 값도 아니다', isCustomVarTranslation('en', refundSpec, undefined), false)
  eq('권장과 같으면 아니다', isCustomVarTranslation('en', refundSpec, RECOMMENDED_REFUND_TRANSLATION.en), false)
  eq('앞뒤 공백만 다른 것도 아니다', isCustomVarTranslation('en', refundSpec, `  ${RECOMMENDED_REFUND_TRANSLATION.en}  `), false)
  eq('다른 문안이면 직접 번역이다', isCustomVarTranslation('en', refundSpec, 'something else'), true)
  eq('언어가 다르면 권장도 다르다(en 권장을 vi 에 넣으면 직접 번역)',
    isCustomVarTranslation('vi', refundSpec, RECOMMENDED_REFUND_TRANSLATION.en), true)

  // ── 5단계 ④ 저장이 권장과 같은 값을 비운다 ────────────────────
  {
    const stored = { enabled: true, langs: { en: { published: true, dict: {} } } }
    const same = mergeTranslationLang(stored, 'en', { dict: { [key]: RECOMMENDED_REFUND_TRANSLATION.en } })
    eq('권장과 같은 값은 저장에서 걷힌다(빈 칸이 곧 권장이다)',
      same.ok ? same.next.langs.en?.dict[key] : 'REJECTED', undefined)
    const mine = mergeTranslationLang(stored, 'en', { dict: { [key]: 'MY OWN' } })
    eq('다른 문안은 그대로 저장된다', mine.ok ? mine.next.langs.en?.dict[key] : 'REJECTED', 'MY OWN')
    // 정밀 판정 — 다른 열쇠가 우연히 같은 글자를 담아도 걷지 않는다.
    const other = mergeTranslationLang(stored, 'en', { dict: { 다른열쇠: RECOMMENDED_REFUND_TRANSLATION.en } })
    eq('환불 열쇠가 아니면 안 걷는다', other.ok ? other.next.langs.en?.dict['다른열쇠'] : 'REJECTED',
      RECOMMENDED_REFUND_TRANSLATION.en)
    // 이미 저장돼 있던 직접 번역을 권장으로 되돌리는 길(칸 비우기)도 그대로 산다.
    const had = { enabled: true, langs: { en: { published: true, dict: { [key]: 'OLD' } } } }
    eq('칸을 비우면 그 열쇠가 걷힌다', (m => (m.ok ? m.next.langs.en?.dict[key] : 'REJECTED'))(
      mergeTranslationLang(had, 'en', { dict: { [key]: '' } })), undefined)
    eq('권장을 그대로 적어도 걷힌다(같은 결과)', (m => (m.ok ? m.next.langs.en?.dict[key] : 'REJECTED'))(
      mergeTranslationLang(had, 'en', { dict: { [key]: RECOMMENDED_REFUND_TRANSLATION.en } })), undefined)
  }

  // ── 5단계 ⑤ 진행 계수·고아 판정이 같은 집합을 본다 ────────────
  {
    const p = translationProgress(rawEmpty, R, 'en', undefined, true)
    eq('변수 줄은 비어도 번역으로 센다(다 채운 언어가 미완으로 안 보인다)', [p.total, p.done], [6, 1])
    eq('빈 칸이면 직접 번역이 아니다', p.customVars, [])
    const pc = translationProgress(rawCustom, R, 'en', undefined, true)
    eq('직접 번역이면 피커가 그 사실을 안다', pc.customVars, ['환불규정'])
    eq('토글이 꺼지면 분모에서도 빠진다',
      translationProgress(rawEmpty, R, 'en', undefined, false).total, 5)
    eq('그때는 직접 번역 표식도 안 뜬다(종이에 안 실리는 문장이다)',
      translationProgress(rawCustom, R, 'en', undefined, false).customVars, [])
    // 고아 판정이 분모와 다른 집합을 보면 환불 번역 전건이 고아로 잡힌다.
    eq('변수 줄이 선 상태에서 그 번역은 고아가 아니다',
      orphanTranslationKeys(rawCustom, R, 'en', undefined, true), [])
    eq('토글이 꺼지면 그 번역은 갈 곳이 없다(고아로 잡힌다)',
      orphanTranslationKeys(rawCustom, R, 'en', undefined, false), [key])
  }

  // ── 5단계 ⑥ 외부 번역기 왕복도 변수 줄을 함께 나른다 ──────────
  {
    const lines = translationSourceLines(R, undefined, true)
    const copy = translationCopyText(lines).split('\n')
    eq('복사 전문에 변수 줄이 함께 나간다', copy.length, 6)
    eq('마지막 줄이 환불 규정 원문이다', copy[5], translationCopyLine(key))
    const back = applyTranslationPaste(lines, copy.join('\n'))
    eq('되붙이기 항등은 변수 줄이 늘어도 그대로다', back.ok && back.sameCount, 6)
    // 3번째 줄은 원문에 {{환불규정}} 을 품고 있어 번역문도 그것을 지켜야 통과한다(자리표시자 보호).
    const filled = applyTranslationPaste(lines, ['T', 'S', 'I1{{환불규정}}', 'I2', 'O', 'REFUND EN'].join('\n'))
    eq('번역기가 채운 변수 줄은 그 열쇠로 들어간다', filled.ok && filled.filled[key], 'REFUND EN')
    // 변수 줄 자체에는 자리표시자가 없다 — 그 줄은 보호 규칙에 안 걸린다.
    eq('변수 줄은 자리표시자 보호 대상이 아니다', translationPlaceholders(key), [])
  }

  // ── 5단계 ⑦ 박제 파서 — 얼어 있는 값만 읽는다 ─────────────────
  {
    const frozen = JSON.parse(JSON.stringify(rCustom)) as unknown
    eq('박제한 vars 가 그대로 나온다', asResolvedContractTranslation(frozen)?.vars, { 환불규정: ' MY OWN REFUND RULE' })
    eq('박제한 표식도 그대로', asResolvedContractTranslation(frozen)?.customVars, ['환불규정'])
    // 급소 — 빈 칸을 만들면 그 박제를 다시 직렬화할 때 바이트가 달라진다(옛 발급본 전건이 드리프트).
    const old = { lang: 'en', title: 'T', sections: [], oathText: '', fallbackCount: 0, totalCount: 0 }
    eq('vars 칸이 없던 옛 박제는 여기서도 칸이 안 생긴다',
      Object.keys(asResolvedContractTranslation(old) ?? {}).filter(k => k === 'vars' || k === 'customVars'), [])
    eq('옛 박제를 다시 직렬화하면 바이트가 같다',
      JSON.stringify(asResolvedContractTranslation(old)), JSON.stringify(old))
    eq('모양 아닌 vars 는 버린다', asResolvedContractTranslation({ ...old, vars: [1, 2] })?.vars, undefined)
    eq('문자열 아닌 값도 버린다', asResolvedContractTranslation({ ...old, vars: { 환불규정: 3 } })?.vars, undefined)
    eq('모르는 표식은 걸러낸다',
      asResolvedContractTranslation({ ...old, customVars: ['환불규정', '아무거나', 7] })?.customVars, ['환불규정'])
    eq('표식만 남고 남는 것이 없으면 칸을 안 만든다',
      asResolvedContractTranslation({ ...old, customVars: ['아무거나'] })?.customVars, undefined)
  }

  // ── 5단계 ⑧ 권장 문안 사전 — 8언어 전량, ko 없음 ──────────────
  eq('번역 언어 전부에 권장 문안이 있다',
    TRANSLATION_LANGS.filter(l => !RECOMMENDED_REFUND_TRANSLATION[l]?.trim()), [])
  eq('ko 는 원문이라 권장 문안이 없다',
    Object.keys(RECOMMENDED_REFUND_TRANSLATION).includes('ko'), false)
  eq('권장 문안 수가 번역 언어 수와 같다',
    Object.keys(RECOMMENDED_REFUND_TRANSLATION).length, TRANSLATION_LANGS.length)
  eq('권장 문안에는 자리표시자가 없다(저장·붙여넣기 거부 대상이 될 수 없다)',
    TRANSLATION_LANGS.filter(l => translationPlaceholders(RECOMMENDED_REFUND_TRANSLATION[l]).length > 0), [])
}

// ── 5단계 ⑨ 인쇄 조판 vars 정본 — 종이와 발급 박제가 같은 재료 ──
//
// 이 함수가 인쇄 조판 밖으로 나온 이유는 발급 박제가 같은 재료를 들어야 발급 상세의 '전문 보기'가
// 종이와 같은 값으로 조항을 그리기 때문이다. **여기에 새 열쇠를 더하면 종이가 달라진다.**
{
  const base: PrintContractData = {
    template: DEFAULT_CONTRACT_TEMPLATE,
    businessInfo: { name: '스테이음', registrationNo: null, ceoName: '홍길동', address: null } as PrintContractData['businessInfo'],
    phone: null, contractNo: '20260908-001', logoImageUrl: null, stampImageUrl: null,
    refundClauseInContract: true,
    disposalConsent: { enabled: false, days: 30, title: '동의서', body: '' },
    tenant: { name: '김입주', birthdate: '1990-01-01', foreignRegNo: null, gender: '남', job: null, primaryPhone: '010-0000-0000' },
    lease: { moveInDate: '2026-09-01', expectedMoveOut: null, rentAmount: 400000, depositAmount: 100000,
      cleaningFee: 50000, dueDay: '1', roomNo: '301', registrationStatus: '미신고' },
    smoking: '비흡연', emergencyContactText: '', signDate: '2026년 9월 8일',
    signatureImageDataUrl: '', pretendardBase64: '',
  }
  const on = contractPrintVars(base)
  const off = contractPrintVars({ ...base, refundClauseInContract: false })
  eq('토글이 켜지면 종이에 환불 문장이 들어간다', on.환불규정, ' ' + buildRefundClause())
  eq('꺼지면 빈 문자열이다(문장이 안 붙는다)', off.환불규정, '')
  eq('번역본의 값과 같은 모양이다(앞 한 칸)', on.환불규정.startsWith(' '), true)
  // 열쇠 집합이 곧 종이의 치환 규칙이다. 늘리면 본문에 그 이름을 적어 둔 영업장의 종이가 바뀐다.
  eq('종이의 치환 열쇠 목록', Object.keys(on).sort().join(','),
    ['name', 'phone', 'birth', 'job', 'gender', 'smoking', 'deposit', 'checkInDate', 'checkOutDate',
      'roomNo', 'rentFee', 'emergencyContact', '환불규정', '단기요금표',
      ...Object.keys(cleaningFeeVars(50000))].sort().join(','))
  eq('꺼진 계약서도 열쇠 집합은 같다(값만 다르다)', Object.keys(off).sort().join(','), Object.keys(on).sort().join(','))

  // 번역본 쪽에만 {{일정}} 이 더해진다. 종이 vars 에 넣으면 본문에 그 이름을 적어 둔
  // 영업장의 종이가 이 기능 전과 달라진다.
  eq('종이 vars 에는 일정이 없다', on['일정'], undefined)
  eq('표시 재료에는 일정이 더해진다', translationDisplayVars(on, '3월까지 301호')['일정'], '3월까지 301호')
  eq('일정이 없으면 빈 문자열이다(자리표시자를 그대로 두지 않는다)',
    translationDisplayVars(on, null)['일정'], '')
  eq('나머지 열쇠는 그대로 통과한다', translationDisplayVars(on, null).환불규정, on.환불규정)
  eq('원본 객체를 안 건드린다(같은 객체를 두 곳이 쓴다)', Object.keys(on).includes('일정'), false)
}

// ── 5단계 ⑩ 인쇄 사실 축은 무접촉 ───────────────────────────────
//
// 치환 재료는 **facts 밖**에 산다. 이 축은 드리프트가 통째로 견주는 JSON 이라, 모양이 바뀌면
// 조항을 한 글자도 안 고친 발급본 전건이 허위 드리프트로 뜬다.
{
  const t = { lang: 'en', title: 'T', sections: [], oathText: '', vars: { 환불규정: ' X' }, customVars: ['환불규정'], fallbackCount: 0, totalCount: 1 }
  const facts = printedFacts({ template: DEFAULT_CONTRACT_TEMPLATE, translation: t } as Parameters<typeof printedFacts>[0])
  eq('사실 축에 치환 재료 칸이 없다', Object.keys(facts).includes('translationVars'), false)
  eq('번역 축은 해석 완료본 그대로다(모양을 안 바꾼다)', facts.translation, JSON.stringify(t))
  eq('번역본이 없으면 축 자체가 없다(옛 박제 무회귀)',
    printedFacts({ template: DEFAULT_CONTRACT_TEMPLATE } as Parameters<typeof printedFacts>[0]).translation, undefined)
}

// ── 6단계 ⑪ 화면 언어 기본값 — 건네기 전에 이미 맞아 있어야 한다 ──
//
// 운영자가 제 기기를 그대로 건네 대면으로 서명받는 운용이 있다. 그때 이 화면이 곧 입주자가 읽는
// 화면이라, 열리는 순간 언어가 맞아 있어야 한다. 외국인 판정은 **서명 요청과 같은 축**이다.
{
  const KR = { nationality: '대한민국' }
  const VN = { nationality: '베트남' }
  eq('내국인은 지목해도 한국어다(내국인 계약서는 이 기능 전과 같아야 한다)',
    contractTranslationLangFor(KR, 'en'), 'ko')
  eq('내국인은 기본값도 한국어', contractTranslationLangFor(KR, null), 'ko')
  eq('빈 국적은 내국인으로 본다(서류 판정 축 그대로)',
    contractTranslationLangFor({ nationality: '' }, 'en'), 'ko')
  // 등록번호가 있으면 외국인이라 셀렉트는 서지만, 국적이 비면 **기본값은 한국어**다.
  // signLangForNationality 가 빈 국적을 ko 로 답하기 때문이고, 서명 요청 피커의 기본값도 같다 —
  // 추정으로 남의 언어를 세우지 않고 운영자가 고르게 한다.
  eq('등록번호만 있고 국적이 비면 기본값은 한국어다(서명 요청 피커와 같은 답)',
    contractTranslationLangFor({ nationality: '', foreignRegNoEnc: 'x' }, null), 'ko')
  eq('그래도 고르면 그 언어가 선다(외국인 판정은 지났다)',
    contractTranslationLangFor({ nationality: '', foreignRegNoEnc: 'x' }, 'en'), 'en')
  eq('외국인 기본값은 국적에서 온다', contractTranslationLangFor(VN, null), 'vi')
  eq('외국인이 지목하면 그것이 이긴다', contractTranslationLangFor(VN, 'ja'), 'ja')
  eq('모르는 코드는 국적 기본값으로 떨어진다', contractTranslationLangFor(VN, 'xx'), 'vi')
  eq('한국어를 지목하면 한국어다(번역본 없음과 같은 상태)', contractTranslationLangFor(VN, 'ko'), 'ko')
  // 한국어는 asTranslationLang 을 못 지난다 — 카드도 우선 조항도 안 선다는 것이 그 뜻이다.
  eq('지목한 한국어는 번역 언어가 아니다', asTranslationLang(contractTranslationLangFor(VN, 'ko')), undefined)
}

// ── 6단계 ⑫ 해석 정본 헬퍼 — 인자 조립이 한 자리다 ─────────────────
//
// 해석 호출부가 링크 발급·화면·발급 API 셋이 됐다. 각자 인자를 조립하면 언젠가 한 곳만 가변 절이나
// 환불 토글을 빠뜨리고, 그때는 종이에 없는 절이 번역본에 서서 조항 번호가 통째로 밀린다.
{
  const A: SubLeaseAddendum = { title: '추가 호실 특약', items: ['보관 용도로만 씁니다.'] }
  const R: ContractTemplate = { ...T, sections: [...T.sections, { id: 'r', title: '환불', items: ['{{환불규정}} 에 따릅니다.'] }] }
  const raw = { enabled: true, langs: { en: { published: true, dict: { 단기숙소계약서: 'Contract', '추가 호실 특약': 'Storage' } } } }
  const d = {
    template: T, refundClauseInContract: false,
    subLeaseAddendum: A, rateAddendum: null, roomScheduleText: null, roomScheduleAddendum: null,
    // 청소비는 헬퍼가 이 칸에서 읽는다(병합값). 계약이 없으면 null 이고 '없음' 갈래로 착지한다.
    lease: null,
  }

  eq('언어가 없으면 해석하지 않는다(한국어 계약서는 이 기능 전과 같다)',
    resolveContractTranslationFor(raw, d, undefined), null)
  eq('null 언어도 마찬가지', resolveContractTranslationFor(raw, d, null), null)
  /**
   * 헬퍼가 고른 절이 종이가 싣는 절과 **같은 정본**에서 나온다는 증명이자, 링크 발급 박제의
   * 무회귀 증명이다 — 발급이 손으로 적던 그 식과 헬퍼가 모든 모양에서 같은 JSON 을 낸다.
   */
  {
    const shapes = [
      { subLeaseAddendum: null, rateAddendum: null, roomScheduleText: null, roomScheduleAddendum: null },
      { subLeaseAddendum: A, rateAddendum: null, roomScheduleText: null, roomScheduleAddendum: null },
      { subLeaseAddendum: null, rateAddendum: A, roomScheduleText: null, roomScheduleAddendum: null },
      { subLeaseAddendum: null, rateAddendum: null, roomScheduleText: '3월까지 301호', roomScheduleAddendum: A },
      { subLeaseAddendum: A, rateAddendum: A, roomScheduleText: '3월까지 301호', roomScheduleAddendum: A },
    ]
    const mismatches: string[] = []
    for (const s of shapes) {
      for (const tpl of [T, R]) {
        for (const refund of [true, false]) {
          for (const lang of ['en', 'vi'] as const) {
            const now = JSON.stringify(resolveContractTranslationFor(raw, { template: tpl, refundClauseInContract: refund, ...s, lease: null }, lang))
            // 발급이 손으로 적던 그 식 그대로. 청소비는 헬퍼가 lease 에서 읽어 넘기는 그 값이다.
            const then = JSON.stringify(resolveContractTranslation(raw, tpl, lang, contractAddendaForTranslation(s), refund, 0))
            if (now !== then) mismatches.push(`${JSON.stringify(s)}/${refund}/${lang}`)
          }
        }
      }
    }
    eq('헬퍼의 결과가 종전 직접 해석과 40가지 모양에서 모두 같다(링크 박제 무회귀)', mismatches, [])
  }
  eq('그 계약에 실린 특약이 번역본에 선다',
    resolveContractTranslationFor(raw, d, 'en')?.addenda?.[0]?.title, 'Storage')
  eq('특약이 없으면 칸 자체가 없다',
    resolveContractTranslationFor(raw, { ...d, subLeaseAddendum: null }, 'en')?.addenda, undefined)
  // 환불 조항 토글이 변수 줄을 세우거나 안 세운다 — 종이와 같은 조건이라야 한다.
  const refundOn = { template: R, refundClauseInContract: true, lease: null }
  const refundOff = { template: R, refundClauseInContract: false, lease: null }
  eq('토글이 켜지면 변수 줄이 서서 값이 담긴다',
    typeof resolveContractTranslationFor(raw, refundOn, 'en')?.vars?.환불규정, 'string')
  eq('꺼지면 그 칸이 없다', resolveContractTranslationFor(raw, refundOff, 'en')?.vars, undefined)
  eq('분모도 토글을 따라 하나 갈린다',
    (resolveContractTranslationFor(raw, refundOn, 'en')?.totalCount ?? 0)
      - (resolveContractTranslationFor(raw, refundOff, 'en')?.totalCount ?? 0), 1)
  // 꺼진 영업장은 언어를 지목해도 null 이다 — '번역본 없음'으로 착지하는 길이 하나뿐이다.
  eq('운영 스위치가 꺼져 있으면 지목해도 null',
    resolveContractTranslationFor({ ...raw, enabled: false }, d, 'en'), null)
  eq('미공개 언어도 null',
    resolveContractTranslationFor({ enabled: true, langs: { en: { published: false, dict: {} } } }, d, 'en'), null)
  // 카드와 우선 조항이 같은 값을 본다 — 한국어면 절 배열이 **같은 객체**로 돌아온다(무회귀 급소).
  const secs = [{ title: '1. 입실 계약', items: ['a'] }]
  eq('한국어면 우선 조항이 안 붙는다(받은 배열 그대로)',
    appendSubLeaseAddendum(secs, contractTranslationAddendum(resolveContractTranslationFor(raw, d, undefined))) === secs, true)
  eq('번역본이 서면 우선 조항이 붙는다',
    appendSubLeaseAddendum(secs, contractTranslationAddendum(resolveContractTranslationFor(raw, d, 'en'))).length, 2)
}

// ── 6단계 ⑬ 지문 — 로드와 발급 사이에 사전이 바뀌었는지 ────────────
//
// 대면 서명은 화면 로드와 발급 사이에 창이 있다. 그 사이 사전이 바뀌면 입주자가 건네받아 읽은
// 문안과 종이에 박히는 문안이 갈리는데, 그 갈림은 아무 소리도 안 낸다.
{
  const base = { enabled: true, langs: { en: { published: true, dict: { 단기숙소계약서: 'Contract' } } } }
  const d = { template: T, refundClauseInContract: false }
  const a = resolveContractTranslationFor(base, d, 'en')

  eq('번역본이 없으면 지문도 없다', translationDigest(null), null)
  eq('undefined 도 마찬가지', translationDigest(undefined), null)
  eq('같은 사전을 두 번 해석하면 같은 지문',
    translationDigest(a), translationDigest(resolveContractTranslationFor(base, d, 'en')))
  // 한 줄만 고쳐도 달라야 한다 — 이 검사가 잡아야 할 사고가 정확히 그것이다.
  const edited = { enabled: true, langs: { en: { published: true, dict: { 단기숙소계약서: 'Agreement' } } } }
  eq('한 줄이 바뀌면 지문이 다르다',
    translationDigest(a) === translationDigest(resolveContractTranslationFor(edited, d, 'en')), false)
  // 번역을 지운 것도 사전 변경이다(그 줄이 한국어 원문으로 돌아간다).
  const cleared = { enabled: true, langs: { en: { published: true, dict: {} } } }
  eq('번역이 지워져도 지문이 다르다',
    translationDigest(a) === translationDigest(resolveContractTranslationFor(cleared, d, 'en')), false)
  // 언어가 다르면 내용이 같아도 다른 종이다.
  const viRaw = { enabled: true, langs: { vi: { published: true, dict: { 단기숙소계약서: 'Contract' } } } }
  eq('언어가 다르면 지문도 다르다',
    translationDigest(a) === translationDigest(resolveContractTranslationFor(viRaw, d, 'vi')), false)
  // 박제를 다시 읽은 값도 같은 지문이라야 한다. 두 조립이 갈리면 멀쩡한 발급이 거절된다.
  eq('박제 파서를 한 번 태워도 같은 지문',
    translationDigest(a), translationDigest(asResolvedContractTranslation(JSON.parse(JSON.stringify(a)))))
  /**
   * 열쇠 순서에 안 기댄다는 계약.
   *
   * **파서를 태우면 안 된다** — asResolvedContractTranslation 은 제 순서로 다시 조립하므로
   * 순서 차이를 지워 버린다. 그러면 지문이 JSON.stringify(t) 여도 통과해 이 진리표가 죽는다
   * (역주입 ㉓로 실측). 손으로 세운 객체를 그대로 넘겨야 실제로 재는 것이 된다.
   */
  {
    const shuffled = {
      totalCount: a?.totalCount, fallbackCount: a?.fallbackCount, oathText: a?.oathText,
      sections: a?.sections, title: a?.title, lang: a?.lang,
    } as unknown as NonNullable<typeof a>
    eq('열쇠 순서가 달라도 같은 지문', translationDigest(a), translationDigest(shuffled))
  }
  // 계수 축도 지문에 든다 — 박제가 통비교하는 JSON 의 일부라, 여기서 빼면 '몇 줄이 원문으로
  // 남았나'가 달라진 해석본을 같은 것으로 통과시킨다.
  {
    const one = { lang: 'en', title: 'T', sections: [], oathText: '', fallbackCount: 0, totalCount: 3 } as unknown as NonNullable<typeof a>
    const two = { ...one, fallbackCount: 1 }
    const three = { ...one, totalCount: 4 }
    eq('폴백 수가 다르면 지문이 다르다', translationDigest(one) === translationDigest(two), false)
    eq('총수가 다르면 지문이 다르다', translationDigest(one) === translationDigest(three), false)
  }
  eq('지문은 짧은 16진 문자열이다(요청 몸통에 실린다)', /^[0-9a-f]{16}$/.test(translationDigest(a) ?? ''), true)
}

// ── 6단계 ⑭ 본문 수정이 비운 번역 계수 — 0 이면 침묵 ───────────────
//
// 열쇠가 한국어 문장 자체라, 본문 한 줄을 고치면 그 줄의 번역이 저절로 '없음'이 되어 종이에 원문이
// 남는다. 설계대로지만 아무도 말해 주지 않아, 다 번역해 둔 계약서가 조용히 반쪽이 됐다.
{
  const dict = {
    단기숙소계약서: 'Contract',
    '1. 입실 계약': '1. Lease',
    '1인 1실을 원칙으로 합니다.': 'One person per room.',
  }
  const raw = { enabled: true, langs: {
    en: { published: true, dict: { ...dict } },
    vi: { published: true, dict: { ...dict } },
    ja: { published: false, dict: { 단기숙소계약서: 'Contract' } },
  } }

  eq('안 고쳤으면 아무 말도 안 한다', translationStaleAfterEdit(raw, T, T), { langs: 0, lines: 0 })

  // 항목 한 줄을 고친다 — 그 줄의 번역이 en·vi 두 언어에서 갈 곳을 잃는다.
  const editedOne: ContractTemplate = {
    ...T,
    sections: [{ ...T.sections[0], items: ['1인 1실을 원칙으로 합니다. 예외는 없습니다.', T.sections[0].items[1]] }, T.sections[1]],
  }
  eq('한 줄을 고치면 두 언어에서 한 줄씩 잃는다',
    translationStaleAfterEdit(raw, T, editedOne), { langs: 2, lines: 1 })

  // 두 줄을 고치면 잃은 줄 가짓수가 둘이다. 언어 수는 **그 줄의 번역을 갖고 있던 언어 수**라,
  // 제목만 번역해 둔 ja 까지 셋이 된다 — 언어 수는 '한 줄이라도 잃은 언어'의 수다.
  const editedTwo: ContractTemplate = { ...editedOne, title: '단기 숙소 계약서' }
  eq('제목까지 고치면 제목만 번역해 둔 언어도 함께 센다',
    translationStaleAfterEdit(raw, T, editedTwo), { langs: 3, lines: 2 })

  // 번역이 없던 줄은 잃은 것이 아니다 — 원래부터 원문으로 나가던 자리다.
  const editedUntranslated: ContractTemplate = {
    ...T, sections: [T.sections[0], { ...T.sections[1], items: ['퇴실 14일 전에 알려주어야 합니다.'] }],
  }
  eq('번역이 없던 줄을 고치면 침묵한다', translationStaleAfterEdit(raw, T, editedUntranslated), { langs: 0, lines: 0 })

  // 미공개 언어도 센다 — 운영자가 채워 둔 번역이고, 잃은 것은 잃은 것이다.
  eq('미공개 언어의 손실도 센다',
    translationStaleAfterEdit(raw, T, { ...T, title: '단기 숙소 계약서' }), { langs: 3, lines: 1 })

  // 사전이 아예 없으면 셀 것이 없다 — 번역본을 안 쓰는 영업장은 이 기능 전과 같은 저장이다.
  eq('사전이 없으면 침묵한다', translationStaleAfterEdit(null, T, editedTwo), { langs: 0, lines: 0 })
  eq('운영 스위치가 꺼져 있어도 채워 둔 번역의 손실은 센다(사전은 운영자의 일이다)',
    translationStaleAfterEdit({ ...raw, enabled: false }, T, editedOne), { langs: 2, lines: 1 })

  // 절을 통째로 지우면 그 절 제목의 번역도 함께 잃는다.
  const removed: ContractTemplate = { ...T, sections: [T.sections[1]] }
  eq('절을 지우면 그 절의 번역을 잃는다', translationStaleAfterEdit(raw, T, removed), { langs: 2, lines: 2 })

  // 되돌리면 다시 0 이다 — 고아를 안 지운다는 구조 규칙이 여기서 눈에 보인다.
  eq('되돌리면 잃은 것이 없다', translationStaleAfterEdit(raw, editedTwo, T), { langs: 0, lines: 0 })

  // 분모(가변 절)를 넘겨도 저장 전후가 같아 계수는 안 흔들린다.
  const A2: SubLeaseAddendum = { title: '추가 호실 특약', items: ['보관 용도로만 씁니다.'] }
  eq('가변 절을 넘겨도 계수가 같다',
    translationStaleAfterEdit(raw, T, editedOne, [A2], false), { langs: 2, lines: 1 })
}

// ── 7단계 ⑮ 서명 요청 피커 기본값 — 툴바에서 고른 것이 이어진다 ─────
//
// 언어를 고르는 자리가 둘이 됐는데(툴바 번역본 셀렉트 · 서명 요청 피커) 안 이어져 있었다.
// 베트남어 번역본을 보다가 그대로 서명 요청을 누르면 피커 기본값이 국적값으로 돌아갔다.
// **갈림은 URL 파라미터의 유무 하나다** — 툴바는 URL 이 정본이고 한국어도 lang=ko 로 남긴다.
{
  eq('파라미터가 없으면 국적 기본값이다(이 기능 전과 같은 착지)',
    signRequestDefaultLang(null, '베트남'), { lang: 'vi', fromView: false })
  eq('파라미터 칸 자체가 없어도 국적 기본값이다',
    signRequestDefaultLang(undefined, '방글라데시'), { lang: 'bn', fromView: false })
  eq('빈 문자열은 고른 것이 아니다', signRequestDefaultLang('', '중국'), { lang: 'zh', fromView: false })
  // 급소 — 툴바에서 고른 언어가 그대로 이어진다. 국적과 다른 것이 이 진리표의 요점이다.
  eq('툴바에서 고른 언어가 기본값이 된다',
    signRequestDefaultLang('vi', '방글라데시'), { lang: 'vi', fromView: true })
  // 급소 — 한국어도 '고른 것'이다. 여기서 국적값으로 되돌리면 툴바에서 '없음(한국어)'을 고른
  // 운영자에게 베트남어가 다시 선다(툴바가 lang=ko 를 지우지 않는 것과 같은 이유).
  eq('한국어를 고른 것도 이어진다', signRequestDefaultLang('ko', '베트남'), { lang: 'ko', fromView: true })
  // 화이트리스트 밖은 고른 적이 없는 것과 같다 — URL 은 손으로 고칠 수 있다.
  eq('모르는 코드는 국적 기본값으로 떨어진다',
    signRequestDefaultLang('fr', '베트남'), { lang: 'vi', fromView: false })
  eq('코드처럼 생긴 아무 문자열도 마찬가지다',
    signRequestDefaultLang('vi-VN', '베트남'), { lang: 'vi', fromView: false })
  // 급소 — 이 판정은 **URL 문자열**만 본다. 화면이 해석한 언어(translation.lang)를 읽으면
  // 비공개 언어에서 ko 로 떨어져, 운영자가 고른 것과 다른 언어가 기본값이 된다.
  // 공개 여부를 인자로 받지도 않으므로 미공개 언어도 고른 그대로 이어진다.
  eq('공개 안 한 언어를 골라도 그 언어가 이어진다(ko 로 안 떨어진다)',
    signRequestDefaultLang('ja', '베트남'), { lang: 'ja', fromView: true })
  // 국적 갈래는 종전 매핑 그대로다 — 이 함수가 새로 정하는 것은 '이어받는가' 하나다.
  eq('국적 매핑은 종전 그대로다(카자흐스탄은 러시아어)',
    signRequestDefaultLang(null, '카자흐스탄'), { lang: 'ru', fromView: false })
  eq('국적이 비면 한국어가 기본값이다(추정으로 남의 언어를 세우지 않는다)',
    signRequestDefaultLang(null, ''), { lang: 'ko', fromView: false })
  // 이 값은 피커 기본값까지만 간다. 링크에 박히는 언어는 서버가 같은 화이트리스트로 다시 정한다.
  for (const l of SIGN_LANGS) {
    eq(`고른 ${l} 이 그대로 이어진다`, signRequestDefaultLang(l, '베트남'), { lang: l, fromView: true })
  }
}

// ── 8단계 ⑯ 설정 미리보기 — 저장 전 창과 저장 후 종이가 같은 문안이다 ──
//
// 미리보기는 화면 입력칸(draft)을 **공개 켜진 사전 모양으로 싸서** 해석 정본에 그대로 넣는다.
// 그 창이 보이는 문안이 저장 뒤 종이에 실릴 문안과 갈리면, 운영자는 확인한 적 없는 종이를
// 확인했다고 믿고 내보낸다. 갈릴 만한 자리는 **저장이 사전을 손보는 규칙**이다 — 빈 칸·공백
// 칸을 걷는 그 규칙을 파서가 똑같이 걷는지가 이 진리표의 전부다.
{
  const draft: Record<string, string> = {
    단기숙소계약서: 'Short-stay Accommodation Contract',
    '1. 입실 계약': '1. Move-in',
    '1인 1실을 원칙으로 합니다.': 'One person per room as a rule.',
    // 운영자가 지웠거나 아직 안 친 칸. 저장은 이 열쇠를 걷고, 파서도 같이 걷어야 한다.
    '입실료는 매월 선납합니다.': '   ',
    '2. 퇴실 및 환불': '',
  }
  // 창이 보이는 것.
  const preview = resolveContractTranslation(
    { enabled: true, langs: { en: { published: true, dict: draft } } }, T, 'en')
  // 종이가 싣는 것 — 같은 사전을 저장 정본으로 병합한 뒤 그 저장본을 해석한다.
  const merged = mergeTranslationLang(withTranslationEnabled(null, true), 'en', { published: true, dict: draft })
  const saved = merged.ok ? resolveContractTranslation(merged.next, T, 'en') : null

  eq('저장이 거부되지 않는 사전이다', merged.ok, true)
  // 급소 — 두 해석이 통째로 같다. 문안·계수·절 구조 어느 하나라도 갈리면 여기서 선다.
  eq('저장 전 미리보기 = 저장 후 해석', preview, saved)
  eq('미리보기가 빈 칸이 아니다(창이 실제로 섰다)', preview === null, false)
  eq('공백만 친 칸은 미리보기에서도 한국어 원문이다', preview?.sections[0]?.items[1], '입실료는 매월 선납합니다.')
  eq('빈 칸도 한국어 원문이다', preview?.sections[1]?.title, '2. 퇴실 및 환불')
  eq('창의 계수가 종이의 계수와 같다', [preview?.fallbackCount, saved?.fallbackCount], [4, 4])
  // 창은 값을 지어내지 않는다 — 환불 줄이 없는 본문이라 vars 칸 자체가 안 선다.
  eq('창이 vars 를 지어내지 않는다', preview?.vars, undefined)
}

// ── 9단계 청소비 변수 줄 — 갈래 둘 × 금액 자리 × 세 결말 ───────────
//
// 청소비 조항은 본문에 문장이 없고 자리만 있다(`- {{청소비조항}}`). 문장은 코드가 청소비 유무로
// 갈라 만든다. 그래서 번역 대상 목록에 문장으로 서 있지 않았고, 다 번역한 계약서에서도 그
// 조항만 한국어로 남았다(운영자 요청 2026-09-11).
//
// **열쇠는 치환 전 문안이다.** 청소비는 계약별이고 계약서 표시값으로 덮을 수도 있어, 완성 문장을
// 열쇠로 삼으면 금액이 다른 계약에서 그 사전은 한 번도 안 맞는다.
{
  const K = cleaningTranslationKeys()
  // 본문에 두 자리를 다 둔 템플릿(기본 템플릿과 같은 모양).
  const C: ContractTemplate = {
    title: '계약서',
    sections: [{
      id: 'out', title: '2. 퇴실 및 환불',
      items: ['환불은 기준에 따릅니다.{{청소비공제}}', '- {{청소비조항}}', '평범한 줄'],
    }],
    oathText: '서약',
  }
  // 본문에서 청소비 조항을 지운 영업장.
  const NoC: ContractTemplate = { ...C, sections: [{ id: 'out', title: '2. 퇴실 및 환불', items: ['환불은 기준에 따릅니다.', '평범한 줄'] }] }

  /**
   * 그 언어의 청소비 권장 문안 셋을 **테스트가 직접 세운다.** 끝나면 반드시 되돌린다.
   *
   * 왜 있나(2026-09-11). 번역가 패널이 표를 채우자 "권장이 비어 있다"를 전제로 쓴 단언 열둘이
   * 한꺼번에 붉게 섰다. 동작은 설계대로였고 흔들린 것은 진리표였다 — **전역 상수의 그때 상태에
   * 매달려 있었기** 때문이다. 갈래를 테스트가 각각 세워 재면 표를 더 채우거나 비워도 안 흔들린다.
   *
   * 되돌리기를 finally 에 두는 이유. 중간 단언이 던져도 표가 오염된 채 남으면 그 뒤 블록 전부가
   * 거짓 결과를 낸다 — 진리표가 스스로 사고를 만드는 자리다.
   */
  const withCleaningRec = (
    lang: TranslationLang, v: { clause: string; none: string; deduct: string }, run: () => void,
  ) => {
    const saved = {
      clause: RECOMMENDED_CLEANING_TRANSLATION.clause[lang],
      none: RECOMMENDED_CLEANING_TRANSLATION.none[lang],
      deduct: RECOMMENDED_CLEANING_TRANSLATION.deduct[lang],
    }
    RECOMMENDED_CLEANING_TRANSLATION.clause[lang] = v.clause
    RECOMMENDED_CLEANING_TRANSLATION.none[lang] = v.none
    RECOMMENDED_CLEANING_TRANSLATION.deduct[lang] = v.deduct
    try { run() } finally {
      RECOMMENDED_CLEANING_TRANSLATION.clause[lang] = saved.clause
      RECOMMENDED_CLEANING_TRANSLATION.none[lang] = saved.none
      RECOMMENDED_CLEANING_TRANSLATION.deduct[lang] = saved.deduct
    }
  }
  /** 권장 문안이 아직 없는 상태(번역가 패널 전). 빈 칸이면 한국어가 그대로 나간다. */
  const NO_REC = { clause: '', none: '', deduct: '' }
  /** 권장 문안이 채워진 상태. 금액 자리는 권장 문안도 지켜야 한다. */
  const REC = {
    clause: 'Cleaning fee {{청소비}} covers the move-out cleaning.',
    none: 'This contract has no cleaning fee.',
    deduct: '(cleaning fee {{청소비}} deducted)',
  }
  // 실제 표가 지금 어느 상태든 이 진리표의 답은 안 바뀐다 — 그 사실을 한 줄로 못박는다.
  eq('권장 표는 언어 전량 선언이라 칸이 빠지지 않는다',
    TRANSLATION_LANGS.filter(l => !(l in RECOMMENDED_CLEANING_TRANSLATION.clause)), [])

  // ①-b 권장 문안 **자체**의 금액 자리 — 여기만 그물 밖이었다.
  //
  // 저장·되붙이기의 자리표시자 검사는 **운영자 사전 값**만 본다(translationPlaceholderMisses).
  // 코드 사전인 권장 문안은 그 문을 안 지나므로, 번역가가 `{{청소비}}` 를 빠뜨린 문안을 넘기면
  // 아무 소리 없이 금액을 잃은 조항이 종이로 나간다. 표가 실제로 채워진 2026-09-11 부터 사는 축이다.
  {
    const rec = RECOMMENDED_CLEANING_TRANSLATION
    const lostClause = TRANSLATION_LANGS.filter(l => rec.clause[l] && missingTranslationPlaceholders(K.clause, rec.clause[l]).length > 0)
    const lostDeduct = TRANSLATION_LANGS.filter(l => rec.deduct[l] && missingTranslationPlaceholders(K.deduct, rec.deduct[l]).length > 0)
    eq('권장 문안(있음)이 금액 자리를 잃은 언어가 없다', lostClause, [])
    eq('권장 문안(공제)이 금액 자리를 잃은 언어가 없다', lostDeduct, [])
    // 없음 갈래는 금액이 없는 문장이라 자리표시자가 있으면 그것이 오히려 결함이다.
    eq('권장 문안(없음)에는 자리표시자가 없다',
      TRANSLATION_LANGS.filter(l => translationPlaceholders(rec.none[l]).length > 0), [])
    // 한 언어 안에서 셋이 반쪽으로 차면 유료 계약의 번역본이 조항은 그 언어, 꼬리는 한국어가 된다.
    eq('언어마다 권장 셋이 다 있거나 다 없다',
      TRANSLATION_LANGS.filter(l => new Set([!!rec.clause[l], !!rec.none[l], !!rec.deduct[l]]).size !== 1), [])
    const filledLangs = TRANSLATION_LANGS.filter(l => rec.clause[l])
    console.log(`  [실측] 청소비 권장 문안 적재: ${filledLangs.length}/${TRANSLATION_LANGS.length}언어${filledLangs.length ? ` (${filledLangs.join(' · ')})` : ''}`)
  }

  // ① 열쇠가 종이 문장과 한 상수에서 나온다 — 두 벌이면 문안을 고칠 때 번역이 통째로 고아가 된다.
  eq('열쇠는 치환 전 문안이다(금액 자리가 남아 있다)',
    [translationPlaceholders(K.clause), translationPlaceholders(K.deduct), translationPlaceholders(K.none)],
    [['{{청소비}}'], ['{{청소비}}'], []])
  eq('열쇠를 종이 vars 로 채우면 종이 문장과 글자까지 같다(있음)',
    renderContractText(K.clause, cleaningFeeVars(20000)), cleaningFeeVars(20000).청소비조항)
  eq('공제 꼬리도 같다(앞 한 칸은 넣는 쪽이 붙인다)',
    ' ' + renderContractText(K.deduct, cleaningFeeVars(20000)), cleaningFeeVars(20000).청소비공제)
  eq('없음 갈래는 자리표시자가 없어 그대로다', K.none, cleaningFeeVars(0).청소비조항)
  eq('없음 갈래의 공제는 종이에 아무것도 안 넣는다', cleaningFeeVars(0).청소비공제, '')
  eq('자리표시자 이름은 종이의 vars 열쇠와 같다',
    [CLEANING_CLAUSE_PLACEHOLDER, CLEANING_DEDUCT_PLACEHOLDER], ['{{청소비조항}}', '{{청소비공제}}'])

  // ② 갈래 — 있음은 조항+꼬리 둘, 없음은 조항 하나, 편집기는 셋 전부.
  const kindsOf = (t: ContractTemplate, c: number | 'property' | undefined) =>
    translationSourceLines(t, undefined, false, c).filter(l => l.kind === 'var').map(l => l.text)
  eq('청소비 있는 계약은 조항(있음)과 공제 꼬리 둘이 선다', kindsOf(C, 20000), [K.clause, K.deduct])
  eq('청소비 없는 계약은 조항(없음) 하나만 선다', kindsOf(C, 0), [K.none])
  eq('편집기는 영업장 전부라 셋이 다 선다', kindsOf(C, 'property'), [K.clause, K.none, K.deduct])
  eq('기준을 안 넘기면 한 줄도 안 선다(이 기능 전과 같다)', kindsOf(C, undefined), [])
  eq('본문에서 조항을 지운 영업장에는 안 선다', kindsOf(NoC, 'property'), [])
  // 공제 자리만 있고 조항 자리가 없는 본문 — 있음 갈래에서 꼬리만 선다.
  {
    const onlyTail: ContractTemplate = { ...C, sections: [{ id: 'out', title: '2. 퇴실', items: ['환불은 기준에 따릅니다.{{청소비공제}}'] }] }
    eq('공제 자리만 있으면 꼬리만 선다', kindsOf(onlyTail, 20000), [K.deduct])
    eq('청소비가 없으면 그 꼬리도 안 선다(종이 값이 빈 문자열이다)', kindsOf(onlyTail, 0), [])
  }
  eq('변수 줄 이름이 줄에 붙어 온다(편집기가 라벨을 고르는 근거)',
    translationSourceLines(C, undefined, false, 'property').filter(l => l.kind === 'var').map(l => l.varName),
    ['청소비조항', '청소비조항', '청소비공제'])
  // 이름 수준 라벨 — 박제가 이름만 들고 있는 자리(피커·발급 상세 캡션)가 쓴다.
  eq('이름 라벨 정본이 셋을 다 안다',
    TRANSLATION_VAR_NAMES.map(n => TRANSLATION_VAR_LABEL[n]), ['환불 규정', '청소비 조항', '청소비 공제 문구'])
  // 줄 수준 라벨 — 편집기가 쓴다. **갈래를 가른다**(디자이너 차단 2026-09-11). 같은 이름 셋이
  // 연달아 서면 운영자는 같은 칸이 여러 번 선 것으로 읽는다.
  {
    // 네 줄이 다 서는 본문(환불 자리 + 청소비 두 자리).
    const Both: ContractTemplate = { ...C, sections: [{ id: 'out', title: '2. 퇴실 및 환불', items: ['환불은 기준에 따릅니다.{{환불규정}}{{청소비공제}}', '- {{청소비조항}}'] }] }
    eq('줄 라벨은 갈래까지 가른다',
      translationVarSpecs(Both, undefined, true, 'property').map(x => x.label),
      ['환불 규정', '청소비 조항(있음)', '청소비 조항(없음)', '청소비 공제 문구'])
    eq('환불 줄 라벨은 종전 그대로다(무회귀)',
      translationVarSpecs(Both, undefined, true, 'property')[0]?.label, '환불 규정')
    // 환불은 권장이 7언어 전부 있어 B 규칙에서도 종전과 같은 계수다(디자이너 차단 B 의 무회귀 조건).
    const refundKey = refundTranslationKey()
    eq('환불 줄은 빈 칸이어도 완료다(권장이 있다)',
      translationLineDone('en', { kind: 'var', text: refundKey, varName: '환불규정' }, undefined), true)
    const bothOf = () => resolveContractTranslation(
      { enabled: true, langs: { en: { published: true, dict: {} } } }, Both, 'en', undefined, true, 20000)
    // 청소비 권장을 **비운 상태로 세워** 환불 줄만 홀로 완료인지 본다.
    withCleaningRec('en', NO_REC, () => {
      eq('청소비 권장이 없으면 일곱 줄 중 여섯이 폴백이고 빠지는 하나가 환불 줄이다',
        (r => [r?.totalCount, r?.fallbackCount])(bothOf()), [7, 6])
    })
    // 채운 상태에서는 변수 줄 셋이 다 빠진다. 환불의 계수는 두 갈래에서 똑같다(무회귀 조건).
    withCleaningRec('en', REC, () => {
      eq('청소비 권장이 채워지면 변수 줄 셋이 다 빠져 폴백이 넷이다',
        (r => [r?.totalCount, r?.fallbackCount])(bothOf()), [7, 4])
    })
    eq('언어가 늘어도 환불 권장은 전량이라 같은 답이다',
      TRANSLATION_LANGS.every(l => translationLineDone(l, { kind: 'var', text: refundKey, varName: '환불규정' }, undefined)), true)
  }

  // ③ 세 결말 — 빈 칸 · 직접 번역 · 자리표시자 손실.
  const empty = { enabled: true, langs: { en: { published: true, dict: {} } } }
  const emptyOf = () => resolveContractTranslation(empty, C, 'en', undefined, false, 20000)
  // 권장이 **없는** 갈래 — 빈 칸은 아무 값도 안 내보내고 종이의 한국어 문장이 그대로 선다.
  // 그리고 그 줄은 완료가 아니라 폴백이다(디자이너 차단 2026-09-11). 종전에는 kind === 'var' 를
  // 무조건 완료로 세어, 한국어로 나가는 청소비 문장이 번역 완료로 잡혔다.
  withCleaningRec('en', NO_REC, () => {
    const r = emptyOf()
    eq('권장이 없으면 빈 칸은 vars 를 안 만든다(한국어가 남는다)', r?.vars, undefined)
    eq('권장 없는 변수 줄은 폴백으로 센다(종이에 한국어가 나간다)',
      [r?.totalCount, r?.fallbackCount], [7, 7])
    eq('진행도 같은 정본이다',
      (p => [p.total, p.done])(translationProgress(empty, C, 'en', undefined, false, 20000)), [7, 0])
    eq('계수 정본 — 권장이 없으면 빈 칸은 미완이다',
      [translationLineDone('en', { kind: 'var', text: K.clause, varName: '청소비조항' }, undefined),
        translationLineDone('en', { kind: 'var', text: K.clause, varName: '청소비조항' }, 'X {{청소비}}'),
        translationLineDone('en', { kind: 'item', text: '평범한 줄' }, undefined)],
      [false, true, false])
  })
  // 권장이 **있는** 갈래 — 빈 칸이 권장 문안을 내보내고 그 줄은 완료다.
  withCleaningRec('en', REC, () => {
    const r = emptyOf()
    eq('권장이 있으면 빈 칸이 권장 문안을 내보낸다',
      [r?.vars?.청소비조항, r?.vars?.청소비공제], [REC.clause, ' ' + REC.deduct])
    eq('그 줄들은 폴백이 아니다', [r?.totalCount, r?.fallbackCount], [7, 5])
    eq('진행도 그만큼 찬다',
      (p => [p.total, p.done])(translationProgress(empty, C, 'en', undefined, false, 20000)), [7, 2])
    eq('계수 정본 — 권장이 있으면 빈 칸도 완료다',
      translationLineDone('en', { kind: 'var', text: K.clause, varName: '청소비조항' }, undefined), true)
  })

  const mine = {
    enabled: true,
    langs: { en: { published: true, dict: { [K.clause]: 'Cleaning fee {{청소비}} is the price of the move-out cleaning service.', [K.deduct]: '(cleaning fee {{청소비}} deducted from the deposit)' } } },
  }
  const rMine = resolveContractTranslation(mine, C, 'en', undefined, false, 20000)
  eq('직접 번역은 그대로 나간다(조항은 앞 칸 없이)',
    rMine?.vars?.청소비조항, 'Cleaning fee {{청소비}} is the price of the move-out cleaning service.')
  eq('공제 꼬리는 종이와 같은 모양이라 앞 한 칸이 붙는다',
    rMine?.vars?.청소비공제, ' (cleaning fee {{청소비}} deducted from the deposit)')
  // 표식은 **권장이 있을 때만** 선다. 없는 기준에서 벗어났다고 말할 수는 없기 때문이다.
  withCleaningRec('en', NO_REC, () => {
    eq('권장이 없으면 직접 번역 표식이 안 선다',
      resolveContractTranslation(mine, C, 'en', undefined, false, 20000)?.customVars, undefined)
  })
  withCleaningRec('en', REC, () => {
    eq('권장이 있으면 손문안 두 줄에 표식이 선다',
      resolveContractTranslation(mine, C, 'en', undefined, false, 20000)?.customVars,
      ['청소비조항', '청소비공제'])
  })
  eq('저장도 그 손문안을 안 걷는다(그 언어의 유일한 번역이다)',
    (m => (m.ok ? m.next.langs.en?.dict[K.clause] : 'REJECTED'))(
      mergeTranslationLang({ enabled: true, langs: {} }, 'en', { dict: { [K.clause]: 'X {{청소비}}' } })), 'X {{청소비}}')
  // 자리표시자를 잃은 번역은 **저장이 거부한다**. 종이가 금액을 잃는 실패라 조용히 지나가면 안 된다.
  {
    const lost = mergeTranslationLang({ enabled: true, langs: {} }, 'en', { dict: { [K.clause]: 'Cleaning fee is the price.' } })
    eq('금액 자리를 지운 번역은 저장이 거부한다', lost.ok, false)
    eq('어느 자리가 빠졌는지 말한다', lost.ok ? [] : lost.missing[0]?.placeholders, ['{{청소비}}'])
    const back = applyTranslationPaste(
      translationSourceLines(C, undefined, false, 20000),
      ['계약서', '2. 퇴실 및 환불', 'A', 'B', 'C', '서약', 'Cleaning fee is the price.', 'D {{청소비}}'].join('\n'))
    eq('되붙이기도 같은 판정으로 통째 거부한다', back.ok, false)
  }
  // '빈 칸=권장' 과 '권장과 같은 값은 저장에서 걷힌다' 를 권장이 있는 갈래에서 못박는다.
  withCleaningRec('en', REC, () => {
    eq('권장을 쓴 것은 직접 번역이 아니다',
      resolveContractTranslation(empty, C, 'en', undefined, false, 20000)?.customVars, undefined)
    eq('피커 캡션도 손문안을 안다',
      translationProgress(mine, C, 'en', undefined, false, 20000).customVars, ['청소비조항', '청소비공제'])
    const same = mergeTranslationLang({ enabled: true, langs: {} }, 'en', { dict: { [K.clause]: REC.clause } })
    eq('권장과 같은 값은 저장에서 걷힌다', same.ok ? same.next.langs.en?.dict[K.clause] : 'REJECTED', undefined)
  })
  withCleaningRec('en', NO_REC, () => {
    const mineSaved = mergeTranslationLang({ enabled: true, langs: {} }, 'en', { dict: { [K.clause]: REC.clause } })
    eq('권장이 없으면 같은 글자라도 안 걷힌다(그 언어의 유일한 번역이다)',
      mineSaved.ok ? mineSaved.next.langs.en?.dict[K.clause] : 'REJECTED', REC.clause)
  })

  // ④ 해석 헬퍼가 **그 계약의 금액**으로 갈래를 고른다.
  //
  // 급소 — 편집기 기준('property')이 헬퍼로 새어 들면 두 갈래가 다 서고 앞선 갈래가 이겨,
  // 청소비 0원 계약의 번역본에 '청소비 20,000원은…' 조항이 실린다. 종이는 '청소비 없음'을 찍는데
  // 입주자가 읽은 번역본은 돈을 받는다고 말하는 상태다.
  {
    const dFree = { template: C, refundClauseInContract: false, lease: { cleaningFee: 0 } }
    const dPaid = { template: C, refundClauseInContract: false, lease: { cleaningFee: 20000 } }
    const dNone = { template: C, refundClauseInContract: false, lease: null }
    const varsOf = (d: Parameters<typeof resolveContractTranslationFor>[1]) =>
      Object.keys(resolveContractTranslationFor(mine, d, 'en')?.vars ?? {})
    eq('청소비 있는 계약은 조항·공제 둘을 덮는다', varsOf(dPaid), ['청소비조항', '청소비공제'])
    eq('계약이 없으면 0원과 같은 갈래다', varsOf(dNone), varsOf(dFree))
    // 분모는 갈래를 따라 갈린다 — 유료는 조항·공제 둘, 0원은 조항 하나다.
    eq('분모도 갈래를 따라 갈린다',
      [resolveContractTranslationFor(mine, dPaid, 'en')?.totalCount,
        resolveContractTranslationFor(mine, dFree, 'en')?.totalCount], [7, 6])
    // 0원 계약은 **유료 갈래 손문안(clause 열쇠)** 을 집어 오면 안 된다. 권장이 없으면 아무것도
    // 안 덮고, 있으면 '없음' 권장이 선다 — 어느 쪽이든 유료 문안은 아니다.
    withCleaningRec('en', NO_REC, () => {
      eq('권장이 없으면 0원 계약은 아무것도 안 덮는다', varsOf(dFree), [])
    })
    withCleaningRec('en', REC, () => {
      eq('권장이 있으면 0원 계약은 없음 갈래 권장이 선다',
        resolveContractTranslationFor(mine, dFree, 'en')?.vars?.청소비조항, REC.none)
    })
    eq('어느 갈래에서든 0원 계약에 유료 손문안이 안 실린다',
      resolveContractTranslationFor(mine, dFree, 'en')?.vars?.청소비조항
        === mine.langs.en.dict[K.clause], false)

    // 손문안은 그 갈래의 열쇠에만 붙는다. freeMine 은 **없음 갈래 열쇠만** 담았다.
    const freeMine = { enabled: true, langs: { en: { published: true, dict: { [K.none]: 'No cleaning fee applies.' } } } }
    eq('0원 계약은 없음 갈래 열쇠의 번역을 쓴다',
      resolveContractTranslationFor(freeMine, dFree, 'en')?.vars?.청소비조항, 'No cleaning fee applies.')
    // **본뜻은 '유료 계약이 0원 갈래 손문안을 집어 오지 않는다'** 이다. 유료 계약은 clause 열쇠를
    // 찾는데 그 사전에는 없으니, 폴백이 그 갈래의 **권장 문안**으로 간다(undefined 가 아니다).
    // 2026-09-11 에 권장 표가 채워지면서 이 단언이 뜻과 무관하게 붉게 섰던 자리다.
    eq('유료 계약은 0원 갈래 손문안을 안 집어 온다',
      resolveContractTranslationFor(freeMine, dPaid, 'en')?.vars?.청소비조항 === 'No cleaning fee applies.', false)
    withCleaningRec('en', REC, () => {
      eq('그때 유료 계약의 빈 칸은 유료 갈래 권장으로 떨어진다',
        resolveContractTranslationFor(freeMine, dPaid, 'en')?.vars?.청소비조항, REC.clause)
    })
    withCleaningRec('en', NO_REC, () => {
      eq('권장까지 없으면 그 칸 자체가 안 생긴다(한국어가 남는다)',
        resolveContractTranslationFor(freeMine, dPaid, 'en')?.vars?.청소비조항, undefined)
    })
  }

  // ⑤ 박제 무변동 — 환불 하나만 담긴 옛 JSON 이 바이트로 그대로 돈다.
  {
    // 파서의 칸 순서는 **해석이 담는 순서**다(lang·title·sections·addenda·vars·customVars·oath·계수).
    // 그 순서가 곧 드리프트 통비교의 바이트라, 이 배열이 바뀌면 이미 나간 링크 전건이 뜬다.
    const old = { lang: 'en', title: 'T', sections: [], vars: { 환불규정: ' R' }, customVars: ['환불규정'], oathText: 'O', fallbackCount: 1, totalCount: 2 }
    eq('환불 하나만 얼어 있는 옛 박제는 파서를 지나도 바이트가 같다',
      JSON.stringify(asResolvedContractTranslation(JSON.parse(JSON.stringify(old)))), JSON.stringify(old))
    eq('파서는 멱등이다(두 번 지나도 안 흔들린다)',
      JSON.stringify(asResolvedContractTranslation(asResolvedContractTranslation(old))), JSON.stringify(old))
    const none = { lang: 'en', title: 'T', sections: [], oathText: 'O', fallbackCount: 1, totalCount: 2 }
    eq('vars 칸이 없던 박제에 칸을 만들지 않는다',
      JSON.stringify(asResolvedContractTranslation(JSON.parse(JSON.stringify(none)))), JSON.stringify(none))
    eq('모르는 이름은 버린다(박제에 없는 칸을 지어내지 않는다)',
      asResolvedContractTranslation({ ...old, vars: { 환불규정: ' R', 딴것: 'x' } })?.vars, { 환불규정: ' R' })
    // 담기는 순서가 이름 배열 고정이라, 섞여 들어온 박제도 같은 바이트로 나온다.
    eq('vars 순서는 이름 배열이 정한다',
      JSON.stringify(asResolvedContractTranslation({ ...old, vars: { 청소비공제: ' D', 환불규정: ' R', 청소비조항: 'C' } })?.vars),
      JSON.stringify({ 환불규정: ' R', 청소비조항: 'C', 청소비공제: ' D' }))
  }

  // ⑥ 1패스 봉합 회귀 — 주입값 안의 자리표시자가 글자로 안 남는다.
  //
  // ContractTranslationBody 가 하는 두 겹 치환을 그대로 재현한다. 컴포넌트를 못 부르는 자리라
  // 같은 식을 여기 적고, 배선 자체는 check-contract-translation-axis 의 ㉾ 가 지킨다.
  {
    const paper = cleaningFeeVars(20000)
    const twoPass = (translation: { vars?: Record<string, string> }, line: string): string => {
      const injected: Record<string, string> = {}
      for (const [k, v] of Object.entries(translation.vars ?? {})) injected[k] = renderContractText(v, paper)
      return renderContractText(line, { ...paper, ...injected })
    }
    const onePass = (translation: { vars?: Record<string, string> }, line: string): string =>
      renderContractText(line, { ...paper, ...(translation.vars ?? {}) })

    const t = { vars: { 청소비조항: 'Cleaning fee {{청소비}} is the price.', 청소비공제: ' (incl. {{청소비}})' } }
    eq('두 겹 치환은 금액이 들어간다', twoPass(t, '- {{청소비조항}}'), '- Cleaning fee 20,000원 is the price.')
    eq('꼬리도 마찬가지다', twoPass(t, '환불은 기준에 따릅니다.{{청소비공제}}'), '환불은 기준에 따릅니다. (incl. 20,000원)')
    // 봉합 전 동작 — 한 패스면 자리표시자가 글자 그대로 남는다. 이 줄이 곧 역주입의 기대값이다.
    eq('한 패스면 자리표시자가 글자로 남는다(봉합 전 동작)',
      onePass(t, '- {{청소비조항}}'), '- Cleaning fee {{청소비}} is the price.')
    // 환불 무영향 — 값에 자리표시자가 없어 두 식의 결과가 같다. 그래서 이 결함이 안 드러났다.
    const r = { vars: { 환불규정: ' ' + RECOMMENDED_REFUND_TRANSLATION.en } }
    eq('환불 규정은 두 식의 결과가 같다(봉합 무영향)',
      twoPass(r, '기준에 따릅니다.{{환불규정}}'), onePass(r, '기준에 따릅니다.{{환불규정}}'))
    // 번역본이 없으면 종이 값이 그대로 — 한국어 조항이 선다(무회귀).
    eq('번역본 값이 없으면 종이의 한국어 조항이 그대로 선다',
      twoPass({}, '- {{청소비조항}}'), '- ' + paper.청소비조항)
  }

  // ⑦ 기본 템플릿 실측 — 운영자가 실제로 보는 줄 수가 몇에서 몇으로 가는지.
  {
    const before = translationSourceLines(DEFAULT_CONTRACT_TEMPLATE, undefined, true).length
    const after = translationSourceLines(DEFAULT_CONTRACT_TEMPLATE, undefined, true, 'property').length
    eq('기본 템플릿 편집기 분모가 셋 는다(청소비 줄 셋)', after - before, 3)
    eq('청소비 있는 계약의 분모는 둘 는다',
      translationSourceLines(DEFAULT_CONTRACT_TEMPLATE, undefined, true, 20000).length - before, 2)
    eq('청소비 없는 계약은 하나 는다',
      translationSourceLines(DEFAULT_CONTRACT_TEMPLATE, undefined, true, 0).length - before, 1)
    // 다 채운 언어의 진행률 — **두 갈래를 다 못박는다.** 권장이 있으면 청소비 줄도 완료라
    // 33/33 이고, 권장이 비면 그 셋이 한국어로 나가므로 30/33 이다(차단 B). 전역 상수의 그때
    // 상태에 기대지 않으려고 갈래를 테스트가 각각 세운다.
    const full = Object.fromEntries(translationSourceLines(DEFAULT_CONTRACT_TEMPLATE, undefined, true).map(l => [l.text, 'T']))
    const raw = { enabled: true, langs: { en: { published: true, dict: full } } }
    const pBefore = translationProgress(raw, DEFAULT_CONTRACT_TEMPLATE, 'en', undefined, true)
    const progress = () => (p => [p.done, p.total])(
      translationProgress(raw, DEFAULT_CONTRACT_TEMPLATE, 'en', undefined, true, 'property'))
    let filled: unknown = null
    let blank: unknown = null
    withCleaningRec('en', REC, () => { filled = progress() })
    withCleaningRec('en', NO_REC, () => { blank = progress() })
    eq('권장이 채워진 언어는 청소비 줄까지 완료다', filled, [after, after])
    eq('권장이 빈 언어는 그 셋이 미완으로 남는다', blank, [before, after])
    eq('청소비 줄을 안 세우면 종전 그대로 100% 다', [pBefore.done, pBefore.total], [before, before])
    console.log(`  [실측] 기본 템플릿 번역 대상 줄: 편집기 ${before} 에서 ${after} · 유료 계약 ${before + 2} · 0원 계약 ${before + 1}`)
    console.log(`  [실측] 본문을 다 채운 언어의 진행률: 청소비 줄 없음 ${before}/${before} · 권장 있음 ${after}/${after} · 권장 없음 ${before}/${after}`)
  }
}

// ── 10단계 용어 통일 '입실료'는 코드 기본 문안에 없다 (운영자 결정 2026-09-11) ─────
//
// 계약서 한 장 안에서 같은 돈을 '입실료'와 '이용료' 두 이름으로 불렀다. 운영자가 '이용료'로
// 통일하기로 정했고, 코드 기본 문안이 그 정본이다(영업장 저장본은 scripts/fix-contract-fee-term).
//
// **왜 이 파일에 있나.** 사전의 열쇠가 한국어 문장 자체라 용어가 흔들리면 열쇠가 흔들린다 —
// 어휘 정합은 곧 열쇠 정합이다. 별도 그물로 떼려면 verify:fast 체인 등록이 필요한데 그것은
// 이 작업의 범위 밖이라, 이미 체인에 있는 이 진리표가 맡는다.
//
// **소스를 정규식으로 훑지 않고 상수값을 읽는다**(check-contract-unfair-clause 와 같은 규칙).
// 소스를 훑으면 주석이 옛 용어를 인용하는 것만으로 붉게 서고, 반대로 주석에 "고쳤다"고 적혀
// 있으면 통과시키는 그물이 된다.
{
  const flat = (t: ContractTemplate): string[] =>
    [t.title, t.oathText, ...(t.sections ?? []).flatMap(s => [s.title, ...(s.items ?? [])])]
  const addendumFlat = (a: SubLeaseAddendum): string[] => [a.title, ...(a.items ?? [])]
  const bodies: string[] = [
    ...flat(DEFAULT_CONTRACT_TEMPLATE),
    ...addendumFlat(DEFAULT_SUB_LEASE_ADDENDUM),
    ...addendumFlat(DEFAULT_SHORT_STAY_ADDENDUM),
    ...addendumFlat(DEFAULT_EARLY_CHECKOUT_ADDENDUM),
    ...addendumFlat(DEFAULT_ROOM_SCHEDULE_ADDENDUM),
    DEFAULT_DISPOSAL_CONSENT.title, DEFAULT_DISPOSAL_CONSENT.body,
    buildRefundClause(),
    CLEANING_FEE_SOURCE.clause, CLEANING_FEE_SOURCE.none, CLEANING_FEE_SOURCE.deduct,
  ].filter((x): x is string => typeof x === 'string')

  eq('코드 기본 문안에 옛 용어가 한 번도 안 남았다', bodies.filter(b => b.includes('입실료')), [])
  eq('종이에 나가는 청소비 문장에도 안 남았다',
    [cleaningFeeVars(20000).청소비조항, cleaningFeeVars(0).청소비조항, cleaningFeeVars(20000).청소비공제]
      .filter(b => b.includes('입실료')), [])
  // 급소 — 치환이 '입실' 로 넓어지면 날짜와 사람 호칭까지 뒤집힌다. **앵커 문구로 못박는다.**
  // 'some(포함)' 으로는 못 잡는다 — 다른 줄에 한 번만 남아 있어도 참이라, 한 자리를 뒤집은
  // 넓은 치환이 그대로 지나간다(2026-09-11 역주입 ⑩ 으로 실제로 뚫렸다).
  const anchored = (needle: string) => bodies.filter(b => b.includes(needle)).length
  eq('납부 기한의 입실일이 그대로다(날짜지 요금이 아니다)', anchored('입실일 기준 전일까지'), 1)
  eq('동의서 머리의 입실자가 그대로다(사람 호칭이다)', anchored('본인(입실자)은'), 1)
  eq('청소비 조항의 입실 시가 그대로다(시점이다)', anchored('입실 시 이용료와 함께 받습니다'), 1)
  eq('단기 특약의 입실이 그대로다(요금이 아니라 형태다)', anchored('단기 입실 요금표') > 0, true)
  // 새 용어가 실제로 그 자리에 들어갔다 — 문장을 통째로 지우는 회피를 막는다.
  eq('새 용어가 본문에 있다', flat(DEFAULT_CONTRACT_TEMPLATE).some(b => b.includes('이용료')), true)
  eq('환불 규정의 열쇠는 안 바뀌었다(그 줄에는 옛 용어가 없었다)',
    buildRefundClause(), refundTranslationKey())
  console.log(`  [실측] 코드 기본 문안 ${bodies.length}줄 · '입실료' 0회 · '이용료' ${bodies.filter(b => b.includes('이용료')).length}줄`)
}

// ── 11단계 권장 번역도 용어 통일을 진다 (2026-09-11 번역가 패널) ──────────────────
//
// **뚫린 자리다.** 10단계는 한국어 문안만 본다. 그래서 한국어를 '이용료'로 통일하고도 코드 권장
// 번역 셋(ja·zh·zht)이 옛 용어 '입실료'를 옮긴 말(入室料·入住费·入住費)을 그대로 쓰고 있었다.
// 한국어만 통일하고 **외국인이 읽는 문장은 여전히 두 이름**인 상태 — 고치라고 한 그 문제가
// 번역본으로 자리를 옮긴 것뿐이다. 영업장 사전 실측으로 잡았고 진리표는 한 마디도 안 했다.
//
// 그래서 짝을 못박는다. '이용료'가 나오는 한국어 문안의 권장 번역은 **그 언어 사전이 이용료를
// 옮긴 그 말**을 쓰고, 옛 용어를 옮긴 말은 안 쓴다.
//
// **왜 낱말 표를 코드에 두나.** 사전은 DB 에 있고 이 진리표는 verify:fast 체인이라 DB 를 안 읽는다.
// 표를 두면 사전 용어가 바뀔 때 이 줄도 같이 고쳐야 하는데, 그것이 이 그물의 목적이다 — 둘은
// 함께 움직여야 하는 한 쌍이고, 한쪽만 바뀌면 종이 한 장에 이름이 둘이 된다.
{
  // 사전 실측값(제기역점, 2026-09-11). use = 이용료를 옮긴 말, avoid = 옛 용어 '입실료'를 옮긴 말.
  // ru 는 격변화가 있어(плата/платой) 변하지 않는 쪽을 앵커로 잡는다.
  const FEE_TERM: Record<TranslationLang, { use: string; avoid?: string }> = {
    en:  { use: 'room fee' },
    vi:  { use: 'tiền phòng' },
    bn:  { use: 'বসবাস ফি' },
    ru:  { use: 'проживание' },
    ja:  { use: '利用料', avoid: '入室料' },
    zh:  { use: '使用费', avoid: '入住费' },
    zht: { use: '使用費', avoid: '入住費' },
  }

  // 이용료를 입에 올리는 권장 문안은 청소비 '있음' 갈래다. '없음'·'공제 꼬리'에는 그 말이 없다
  // (한국어 원문에도 없다) — 없는 말을 있으라고 하면 번역가가 문장을 늘리게 된다.
  eq('한국어 청소비 조항은 이용료를 입에 올린다(아래 단언의 전제)',
    CLEANING_FEE_SOURCE.clause.includes('이용료'), true)
  eq('없음·공제 갈래는 이용료를 안 부른다',
    [CLEANING_FEE_SOURCE.none, CLEANING_FEE_SOURCE.deduct].filter(s => s.includes('이용료')), [])

  const missing: string[] = []
  const stale: string[] = []
  for (const lang of TRANSLATION_LANGS) {
    const { use, avoid } = FEE_TERM[lang]
    const clause = RECOMMENDED_CLEANING_TRANSLATION.clause[lang]
    if (!clause.includes(use)) missing.push(`${lang}(청소비 조항)`)
    if (avoid && clause.includes(avoid)) stale.push(`${lang}(청소비 조항: ${avoid})`)
    // 환불 권장은 산식 줄이라 문장이 아니다. 옛 용어만 막고 있으라고는 안 한다 —
    // ru 는 'дневная ставка·месячная плата' 처럼 산식 어휘를 쓰는 것이 옳다.
    const refund = RECOMMENDED_REFUND_TRANSLATION[lang]
    if (avoid && refund.includes(avoid)) stale.push(`${lang}(환불 규정: ${avoid})`)
  }
  eq('권장 번역이 사전의 이용료를 그대로 쓴다', missing, [])
  eq('권장 번역에 옛 용어를 옮긴 말이 안 남았다', stale, [])

  // 금액 자리(`{{청소비}}`)는 여기서 안 잰다 — check-contract-translation-axis 의 권장 축이
  // 이미 전 언어를 훑는다. 둘이 갈라져 서야 무엇이 깨졌는지가 구별된다. 용어가 어긋난 것과
  // 금액을 잃은 것은 다른 사고이고, 고치는 사람도 다르다(번역가 대 시공).

  const cjk = TRANSLATION_LANGS.filter(l => FEE_TERM[l].avoid)
  // 실측 줄은 **잰 값**을 찍는다. 0 을 글자로 박아 두면 단언이 붉게 선 회차에도 "어긋남 0"
  // 이라고 말해, 로그만 보는 사람에게 거짓을 준다.
  console.log(`  [실측] 권장 번역 용어 정합: ${TRANSLATION_LANGS.length}언어 · 옛 용어 후보 ${cjk.length}(${cjk.join('·')}) · 빠진 용어 ${missing.length} · 옛 용어 잔존 ${stale.length}`)
}

console.log(`\n참고용 번역본 정본 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.error(`  - ${f}`)
process.exit(fails.length > 0 ? 1 : 0)
