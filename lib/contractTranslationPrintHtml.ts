// 참고용 번역본을 종이(A4)로 뽑는 self-contained HTML — 검수용이지 계약서가 아니다.
//
// 쓰임이 무엇인가(운영자 오더 2026-09-17). "난 한자를 못읽기 때문에 알수가 없어" — 화면의
// 미리보기는 창을 끄면 사라지고, 그 번역이 맞는지 읽을 줄 아는 사람에게 보낼 길이 없었다.
// 이 종이는 **그 사람에게 보내 물어보기 위한 것**이다. 입주자용도 아니고 계약서도 아니며
// 앱에 보관되지도 않는다.
//
// **폰트 실패에 부분 성공이 없다**(getPretendardBase64 와 일부러 규칙이 다르다). 계약서 쪽은
// 폰트를 못 구해도 발급을 막지 않는다 — 한국어가 깨져도 운영자가 눈으로 알아채기 때문이다.
// 여기는 반대다. 운영자가 한자·벵골 글자를 못 읽으므로 **두부(□)와 정상 글자를 구별하지
// 못한다.** 네모로 찍힌 종이를 검수자에게 보내면 검수자는 번역이 틀렸다고 답하고, 그 답은
// 거짓이다. 그래서 글꼴을 못 읽으면 여기서 멈춘다(라우트가 503 으로 답한다).
//
// 조판은 **계약서와 일부러 다르다**(운영자 확정, checklist 12번 — "계약서와 동일한 포맷으로
// 하면 오히려 헷갈릴 수 있으므로"). 계약서는 2단 조판에 헤더 밴드·정보표·서명란·워드마크가
// 있고, 이 종이는 1단이고 그것들이 하나도 없다. 그래서 여기에 **없는 것들**이 규칙이다.
//   · 계약번호를 절대 찍지 않는다. 소비되지 않은 번호가 종이로 나간 E페이즈 사고가 있었다.
//   · 로고·도장·서명란·워드마크·정보표·영업장명이 없다.
//   · 입주자 이름·생년월일·등록번호·금액표가 없다. 조항 안에서 그 조항이 제 뜻으로 말하는
//     자리표시자는 **치환하지 않고 그대로 둔다** — 계약이 없는 자리라 값을 지어내면 거짓이다.
//     그 사실은 종이 머리의 검수 안내 한 줄이 말한다(ContractTranslationView 의 vars 규칙과 같다).
//
// 순수 함수 + fs 읽기뿐이다. DB 도 네트워크도 없다.

import {
  appendSubLeaseAddendum, renderContractText, stripClauseBullet,
  type ContractTemplate, type SubLeaseAddendum,
} from '@/lib/contract'
import {
  TRANSLATION_LANG_ENDONYM, translationNoticeBi, translationSourceLines,
  TRANSLATION_PRINT_MARK, TRANSLATION_PRINT_PROGRESS_LEFT, TRANSLATION_PRINT_PROGRESS_MARKED,
  TRANSLATION_PRINT_PROGRESS_ALL, TRANSLATION_PRINT_VAR_GUIDE,
  TRANSLATION_PRINT_HEAD, TRANSLATION_PRINT_FOOTER,
  type ResolvedContractTranslation, type TranslationLang,
} from '@/lib/contractTranslation'
import { kstYmdStr } from '@/lib/kstDate'
import { PRINT_HEX } from '@/lib/printTokens'   // v2.0 §26 인쇄 토큰 단일 출처

/**
 * 그 언어를 종이에 세우려면 Pretendard 위에 무엇을 더 실어야 하는가.
 * `null` 은 "Pretendard 로 충분하다"는 **판정**이지 빈 값이 아니다.
 *
 * Pretendard 를 fontTools 로 열어 센 실측(2026-09-17)이 근거다.
 *   · 키릴 254/256 · 라틴확장추가(U+1E00~1EFF, 베트남어 성조) 256/256 전량이라 ru·vi·en 은 이것뿐
 *   · CJK 한자(U+4E00~9FFF) **0자** · 벵골(U+0980~09FF) **0자**. ja·zh·zht·bn 은 Noto 를 얹는다
 *
 * **Record 전량 선언이다. Partial 금지**(TRANSLATION_NOTICE·TRANSLATION_LANG_ENDONYM 선례).
 * 언어가 늘었는데 이 판정을 안 적으면 tsc 가 컴파일을 막는다 — 그것이 누락 감지망이다.
 * 빠뜨린 채 배포되면 그 언어의 종이가 통째로 네모로 나가고, 운영자는 그것을 못 읽는다.
 */
