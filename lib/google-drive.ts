import { google } from 'googleapis'
import { Readable } from 'stream'

const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID!

function getOAuth2Client() {
  const clientId     = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN
  if (!clientId || !clientSecret || !refreshToken) {
    // 환경변수 이름을 사용자 토스트에 그대로 띄우지 않는다(knowledge/doc-vocabulary 와 충돌).
    // 진단은 서버 로그로 남긴다.
    console.error('[drive] 인증 설정 누락 — GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN 확인 필요')
    throw new Error('파일 저장소 연결 설정이 완료되지 않았습니다. 관리자에게 문의해 주세요.')
  }
  const auth = new google.auth.OAuth2(clientId, clientSecret)
  auth.setCredentials({ refresh_token: refreshToken })
  return auth
}

function getDriveClient() {
  return google.drive({ version: 'v3', auth: getOAuth2Client() })
}

// 업로드 — **기본은 비공개다.**
//
// 종전에는 여기서 무조건 setDrivePublicReadable 을 불러 올린 파일 전부가 anyone:reader 였다.
// 그래서 계약서·영수증·거주확인서 PDF 56건이 링크만 알면 로그인 없이 열렸다.
// 성명·생년월일·금액·서명 이미지·도장이 무인증·무만료 URL 로 노출된 상태였다(E페이즈 2026-08-03).
// 앱 내부 열람은 /api/doc-file(로그인 + 영업장 소유 + 소프트삭제 검증)로 이미 잠겨 있어 공개가 필요 없다.
//
// publicRead 는 **썸네일을 img 태그로 직접 띄우는 경우에만** 켠다(도장·로고·호실 사진).
// 그건 Drive 썸네일 URL 이 인증을 안 태우기 때문이고, 서류처럼 개인정보가 담긴 파일에는 쓰지 않는다.
export async function uploadToDrive(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  opts?: { publicRead?: boolean },
): Promise<{ fileId: string; thumbnailUrl: string }> {
  const drive = getDriveClient()

  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [FOLDER_ID],
    },
    media: {
      mimeType,
      body: Readable.from(buffer),
    },
    fields: 'id',
  })

  const fileId = res.data.id!
  if (opts?.publicRead) await setDrivePublicReadable(fileId)
  return { fileId, thumbnailUrl: buildDriveThumbnailUrl(fileId, 400) }
}

// 클라이언트 직접 업로드용 — Vercel 페이로드 한도 우회.
// 서버는 Drive에 "이 파일 받을 준비" 요청만 보내고, 발급된 URL을 클라이언트에 전달.
// 클라이언트가 그 URL로 파일을 PUT 업로드 → Vercel 함수는 파일 자체를 만지지 않음.
//
// CORS 주의: 발급된 업로드 URL은 세션 생성 시 보낸 Origin에서만 PUT을 허용함.
// 서버 측 fetch는 Origin을 자동 첨부하지 않으므로 명시적으로 전달해야
// 응답에 Access-Control-Allow-Origin이 포함되고 브라우저 PUT이 통과한다.
export async function createDriveResumableSession(input: {
  fileName: string
  mimeType: string
  fileSize: number
  origin: string
}): Promise<string> {
  const auth = getOAuth2Client()
  const tokenRes = await auth.getAccessToken()
  const accessToken = typeof tokenRes === 'string' ? tokenRes : tokenRes.token
  if (!accessToken) throw new Error('Drive access token 발급 실패')

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'Origin': input.origin,
        'X-Upload-Content-Type': input.mimeType,
        'X-Upload-Content-Length': String(input.fileSize),
      },
      body: JSON.stringify({
        name: input.fileName,
        parents: [FOLDER_ID],
      }),
    },
  )

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Drive 업로드 세션 생성 실패 (${res.status}): ${text}`)
  }
  const uploadUrl = res.headers.get('location')
  if (!uploadUrl) throw new Error('Drive 업로드 URL(Location 헤더) 누락')
  return uploadUrl
}

export async function setDrivePublicReadable(fileId: string): Promise<void> {
  const drive = getDriveClient()
  await drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' },
  })
}

export function buildDriveThumbnailUrl(fileId: string, sizePx: number): string {
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${sizePx}`
}

// 고해상도 직접 URL — lh3.googleusercontent.com 은 리디렉트 없이 `access-control-allow-origin: *` 를
// 보내므로 WebGL(360 파노라마/pannellum) 텍스처 로드에 안전. drive.google.com/thumbnail 은 302 리디렉트라
// crossOrigin 로드가 까다로움. 큰 사진 원본 미리보기·360 뷰어에 사용.
export function buildDriveImageUrl(fileId: string, sizePx = 2048): string {
  return `https://lh3.googleusercontent.com/d/${fileId}=w${sizePx}`
}

export async function deleteFromDrive(fileId: string): Promise<void> {
  const drive = getDriveClient()
  await drive.files.delete({ fileId })
}

// 소프트삭제용 — 영구삭제 대신 Drive 휴지통으로(복구 가능). 적용취소 시 untrashInDrive로 되살림.
export async function trashInDrive(fileId: string): Promise<void> {
  const drive = getDriveClient()
  await drive.files.update({ fileId, requestBody: { trashed: true } })
}

