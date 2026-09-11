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

import { type SignLang, SIGN_LANGS, asSignLang, signLangForNationality } from '@/lib/signGuideText'
import { isForeignForDocuments } from '@/lib/documentName'
import {
  stripClauseBullet, buildRefundClause, contractAddendaForTranslation, CLEANING_FEE_SOURCE,
  type ContractTemplate, type SubLeaseAddendum,
} from '@/lib/contract'

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
  /**
   * 'var' 줄일 때 그 변수의 이름. 편집기가 라벨·권장 문안·경고를 그 줄에 맞게 고르는 근거다.
   *
   * 종전에는 변수 줄이 환불 규정 하나뿐이라 이름이 필요 없었고, 화면이 `kind === 'var'` 하나로
   * 환불 문안을 꺼내 썼다. 줄이 여럿이 된 지금 그 방식은 청소비 칸에 환불 권장 문안을 보인다.
   */
  varName?: TranslationVarName
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

/** 청소비 문장이 본문에 들어가는 두 자리. 조항 본체와, 환불 항목 꼬리에 붙는 공제 문구다. */
export const CLEANING_CLAUSE_PLACEHOLDER = '{{청소비조항}}'
export const CLEANING_DEDUCT_PLACEHOLDER = '{{청소비공제}}'

/**
 * 번역본이 제 값을 갖는 변수 이름들. **이 배열의 순서가 곧 직렬화·지문 순서다.**
 *
 * 순서를 못박는 이유. `vars` 객체는 인쇄 사실 축이 통비교하는 JSON 이라 열쇠 순서가 바뀌면
 * 내용이 같은 박제가 바이트로 달라진다. 그래서 담는 쪽도 읽는 쪽도 이 배열을 돌며 채운다 —
 * 환불 규정 하나만 있는 옛 박제는 지금도 `{"환불규정":…}` 그대로다.
 */
export type TranslationVarName = '환불규정' | '청소비조항' | '청소비공제'
export const TRANSLATION_VAR_NAMES: readonly TranslationVarName[] =
  ['환불규정', '청소비조항', '청소비공제']

/**
 * 운영자가 그 **변수**를 부르는 이름 — 피커·발급 상세의 '직접 번역' 캡션이 이 한 벌을 쓴다.
 *
 * 박제에 남는 것은 변수 이름뿐이라(customVars) 캡션이 알 수 있는 것도 여기까지다.
 * 편집기의 **줄** 라벨은 갈래까지 가르므로 그쪽은 명세의 label 을 쓴다(TranslationVarSpec).
 */
export const TRANSLATION_VAR_LABEL: Record<TranslationVarName, string> = {
  환불규정: '환불 규정',
  청소비조항: '청소비 조항',
  청소비공제: '청소비 공제 문구',
}

/** 이 줄의 사전 열쇠. 다른 줄과 같은 규칙이다 — 열쇠는 한국어 원문 문자열 그 자체다. */
export function refundTranslationKey(): string {
  return buildRefundClause()
}

/**
 * 청소비 문장의 사전 열쇠 셋 — **치환 전 문안이 열쇠다**(lib/contract 의 CLEANING_FEE_SOURCE).
 *
 * 왜 완성 문장이 열쇠가 아닌가. 청소비는 계약마다 다르고 계약서 표시값으로 덮을 수도 있다
 * (contractFieldOverrides). "청소비 20,000원은…" 을 열쇠로 삼으면 금액이 다른 계약에서는 그
 * 사전이 한 번도 안 맞아, 번역을 다 채운 영업장에서도 그 조항만 한국어로 남는다. `{{일정}}` 을
 * 치환 전 문안으로 두는 규칙과 같은 자리다(lib/contract 의 contractAddendaForTranslation).
 *
 * 셋인 이유. 조항이 청소비 유무로 갈리고(있음·없음), 있음 갈래에만 환불 항목 꼬리에 붙는 공제
 * 문구가 하나 더 선다. 없음 갈래의 공제는 빈 문자열이라 종이에 아무것도 안 들어가므로 줄도 없다.
 */
