// AI 인식에 보낼 사진을 줄여 서버 액션용 FormData 파일로 싸는 정본 — 축소는 브라우저에서만 돈다.
//
// 왜 문자열이 아니라 파일인가(긴급 신고 2026-09-03, 축소 배포 뒤에도 같은 날 19:02 재발).
// 서버 액션의 인자는 React 직렬화기(decodeReply)가 되읽는데, 이 디코더는 인자 전체가 쓰는
// 직렬화 슬롯을 1,000,000 개로 제한한다. 문자열은 1자가 1슬롯이라 base64 인자는 정확히
// 1,000,000 자, 원본으로 약 730KB 에서 "Maximum array nesting exceeded" 로 터진다.
// next.config.ts 의 serverActions.bodySizeLimit 10MB 는 별개의 바깥 문이고, 실제 구속은
// 이 슬롯 한도였다. FormData 에 실은 File 은 슬롯을 그렇게 먹지 않아 6MB 도 통과한다(실측).
// 그래서 이미지 바이트는 어떤 경로로도 문자열 인자로 싣지 않고 ocrForm 이 싼 FormData 로만
// 싣는다. 서버 쪽 되읽기는 lib/ocrImageServer 의 readOcrImageForm 이 정본이다.
//
// 축소 자체가 왜 필요한가는 그대로다. 원본을 통째로 다루면 모바일에서 탭이 죽어 등록 폼 값이
// 사라지고, 큰 사진은 본문 상한에도 걸린다.

/**
 * 축소 규격 프리셋.
 *
 * **값을 셋으로 늘리지 말 것.** 두 값이 왜 다른지가 여기 적혀 있고, 세 번째가 생기면 그때부터
 * 아무도 근거를 모른다.
 *
 *   receipt  — 영수증. 폭이 좁고 글자가 상대적으로 커 1600 이면 읽힌다(ReceiptScanModal 실측 값).
 *   document — 신분증·계약서·도면. 외국인등록증은 프레임의 절반쯤만 차지한 채 찍히는 일이 흔하고
 *              등록번호·로마자 성명이 잔글자다. 2048 이면 카드가 프레임 60% 여도 카드 폭이
 *              1200px 라 잔글자가 20px 대로 남는다.
 *
 * 화질을 깎아 크기를 맞추는 사다리는 두지 않는다. 깎아야 할 만큼 큰 사진이 바로 잔글자가 많은
 * 사진이라 목적과 수단이 충돌한다. FormData 로 실으면 6MB 까지 들어가므로 깎을 이유도 없다.
 */
export const OCR_PRESET = {
  receipt: { maxEdge: 1600, quality: 0.85 },
  document: { maxEdge: 2048, quality: 0.9 },
} as const
export type OcrPreset = keyof typeof OCR_PRESET

/**
 * AI 인식 액션에 실을 수 있는 사진 크기 상한(바이트).
 *
 * FormData 는 base64 팽창 없이 실리므로 본문 상한 10MB 아래의 보수 여유선이다. 서버가 Gemini 에
 * 넣을 때의 팽창 1.37배를 얹어도 8.2MB 로 Gemini 인라인 요청 상한 아래에 남는다.
 * 클라이언트(ocrForm)와 서버(readOcrImageForm) 양쪽이 이 한 값을 문으로 쓴다.
 */
export const OCR_FALLBACK_MAX_BYTES = 6 * 1024 * 1024

/** FormData 필드명 — 클라이언트와 서버가 같은 이름을 봐야 하므로 여기 한 곳에 둔다. */
export const OCR_FORM_FIELD = 'image'

/** 목표 치수 — 원본이 이미 작으면 키우지 않는다(확대는 글자를 뭉갤 뿐 정보를 안 늘린다). */
export function ocrTargetSize(w: number, h: number, maxEdge: number): { w: number; h: number } {
  const sc = Math.min(1, maxEdge / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * sc)), h: Math.max(1, Math.round(h * sc)) }
}

/** 액션에 실어도 되는 크기인가. */
export function ocrFallbackAllowed(bytes: number): boolean {
  return bytes <= OCR_FALLBACK_MAX_BYTES
}

export type OcrImage = { file: File; mime: string }

/**
 * AI 인식 액션에 보낼 FormData 를 싸는 유일한 문. 크기 문도 여기서 한 번 더 선다.
 *
 * 부르는 쪽은 던지는 것을 catch 해 사람 말로 옮긴다(문구는 여기 것을 그대로 쓴다).
 */
export function ocrForm(file: File): FormData {
  if (!ocrFallbackAllowed(file.size)) {
    throw new Error('사진이 너무 커서 분석할 수 없습니다. 화면을 캡처해 다시 올려 주세요.')
  }
  const fd = new FormData()
  fd.append(OCR_FORM_FIELD, file)
  return fd
}

/** 파일명 확장자로 mime 을 메운다 — 파일 앱에서 고른 파일은 file.type 이 빈 문자열일 수 있다. */
function mimeOf(file: File): string {
  if (file.type) return file.type
  const ext = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  switch (ext) {
    case 'heic': return 'image/heic'
    case 'heif': return 'image/heif'
    case 'png': return 'image/png'
    case 'webp': return 'image/webp'
    case 'pdf': return 'application/pdf'
    default: return 'image/jpeg'
  }
}

/** toBlob 을 프로미스로 — 실패(null)는 던져서 폴백 분기로 합류시킨다. */
function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('사진을 압축하지 못했습니다.')), 'image/jpeg', quality)
  })
}

/**
 * 사진을 프리셋 규격으로 줄여 전송용 File 로 바꾼다.
 *
 * 디코드를 못 하면(HEIC 등) 원본 File 을 그대로 돌려준다. Gemini 가 image/heic·image/heif·
 * application/pdf 인라인을 네이티브로 받으므로 인식 품질이 떨어지지 않고, FormData 로 실리니
 * 크기도 6MB 까지 문제없다. **base64 문자열은 어느 분기에서도 만들지 않는다** — 그 거대 문자열이
 * 모바일 사파리 탭을 죽였고 서버 액션 슬롯 한도에도 걸렸다.
 */
export async function fileToOcrImage(file: File, preset: OcrPreset): Promise<OcrImage> {
  const { maxEdge, quality } = OCR_PRESET[preset]
  let bitmap: ImageBitmap
  try {
    // EXIF 회전을 픽셀에 적용해 받는다 — 눕혀 찍은 신분증이 그대로 눕혀 인식되는 것을 막는다.
    // 폴백 진입은 이 디코드 실패에만 건다. 아래 캔버스 단계까지 한 try 로 묶으면 멀쩡히 디코드된
    // 5MB JPEG 이 캔버스 사고 하나로 원본 전송에 실려 나간다.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    return { file, mime: mimeOf(file) }
  }
  const canvas = document.createElement('canvas')
  try {
    const { w, h } = ocrTargetSize(bitmap.width, bitmap.height, maxEdge)
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d 컨텍스트를 만들지 못했습니다.')
    ctx.drawImage(bitmap, 0, 0, w, h)
    const blob = await canvasToJpeg(canvas, quality)
    return { file: new File([blob], 'ocr.jpg', { type: 'image/jpeg' }), mime: 'image/jpeg' }
  } finally {
    // 비트맵과 캔버스 백킹 스토어를 즉시 반납한다 — 사파리는 캔버스 회수가 게을러서 0 대입이 위생이다.
    bitmap.close?.()
    canvas.width = 0; canvas.height = 0
  }
}
