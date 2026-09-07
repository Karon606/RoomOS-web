// 계약서 참고용 번역본의 판정 정본 — 저장 파싱·언어별 해석·고아 계수·우선 조항을 한 자리에 둔다.
//
// 왜 있나(운영자 오더 2026-09-07, checklist 12번). 외국인이 계약 내용을 이해해야 하는데,
// 번역본에 서명을 받으면 "번역이 달랐다"가 곧 분쟁이 된다. 그래서 **서명은 한국어 정본에만**
// 받고 번역본은 참고용으로만 보여준다. 이 파일은 그 번역본이 무엇인지를 정하는 유일한 자리다.
//
// 구조 규칙 넷.
//   1. **열쇠가 한국어 문장 자체다.** 항목 번호나 인덱스로 짝을 맞추면 운영자가 조항을 하나
//      끼워 넣는 순간 그 아래 번역이 통째로 밀린다. 문장을 열쇠로 두면 순서가 바뀌어도 안 흔들리고,
//      원문을 고치면 그 항목만 저절로 '번역 없음'이 된다 — 드리프트 감지가 곧 키 불일치다.
//   2. **빈 항목을 감추지 않는다.** 번역이 없는 문장은 한국어 원문을 그 자리에 그대로 남긴다.
//      감추면 "3조 2항"이 번역본에서 다른 줄을 가리키게 되어 조항 번호 대응이 깨진다.
//      원문으로 남은 개수는 fallbackCount 로 세어 박제와 편집기가 같은 숫자를 본다.
//   3. **절을 통째로 감추는 길이 없다.** 위와 같은 이유다. 이 파일에 그런 함수를 만들지 마라.
//   4. **고아(원문에서 사라진 번역)는 세기만 하고 안 지운다.** 운영자가 조항을 잠깐 고쳤다가
//      되돌릴 수 있고, 그때 손번역이 살아 있어야 한다. 저장 병합에 삭제 경로를 두지 않는 것으로
//      구조가 그것을 진다(lib/signDocuments 의 mergeSignDocuments 와 같은 규칙).
//
// 언어 코드는 lib/signGuideText 의 SignLang 을 재사용한다. 안내 언어와 번역 언어가 갈리면
// 발급 피커에서 고른 언어의 번역본이 없는 상태가 생긴다. **ko 는 정본이라 번역 대상이 아니다.**

import { type SignLang, SIGN_LANGS } from '@/lib/signGuideText'
import type { ContractTemplate, SubLeaseAddendum } from '@/lib/contract'

/** 번역 대상 언어. 한국어는 정본이므로 여기서 빠진다. */
export type TranslationLang = Exclude<SignLang, 'ko'>

/** SIGN_LANGS 에서 파생한다 — 안내 언어가 늘면 번역 언어도 저절로 따라온다. */
export const TRANSLATION_LANGS: readonly TranslationLang[] =
  SIGN_LANGS.filter((l): l is TranslationLang => l !== 'ko')

/** 화이트리스트 파서 — 저장값·폼 입력은 외부 데이터다. ko 는 통과시키지 않는다. */
export function asTranslationLang(v: unknown): TranslationLang | undefined {
  return typeof v === 'string' && (TRANSLATION_LANGS as readonly string[]).includes(v)
    ? (v as TranslationLang)
    : undefined
}

/** 한 언어의 번역 상태. dict 의 열쇠는 한국어 원문 문장 그 자체다. */
export type ContractTranslationLangEntry = {
  /** 공개 여부. 미완인 언어를 내보낼지 운영자가 정한다 — 꺼져 있으면 해석 결과가 null 이다. */
  published: boolean
  dict: Record<string, string>
}

/** Property.contractTranslations 의 저장 모양. */
export type ContractTranslations = {
  enabled: boolean
  langs: Partial<Record<TranslationLang, ContractTranslationLangEntry>>
}

/** 아직 손댄 적 없는 영업장의 상태. null 저장값과 **뜻이 같다**(둘 다 해석 결과가 null). */
export const EMPTY_CONTRACT_TRANSLATIONS: ContractTranslations = { enabled: false, langs: {} }

