// AI 인식에 보낼 사진을 줄여 base64 로 바꾸는 정본 — 브라우저에서만 돈다.
//
// 왜 필요한가(긴급 신고 2026-09-03). 입주자 등록에서 외국인등록증을 찍어 올리면 아무 반응 없이
// 튕기고 입력하던 정보가 통째로 날아갔다. 원인이 둘 겹쳤다.
//
//   · **원본을 그대로 보냈다.** 서버 액션 본문 상한은 10MB 인데 base64 는 원본의 약 1.37배라
//     7.3MB 넘는 사진이면 프레임워크가 요청을 거부한다. 그 거부는 액션 안 try/catch 밖에서 난다.
//   · **바이트를 하나씩 문자열에 붙였다.** 4MB 사진이면 400만 회 반복이고, JS 문자열은 UTF-16 이라
//     결과만 8MB 에 로프 노드가 수백만 개다. 촬영 직후라 원본 비트맵도 살아 있는 시점이라
//     모바일 사파리가 탭을 죽인다. 탭이 다시 뜨면 등록 폼 값이 전부 사라진다.
//
// 형제 정본이 이미 있었다. 영수증 스캔(components/ReceiptScanModal)은 축소·압축한 뒤 보낸다.
// 신분증·계약서·도면 경로만 그것을 안 탔다. 그래서 규칙을 여기 한 벌로 모은다.

/**
 * 축소 규격 프리셋.
 *
 * **값을 셋으로 늘리지 말 것.** 두 값이 왜 다른지가 여기 적혀 있고, 세 번째가 생기면 그때부터
 * 아무도 근거를 모른다.
 *
 *   receipt  — 영수증. 폭이 좁고 글자가 상대적으로 커 1600 이면 읽힌다(ReceiptScanModal 실측 값).
 *   document — 신분증·계약서·도면. 외국인등록증은 프레임의 절반쯤만 차지한 채 찍히는 일이 흔하고
 *              등록번호·로마자 성명이 잔글자다. 2048 이면 카드가 프레임 60% 여도 카드 폭이
 *              1200px 라 잔글자가 20px 대로 남는다. 결과물은 대개 300KB~1MB 로 한도의 7분의 1이다.
 */
export const OCR_PRESET = {
  receipt: { maxEdge: 1600, quality: 0.85 },
  document: { maxEdge: 2048, quality: 0.9 },
} as const
export type OcrPreset = keyof typeof OCR_PRESET

/**
 * 축소를 못 했을 때 원본을 그대로 보내도 되는 상한(바이트).
 *
 * base64 팽창(약 1.37배)을 얹어도 서버 액션 상한 10MB 아래에 남는 선이다. 구형 사파리의 HEIC
 * 처럼 브라우저가 디코드를 거부하는 형식이 있어 폴백 길 자체는 남기되, 그 길에도 문은 둔다.
 */
export const OCR_FALLBACK_MAX_BYTES = 6 * 1024 * 1024

/** 목표 치수 — 원본이 이미 작으면 키우지 않는다(확대는 글자를 뭉갤 뿐 정보를 안 늘린다). */
export function ocrTargetSize(w: number, h: number, maxEdge: number): { w: number; h: number } {
  const sc = Math.min(1, maxEdge / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * sc)), h: Math.max(1, Math.round(h * sc)) }
}

/** 폴백(원본 전송)이 가능한 크기인가. */
export function ocrFallbackAllowed(bytes: number): boolean {
  return bytes <= OCR_FALLBACK_MAX_BYTES
}

export type OcrImage = { b64: string; mime: string }

/** data URL 에서 base64 몸통만. */
const bodyOf = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(',') + 1)

/**
 * 사진을 프리셋 규격으로 줄여 base64 로 바꾼다.
 *
 * 디코드를 못 하면(HEIC 등) 원본을 `FileReader` 로 읽어 그대로 보낸다 — **바이트 루프를 쓰지
 * 않는다.** 그 길은 상한을 넘으면 던지고, 부르는 쪽이 사람 말로 옮긴다.
 */
export async function fileToOcrImage(file: File, preset: OcrPreset): Promise<OcrImage> {
  const { maxEdge, quality } = OCR_PRESET[preset]
  try {
    // EXIF 회전을 픽셀에 적용해 받는다 — 눕혀 찍은 신분증이 그대로 눕혀 인식되는 것을 막는다.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    try {
      const { w, h } = ocrTargetSize(bitmap.width, bitmap.height, maxEdge)
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('canvas 2d 컨텍스트를 만들지 못했습니다.')
      ctx.drawImage(bitmap, 0, 0, w, h)
      return { b64: bodyOf(canvas.toDataURL('image/jpeg', quality)), mime: 'image/jpeg' }
    } finally { bitmap.close?.() }
  } catch {
    if (!ocrFallbackAllowed(file.size)) {
      throw new Error('사진이 너무 커서 분석할 수 없습니다. 화면을 캡처해 다시 올려 주세요.')
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result as string)
      r.onerror = () => reject(new Error('사진을 읽지 못했습니다.'))
      r.readAsDataURL(file)
    })
    return { b64: bodyOf(dataUrl), mime: file.type || 'image/jpeg' }
  }
}
