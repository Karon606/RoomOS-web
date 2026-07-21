// PDF 바이트를 PNG Blob 으로 래스터화(1페이지) — 서류 '사진 저장'용(오류신고 dc56f953). 클라이언트 전용.
// 발급 PDF 를 그대로 그리므로 폰트·도장·양식이 발급본과 픽셀 동일. pdfjs-dist 는 호출 시점 dynamic import.

// 선로딩 — 버튼이 보일 때 미리 불러 첫 탭의 변환 지연(약 1MB 로딩)을 없앤다.
// 첫 탭이 느리면 공유 시트의 제스처 허용 시간이 만료돼 실패하던 문제(갤럭시, lib/shareFile.ts 참조) 방어.
export function prewarmPdfToPng(): void {
  void import('pdfjs-dist').catch(() => { /* 선로딩 실패는 무해 — 클릭 시 재시도 */ })
}

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
