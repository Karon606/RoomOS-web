// 서버에서 puppeteer가 렌더할 self-contained 계약서 HTML.
// ContractView.tsx 화면 출력과 시각이 동일하도록 같은 토큰·동일 layout을 그대로 옮겨 둠.
// 변수: 입실자/계약/영업장 데이터 + 서명 PNG dataURL.
//
// 폰트 — Pretendard variable woff2를 base64로 HTML에 직접 임베드.
// Vercel @sparticuz/chromium 바이너리에는 한글 폰트가 없어 CDN <link>로는 한글이 깨짐.
// 임베드 방식이라 네트워크 의존성 zero, document.fonts.ready로 로딩 보장.

import { type ContractTemplate, type BusinessInfo, renderContractText } from '@/lib/contract'

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
  // 이미지들은 Drive thumbnail URL — puppeteer에서 외부 fetch 가능
  logoImageUrl: string | null
  stampImageUrl: string | null
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

export function buildContractPrintHtml(d: PrintContractData): string {
  // 보증금/청소비 동적 라벨 — ContractView 와 동일 규칙
  const dep = d.lease?.depositAmount ?? 0
  const cln = d.lease?.cleaningFee ?? 0
  let depositLabel = '입실 보증금 (Deposit)'
  let depositValue = ''
  if (dep === 0 && cln > 0) {
    depositLabel = '청소비 (Cleaning Fee)'
    depositValue = `${cln.toLocaleString()}원`
  } else if (dep > 0 && cln > 0) {
    depositValue = `${dep.toLocaleString()}원 (중 청소비 ${cln.toLocaleString()}원)`
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
  }

  const sectionsHtml = d.template.sections.map(sec => `
    <section class="section">
      <p class="section-title">${escape(renderContractText(sec.title, vars))}</p>
      ${sec.items.map(item => `<p class="section-item">${escape(renderContractText(item, vars))}</p>`).join('')}
    </section>
  `).join('')

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>${escape(d.template.title)}</title>
<style>
  /* Pretendard variable woff2 base64 임베드 — 한글 깨짐 방지 (Vercel chromium 한글 폰트 미탑재) */
  @font-face {
    font-family: 'Pretendard';
    font-weight: 45 920;
    font-style: normal;
    font-display: block;
    src: url(data:font/woff2;base64,${d.pretendardBase64}) format('woff2-variations');
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #1a1a1a; font-family: 'Pretendard', 'Apple SD Gothic Neo', sans-serif; }
  body { font-size: 9pt; line-height: 1.45; }

  .paper { position: relative; padding: 0; box-sizing: border-box; }

  /* 헤더 — grid 3컬럼 [로고 | 제목 | 빈공간] */
  .contract-header { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 6mm; margin-bottom: 10px; }
  .contract-header-logo { justify-self: start; height: 14mm; max-width: 50mm; display: flex; align-items: center; }
  .contract-logo-img { max-height: 14mm; max-width: 50mm; width: auto; height: auto; object-fit: contain; opacity: 0.6; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .contract-title { text-align: center; font-size: 13pt; font-weight: 700; text-decoration: underline; margin: 0; white-space: nowrap; }

  .info-table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  .info-table th, .info-table td { border: 1px solid #1a1a1a; padding: 4px 6px; text-align: center; vertical-align: middle; height: 22px; }
  .info-table th { background: #fafafa; font-weight: 500; }

  .emergency-note { margin: 10px 0 6px; padding-left: 36pt; font-size: 9pt; }

  .sections { margin-top: 8pt; }
  .section { margin-bottom: 9pt; }
  .section-title { margin: 0 0 3pt 0; font-weight: 700; font-size: 9pt; }
  .section-item { margin: 0 0 1pt 0; padding-left: 14pt; text-indent: -10pt; font-size: 9pt; white-space: pre-line; }

  .oath { margin-top: 12pt; text-align: center; }
  .oath-text { font-weight: 700; font-size: 9pt; margin: 0 0 6pt; }
  .signature-row { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; font-size: 9pt; }
  .signature-name-print { display: inline-block; min-width: 120px; text-align: center; padding-bottom: 2px; border-bottom: 1px solid #1a1a1a; }
  .signature-stamp-img { height: 12mm; width: auto; vertical-align: middle; margin: 0 4px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  .business-block { margin-top: 14pt; font-size: 9pt; display: flex; align-items: center; justify-content: center; gap: 6mm; flex-wrap: nowrap; }
  .business-info { text-align: center; flex: 0 1 auto; min-width: 0; }
  .business-line { margin-bottom: 2pt; white-space: normal; }
  .business-stamp { flex: 0 0 auto; width: 14mm; height: 14mm; display: inline-flex; align-items: center; justify-content: center; }
  .business-stamp-image { max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  /* Made with RoomOS — 우측 하단에 살짝 안쪽으로 들여서 시각적으로 안 잘려 보이게 */
  .made-with { position: absolute; right: 6mm; bottom: 4mm; margin: 0; display: inline-flex; align-items: center; gap: 5px; }
  .made-with-prefix { font-family: 'DM Mono', 'Pretendard', monospace; font-size: 6.5pt; letter-spacing: 0.04em; color: #b8b0a3; font-weight: 500; }
  .made-with-wordmark { font-family: 'Pretendard', sans-serif; font-weight: 900; font-size: 11px; letter-spacing: -0.06em; color: #4a4a4a; opacity: 0.78; }
  .made-with-wordmark .o { color: #e84a1a; }
</style>
</head>
<body>
  <div class="paper">
    <header class="contract-header">
      <div class="contract-header-logo">
        ${d.logoImageUrl ? `<img class="contract-logo-img" src="${escape(d.logoImageUrl)}" alt="logo" />` : ''}
      </div>
      <h1 class="contract-title">${escape(d.template.title)}</h1>
      <div></div>
    </header>

    <table class="info-table">
      <colgroup><col style="width: 23%" /><col style="width: 27%" /><col style="width: 23%" /><col style="width: 27%" /></colgroup>
      <tbody>
        <tr><th>성명 (Name)</th><td>${escape(d.tenant.name)}</td><th>연락처 (Mobile)</th><td>${escape(d.tenant.primaryPhone ?? '')}</td></tr>
        <tr><th>생년월일 (Birth Date)</th><td>${escape(fmtDate(d.tenant.birthdate))}</td><th>직업 (Job)</th><td>${escape(d.tenant.job ?? '')}</td></tr>
        <tr><th>성별 (Gender)</th><td>${escape(d.tenant.gender)}</td><th>흡연 여부 (Smoking)</th><td>${escape(d.smoking)}</td></tr>
        <tr><th>${escape(depositLabel)}</th><td>${escape(depositValue)}</td><th>입실일 (Check-in)</th><td>${escape(fmtDate(d.lease?.moveInDate ?? null))}</td></tr>
        <tr><th>호실 (Room No.)</th><td>${escape(fmtRoom(d.lease?.roomNo))}</td><th>퇴실 예정일 (Check-out)</th><td>${escape(fmtDate(d.lease?.expectedMoveOut ?? null))}</td></tr>
        <tr><th>입실료 (Rent Fee)</th><td>${d.lease ? `${d.lease.rentAmount.toLocaleString()}원` : ''}</td><th>전입신고 유무</th><td>${escape(d.lease?.registrationStatus ?? '미신고')}</td></tr>
      </tbody>
    </table>

    ${d.template.emergencyContactNote ? `<p class="emergency-note">${escape(d.template.emergencyContactNote)} ${escape(d.emergencyContactText)}</p>` : ''}

    <div class="sections">${sectionsHtml}</div>

    <div class="oath">
      <p class="oath-text">${escape(renderContractText(d.template.oathText, vars))}</p>
      <div class="signature-row">
        <span>${escape(d.signDate)}</span>
        <span>/ 서명:</span>
        <span class="signature-name-print">${escape(d.signatureName)}</span>
        ${d.signatureImageDataUrl
          ? `<img class="signature-stamp-img" src="${d.signatureImageDataUrl}" alt="signature" />`
          : `<span>(인)</span>`}
      </div>
    </div>

    <div class="business-block">
      <div class="business-info">
        <div class="business-line">상호: ${escape(d.businessInfo.name)}${d.businessInfo.registrationNo ? ` / 사업자번호 ${escape(d.businessInfo.registrationNo)}` : ''}${d.businessInfo.ceoName ? ` / 대표 ${escape(d.businessInfo.ceoName)}` : ''}</div>
        ${d.businessInfo.address ? `<div class="business-line">사업장 주소: ${escape(d.businessInfo.address)}</div>` : ''}
      </div>
      <div class="business-stamp">
        ${d.stampImageUrl ? `<img class="business-stamp-image" src="${escape(d.stampImageUrl)}" alt="stamp" />` : '<span style="font-weight:600;">(인)</span>'}
      </div>
    </div>

    <div class="made-with" aria-label="Made with RoomOS">
      <span class="made-with-prefix">Made with</span>
      <span class="made-with-wordmark">Room<span class="o">O</span>S</span>
    </div>
  </div>
</body>
</html>`
}
