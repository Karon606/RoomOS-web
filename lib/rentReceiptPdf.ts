// 월세 영수증 — 자체 양식을 pdf-lib 로 직접 그림(원본 템플릿 없음).
// 브랜드 헤더(영업장명·로고·사업자정보) + 영수증번호 + 표 + 수령인 서명/도장 + 워드마크.
// 글자는 실거주 확인서와 같은 나눔고딕 임베드.

import { PDFDocument, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { getNanumGothic } from './residenceCertOverlay'

export type RentReceiptFields = {
  issueDate: string      // YYYY-MM-DD (발행일)
  name: string           // 성명
  room: string           // 호실
  period: string         // 거주 기간 (1달 선납 주기)
  amount: string         // 금액(숫자만 권장 — ₩ 자동)
  recipientName: string  // 수령인 이름/서명 (거주제공자)
  recipientPhone: string // 수령인 연락처
}

export type RentReceiptBrand = {
  businessName: string   // 상호
  businessSub: string    // '주소 · 사업자 ... · T. ...'
  receiptNo: string      // 영수증 번호
}

const PAGE_W = 595.28
const PAGE_H = 841.89
const BRAND = rgb(0.627, 0.235, 0.176)   // #A03C2E terracotta
const INK = rgb(0.1, 0.1, 0.1)
const GRAY = rgb(0.42, 0.42, 0.42)
const LINE = rgb(0.8, 0.78, 0.74)

const issueDateLabel = (d: string) => {
  const [y, m, dd] = (d ?? '').split('-').map(Number)
  return Number.isFinite(y) ? `${y}. ${m}. ${dd}` : (d ?? '')
}
const amountLabel = (a: string) => {
  const t = (a ?? '').trim()
  if (!t) return ''
  return /[₩원]/.test(t) ? t : `₩ ${t}`
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

  const widthOf = (t: string, s: number) => font.widthOfTextAtSize(t, s)
  const text = (t: string, x: number, y: number, size = 11, color = INK) => { if (t) page.drawText(t, { x, y, size, font, color }) }
  const right = (t: string, xEnd: number, y: number, size: number, color = INK) => text(t, xEnd - widthOf(t, size), y, size, color)
  const center = (t: string, cx: number, y: number, size: number, color = INK) => text(t, cx - widthOf(t, size) / 2, y, size, color)
  const fit = (t: string, x: number, y: number, maxW: number, start: number, color = INK) => {
    let s = start; while (s > 8 && widthOf(t, s) > maxW) s -= 0.5; text(t, x, y, s, color)
  }

  const L = 55, R = 540

  // ── 헤더 — 로고 + 영업장명 / '영수증' ──
  let nameX = L
  if (logoBytes && logoBytes.length > 0) {
    try {
      const isPng = logoBytes[0] === 0x89 && logoBytes[1] === 0x50
      const img = isPng ? await doc.embedPng(logoBytes) : await doc.embedJpg(logoBytes)
      const H = 34, w = (img.width / img.height) * H
      page.drawImage(img, { x: L, y: 776, width: Math.min(w, 90), height: H })
      nameX = L + Math.min(w, 90) + 10
    } catch { /* 로고 실패 무시 */ }
  }
  fit(brand.businessName || '영수증', nameX, 794, 320, 15, BRAND)
  if (brand.businessSub) fit(brand.businessSub, nameX, 778, 340, 8.5, GRAY)
  right('영 수 증', R, 786, 23, INK)

  // 브랜드 룰
  page.drawRectangle({ x: L, y: 766, width: R - L, height: 2, color: BRAND })

  // ── 영수증번호 / 발행일 ──
  text(`No. ${brand.receiptNo}`, L, 747, 9, GRAY)
  right(`발행일  ${issueDateLabel(f.issueDate)}`, R, 747, 10, INK)

  text('아래 금액을 정히 영수하였습니다.', L, 718, 11.5, INK)

  // ── 표 (성명 / 호실 / 거주기간 / 금액) ──
  const rows = [
    { label: '성    명', value: f.name, big: false },
    { label: '호    실', value: f.room, big: false },
    { label: '거주 기간', value: f.period, big: false },
    { label: '금    액', value: amountLabel(f.amount), big: true },
  ]
  const labelX = 150, rowH = 42, top = 692
  const bottom = top - rowH * rows.length
  page.drawRectangle({ x: L, y: bottom, width: R - L, height: top - bottom, borderColor: LINE, borderWidth: 1 })
  page.drawLine({ start: { x: labelX, y: top }, end: { x: labelX, y: bottom }, thickness: 1, color: LINE })
  for (let i = 1; i < rows.length; i++) {
    const ly = top - rowH * i
    page.drawLine({ start: { x: L, y: ly }, end: { x: R, y: ly }, thickness: 1, color: LINE })
  }
  rows.forEach((r, i) => {
    const rowTop = top - rowH * i
    const baseY = rowTop - rowH / 2 - 4
    // 라벨 칸 옅은 배경
    page.drawRectangle({ x: L, y: rowTop - rowH, width: labelX - L, height: rowH, color: rgb(0.97, 0.95, 0.93) })
    center(r.label, (L + labelX) / 2, baseY, 10.5, GRAY)
    if (r.big) fit(r.value, labelX + 16, rowTop - rowH / 2 - 5, R - labelX - 32, 15, BRAND)
    else fit(r.value, labelX + 16, baseY, R - labelX - 32, 11.5, INK)
  })

  // ── 수령인 서명/도장 ──
  const sigY = bottom - 40
  text('위 금액을 영수함.', L, sigY + 14, 10.5, GRAY)
  const hasStamp = !!(stampBytes && stampBytes.length > 0)
  text('수 령 인', L, sigY - 18, 11, INK)
  text(':', L + 60, sigY - 18, 11, INK)
  text(f.recipientName, L + 74, sigY - 18, 12, INK)
  const sealX = L + 74 + widthOf(f.recipientName, 12) + 10
  if (!hasStamp) text('(인)', sealX, sigY - 18, 11, GRAY)
  text('연 락 처', L, sigY - 46, 11, INK)
  text(':', L + 60, sigY - 46, 11, INK)
  text(f.recipientPhone, L + 74, sigY - 46, 11, INK)

  if (hasStamp) {
    try {
      const isPng = stampBytes![0] === 0x89 && stampBytes![1] === 0x50
      const img = isPng ? await doc.embedPng(stampBytes!) : await doc.embedJpg(stampBytes!)
      const SEAL = 42
      page.drawImage(img, { x: sealX, y: sigY - 14 - SEAL / 2 + 6, width: SEAL, height: SEAL })
    } catch { /* 도장 실패 무시 */ }
  }

  // ── 워드마크 (하단) ──
  const wmY = 70
  const pre = 'made with '
  text(pre, R - widthOf(pre, 8) - widthOf('stayeum', 9), wmY, 8, rgb(0.72, 0.69, 0.64))
  const stayX = R - widthOf('stayeum', 9)
  text('stay', stayX, wmY, 9, rgb(0.45, 0.45, 0.45))
  text('eum', stayX + widthOf('stay', 9), wmY, 9, BRAND)

  return await doc.save()
}
