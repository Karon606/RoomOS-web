// 입실료 납부 확인서 — 브랜드 가이드 §20 + Claude Design A5 시안 반영.
// A5 세로, 인쇄전용 토큰(--p-*). pdf-lib 직접 그림.
// 폰트: §20.1 표준은 Pretendard TTF 이나 정적 TTF 미가용(LFS) → 폴백 나눔고딕(§20.1 폴백).

import { PDFDocument, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { getNanumGothic } from './residenceCertOverlay'

export type RentReceiptFields = {
  issueDate: string      // YYYY-MM-DD (발행일)
  name: string           // 수령인(입주자) 성명
  room: string           // 호실
  period: string         // 거주 기간
  targetMonth: string    // 납부 대상월
  amount: string         // 납부 금액 (숫자 위주 — ₩·한글 자동)
  payDate: string        // 납부일
  payMethod: string      // 납부방법
  note: string           // 비고
  recipientName: string  // 임대인 대표 성명
}

export type RentReceiptBrand = {
  businessName: string
  bizLine1: string       // 사업자등록번호 · 대표
  bizLine2: string       // 주소 · 전화
  receiptNo: string      // 발행번호 (YYYYMMDD-NNN)
}

const MM = 2.83465
const PAGE_W = 148 * MM, PAGE_H = 210 * MM
const L = 14 * MM, R = PAGE_W - 14 * MM

const P_INK = rgb(0.122, 0.102, 0.090)
const P_MUTED = rgb(0.420, 0.365, 0.310)
const P_TC = rgb(0.627, 0.235, 0.176)
const P_LABEL_BG = rgb(0.949, 0.925, 0.890)
const P_RULE = rgb(0.847, 0.812, 0.769)
const P_RULE_STRONG = rgb(0.604, 0.541, 0.471)
const P_AMOUNT_BG = rgb(0.988, 0.980, 0.965)

const issueKor = (d: string) => { const [y, m, dd] = (d ?? '').split('-').map(Number); return Number.isFinite(y) ? `${y}년 ${m}월 ${dd}일` : (d ?? '') }
const onlyDigits = (s: string) => (s ?? '').replace(/[^0-9]/g, '')
const amountFmt = (a: string) => { const n = onlyDigits(a); if (!n) return a || ''; return /[₩원]/.test(a) ? a : `₩${Number(n).toLocaleString('ko-KR')}` }
const KO_D = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'], KO_S = ['', '십', '백', '천'], KO_B = ['', '만', '억', '조']
function koreanWon(num: number): string {
  if (!num) return ''
  let s = ''; const groups: number[] = []; let x = num
  while (x > 0) { groups.push(x % 10000); x = Math.floor(x / 10000) }
  for (let g = groups.length - 1; g >= 0; g--) {
    const grp = groups[g]; if (!grp) continue
    const d = [grp % 10, Math.floor(grp / 10) % 10, Math.floor(grp / 100) % 10, Math.floor(grp / 1000) % 10]
    let gs = ''; for (let i = 3; i >= 0; i--) if (d[i]) gs += KO_D[d[i]] + KO_S[i]
    s += gs + KO_B[g]
  }
  return `금 ${s}원정`
}

export async function buildRentReceiptPdf(
  f: RentReceiptFields, brand: RentReceiptBrand,
  logoBytes: Uint8Array | null, stampBytes: Uint8Array | null,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const font = await doc.embedFont(await getNanumGothic())
  const page = doc.addPage([PAGE_W, PAGE_H])

  const W = (t: string, s: number) => font.widthOfTextAtSize(t || '', s)
  const T = (t: string, x: number, y: number, s = 9.5, c = P_INK, bold = false) => {
    if (!t) return
    page.drawText(t, { x, y, size: s, font, color: c })
    if (bold) page.drawText(t, { x: x + 0.3, y, size: s, font, color: c })  // faux-bold (나눔고딕 단일 웨이트)
  }
  const TR = (t: string, xEnd: number, y: number, s: number, c = P_INK, bold = false) => T(t, xEnd - W(t, s), y, s, c, bold)
  const fit = (t: string, x: number, y: number, maxW: number, start: number, c = P_INK, bold = false) => {
    let s = start; while (s > 7 && W(t, s) > maxW) s -= 0.5; T(t, x, y, s, c, bold)
  }

  const top = PAGE_H - 12 * MM

  // ── 헤더 ──
  const logoH = 12 * MM
  if (logoBytes && logoBytes.length > 0) {
    try {
      const isPng = logoBytes[0] === 0x89 && logoBytes[1] === 0x50
      const img = isPng ? await doc.embedPng(logoBytes) : await doc.embedJpg(logoBytes)
      const w = Math.min((img.width / img.height) * logoH, logoH)
      page.drawImage(img, { x: L, y: top - logoH, width: w, height: logoH })
    } catch { /* 로고 실패 무시 */ }
  }
  const nameX = L + logoH + 4 * MM
  T(brand.businessName || '영수증', nameX, top - 11, 12, P_INK, true)
  fit(brand.bizLine1, nameX, top - 22, R - nameX, 7.5, P_MUTED)
  fit(brand.bizLine2, nameX, top - 31, R - nameX, 7.5, P_MUTED)
  TR(`발행번호  No. ${brand.receiptNo}`, R, top - 2, 7.5, P_MUTED)
  TR(`발행일  ${issueKor(f.issueDate)}`, R, top - 13, 7.5, P_MUTED)

  const ruleY = top - 15.5 * MM
  page.drawRectangle({ x: L, y: ruleY, width: R - L, height: 1.6, color: P_TC })

  // ── 제목 (좌측) ──
  let y = ruleY - 6 * MM - 12
  T('입실료 납부 확인서', L, y, 17, P_INK, true)

  // ── 키-값 표 ──
  const labelW = 34 * MM, rowH = 8 * MM
  const drawKV = (rows: { label: string; value: string }[], tableTop: number) => {
    const bottom = tableTop - rowH * rows.length
    rows.forEach((r, i) => {
      const rt = tableTop - rowH * i
      page.drawRectangle({ x: L, y: rt - rowH, width: labelW, height: rowH, color: P_LABEL_BG })
      const by = rt - rowH / 2 - 3.2
      T(r.label, L + 3.5 * MM, by, 9, P_INK)
      fit(r.value, L + labelW + 3.5 * MM, by, R - (L + labelW + 3.5 * MM) - 2 * MM, 9.5, P_INK)
    })
    // 선: 외곽 0.6 / 내부 0.4
    page.drawRectangle({ x: L, y: bottom, width: R - L, height: tableTop - bottom, borderColor: P_RULE_STRONG, borderWidth: 0.6 })
    page.drawLine({ start: { x: L + labelW, y: tableTop }, end: { x: L + labelW, y: bottom }, thickness: 0.4, color: P_RULE })
    for (let i = 1; i < rows.length; i++) {
      const ly = tableTop - rowH * i
      page.drawLine({ start: { x: L, y: ly }, end: { x: R, y: ly }, thickness: 0.4, color: P_RULE })
    }
    return bottom
  }

  y -= 4.5 * MM
  const b1 = drawKV([
    { label: '수령인 (입주자)', value: f.name },
    { label: '호    실', value: f.room },
    { label: '거주 기간', value: f.period },
    { label: '납부 대상월', value: f.targetMonth },
  ], y)

  // ── 납부 금액 박스 ──
  const boxTop = b1 - 4.5 * MM, boxH = 14 * MM, boxBot = boxTop - boxH
  page.drawRectangle({ x: L, y: boxBot, width: R - L, height: boxH, color: P_AMOUNT_BG, borderColor: P_RULE_STRONG, borderWidth: 0.6 })
  T('납부 금액', L + 5 * MM, boxBot + boxH / 2 - 3.5, 10, P_INK, true)
  TR(amountFmt(f.amount), R - 5 * MM, boxBot + boxH / 2 + 1, 14, P_TC, true)
  const won = koreanWon(Number(onlyDigits(f.amount)))
  if (won) TR(won, R - 5 * MM, boxBot + boxH / 2 - 8, 8, P_MUTED)

  // ── 키-값 표 2 ──
  const b2 = drawKV([
    { label: '납 부 일', value: f.payDate },
    { label: '납부방법', value: f.payMethod },
    { label: '비    고', value: f.note },
  ], boxBot - 4.5 * MM)

  // ── 안내 문구 ──
  T('본 확인서는 상기 입실료의 납부 사실을 확인합니다. 발행번호로 진위 확인이 가능합니다.', L, b2 - 6 * MM, 7.5, P_MUTED)

  // ── 서명 · 도장 (하단 우측) ──
  const signLineY = 26 * MM
  T('위 입실료의 납부 사실을 확인함', R - 84 * MM, signLineY + 11 * MM, 8, P_MUTED)
  const sigText = `임대인  ${brand.businessName}  대표  ${f.recipientName}`
  if (stampBytes && stampBytes.length > 0) {
    const SEAL = 16 * MM, sealLeft = R - SEAL, sealCx = R - SEAL / 2
    TR(sigText, sealLeft - 2 * MM, signLineY, 9.5, P_INK)            // 이름 — 도장 왼쪽(가려지지 않게)
    T('(인)', sealCx - W('(인)', 9.5) / 2, signLineY, 9.5, P_INK)     // (인) — 도장이 덮음 (§20.9)
    try {
      const isPng = stampBytes[0] === 0x89 && stampBytes[1] === 0x50
      const img = isPng ? await doc.embedPng(stampBytes) : await doc.embedJpg(stampBytes)
      page.drawImage(img, { x: sealLeft, y: signLineY + 3 - SEAL / 2, width: SEAL, height: SEAL })
    } catch { /* 도장 실패 무시 */ }
  } else {
    TR(sigText + '   (인)', R, signLineY, 9.5, P_INK)
  }

  // ── 푸터 워드마크 ──
  const wmY = 9 * MM
  const preW = W('made with ', 8), stayW = W('stay', 8)
  const startX = R - (preW + stayW + W('eum', 8))
  T('made with ', startX, wmY, 8, P_MUTED)
  T('stay', startX + preW, wmY, 8, P_INK, true)
  T('eum', startX + preW + stayW, wmY, 8, P_TC, true)

  return await doc.save()
}
