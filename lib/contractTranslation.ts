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
import { stripClauseBullet, buildRefundClause, type ContractTemplate, type SubLeaseAddendum } from '@/lib/contract'

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

/**
 * 한 줄의 성격. 편집기가 원문 위에 무엇인지 적어 주는 데 쓴다.
 *
 * 'var' 만 규칙이 다르다. 다른 넷은 **빈 칸 = 한국어 원문**인데 'var' 는 **빈 칸 = 권장 번역**이다
 * (아래 '변수 줄' 절). 화면이 그 차이를 말해야 하므로 성격이 따로 서 있다.
 */
export type TranslationLineKind = 'title' | 'sectionTitle' | 'item' | 'oath' | 'var'

export type TranslationSourceLine = {
  kind: TranslationLineKind
  /** 한국어 원문. 그대로 사전의 열쇠다. */
  text: string
  /** 절 제목·항목일 때 그 절의 순번(0부터). 편집기가 묶어 보여주는 데 쓴다. */
  sectionIndex?: number
}

/**
 * 그 문자열이 품은 자리표시자({{...}}) — 순서대로, 중복 없이.
 *
 * **왜 정본이 하나여야 하나(운영자 오더 2026-09-08).** 번역기에 문장을 넘기면 `{{청소비조항}}`
 * 이 통째로 번역되거나 조용히 사라진다. 그러면 종이에 값이 안 들어가고, 그 실패는 아무 소리도
 * 내지 않는다 — 자리표시자가 글자 그대로 뜨거나 문장에 구멍이 뚫린 채 계약서가 나간다.
 * 붙여넣기·편집기·저장 병합이 **이 함수 하나**를 봐야 세 곳의 판정이 갈리지 않는다.
 */
export function translationPlaceholders(text: string): string[] {
  if (typeof text !== 'string') return []
  const out: string[] = []
  for (const m of text.matchAll(/\{\{([^}]+)\}\}/g)) {
    const key = `{{${String(m[1]).trim()}}}`
    if (!out.includes(key)) out.push(key)
  }
  return out
}

/** 번역문이 잃어버린 자리표시자. 빈 배열이면 통과다(열쇠에 자리표시자가 없어도 빈 배열). */
export function missingTranslationPlaceholders(source: string, translated: string): string[] {
  const has = new Set(translationPlaceholders(translated))
  return translationPlaceholders(source).filter(p => !has.has(p))
}

/** 열쇠 하나와 그 번역문이 잃은 자리표시자. 거부 사유를 사람이 읽을 문장으로 만드는 재료다. */
export type TranslationPlaceholderMiss = {
  /** 한국어 원문(사전의 열쇠). */
  text: string
  /** 번역문에서 사라진 자리표시자. */
  placeholders: string[]
}

/**
 * 그 줄에 번역할 글자가 있는가. 자리표시자와 글머리를 걷고 남는 것이 있어야 한다.
 *
 * `{{청소비조항}}` 처럼 줄 전체가 자리표시자인 항목이 실재한다(제기역점 실측 2026-09-08).
 * 그 줄은 종이에 코드가 만든 한국어 문장이 통째로 들어가는 자리라 번역할 글자가 애초에 없다.
 * 칸을 세우면 운영자가 거기에 번역을 적고, 그 번역은 자리표시자를 잃어 값이 안 들어간다.
 */
function hasTranslatableText(text: string): boolean {
  return stripClauseBullet(text).replace(/\{\{[^}]+\}\}/g, '').trim() !== ''
}

// ── 변수 줄(환불 규정) ──────────────────────────────────────────────
//
// 왜 있나(운영자 오더 2026-09-08). 환불 규정은 절도 항목도 아니고 **변수값**이다 —
// 본문에는 `{{환불규정}}` 자리만 있고 문장은 코드가 만든다(lib/contract 의 buildRefundClause,
// 종이가 lib/contractPrintHtml 의 vars 로 넣는다). 그래서 번역 대상 목록에 문장으로 서 있지
// 않았고, 다 번역한 계약서에서도 그 한 문단만 한국어로 남았다.
//
// **막지 않고 유도한다**(운영자 오더 — "우선 추천이나 유도하도록 하고 만약 다르게 한다면 경고").
// 권장 문안을 코드가 들고 있고 빈 칸이면 그것이 쓰인다. 운영자가 제 문안을 적으면 그대로 나가되
// 경고가 선다. 미리 채우지 않는 이유는 검토 없이 저장되기 때문이다.
//
// **이 줄만 '빈 칸 = 권장 번역'이다.** 다른 줄은 빈 칸이면 한국어 원문이 남는다. 규칙이 갈리므로
// 화면이 그 차이를 라벨과 캡션으로 말해야 한다(TranslationLineKind 의 'var').