export async function untrashInDrive(fileId: string): Promise<void> {
  const drive = getDriveClient()
  await drive.files.update({ fileId, requestBody: { trashed: false } })
}

// 원본 파일 바이트 다운로드 (alt=media) — 썸네일이 아닌 원본(예: 투명 PNG 도장)을 그대로 받음.
export async function downloadDriveBytes(fileId: string): Promise<Buffer> {
  const drive = getDriveClient()
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' },
  )
  return Buffer.from(res.data as ArrayBuffer)
}

// 파일 크기(바이트) — 메일 첨부 용량을 내려받기 전에 합산하려는 용도(서류 메일 확인 화면).
// 실패는 null 로 답한다 — 크기는 안내용이고, 실제 상한은 발송 직전 다운로드 합산이 다시 지킨다.
export async function driveFileSize(fileId: string): Promise<number | null> {
  try {
    const drive = getDriveClient()
    const res = await drive.files.get({ fileId, fields: 'size' })
    const n = Number(res.data.size)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

// 영수증 사진 열람 주소 — 공개 Drive URL 이 아니라 인증 프록시를 거친다(D페이즈 2026-08-03).
// 저장 형태를 여기 한 곳에서 정한다. 업로드 경로가 둘(지출·대기)이라 각자 만들면 또 갈린다.
export function buildReceiptImageUrl(fileId: string): string {
  return `/api/receipt-image?id=${fileId}`
}

// 이미지 바이트의 매직 넘버로 mime 을 판정한다. Drive 메타 조회를 한 번 더 하지 않으려는 것.
export function sniffImageMime(buf: Buffer): string {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50) return 'image/png'
  if (buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8) return 'image/jpeg'
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (buf.length >= 6 && buf.toString('ascii', 0, 3) === 'GIF') return 'image/gif'
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') return 'image/heic'
  return 'application/octet-stream'
}

// Drive 이미지를 data: URI 로 — 공개 권한 없이 어디서나 쓰기 위한 것 (D페이즈 2026-08-03).
//
// 도장이 이 함수의 이유다. 서류 PDF 는 잠갔는데 그 위에 찍히는 도장 원본은 공개 읽기라
// 아무나 받아 위조 계약서에 얹을 수 있었다. 그런데 도장은 세 군데에서 쓰인다 —
// 로그인 화면, **비로그인 서명 페이지(/sign/[token])**, 그리고 쿠키가 없는 헤드리스 크로미움 PDF 렌더.
// 인증 프록시로는 뒤 둘을 못 덮는다. 바이트를 직접 심으면 셋 다 되고 Drive ID 자체가 HTML 에서 사라진다.
export async function driveImageDataUrl(fileId: string): Promise<string | null> {
  try {
    const buf = await downloadDriveBytes(fileId)
    const mime = sniffImageMime(buf)
    if (!mime.startsWith('image/')) return null
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return null   // 도장을 못 읽어도 서류 발급 자체는 막지 않는다
  }
}

// 이 앱이 올린 파일인지 확인 — 남의 Drive 파일 ID 를 우리 레코드로 편입하는 것을 막는다.
//
// finalizeContractScan·finalizeStamp 계열이 driveFileId 를 무검증으로 받아, 임의 ID 를 자기 영업장
// ContractFile 행으로 만들면 /api/doc-file 의 소유 검증(레코드 기준)을 통과했다(E페이즈 2026-08-03).
// 우리 OAuth 자격으로 조회했을 때 소유자가 우리여야 한다.
export async function isOwnedByApp(fileId: string): Promise<boolean> {
  try {
    const drive = getDriveClient()
    const res = await drive.files.get({ fileId, fields: 'id, ownedByMe, trashed' })
    return res.data.ownedByMe === true && res.data.trashed !== true
  } catch {
    return false
  }
}

// 우리 소유 여부 + Drive 가 판정한 mimeType 을 한 번에 — 이미지·PDF 를 함께 받는 파일용.
// isOwnedByApp 와 같은 files.get 인데 mime 까지 필요한 자리에서 왕복을 두 번 하지 않으려는 것이다.
// null = 우리 소유가 아니거나 휴지통이거나 조회 실패(호출부가 편입을 거절한다).
export async function ownedDriveFileMime(fileId: string): Promise<string | null> {
  try {
    const drive = getDriveClient()
    const res = await drive.files.get({ fileId, fields: 'ownedByMe, trashed, mimeType' })
    if (res.data.ownedByMe !== true || res.data.trashed === true) return null
    return res.data.mimeType ?? null
  } catch {
    return null
  }
}

// 공개 권한 회수 — anyone 권한만 지운다(소유자·공유 권한은 건드리지 않는다).
export async function revokeDrivePublicAccess(fileId: string): Promise<boolean> {
  const drive = getDriveClient()
  const list = await drive.permissions.list({ fileId, fields: 'permissions(id, type, role)' })
  let removed = false
  for (const perm of list.data.permissions ?? []) {
    if (perm.type === 'anyone' && perm.id) {
      await drive.permissions.delete({ fileId, permissionId: perm.id })
      removed = true
    }
  }
  return removed
}
