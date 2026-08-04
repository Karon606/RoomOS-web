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

// iOS 는 다운로드가 '파일' 앱으로만 간다 — **JPG·PNG 라도 사진첩에 안 들어간다.**
// 사진첩으로 가는 유일한 길이 공유 시트의 [이미지 저장]이다. 안드로이드는 다운로드가
// Download 폴더로 가고 갤러리가 그 폴더를 훑으므로 그냥 받으면 된다.
//
// 이건 기능 탐지로 알 수 있는 API 가 없다. 스크롤·뷰포트를 UA 로 가르지 않는 원칙은 그대로고,
// 여기는 '이 OS 에 그 저장 경로가 아예 없다'는 능력 차이라 탐지 대상 자체가 다르다.
// 틀려도 손해가 작다 — 오탐이면 시트가 한 번 더 열릴 뿐 저장은 된다.
export function photoSaveNeedsShareSheet(): boolean {
  try {
    const nav = navigator as Navigator & { maxTouchPoints?: number }
    if (/iP(hone|ad|od)/.test(navigator.userAgent)) return true
    // 아이패드는 iPadOS 13 부터 데스크톱 사파리로 위장한다 — 터치 개수로 가린다
    return /Macintosh/.test(navigator.userAgent) && (nav.maxTouchPoints ?? 0) > 1
  } catch { return false }
}