/** 종이가 이 문장을 넣는 자리. 본문에 이 자리가 없으면 토글을 켜도 아무 데도 안 나온다. */
export const REFUND_VAR_PLACEHOLDER = '{{환불규정}}'

/** 그 변수의 이름 — 박제 표식(customVars)과 종이 vars 의 열쇠가 같은 문자열이다. */
export const REFUND_VAR_NAME = '환불규정'

/** 이 줄의 사전 열쇠. 다른 줄과 같은 규칙이다 — 열쇠는 한국어 원문 문자열 그 자체다. */
export function refundTranslationKey(): string {
  return buildRefundClause()
}

/**
 * 권장 번역. **코드 사전이다** — 운영자 입력이 아니다.
 *
 * 공정거래위원회 기준 문구라 뜻이 어긋나면 분쟁에서 설명 부담이 생긴다. 그래서 문안을 코드가
 * 들고 있고, 빈 칸이면 이것이 쓰인다. ko 는 원문(buildRefundClause)이라 여기 없다.
 *
 * Record 전량 선언이다(TRANSLATION_NOTICE 와 같은 이유) — 언어가 늘었는데 문안을 안 채우면
 * tsc 가 컴파일을 막는다. 그것이 누락 감지망이다.
 */
export const RECOMMENDED_REFUND_TRANSLATION: Record<TranslationLang, string> = {
  en: 'Early move-out refund = total paid − (daily rate × days stayed) − penalty (10% of the remainder); daily rate = monthly fee / 30.',
  vi: 'Hoàn trả sớm = tổng đã trả − (phí ngày × số ngày ở) − phạt (10% phần còn lại); phí ngày = phí tháng / 30.',
  bn: 'ফেরত = মোট পরিশোধ − (দৈনিক হার × থাকার দিন) − জরিমানা (অবশিষ্টের ১০%); দৈনিক হার = মাসিক ফি / ৩০।',
  ru: 'Возврат = оплачено − (дневная ставка × прожитые дни) − неустойка (10% остатка); ставка = месячная плата / 30.',
  ja: '返金額 = 総支払額 −（1日利用料 × 実利用日数）− 違約金（残余金額の10%）、1日利用料 = 月額 / 30。',
  zh: '退款 = 总付款额 −（每日费用 × 实际入住天数）− 违约金（剩余金额的10%）；每日费用 = 月费 / 30。',
  zht: '退款 = 總付款額 −（每日費用 × 實際入住天數）− 違約金（剩餘金額的10%）；每日費用 = 月費 / 30。',
}

/**
 * 그 값이 '직접 번역'인가 — 값이 있고 권장 문안과 다르다.
 *
 * **글자 비교·유사도 판정을 만들지 마라**(운영자 오더). 여기 있는 것은 권장 문안과의 동일성
 * 하나뿐이다. 뜻이 얼마나 비슷한지 재려 들면 오탈자마다 소음이 나고, 정작 뜻이 뒤집힌 번역은
 * 글자가 비슷해 통과한다.
 *
 * 편집기 경고·저장 비우기·박제 표식이 **이 함수 하나**를 본다. 세 곳이 각자 재면 화면은
 * "권장과 다르다"고 경고하는데 저장은 권장과 같다고 칸을 비우는 상태가 된다.
 */
export function isCustomRefundTranslation(lang: TranslationLang, value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false
  return value.trim() !== RECOMMENDED_REFUND_TRANSLATION[lang]
}

/**
 * 본문 어딘가에 `{{환불규정}}` 자리가 있는가.
 *
 * **걷어낸 줄까지 본다.** 줄 전체가 자리표시자인 항목은 번역 대상에서 빠지지만
 * (hasTranslatableText) 종이에는 그 값이 그대로 들어간다. 대상 목록만 훑으면 그런 본문에서
 * 칸이 안 서고, 종이의 그 문단만 영영 한국어로 남는다.
 */
function hasRefundVarSlot(template: ContractTemplate, addenda?: readonly SubLeaseAddendum[]): boolean {
  const all: unknown[] = [template?.title, template?.oathText]
  for (const s of Array.isArray(template?.sections) ? template.sections : []) {
    all.push(s?.title, ...(Array.isArray(s?.items) ? s.items : []))
  }
  for (const a of addenda ?? []) {
    if (!a) continue
    all.push(a.title, ...(Array.isArray(a.items) ? a.items : []))
  }
  return all.some(s => typeof s === 'string' && translationPlaceholders(s).includes(REFUND_VAR_PLACEHOLDER))
}