/**
 * 저장된 Json 을 안전하게 읽는다. 모양이 아닌 것은 버린다(부분·구버전·오염 안전).
 *
 * 문법은 lib/contractFieldOverrides 의 parse 와 같다 — 화이트리스트 키만, 타입을 통과한 것만.
 * 빈 문자열 번역은 버린다. 빈 칸은 '아직 번역 안 함'이라, 남겨 두면 fallbackCount 가 거짓말을 한다.
 */
export function parseContractTranslations(raw: unknown): ContractTranslations {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { enabled: false, langs: {} }
  const src = raw as { enabled?: unknown; langs?: unknown }
  const enabled = src.enabled === true
  const langs: Partial<Record<TranslationLang, ContractTranslationLangEntry>> = {}

  if (src.langs && typeof src.langs === 'object' && !Array.isArray(src.langs)) {
    for (const [rawLang, rawEntry] of Object.entries(src.langs as Record<string, unknown>)) {
      const lang = asTranslationLang(rawLang)
      if (!lang || !rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) continue
      const e = rawEntry as { published?: unknown; dict?: unknown }
      const dict: Record<string, string> = {}
      if (e.dict && typeof e.dict === 'object' && !Array.isArray(e.dict)) {
        for (const [k, v] of Object.entries(e.dict as Record<string, unknown>)) {
          if (typeof k !== 'string' || !k.trim()) continue
          if (typeof v !== 'string' || !v.trim()) continue
          dict[k] = v
        }
      }
      langs[lang] = { published: e.published === true, dict }
    }
  }
  return { enabled, langs }
}

// ── 번역 대상 문자열 ────────────────────────────────────────────────
//
// 편집기가 펼치는 목록이자 사전의 열쇠 집합이다. **두 벌을 만들지 마라** — 편집기가 보여준 칸과
// 해석이 세는 칸이 갈리면 "번역 3/5" 인데 종이에는 넷이 원문으로 남는 상태가 된다.

/** 한 줄의 성격. 편집기가 원문 위에 무엇인지 적어 주는 데 쓴다. */
export type TranslationLineKind = 'title' | 'sectionTitle' | 'item' | 'oath'

export type TranslationSourceLine = {
  kind: TranslationLineKind
  /** 한국어 원문. 그대로 사전의 열쇠다. */
  text: string
  /** 절 제목·항목일 때 그 절의 순번(0부터). 편집기가 묶어 보여주는 데 쓴다. */
  sectionIndex?: number
}

/**
 * 한국어 템플릿에서 번역할 문자열을 **종이 순서대로** 뽑는다(제목 · 절 제목 · 항목 · 서약문).
 *
 * 같은 문장이 두 번 나오면 첫 자리만 남긴다. 열쇠가 문장이라 번역도 하나뿐이고, 칸을 두 번
 * 세우면 같은 열쇠에 값을 두 번 쓰게 되어 나중 것이 앞 것을 조용히 덮는다.
 * 빈 문자열은 번역할 것이 없어 뺀다 — 해석 쪽은 그 자리를 그대로 두므로 줄 수는 안 어긋난다.
 */
export function translationSourceLines(template: ContractTemplate): TranslationSourceLine[] {
  const out: TranslationSourceLine[] = []
  const seen = new Set<string>()
  const push = (kind: TranslationLineKind, text: string, sectionIndex?: number) => {
    if (typeof text !== 'string' || !text.trim() || seen.has(text)) return
    seen.add(text)
    out.push(sectionIndex === undefined ? { kind, text } : { kind, text, sectionIndex })
  }

  push('title', template.title)
  const sections = Array.isArray(template.sections) ? template.sections : []
  sections.forEach((s, i) => {
    push('sectionTitle', s?.title, i)
    const items = Array.isArray(s?.items) ? s.items : []
    for (const line of items) push('item', line, i)
  })
  push('oath', template.oathText)
  return out
}

// ── 해석 ────────────────────────────────────────────────────────────

/** 한 언어의 해석 완료본. 사전 전체가 아니라 **결과물**이라 그대로 박제할 수 있다. */
export type ResolvedContractTranslation = {
  lang: TranslationLang
  title: string
  sections: { title: string; items: string[] }[]
  oathText: string
  /** 사전에 값이 없어 한국어 원문이 그대로 남은 문자열 수. */
  fallbackCount: number
  /** 번역 대상 문자열 총수. fallbackCount 만으로는 그 종이가 얼마나 번역됐는지 알 수 없다. */
  totalCount: number
}

