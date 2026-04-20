import { google } from 'googleapis'
import { Readable } from 'stream'

const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID!

function getDriveClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON 환경 변수가 설정되지 않았습니다.')
  const credentials = JSON.parse(raw)
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
  })
  return google.drive({ version: 'v3', auth })
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

  // 링크 있는 사람 누구나 열람 가능하도록 설정
  await drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' },
  })

  const thumbnailUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=w400`
  return { fileId, thumbnailUrl }
}

export async function deleteFromDrive(fileId: string): Promise<void> {
  const drive = getDriveClient()
  await drive.files.delete({ fileId })
}
