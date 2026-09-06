// 발급 서류에 찍을 성명 정본 — 한글·영문·현지 표기 중 무엇을 인쇄할지 한 곳에서 정한다.
//
// 고객 정보에 `Tenant.englishName` 칸이 있는데 어떤 서류도 읽지 않았다. 502호에서 출입국 제출용
// 영문 계약서가 필요해지자 운영자가 `Tenant.name` 자체를 영문으로 갈아엎었고, 그 순간 앱 전체에서
// 한글 이름이 사라졌다(2026-08-11). 서류가 표기를 고를 수 있으면 원천을 갈아엎을 이유가 없다.
//
// 현지 표기(`Tenant.nativeName`)는 그다음 문제였다. 그 나라 이름의 발음은 그 나라 표기법이 가장
// 정확하다 — Nguyen 과 Nguyễn 은 다른 이름이고, 중국 이름은 로마자만으로 한자를 되짚을 수 없다.
//
// **저장하는 것은 이름이 아니라 선택이다.** 이름 문자열을 서류 칸에 복사해 두면 고객 정보에서
// 철자를 고쳐도 서류만 옛 값에 붙박인다(표시값 오버라이드가 늘 안고 있는 위험). 'ko' | 'en' |
// 'native' 한 낱말만 남기면 인쇄값은 언제나 지금의 고객 정보에서 다시 조립된다.
//
// 세 서류(계약서·실거주 확인서·납부확인서·보증금영수증)가 이 파일 하나를 쓴다. 표기 규칙을
// 서류마다 두면 같은 사람이 서류마다 다른 이름으로 나간다.

/** 표기 선택지. 저장·전송되는 값이라 짧은 코드로 두고, 사람 말은 아래 라벨이 맡는다. */
export const DOC_NAME_STYLES = ['ko', 'en', 'native'] as const
export type DocNameStyle = (typeof DOC_NAME_STYLES)[number]

/** 고르지 않았을 때의 표기. 기존 입주자 전원이 이 값이라 화면·종이가 1비트도 안 바뀐다. */
export const DEFAULT_DOC_NAME_STYLE: DocNameStyle = 'ko'

/** 화면 라벨. 세 서류가 같은 낱말을 써야 같은 기능으로 읽힌다. */
export const DOC_NAME_STYLE_LABEL: Record<DocNameStyle, string> = { ko: '한글', en: '영문', native: '현지' }

/** 성명 조립에 필요한 최소 모양 — 고객 정보의 세 칸. */
export type DocumentNameSource = {
  name: string
  englishName?: string | null
  nativeName?: string | null
}

/** 저장된 값·폼 값에서 표기를 읽는다. 알 수 없는 값은 undefined 로 버린다(화이트리스트). */
export function asDocNameStyle(v: unknown): DocNameStyle | undefined {
  return v === 'ko' || v === 'en' || v === 'native' ? v : undefined
}

// ── 서류가 그릴 수 있는 글자 ──────────────────────────────────────
//
// 계약서 PDF 는 Pretendard 한 벌만 심고(lib/contractPrintHtml), 헤드리스 런타임에 깔린 폰트는
// Open Sans 셋뿐이다(@sparticuz/chromium bin/fonts.tar.br). 그 둘이 못 그리는 글자는 종이에서
// 네모(tofu)로 나간다 — 이름이 틀린 서류보다 나쁘다.
//
// 아래 구간은 PretendardVariable.woff2 의 cmap 을 직접 세어 뽑았다(2026-08-11 실측).
//   그림:   라틴 전체·라틴 확장 A/B·IPA·수식 문자·결합 발음기호·키릴·베트남어 확장
//           (1E00–1EFF 256/256)·가나·한글 음절(AC00–D7A3 11172/11172)
//   못 그림: 한자(4E00–9FFF 0/20992)·아랍(0/256)·태국(1/128)·데바나가리(0/128)
//           ·키릴 보충(1/48)·반각 가나(0/63)
//
// 코드포인트 숫자로 적는 이유 — 소스에 눈에 안 보이는 글자를 두지 않기 위해서다.
// 구간 안에서 몇 자 빠진 것은 MISSING_CODEPOINTS 로 낱글자까지 걸러낸다.
const PRINTABLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0020, 0x007e],   // Basic Latin (95/95)
  [0x00a0, 0x00ff],   // Latin-1 Supplement (96/96)
  [0x0100, 0x036f],   // Latin Ext-A/B · IPA · 수식 문자 · 결합 발음기호
  [0x0400, 0x04ff],   // Cyrillic (254/256)
  [0x1e00, 0x1eff],   // Latin Extended Additional — 베트남어 성조 (256/256)
  [0x3040, 0x30ff],   // 히라가나 · 가타카나
  [0xac00, 0xd7a3],   // 한글 음절 (11172/11172)
]
const MISSING_CODEPOINTS = new Set([
  0x0149, 0x01c4,                                  // Latin Ext-A/B 결번
  0x031f, 0x0320,                                  // 결합 발음기호 결번
  0x049e, 0x049f,                                  // 키릴 결번
  0x3040, 0x3095, 0x3096, 0x3097, 0x3098, 0x309f,  // 히라가나 결번
  0x30a0, 0x30ff,                                  // 가타카나 결번
])