/**
 * 그 언어의 해석 완료본을 만든다. **번역이 없는 문자열은 한국어 원문을 그 자리에 그대로 둔다.**
 *
 * null 을 돌려주는 셋 — 전부 '이 계약서에는 번역본이 없다'는 같은 말이다.
 *   · 저장값이 없거나(null) 운영 스위치가 꺼짐
 *   · 그 언어를 아직 안 만듦
 *   · 그 언어가 미공개(published=false) — 미완인 번역을 내보낼지는 운영자가 정한다
 *
 * 부르는 쪽은 null 하나만 보면 된다. 그것이 "끈 영업장은 이 기능 전과 문자 단위로 같다"를
 * 한 줄로 지키는 방법이다.
 */
export function resolveContractTranslation(
  raw: unknown,
  template: ContractTemplate,
  lang: TranslationLang,
): ResolvedContractTranslation | null {
  const parsed = parseContractTranslations(raw)
  if (!parsed.enabled) return null
  const entry = parsed.langs[lang]
  if (!entry || !entry.published) return null

  const dict = entry.dict
  // 총수·미번역 수는 편집기가 세는 것과 **같은 집합**에서 나온다(translationSourceLines).
  const lines = translationSourceLines(template)
  let fallbackCount = 0
  for (const l of lines) if (dict[l.text] === undefined) fallbackCount++

  // 문자열 치환은 사전 조회 하나뿐이다. {{변수}} 는 원문 모양 그대로 남는다 — 이 함수는
  // 무엇을 보여줄지를 정하고, 변수 값을 넣는 것은 종이를 그리는 쪽의 일이다.
  const tr = (s: string): string => (typeof s === 'string' ? dict[s] ?? s : '')
  const sections = (Array.isArray(template.sections) ? template.sections : []).map(s => ({
    title: tr(s?.title),
    // 빈 항목도 자리를 지킨다 — 감추면 조항 번호 대응이 깨진다.
    items: (Array.isArray(s?.items) ? s.items : []).map(tr),
  }))

  return {
    lang,
    title: tr(template.title),
    sections,
    oathText: tr(template.oathText),
    fallbackCount,
    totalCount: lines.length,
  }
}

/**
 * 박제된 해석 완료본을 안전하게 읽는다. **다시 해석하지 않는다.**
 *
 * 링크 스냅샷·서명 동결본에 얼어 있는 JSON 이 입력이다. 여기서 사전을 다시 조회하면 입주자가
 * 본 문안과 지금 화면이 갈리고, 그 순간 박제는 증거이기를 그만둔다. 그래서 이 함수가 하는 일은
 * 모양 검사뿐이고, 값은 얼어 있는 그대로 나간다.
 *
 * 모양이 아닌 것은 null 이다(파서 정본 parseContractTranslations 와 같은 규칙) — 그때는
 * 번역본이 없는 것으로 다뤄져 카드도 안 서고 우선 조항도 안 붙는다.
 */
export function asResolvedContractTranslation(raw: unknown): ResolvedContractTranslation | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const s = raw as {
    lang?: unknown; title?: unknown; sections?: unknown; oathText?: unknown
    fallbackCount?: unknown; totalCount?: unknown
  }
  const lang = asTranslationLang(s.lang)
  if (!lang) return null
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  const cnt = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)
  // 절·항목은 자리를 그대로 지킨다 — 빈 줄을 걷으면 조항 번호 대응이 깨진다(위 구조 규칙 2).
  const sections = (Array.isArray(s.sections) ? s.sections : []).map(x => {
    const sec = (x && typeof x === 'object' && !Array.isArray(x) ? x : {}) as { title?: unknown; items?: unknown }
    return {
      title: str(sec.title),
      items: (Array.isArray(sec.items) ? sec.items : []).map(str),
    }
  })
  return {
    lang,
    title: str(s.title),
    sections,
    oathText: str(s.oathText),
    fallbackCount: cnt(s.fallbackCount),
    totalCount: cnt(s.totalCount),
  }
}

/**
 * 그 언어의 번역 진행 — 발급 피커가 언어 옆에 적는 캡션의 원천이다.
 *
 * 세는 집합이 편집기·해석과 **같다**(translationSourceLines). 세 곳이 각자 세면 피커는
 * "번역 26/26" 이라고 하는데 종이에는 원문이 넷 남는 상태가 된다.
 *
 * 고르는 것을 막는 데 쓰지 마라(운영자 오더 2026-09-08) — 미완인 언어로 보낼지는 운영자가
 * 정한다. 이 값은 그 판단에 필요한 사실을 눈앞에 두는 것이 전부다.
 */
