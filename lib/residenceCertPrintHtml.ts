// 서버에서 puppeteer가 렌더할 self-contained 실거주 확인서 HTML.
// ResidenceCertView.tsx 화면과 시각이 동일하도록 같은 layout을 옮겨 둠.
// 모든 칸은 클라이언트에서 편집 가능 → 값은 그대로 문자열로 전달받아 렌더.
// 폰트는 계약서와 동일하게 Pretendard variable woff2 base64 임베드(getPretendardBase64 재사용).

export { getPretendardBase64 } from '@/lib/contractPrintHtml'

export type ResidenceCertFields = {
  siteAddress: string
  areaM2: string
  tenantName: string
  tenantAddress: string
  tenantBirth: string
  tenantPhone: string
  periodText: string
  rentText: string
  depositText: string
  landlordBusinessName: string
  landlordName: string
  landlordAddress: string
  landlordBirth: string
  landlordRegistrationNo: string
  landlordPhone: string
  issueDate: string          // YYYY-MM-DD
  submitTo: string
}

export type PrintResidenceCertData = ResidenceCertFields & {
  stampImageUrl: string | null
  pretendardBase64: string
}

const escape = (s: string) =>
  (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const issueDateLabel = (d: string) => {
  const [y, m, dd] = (d ?? '').split('-').map(Number)
  return Number.isFinite(y) ? `${y}년 ${m}월 ${dd}일` : (d ?? '')
}

const WARNING = '다른 사람의 인장 도용 등 허위로 확인서를 작성하여 신청할 경우에는 「형법」 제231조와 제232조에 따라 사문서 위조ㆍ변조죄로 5년 이하의 징역 또는 1천만 원 이하의 벌금에 처하게 됩니다.'

export function buildResidenceCertPrintHtml(d: PrintResidenceCertData): string {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>실거주 확인서</title>
<style>
  @font-face {
    font-family: 'Pretendard';
    font-weight: 45 920;
    font-style: normal;
    font-display: block;
    src: url(data:font/woff2;base64,${d.pretendardBase64}) format('woff2-variations');
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #1a1a1a; font-family: 'Pretendard', 'Apple SD Gothic Neo', sans-serif; }
  body { font-size: 10.5pt; line-height: 1.5; }

  .paper { position: relative; padding: 0; }
  .outer { border: 1.5px solid #1a1a1a; padding: 7mm 6mm; }

  .doc-title { text-align: center; font-size: 19pt; font-weight: 700; letter-spacing: 8px; margin: 2mm 0 6mm; }

  .form-table { width: 100%; border-collapse: collapse; font-size: 10.5pt; }
  .form-table th, .form-table td { border: 1px solid #1a1a1a; padding: 5px 8px; vertical-align: middle; }
  .form-table th { background: #fff; font-weight: 500; text-align: center; white-space: nowrap; letter-spacing: 2px; }
  .row-h { height: 30px; }
  .area-note { float: right; color: #1a1a1a; }
  .muted { color: #555; }

  .confirm-line { margin: 9mm 0 0; font-size: 10.5pt; }
  .issue-date { text-align: center; margin: 7mm 0 8mm; font-size: 10.5pt; }

  .landlord { font-size: 10.5pt; }
  .landlord-head { margin: 0 0 3mm; }
  .landlord-row { display: flex; align-items: center; margin: 0 0 1.5mm; padding-left: 7mm; }
  .landlord-label { display: inline-block; width: 30mm; letter-spacing: 1px; }
  .landlord-value { flex: 1; }
  .stamp-slot { position: relative; display: inline-flex; align-items: center; gap: 3mm; }
  .stamp-img { width: 15mm; height: 15mm; object-fit: contain; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  .submit-to { text-align: right; font-weight: 700; font-size: 12pt; margin: 6mm 0 0; }

  .warning { margin-top: 8mm; border-top: 1px solid #1a1a1a; padding-top: 3mm; font-size: 8.5pt; line-height: 1.45; color: #1a1a1a; }

  .made-with { margin-top: 6mm; text-align: right; display: flex; justify-content: flex-end; align-items: center; gap: 5px; }
  .made-with-prefix { font-family: 'DM Mono', 'Pretendard', monospace; font-size: 6.5pt; letter-spacing: 0.04em; color: #b8b0a3; font-weight: 500; }
  .made-with-wordmark { font-family: 'Pretendard', sans-serif; font-weight: 900; font-size: 11px; letter-spacing: -0.06em; color: #4a4a4a; opacity: 0.78; }
  .made-with-wordmark .o { color: #a03c2e; }
</style>
</head>
<body>
  <div class="paper">
    <div class="outer">
      <h1 class="doc-title">실거주 확인서</h1>

      <table class="form-table">
        <colgroup><col style="width: 18%" /><col style="width: 14%" /><col /></colgroup>
        <tbody>
          <tr class="row-h">
            <th>소 재 지</th>
            <td colspan="2">${escape(d.siteAddress)}<span class="area-note">(※ 면적 : ${escape(d.areaM2)} ㎡)</span></td>
          </tr>
          <tr class="row-h">
            <th rowspan="4">임 차 인</th>
            <th>성 명</th>
            <td>${escape(d.tenantName)}</td>
          </tr>
          <tr class="row-h"><th>주 소</th><td>${escape(d.tenantAddress)}</td></tr>
          <tr class="row-h"><th>생년월일</th><td>${escape(d.tenantBirth)}</td></tr>
          <tr class="row-h"><th>연 락 처</th><td>${escape(d.tenantPhone)}</td></tr>
          <tr class="row-h">
            <th colspan="2">거 주 기 간</th>
            <td>${escape(d.periodText)} <span class="muted">* (최소 1개월 기재)</span></td>
          </tr>
          <tr class="row-h">
            <th colspan="2">임 대 료</th>
            <td>월 ${escape(d.rentText)} 원 (보증금 : ${escape(d.depositText)} 원)</td>
          </tr>
        </tbody>
      </table>

      <p class="confirm-line">위 임차인이 상기와 같이 거주하고 있음을 확인합니다.</p>

      <p class="issue-date">${escape(issueDateLabel(d.issueDate))}</p>

      <div class="landlord">
        <p class="landlord-head">임 대 인(확인)</p>
        <div class="landlord-row"><span class="landlord-label">상 호 :</span><span class="landlord-value">${escape(d.landlordBusinessName)}</span></div>
        <div class="landlord-row">
          <span class="landlord-label">성 명 :</span>
          <span class="landlord-value stamp-slot">
            <span>${escape(d.landlordName)} (인)</span>
            ${d.stampImageUrl ? `<img class="stamp-img" src="${escape(d.stampImageUrl)}" alt="도장" />` : ''}
          </span>
        </div>
        <div class="landlord-row"><span class="landlord-label">주 소 :</span><span class="landlord-value">${escape(d.landlordAddress)}</span></div>
        <div class="landlord-row"><span class="landlord-label">생 년 월 일 :</span><span class="landlord-value">${escape(d.landlordBirth)}</span></div>
        <div class="landlord-row"><span class="landlord-label">(사업자등록번호) :</span><span class="landlord-value">${escape(d.landlordRegistrationNo)}</span></div>
        <div class="landlord-row"><span class="landlord-label">연 락 처 :</span><span class="landlord-value">${escape(d.landlordPhone)}</span></div>
      </div>

      <p class="submit-to">${escape(d.submitTo)}</p>

      <p class="warning">${escape(WARNING)}</p>
    </div>

    <div class="made-with" aria-label="Made with Stayeum">
      <span class="made-with-prefix">Made with</span>
      <span class="made-with-wordmark">Stay<span class="o">eum</span></span>
    </div>
  </div>
</body>
</html>`
}
