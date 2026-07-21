// 파일 전달 정본(클라이언트 전용) — 공유 시트 우선, 안 되면 다운로드 폴백. 서류 버튼 전체가 공유.
// 공유 시트는 사용자 탭 직후(transient activation)에만 열 수 있어, 탭 뒤 비동기 작업(다운로드·변환)이
// 길어지면 NotAllowedError 로 거부된다 — 갤럭시 사진 저장 첫 탭 실패의 원인(운영자 보고 2026-07-21).
// 그 경우 에러로 끝내지 않고 다운로드로 폴백한다(안드로이드는 Download 폴더가 갤러리·내 파일에 노출됨).
export async function shareOrDownloadFile(
  blob: Blob, name: string, mime: string,
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], name, { type: mime })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (nav.canShare?.({ files: [file] }) && typeof nav.share === 'function') {
    try {
      await nav.share({ files: [file], title: name })
      return 'shared'
    } catch (e) {
      const err = e as Error
      if (err?.name === 'AbortError') return 'cancelled'   // 사용자가 취소
      if (err?.name !== 'NotAllowedError') throw e
      // NotAllowedError = 제스처 만료 — 아래 다운로드 폴백으로 계속
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  URL.revokeObjectURL(url)
  return 'downloaded'
}
