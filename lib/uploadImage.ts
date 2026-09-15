// 밖으로 나갈 업로드 파일을 올리기 전에 정규화하는 정본 — 변환은 브라우저에서만 돈다.
//
// 왜 있나 (2026-09-16 운영자 결정). 아이폰이 찍는 사진은 HEIC 다. 그 바이트를 그대로 저장하면
// 파일은 멀쩡히 올라가는데 **쓰는 자리에서 전부 깨진다.** 사업자등록증은 상담 문자·메일 첨부로
// 열리지 않는 파일이 되어 나가고, 도장은 pdf-lib 의 embedPng/embedJpg 가 못 읽어 실거주 확인서
// 발급이 통째로 실패하며(lib/residenceCertOverlay), 계약서 렌더는 image/heic data URI 를 크로미움이
// 못 그려 **도장 없는 계약서가 조용히 나간다.**
//
// 서버에서 못 고친다. sharp 는 next 의 선택적 전이 의존이고 그 libheif 빌드가 AVIF 만 물어 HEIC
// 디코드가 실패한다(실측). 순수 JS 디코더는 wasm 8.78MB 라 업로드 구조까지 바꿔야 한다.
// 브라우저는 이미 HEIC 를 안다 — 사파리는 네이티브로, 그 밖은 createImageBitmap 이 답한다.
// 그래서 **올리기 전에 브라우저에서 바꾼다.**
//
// 디코드 문법은 lib/ocrImage 의 fileToOcrImage 정본을 그대로 쓴다(EXIF 회전을 픽셀에 박고,
// 비트맵·캔버스를 즉시 반납). 다른 점은 **실패했을 때**다. AI 인식은 원본을 그대로 보내도
// Gemini 가 HEIC 를 읽어 주지만, 여기서 원본이 통과하면 그 바이트가 그대로 저장돼 위 세 자리가
// 다시 깨진다. 그래서 **디코드 실패는 던진다** — 조용한 원본 통과는 이 파일의 금지 사항이다.
//
// 어느 형식으로 바꾸는가는 그 파일이 무엇이 되는가로 갈린다.
//   · 종이가 되는 것(사업자등록증·스캔 계약서) = PDF 한 장. 소비처 전부가 PDF 를 다룰 줄 안다.
//   · 그림으로 얹히는 것(도장·계약서용 로고) = PNG. 알파가 정보라 JPEG 로 바꾸면 도장 배경이
//     흰 사각형이 되어 서명란을 덮는다.

import { sniffDocMime, extForDocMime, DOC_MIME_PDF } from './docMime'
import { ocrTargetSize } from './ocrImage'

/**
 * 종이로 굳힐 사진의 최대 변(px)과 품질.
 *
 * 2048 은 신분증·계약서 프리셋과 같은 값이다(lib/ocrImage 의 근거 그대로 — 사업자등록증도
 * 등록번호·업태가 잔글자다). 품질 0.9 로 2048px 이면 1MB 안쪽이라 등록증 상한 4MB 에 여유가 있다.
 */
export const UPLOAD_DOC_MAX_EDGE = 2048
export const UPLOAD_DOC_QUALITY = 0.9

/**
 * 그림으로 얹힐 사진의 최대 변(px).
 *
 * 도장은 종이에서 2cm 남짓, 계약서 로고는 헤더 한 줄이라 1024 면 충분하다. 값이 작은 이유는
 * **PNG 는 사진을 못 줄이기 때문**이다 — 알파를 지키려고 PNG 로 내보내는데 2048px 사진이면
 * 인코딩 결과가 5MB 상한을 넘어 업로드가 거부된다. 이미 PNG·JPEG 인 파일은 이 경로를 안 탄다.
 */
export const UPLOAD_IMAGE_MAX_EDGE = 1024

/** A4 긴 변(pt). 용지 크기를 이미지 픽셀로 잡으면 4032px 사진이 1.4m 짜리 종이가 된다. */
const A4_LONG_PT = 841.89

export type UploadFile = {
  /** 올릴 파일 — 변환됐으면 새 File, 아니면 형식이 확정된 원본. */
  file: File
  /** 바이트를 바꿨는가. 부르는 쪽이 그 사실을 사람에게 말한다. */
  converted: boolean
}

/** 디코드를 못 했을 때 사람에게 할 말 — 네 입구가 같은 문장을 쓴다. */
export const UPLOAD_DECODE_FAIL = '이 사진 형식은 이 기기에서 변환할 수 없습니다. JPG 나 PNG 로 저장해 다시 올려 주세요.'

/** 파일 이름의 확장자만 갈아 끼운다 — 바이트를 바꿔 놓고 이름이 .HEIC 로 남으면 저장 이름이 거짓말이 된다. */
export function swapExt(fileName: string, ext: string): string {
  const base = (fileName || '').replace(/\.[^.\\/]*$/, '').trim()
  return `${base || 'upload'}.${ext}`
}

/**
 * 이미지 한 장을 감쌀 용지 크기(pt) — **비율은 이미지 그대로**, 긴 변이 A4 긴 변이다.
 *
 * 비율을 안 맞추면 A4 에 억지로 끼워 넣느라 위아래 흰 띠가 생기거나 잘린다. 긴 변을 A4 에
 * 맞추는 것은 인쇄했을 때의 물리 크기를 사람이 아는 값으로 두려는 것뿐이다.
 */