/**
 * 번역본이 `{{환불규정}}` 자리에 넣을 값 — **종이와 같은 모양**이다.
 *
 * 앞 한 칸이 문장을 잇는다(lib/contractPrintHtml 의 `' ' + buildRefundClause()`). 칸을 빼면
 * 앞 문장에 그대로 붙어 "…따릅니다.Early move-out refund" 가 된다. 조판 규칙이 두 벌이면
 * 종이와 카드가 그 한 칸에서 갈린다.
 */
function refundVarValue(text: string): string {
  return ' ' + text
}

/**
 * 한국어 템플릿에서 번역할 문자열을 **종이 순서대로** 뽑는다(제목 · 절 제목 · 항목 · 서약문).
 *
 * 같은 문장이 두 번 나오면 첫 자리만 남긴다. 열쇠가 문장이라 번역도 하나뿐이고, 칸을 두 번
 * 세우면 같은 열쇠에 값을 두 번 쓰게 되어 나중 것이 앞 것을 조용히 덮는다.
 * 빈 문자열은 번역할 것이 없어 뺀다 — 해석 쪽은 그 자리를 그대로 두므로 줄 수는 안 어긋난다.
 * 자리표시자뿐인 줄도 같은 이유로 뺀다(hasTranslatableText).
 *
 * @param addenda 그 목록에 함께 넣을 가변 절(추가 호실 · 요금 · 거주 호실 일정). 본문 절 **뒤**에
 *   종이 순서대로 선다. 넘기는 문안은 **치환 전 저장 문안**이다 — 자리표시자를 품은 그대로가
 *   열쇠다(lib/contract 의 contractAddendaForTranslation 이 그 목록의 정본이다).
 *   무엇을 넘길지는 부르는 쪽이 정한다. 편집기는 영업장이 쓸 수 있는 전부를, 발급·피커는
 *   그 계약에 실릴 것만 넘긴다 — **세는 함수는 하나이고 입력만 다르다.**
 * @param refundClauseInContract 환불 조항 자동 표시 토글. 종이가 그 문장을 넣는 조건과
 *   **같은 조건**일 때만 변수 줄이 선다(토글 + 본문에 자리). 조건이 갈리면 종이에 안 실리는
 *   문장을 번역하라고 칸이 서거나, 실리는데 칸이 안 선다.
 */