export function cleaningTranslationKeys(): { clause: string; none: string; deduct: string } {
  return { clause: CLEANING_FEE_SOURCE.clause, none: CLEANING_FEE_SOURCE.none, deduct: CLEANING_FEE_SOURCE.deduct }
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
 * 청소비 문장의 권장 번역. **코드 사전이다** — 운영자 입력이 아니다.
 *
 * 갈래 셋이 각각 제 표를 갖는다(cleaningTranslationKeys 와 같은 셋). 금액이 들어가는 둘은
 * 번역문 안에 `{{청소비}}` 를 **그대로 지녀야 한다** — 지우면 종이의 그 문장이 금액을 잃는다.
 * 그 강제는 저장·되붙이기가 이미 열쇠 기준으로 세므로 여기 새 규칙을 두지 않는다
 * (translationPlaceholderMisses).
 *
 * **지금은 전 언어가 빈 칸이다**(2026-09-11). 종이에 나가는 계약 문안이라 기계 번역으로 채우지
 * 않고 번역가 패널이 따로 낸다. 빈 칸인 동안은 이 줄이 아무 값도 안 내보내고, 그러면 종이 vars
 * 의 한국어 문장이 그대로 선다 — 이 기능 전과 문자 단위로 같은 상태다. 채워 넣는 순간부터
 * 그 언어의 빈 칸이 권장 번역으로 나간다.
 *
 * Record 전량 선언이다(RECOMMENDED_REFUND_TRANSLATION 과 같은 이유) — 언어가 늘었는데 칸을
 * 안 만들면 tsc 가 컴파일을 막는다.
 */
export const RECOMMENDED_CLEANING_TRANSLATION: Record<'clause' | 'none' | 'deduct', Record<TranslationLang, string>> = {
  clause: { en: '[Cleaning Fee] The cleaning fee of {{청소비}} is consideration for the indoor cleaning service performed after move-out. If there is a deposit, it is deducted from the deposit at the move-out settlement; if there is no deposit, it is collected at move-in together with the room fee.', vi: '[Phí vệ sinh] Phí vệ sinh {{청소비}} là khoản đối giá cho dịch vụ vệ sinh bên trong phòng sau khi trả phòng. Trường hợp có tiền đặt cọc, khoản này được khấu trừ từ tiền đặt cọc khi quyết toán trả phòng; trường hợp không có tiền đặt cọc, khoản này được thu cùng với tiền phòng khi vào ở.', bn: '[পরিষ্কার ফি] পরিষ্কার ফি {{청소비}} হলো কক্ষ ত্যাগের পর কক্ষের ভেতরে পরিষ্কারের সেবার বিনিময় মূল্য। জামানত থাকলে কক্ষ ত্যাগের হিসাব নিষ্পত্তির সময় জামানত থেকে কেটে নেওয়া হয়, আর জামানত না থাকলে প্রবেশের সময় বসবাস ফি-এর সঙ্গে নেওয়া হয়।', ru: '[Плата за уборку] Плата за уборку в размере {{청소비}} является вознаграждением за услуги по уборке помещения после выселения. При наличии залога она удерживается из залога при расчёте на момент выселения, при отсутствии залога она взимается при заселении вместе с платой за проживание.', ja: '[清掃費] 清掃費 {{청소비}} は、退室後の室内清掃役務の対価です。保証金がある場合は退室精算時に保証金から控除し、保証金がない場合は入室時に入室料と併せて受領します。', zh: '【清洁费】清洁费 {{청소비}} 为退房后室内清洁服务的对价。有押金的，于退房结算时从押金中扣除；无押金的，于入住时与入住费一并收取。', zht: '【清潔費】清潔費 {{청소비}} 為退住後室內清潔服務之對價。有押金者，於退住結算時自押金中扣除；無押金者，於入住時與入住費一併收取。' },
  none: { en: '[Cleaning Fee] This Agreement has no cleaning fee. No amount is deducted as a cleaning fee at move-out.', vi: '[Phí vệ sinh] Hợp đồng này không có phí vệ sinh. Khi trả phòng không khấu trừ bất kỳ khoản nào với danh nghĩa phí vệ sinh.', bn: '[পরিষ্কার ফি] এই চুক্তিতে কোনো পরিষ্কার ফি নেই। কক্ষ ত্যাগের সময় পরিষ্কার ফি বাবদ কোনো কর্তন করা হয় না।', ru: '[Плата за уборку] Настоящий договор не предусматривает платы за уборку. При выселении удержание в счёт платы за уборку не производится.', ja: '[清掃費] 本契約に清掃費はありません。退室時に清掃費名目での控除は行いません。', zh: '【清洁费】本合同无清洁费。退房时不以清洁费名义扣除。', zht: '【清潔費】本契約無清潔費。退住時不以清潔費名義扣除。' },
  deduct: { en: '(cleaning fee of {{청소비}} within the deposit deducted separately)', vi: '(khấu trừ riêng phí vệ sinh {{청소비}} trong tiền đặt cọc)', bn: '(জামানতের মধ্যে পরিষ্কার ফি {{청소비}} পৃথকভাবে কর্তন)', ru: '(плата за уборку {{청소비}} в составе залога удерживается отдельно)', ja: '(保証金内の清掃費 {{청소비}} を別途控除)', zh: '（押金内清洁费 {{청소비}} 另行扣除）', zht: '（押金內清潔費 {{청소비}} 另行扣除）' },
}

/**
 * 변수 줄 한 벌의 명세 — 열쇠·권장 문안·경고 문안이 **한 자리에 묶여 다닌다.**
 *
 * 종전에는 이 셋이 환불 규정 전용 상수 세 개로 흩어져 있었고, 화면이 `kind === 'var'` 하나로
 * 그것을 꺼내 썼다. 줄이 여럿이 된 지금 그 방식은 청소비 칸에 환불 권장 문안을 보이고 환불
 * 경고를 세운다. 줄마다 제 명세를 들고 다니면 그 갈림이 구조적으로 안 생긴다.
 */
export type TranslationVarSpec = {
  name: TranslationVarName
  /** 사전 열쇠이자 편집기가 보여줄 한국어 원문. */
  key: string
  /**
   * 편집기 줄 라벨. **갈래까지 가른다** — 청소비 조항은 있음·없음 두 줄이 서는데 이름이 같으면
   * 운영자는 같은 칸이 두 번 선 것으로 읽는다(디자이너 차단 2026-09-11).
   * 변수 이름 수준의 라벨(TRANSLATION_VAR_LABEL)과 다른 층이다 — 그쪽은 박제가 이름만 들고
   * 있는 자리(피커·발급 상세 캡션)가 쓴다.
   */
  label: string
  /** 그 언어의 권장 번역. **빈 문자열은 '권장 문안이 아직 없다'** 이고 그때는 한국어가 남는다. */
  recommended: Record<TranslationLang, string>
  /** 값 앞에 한 칸을 붙이는가 — 앞 문장에 이어 붙는 꼬리라야 참이다(종이 vars 와 같은 모양). */
  inline: boolean
  /** 권장과 다른 문안일 때 칸 옆에 서는 경고. 왜 조심해야 하는지는 줄마다 이유가 다르다. */
  warning: string
}

/**
 * 그 값이 '직접 번역'인가 — **권장 문안이 있고** 값이 있고 그와 다르다.
 *
 * **글자 비교·유사도 판정을 만들지 마라**(운영자 오더). 여기 있는 것은 권장 문안과의 동일성
 * 하나뿐이다. 뜻이 얼마나 비슷한지 재려 들면 오탈자마다 소음이 나고, 정작 뜻이 뒤집힌 번역은
 * 글자가 비슷해 통과한다.
 *
 * **권장 문안이 빈 줄은 언제나 거짓이다.** 견줄 기준이 없으면 '권장과 다르다'는 말 자체가
 * 성립하지 않는다. 그 상태에서 참을 돌려주면 경고가 "권장으로 돌리려면 칸을 비우세요" 라고
 * 하는데 비우면 한국어가 남고, 박제에는 있지도 않은 기준에서 벗어났다는 표식이 남는다.
 *
 * 편집기 경고·저장 비우기·박제 표식이 **이 함수 하나**를 본다. 세 곳이 각자 재면 화면은
 * "권장과 다르다"고 경고하는데 저장은 권장과 같다고 칸을 비우는 상태가 된다.
 */
export function isCustomVarTranslation(
  lang: TranslationLang, spec: TranslationVarSpec, value: unknown,
): boolean {
  const rec = spec.recommended[lang]
  if (!rec) return false
  if (typeof value !== 'string' || !value.trim()) return false
  return value.trim() !== rec
}

/**
 * 본문 어딘가에 그 `{{자리표시자}}` 가 있는가.
 *
 * **걷어낸 줄까지 본다.** 줄 전체가 자리표시자인 항목은 번역 대상에서 빠지지만
 * (hasTranslatableText) 종이에는 그 값이 그대로 들어간다. 대상 목록만 훑으면 그런 본문에서
 * 칸이 안 서고, 종이의 그 문단만 영영 한국어로 남는다. 청소비 조항이 정확히 그 모양이다
 * (기본 템플릿의 `- {{청소비조항}}`).
 */
function templateHasPlaceholder(
  template: ContractTemplate, addenda: readonly SubLeaseAddendum[] | undefined, placeholder: string,
): boolean {
  const all: unknown[] = [template?.title, template?.oathText]
  for (const s of Array.isArray(template?.sections) ? template.sections : []) {
    all.push(s?.title, ...(Array.isArray(s?.items) ? s.items : []))
  }
  for (const a of addenda ?? []) {
    if (!a) continue
    all.push(a.title, ...(Array.isArray(a.items) ? a.items : []))
  }
  return all.some(s => typeof s === 'string' && translationPlaceholders(s).includes(placeholder))
}

/**
 * 번역본이 그 자리에 넣을 값 — **종이와 같은 모양**이다.
 *
 * 꼬리 줄은 앞 한 칸이 문장을 잇는다(lib/contractPrintHtml 의 `' ' + buildRefundClause()`,
 * lib/contract 의 청소비공제). 칸을 빼면 앞 문장에 그대로 붙어 "…따릅니다.Early move-out refund"
 * 가 된다. 조판 규칙이 두 벌이면 종이와 카드가 그 한 칸에서 갈린다.
 * 줄을 통째로 차지하는 값(청소비 조항)은 앞 칸이 없다 — 붙이면 글머리 뒤가 두 칸이 된다.
 */
function translationVarValue(spec: TranslationVarSpec, text: string): string {
  return spec.inline ? ' ' + text : text
}

/**
 * 청소비 줄을 어느 기준으로 세울지.
 *   · **숫자** = 그 계약의 청소비(표시값 오버라이드까지 얹은 값). 종이에 실리는 한 갈래만 선다.
 *   · **'property'** = 환경설정 편집기. 두 갈래를 다 세운다 — 청소비는 계약별이라 한 영업장에
 *     0원 계약과 유료 계약이 실제로 공존한다(거주 계약 41건 중 29건이 0원, 2026-08-03 실측).
 *     미리 채워 두는 자리라 한 갈래로 좁히면 다른 갈래 계약의 조항이 영영 번역되지 않는다.
 *   · **안 넘김** = 청소비 줄을 아예 안 세운다. 넘기기를 잊은 호출부가 조용히 **다른 갈래**의
 *     번역을 종이에 얹는 것보다, 종전처럼 한국어가 남는 쪽이 안전하다.
 */
export type CleaningVarScope = number | 'property'

/**
 * 이 계약서에 설 변수 줄의 명세 목록 — **종이가 그 값을 넣는 조건과 같은 조건**으로 고른다.
 *
 * 조건이 갈리면 종이에 안 실리는 문장을 번역하라고 칸이 서거나, 실리는데 칸이 안 선다.
 * 환불은 토글 + 본문의 자리, 청소비는 본문의 자리 + 그 계약의 금액 갈래다.
 */
export function translationVarSpecs(
  template: ContractTemplate,
  addenda?: readonly SubLeaseAddendum[],
  refundClauseInContract?: boolean,
  cleaning?: CleaningVarScope,
): TranslationVarSpec[] {
  const all = allTranslationVarSpecs()
  const out: TranslationVarSpec[] = []
  if (refundClauseInContract && templateHasPlaceholder(template, addenda, REFUND_VAR_PLACEHOLDER)) {
    out.push(all.refund)
  }
  if (cleaning !== undefined) {
    const everyBranch = cleaning === 'property'
    const paid = everyBranch || cleaning > 0
    if (templateHasPlaceholder(template, addenda, CLEANING_CLAUSE_PLACEHOLDER)) {
      if (paid) out.push(all.cleaningClause)
      if (everyBranch || cleaning <= 0) out.push(all.cleaningNone)
    }
    // 공제 꼬리는 **있음 갈래에만** 값이 있다. 없음 갈래의 종이 값은 빈 문자열이라 넣을 것이 없고,
    // 칸을 세우면 종이에 안 나가는 문장을 번역하라고 하는 셈이다.
    if (paid && templateHasPlaceholder(template, addenda, CLEANING_DEDUCT_PLACEHOLDER)) {
      out.push(all.cleaningDeduct)
    }
  }
  return out
}

/**
 * 변수 줄 명세의 **전량**. 본문과 무관하게 문안만으로 정해지므로 템플릿 없이도 답할 수 있다.
 *
 * 저장 병합이 이것을 쓴다 — 그 자리에는 템플릿도 계약도 없고 열쇠와 값만 온다. 병합이 제 사본을
 * 들면 화면은 "권장과 같다"며 칸을 비우는데 저장은 그 값을 들고 있는 상태가 된다.
 */
function allTranslationVarSpecs(): Record<'refund' | 'cleaningClause' | 'cleaningNone' | 'cleaningDeduct', TranslationVarSpec> {
  const keys = cleaningTranslationKeys()
  const cleaningWarning = '권장 번역과 다른 문안입니다. 청소비 문장은 그 돈의 성격과 받는 방식을 정하는 자리라 뜻이 어긋나면 퇴실 정산에서 다툼이 됩니다. 권장으로 돌리려면 칸을 비우세요.'
  return {
    refund: {
      name: '환불규정',
      key: refundTranslationKey(),
      // 이 줄의 라벨만 종전 그대로다 — 환불은 권장 문안이 8언어 다 있어 화면이 안 바뀐다(무회귀).
      label: '환불 규정',
      recommended: RECOMMENDED_REFUND_TRANSLATION,
      inline: true,
      warning: '권장 번역과 다른 문안입니다. 환불 규정은 공정거래위원회 기준 문구라 뜻이 어긋나면 분쟁에서 설명 부담이 생깁니다. 권장으로 돌리려면 칸을 비우세요.',
    },
    cleaningClause: { name: '청소비조항', key: keys.clause, label: '청소비 조항(있음)', recommended: RECOMMENDED_CLEANING_TRANSLATION.clause, inline: false, warning: cleaningWarning },
    cleaningNone: { name: '청소비조항', key: keys.none, label: '청소비 조항(없음)', recommended: RECOMMENDED_CLEANING_TRANSLATION.none, inline: false, warning: cleaningWarning },
    cleaningDeduct: { name: '청소비공제', key: keys.deduct, label: '청소비 공제 문구', recommended: RECOMMENDED_CLEANING_TRANSLATION.deduct, inline: true, warning: cleaningWarning },
  }
}

/**
 * 그 줄이 **번역 완료로 세어지는가** — 진행 계수의 정본이다.
 *
 * 값이 있으면 완료다. 값이 없어도 변수 줄은 완료인데, **그 언어의 권장 문안이 있을 때만** 그렇다.
 * 권장이 없는 변수 줄은 비워 두면 종이에 한국어가 그대로 나가므로 완료가 아니다
 * (디자이너 차단 2026-09-11 — 종전에는 `kind === 'var'` 를 무조건 완료로 세어, 한국어로 나가는
 * 청소비 세 문장이 번역 완료로 잡히고 다 채운 언어가 '0줄 남음'이라 거짓을 말했다).
 *
 * 해석의 fallbackCount · 피커 진행 · 편집기 계수가 **이 함수 하나**를 본다. 세 곳이 각자 세면
 * 캡션은 완료라는데 종이에는 원문이 남는 상태가 다시 생긴다.
 *
 * 환불 규정은 권장이 7언어 전부 있어 이 규칙에서도 종전과 같은 답이다(무회귀).
 */
export function translationLineDone(
  lang: TranslationLang, line: TranslationSourceLine, value: unknown,
): boolean {
  if (typeof value === 'string' && value.trim()) return true
  if (line.kind !== 'var') return false
  return !!translationVarSpecByKey(line.text)?.recommended[lang]
}

/** 열쇠 하나로 그 변수 명세를 찾는다. 저장 병합처럼 템플릿이 없는 자리가 쓴다. */
export function translationVarSpecByKey(key: string): TranslationVarSpec | undefined {
  return Object.values(allTranslationVarSpecs()).find(s => s.key === key)
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
 * @param cleaning 청소비 줄의 기준(CleaningVarScope). 편집기는 'property', 계약이 정해진
 *   자리는 그 계약의 금액, 안 넘기면 청소비 줄이 안 선다.
 */
export function translationSourceLines(
  template: ContractTemplate,
  addenda?: readonly SubLeaseAddendum[],
  refundClauseInContract?: boolean,
  cleaning?: CleaningVarScope,
): TranslationSourceLine[] {
  const out: TranslationSourceLine[] = []
  const seen = new Set<string>()
  const push = (kind: TranslationLineKind, text: string, sectionIndex?: number) => {
    if (typeof text !== 'string' || !text.trim() || seen.has(text)) return
    if (!hasTranslatableText(text)) return
    seen.add(text)
    out.push(sectionIndex === undefined ? { kind, text } : { kind, text, sectionIndex })
  }
  const pushVar = (spec: TranslationVarSpec) => {
    if (typeof spec.key !== 'string' || !spec.key.trim() || seen.has(spec.key)) return
    if (!hasTranslatableText(spec.key)) return
    seen.add(spec.key)
    out.push({ kind: 'var', text: spec.key, varName: spec.name })
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
  // 여럿일 때의 순서도 명세 목록 하나가 정한다 — 두 벌로 세면 복사한 줄 수와 되붙이기가 세는
  // 순서가 갈려, 번역이 통째로 한 칸씩 밀린 채 종이로 나간다.
  for (const spec of translationVarSpecs(template, addenda, refundClauseInContract, cleaning)) pushVar(spec)
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
   * 이 번역본이 조항 안 `{{변수}}` 자리에 덮어 쓸 값(환불 규정 · 청소비 조항 · 청소비 공제).
   *
   * 본문 컴포넌트가 **종이 vars 위에** 이것을 얹는다 — 안 얹으면 번역본 안에서 그 문단만
   * 한국어로 남는다. 값은 종이와 같은 모양이라 꼬리 줄에는 앞 한 칸이 붙어 있다
   * (translationVarValue). 값 안의 `{{청소비}}` 같은 자리표시자는 **여전히 치환 전**이다 —
   * 그리는 쪽이 종이 vars 로 한 번 더 채운다(ContractTranslationBody).
   *
   * **비면 칸 자체가 없고, 담기는 순서는 TRANSLATION_VAR_NAMES 가 정한다.** addenda 칸과 같은
   * 규칙이다 — 인쇄 사실 축이 이 객체를 통비교하는 JSON 이라, 늘 담거나 순서가 흔들리면 내용이
   * 안 바뀐 옛 박제가 통째로 드리프트로 뜬다.
   */
  vars?: Partial<Record<TranslationVarName, string>>
  /**
   * 그중 운영자가 **직접 번역한** 변수 이름. 권장 문안을 그대로 쓴 것과 가르는 표식이다.
   *
   * 발급 상세가 이 표식으로 "환불 규정 직접 번역"을 한 줄 덧붙인다 — 나중에 "그 종이의
   * 환불 문구가 왜 공정위 기준과 다른가"를 물을 때 답이 박제 안에 있어야 한다.
   * 위와 같은 이유로 **비면 칸이 없고** 순서도 TRANSLATION_VAR_NAMES 가 정한다.
   */
  customVars?: TranslationVarName[]
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
  cleaning?: CleaningVarScope,
): ResolvedContractTranslation | null {
  const parsed = parseContractTranslations(raw)
  if (!parsed.enabled) return null
  const entry = parsed.langs[lang]
  if (!entry || !entry.published) return null

  const dict = entry.dict
  // 총수·미번역 수는 편집기가 세는 것과 **같은 집합**에서 나온다(translationSourceLines).
  const lines = translationSourceLines(template, addenda, refundClauseInContract, cleaning)
  let fallbackCount = 0
  // 권장 번역이 있는 변수 줄은 비어 있어도 한국어가 안 남는다 — 그 문안이 자리를 채운다.
  // 권장이 없는 변수 줄은 반대로 한국어가 그대로 나가므로 폴백으로 센다. 판정은 정본 하나다
  // (translationLineDone) — 여기서 따로 세면 캡션과 박제의 숫자가 갈린다.
  for (const l of lines) if (!translationLineDone(lang, l, dict[l.text])) fallbackCount++

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
  // 줄이 안 섰으면(토글 꺼짐·본문에 자리 없음·청소비 기준 미지정) 종이에도 그 문장이 안 들어가므로
  // 칸도 안 만든다. **권장 문안이 아직 빈 언어도 칸을 안 만든다** — 빈 값을 얹으면 종이의 한국어
  // 문장을 빈 문자열로 덮어 그 조항이 통째로 사라진다(한국어로 남는 것보다 나쁘다).
  //
  // 담는 순서는 TRANSLATION_VAR_NAMES 하나가 정한다. 명세 순서나 Object 삽입 순서에 기대면
  // 환불 하나만 있는 옛 박제의 JSON 바이트가 언젠가 달라져 전건이 허위 드리프트로 뜬다.
  const specs = translationVarSpecs(template, addenda, refundClauseInContract, cleaning)
  const vars: Partial<Record<TranslationVarName, string>> = {}
  const customVars: TranslationVarName[] = []
  for (const name of TRANSLATION_VAR_NAMES) {
    const spec = specs.find(s => s.name === name)
    if (!spec) continue
    const saved = dict[spec.key]
    const text = saved ?? (spec.recommended[lang] || undefined)
    if (text !== undefined) vars[name] = translationVarValue(spec, text)
    // 직접 번역일 때만 표식을 남긴다 — 권장을 그대로 쓴 것과 갈라 말해야 나중에 답할 수 있다.
    if (isCustomVarTranslation(lang, spec, saved)) customVars.push(name)
  }

  return {
    lang,
    title: tr(template.title),
    sections,
    // 비면 칸을 안 만든다 — 늘 담으면 특약 없는 링크 전건이 허위 드리프트가 된다.
    ...(addendaOut.length ? { addenda: addendaOut } : {}),
    // 실제로 나간 문안을 담는다(권장이든 직접 번역이든). 위와 같은 이유로 없으면 칸도 없다.
    ...(Object.keys(vars).length ? { vars } : {}),
    ...(customVars.length ? { customVars } : {}),
    oathText: tr(template.oathText),
    fallbackCount,
    totalCount: lines.length,
  }
}

/**
 * 그 계약서 한 장의 번역본을 해석한다 — **해석 호출부 셋의 정본**이다.
 *
 * 왜 하나여야 하나(운영자 오더 2026-09-08). 종전에는 링크 발급 한 자리뿐이라 규칙이 한 벌이었는데,
 * 대면 서명이 열리면서 화면(buildContractData)과 발급 API 가 같은 해석을 하게 됐다. 세 곳이 각자
 * 인자를 조립하면 언젠가 한 곳만 가변 절을 빠뜨리거나 환불 토글을 안 넘긴다 — 그때는 운영자가
 * 건넨 화면과 종이·박제가 서로 다른 문안을 말한다.
 *
 * 두 인자를 이 함수가 대신 만든다. 가변 절은 종이와 같은 정본으로 고르고
 * (contractAddendaForTranslation), 환불 조항 토글은 그 계약서의 값을 그대로 쓴다.
 *
 * **언어가 없으면 null 이다.** 한국어(ko)는 asTranslationLang 을 못 지나므로 부르는 쪽에서
 * 이미 undefined 가 되어 여기 들어온다 — '번역본 없음'과 같은 착지다.
 */
export function resolveContractTranslationFor(
  stored: unknown,
  d: {
    template: ContractTemplate
    refundClauseInContract: boolean
    subLeaseAddendum?: SubLeaseAddendum | null
    rateAddendum?: SubLeaseAddendum | null
    roomScheduleText?: string | null
    roomScheduleAddendum?: SubLeaseAddendum | null
    /**
     * 그 계약의 청소비 — **표시값 오버라이드까지 얹은 병합값**이라야 한다(contractLeaseFields).
     * 종이가 그 값으로 조항을 고르므로(cleaningFeeVars), 여기서 원천을 보면 관 제출용으로 금액을
     * 고친 계약에서 종이는 '있음' 조항을 찍는데 번역본은 '없음' 조항을 세운다.
     *
     * **필수 칸이다.** 옵셔널로 두면 넘기기를 잊은 호출부가 조용히 청소비 줄을 빠뜨려 그 문단만
     * 한국어로 남고, 그 결손은 아무 소리도 안 낸다. 계약이 없으면 null 이고 그때는 종이도
     * '청소비 없음' 갈래다(cleaningFeeVars 가 undefined 를 0 으로 읽는 규칙과 같다).
     */
    lease: { cleaningFee: number } | null
  },
  lang: TranslationLang | null | undefined,
): ResolvedContractTranslation | null {
  if (!lang) return null
  return resolveContractTranslation(
    stored, d.template, lang, contractAddendaForTranslation(d), d.refundClauseInContract,
    d.lease?.cleaningFee ?? 0)
}

/**
 * 계약서 화면에 세울 번역본 언어 — **화면을 여는 순간 정해진다**(운영자 오더 2026-09-08).
 *
 * 왜 기본값이 국적인가. 운영자가 제 휴대폰·태블릿을 그대로 건네 대면으로 서명받는 운용이 있어서다.
 * 그때 운영자 화면이 곧 입주자가 읽는 화면인데, 건네고 나서 언어를 고르게 하면 이미 늦다.
 * 그래서 열리는 순간 맞아 있고, 다르면 **건네기 전에** 툴바에서 바꾼다.
 *
 * **외국인 판정은 서명 요청과 같은 축이다**(isForeignForDocuments). 그 판정을 못 지나면 언어를
 * 지목해도 한국어다 — 내국인 계약서의 화면·종이는 이 기능 전과 문자 단위로 같아야 하고, 그 사실이
 * URL 을 손으로 고친 경우에도 참이어야 한다. 서명 요청이 내국인에게 언어 피커를 아예 안 여는 것과
 * 같은 자리다.
 *
 * ko 는 asTranslationLang 을 못 지나므로 부르는 쪽에서 '번역본 없음'이 된다.
 */
export function contractTranslationLangFor(
  tenant: { nationality?: string | null; foreignRegNoEnc?: unknown },
  wanted: string | null | undefined,
): SignLang {
  const foreign = isForeignForDocuments({
    nationality: tenant.nationality ?? null, hasForeignRegNo: !!tenant.foreignRegNoEnc,
  })
  if (!foreign) return 'ko'
  return asSignLang(wanted) ?? signLangForNationality(tenant.nationality)
}

/**
 * 서명 요청 피커의 기본 언어 — **툴바에서 지금 보고 있는 번역본**이 있으면 그것, 없으면 국적이다.
 *
 * 왜 잇나(2026-09-09). 언어를 고르는 자리가 둘이 됐는데 안 이어져 있었다. 툴바에서 베트남어
 * 번역본을 세워 두고 그대로 서명 요청을 누르면 피커 기본값은 여전히 국적값이라, 방금 고른
 * 선택이 다음 화면에서 사라졌다. 링크의 signLang 은 안내 언어이자 **박제되는 번역본의 언어**라
 * (issueContractShareLink), 툴바와 피커는 둘 다 '입주자가 읽을 번역본'이고 채널만 다르다 —
 * 하나는 건네는 화면, 하나는 원격 링크다.
 *
 * **고른 적이 있는가는 URL 파라미터의 유무로 가른다.** 툴바는 URL 이 정본이고 한국어도
 * `lang=ko` 로 명시해 남기므로, 파라미터가 없다는 것은 아무도 안 골랐다는 뜻이다. 그때는
 * 종전대로 국적 기본값이라 이 기능 전과 문자 단위로 같다.
 *
 * **화면이 해석한 언어를 읽으면 안 된다.** 그 값은 비공개 언어에서 ko 로 떨어지므로(카드가
 * 안 서는 것이 정직한 표시라 그렇게 둔 것이다), 운영자가 고른 것과 **다른 언어**가 기본값이 된다.
 *
 * **여기까지가 이 값의 끝이다.** 고른 결과는 피커가 돌려주고, 링크에 박히는 언어는 서버가 같은
 * 게이트에서 다시 정한다 — 화면이 필요로 하는 값과 종이가 지고 갈 값은 같지 않다.
 *
 * @param viewLang 계약서 화면 URL 의 `?lang` 값. 화이트리스트를 못 지나면 없는 것과 같다.
 * @returns fromView 는 캡션이 이유를 말하는 데만 쓴다('지금 보는 번역본' · '국적 기본값').
 */
export function signRequestDefaultLang(
  viewLang: string | null | undefined,
  nationality: string | null | undefined,
): { lang: SignLang; fromView: boolean } {
  const picked = asSignLang(viewLang)
  if (picked) return { lang: picked, fromView: true }
  return { lang: signLangForNationality(nationality), fromView: false }
}

/**
 * 해석 완료본의 지문 — 화면이 받은 번역본과 서버가 지금 해석한 것이 같은지 견주는 열쇠다.
 *
 * 왜 있나(운영자 오더 2026-09-08). 대면 서명은 **화면을 로드한 뒤 발급을 누르기까지** 창이 있고,
 * 그 사이에 다른 자리에서 사전을 고칠 수 있다. 그러면 입주자가 건네받아 읽은 문안과 종이에 박히는
 * 문안이 갈리는데, 그 갈림은 아무 소리도 내지 않는다. 화면이 제 지문을 함께 보내고 서버가 재해석본과
 * 대조하면 그 창이 닫힌다.
 *
 * **열쇠 순서에 안 기댄다.** 해석과 박제 파서가 각각 객체를 조립하므로, 언젠가 한쪽 필드 순서가
 * 바뀌면 내용이 같은데도 지문이 갈려 멀쩡한 발급이 거절된다. 그래서 값만 뽑아 배열로 눕힌다.
 *
 * 암호학적 해시가 아니다. 여기서 막는 것은 '그 사이 사전이 바뀌었다'는 사고지 위조가 아니다 —
 * 종이에 실릴 문안은 **서버가 다시 해석한 것**이고 클라이언트가 보낸 내용은 어디에도 안 쓰인다.
 */
export function translationDigest(t: ResolvedContractTranslation | null | undefined): string | null {
  if (!t) return null
  const canon = JSON.stringify([
    t.lang,
    t.title,
    (t.sections ?? []).map(s => [s.title, s.items]),
    (t.addenda ?? []).map(s => [s.title, s.items]),
    t.oathText,
    // 변수 값은 **이름 순서를 못박아** 눕힌다. 객체를 그대로 넣으면 열쇠 순서가 지문에 새어 들어와,
    // 내용이 같은데도 담는 순서가 다른 쪽에서 멀쩡한 발급이 거절된다(위 '열쇠 순서에 안 기댄다').
    TRANSLATION_VAR_NAMES.map(n => t.vars?.[n] ?? null),
    t.customVars ?? [],
    t.fallbackCount,
    t.totalCount,
  ])
  // FNV-1a 를 서로 다른 씨앗으로 두 번 돌려 32비트씩 잇는다. 한 벌만 쓰면 32비트라
  // 우연 충돌이 실무에서도 보일 만큼 흔해진다.
  const fnv = (seed: number): string => {
    let h = seed
    for (let i = 0; i < canon.length; i++) {
      h ^= canon.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    return (h >>> 0).toString(16).padStart(8, '0')
  }
  return fnv(0x811c9dc5) + fnv(0x9e3779b9)
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
  //
  // 없는 이름은 칸을 안 만든다. 환불 하나만 얼어 있는 옛 박제는 여기서도 그 하나만 나오고,
  // 이름 순서를 고정해 채우므로 다시 직렬화해도 바이트가 그대로다(:689 의 addenda 규칙과 같다).
  const varsRaw = (s.vars && typeof s.vars === 'object' && !Array.isArray(s.vars)
    ? (s.vars as Partial<Record<TranslationVarName, unknown>>) : null)
  const vars: Partial<Record<TranslationVarName, string>> = {}
  for (const n of TRANSLATION_VAR_NAMES) {
    const v = varsRaw?.[n]
    if (typeof v === 'string') vars[n] = v
  }
  const frozenCustom = new Set((Array.isArray(s.customVars) ? s.customVars : []) as unknown[])
  const customVars = TRANSLATION_VAR_NAMES.filter(n => frozenCustom.has(n))
  return {
    lang,
    title: str(s.title),
    sections: secs(s.sections),
    // 칸이 없던 박제(특약 없는 계약·이 칸 이전의 옛 기록)는 여기서도 칸이 안 생긴다 —
    // 빈 배열을 만들면 그 박제를 다시 직렬화할 때 바이트가 달라진다.
    ...(addenda.length ? { addenda } : {}),
    ...(Object.keys(vars).length ? { vars } : {}),
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
  cleaning?: CleaningVarScope,
): { total: number; done: number; published: boolean; hasEntry: boolean; customVars: TranslationVarName[] } {
  const entry = parseContractTranslations(raw).langs[lang]
  const dict = entry?.dict ?? {}
  const lines = translationSourceLines(template, addenda, refundClauseInContract, cleaning)
  let done = 0
  // 권장 번역이 있는 변수 줄은 비어 있어도 번역이 선다. 안 세면 다 번역한 언어가 영영 '29/30' 이다.
  // 권장이 없는 변수 줄은 한국어가 나가므로 안 센다 — 해석 쪽 fallbackCount 와 **같은 정본**이라
  // 캡션과 박제의 숫자가 안 갈린다.
  for (const l of lines) if (translationLineDone(lang, l, dict[l.text])) done++
  const specs = translationVarSpecs(template, addenda, refundClauseInContract, cleaning)
  return {
    total: lines.length,
    done,
    published: entry?.published === true,
    hasEntry: !!entry,
    // 피커가 "… 직접 번역"을 캡션에 덧붙이는 근거. 판정은 정본 하나이고 순서도 이름 배열이 정한다.
    customVars: TRANSLATION_VAR_NAMES.filter(n =>
      specs.some(s => s.name === n && isCustomVarTranslation(lang, s, dict[s.key]))),
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
  cleaning?: CleaningVarScope,
): string[] {
  const entry = parseContractTranslations(raw).langs[lang]
  if (!entry) return []
  const live = new Set(translationSourceLines(template, addenda, refundClauseInContract, cleaning).map(l => l.text))
  return Object.keys(entry.dict).filter(k => !live.has(k))
}

/**
 * 본문을 고쳤을 때 **원문으로 돌아간 줄**을 언어별로 센다(운영자 지적 2026-09-08).
 *
 * 왜 있나. 열쇠가 한국어 문장 자체라, 본문 한 줄을 고치면 그 줄의 번역이 저절로 '없음'이 되어
 * 종이에 원문이 남는다. 그것이 설계대로 동작하는 모습이지만 **아무도 말해 주지 않는다** —
 * 운영자는 다 번역해 둔 계약서가 조용히 반쪽이 된 것을 모른다. 저장 액션이 이 함수로 세어
 * 그 자리에서 알린다.
 *
 * 계수는 정본을 재사용한다(translationSourceLines · parseContractTranslations). 규칙을 베끼면
 * 여기만 특약 줄을 빠뜨리거나 자리표시자뿐인 줄을 세는 날이 온다.
 *
 * 가변 절·환불 토글은 저장 전후에 **같은 값**이라 세는 결과에서 저절로 상쇄된다. 그래도 넘기는
 * 이유는 분모를 좁히면 그 절의 번역이 잃은 줄로 안 잡히기 때문이다.
 *
 * `langs` 는 한 줄이라도 잃은 언어 수, `lines` 는 잃은 **원문 줄**의 가짓수다. 대개 여러 언어가
 * 같은 줄을 함께 잃으므로 "6개 언어에서 2줄"이 되고, 그것이 운영자가 고쳐야 할 일의 크기다.
 * 둘 다 0 이면 아무 말도 안 한다 — 종전과 같은 저장이다.
 */
export function translationStaleAfterEdit(
  stored: unknown,
  before: ContractTemplate,
  after: ContractTemplate,
  addenda?: readonly SubLeaseAddendum[],
  refundClauseInContract?: boolean,
  cleaning?: CleaningVarScope,
): { langs: number; lines: number } {
  const beforeLines = translationSourceLines(before, addenda, refundClauseInContract, cleaning)
  const afterKeys = new Set(translationSourceLines(after, addenda, refundClauseInContract, cleaning).map(l => l.text))
  const parsed = parseContractTranslations(stored)
  const lost = new Set<string>()
  let langs = 0
  for (const lang of TRANSLATION_LANGS) {
    const dict = parsed.langs[lang]?.dict
    if (!dict) continue
    let n = 0
    for (const l of beforeLines) {
      // 살아남은 열쇠는 번역도 그대로 붙어 있다. 번역이 없던 줄은 원래부터 원문이라 잃은 것이 아니다.
      if (afterKeys.has(l.text) || dict[l.text] === undefined) continue
      n++
      lost.add(l.text)
    }
    if (n > 0) langs++
  }
  return { langs, lines: lost.size }
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
    for (const [k, v] of Object.entries(patch.dict)) {
      if (typeof k !== 'string' || !k.trim()) continue
      if (typeof v !== 'string' || !v.trim()) { delete dict[k]; continue }
      // 권장 문안과 **같은 값**은 들고 있을 이유가 없다 — 빈 칸이 곧 권장이다. 남겨 두면
      // 나가는 문안은 권장과 똑같은데 '직접 번역' 표식이 서고 경고가 뜬다(사실이 아닌 경고).
      // 권장 문안이 아직 빈 줄은 걷지 않는다 — 그 값이 곧 그 언어의 유일한 번역이라, 걷으면
      // 운영자가 손으로 친 문안이 저장 한 번에 사라진다(isCustomVarTranslation 이 거짓을 답한다).
      const spec = translationVarSpecByKey(k)
      if (spec && spec.recommended[lang] && !isCustomVarTranslation(lang, spec, v)) { delete dict[k]; continue }
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