export function uploadPdfPageSize(w: number, h: number): { w: number; h: number } {
  const long = Math.max(w, h)
  if (!(long > 0)) return { w: A4_LONG_PT, h: A4_LONG_PT }
  const sc = A4_LONG_PT / long
  return { w: w * sc, h: h * sc }
}

/** toBlob 을 프로미스로 — 실패(null)는 던진다(lib/ocrImage 의 canvasToJpeg 와 같은 문법). */
function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('사진을 변환하지 못했습니다.')), type, quality)
  })
}

/**
 * 사진을 줄여 다시 인코딩한다. **디코드 실패는 던진다.**
 *
 * 디코드와 캔버스를 한 try 로 묶지 않는 이유는 정본과 같다 — 멀쩡히 디코드된 사진이 캔버스
 * 사고 하나로 다른 분기에 실려 나가는 것을 막는다. 여기서는 어느 쪽 실패든 던지지만, 사람에게
 * 할 말이 다르다(형식 문제인가, 기기 사정인가).
 */
async function reencode(
  file: File, maxEdge: number, type: string, quality?: number,
): Promise<{ blob: Blob; w: number; h: number }> {
  let bitmap: ImageBitmap
  try {
    // EXIF 회전을 픽셀에 적용해 받는다 — 눕혀 찍은 등록증이 눕힌 채로 종이에 박히는 것을 막는다.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error(UPLOAD_DECODE_FAIL)
  }
  const canvas = document.createElement('canvas')
  try {
    const { w, h } = ocrTargetSize(bitmap.width, bitmap.height, maxEdge)
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('사진을 변환하지 못했습니다.')
    ctx.drawImage(bitmap, 0, 0, w, h)
    return { blob: await canvasToBlob(canvas, type, quality), w, h }
  } finally {
    // 비트맵과 캔버스 백킹 스토어를 즉시 반납 — 사파리는 캔버스 회수가 게을러 0 대입이 위생이다.
    bitmap.close?.()
    canvas.width = 0; canvas.height = 0
  }
}

/**
 * JPEG 한 장을 한 쪽짜리 PDF 로 싼다. **페이지는 언제나 하나다.**
 *
 * pdf-lib 은 호출 시점 dynamic import — 주 번들에 202KB(gzip)를 얹지 않는다(lib/pdfToPng 문법).
 */
export async function imageToSinglePagePdf(jpeg: Uint8Array, w: number, h: number): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  const img = await doc.embedJpg(jpeg)
  const size = uploadPdfPageSize(w, h)
  const page = doc.addPage([size.w, size.h])
  page.drawImage(img, { x: 0, y: 0, width: size.w, height: size.h })
  return await doc.save()
}

/**
 * 종이가 될 파일을 PDF 로 — 이미 PDF 면 그대로, 사진이면 한 장짜리 PDF 로 싼다.
 *
 * **판정은 이름이 아니라 바이트다**([[doc-file-format]]). 파일 앱에서 고른 파일은 file.type 이
 * 빈 문자열일 수 있고 확장자도 거짓일 수 있다.
 */
export async function fileToUploadPdf(file: File): Promise<UploadFile> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  if (sniffDocMime(head) === DOC_MIME_PDF) {
    // 형식은 맞는데 이름·type 이 비어 있을 수 있다 — 저장 이름과 전송 Content-Type 이 되는 값이라 채운다.
    const named = file.type === DOC_MIME_PDF ? file
      : new File([file], swapExt(file.name, 'pdf'), { type: DOC_MIME_PDF })
    return { file: named, converted: false }
  }
  const { blob, w, h } = await reencode(file, UPLOAD_DOC_MAX_EDGE, 'image/jpeg', UPLOAD_DOC_QUALITY)
  const pdf = await imageToSinglePagePdf(new Uint8Array(await blob.arrayBuffer()), w, h)
  // 한 번 더 감싸는 것은 타입 때문이다 — pdf-lib 의 save() 는 SharedArrayBuffer 도 될 수 있는
  // 뷰를 돌려주는데 File 은 그것을 못 받는다. 복사는 1MB 안쪽이라 값이 싸다.
  return { file: new File([new Uint8Array(pdf)], swapExt(file.name, 'pdf'), { type: DOC_MIME_PDF }), converted: true }
}

/**
 * 그림으로 얹힐 파일을 PNG·JPEG 로 — 이미 그 둘이면 그대로, 아니면 PNG 로 다시 그린다.
 *
 * PDF 는 여기 오면 안 된다(도장 자리에 종이를 넣을 수 없다). 바이트가 PNG·JPEG 가 아니면
 * 전부 다시 그리므로 PDF 도 디코드 실패로 걸러진다.
 */
export async function fileToUploadImage(file: File): Promise<UploadFile> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  const mime = sniffDocMime(head)
  if (mime === 'image/png' || mime === 'image/jpeg') {
    const named = file.type === mime ? file
      : new File([file], swapExt(file.name, extForDocMime(mime)), { type: mime })
    return { file: named, converted: false }
  }
  const { blob } = await reencode(file, UPLOAD_IMAGE_MAX_EDGE, 'image/png')
  return { file: new File([blob], swapExt(file.name, 'png'), { type: 'image/png' }), converted: true }
}