export function translationSourceLines(
  template: ContractTemplate,
  addenda?: readonly SubLeaseAddendum[],
  refundClauseInContract?: boolean,
): TranslationSourceLine[] {
  const out: TranslationSourceLine[] = []
  const seen = new Set<string>()
  const push = (kind: TranslationLineKind, text: string, sectionIndex?: number) => {
    if (typeof text !== 'string' || !text.trim() || seen.has(text)) return
    if (!hasTranslatableText(text)) return
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
  // 가변 절 — 절 순번은 본문 절 뒤로 이어진다. 종이가 절을 그 자리에 붙이기 때문이다
  // (lib/contract 의 appendSubLeaseAddendum). 서약문은 절이 아니라 맨 끝에 그대로 선다.
  ;(addenda ?? []).forEach((a, k) => {
    if (!a) return
    push('sectionTitle', a.title, sections.length + k)
    for (const line of Array.isArray(a.items) ? a.items : []) push('item', line, sections.length + k)
  })
  push('oath', template.oathText)
  // 변수 줄은 맨 끝이다. 절이 아니라 조항 **안에** 들어가는 값이라 종이 순서에 제 자리가 없고,
  // 절 사이에 끼우면 그 뒤 줄이 밀려 복사·되붙이기의 줄 대조가 흔들린다.
  if (refundClauseInContract && hasRefundVarSlot(template, addenda)) push('var', refundTranslationKey())
  return out
}

// ── 외부 번역기 왕복 ────────────────────────────────────────────────
//
// 왜 있나(운영자 오더 2026-09-08). 본문이 4절 23항목이라 한 언어당 26칸 안팎이고 8언어면
// 200칸이 넘는다. 손으로 다 치는 구조면 영업장이 끝내 안 쓴다. 그래서 전문을 한 번에 복사해
// 번역기에 붙이고, 돌아온 결과를 줄 맞춰 되붙이는 길을 낸다.
//
// **짝을 맞추는 근거가 줄 번호뿐이다.** 한 줄이라도 어긋나면 번역이 통째로 밀려 엉뚱한 조항에
// 들어간다. 종이에 실릴 문안이 밀리는 것이라 부분 반영이 가장 나쁜 결말이다. 그래서 개수가
// 다르면 **아무것도 안 채우고 거부한다.**
//
// 줄바꿈을 품은 원문(2026-09-08 실측). 기본 템플릿 '3. 생활 수칙'의 항목 둘에 문장 안 줄바꿈이
// 있다(lib/contract). 그대로 내보내면 한 문자열이 두 줄을 차지해 줄 대조가 아예 성립하지 않는다.
// 그래서 **복사할 때 문장 안 줄바꿈을 한 칸으로 눕힌다** — 한 문자열이 반드시 한 줄이 되게 만드는
// 것이 이 왕복의 전제다. 잃는 것은 참고용 번역본 안의 줄바꿈 하나뿐이고, 얻는 것은 조항이
// 밀리지 않는다는 보장이다. 열쇠는 여전히 원문 문자열 그 자체라 되붙인 값은 제자리에 들어간다.

/**
 * 복사·대조에 쓰는 한 줄. 문장 안 줄바꿈을 앞뒤 들여쓰기까지 묶어 한 칸으로 눕히고 앞뒤를 다듬는다.
 *
 * **반환값에 줄바꿈이 없다는 것이 이 함수의 계약이다.** 줄 대조가 그 위에 선다.
 */
export function translationCopyLine(text: string): string {
  return typeof text === 'string' ? text.replace(/\s*[\r\n]+\s*/g, ' ').trim() : ''
}

/**
 * 그 언어의 번역 대상 전문 — 종이 순서대로 한 줄에 하나.
 *
 * 번호·머리말·빈 줄을 넣지 마라. 줄 수가 곧 열쇠라 장식 한 줄이 붙는 순간 되붙이기가 거부된다.
 * 기대 줄 수도 여기서 나온다(applyTranslationPaste 가 같은 lines 를 센다) — 두 벌로 세면
 * "26줄이어야 합니다"라고 적어 놓고 27줄을 복사해 주는 상태가 된다.
 */
export function translationCopyText(lines: readonly TranslationSourceLine[]): string {
  return lines.map(l => translationCopyLine(l.text)).join('\n')
}

/**
 * 되붙이기 판정. 거부는 채울 값을 아예 안 만든다 — 부분 반영이 없다는 뜻이다.
 *
 * 거부 사유가 둘이고 한 모양에 담긴다. 줄 수가 어긋나면 expected ≠ got 이고, 줄 수는 맞는데
 * 번역이 자리표시자를 잃었으면 expected = got 에 missing 이 찬다. 화면이 그 둘을 갈라 말한다.
 */
export type TranslationPasteResult =
  | { ok: false; expected: number; got: number; missing: TranslationPlaceholderMiss[] }
  | { ok: true; filled: Record<string, string>; filledCount: number; blankCount: number; sameCount: number }

/**
 * 붙여넣은 덩어리를 줄 맞춰 판정해 **채울 값만** 돌려준다.
 *
 * **저장하지 않는다.** 이 함수도, 부르는 화면도 마찬가지다 — 운영자가 눈으로 보고 저장 버튼을
 * 눌러야 반영이다. 기계 번역이 조항 자리를 옮겨 놓은 것을 사람이 한 번은 봐야 한다.
 *
 * 건너뛰는 줄 둘.
 *   · **빈 줄** — 번역기가 못 옮긴 줄을 빈 줄로 두는 일이 잦다. 그것으로 이미 있는 번역을
 *     지우면 손번역이 기계 번역의 실수로 날아간다. 그 항목의 기존 값을 그대로 둔다.
 *   · **원문과 글자가 같은 줄** — 번역이 아니라 원문이 되돌아온 것이다. 채워 두면 '번역 없음'
 *     폴백과 구분이 안 되어 진행 계수가 거짓말을 한다(fallbackCount 는 값이 없는 줄만 센다).
 *
 * 꼬리 개행은 잡음이라 걷는다. 클립보드가 덧붙이는 것이라 거부의 사유가 못 된다. 다만 마지막
 * 줄이 실제로 비어 돌아온 경우도 함께 걷혀 개수가 모자라는데, 그때는 **거부**로 착지하므로
 * 안전한 쪽이다(모르는 채 덜 채우는 일이 없다).
 *
 * 자리표시자를 잃은 줄이 하나라도 있으면 **통째로 거부한다.** 줄 수 거부와 같은 클래스다 —
 * 번역기가 `{{청소비조항}}` 을 번역해 버리면 그 조항은 종이에서 값을 잃는데, 채워 두면
 * 저장이 다시 거부하고 운영자는 그때 가서 어느 칸인지 다시 찾아야 한다. 여기서 어느 줄이
 * 무엇을 잃었는지 말해 주는 편이 고치기 쉽다.
 */
export function applyTranslationPaste(
  lines: readonly TranslationSourceLine[],
  raw: string,
): TranslationPasteResult {
  const body = (typeof raw === 'string' ? raw : '')
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+$/gm, '')
    .replace(/\n+$/, '')
  const got = body === '' ? [] : body.split('\n')
  if (got.length !== lines.length) return { ok: false, expected: lines.length, got: got.length, missing: [] }

  const filled: Record<string, string> = {}
  let blankCount = 0
  let sameCount = 0
  lines.forEach((l, i) => {
    const v = (got[i] ?? '').trim()
    if (!v) { blankCount++; return }
    // 내보낸 그 줄과 견준다 — 원문을 눕힌 모양이 운영자가 번역기에 넘긴 실제 문자열이다.
    if (v === translationCopyLine(l.text)) { sameCount++; return }
    filled[l.text] = v
  })
  const missing = translationPlaceholderMisses(filled)
  if (missing.length > 0) return { ok: false, expected: lines.length, got: got.length, missing }
  return { ok: true, filled, filledCount: Object.keys(filled).length, blankCount, sameCount }
}

