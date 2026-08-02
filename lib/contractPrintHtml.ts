// 서버에서 puppeteer가 렌더할 self-contained 계약서 HTML.
// ContractView.tsx 화면 출력과 시각이 동일하도록 같은 토큰·동일 layout을 그대로 옮겨 둠.
// 변수: 입실자/계약/영업장 데이터 + 서명 PNG dataURL.
//
// 디자인 — 브랜드 가이드 v2.0 §26(b) 입실 계약서(A4). 인쇄전용 토큰(--p-*).
// 폰트 — Pretendard variable woff2를 base64로 HTML에 직접 임베드.
// Vercel @sparticuz/chromium 바이너리에는 한글 폰트가 없어 CDN <link>로는 한글이 깨짐.
// 임베드 방식이라 네트워크 의존성 zero, document.fonts.ready로 로딩 보장.

import { type ContractTemplate, type BusinessInfo, type DisposalConsentTemplate, renderContractText, cleaningFeeVars, buildRefundClause, splitClauseColumns } from '@/lib/contract'
import { PRINT_HEX } from '@/lib/printTokens'   // v2.0 §26 인쇄 토큰 단일 출처

// 모듈 레벨 캐시 — cold start 후 첫 PDF 생성 때만 jsdelivr CDN에서 폰트 다운로드 (~570KB).
// 이후 요청은 메모리 캐시 사용.
const PRETENDARD_URL = 'https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/variable/woff2/PretendardVariable.woff2'
let pretendardCache: string | null = null

export async function getPretendardBase64(): Promise<string> {
  if (pretendardCache) return pretendardCache
  const res = await fetch(PRETENDARD_URL)
  if (!res.ok) throw new Error(`Pretendard 폰트 다운로드 실패 (${res.status})`)
  const buf = Buffer.from(await res.arrayBuffer())
  pretendardCache = buf.toString('base64')
  return pretendardCache
}

export type PrintContractData = {
  template: ContractTemplate
  businessInfo: BusinessInfo
  phone: string | null            // 영업장 전화 — 헤더/푸터 메타
  contractNo: string              // 계약번호 (YYYYMMDD-NNN, v2.0 §26)
  // 이미지들은 Drive thumbnail URL — puppeteer에서 외부 fetch 가능
  logoImageUrl: string | null
  stampImageUrl: string | null
  refundClauseInContract: boolean    // 계약서에 환불 조항(공정위 고정 문구) 자동 표시 여부
  disposalConsent: DisposalConsentTemplate   // 잔여 소지품 임의처분 동의서
  disposalSignatureImageDataUrl?: string | null  // 동의서 별도 서명 (없으면 '(서명 또는 인)')
  // 입실자 + 계약 정보
  tenant: {
    name: string
    birthdate: string | null
    gender: string
    job: string | null
    primaryPhone: string | null
  }
  lease: {
    moveInDate: string | null
    expectedMoveOut: string | null
    rentAmount: number
    depositAmount: number
    cleaningFee: number
    dueDay: string | null
    roomNo: string | null
    registrationStatus: string
  } | null
  // 사용자가 입력한 화면 상태
  smoking: string                 // '비흡연' | '흡연'
  emergencyContactText: string
  signDate: string                // 'YYYY년 M월 D일'
  signatureName: string
  signatureImageDataUrl: string   // 'data:image/png;base64,...' — 입실자 손글씨
  pretendardBase64: string        // Pretendard variable woff2 base64 — 한글 렌더 보장
}

const fmtDate = (d: string | null) => {
  if (!d) return ''
  const [y, m, dd] = d.split('-')
  return `${y}.${m}.${dd}`
}

