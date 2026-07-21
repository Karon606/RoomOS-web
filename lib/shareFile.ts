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

// 다중 파일을 공유 시트로 한 번에 전송(서류 여러 건 보내기).
// 단건과 달리 다운로드 폴백이 없다 — 여러 File 을 연속 a.click() 하면 브라우저가 두 번째부터 차단한다.
// 그래서 미지원이면 'unsupported'(호출부가 진입 자체를 숨김), 제스처 만료(NotAllowedError)는 'retry'
// (캐시가 이미 준비돼 있어 두 번째 탭은 즉시 성공), 사용자가 취소하면 'cancelled'(무반응 처리).
export async function shareFiles(
  files: File[],
): Promise<'shared' | 'cancelled' | 'retry' | 'unsupported'> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (!nav.canShare?.({ files }) || typeof nav.share !== 'function') return 'unsupported'
  try {
    await nav.share({ files })
    return 'shared'
  } catch (e) {
    const err = e as Error
    if (err?.name === 'AbortError') return 'cancelled'
    if (err?.name === 'NotAllowedError') return 'retry'
    throw e
  }
}

// 이 기기가 파일 공유(navigator.share files)를 지원하는지 — 인앱 브라우저·데스크톱 판정용.
// 미지원이면 다중 '보내기'는 폴백이 없으므로 호출부가 진입점을 숨긴다.
export function canShareFiles(): boolean {
  try {
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
    if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false
    const probe = new File(['x'], 'probe.png', { type: 'image/png' })
    return nav.canShare({ files: [probe] })
  } catch { return false }
}