/**
 * 발급 서류가 이 문자열을 글자 그대로 그릴 수 있는가.
 *
 * 폰트를 더 심지 않는 이유 — 한자 한 벌만 해도 함수 번들이 열 배가 되고(콜드 스타트·자립 검사
 * 명단까지 따라온다), 얻는 것은 표기 선택지 하나다. 못 그리는 글자가 섞이면 그 선택지를 아예
 * 안 띄우는 쪽을 골랐다. 값은 고객 정보에 그대로 남아 화면에서는 보인다.
 */
export function printableInDocuments(s: string): boolean {
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0
    if (MISSING_CODEPOINTS.has(cp)) return false
    if (!PRINTABLE_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi)) return false
  }
  return true
}

// 눈에 보이지 않는 글자 — 제어문자·zero-width·양방향 재정의. 성명 칸에 섞이면 화면에 없는
// 값이 저장되고, 양방향 재정의는 표시 순서까지 뒤집는다. 저장 전에 걷어낸다.
const INVISIBLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x001f], [0x007f, 0x009f],   // C0 · C1 제어문자
  [0x200b, 0x200f], [0x2028, 0x2029],   // zero-width · 줄/문단 구분자
  [0x202a, 0x202e], [0x2060, 0x2069],   // 양방향 재정의 · 서식 문자
]

/** 현지 표기 이름 길이 상한. 이름 칸이라 넉넉하되 무한하지 않다. */
export const NATIVE_NAME_MAX = 60

/**
 * 현지 표기 이름 입력 정리 — 저장 직전 한 곳에서만 부른다.
 * 보이지 않는 글자를 걷고 공백을 하나로 줄인다. 남는 것이 없거나 상한을 넘으면 null 이다.
 * 상한 초과를 잘라 담지 않는 이유는 잘린 이름이 곧 틀린 이름이기 때문이다.
 */
export function sanitizeNativeName(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const kept = Array.from(v).filter(ch => {
    const cp = ch.codePointAt(0) ?? 0
    return !INVISIBLE_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi)
  })
  const cleaned = kept.join('').replace(/\s+/g, ' ').trim()
  if (!cleaned || Array.from(cleaned).length > NATIVE_NAME_MAX) return null
  return cleaned
}

/**
 * 이 입주자에게 띄울 표기 선택지.
 *
 * **선택 UI 를 그릴지 말지의 유일한 기준이다.** 한글 이름밖에 없는 입주자(실측 103명 중 85명)의
 * 화면은 이 기능이 들어오기 전과 완전히 같아야 한다 — 그 사람들은 길이 1 을 받아 아무것도 안 그린다.
 * 현지 표기는 서류가 그릴 수 있을 때만 낀다(printableInDocuments).
 */
export function docNameStyles(src: DocumentNameSource): DocNameStyle[] {
  const out: DocNameStyle[] = ['ko']
  if (src.englishName?.trim()) out.push('en')
  const nv = src.nativeName?.trim()
  if (nv && printableInDocuments(nv)) out.push('native')
  return out
}

/**
 * 서류에 찍을 성명.
 * 고른 표기의 이름이 비어 있으면 아래로 물러난다(현지 → 영문 → 한글) — 성명 칸이 빈 서류가
 * 관청에 나가는 것이 표기가 틀린 서류보다 나쁘다. 고객 정보에서 영문·현지 이름을 지운 뒤
 * 옛 선택이 남아 있는 경우가 그것이다.
 */
export function documentName(src: DocumentNameSource, style: DocNameStyle | null | undefined): string {
  if (style === 'native') {
    const nv = src.nativeName?.trim()
    if (nv && printableInDocuments(nv)) return nv
  }
  if (style === 'en' || style === 'native') {
    const en = src.englishName?.trim()
    if (en) return en
  }
  return src.name
}