export function translationProgress(
  raw: unknown,
  template: ContractTemplate,
  lang: TranslationLang,
): { total: number; done: number; published: boolean; hasEntry: boolean } {
  const entry = parseContractTranslations(raw).langs[lang]
  const dict = entry?.dict ?? {}
  const lines = translationSourceLines(template)
  let done = 0
  for (const l of lines) if (dict[l.text] !== undefined) done++
  return { total: lines.length, done, published: entry?.published === true, hasEntry: !!entry }
}

/**
 * 원문에서 사라진 번역 열쇠. 운영자가 조항을 고치면 그 항목의 손번역이 여기로 떨어진다.
 *
 * **지우지 않는다.** 조항을 되돌리면 번역이 저절로 되살아나야 하고, 지우면 그 되돌림이
 * 손번역을 다시 치는 일이 된다. 편집기는 "고아 n건"으로 알리기만 한다.
 */
export function orphanTranslationKeys(
  raw: unknown,
  template: ContractTemplate,
  lang: TranslationLang,
): string[] {
  const entry = parseContractTranslations(raw).langs[lang]
  if (!entry) return []
  const live = new Set(translationSourceLines(template).map(l => l.text))
  return Object.keys(entry.dict).filter(k => !live.has(k))
}

// ── 저장 병합 ───────────────────────────────────────────────────────
//
// 두 출구가 나뉜 이유. 운영 스위치는 §27.1 즉시 저장이고 사전은 폼 저장이라, 한 함수로 묶으면
// 토글 한 번이 편집 중인 사전을 통째로 실어 보낸다. **저장이 남의 언어를 건드리지 않는다**는
// 규칙도 여기서 진다 — 들어온 언어 하나만 덮는다.

/** 운영 여부만 바꾼다. 언어 사전은 한 글자도 안 건드린다. */
export function withTranslationEnabled(stored: unknown, enabled: boolean): ContractTranslations {
  return { ...parseContractTranslations(stored), enabled }
}

/**
 * 한 언어의 공개 여부·사전을 덮는다.
 *
 * 사전 병합에 **삭제 경로가 없다** — payload 에 없는 열쇠(고아)는 그대로 남는다. 값이 빈
 * 문자열로 온 것만 그 열쇠를 걷는다(운영자가 칸을 비운 것 = 번역 취소). 화면이 무엇을 보내든
 * 서버가 안 보이는 번역을 지우지 않는다는 뜻이다.
 */
export function mergeTranslationLang(
  stored: unknown,
  lang: TranslationLang,
  patch: { published?: boolean; dict?: Record<string, unknown> },
): ContractTranslations {
  const base = parseContractTranslations(stored)
  const prev = base.langs[lang] ?? { published: false, dict: {} }
  const dict: Record<string, string> = { ...prev.dict }

  if (patch.dict) {
    for (const [k, v] of Object.entries(patch.dict)) {
      if (typeof k !== 'string' || !k.trim()) continue
      if (typeof v !== 'string' || !v.trim()) { delete dict[k]; continue }
      dict[k] = v
    }
  }
  return {
    ...base,
    langs: {
      ...base.langs,
      [lang]: { published: patch.published ?? prev.published, dict },
    },
  }
}

// ── 우선 조항 ───────────────────────────────────────────────────────
//
// 번역본이 실리는 계약서에만 코드가 붙이는 절이다. 추가 호실 특약·요금 절·거주 호실 일정과
// 같은 방식이다(lib/contract 의 appendSubLeaseAddendum 으로 절 배열 뒤에 선다).
//
// **운영자가 편집하는 본문이 아니다.** 형제 셋은 영업장이 문안을 고칠 수 있지만 이 절은
// 고정이다 — 지워지면 "한국어 원본이 우선한다"는 근거가 종이 어디에도 남지 않는다.
// 그리고 template 객체에 주입하지 않는다. 본문 템플릿은 printedFacts 의 통비교 축이라,
// 코드가 만든 절을 그 안에 섞으면 조항을 한 글자도 안 고친 계약서가 통째로 드리프트로 뜬다.

