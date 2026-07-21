// PDF 바이트를 PNG Blob 으로 래스터화(1페이지) — 서류 '사진 저장'용(오류신고 dc56f953). 클라이언트 전용.
// 발급 PDF 를 그대로 그리므로 폰트·도장·양식이 발급본과 픽셀 동일. pdfjs-dist 는 호출 시점 dynamic import.
export async function pdfToPngBlob(pdfBytes: ArrayBuffer, scale = 2.5): Promise<Blob> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  const task = pdfjs.getDocument({ data: pdfBytes })
  const doc = await task.promise
  try {
    const page = await doc.getPage(1)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('이미지 캔버스를 만들 수 없습니다.')
    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('이미지 변환에 실패했습니다.')
    return blob
  } finally {
    void task.destroy()
  }
}
