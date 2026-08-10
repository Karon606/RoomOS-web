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