const fmtRoom = (v: string | null | undefined) => {
  if (!v) return ''
  return /^\d+$/.test(v.trim()) ? `${v.trim()}호` : v
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// 항목 글머리 '-'·'•'·'·' 제거 (CSS 글머리로 대체)
const stripBullet = (s: string) => s.replace(/^\s*[-–•·]\s?/, '')
// **강조** → terracotta hl (escape 후 적용)
const highlight = (s: string) => escape(s).replace(/\*\*(.+?)\*\*/g, '<span class="hl">$1</span>')

export function buildContractPrintHtml(d: PrintContractData): string {
  // 보증금/청소비 동적 라벨 — ContractView 와 동일 규칙
  const dep = d.lease?.depositAmount ?? 0
  const cln = d.lease?.cleaningFee ?? 0
  let depositLabel = '입실 보증금'
  let depositEn = 'Deposit'
  let depositValue = ''
  if (dep === 0 && cln > 0) {
    depositLabel = '청소비'; depositEn = 'Cleaning Fee'
    depositValue = `${cln.toLocaleString()}원`
  } else if (dep > 0 && cln > 0) {
    depositValue = `${dep.toLocaleString()}원<span class="sub"> (중 청소비 ${cln.toLocaleString()}원)</span>`
  } else if (dep > 0) {
    depositValue = `${dep.toLocaleString()}원`
  }

  const vars: Record<string, string> = {
    name: d.tenant.name,
    phone: d.tenant.primaryPhone ?? '',
    birth: fmtDate(d.tenant.birthdate),
    job: d.tenant.job ?? '',
    gender: d.tenant.gender,
    smoking: d.smoking,
    deposit: d.lease ? d.lease.depositAmount.toLocaleString() : '',
    checkInDate: fmtDate(d.lease?.moveInDate ?? null),
    checkOutDate: fmtDate(d.lease?.expectedMoveOut ?? null),
    roomNo: fmtRoom(d.lease?.roomNo),
    rentFee: d.lease ? d.lease.rentAmount.toLocaleString() : '',
    emergencyContact: d.emergencyContactText,
    환불규정: d.refundClauseInContract ? ' ' + buildRefundClause() : '',
    // 청소비 치환은 정본 하나로 — 화면과 인쇄가 각자 규칙을 갖던 것이 비문의 원인이었다(2026-08-03)
    ...cleaningFeeVars(cln),
  }

  // 화면(ContractView)과 동일하게 명시적 2단(flex) — CSS 멀티컬럼은 인쇄에서 1단으로 흐름.
  // 항목 단위로 흘려 좌/우 균형(순서 보존). 이어진 단은 헤더 없음(title === null).
  const renderFrag = (frag: { title: string | null; items: string[] }) => {
    const lis = frag.items
      .map(it => `<li>${highlight(stripBullet(renderContractText(it, vars)))}</li>`)
      .join('')
    const h = frag.title ? `<div class="clause-h">${escape(renderContractText(frag.title, vars))}</div>` : ''
    return `<div class="clause-group">${h}<ul class="clause-list">${lis}</ul></div>`
  }
  const [colL, colR] = splitClauseColumns(d.template.sections)
  const clausesHtml = `<div class="clause-col">${colL.map(renderFrag).join('')}</div><div class="clause-col">${colR.map(renderFrag).join('')}</div>`

  const biz = d.businessInfo
  const bizMeta1 = [biz.registrationNo ? `사업자등록번호 ${escape(biz.registrationNo)}` : '', biz.ceoName ? `대표 ${escape(biz.ceoName)}` : ''].filter(Boolean).join(' · ')
  const bizMeta2 = [biz.address ? escape(biz.address) : '', d.phone ? escape(d.phone) : ''].filter(Boolean).join(' · ')

  // 잔여 소지품 임의처분 동의서 — enabled 일 때만 별도 페이지로 이어 출력
  const dc = d.disposalConsent
  const dcVars: Record<string, string> = {
    성명: d.tenant.name, 호실: fmtRoom(d.lease?.roomNo), 연락처: d.tenant.primaryPhone ?? '',
    미납일수: String(dc.days), 영업장명: biz.name || '', 대표: biz.ceoName || '',
  }
  const dcBodyHtml = dc.body.split('\n').map(p => p.trim()).filter(Boolean)
    .map(p => `<p class="dc-p">${escape(renderContractText(p, dcVars))}</p>`).join('')
  const disposalHtml = dc.enabled ? `
    <div class="paper disposal">
      <div class="dc-title">${escape(dc.title)}</div>
      <div class="dc-sec-h">1. 입실자 정보</div>
      <table class="info dc-info"><tbody>
        <tr><th>성명<span class="en">Name</span></th><td>${escape(d.tenant.name)}</td></tr>
        <tr><th>호실<span class="en">Room</span></th><td class="num">${escape(fmtRoom(d.lease?.roomNo))}</td></tr>
        <tr><th>연락처<span class="en">Phone</span></th><td class="num">${escape(d.tenant.primaryPhone ?? '')}</td></tr>
      </tbody></table>
      <div class="dc-sec-h">2. 동의 내용</div>
      <div class="dc-body">${dcBodyHtml}</div>
      <div class="dc-date num">${escape(d.signDate)}</div>
      <div class="dc-sign"><span class="dc-sign-lbl">동의자(입실자) 성명</span><span class="dc-sign-line">${escape(d.signatureName || d.tenant.name)}</span><span class="dc-sign-seal">${d.disposalSignatureImageDataUrl ? `<img class="dc-sign-img" src="${d.disposalSignatureImageDataUrl}" alt="서명" />` : '(서명 또는 인)'}</span></div>
      <div class="dc-to">${escape(biz.name || '')} 대표 귀하</div>
      <div class="doc-footer">
        <div class="foot-biz"><span class="nm">${escape(biz.name || '')}</span>${biz.registrationNo ? ` · 사업자등록번호 ${escape(biz.registrationNo)}` : ''}${biz.ceoName ? ` · 대표 ${escape(biz.ceoName)}` : ''}${bizMeta2 ? `<br>${bizMeta2}` : ''}</div>
        <div class="wordmark">made with <span class="wm"><span class="wm-stay">stay</span><span class="wm-eum">eum</span></span></div>
      </div>
    </div>` : ''

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>${escape(d.template.title)}</title>
<style>
  @font-face {
    font-family: 'Pretendard';
    font-weight: 45 920;
    font-style: normal;
    font-display: block;
    src: url(data:font/woff2;base64,${d.pretendardBase64}) format('woff2-variations');
  }
  :root{
    --p-ink:${PRINT_HEX.ink}; --p-muted:${PRINT_HEX.inkMuted}; --p-tc:${PRINT_HEX.tc};
    --p-label-bg:${PRINT_HEX.labelBg}; --p-rule:${PRINT_HEX.rule}; --p-rule-strong:${PRINT_HEX.ruleStrong}; --p-amt-bg:${PRINT_HEX.amtBg};
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #fff; color: var(--p-ink); font-family: 'Pretendard', 'Apple SD Gothic Neo', sans-serif; word-break: keep-all; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .num { font-variant-numeric: tabular-nums; }
  /* 인쇄 페이지 분할 안전: flex 컨테이너는 페이지 경계에서 클리핑되므로 일반 블록 흐름 사용
     (동의서가 이어 붙어 2페이지가 될 때 계약서 본문이 통째로 사라지던 버그 방지) */
  .paper { position: relative; }

  /* 헤더 */
  .doc-header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 3mm; gap: 6mm; }
  .biz { display: flex; gap: 4mm; align-items: flex-start; }
  .biz-logo { width: 13mm; height: 13mm; border: 0.6pt solid var(--p-rule); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .biz-logo img { max-width: 11mm; max-height: 11mm; width: auto; height: auto; object-fit: contain; }
  .biz-name { font-size: 13pt; font-weight: 700; letter-spacing: -.02em; line-height: 1.1; margin-bottom: 1mm; }
  .biz-meta { font-size: 8pt; color: var(--p-muted); line-height: 1.5; }
  .issue { text-align: right; font-size: 8pt; color: var(--p-muted); line-height: 1.65; flex-shrink: 0; white-space: nowrap; }
  .issue .num { color: var(--p-ink); font-weight: 500; }
  .tc-rule { height: 1.6pt; background: var(--p-tc); margin-bottom: 4mm; }

  /* 제목 */
  .doc-title-row { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 4mm; }
  .doc-title { font-size: 21pt; font-weight: 700; letter-spacing: -.03em; }
  .doc-title-en { font-size: 9pt; color: var(--p-muted); font-weight: 500; letter-spacing: .02em; }

  /* 정보 표 */
  .info { width: 100%; border-collapse: collapse; border: 0.6pt solid var(--p-rule-strong); margin-bottom: 3mm; }
  .info tr { height: 7.4mm; }
  .info th { width: 30mm; background: var(--p-label-bg); font-size: 8.5pt; font-weight: 600; text-align: left; padding: 0 3mm; border: 0.4pt solid var(--p-rule); vertical-align: middle; line-height: 1.25; }
  .info th .en { display: block; font-size: 7pt; font-weight: 400; color: var(--p-muted); letter-spacing: .01em; }
  .info td { font-size: 9.5pt; padding: 0 3mm; border: 0.4pt solid var(--p-rule); vertical-align: middle; }
  .info td.amt { font-weight: 700; color: var(--p-tc); font-variant-numeric: tabular-nums; }
  .info td .sub { font-size: 8pt; color: var(--p-muted); font-weight: 400; }
  .emerg { width: 100%; border-collapse: collapse; border: 0.6pt solid var(--p-rule-strong); border-top: none; margin-bottom: 4mm; }
  .emerg th { width: 30mm; background: var(--p-label-bg); font-size: 8.5pt; font-weight: 600; text-align: left; padding: 2mm 3mm; border: 0.4pt solid var(--p-rule); vertical-align: middle; line-height: 1.3; }
  .emerg th .en { display: block; font-size: 7pt; font-weight: 400; color: var(--p-muted); }
  .emerg td { font-size: 9pt; padding: 2mm 3mm; border: 0.4pt solid var(--p-rule); vertical-align: middle; }

  /* 조항 — 2단 */
  .clauses { display: flex; gap: 7mm; align-items: flex-start; margin-bottom: 3mm; }
  .clause-col { flex: 1 1 0; min-width: 0; }
  .clause-group { margin-bottom: 2.2mm; break-inside: avoid; }
  .clause-h { font-size: 10.5pt; font-weight: 700; letter-spacing: -.01em; margin-bottom: 1.4mm; padding-left: 3mm; border-left: 2.5pt solid var(--p-tc); line-height: 1.2; break-after: avoid; }
  .clause-list { list-style: none; }
  .clause-list li { font-size: 8.7pt; line-height: 1.38; color: var(--p-ink); padding-left: 3mm; text-indent: -3mm; margin-bottom: 0.6mm; white-space: pre-line; word-break: keep-all; break-inside: avoid; }
  .clause-list li::before { content: "·"; color: var(--p-muted); margin-right: 1.5mm; }
  .clause-list li .hl { color: var(--p-tc); font-weight: 600; }

  /* 서약 */
  .pledge { border: 0.6pt solid var(--p-rule-strong); background: var(--p-amt-bg); padding: 3mm 5mm; font-size: 9.5pt; font-weight: 500; line-height: 1.4; text-align: center; margin-bottom: 4mm; break-inside: avoid; }

  /* 서명 — 두 칸 높이를 동일 고정(height) → 밑줄 좌우 정렬. 내용은 가운데 정렬(이름이 바닥으로 안 내려감). 긴 이름 줄바꿈. */
  .sign-wrap { margin-top: 3mm; }
  .sign-date { text-align: center; font-size: 11pt; font-weight: 600; letter-spacing: .04em; margin-bottom: 3mm; }
  .sign-grid { display: flex; gap: 14mm; margin-bottom: 4mm; }
  .sign-col { flex: 1; min-width: 0; }
  .sign-role { font-size: 8.5pt; color: var(--p-muted); margin-bottom: 3mm; letter-spacing: .06em; }
  .sign-line { display: flex; align-items: center; gap: 3mm; font-size: 10pt; border-bottom: 0.5pt solid var(--p-rule); padding-bottom: 1.5mm; height: 17mm; }
  .sign-line .lbl { color: var(--p-muted); font-size: 8.5pt; flex-shrink: 0; white-space: nowrap; }
  .sign-line .val { font-weight: 500; letter-spacing: .04em; flex: 1; min-width: 0; word-break: keep-all; }
  .sign-img { height: 11mm; width: auto; max-width: 42mm; object-fit: contain; flex-shrink: 0; }
  .seal-wrap { flex-shrink: 0; position: relative; display: inline-flex; align-items: center; justify-content: center; }
  .seal-mark { font-size: 9.5pt; color: var(--p-muted); white-space: nowrap; }
  .seal-stamp { height: 18mm; width: auto; max-width: 22mm; object-fit: contain; }

  /* 푸터 */
  .doc-footer { border-top: 0.6pt solid var(--p-rule); padding-top: 3mm; display: flex; justify-content: space-between; align-items: flex-end; gap: 6mm; }
  .foot-biz { font-size: 8pt; color: var(--p-muted); line-height: 1.55; }
  .foot-biz .nm { color: var(--p-ink); font-weight: 600; }
  .wordmark { font-size: 8pt; color: var(--p-muted); white-space: nowrap; }
  /* 잔여 소지품 임의처분 동의서 */
  .paper.disposal { page-break-before: always; break-before: page; padding-top: 4mm; }
  .dc-title { font-size: 15pt; font-weight: 800; text-align: center; letter-spacing: -.02em; margin: 2mm 0 7mm; }
  .dc-sec-h { font-size: 10.5pt; font-weight: 700; padding-left: 3mm; border-left: 2.5pt solid var(--p-tc); margin: 5mm 0 2.5mm; }
  .dc-info { width: 65%; }
  .dc-body { font-size: 9.4pt; line-height: 1.75; color: var(--p-ink); }
  .dc-p { margin-bottom: 2.6mm; word-break: keep-all; }
  .dc-date { text-align: center; font-size: 10pt; margin: 9mm 0 5mm; }
  .dc-sign { display: flex; align-items: baseline; justify-content: flex-end; gap: 3mm; font-size: 10pt; }
  .dc-sign-lbl { color: var(--p-muted); }
  .dc-sign-line { min-width: 42mm; border-bottom: 0.5pt solid var(--p-rule); padding: 0 2mm 1mm; font-weight: 600; text-align: center; }
  .dc-sign-seal { color: var(--p-muted); font-size: 9pt; }
  .dc-sign-img { height: 11mm; width: auto; max-width: 38mm; object-fit: contain; vertical-align: middle; }
  .dc-to { text-align: center; font-size: 11pt; font-weight: 700; margin: 8mm 0 4mm; }
  .wordmark .wm { font-weight: 600; }
  .wordmark .wm-stay { color: var(--p-ink); }
  .wordmark .wm-eum { color: var(--p-tc); }

  /* 페이지 분할 보호 */
  body { widows: 2; orphans: 2; }
  .info, .emerg, .pledge, .sign-wrap, .doc-footer { page-break-inside: avoid; }
  .doc-footer { page-break-before: avoid; }
</style>
</head>
<body>
  <div class="paper">
    <div class="doc-header">
      <div class="biz">
        <div class="biz-logo">${d.logoImageUrl ? `<img src="${escape(d.logoImageUrl)}" alt="logo" />` : ''}</div>
        <div>
          <div class="biz-name">${escape(biz.name || '')}</div>
          <div class="biz-meta">${bizMeta1}${bizMeta1 && bizMeta2 ? '<br>' : ''}${bizMeta2}</div>
        </div>
      </div>
      <div class="issue">
        계약번호 <span class="num">No. ${escape(d.contractNo)}</span><br>
        작성일 ${escape(d.signDate)}
      </div>
    </div>
    <div class="tc-rule"></div>

    <div class="doc-title-row">
      <div class="doc-title">${escape(d.template.title)}</div>
      <div class="doc-title-en">Residence Agreement</div>
    </div>

    <table class="info">
      <tbody>
        <tr>
          <th>성명<span class="en">Name</span></th><td>${escape(d.tenant.name)}</td>
          <th>연락처<span class="en">Mobile Phone</span></th><td class="num">${escape(d.tenant.primaryPhone ?? '')}</td>
        </tr>
        <tr>
          <th>생년월일<span class="en">Date of Birth</span></th><td class="num">${escape(fmtDate(d.tenant.birthdate))}</td>
          <th>성별<span class="en">Gender</span></th><td>${escape(d.tenant.gender)}</td>
        </tr>
        <tr>
          <th>흡연 여부<span class="en">Smoking</span></th><td>${escape(d.smoking)}</td>
          <th>전입신고<span class="en">Resident Reg.</span></th><td>${escape(d.lease?.registrationStatus ?? '미신고')}</td>
        </tr>
        <tr>
          <th>호실<span class="en">Room Number</span></th><td class="num">${escape(fmtRoom(d.lease?.roomNo))}</td>
          <th>입실일<span class="en">Check-in</span></th><td class="num">${escape(fmtDate(d.lease?.moveInDate ?? null))}</td>
        </tr>
        <tr>
          <th>퇴실 예정일<span class="en">Check-out</span></th><td class="num">${escape(fmtDate(d.lease?.expectedMoveOut ?? null)) || '—'}</td>
          <th>${escape(depositLabel)}<span class="en">${depositEn}</span></th><td class="amt">${depositValue}</td>
        </tr>
        <tr>
          <th>입실료<span class="en">Rent / month</span></th><td class="amt">${d.lease ? `${d.lease.rentAmount.toLocaleString()}원` : ''}</td>
          <th>매월 납부일<span class="en">Payment Day</span></th><td class="num">${d.lease?.dueDay ? (d.lease.dueDay.includes('말') ? '매월 말일' : `매월 ${parseInt(d.lease.dueDay, 10)}일`) : '—'}</td>
        </tr>
      </tbody>
    </table>
    ${d.emergencyContactText ? `<table class="emerg"><tbody><tr>
      <th>비상 연락망<span class="en">Emergency Contact</span></th>
      <td>${escape(d.emergencyContactText)}</td>
    </tr></tbody></table>` : ''}

    <div class="clauses">${clausesHtml}</div>

    <div class="pledge">${escape(renderContractText(d.template.oathText, vars))}</div>

    <div class="sign-wrap">
      <div class="sign-date num">${escape(d.signDate)}</div>
      <div class="sign-grid">
        <div class="sign-col">
          <div class="sign-role">임차인 (입주자)</div>
          <div class="sign-line">
            <span class="lbl">성명</span><span class="val">${escape(d.signatureName)}</span>
            <span class="seal-wrap">${d.signatureImageDataUrl
              ? `<img class="sign-img" src="${d.signatureImageDataUrl}" alt="서명" />`
              : `<span class="seal-mark">(서명)</span>`}</span>
          </div>
        </div>
        <div class="sign-col">
          <div class="sign-role">임대인 (사업자)</div>
          <div class="sign-line">
            <span class="lbl">대표</span><span class="val">${escape(biz.ceoName || '')}</span>
            <span class="seal-wrap">${d.stampImageUrl
              ? `<img class="seal-stamp" src="${escape(d.stampImageUrl)}" alt="도장" />`
              : `<span class="seal-mark">(인)</span>`}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="doc-footer">
      <div class="foot-biz">
        <span class="nm">${escape(biz.name || '')}</span>${biz.registrationNo ? ` · 사업자등록번호 ${escape(biz.registrationNo)}` : ''}${biz.ceoName ? ` · 대표 ${escape(biz.ceoName)}` : ''}${bizMeta2 ? `<br>${bizMeta2}` : ''}
      </div>
      <div class="wordmark">made with <span class="wm"><span class="wm-stay">stay</span><span class="wm-eum">eum</span></span></div>
    </div>
  </div>
  ${disposalHtml}
</body>
</html>`
}
