// 납부 확인서 흐름 하네스 전용 lib/google-drive 대역 — 올린 파일을 메모리에 두고 휴지통 표시만 한다.
// scripts/tsconfig.rent-receipt-flow.json 이 '@/lib/google-drive' 를 이 파일로 가리킨다. 앱 코드는 절대 이 파일을 import 하지 않는다.
// 하네스는 globalThis.__RR_DRIVE 로 올린 파일·휴지통 상태를 읽고, __RR_DRIVE_FAIL_AT 으로 N 번째 업로드를 실패시킨다.
type DriveFile = { id: string; name: string; bytes: number; trashed: boolean }
const g = globalThis as unknown as { __RR_DRIVE?: Map<string, DriveFile>; __RR_DRIVE_FAIL_AT?: number; __RR_DRIVE_N?: number }
const files = (g.__RR_DRIVE ??= new Map())

export async function uploadToDrive(buf: Buffer, name: string): Promise<{ fileId: string }> {
  g.__RR_DRIVE_N = (g.__RR_DRIVE_N ?? 0) + 1
  if (g.__RR_DRIVE_FAIL_AT && g.__RR_DRIVE_N === g.__RR_DRIVE_FAIL_AT) throw new Error('하네스 업로드 실패')
  const id = `drive-${g.__RR_DRIVE_N}-${Math.random().toString(36).slice(2, 8)}`
  files.set(id, { id, name, bytes: buf.length, trashed: false })
  return { fileId: id }
}
export async function trashInDrive(id: string): Promise<void> { const f = files.get(id); if (f) f.trashed = true }
export async function untrashInDrive(id: string): Promise<void> { const f = files.get(id); if (f) f.trashed = false }
export async function downloadDriveBytes(): Promise<Buffer> { throw new Error('하네스: 도장·로고 없음') }