export const TRANSLATION_SCRIPT_FONT: Record<TranslationLang, string | null> = {
  en: null,
  vi: null,
  ru: null,
  ja: 'NotoSansJP-Regular.woff2',
  zh: 'NotoSansSC-Regular.woff2',
  zht: 'NotoSansTC-Regular.woff2',
  bn: 'NotoSansBengali-Regular.woff2',
}

/** 그 언어 폰트가 CSS 에서 불리는 이름. 한 종이에 한 벌만 실리므로 이름도 하나면 된다. */
const SCRIPT_FAMILY = 'TranslationScript'

/** Pretendard 가변 woff2 — 한국어 고지와 원문 잔존 줄이 **어느 언어에서도** 함께 선다. */
const PRETENDARD_FILE = 'PretendardVariable.woff2'

// 모듈 레벨 캐시 — 콜드 스타트 후 첫 종이에서만 파일을 읽는다. 파일명이 곧 열쇠다(넷 다 다르다).
const fontCache = new Map<string, string>()

/**
 * 그 언어의 글꼴 바이트(base64). 지도가 null 이면 null 이다 — 그것은 실패가 아니다.
 *
 * **CDN 폴백이 없다. 못 읽으면 예외를 던진다.** 파일 머리 주석의 이유 그대로다.
 *
 * 폴더 이름을 변수로 넘기지 않는다. 번들 추적기(NFT)가 `path.join(process.cwd(), 변수, …)` 를
 * 만나면 "프로젝트 전체를 읽는다"로 보고 함수 번들에 저장소를 통째로 싣는다(빌드 경고 실측).
 * 앞 두 칸은 리터럴이라야 하고 마지막 한 칸만 변수여도 된다.
 */
export async function translationScriptFontBase64(lang: TranslationLang): Promise<string | null> {
  const file = TRANSLATION_SCRIPT_FONT[lang]
  if (!file) return null
  const hit = fontCache.get(file)
  if (hit) return hit
  const { readFile } = await import('node:fs/promises')
  const path = await import('node:path')
  const b64 = Buffer.from(await readFile(path.join(process.cwd(), 'public', 'fonts-i18n', file))).toString('base64')
  fontCache.set(file, b64)
  return b64
}

/** 한국어 줄을 세우는 글꼴. 위와 같은 규칙으로 **못 읽으면 예외를 던진다**. */
export async function translationPretendardBase64(): Promise<string> {
  const hit = fontCache.get(PRETENDARD_FILE)
  if (hit) return hit
  const { readFile } = await import('node:fs/promises')
  const path = await import('node:path')
  const b64 = Buffer.from(await readFile(path.join(process.cwd(), 'public', 'fonts', PRETENDARD_FILE))).toString('base64')
  fontCache.set(PRETENDARD_FILE, b64)
  return b64
}

/**
 * 모든 장 꼬리말에 서는 문장 — **한국어 줄 + 그 언어 줄**이다.
 *
 * 뒤쪽을 그 언어로 가는 이유. 머리만 고치면 **2장부터 검수자가 아무것도 못 읽는다** — 이 종이는
 * 번역 전문이라 두 장 넘기기가 보통이고, 꼬리말은 2장 이후 유일한 표식이다.
 * 한국어를 남기는 이유는 운영자가 자기 손의 종이를 알아봐야 해서다(그가 못 읽는 언어로만 적으면
 * 어느 언어의 검수본인지도 종이 위에서 못 읽는다).
 */
export function translationPrintFooterText(lang: TranslationLang): string {
  return `참고용 번역본 · 계약서 아님 / ${TRANSLATION_PRINT_FOOTER[lang]}`
}