/**
 * 사전에서 자리표시자를 잃은 항목을 모은다. 되붙이기와 저장이 **이 함수 하나**를 본다 —
 * 두 곳이 각자 세면 붙여넣기는 통과시키고 저장은 거부하는(또는 그 반대) 상태가 된다.
 *
 * 빈 값은 번역 취소라 건너뛴다(그 열쇠를 걷는 것이지 잘못된 번역이 아니다).
 */
export function translationPlaceholderMisses(dict: Record<string, unknown>): TranslationPlaceholderMiss[] {
  const out: TranslationPlaceholderMiss[] = []
  for (const [text, v] of Object.entries(dict)) {
    if (typeof text !== 'string' || !text.trim()) continue
    if (typeof v !== 'string' || !v.trim()) continue
    const placeholders = missingTranslationPlaceholders(text, v)
    if (placeholders.length > 0) out.push({ text, placeholders })
  }
  return out
}

// ── 해석 ────────────────────────────────────────────────────────────

/** 한 언어의 해석 완료본. 사전 전체가 아니라 **결과물**이라 그대로 박제할 수 있다. */
export type ResolvedContractTranslation = {
  lang: TranslationLang
  title: string
  sections: { title: string; items: string[] }[]
  oathText: string
  /**
   * 이 계약서에 실린 가변 절의 번역(추가 호실 · 요금 · 거주 호실 일정). 문안은 **치환 전**이라
   * 그리는 쪽이 종이와 같은 vars 로 채운다.
   *
   * **비면 칸 자체가 없다**(옵셔널). 인쇄 사실 축이 이 객체를 통비교하는 JSON 이라, 특약이
   * 없을 때 빈 배열을 담으면 이미 나간 링크·발급본 전건이 내용 변화 없이 드리프트로 뜬다
   * (ContractData 의 조건부 담기·printedFacts 의 '없으면 축도 없다'와 같은 규칙이다).
   *
   * **그 계약에 실제로 실린 절만이다.** 조항 번호를 자리로 매기므로(appendSubLeaseAddendum),
   * 종이에 없는 절이 번역본에 서면 그 아래 번호가 통째로 밀려 증거가 거짓이 된다.
   */
  addenda?: { title: string; items: string[] }[]
  /**
   * 이 번역본이 조항 안 `{{변수}}` 자리에 덮어 쓸 값. 지금은 환불 규정 하나다.
   *
   * 본문 컴포넌트가 **종이 vars 위에** 이것을 얹는다 — 안 얹으면 번역본 안에서 그 문단만
   * 한국어로 남는다. 값은 종이와 같은 모양이라 앞 한 칸이 붙어 있다(refundVarValue).
   *
   * **비면 칸 자체가 없다**(옵셔널). addenda 칸과 같은 규칙이다 — 인쇄 사실 축이 이 객체를
   * 통비교하는 JSON 이라, 늘 담으면 이 칸을 모르는 옛 박제가 내용 변화 없이 드리프트로 뜬다.
   */
  vars?: { 환불규정: string }
  /**
   * 그중 운영자가 **직접 번역한** 변수 이름. 권장 문안을 그대로 쓴 것과 가르는 표식이다.
   *
   * 발급 상세가 이 표식으로 "환불 규정 직접 번역"을 한 줄 덧붙인다 — 나중에 "그 종이의
   * 환불 문구가 왜 공정위 기준과 다른가"를 물을 때 답이 박제 안에 있어야 한다.
   * 위와 같은 이유로 **비면 칸이 없다.**
   */
  customVars?: '환불규정'[]
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
 *
 * @param addenda **그 계약에 실린** 가변 절의 치환 전 문안. 넘긴 것만 번역본에 선다 —
 *   종이에 없는 절을 세우면 조항 번호가 밀린다(위 ResolvedContractTranslation 주석).
 * @param refundClauseInContract 그 계약서의 환불 조항 자동 표시 여부. 종이와 같은 조건일 때만
 *   변수 줄이 서고 vars 가 담긴다(translationSourceLines).
 */
export function resolveContractTranslation(
  raw: unknown,
  template: ContractTemplate,
  lang: TranslationLang,
  addenda?: readonly SubLeaseAddendum[],
  refundClauseInContract?: boolean,
): ResolvedContractTranslation | null {
  const parsed = parseContractTranslations(raw)
  if (!parsed.enabled) return null
  const entry = parsed.langs[lang]
  if (!entry || !entry.published) return null

  const dict = entry.dict
  // 총수·미번역 수는 편집기가 세는 것과 **같은 집합**에서 나온다(translationSourceLines).
  const lines = translationSourceLines(template, addenda, refundClauseInContract)
  let fallbackCount = 0
  // 변수 줄은 비어 있어도 한국어가 안 남는다 — 권장 번역이 그 자리에 선다. 폴백으로 세면
  // 다 번역한 종이가 영영 "원문 한 줄 남음"으로 보이고, 그 숫자가 박제에 그대로 얼어붙는다.
  for (const l of lines) if (l.kind !== 'var' && dict[l.text] === undefined) fallbackCount++

  // 문자열 치환은 사전 조회 하나뿐이다. {{변수}} 는 원문 모양 그대로 남는다 — 이 함수는
  // 무엇을 보여줄지를 정하고, 변수 값을 넣는 것은 종이를 그리는 쪽의 일이다.
  const tr = (s: string): string => (typeof s === 'string' ? dict[s] ?? s : '')
  const sections = (Array.isArray(template.sections) ? template.sections : []).map(s => ({
    title: tr(s?.title),
    // 빈 항목도 자리를 지킨다 — 감추면 조항 번호 대응이 깨진다.
    items: (Array.isArray(s?.items) ? s.items : []).map(tr),
  }))
  const live = (addenda ?? []).filter((a): a is SubLeaseAddendum => !!a)
  const addendaOut = live.map(a => ({
    title: tr(a.title),
    items: (Array.isArray(a.items) ? a.items : []).map(tr),
  }))

  // 변수 줄의 결과. **빈 칸이면 권장 번역이다** — 다른 줄과 규칙이 갈리는 유일한 자리다.
  // 줄이 안 섰으면(토글 꺼짐·본문에 자리 없음) 종이에도 그 문장이 안 들어가므로 칸도 안 만든다.
  const refundLine = lines.find(l => l.kind === 'var')
  const refundSaved = refundLine ? dict[refundLine.text] : undefined
  const refundText = refundLine ? refundSaved ?? RECOMMENDED_REFUND_TRANSLATION[lang] : undefined

  return {
    lang,
    title: tr(template.title),
    sections,
    // 비면 칸을 안 만든다 — 늘 담으면 특약 없는 링크 전건이 허위 드리프트가 된다.
    ...(addendaOut.length ? { addenda: addendaOut } : {}),
    // 실제로 나간 문안을 담는다(권장이든 직접 번역이든). 위와 같은 이유로 없으면 칸도 없다.
    ...(refundText !== undefined ? { vars: { 환불규정: refundVarValue(refundText) } } : {}),
    // 직접 번역일 때만 표식을 남긴다 — 권장을 그대로 쓴 것과 갈라 말해야 나중에 답할 수 있다.
    ...(isCustomRefundTranslation(lang, refundSaved) ? { customVars: ['환불규정' as const] } : {}),
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
    lang?: unknown; title?: unknown; sections?: unknown; addenda?: unknown; oathText?: unknown
    vars?: unknown; customVars?: unknown
    fallbackCount?: unknown; totalCount?: unknown
  }
  const lang = asTranslationLang(s.lang)
  if (!lang) return null
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  const cnt = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)
  // 절·항목은 자리를 그대로 지킨다 — 빈 줄을 걷으면 조항 번호 대응이 깨진다(위 구조 규칙 2).
  const secs = (v: unknown) => (Array.isArray(v) ? v : []).map(x => {
    const sec = (x && typeof x === 'object' && !Array.isArray(x) ? x : {}) as { title?: unknown; items?: unknown }
    return {
      title: str(sec.title),
      items: (Array.isArray(sec.items) ? sec.items : []).map(str),
    }
  })
  const addenda = secs(s.addenda)
  // 변수 값·표식도 **얼어 있는 그대로** 읽는다. 지금 권장 문안으로 채우면 그 발급본이 실제로
  // 보여준 문안과 화면이 갈리고, 그 순간 박제는 증거이기를 그만둔다.
  const varsRaw = (s.vars && typeof s.vars === 'object' && !Array.isArray(s.vars)
    ? (s.vars as { 환불규정?: unknown }) : null)
  const refundVar = typeof varsRaw?.환불규정 === 'string' ? varsRaw.환불규정 : undefined
  const customVars = (Array.isArray(s.customVars) ? s.customVars : [])
    .filter((x): x is '환불규정' => x === '환불규정')
  return {
    lang,
    title: str(s.title),
    sections: secs(s.sections),
    // 칸이 없던 박제(특약 없는 계약·이 칸 이전의 옛 기록)는 여기서도 칸이 안 생긴다 —
    // 빈 배열을 만들면 그 박제를 다시 직렬화할 때 바이트가 달라진다.
    ...(addenda.length ? { addenda } : {}),
    ...(refundVar !== undefined ? { vars: { 환불규정: refundVar } } : {}),
    ...(customVars.length ? { customVars } : {}),
    oathText: str(s.oathText),
    fallbackCount: cnt(s.fallbackCount),
    totalCount: cnt(s.totalCount),
  }
}

