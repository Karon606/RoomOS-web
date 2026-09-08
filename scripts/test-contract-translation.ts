// 참고용 번역본 정본 회귀 — 파서 방어·원문 폴백·고아 계수·꺼짐이면 null 을 진리표로 못박는다.
import {
  TRANSLATION_LANGS, asTranslationLang, parseContractTranslations, translationSourceLines,
  resolveContractTranslation, orphanTranslationKeys, withTranslationEnabled, mergeTranslationLang,
  TRANSLATION_NOTICE, translationNoticeBi, TRANSLATION_NOTICE_ADDENDUM, contractTranslationAddendum,
  asResolvedContractTranslation, translationProgress, TRANSLATION_LANG_ENDONYM,
  translationCopyLine, translationCopyText, applyTranslationPaste,
} from '../lib/contractTranslation'
import { SIGN_LANGS } from '../lib/signGuideText'
import { appendSubLeaseAddendum, DEFAULT_CONTRACT_TEMPLATE, type ContractTemplate } from '../lib/contract'
import { printedFacts } from '../lib/contractPrintedFacts'

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

  const m = mergeTranslationLang(stored, 'en', { published: true, dict: { A: 'a2' } })
  eq('payload 에 없는 열쇠(고아)는 안 지워진다', m.langs.en?.dict, { A: 'a2', 고아: 'orphan' })
  eq('남의 언어는 안 건드린다', m.langs.vi?.dict, { A: 'av' })
  eq('운영 스위치도 안 건드린다', m.enabled, true)

  eq('빈 값으로 오면 그 열쇠만 걷는다(번역 취소)',
    mergeTranslationLang(stored, 'en', { dict: { A: '  ' } }).langs.en?.dict, { 고아: 'orphan' })
  eq('공개만 바꿔도 사전은 그대로',
    mergeTranslationLang(stored, 'en', { published: false }).langs.en?.dict, { A: 'a', 고아: 'orphan' })
  eq('공개가 실제로 바뀐다', mergeTranslationLang(stored, 'en', { published: false }).langs.en?.published, false)
  eq('없던 언어를 새로 만든다',
    mergeTranslationLang(stored, 'ja', { published: true, dict: { A: 'aj' } }).langs.ja, { published: true, dict: { A: 'aj' } })
  eq('null 저장본 위에도 선다',
    mergeTranslationLang(null, 'en', { published: true, dict: { A: 'a' } }).langs.en?.published, true)
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

console.log(`\n참고용 번역본 정본 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.error(`  - ${f}`)
process.exit(fails.length > 0 ? 1 : 0)