/**
 * 서명이 끝난 계약이 서야 할 표기. **다시 해석하지 않는다.**
 *
 * 인자에 국적·형제 서류·사람 단위 값이 아예 없는 것이 이 함수의 계약 조건이다. 그 셋은 "지금
 * 무엇이 맞는가"를 답하는데, 서명한 종이가 묻는 것은 "그때 무엇이었나"다. 시그니처로 봉인해
 * 두면 다음 사람이 여기에 국적 추정을 얹을 자리 자체가 없다.
 *
 * 왜 생겼나(신고 2026-09-04, 413호). 서명 후 경로가 `contractLeaseFields` 의 병합값을 읽고
 * 있었다. 그 값은 자동값 'ko' 가 깔려 있어 **"안 골랐음"과 "한글을 골랐음"이 같은 답**이 된다.
 * 그래서 영문 화면에서 서명한 계약이 서명이 저장되는 순간 한글로 되돌아갔고, 그 상태로 발급됐다.
 */
export type SignedNameStyleContext = {
  /**
   * 이 계약서에 저장된 표기 오버라이드. 서명과 함께 잠기므로(saveContractFieldOverride 의
   * isSignatureLocked) 값이 있다면 그것은 서명 전에 운영자가 고른 것이다.
   */
  saved?: DocNameStyle | null
  /** 서명 시점 박제가 들고 있는 표기(LeaseTerm.signedContractSnapshot.nameStyle). */
  signed?: DocNameStyle | null
}

export function signedDocNameStyle(ctx: SignedNameStyleContext): DocNameStyle {
  return asDocNameStyle(ctx.saved) ?? asDocNameStyle(ctx.signed) ?? DEFAULT_DOC_NAME_STYLE
}

// ── 표기 이어받기 ────────────────────────────────────────────────
//
// 한 사람의 서류는 같은 표기로 나가야 한다(운영자 확정 2026-08-29 — "계약서를 영어로 발급하면
// 거주확인서도 영어로 발급을 해야하거든"). 계약서만 로마자이고 실거주 확인서가 한글이면 두
// 종이가 같은 사람 것으로 안 읽힌다. 제출처에서 되돌려 보내는 일이 생긴다.
//
// 그래서 기본값을 이 순서로 정한다.
//   1. 이 서류에 이미 저장된 표기
//   2. 없으면 같은 계약의 다른 서류가 쓴 표기 중 가장 최근 것
//   3. 없으면 고객 정보에 못박아 둔 사람 단위 표기(Tenant.docNameStyle)
//   4. 그것도 없고 외국인이면 영문
//   5. 나머지는 한글
//
// 4번이 2번보다 아래인 이유. 운영자가 한 번이라도 손으로 고른 것은 국적 추정보다 세다.
// 외국인인데 한글 이름으로 내기로 정했으면 그 결정이 다음 서류에도 이어져야 한다.
//
// 3번(사람 단위)이 2번(형제 서류)보다 아래인 이유는 운영자 결정이다(2026-09-03). "한 사람의 서류는
// 같은 표기로" 가 더 세다 — 영문 계약서가 이미 나간 계약에서 거주확인서만 한글로 나가면 제출처가
// 되돌려 보낸다. 사람 단위 값은 **강제가 아니라 기본값 공급자**이고, 국적 추정의 자리를 대신한다.

/** 한국 국적인가 — 표기 기본값을 가르는 데만 쓴다. 비어 있으면 내국인으로 본다(종전 거동 유지). */
export function isKoreanNationality(nationality: string | null | undefined): boolean {
  const v = (nationality ?? '').trim()
  if (!v) return true
  return v === '대한민국' || v === '한국' || /^(korea|republic of korea|south korea|kr)$/i.test(v)
}

/**
 * 이 사람이 외국인인가 — 서류 표기 기본값을 가르는 데만 쓴다.
 *
 * 국적만 보던 것에 외국인등록번호 보유를 OR 로 더한다(운영자 요청 2026-09-03 — "외국인등록번호가
 * 입력되어 있거나 국적이 대한민국이 아닌 경우"). 실측 시점에 두 조건의 합집합은 국적 단독과 같아
 * 바뀌는 사람이 없지만, 국적을 비운 채 번호부터 넣는 입력 순서가 실제로 가능하다.
 *
 * 번호는 **존재 비트만** 본다. 평문을 꺼내는 문(lib/pii readStoredForeignRegNo)과 열람 기록은
 * 여기 오지 않는다 — 서류가 표기를 고르는 일에 사람의 번호를 읽을 이유가 없다.
 */
/**
 * 정보 표 '전입신고' 칸 머리 — 외국인 계약서는 '체류지 변경신고'다(운영자 오더 2026-09-07).
 * 외국인은 주민등록 전입신고 대상이 아니라 출입국관리법 제36조의 체류지 변경신고를 한다.
 * 영문은 공식 영역(Report on Change of Sojourn Place)의 약어 — 'Resident Reg.' 와 같은 결.
 * 화면(ContractView)과 종이(contractPrintHtml)가 이 한 함수를 지나 갈릴 수 없다.
 */
