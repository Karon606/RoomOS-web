// 참고용 번역본 정본 회귀 — 파서 방어·원문 폴백·고아 계수·꺼짐이면 null 을 진리표로 못박는다.
import {
  TRANSLATION_LANGS, asTranslationLang, parseContractTranslations, translationSourceLines,
  resolveContractTranslation, orphanTranslationKeys, withTranslationEnabled, mergeTranslationLang,
  TRANSLATION_NOTICE, translationNoticeBi, TRANSLATION_NOTICE_ADDENDUM, contractTranslationAddendum,
} from '../lib/contractTranslation'
import { SIGN_LANGS } from '../lib/signGuideText'
import { appendSubLeaseAddendum, type ContractTemplate } from '../lib/contract'
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

console.log(`\n참고용 번역본 정본 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.error(`  - ${f}`)
process.exit(fails.length > 0 ? 1 : 0)
