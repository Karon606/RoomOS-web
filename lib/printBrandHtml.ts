// 자체 브랜딩 HTML 종이(v2.0 §26)의 공용 조각. 로고 머리띠·사업자정보·꼬리말·워드마크·쪽 번호 꼬리말.
//
// 계약서 종이(lib/contractPrintHtml)가 먼저 그렸고, 결산 보고서 종이(lib/reportPrintHtml)가 같은 조각을
// 쓴다(2026-10-26 운영자 결정, 브랜딩 켜기). 두 종이가 각자 그리면 한쪽만 고쳐져 같은 영업장의
// 서류 머리가 서로 다르게 생긴다. 계약서 종이로 뽑은 HTML 은 이 추출 전과 바이트까지 같다.
//
// CSS 조각은 계약서 템플릿에서 놓여 있던 자리 그대로 끼워 넣도록 줄 단위(앞 두 칸 들여쓰기)로 둔다.
// 순수 함수다. 이미지는 data URL 로 받는다(헤드리스 크로미움은 쿠키가 없다, check-print-selfcontained).

import type { BusinessInfo } from '@/lib/contract'

/** 머리·꼬리가 읽는 영업장 재료. 계약서 PrintContractData 가 구조적으로 그대로 맞는다. */
export type PrintBrandSource = {
  businessInfo: BusinessInfo
  phone: string | null
  logoImageUrl: string | null
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 사업자정보 두 줄(이스케이프 끝). 1줄 사업자등록번호 · 대표, 2줄 주소 · 전화. */
export function printBrandMeta(b: PrintBrandSource): { bizMeta1: string; bizMeta2: string } {
  const biz = b.businessInfo
  return {
    bizMeta1: [biz.registrationNo ? `사업자등록번호 ${escape(biz.registrationNo)}` : '', biz.ceoName ? `대표 ${escape(biz.ceoName)}` : ''].filter(Boolean).join(' · '),
    bizMeta2: [biz.address ? escape(biz.address) : '', b.phone ? escape(b.phone) : ''].filter(Boolean).join(' · '),
  }
}

export const PRINT_BRAND_HEADER_CSS = `  .doc-header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 3mm; gap: 6mm; }
  .biz { display: flex; gap: 4mm; align-items: flex-start; }
  .biz-logo { width: 13mm; height: 13mm; border: 0.6pt solid var(--p-rule); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .biz-logo img { max-width: 11mm; max-height: 11mm; width: auto; height: auto; object-fit: contain; }
  .biz-name { font-size: 13pt; font-weight: 700; letter-spacing: -.02em; line-height: 1.1; margin-bottom: 1mm; }
  .biz-meta { font-size: 8pt; color: var(--p-muted); line-height: 1.5; }
  .issue { text-align: right; font-size: 8pt; color: var(--p-muted); line-height: 1.65; flex-shrink: 0; white-space: nowrap; }
  .issue .num { color: var(--p-ink); font-weight: 500; }
  .tc-rule { height: 1.6pt; background: var(--p-tc); margin-bottom: 4mm; }`

export const PRINT_BRAND_FOOTER_CSS = `  .doc-footer { border-top: 0.6pt solid var(--p-rule); padding-top: 3mm; display: flex; justify-content: space-between; align-items: flex-end; gap: 6mm; }
  .foot-biz { font-size: 8pt; color: var(--p-muted); line-height: 1.55; }
  .foot-biz .nm { color: var(--p-ink); font-weight: 600; }
  .wordmark { font-size: 8pt; color: var(--p-muted); white-space: nowrap; }`

export const PRINT_WORDMARK_CSS = `  .wordmark .wm { font-weight: 600; }
  .wordmark .wm-stay { color: var(--p-ink); }
  .wordmark .wm-eum { color: var(--p-tc); }`

/** "made with stayeum" 워드마크(stay 먹 · eum 테라코타, 8pt). */
export const PRINT_WORDMARK_HTML = '<div class="wordmark">made with <span class="wm"><span class="wm-stay">stay</span><span class="wm-eum">eum</span></span></div>'

/**
 * 로고 머리띠 + 테라코타 룰. 오른쪽 발행 칸(issueHtml)만 서류가 정한다(계약서는 계약번호·계약일).
 * issueHtml 은 부른 쪽이 이스케이프를 끝낸 마크업이다.
 */
export function printBrandHeaderHtml(b: PrintBrandSource, issueHtml: string): string {
  const { bizMeta1, bizMeta2 } = printBrandMeta(b)
  return `<div class="doc-header">
      <div class="biz">
        <div class="biz-logo">${b.logoImageUrl ? `<img src="${escape(b.logoImageUrl)}" alt="logo" />` : ''}</div>
        <div>
          <div class="biz-name">${escape(b.businessInfo.name || '')}</div>
          <div class="biz-meta">${bizMeta1}${bizMeta1 && bizMeta2 ? '<br>' : ''}${bizMeta2}</div>
        </div>
      </div>
      <div class="issue">
        ${issueHtml}
      </div>
    </div>
    <div class="tc-rule"></div>`
}

/** 꼬리말의 사업자 줄(상호 · 사업자등록번호 · 대표, 다음 줄 주소 · 전화). .foot-biz 안에 들어간다. */
export function printBrandFootBizHtml(b: PrintBrandSource): string {
  const biz = b.businessInfo
  const { bizMeta2 } = printBrandMeta(b)
  return `<span class="nm">${escape(biz.name || '')}</span>${biz.registrationNo ? ` · 사업자등록번호 ${escape(biz.registrationNo)}` : ''}${biz.ceoName ? ` · 대표 ${escape(biz.ceoName)}` : ''}${bizMeta2 ? `<br>${bizMeta2}` : ''}`
}

/**
 * 2장 이상일 때 puppeteer 꼬리말 틀(§26 "페이지 번호는 2p 이상만"). 왼쪽 쪽 번호, 오른쪽 상호.
 * 꼬리말은 본문 밖 독립 문서라 글꼴을 한 벌 더 싣는다(@sparticuz 크로미움에는 한글 글꼴이 없다).
 * 좌우 여백은 그 종이의 본문 여백과 맞춘다(계약서 14mm).
 */
export function printPageNumberFooterTemplate(pretendardBase64: string, bizName: string, padMm: number): string {
  const bizNameEsc = (bizName || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  // 폰트를 못 구했으면 @font-face 를 넣지 않는다. 빈 src 는 로딩 실패로 대기를 만든다(본문 쪽과 같은 규칙).
  const footerFontCss = pretendardBase64
    ? `@font-face{font-family:'Pretendard';src:url(data:font/woff2;base64,${pretendardBase64}) format('woff2-variations');font-weight:45 920}`
    : ''
  return `<style>${footerFontCss}*{margin:0;padding:0}</style>` +
    `<div style="font-family:'Pretendard',sans-serif;font-size:8pt;color:#6B5D4F;width:100%;padding:0 ${padMm}mm;display:flex;justify-content:space-between;align-items:center;">` +
    `<span style="font-variant-numeric:tabular-nums"><span class="pageNumber"></span> / <span class="totalPages"></span></span>` +
    `<span>${bizNameEsc}</span></div>`
}
