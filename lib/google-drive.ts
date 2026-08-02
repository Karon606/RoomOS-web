import { google } from 'googleapis'
import { Readable } from 'stream'

const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID!

function getOAuth2Client() {
  const clientId     = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN 환경 변수가 필요합니다.')
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
