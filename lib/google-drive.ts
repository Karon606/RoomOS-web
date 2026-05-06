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

export async function uploadToDrive(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
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
  await setDrivePublicReadable(fileId)
  return { fileId, thumbnailUrl: buildDriveThumbnailUrl(fileId, 400) }
}

// 클라이언트 직접 업로드용 — Vercel 페이로드 한도 우회.
// 서버는 Drive에 "이 파일 받을 준비" 요청만 보내고, 발급된 URL을 클라이언트에 전달.
// 클라이언트가 그 URL로 파일을 PUT 업로드 → Vercel 함수는 파일 자체를 만지지 않음.
export async function createDriveResumableSession(input: {
  fileName: string
  mimeType: string
  fileSize: number
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

export async function deleteFromDrive(fileId: string): Promise<void> {
  const drive = getDriveClient()
  await drive.files.delete({ fileId })
}
