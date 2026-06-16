// 월세 영수증 — 브랜드 가이드 §20(인쇄 서류) · §20.10(a) 입실료 납부 확인서 스펙.
// A5 세로, 인쇄전용 토큰(--p-*), 자체 양식 풀 브랜딩. pdf-lib 직접 그림.
// 폰트: §20.1 표준은 Pretendard TTF 이나 정적 TTF 미가용(LFS) → 폴백 나눔고딕(§20.1 폴백 규정).

import { PDFDocument, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { getNanumGothic } from './residenceCertOverlay'

export type RentReceiptFields = {
  issueDate: string      // YYYY-MM-DD (발행일)
  name: string           // 입주자 성명
  room: string           // 호실
  period: string         // 거주 기간 (1달 선납 주기)
  targetMonth: string    // 납부 대상월 (예 '2026년 6월분')
  amount: string         // 영수 금액 (숫자 위주 — ₩·한글 자동)
  payDate: string        // 납부일
  payMethod: string      // 납부방법 (현금 / 계좌이체 · 계좌번호)
  note: string           // 비고
  recipientName: string  // 임대인 대표 성명
}

export type RentReceiptBrand = {
  businessName: string   // 영업장명(상호)
  bizLine1: string       // 사업자등록번호 · 대표
  bizLine2: string       // 주소 · 전화
  receiptNo: string      // 발행번호 (YYYYMMDD-NNN)
}

// A5 148×210mm
const MM = 2.83465
const PAGE_W = 148 * MM
const PAGE_H = 210 * MM
const MX = 14 * MM, MTOP = 12 * MM
const L = MX, R = PAGE_W - MX

// §20.2 인쇄 전용 토큰
const P_INK = rgb(0.122, 0.102, 0.090)        // #1F1A17
const P_MUTED = rgb(0.420, 0.365, 0.310)      // #6B5D4F
const P_TC = rgb(0.627, 0.235, 0.176)         // #A03C2E
const P_LABEL_BG = rgb(0.949, 0.925, 0.890)   // #F2ECE3
const P_RULE = rgb(0.847, 0.812, 0.769)       // #D8CFC4
const P_RULE_STRONG = rgb(0.604, 0.541, 0.471)// #9A8A78
const WHITE = rgb(1, 1, 1)

const issueDateLabel = (d: string) => {
  const [y, m, dd] = (d ?? '').split('-').map(Number)
  return Number.isFinite(y) ? `${y}년 ${m}월 ${dd}일` : (d ?? '')
}
const onlyDigits = (s: string) => (s ?? '').replace(/[^0-9]/g, '')
const amountFmt = (a: string) => {
  const n = onlyDigits(a)
  if (!n) return a || ''
  return `₩ ${Number(n).toLocaleString('ko-KR')}`
}
// 한글 금액 — '금 사십오만원정'
const KO_D = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구']
const KO_S = ['', '십', '백', '천']
const KO_B = ['', '만', '억', '조']
function koreanWon(num: number): string {
  if (!num) return ''
  let s = ''
  const groups: number[] = []
  let x = num
  while (x > 0) { groups.push(x % 10000); x = Math.floor(x / 10000) }
  for (let g = groups.length - 1; g >= 0; g--) {
    const grp = groups[g]
    if (grp === 0) continue
    let gs = ''
    const d = [grp % 10, Math.floor(grp / 10) % 10, Math.floor(grp / 100) % 10, Math.floor(grp / 1000) % 10]
    for (let i = 3; i >= 0; i--) if (d[i]) gs += KO_D[d[i]] + KO_S[i]
    s += gs + KO_B[g]
  }
  return `금 ${s}원정`
}

export async function buildRentReceiptPdf(
  f: RentReceiptFields,
  brand: RentReceiptBrand,
  logoBytes: Uint8Array | null,
  stampBytes: Uint8Array | null,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const font = await doc.embedFont(await getNanumGothic())
  const page = doc.addPage([PAGE_W, PAGE_H])

  const W = (t: string, s: number) => font.widthOfTextAtSize(t || '', s)
  const T = (t: string, x: number, y: number, s = 9.5, c = P_INK) => { if (t) page.drawText(t, { x, y, size: s, font, color: c }) }
  const TR = (t: string, xEnd: number, y: number, s: number, c = P_INK) => T(t, xEnd - W(t, s), y, s, c)
  const TC = (t: string, cx: number, y: number, s: number, c = P_INK) => T(t, cx - W(t, s) / 2, y, s, c)
  const fit = (t: string, x: number, y: number, maxW: number, start: number, c = P_INK) => {
    let s = start; while (s > 7.5 && W(t, s) > maxW) s -= 0.5; T(t, x, y, s, c)
  }

  const top = PAGE_H - MTOP

  // ── 헤더 (18mm) ──
  let nameX = L
  if (logoBytes && logoBytes.length > 0) {
    try {
      const isPng = logoBytes[0] === 0x89 && logoBytes[1] === 0x50
      const img = isPng ? await doc.embedPng(logoBytes) : await doc.embedJpg(logoBytes)
      const H = 12 * MM, w = Math.min((img.width / img.height) * H, 28 * MM)
      page.drawImage(img, { x: L, y: top - H, width: w, height: H })
      nameX = L + w + 6
    } catch { /* 로고 실패 무시 */ }
  }
  fit(brand.businessName || '영수증', nameX, top - 11, 200, 12, P_INK)
  fit(brand.bizLine1, nameX, top - 23, 230, 9, P_MUTED)
  fit(brand.bizLine2, nameX, top - 34, 230, 9, P_MUTED)
  TR(`No. ${brand.receiptNo}`, R, top - 2, 9, P_MUTED)
  TR(issueDateLabel(f.issueDate), R, top - 14, 9, P_MUTED)
  const ruleY = top - 18 * MM
  page.drawRectangle({ x: L, y: ruleY - 0.8, width: R - L, height: 1.6, color: P_TC })

  // ── 제목 ──
  TC('월 세 영 수 증', PAGE_W / 2, ruleY - 24, 17, P_INK)

  // ── 키-값 표 (라벨열 34mm, 행 8mm) ──
  const labelW = 34 * MM, rowH = 8 * MM
  const drawKV = (rows: { label: string; value: string; tc?: boolean }[], tableTop: number) => {
    const bottom = tableTop - rowH * rows.length
    page.drawRectangle({ x: L, y: bottom, width: R - L, height: tableTop - bottom, borderColor: P_RULE_STRONG, borderWidth: 0.6 })
    page.drawLine({ start: { x: L + labelW, y: tableTop }, end: { x: L + labelW, y: bottom }, thickness: 0.6, color: P_RULE })
    rows.forEach((r, i) => {
      const rt = tableTop - rowH * i
      page.drawRectangle({ x: L, y: rt - rowH, width: labelW, height: rowH, color: P_LABEL_BG })
      if (i > 0) page.drawLine({ start: { x: L, y: rt }, end: { x: R, y: rt }, thickness: 0.4, color: P_RULE })
      const by = rt - rowH / 2 - 3.2
      TC(r.label, L + labelW / 2, by, 9, P_INK)
      fit(r.value, L + labelW + 4 * MM, by, R - (L + labelW + 4 * MM) - 4, 9.5, r.tc ? P_TC : P_INK)
    })
    return bottom
  }

  const b1 = drawKV([
    { label: '성    명', value: f.name },
    { label: '호    실', value: f.room },
    { label: '거주 기간', value: f.period },
    { label: '납부 대상월', value: f.targetMonth },
  ], ruleY - 40)

  // ── 금액 박스 ──
  const boxTop = b1 - 4 * MM, boxH = 12 * MM, boxBot = boxTop - boxH
  page.drawRectangle({ x: L, y: boxBot, width: R - L, height: boxH, borderColor: P_RULE_STRONG, borderWidth: 0.6 })
  page.drawRectangle({ x: L, y: boxBot, width: labelW, height: boxH, color: P_LABEL_BG })
  TC('영수 금액', L + labelW / 2, boxBot + boxH / 2 - 3.2, 9, P_INK)
  TR(amountFmt(f.amount), R - 4 * MM, boxBot + boxH / 2 - 1, 14, P_TC)
  const won = koreanWon(Number(onlyDigits(f.amount)))
  if (won) T(won, L + labelW + 4 * MM, boxBot + boxH / 2 - 3.5, 8.5, P_MUTED)

  // ── 키-값 표 2 ──
  const b2 = drawKV([
    { label: '납 부 일', value: f.payDate },
    { label: '납부방법', value: f.payMethod },
    { label: '비    고', value: f.note },
  ], boxBot - 4 * MM)

  // ── 영수 확인 문구 + 서명 · 도장 (우측) ──
  TC('위 금액을 정히 영수하였습니다.', PAGE_W / 2, b2 - 12 * MM, 10.5, P_INK)
  const sigBase = b2 - 30 * MM
  const hasStamp = !!(stampBytes && stampBytes.length > 0)
  const SEAL = 16 * MM
  const sigText = `임대인  대표  ${f.recipientName}`
  if (hasStamp) {
    // 이름은 도장 좌측에, 도장은 우측 끝(= '(인)' 자리)에 — 이름을 가리지 않게
    TR(sigText, R - SEAL - 3 * MM, sigBase, 10, P_INK)
    try {
      const isPng = stampBytes![0] === 0x89 && stampBytes![1] === 0x50
      const img = isPng ? await doc.embedPng(stampBytes!) : await doc.embedJpg(stampBytes!)
      page.drawImage(img, { x: R - SEAL, y: sigBase + 3 - SEAL / 2, width: SEAL, height: SEAL })
    } catch { /* 도장 실패 무시 */ }
  } else {
    TR(sigText + '   (인)', R, sigBase, 10, P_INK)
  }

  // ── 푸터 워드마크 (하단 12mm) ──
  const wmY = 12 * MM
  const stayW = W('stay', 8), eumW = W('eum', 8)
  const preW = W('made with ', 8)
  const startX = R - (preW + stayW + eumW)
  T('made with ', startX, wmY, 8, P_MUTED)
  T('stay', startX + preW, wmY, 8, P_INK)
  T('eum', startX + preW + stayW, wmY, 8, P_TC)

  return await doc.save()
}
