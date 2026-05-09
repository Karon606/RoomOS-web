// Drive resumable upload — XHR로 진행률 추적 + Drive에 직접 PUT.
// 서버 액션이 createDriveResumableSession()으로 만들어둔 uploadUrl에 클라이언트가
// 바로 PUT 한다 (Vercel function 페이로드 한도 우회).

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
    xhr.ontimeout = () => settle(() => reject(new Error(`업로드 타임아웃 — ${dump()}`)))

    xhr.send(file)
  })
}
