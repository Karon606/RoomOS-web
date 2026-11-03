// Drive resumable upload — XHR로 진행률 추적 + Drive에 직접 PUT.
// 서버 액션이 createDriveResumableSession()으로 만들어둔 uploadUrl에 클라이언트가
// 바로 PUT 한다 (Vercel function 페이로드 한도 우회).

/**
 * PUT 한 번의 상한(ms). 망이 멈춘 채 응답이 없으면 XHR 은 끝나지 않아 '올리는 중' 이 영원히 돈다(2026-11-03 독립 검수).
 * 바닥은 60초이고 큰 파일은 100KB 마다 1초씩 늘린다(초당 100KB, 아주 느린 망에서도 끝까지 가는 선). 줄인 신고 사진(0.5MB 안팎)은
 * 60초, 스캔 계약서 상한 25MB 는 263초다. 넘으면 'timeout' 으로 실패하고 부르는 쪽이 다시 시도하거나 알린다.
 */
export const DRIVE_PUT_TIMEOUT_MS = 60_000
export function drivePutTimeoutMs(size: number): number {
  return Math.max(DRIVE_PUT_TIMEOUT_MS, Math.ceil(size / 100_000) * 1000)
}

export function uploadFileToDriveSession(
  uploadUrl: string,
  file: File,
  onProgress: (percent: number) => void = () => {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let settled = false
    const settle = (fn: () => void) => { if (!settled) { settled = true; fn() } }

    xhr.open('PUT', uploadUrl, true)
    xhr.responseType = 'text'
    const timeoutMs = drivePutTimeoutMs(file.size)
    xhr.timeout = timeoutMs
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')

    xhr.upload.onprogress = e => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }

    const dump = () => `status=${xhr.status} statusText=${xhr.statusText || '(빈)'} readyState=${xhr.readyState} body=${(xhr.responseText || '').slice(0, 400) || '(빈)'}`

    xhr.onload = () => settle(() => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const body = JSON.parse(xhr.responseText) as { id?: string }
          if (!body.id) return reject(new Error(`Drive 응답에 파일 ID 없음 — ${dump()}`))
          resolve(body.id)
        } catch (err) {
          reject(new Error(`Drive 응답 파싱 실패 — ${(err as Error).message} | ${dump()}`))
        }
      } else if (xhr.status === 0) {
        reject(new Error(`Drive 응답 차단 (CORS 의심) — ${dump()}`))
      } else {
        reject(new Error(`Drive 업로드 거절 — ${dump()}`))
      }
    })

    xhr.onerror = () => settle(() => reject(new Error(`네트워크/CORS 오류 — ${dump()}`)))
    xhr.upload.onerror = () => settle(() => reject(new Error(`업로드 전송 중 오류 — ${dump()}`)))
    xhr.onabort = () => settle(() => reject(new Error(`업로드 중단 — ${dump()}`)))
    xhr.ontimeout = () => settle(() => reject(new Error(`업로드 timeout(${timeoutMs / 1000}초) · ${dump()}`)))

    xhr.send(file)
  })
}
