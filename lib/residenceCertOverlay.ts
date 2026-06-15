// 실거주 확인서 — 원본 빈 양식 PDF 위에 데이터·도장만 좌표로 얹어 발급(원본 100% 보존).
// 좌표는 원본(public/forms/residence-cert-seoul.pdf, A4 595.3×841.9pt, 원점 좌하단)에서
// pdfjs 로 라벨 baseline 을 추출해 매핑. 양식이 바뀌면 이 좌표맵만 갱신하면 된다.
// 채워 넣는 글자는 원본 폰트(돋움/고딕)에 맞춰 나눔고딕(고딕) 임베드.

import { PDFDocument, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { RESIDENCE_CERT_SEOUL_PDF_BASE64 } from './residenceCertTemplateSeoul'

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
  issueDate: string // YYYY-MM-DD
}

const TEMPLATE_BYTES = Uint8Array.from(Buffer.from(RESIDENCE_CERT_SEOUL_PDF_BASE64, 'base64'))

// 나눔고딕 TTF — 런타임 fetch + 모듈 캐시 (Pretendard 와 동일 방식, woff2 는 fontkit 임베드 불가라 ttf 사용)
const NANUM_URL = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/nanumgothic/NanumGothic-Regular.ttf'
let fontCache: Uint8Array | null = null
async function getNanumGothic(): Promise<Uint8Array> {
  if (fontCache) return fontCache
  const res = await fetch(NANUM_URL)
  if (!res.ok) throw new Error(`나눔고딕 폰트 다운로드 실패 (${res.status})`)
  fontCache = new Uint8Array(await res.arrayBuffer())
  return fontCache
}

export async function fillResidenceCertSeoul(
  v: ResidenceCertFields,
  stampPng: Uint8Array | null,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(TEMPLATE_BYTES)
  doc.registerFontkit(fontkit)
  // subset:true 는 이 폰트에서 글리프가 깨져(글자 누락·오표기) 전체 임베드 사용.
  const font = await doc.embedFont(await getNanumGothic())
  const page = doc.getPages()[0]
  const black = rgb(0, 0, 0)
  const white = rgb(1, 1, 1)

  const widthOf = (t: string, s: number) => font.widthOfTextAtSize(t, s)
  // 최대폭에 맞춰 글자 크기 자동 축소(긴 주소 대응)
  const fitSize = (t: string, maxW: number, start = 11, min = 7.5) => {
    let s = start
    while (s > min && widthOf(t, s) > maxW) s -= 0.5
    return s
  }
  const draw = (t: string | undefined, x: number, y: number, size = 11) => {
    if (t) page.drawText(t, { x, y, size, font, color: black })
  }
  const drawFit = (t: string | undefined, x: number, y: number, maxW: number, start = 11) => {
    if (t) page.drawText(t, { x, y, size: fitSize(t, maxW, start), font, color: black })
  }
  const drawRight = (t: string | undefined, xEnd: number, y: number, size = 11) => {
    if (t) page.drawText(t, { x: xEnd - widthOf(t, size), y, size, font, color: black })
  }
  const drawCenter = (t: string | undefined, cx: number, y: number, size = 11) => {
    if (t) page.drawText(t, { x: cx - widthOf(t, size) / 2, y, size, font, color: black })
  }

  // ── 소재지 / 면적 ───────────────────────────────────────────
  drawFit(v.siteAddress, 140, 700.4, 240, 11)
  drawCenter(v.areaM2, 448, 700.4, 11) // : (~432) 와 ㎡ (463) 사이

  // ── 임차인 ── (값은 칸 경계선에서 살짝 들여써 x=252) ──────────
  drawFit(v.tenantName, 252, 671.6, 285, 11)
  drawFit(v.tenantAddress, 252, 643.8, 285, 11)
  draw(v.tenantBirth, 252, 615.8, 11)
  draw(v.tenantPhone, 252, 588, 11)

  // ── 거주기간 — 인쇄된 '20 . . . ~ 20 . . .' 를 흰 박스로 덮고 다시 씀 ──
  if (v.periodText && v.periodText.trim()) {
    page.drawRectangle({ x: 143, y: 550, width: 188, height: 16, color: white })
    drawFit(v.periodText, 147, 556.3, 184, 10.5)
  }

  // ── 임대료 / 보증금 — 인쇄된 '원' 앞에 우측정렬 ──
  drawRight(v.rentText, 241, 520.8, 11)
  drawRight(v.depositText, 366, 520.8, 11)

  // ── 작성일 — '20 [  ]년 [  ]월 [  ]일' 빈칸 채움 ──
  {
    const m = (v.issueDate || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
    if (m) {
      const yy = m[1].slice(2)
      drawCenter(yy, 258.8, 420.3, 11)            // 인쇄된 '20' 뒤
      drawCenter(String(Number(m[2])), 292.8, 420.3, 11)
      drawCenter(String(Number(m[3])), 337, 420.3, 11)
    }
  }

  // ── 임대인(확인) ───────────────────────────────────────────
  drawFit(v.landlordBusinessName, 180, 349, 350, 11)
  draw(v.landlordName, 180, 322.2, 11)
  drawFit(v.landlordAddress, 180, 295.2, 350, 11)
  // '생 년 월 일 :' 줄 = 개인이면 생년월일, 사업자면 사업자등록번호. 아래 '(사업자등록번호)'는 안내 라벨이라 값 안 찍음.
  draw(v.landlordBirth || v.landlordRegistrationNo, 180, 271.6, 11)
  draw(v.landlordPhone, 180, 228.9, 11)

  // ── 도장 — 인쇄된 '(인)' 을 흰 박스로 덮고 그 자리에 도장 합성 ──
  if (stampPng && stampPng.length > 0) {
    page.drawRectangle({ x: 308, y: 318, width: 22, height: 16, color: white })
    const isPng = stampPng[0] === 0x89 && stampPng[1] === 0x50
    const img = isPng ? await doc.embedPng(stampPng) : await doc.embedJpg(stampPng)
    const SEAL = 46
    page.drawImage(img, { x: 319 - SEAL / 2, y: 326 - SEAL / 2, width: SEAL, height: SEAL })
  }

  return await doc.save()
}