/**
 * 번역본을 그릴 때 쓰는 치환 재료 — **종이 vars 에 `{{일정}}` 하나를 더한 것**이다.
 *
 * 종이에는 그 값이 필요 없다. 거주 호실 일정 절은 buildRoomScheduleAddendum 이 이미 채운 절을
 * 싣기 때문이다. 그런데 번역 사전의 열쇠는 **치환 전** 문안이라 번역본 쪽에는 `{{일정}}` 이
 * 그대로 남아 있다 — 그래서 이 한 값만 여기서 더한다.
 *
 * **종이 vars 에 넣지 마라.** 본문에 `{{일정}}` 을 적은 영업장의 종이가 이 기능 전과 달라진다
 * (지금 그 자리는 자리표시자가 그대로 찍히는 자리다).
 *
 * 서명 화면 카드와 발급 상세 전문 열람이 이 함수 하나를 본다. 두 곳이 각자 이으면 한쪽만
 * `{{일정}}` 이 글자 그대로 뜨는 상태가 된다(2026-09-08 배포 결함과 같은 클래스).
 */
export function translationDisplayVars(
  printVars: Record<string, string>,
  roomScheduleText: string | null | undefined,
): Record<string, string> {
  return { ...printVars, 일정: roomScheduleText ?? '' }
}