/** 종이 머리에 서는 문장. 꼬리말과 같은 말을 하되 첫 줄에서 먼저 말한다. 같은 병기 규칙이다. */
function translationPrintHeadText(lang: TranslationLang): string {
  return `참고용 · 계약서 아님 / ${TRANSLATION_PRINT_HEAD[lang]}`
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * 모든 장에 서는 꼬리말 — puppeteer 의 footerTemplate 이다.
 *
 * 본문 HTML 밖에서 그려지는 **독립 문서**라 글꼴을 자기가 다시 들어야 한다(계약서 라우트의
 * 꼬리말과 같은 사정). 꼬리말이 그 언어로 가면서 **그 언어 글꼴도 여기 한 벌 더 실린다** —
 * 본문에 실린 벌은 이 문서에 안 닿는다. 안 실으면 2장 이후 유일한 표식이 통째로 두부가 되고,
 * 운영자는 그것을 못 읽는다(파일 머리 주석의 '부분 성공 없음'이 이 자리에서만 되살아난다).
 *
 * **재고 정한 것이다**(2026-09-17 실측, 로컬 Chrome). 최악인 zh 가 본문 7.93MB + 꼬리말 7.93MB
 * 이고 setContent 663ms · pdf 571ms 라 25초 상한과 maxDuration 60초 예산 안에 넉넉히 든다.
 * 글꼴을 더 키울 일이 생기면 여기를 다시 재라.
 *
 * **페이지 번호는 2장 이상일 때만 붙는다**(§26 "페이지 번호는 2p 이상만"). 한 장짜리에 `1 / 1`
 * 을 찍으면 셀 것이 없는 자리에 숫자를 두는 일이고, 형제 계약서 라우트는 장수를 센 뒤 2장부터만
 * 붙인다(app/api/contract/generate/route.ts) — 두 종이가 같은 자리에서 다르게 행동하면 안 된다.
 * 장수는 부르는 쪽만 알 수 있으므로 `withPageNumber` 로 받는다. 참고용 표식은 장수와 무관하게
 * 항상 선다(scripts/check-translation-print.mjs 축 5).
 */
export function buildTranslationPrintFooterTemplate(
  lang: TranslationLang,
  pretendardBase64: string,
  scriptFontBase64: string | null,
  withPageNumber = true,
): string {
  // 본문과 **같은 순서**다(bodyFamily). 순서가 갈리면 한 낱말이 두 서체에 나뉘어 그려진다.
  const scriptFace = scriptFontBase64
    ? `@font-face{font-family:'${SCRIPT_FAMILY}';font-weight:400;font-style:normal;font-display:block;src:url(data:font/woff2;base64,${scriptFontBase64}) format('woff2');}`
    : ''
  const family = scriptFontBase64 ? `'${SCRIPT_FAMILY}','Pretendard',sans-serif` : `'Pretendard',sans-serif`
  return `<style>${scriptFace}@font-face{font-family:'Pretendard';src:url(data:font/woff2;base64,${pretendardBase64}) format('woff2-variations');font-weight:45 920}*{margin:0;padding:0}</style>`
    + `<div style="font-family:${family};font-size:8pt;color:${PRINT_HEX.inkMuted};width:100%;padding:0 16mm;display:flex;justify-content:space-between;align-items:center;">`
    + `<span>${escape(translationPrintFooterText(lang))}</span>`
    + (withPageNumber
      ? `<span style="font-variant-numeric:tabular-nums"><span class="pageNumber"></span> / <span class="totalPages"></span></span>`
      : '')
    + `</div>`
}

export type TranslationPrintOptions = {
  /** 같은 해석에 쓴 한국어 본문. 번역이 없어 원문이 남은 줄에 표식을 달 때만 쓴다. */
  source: ContractTemplate
  /** 그 영업장의 가변 절(치환 전 한국어). 위와 같이 표식용이다. */
  sourceAddenda?: readonly SubLeaseAddendum[]
  /** Pretendard 가변 woff2 base64. 빈 문자열을 넘기지 마라 — 부르는 쪽이 이미 503 으로 막는다. */
  pretendardBase64: string
  /** 그 언어의 글꼴 base64. null 은 "Pretendard 로 충분하다"는 판정이다. */
  scriptFontBase64: string | null
  /** 만든 날짜(KST). 안 주면 지금이다 — 종이가 언제 뽑힌 검수본인지 말한다. */
  today?: string
}

/**
 * 번역이 없어 한국어 원문이 그대로 남은 줄인가.
 *
 * 판정은 **같은 해석에 들어간 한국어 본문과의 대조**다(사전 재조회가 아니다). 해석이 template 을
 * 그대로 map 한 결과라 절·항목 개수가 안 줄어들어 index 가 1:1 로 맞는다
 * (ContractTranslationView 의 sameAsSource 와 같은 규칙 · 같은 판정).
 */
function sameAsSource(translated: string, source: string | undefined): boolean {
  return !!source && translated === source
}

/**
 * 검수용 종이 한 벌. A4 1단이고 계약서와 서식이 다르다.
 *
 * `chromium.font()` 는 쓰지 않는다 — fontconfig 가 woff2 를 못 읽는다. `@font-face` + `data:` URL 이
 * 유일한 길이고 계약서가 이미 그 길이다(scripts/check-print-selfcontained.ts 축 1 이 지킨다).
 */
export function buildContractTranslationPrintHtml(
  t: ResolvedContractTranslation,
  opts: TranslationPrintOptions,
): string {
  // 절 번호는 **종이와 같은 정본이 매긴다**(appendSubLeaseAddendum). 여기서 손으로 세면 형제 절이
  // 하나 늘 때마다 이 종이만 번호가 밀려, "몇 조 몇 항"이 두 종이에서 다른 곳을 가리킨다.
  // 번역본과 원문을 같은 함수로 세워 인덱스가 1:1 로 맞고, 표식 판정이 그 위에 선다.
  const sections = appendSubLeaseAddendum(t.sections, ...(t.addenda ?? []))
  const srcSections = appendSubLeaseAddendum(
    Array.isArray(opts.source?.sections) ? opts.source.sections : [],
    ...(opts.sourceAddenda ?? []),
  )

  // 계약이 없는 자리라 **종이 vars 가 없다.** 해석이 제 값을 들고 온 변수(환불 규정·청소비 문장)만
  // 채우고 나머지 {{ }} 는 글자 그대로 남는다 — 화면 미리보기(ContractTranslationBody 에 vars 를
  // 안 넘기는 그 호출)와 **문자 단위로 같은 결과**다. 값을 지어내면 그것은 검수가 아니라 거짓이다.
  const renderVars = t.vars ?? null
  const render = (s: string): string => (renderVars ? renderContractText(s, renderVars) : s)

  // 줄바꿈 규칙은 언어가 정한다(ContractTranslationView 와 같은 판정). 일본어·중국어는 띄어쓰기가
  // 없어 keep-all 이면 문장 하나가 끊을 수 없는 한 덩어리가 되어 칸 밖으로 흘러 잘린다.
  const noSpaceScript = t.lang === 'ja' || t.lang === 'zh' || t.lang === 'zht'
  const wordBreak = noSpaceScript ? 'normal' : 'keep-all'

  // 글꼴 선언. 그 언어 폰트가 **앞**이라야 한 낱말이 두 서체에 갈리지 않는다 — 일본어 낱말에서
  // 가나는 Pretendard 가, 한자는 Noto 가 그리는 일이 그것이다. Pretendard 는 어느 언어에서도
  // 빠지지 않는다(한국어 고지 줄과 원문 잔존 줄이 항상 함께 선다).
  const scriptFace = opts.scriptFontBase64
    ? `@font-face{font-family:'${SCRIPT_FAMILY}';font-weight:400;font-style:normal;font-display:block;src:url(data:font/woff2;base64,${opts.scriptFontBase64}) format('woff2');}`
    : ''
  const bodyFamily = opts.scriptFontBase64
    ? `'${SCRIPT_FAMILY}', 'Pretendard', sans-serif`
    : `'Pretendard', sans-serif`

  // 세는 낱말은 **검수자가 종이에서 셀 수 있는 덩어리**라야 한다(독립 검수 2026-09-17 실측).
  // `t.totalCount` 는 줄이 아니라 사전 열쇠 수라 **변수 줄까지 든다.** 변수 줄은 조항 *안*에
  // 치환돼 들어가 종이에 독립된 줄로 안 서므로, 그 수를 찍으면 검수자가 세어서 못 맞추는 숫자가
  // 된다(기본 템플릿 실측 — 열쇠 53 · 라우트 해석 50 · 종이에 서는 덩어리 49).
  // 그래서 여기서 **변수 줄을 뺀 수를 다시 센다.** 변수 줄은 환불·청소비 인자를 넘길 때만 서므로
  // 그 인자를 안 넘기면 제목·절 제목·항목·서약문만 나온다 — 그것이 곧 종이에 서는 덩어리다.
  // 검수자가 세어서 안 맞는 숫자는 그 자체로 "이 종이 어딘가 잘못됐다"는 신호가 되어야 한다.
  //
  // 낱말도 `줄` 이 아니라 `항목` 이다. 항목 하나가 종이에서 2~3줄로 접히므로 "53줄"을 믿고 세면
  // 150쯤 나온다.
  const total = translationSourceLines(opts.source, opts.sourceAddenda).length
  // `{남은}` 은 그대로 `fallbackCount` 다. 권장 번역이 7언어 × 4자리 전부 차 있어 변수 줄은
  // 여기 절대 안 든다(translationLineDone) — 부푼 것은 총수 하나뿐이었다.
  const left = t.fallbackCount

  // 표식은 **그 언어 단독**이다. 한국어 `원문` 을 안 남긴다 — 그 낱말이 검수자가 못 읽는 지시의
  // 원인이었다. 아래 진행 둘째 문장이 이 표를 그대로 인용하므로 표를 고칠 때는 짝으로 고친다.
  //
  // 강조 마커(**…**)는 계약서 종이처럼 색으로 바꾸지 않고 글자 그대로 둔다. 검수자가 보는 것이
  // 곧 사전에 저장된 문자열이라야 하고, 화면 미리보기도 그대로 보인다 — 두 창이 갈리면 안 된다.
  const markText = TRANSLATION_PRINT_MARK[t.lang]
  const mark = `<span class="src-mark">${escape(markText)}</span>`

  // 진행 두 줄. 검수자가 "왜 여기만 한국어인가"를 묻기 전에 종이가 먼저 답한다.
  //
  // **한국어 줄을 지우지 마라.** 운영자가 한자·벵골 글자를 못 읽으므로, 그 언어 줄만 두면 자기가
  // 뽑은 종이의 숫자를 자기가 못 읽는다 — 이 기능이 생긴 그 말("난 한자를 못읽기 때문에 알수가
  // 없어")이 이 한 줄에서 그대로 되살아난다.
  const fillCount = (s: string) =>
    s.replace(/\{총\}/g, String(total)).replace(/\{남은\}/g, String(left))
  const progressKo = left > 0
    ? `전체 ${total}개 항목 중 ${left}개가 한국어 원문으로 남았습니다. 회색 '${markText}' 표식이 붙은 항목입니다.`
    : `${total}개 항목이 모두 번역되었습니다.`
  // 두 문장을 잇는 한 칸은 언어가 정한다 — 일본어·중국어는 문장 사이를 안 띄운다.
  const progressTr = left > 0
    ? fillCount(TRANSLATION_PRINT_PROGRESS_LEFT[t.lang])
      + (noSpaceScript ? '' : ' ') + TRANSLATION_PRINT_PROGRESS_MARKED[t.lang]
    : fillCount(TRANSLATION_PRINT_PROGRESS_ALL[t.lang])
  const ymd = opts.today ?? kstYmdStr()
  const dateLabel = ymd.replace(/-/g, '.')

  const sectionsHtml = sections.map((sec, si) => {
    const lis = sec.items.map((item, ii) =>
      `<li>${escape(stripClauseBullet(render(item)))}${sameAsSource(item, srcSections[si]?.items?.[ii]) ? mark : ''}</li>`,
    ).join('')
    return `<section class="clause">`
      + `<h2 class="clause-h">${escape(render(sec.title))}${sameAsSource(sec.title, srcSections[si]?.title) ? mark : ''}</h2>`
      + `<ol class="clause-list">${lis}</ol></section>`
  }).join('')

  return `<!doctype html>
<html lang="${escape(t.lang)}">
<head>
<meta charset="utf-8" />
<title>참고용 번역본 ${escape(TRANSLATION_LANG_ENDONYM[t.lang])}</title>
<style>
  ${scriptFace}
  @font-face{font-family:'Pretendard';font-weight:45 920;font-style:normal;font-display:block;src:url(data:font/woff2;base64,${opts.pretendardBase64}) format('woff2-variations');}
  :root{
    --p-ink:${PRINT_HEX.ink}; --p-muted:${PRINT_HEX.inkMuted};
    --p-label-bg:${PRINT_HEX.labelBg}; --p-rule:${PRINT_HEX.rule}; --p-rule-strong:${PRINT_HEX.ruleStrong};
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    background: #fff; color: var(--p-ink);
    font-family: ${bodyFamily};
    word-break: ${wordBreak}; overflow-wrap: anywhere;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  body { widows: 2; orphans: 2; }

  /* 머리 한 줄 — 무엇인지 먼저 말한다. 헤더 밴드도 로고도 영업장명도 없다(파일 머리 주석). */
  .head { display: flex; justify-content: space-between; align-items: baseline; gap: 6mm; font-size: 8.5pt; color: var(--p-muted); padding-bottom: 2mm; }
  .head .what { font-weight: 600; color: var(--p-ink); }
  .head .meta { white-space: nowrap; }
  .head .lang { font-weight: 600; color: var(--p-ink); margin-right: 3mm; }
  .head-rule { height: 0.6pt; background: var(--p-rule-strong); margin-bottom: 4mm; }

  /* 고지 상자 — 문안은 코드 사전 정본 그대로다(translationNoticeBi). 한국어 줄이 앞선다. */
  .notice { border: 0.4pt solid var(--p-rule); background: var(--p-label-bg); padding: 3mm 4mm; font-size: 9pt; line-height: 1.6; white-space: pre-line; margin-bottom: 3mm; break-inside: avoid; }

  /* 검수 안내 · 진행 — 계약 조항이 아니라 **검수 지시문**이라 한국어 줄 + 그 언어 줄로 세운다.
     지시를 검수자가 못 읽으면 그 검수는 거짓을 내놓고, 한국어를 지우면 운영자가 못 읽는다. */
  .guide { font-size: 8.5pt; line-height: 1.55; color: var(--p-muted); margin-bottom: 1.5mm; }
  .progress { font-size: 8.5pt; line-height: 1.55; color: var(--p-muted); border-top: 0.4pt solid var(--p-rule); padding-top: 2mm; margin-bottom: 6mm; }
  .guide .tr, .progress .tr { display: block; }

  /* 본문 — 1단이다. 계약서는 2단이라 한눈에 다른 종이로 읽힌다. */
  .doc-title { font-size: 16pt; font-weight: 700; letter-spacing: -.02em; line-height: 1.3; margin-bottom: 5mm; }
  .clause { margin-bottom: 4mm; break-inside: auto; }
  .clause-h { font-size: 11pt; font-weight: 700; line-height: 1.35; margin-bottom: 1.8mm; break-after: avoid; }
  /* 번호는 자리에서 매긴다 — 본문에 박힌 글머리는 stripClauseBullet 이 걷는다(종이와 같은 정본). */
  .clause-list { list-style: none; counter-reset: clause; }
  .clause-list li { font-size: 9.5pt; line-height: 1.65; padding-left: 6mm; text-indent: -6mm; margin-bottom: 1.2mm; white-space: pre-line; break-inside: avoid; }
  .clause-list li::before { counter-increment: clause; content: counter(clause) "."; color: var(--p-muted); margin-right: 2mm; }
  .oath { font-size: 9.5pt; line-height: 1.65; margin-top: 5mm; padding-top: 3mm; border-top: 0.4pt solid var(--p-rule); white-space: pre-line; break-inside: avoid; }

  /* 원문으로 남은 줄의 표식. 색도 테두리도 없는 회색 글자 한 낱말이다(§29 장식 0).
     **font-family 를 못박지 마라.** 본문 family 를 물려받아야 한다 — 표식이 그 언어로 가면서
     Pretendard 를 지목하면 한자·벵골 표식이 이 자리에서만 통째로 두부가 되고(Pretendard 는
     한자 0자·벵골 0자, fontconfig 에 CJK 가 없어 폴백도 없다), 운영자는 그것을 못 읽는다. */
  .src-mark { font-size: 8.5pt; font-weight: 500; color: var(--p-muted); margin-left: 2mm; white-space: nowrap; }
</style>
</head>
<body>
  <div class="head">
    <span class="what">${escape(translationPrintHeadText(t.lang))}</span>
    <span class="meta"><span class="lang">${escape(TRANSLATION_LANG_ENDONYM[t.lang])}</span>${escape(dateLabel)}</span>
  </div>
  <div class="head-rule"></div>

  <div class="notice">${escape(translationNoticeBi(t.lang))}</div>

  <p class="guide">조항 안의 {{ }} 표시는 실제 계약서에서 값이 들어가는 자리라 이 종이에는 그대로 보입니다. 중괄호 안의 한국어는 그 자리의 항목 이름이지 번역이 안 된 문장이 아닙니다. 고장이 아닙니다.
    <span class="tr">${escape(TRANSLATION_PRINT_VAR_GUIDE[t.lang])}</span></p>
  <p class="progress">${escape(progressKo)}<span class="tr">${escape(progressTr)}</span></p>

  <h1 class="doc-title">${escape(render(t.title))}${sameAsSource(t.title, opts.source?.title) ? mark : ''}</h1>
  ${sectionsHtml}
  ${t.oathText ? `<p class="oath">${escape(render(t.oathText))}${sameAsSource(t.oathText, opts.source?.oathText) ? mark : ''}</p>` : ''}
</body>
</html>`
}
