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
  // 반드시 사본을 넘긴다. pdf.js 는 받은 버퍼를 워커로 이관(transfer)해 호출자 원본이 0바이트로
  // 비워진다(detached). SendDocButton 이 같은 바이트를 PDF 파일로도 쓰므로 원본이 비면
  // 0KB PDF 가 조용히 만들어진다(신고 5c99b5c8 실측 — 에어드랍까지 0바이트).
  const task = pdfjs.getDocument({ data: new Uint8Array(pdfBytes.slice(0)) })
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

// 전 페이지를 각각 PNG 로 — 다페이지 서류(계약서)용. 위 1페이지 함수는 시그니처·동작 그대로 남긴다
// (docShareQueue 의 다건 전송 경로가 그걸 쓰고 있어 손대면 영수증 일괄 보내기까지 흔들린다).
//
// 왜 페이지마다 한 장인가: 세로로 이어붙이면 문자 앱 썸네일에서 극단적으로 축소돼 미리보기로는
// 아무것도 못 읽고, 장수가 늘면 iOS 캔버스 면적 한계(2^24 px²)에 닿아 예외 없이 빈 이미지가
// 조용히 만들어진다. 계약서 페이지 수는 조항 분량·임의처분 동의서 on/off·축소맞춤 결과로
// 서버가 정하므로(app/api/contract/generate) 상한에 기대는 설계는 쓸 수 없다.
//
// 메모리: 페이지를 하나씩 그리고 캔버스를 바로 버리므로 피크는 페이지 수와 무관하게 일정하다.
export async function pdfToPngBlobs(pdfBytes: ArrayBuffer, scale = 2.5): Promise<Blob[]> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  // 사본 전달 — 위 pdfToPngBlob 과 같은 이유(pdf.js 의 버퍼 이관이 원본을 비운다).
  const task = pdfjs.getDocument({ data: new Uint8Array(pdfBytes.slice(0)) })
  const doc = await task.promise
  try {
    const blobs: Blob[] = []
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('이미지 캔버스를 만들 수 없습니다.')
      await page.render({ canvas, canvasContext: ctx, viewport }).promise
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('이미지 변환에 실패했습니다.')
      blobs.push(blob)
      canvas.width = 0   // 다음 페이지 전에 픽셀 버퍼 해제
      canvas.height = 0
    }
    if (blobs.length === 0) throw new Error('페이지를 찾을 수 없습니다.')
    return blobs
  } finally {
    void task.destroy()
  }
}