/**
 * 그 언어의 번역 진행 — 발급 피커가 언어 옆에 적는 캡션의 원천이다.
 *
 * 세는 집합이 편집기·해석과 **같다**(translationSourceLines). 세 곳이 각자 세면 피커는
 * "번역 26/26" 이라고 하는데 종이에는 원문이 넷 남는 상태가 된다.
 *
 * 고르는 것을 막는 데 쓰지 마라(운영자 오더 2026-09-08) — 미완인 언어로 보낼지는 운영자가
 * 정한다. 이 값은 그 판단에 필요한 사실을 눈앞에 두는 것이 전부다.
 *
 * @param addenda **그 계약에 실릴** 가변 절. 피커는 링크를 보낼 계약이 정해진 자리라 분모가
 *   그 계약 기준이다 — 영업장이 쓸 수 있는 전부로 세면 그 계약에 안 붙는 절까지 분모에 들어가
 *   다 번역한 언어가 영영 '26/34' 로 보인다. 편집기는 반대로 전부를 넘긴다(B-4 규칙).
 */
export function translationProgress(
  raw: unknown,
  template: ContractTemplate,
  lang: TranslationLang,
  addenda?: readonly SubLeaseAddendum[],
  refundClauseInContract?: boolean,
): { total: number; done: number; published: boolean; hasEntry: boolean; refundCustom: boolean } {
  const entry = parseContractTranslations(raw).langs[lang]
  const dict = entry?.dict ?? {}
  const lines = translationSourceLines(template, addenda, refundClauseInContract)
  let done = 0
  // 변수 줄은 비어 있어도 번역이 선다(권장 번역). 안 세면 다 번역한 언어가 영영 '29/30' 이다 —
  // 해석 쪽 fallbackCount 와 같은 규칙이라 캡션과 박제의 숫자가 안 갈린다.
  for (const l of lines) if (l.kind === 'var' || dict[l.text] !== undefined) done++
  const refundLine = lines.find(l => l.kind === 'var')
  return {
    total: lines.length,
    done,
    published: entry?.published === true,
    hasEntry: !!entry,
    // 피커가 "환불 규정 직접 번역"을 캡션에 덧붙이는 근거. 판정은 정본 하나다.
    refundCustom: !!refundLine && isCustomRefundTranslation(lang, dict[refundLine.text]),
  }
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
  addenda?: readonly SubLeaseAddendum[],
  refundClauseInContract?: boolean,
): string[] {
  const entry = parseContractTranslations(raw).langs[lang]
  if (!entry) return []
  const live = new Set(translationSourceLines(template, addenda, refundClauseInContract).map(l => l.text))
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

/** 병합 판정. 거부는 저장할 값을 아예 안 만든다 — 반쪽 저장이 없다는 뜻이다. */
export type TranslationMergeResult =
  | { ok: false; missing: TranslationPlaceholderMiss[] }
  | { ok: true; next: ContractTranslations }

/**
 * 한 언어의 공개 여부·사전을 덮는다.
 *
 * 사전 병합에 **삭제 경로가 없다** — payload 에 없는 열쇠(고아)는 그대로 남는다. 값이 빈
 * 문자열로 온 것만 그 열쇠를 걷는다(운영자가 칸을 비운 것 = 번역 취소). 화면이 무엇을 보내든
 * 서버가 안 보이는 번역을 지우지 않는다는 뜻이다.
 *
 * **자리표시자가 빠진 번역은 여기서 거부한다 — 저장이 최종 벽이다.** 번역기가 `{{청소비조항}}`
 * 을 통째로 번역해 버리면 그 조항은 종이에서 값을 잃는데, 그 실패는 아무 소리도 내지 않는다.
 * 화면 검증만으로는 못 막는다 — 화면이 무엇을 보내든 통과시키면 결국 통과하는 길이 남는다.
 * 판정은 붙여넣기와 **같은 함수**를 쓴다(translationPlaceholderMisses).
 */
export function mergeTranslationLang(
  stored: unknown,
  lang: TranslationLang,
  patch: { published?: boolean; dict?: Record<string, unknown> },
): TranslationMergeResult {
  const missing = translationPlaceholderMisses(patch.dict ?? {})
  if (missing.length > 0) return { ok: false, missing }

  const base = parseContractTranslations(stored)
  const prev = base.langs[lang] ?? { published: false, dict: {} }
  const dict: Record<string, string> = { ...prev.dict }

  if (patch.dict) {
    const refundKey = refundTranslationKey()
    for (const [k, v] of Object.entries(patch.dict)) {
      if (typeof k !== 'string' || !k.trim()) continue
      if (typeof v !== 'string' || !v.trim()) { delete dict[k]; continue }
      // 권장 문안과 **같은 값**은 들고 있을 이유가 없다 — 빈 칸이 곧 권장이다. 남겨 두면
      // 나가는 문안은 권장과 똑같은데 '직접 번역' 표식이 서고 경고가 뜬다(사실이 아닌 경고).
      if (k === refundKey && !isCustomRefundTranslation(lang, v)) { delete dict[k]; continue }
      dict[k] = v
    }
  }
  return {
    ok: true,
    next: {
      ...base,
      langs: {
        ...base.langs,
        [lang]: { published: patch.published ?? prev.published, dict },
      },
    },
  }
}

/**
 * 거부 사유를 운영자가 읽을 한 문장으로. 화면 둘(되붙이기 창·저장 실패 토스트)이 같은 문장을
 * 쓴다 — 같은 사고를 두 화면이 다른 말로 설명하면 운영자가 다른 일로 읽는다.
 *
 * 몇 건인지와 **무엇이 빠졌는지**를 함께 말한다. 자리표시자 이름이 곧 고칠 자리라서다.
 */
export function translationPlaceholderMessage(missing: readonly TranslationPlaceholderMiss[]): string {
  const names = [...new Set(missing.flatMap(m => m.placeholders))].join(' · ')
  return `번역문에서 ${names} 가 사라졌습니다(${missing.length}건). 이 표시는 계약서에 실제 값이 들어가는 자리라 번역하거나 지우면 안 됩니다. 원문에 있는 그대로 남겨 주세요.`
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
