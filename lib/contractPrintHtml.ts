// 서버에서 puppeteer가 렌더할 self-contained 계약서 HTML.
// ContractView.tsx 화면 출력과 시각이 동일하도록 같은 토큰·동일 layout을 그대로 옮겨 둠.
// 변수: 입실자/계약/영업장 데이터 + 서명 PNG dataURL.
//
// 디자인 — 브랜드 가이드 v2.0 §26(b) 입실 계약서(A4). 인쇄전용 토큰(--p-*).
// 폰트 — Pretendard variable woff2를 base64로 HTML에 직접 임베드.
// Vercel @sparticuz/chromium 바이너리에는 한글 폰트가 없어 CDN <link>로는 한글이 깨짐.
// 임베드 방식이라 네트워크 의존성 zero, document.fonts.ready로 로딩 보장.

import { type ContractTemplate, type BusinessInfo, type DisposalConsentTemplate, type SubLeaseAddendum, renderContractText, cleaningFeeVars, buildRefundClause, appendSubLeaseAddendum, buildRoomScheduleAddendum } from '@/lib/contract'
import { PRINT_HEX } from '@/lib/printTokens'   // v2.0 §26 인쇄 토큰 단일 출처
import { roomLabel } from '@/lib/tenantAddress'

// 모듈 레벨 캐시 — cold start 후 첫 PDF 생성 때만 파일을 읽는다. 이후 요청은 메모리 캐시 사용.
const PRETENDARD_URL = 'https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/variable/woff2/PretendardVariable.woff2'
const PRETENDARD_CDN_TIMEOUT_MS = 5000
// 로컬 후보는 순서가 곧 우선순위다. 가변 woff2 가 CDN 본과 같은 파일이라 인쇄 결과가 완전히 같고
// (굵기 축 45~920 그대로), 정적 Regular TTF 는 굵은 글씨가 합성 볼드로 나오는 차선책이다.
const PRETENDARD_LOCAL = ['PretendardVariable.woff2', 'Pretendard-Regular.ttf']
let pretendardCache: string | null = null

// 로컬 폰트를 먼저 쓰고 CDN 은 폴백이다(E페이즈 2026-08-03).
// 종전에는 jsdelivr 단일 의존이라 그쪽이 죽으면 계약서·실거주확인서 발급이 전면 중단됐다.
// 영수증(rentReceiptPdf)은 원래 로컬 폰트 + 폴백 구조였다 — 세 서류의 규칙을 맞춘다.
//
// 로컬 파일은 함수 번들에 들어가 있어야 읽힌다. next.config.ts 의 outputFileTracingIncludes 에
// 이 함수를 쓰는 라우트가 빠져 있으면 배포본에서는 매 콜드 스타트마다 CDN 을 타게 된다
// (신고 0aed3bdd 의 간헐 실패 경로). scripts/check-print-selfcontained.ts 축 2 가 그 명단을 지킨다.
//
// CDN 에는 타임아웃 5초를 건다 — 종전에는 없어서 jsdelivr 가 느리면 발급이 통째로 멈췄다.
// 셋 다 실패하면 빈 문자열이다. 폰트가 없으면 한글이 깨지지만, 발급 자체가 막히는 것보다 낫다.
// 빈 값은 캐시하지 않는다 — 다음 요청은 다시 시도해야 한다.
export async function getPretendardBase64(): Promise<string> {
  if (pretendardCache) return pretendardCache
  const { readFile } = await import('node:fs/promises')
  const path = await import('node:path')
  for (const name of PRETENDARD_LOCAL) {
    try {
      const buf = await readFile(path.join(process.cwd(), 'public', 'fonts', name))
      pretendardCache = Buffer.from(buf).toString('base64')
      return pretendardCache
    } catch { /* 다음 후보 — 다 없으면 CDN 으로 */ }
  }
  try {
    const res = await fetch(PRETENDARD_URL, { signal: AbortSignal.timeout(PRETENDARD_CDN_TIMEOUT_MS) })
    if (!res.ok) throw new Error(`Pretendard 폰트 다운로드 실패 (${res.status})`)
    const buf = Buffer.from(await res.arrayBuffer())
    pretendardCache = buf.toString('base64')
    return pretendardCache
  } catch (e) {
    console.error('[contractPrintHtml] Pretendard 폰트 확보 실패 — 폰트 없이 발급한다:', e)
    return ''
  }
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
    // 외국인등록번호(하이픈 표기). 값이 있으면 생년월일 칸을 이 번호가 **대체**한다.
    // 종이에 칸을 하나 더 만들지 않는 이유는 두 값이 같은 사실을 말하기 때문이다.
    // 없으면 종전 그대로 생년월일이 찍힌다(등록번호 없는 발급본은 픽셀 단위로 무변화).
    foreignRegNo: string | null
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
  // 이 계약에 딸린 계약들(합본 계약서 — 2026-08-13 다호실 2단계). 비면 행이 하나도 안 붙고
  // 인쇄물은 이 기능 전과 바이트 단위로 같다. 종속 없는 계약서 전건이 그 경우다.
  subLeases?: { roomNo: string | null; rentAmount: number }[]
  // 추가 호실 특약(보관 용도). 없으면(null·미지정) 절이 하나도 안 붙고 조항 2단 분배도
  // 종전 입력 그대로라, 그 계약서의 HTML 은 이 기능 전과 문자 단위로 같다.
  subLeaseAddendum?: SubLeaseAddendum | null
  // 거주 호실 일정 문장. 없으면(null·미지정) 절이 안 붙어 종전 계약서와 문자 단위로 같다.
  roomScheduleText?: string | null
  // 사용자가 입력한 화면 상태
  smoking: string                 // '비흡연' | '흡연'
  emergencyContactText: string
  signDate: string                // 'YYYY년 M월 D일' — 계약일(= 입주자가 서명한 날)
  // 동의서는 별도 서명을 받는 별도 서류라 자기 서명 시각을 쓴다. 링크 TTL 이 24시간이라
  // 자정을 넘겨 서명하면 계약서와 갈릴 수 있다. 안 넘어오면 signDate 로 폴백한다.
  disposalSignDate?: string
  signatureName: string
  signatureImageDataUrl: string   // 'data:image/png;base64,...' — 입실자 손글씨
  pretendardBase64: string        // Pretendard variable woff2 base64 — 한글 렌더 보장
}