export function registrationHeadPair(foreign: boolean): { ko: string; en: string } {
  return foreign
    ? { ko: '체류지 변경신고', en: 'Sojourn Change Rpt.' }
    : { ko: '전입신고', en: 'Resident Reg.' }
}

export function isForeignForDocuments(src: { nationality?: string | null; hasForeignRegNo?: boolean }): boolean {
  return !!src.hasForeignRegNo || !isKoreanNationality(src.nationality)
}

/**
 * 고객 정보 폼에서 외국인 전용 칸(현지 표기 이름·외국인등록번호·해외 연락처)을 띄우는가.
 *
 * 폼이 `nationality !== '대한민국'` 을 직접 비교하고 있었다. 그러면 국적을 '한국'이나 'Korea' 로
 * 적은 사람이 폼에서는 외국인, 서류 기본값에서는 내국인으로 갈린다. 판정을 여기 한 곳으로 모은다.
 *
 * **빈 값의 답은 위 함수와 일부러 다르다.** 서류는 안 고른 국적을 내국인으로 보고(종이에 찍히는
 * 것이라 추정이 세면 안 된다), 폼은 아직 안 고른 것이니 칸을 숨기지 않는다. 국적을 나중에 고르는
 * 입력 순서에서 칸이 사라지면 값을 넣을 자리가 없다.
 */
export function showsForeignFields(nationality: string | null | undefined): boolean {
  const v = (nationality ?? '').trim()
  if (!v) return true
  return !isKoreanNationality(v)
}

export type DocNameStyleContext = {
  /** 이 서류에 저장된 표기. 운영자가 이 서류에서 이미 고른 값이다. */
  saved?: DocNameStyle | null
  /**
   * 같은 계약의 다른 서류가 쓴 표기 — **최근 순으로** 넘긴다. 첫 값이 이긴다.
   * 값이 없는 서류는 빼고 넘긴다(안 고른 것과 한글을 고른 것은 다르다).
   */
  siblings?: readonly DocNameStyle[]
  /**
   * 고객 정보에 못박아 둔 사람 단위 표기(Tenant.docNameStyle). null·undefined 는 '자동'이라
   * 아래 국적 추정으로 넘어간다. 후보에 없는 값은 여기서도 안 고른다.
   */
  tenant?: DocNameStyle | null
  nationality?: string | null
  /** 외국인등록번호를 가지고 있는가 — 존재 비트만. 국적과 OR 로 외국인 판정에 든다. */
  hasForeignRegNo?: boolean
  /** 이 사람이 실제로 고를 수 있는 표기(docNameStyles). 후보에 없는 값은 안 고른다. */
  available: readonly DocNameStyle[]
}

/** 이 서류를 열었을 때 처음 서 있어야 할 표기. */
export function resolveDocNameStyle(ctx: DocNameStyleContext): DocNameStyle {
  const can = (s: DocNameStyle | null | undefined): s is DocNameStyle =>
    !!s && ctx.available.includes(s)
  if (can(ctx.saved)) return ctx.saved
  const sib = (ctx.siblings ?? []).find(can)
  if (sib) return sib
  // 사람 단위로 못박은 표기. 고객 정보에서 영문 이름을 지웠으면 후보에서 빠져 여기서도 안 선다.
  if (can(ctx.tenant)) return ctx.tenant
  // 영문 이름이 없으면 외국인이어도 영문을 고를 수 없다 — 후보에 없는 값을 기본으로 세우지 않는다.
  const foreign = isForeignForDocuments({ nationality: ctx.nationality, hasForeignRegNo: ctx.hasForeignRegNo })
  if (foreign && ctx.available.includes('en')) return 'en'
  return DEFAULT_DOC_NAME_STYLE
}

/**
 * 앞 서류와 다르게 고르는가 — 되묻기를 띄울지 가른다.
 *
 * 되묻는 것은 **앞이 있는데 다를 때**뿐이다. 처음 뽑는 서류에는 비교 대상이 없고, 같은 값을
 * 고르는 것은 확인할 일이 아니다. 후보에 없는 값도 묻지 않는다(고를 수 없으니 상황이 아니다).
 */
export function docNameStyleConflict(
  next: DocNameStyle,
  siblings: readonly DocNameStyle[],
): DocNameStyle | null {
  const prev = siblings.find(Boolean)
  return prev && prev !== next ? prev : null
}