export const TRANSLATION_NOTICE_ADDENDUM: SubLeaseAddendum = {
  title: '번역본과 언어',
  items: [
    '외국어 번역본은 이해를 돕기 위한 참고용이며 계약 내용은 한국어 원본에 따릅니다. 뜻이 다를 때는 한국어 원본이 우선합니다.',
  ],
}

/**
 * 번역본 쪽에 서는 같은 뜻의 고지. **코드 사전이다** — 운영자 입력이 아니다.
 *
 * lib/signGuideText 와 같은 문법으로 Record 전량 선언한다. Partial 금지 — 언어가 늘었는데
 * 이 문안을 안 채우면 tsc 가 컴파일을 막는다. 그것이 누락 감지망이다.
 * 우선 조항을 운영자 사전에 맡기면 번역이 비었을 때 이 고지만 한국어로 남는데, 그러면
 * 정작 "한국어가 우선한다"는 말을 못 읽는 사람에게 전달되지 않는다.
 */
export const TRANSLATION_NOTICE: Record<SignLang, string> = {
  ko: '이 번역본은 참고용입니다. 계약 내용은 한국어 원본에 따르며 뜻이 다를 때는 한국어 원본이 우선합니다.',
  en: 'This translation is for reference only. The Korean original governs and prevails.',
  vi: 'Bản dịch chỉ để tham khảo. Bản gốc tiếng Hàn được ưu tiên.',
  bn: 'এই অনুবাদ শুধু সহায়তার জন্য। কোরিয়ান মূল চুক্তি প্রাধান্য পাবে।',
  ru: 'Перевод справочный. Приоритет имеет корейский оригинал.',
  ja: '本翻訳は参考用です。韓国語原本が優先します。',
  zh: '本译文仅供参考，以韩文原本为准。',
  zht: '本譯文僅供參考，以韓文原本為準。',
}

/**
 * 그 언어가 자기를 부르는 이름. 번역본 카드 머리에 이것을 단다.
 *
 * lib/signGuideText 의 SIGN_LANG_LABEL 을 쪼개 쓰지 않는다. 그쪽은 '벵골어(방글라데시) বাংলা'
 * 처럼 한국어 설명이 앞서는 **운영자용** 라벨이라, 번역본을 읽는 사람에게는 자기 언어를 찾는
 * 단서가 뒤에 숨는다. 쪼개는 규칙을 만들면 라벨 문구가 바뀔 때마다 조용히 어긋난다.
 *
 * Record 전량 선언이다(TRANSLATION_NOTICE 와 같은 이유) — 언어가 늘었는데 이름을 안 채우면
 * tsc 가 컴파일을 막는다.
 */
export const TRANSLATION_LANG_ENDONYM: Record<TranslationLang, string> = {
  en: 'English',
  vi: 'Tiếng Việt',
  bn: 'বাংলা',
  ru: 'Русский',
  ja: '日本語',
  zh: '简体中文',
  zht: '繁體中文',
}

/**
 * 번역본 머리에 서는 고지 — 한국어 정본 줄이 앞서고 그 언어 줄이 뒤따른다.
 *
 * 병기 순서는 lib/signGuideText 의 bi 와 같다. 분쟁 시 "무엇을 안내받았나"의 정본이 한국어로
 * 남아야 하고, 운영자가 전화로 같은 화면을 읽으며 안내할 수 있어야 한다.
 */
export function translationNoticeBi(lang: TranslationLang): string {
  return `${TRANSLATION_NOTICE.ko}\n${TRANSLATION_NOTICE[lang]}`
}

/**
 * 이 계약서에 우선 조항을 붙일지. **번역본이 없으면 null 이다.**
 *
 * null 이면 appendSubLeaseAddendum 이 받은 절 배열을 그대로 돌려주므로, 번역본을 안 쓰는
 * 영업장의 계약서 렌더가 이 기능 전과 문자 단위로 같다. 판정을 부르는 쪽에 흩지 말고
 * 이 한 자리에 둔다 — 화면과 인쇄가 다른 조건으로 붙이면 종이와 미리보기가 갈린다.
 */
export function contractTranslationAddendum(
  translation: ResolvedContractTranslation | null | undefined,
): SubLeaseAddendum | null {
  return translation ? TRANSLATION_NOTICE_ADDENDUM : null
}