const fmtDate = (d: string | null) => {
  if (!d) return ''
  const [y, m, dd] = d.split('-')
  return `${y}.${m}.${dd}`
}

const fmtRoom = roomLabel   // 호실 표기는 lib/tenantAddress 정본 하나 — 서류마다 제 규칙을 두면 갈린다

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// 항목 글머리 '-'·'•'·'·' 제거 (CSS 글머리로 대체)
// 글머리 제거 — 기호뿐 아니라 '1.' '가.' 같은 수동 번호도 벗긴다.
// 저장된 템플릿 항목이 수동 번호를 포함하는데 CSS 가 앞에 '·' 를 또 붙여
// 인쇄물이 '· 1. [중도 퇴실 정산] ...' 로 나왔다(E페이즈 조사 2026-08-03).
const stripBullet = (s: string) => s.replace(/^\s*(?:[-–•·]\s?|\d+[.)]\s*|[가-힣][.)]\s+)/, '')
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

  // 조항은 **문서 순서 그대로 한 흐름**으로 뱉고, 2단 나눔은 CSS(column-count)가 한다.
  //
  // 종전에는 splitClauseColumns 가 글자 수로 높이를 추정해 좌우를 반반으로 갈랐고 CSS 는
  // flex 2단이었다. 그런데 flex 는 **페이지 경계에서 각 단이 독립적으로 이어 그려진다** —
  // 조항이 한 장을 넘치면 3조가 2페이지, 4조가 1페이지가 되어 읽는 순서가 페이지를 오갔다
  // (김상혁 님 계약서, 운영자 발견 2026-08-26). multicol 은 페이지별로 좌우를 채우고 넘긴다.
  //
  // DOM 이 선형이라 '조항 순서 절대 불변'이 구조적으로 자동 충족되고, 높이 추정이라는 층도
  // 통째로 사라진다. 자세한 경위와 실측은 knowledge/domain-contracts.md 참조.
  const renderSection = (sec: { title: string; items: string[] }) => {
    const lis = sec.items
      .map(it => `<li>${highlight(stripBullet(renderContractText(it, vars)))}</li>`)
      .join('')
    return `<div class="clause-group"><div class="clause-h">${escape(renderContractText(sec.title, vars))}</div><ul class="clause-list">${lis}</ul></div>`
  }
  // 특약은 화면과 같은 함수로 절 배열 뒤에 붙인다 — 변수 치환·글머리 제거가 그대로 따라온다.
  const clausesHtml = appendSubLeaseAddendum(d.template.sections, d.subLeaseAddendum, buildRoomScheduleAddendum(d.roomScheduleText))
    .map(renderSection).join('')

  // 합본 계약서의 종속 호실 행 — 딸린 계약마다 한 줄, 그 아래 임료 합계 한 줄.
  // 정보 표의 네 칸(라벨·값·라벨·값) 문법을 그대로 쓴다. 표를 따로 세우면 열 폭이 안 맞아
  // 같은 종이 안에서 호실이 두 자리에 다른 규칙으로 찍힌다.
  // **종속이 없으면 빈 문자열이고, 앞 행의 `</tr>` 바로 뒤에 붙어 공백조차 남기지 않는다** —
  // 종속 없는 계약서의 인쇄 HTML 이 이 기능 전과 바이트 단위로 같아야 하기 때문이다.
  const subs = d.subLeases ?? []
  const subRowsHtml = subs.length === 0 ? '' : `
        ${subs.map(s => `<tr>
          <th>추가 호실<span class="en">Additional Room</span></th><td class="num">${escape(fmtRoom(s.roomNo))}</td>
          <th>추가 입실료<span class="en">Rent / month</span></th><td class="amt">${s.rentAmount.toLocaleString()}원</td>
        </tr>`).join('\n        ')}
        <tr>
          <th>호실 합계<span class="en">Rooms</span></th><td class="num">${escape([d.lease?.roomNo, ...subs.map(s => s.roomNo)].map(r => fmtRoom(r)).filter(Boolean).join(' · '))}</td>
          <th>입실료 합계<span class="en">Total Rent</span></th><td class="amt">${((d.lease?.rentAmount ?? 0) + subs.reduce((s, x) => s + x.rentAmount, 0)).toLocaleString()}원</td>
        </tr>`

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
      <div class="dc-date num">${escape(d.disposalSignDate ?? d.signDate)}</div>
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
  ${d.pretendardBase64 ? `@font-face {
    font-family: 'Pretendard';
    font-weight: 45 920;
    font-style: normal;
    font-display: block;
    src: url(data:font/woff2;base64,${d.pretendardBase64}) format('woff2-variations');
  }` : '/* 폰트 확보 실패 — 빈 src 는 로딩 실패로 대기를 유발하므로 선언 자체를 뺀다 */'}
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
  /* '외국인등록번호' 는 30mm 라벨 칸에서 한 줄로는 아슬아슬하다. 줄바꿈을 막고 자간만 좁혀
     행 높이를 그대로 지킨다. 두 줄이 되면 이 행만 키가 커져 표가 흐트러진다. */
  .info th.th-long { white-space: nowrap; letter-spacing: -.045em; }
  .info td { font-size: 9.5pt; padding: 0 3mm; border: 0.4pt solid var(--p-rule); vertical-align: middle; }
  .info td.amt { font-weight: 700; color: var(--p-tc); font-variant-numeric: tabular-nums; }
  .info td .sub { font-size: 8pt; color: var(--p-muted); font-weight: 400; }
  .emerg { width: 100%; border-collapse: collapse; border: 0.6pt solid var(--p-rule-strong); border-top: none; margin-bottom: 4mm; }
  .emerg th { width: 30mm; background: var(--p-label-bg); font-size: 8.5pt; font-weight: 600; text-align: left; padding: 2mm 3mm; border: 0.4pt solid var(--p-rule); vertical-align: middle; line-height: 1.3; }
  .emerg th .en { display: block; font-size: 7pt; font-weight: 400; color: var(--p-muted); }
  .emerg td { font-size: 9pt; padding: 2mm 3mm; border: 0.4pt solid var(--p-rule); vertical-align: middle; }

  /* 조항 — 2단. column-fill 은 기본값 balance 를 쓴다(auto 는 마지막이 아닌 프래그먼트에서
     단을 페이지 바닥까지 채워 한 장짜리 계약의 좌우가 비대칭이 되고 서약·서명이 밀린다).
     .clause-group 에 break-inside: avoid 를 두면 절이 단 경계에서 통째로 점프해 바닥 공백이
     커진다 — 절이 단을 넘어 이어지는 것이 옛 분배(헤더 없는 이어짐)와 같은 규칙이다. */
  .clauses { column-count: 2; column-gap: 7mm; margin-bottom: 3mm; }
  .clause-group { margin-bottom: 2.2mm; }
  .clause-h { font-size: 10.5pt; font-weight: 700; letter-spacing: -.01em; margin-bottom: 1.4mm; padding-left: 3mm; border-left: 2.5pt solid var(--p-tc); line-height: 1.2; break-after: avoid; }
  .clause-list { list-style: none; }
  .clause-list li { font-size: 8.7pt; line-height: 1.38; color: var(--p-ink); padding-left: 3mm; text-indent: -3mm; margin-bottom: 0.6mm; white-space: pre-line; word-break: keep-all; break-inside: avoid; }
  .clause-list li::before { content: "·"; color: var(--p-muted); margin-right: 1.5mm; }
  .clause-list li .hl { color: var(--p-tc); font-weight: 600; }

  /* 서약 */
  .pledge { border: 0.6pt solid var(--p-rule-strong); background: var(--p-amt-bg); padding: 3mm 5mm; font-size: 9.5pt; font-weight: 500; line-height: 1.4; text-align: center; margin-bottom: 4mm; break-inside: avoid; }

  /* 신원번호 수집·이용 동의 — 등록번호가 실린 계약서에만 코드가 붙인다(영업장 템플릿 밖).
     환불 조항과 같은 방식이다. 템플릿에 넣으면 영업장이 지울 수 있고, 지워진 채 번호만 인쇄된다.
     테두리 상자가 아니라 윗줄 하나로 끊는다. 상자로 두르면 12.3mm 를 먹어 축소맞춤 하한(88%)을
     그대로 밀어붙였다(실측 2026-08-11). 서명 바로 위 한 문단이면 읽히는 자리로 충분하다.
     크기는 8pt 다. v2.0 §26 의 최소 8.5pt 예외가 '푸터·법적 주석' 이고 이 문장이 그 법적 주석이다.
     더 줄이면 예외 밖이라 안 줄인다 — 읽히지 않는 동의 문구는 동의를 받은 것이 아니다. */
  .consent-note { font-size: 8pt; line-height: 1.4; color: var(--p-ink); border-top: 0.4pt solid var(--p-rule); padding-top: 2mm; margin-bottom: 2mm; word-break: keep-all; break-inside: avoid; }

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
  .info, .emerg, .pledge, .consent-note, .sign-wrap, .doc-footer { page-break-inside: avoid; }
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
        계약일 ${escape(d.signDate)}
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
          ${d.tenant.foreignRegNo
            ? `<th class="th-long">외국인등록번호<span class="en">Alien Reg. No.</span></th><td class="num">${escape(d.tenant.foreignRegNo)}</td>`
            : `<th>생년월일<span class="en">Date of Birth</span></th><td class="num">${escape(fmtDate(d.tenant.birthdate))}</td>`}
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
        </tr>${subRowsHtml}
      </tbody>
    </table>
    ${d.emergencyContactText ? `<table class="emerg"><tbody><tr>
      <th>비상 연락망<span class="en">Emergency Contact</span></th>
      <td>${escape(d.emergencyContactText)}</td>
    </tr></tbody></table>` : ''}

    <div class="clauses">${clausesHtml}</div>

    <div class="pledge">${escape(renderContractText(d.template.oathText, vars))}</div>

    ${d.tenant.foreignRegNo ? `<div class="consent-note">본인은 위 외국인등록번호가 임대차 계약 체결과 관계기관 제출 목적으로 수집·이용되는 데 동의합니다. / I consent to the collection and use of my alien registration number for this lease agreement.</div>` : ''}

    <div class="sign-wrap">
      <div class="sign-date num">${escape(d.signDate)}</div>
      <div class="sign-grid">
        <div class="sign-col">
          <div class="sign-role">임차인 (입실자)</div>
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
