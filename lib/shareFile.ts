// 파일 전달 정본(클라이언트 전용) — 서류 '보내기'는 공유 시트 우선, 안 되면 다운로드 폴백.
// '기기에 저장'은 intent: 'save' 로 공유를 건너뛰고 바로 다운로드한다.
// 공유 시트는 사용자 탭 직후(transient activation)에만 열 수 있어, 탭 뒤 비동기 작업(다운로드·변환)이
// 길어지면 NotAllowedError 로 거부된다 — 갤럭시 사진 저장 첫 탭 실패의 원인(운영자 보고 2026-07-21).
// 그 경우 에러로 끝내지 않고 다운로드로 폴백한다(안드로이드는 Download 폴더가 갤러리·내 파일에 노출됨).
//
// intent — 'share' 는 종전대로 공유 시트 우선, 'save' 는 공유를 아예 시도하지 않고 바로 다운로드한다.
// '기기에 저장'인데 공유 시트가 뜨는 것을 막는다(신고 5c99b5c8). 안드로이드는 a[download] 가 확실하다.
//
// 공유 payload 에 files 와 title/text 를 섞지 않는다 — 메시지 등 일부 타깃이 텍스트만 받고 파일을
// 떨어뜨려 '파일 이름만 전송'되는 함정이 있다. 파일명은 File 객체의 name 으로 이미 전달된다.
export async function shareOrDownloadFile(
  blob: Blob, name: string, mime: string, intent: 'share' | 'save' = 'share',
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], name, { type: mime })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (intent === 'share' && nav.canShare?.({ files: [file] }) && typeof nav.share === 'function') {
    try {
      await nav.share({ files: [file] })
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
  /**
   * (미사용) 함께 넘기려 했던 본문 — 2026-08-26 실기에서 카카오톡 공유가 실패해 되돌렸다.
   * 인자를 남긴 것은 호출부를 되돌리지 않기 위해서이고, 값은 쓰이지 않는다.
   * 문자·메신저에 문구를 채우려면 첨부와 별개의 경로(sms: 프리필)를 써야 한다.
   */
  text?: string,
): Promise<'shared' | 'cancelled' | 'retry' | 'unsupported'> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (!nav.canShare?.({ files }) || typeof nav.share !== 'function') return 'unsupported'
  // **본문은 넘기지 않는다(2026-08-26 실기 실패로 되돌림).** canShare 가 { files, text } 를
  // 받아들여도 카카오톡에서 실제 공유가 실패했다. 인자는 호출부 호환을 위해 남기되 무시한다 —
  // 서류가 나가는 것이 본문보다 중요하고, 실패하는 실험을 켜 둘 이유가 없다.
  void text
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

/**
 * 여러 파일을 이 기기에 저장한다 — '보내기'(상대에게)와 목적이 다른 별개의 문이다.
 *
 * 운영자 판정(2026-08-01, knowledge/doc-vocabulary): "보내기는 목적지가 상대방, 사진 저장은
 * 목적지가 내 사진함. 목적이 달라." 그 원칙을 다건에도 적용한 것이 이 함수다.
 *
 * **아이폰만 공유 시트를 거친다.** iOS 는 다운로드가 '파일' 앱으로만 가서 사진첩에 넣는 길이
 * 시트의 [이미지 저장]뿐이다(위 photoSaveNeedsShareSheet 주석의 실측). 그래서 저장 전용으로
 * 만들어도 아이폰에서는 창이 뜬다 — 호출부가 그 사실을 **누르기 전에** 말해야 한다.
 *
 * 안드로이드·PC 는 순차 다운로드다. 연속 a[download] 는 두 번째부터 막는 브라우저가 있어
 * 300ms 를 띄운다(SendDocButton 의 fallbackDownloadAll 과 같은 처방).
 * 다운로드는 성패를 돌려주지 않으므로(a.click 은 결과가 없다) 성공을 지어내지 않는다.
 */
export async function saveFiles(
  files: File[],
): Promise<'saved-via-sheet' | 'downloaded' | 'cancelled' | 'retry' | 'unsupported'> {
  if (files.length === 0) return 'unsupported'
  if (photoSaveNeedsShareSheet() && canShareFiles()) {
    const r = await shareFiles(files)
    if (r === 'shared') return 'saved-via-sheet'
    if (r === 'cancelled') return 'cancelled'
    if (r === 'retry') return 'retry'
    // unsupported 면 아래 다운로드로 떨어진다 — 파일 앱에라도 남는 것이 아무것도 안 되는 것보다 낫다.
  }
  for (let i = 0; i < files.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 300))
    await shareOrDownloadFile(files[i], files[i].name, files[i].type, 'save')
  }
  return 'downloaded'
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
