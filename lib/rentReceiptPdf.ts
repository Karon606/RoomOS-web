// 월세 영수증(외국인등록증 신청용) — 자체 양식을 pdf-lib 로 직접 그림(원본 템플릿 없음).
// 글자는 실거주 확인서와 같은 나눔고딕 임베드.

import { PDFDocument, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { getNanumGothic } from './residenceCertOverlay'

export type RentReceiptFields = {
  issueDate: string      // YYYY-MM-DD (발행일)
  nameRoom: string       // 이름 (호실)
  period: string         // 거주 기간
  amount: string         // 금액(월세)
  recipientName: string  // 수령인 이름/서명 (거주제공자)
  recipientPhone: string // 수령인 연락처
}

const PAGE_W = 595.28
const PAGE_H = 841.89

const issueDateLabel = (d: string) => {
  const [y, m, dd] = (d ?? '').split('-').map(Number)
  return Number.isFinite(y) ? `${y}. ${m}. ${dd}` : (d ?? '')
}

export async function buildRentReceiptPdf(
  f: RentReceiptFields,
  stampBytes: Uint8Array | null,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const font = await doc.embedFont(await getNanumGothic())
  const page = doc.addPage([PAGE_W, PAGE_H])
  const black = rgb(0, 0, 0)
  const gray = rgb(0.35, 0.35, 0.35)

  const text = (t: string, x: number, y: number, size = 11, color = black) => {
    if (t) page.drawText(t, { x, y, size, font, color })
  }
  const widthOf = (t: string, s: number) => font.widthOfTextAtSize(t, s)
  const center = (t: string, cx: number, y: number, size: number, color = black) =>
    text(t, cx - widthOf(t, size) / 2, y, size, color)
  const right = (t: string, xEnd: number, y: number, size: number, color = black) =>
    text(t, xEnd - widthOf(t, size), y, size, color)
  const fit = (t: string, x: number, y: number, maxW: number, start: number) => {
    let s = start
    while (s > 8 && widthOf(t, s) > maxW) s -= 0.5
    text(t, x, y, s)
  }

  const cx = PAGE_W / 2

  // 제목
  center('월 세 영 수 증', cx, 770, 24)
  center('( 외국인등록증 신청용 )', cx, 748, 11, gray)

  // 발행일 (우측 상단)
  text('발행일', 362, 712, 10.5, gray)
  text(issueDateLabel(f.issueDate), 402, 712, 11)
  page.drawLine({ start: { x: 400, y: 709 }, end: { x: 525, y: 709 }, thickness: 0.7, color: gray })

  // 안내
  text('아래 금액을 영수함', 70, 712, 12)

  // 표
  const left = 70, rightEdge = 525, labelX = 200
  const rows = [
    { label: '이름 (호실)', value: f.nameRoom },
    { label: '거주 기간', value: f.period },
    { label: '금액', value: f.amount ? `${f.amount}` : '' },
    { label: '수령인 이름 / 서명', value: f.recipientName, stamp: true },
    { label: '수령인 연락처 (전화번호)', value: f.recipientPhone },
  ]
  const rowH = 46
  const top = 678
  const bottom = top - rowH * rows.length

  // 외곽·내부 선
  page.drawRectangle({ x: left, y: bottom, width: rightEdge - left, height: top - bottom, borderColor: black, borderWidth: 1 })
  page.drawLine({ start: { x: labelX, y: top }, end: { x: labelX, y: bottom }, thickness: 0.8, color: black })
  for (let i = 1; i < rows.length; i++) {
    const ly = top - rowH * i
    page.drawLine({ start: { x: left, y: ly }, end: { x: rightEdge, y: ly }, thickness: 0.8, color: black })
  }

  rows.forEach((r, i) => {
    const rowTop = top - rowH * i
    const baseY = rowTop - rowH / 2 - 4   // 행 중앙 베이스라인 근사
    right(r.label, labelX - 12, baseY, 11)
    fit(r.value, labelX + 14, baseY, rightEdge - labelX - 70, 11)
  })

  // 도장 (수령인 이름/서명 행, index 3) — embed 가 async 라 루프 밖에서
  if (stampBytes && stampBytes.length > 0) {
    const stampRowTop = top - rowH * 3
    const isPng = stampBytes[0] === 0x89 && stampBytes[1] === 0x50
    const img = isPng ? await doc.embedPng(stampBytes) : await doc.embedJpg(stampBytes)
    const SEAL = 42
    page.drawImage(img, { x: rightEdge - 70, y: stampRowTop - rowH / 2 - SEAL / 2, width: SEAL, height: SEAL })
  }

  return await doc.save()
}
