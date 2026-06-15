// 실거주 확인서 — 원본 빈 양식 PDF 위에 데이터·도장만 좌표로 얹어 발급(원본 100% 보존).
// 좌표는 lib/residenceCertLayout.ts(편집 화면과 공유). 채워 넣는 글자는 원본 폰트(돋움/고딕)에
// 맞춰 나눔고딕 임베드. subset:true 는 이 폰트에서 글리프가 깨져 전체 임베드 사용.

import { PDFDocument, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { RESIDENCE_CERT_SEOUL_PDF_BASE64 } from './residenceCertTemplateSeoul'
import { RC_TEXT_FIELDS, RC_ISSUE_GAPS, RC_STAMP } from './residenceCertLayout'

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
  landlordIdNo: string   // 생년월일(개인) 또는 사업자등록번호(사업자)
  landlordPhone: string
  issueDate: string      // YYYY-MM-DD
}

const TEMPLATE_BYTES = Uint8Array.from(Buffer.from(RESIDENCE_CERT_SEOUL_PDF_BASE64, 'base64'))

// 나눔고딕 TTF — 런타임 fetch + 모듈 캐시 (woff2 는 fontkit 임베드 불가라 ttf 사용)
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
  const font = await doc.embedFont(await getNanumGothic())
  const page = doc.getPages()[0]
  const black = rgb(0, 0, 0)
  const white = rgb(1, 1, 1)

  const widthOf = (t: string, s: number) => font.widthOfTextAtSize(t, s)
  const fitSize = (t: string, maxW: number, start: number, min = 7) => {
    let s = start
    while (s > min && widthOf(t, s) > maxW) s -= 0.5
    return s
  }

  // 단순 텍스트 칸 — 공유 좌표맵 기반
  const vals = v as unknown as Record<string, string>
  for (const f of RC_TEXT_FIELDS) {
    const t = vals[f.key]
    if (f.cover && t && t.trim()) {
      page.drawRectangle({ x: f.cover.x, y: f.cover.y, width: f.cover.w, height: f.cover.h, color: white })
    }
    if (!t) continue
    if (f.align === 'right') {
      page.drawText(t, { x: f.x - widthOf(t, f.size), y: f.y, size: f.size, font, color: black })
    } else if (f.align === 'center') {
      page.drawText(t, { x: f.x - widthOf(t, f.size) / 2, y: f.y, size: f.size, font, color: black })
    } else {
      const s = fitSize(t, f.width, f.size)
      page.drawText(t, { x: f.x, y: f.y, size: s, font, color: black })
    }
  }

  // 작성일 — '20 [  ]년 [  ]월 [  ]일' 빈칸 채움
  const m = (v.issueDate || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) {
    const parts: Record<string, string> = { yy: m[1].slice(2), mm: String(Number(m[2])), dd: String(Number(m[3])) }
    for (const g of RC_ISSUE_GAPS) {
      const t = parts[g.part]
      page.drawText(t, { x: g.cx - widthOf(t, g.size) / 2, y: g.y, size: g.size, font, color: black })
    }
  }

  // 도장 — 인쇄된 '(인)' 을 흰 박스로 덮고 그 자리에 도장 합성
  if (stampPng && stampPng.length > 0) {
    const c = RC_STAMP.cover
    page.drawRectangle({ x: c.x, y: c.y, width: c.w, height: c.h, color: white })
    const isPng = stampPng[0] === 0x89 && stampPng[1] === 0x50
    const img = isPng ? await doc.embedPng(stampPng) : await doc.embedJpg(stampPng)
    page.drawImage(img, { x: RC_STAMP.cx - RC_STAMP.size / 2, y: RC_STAMP.cy - RC_STAMP.size / 2, width: RC_STAMP.size, height: RC_STAMP.size })
  }

  return await doc.save()
}
