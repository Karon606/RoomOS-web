// 영수증 사진의 공개 Drive URL 을 인증 프록시 주소로 이관하고 공개 권한을 걷는다 (D페이즈 2026-08-03).
//
// 왜
//   Expense.receiptUrl / receiptUrls 와 PendingReceipt.imageUrl 에 `drive.google.com/thumbnail?id=...`
//   공개 URL 이 그대로 저장돼 있고 화면 <img> 가 그걸 직접 물었다. 링크만 알면 로그인 없이
//   카드 전표·거래처 상호·사업자 정보가 담긴 사진이 무만료로 열린다. 서류 PDF 56건과 같은 클래스다.
//   생성 경로는 코드로 막았다(finance/actions · dashboard/pendingReceipt). 여기는 이미 쌓인 것을 옮긴다.
//
// 순서가 중요하다 — **주소를 먼저 옮기고 그다음 권한을 걷는다.** 반대로 하면 그 사이 화면이 깨진다.
//
// 되돌리기(--revert)는 주소만 공개 URL 로 되돌린다. 권한은 다시 붙이지 않는다 —
// 공개로 되돌리는 것이 애초의 결함이라 자동화할 이유가 없다.
//
// 실행:   npx tsx --env-file=.env.local scripts/migrate-receipt-image-urls.ts [--apply]
// 되돌리기: --revert --apply
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { revokeDrivePublicAccess, buildReceiptImageUrl, buildDriveThumbnailUrl } from '@/lib/google-drive'

const apply = process.argv.includes('--apply')
const revert = process.argv.includes('--revert')

const DRIVE_RE = /https:\/\/drive\.google\.com\/thumbnail\?id=([\w-]+)(?:&sz=w\d+)?/g
const PROXY_RE = /\/api\/receipt-image\?id=([\w-]+)/g

// 문자열 안의 주소를 바꾸고, 건드린 파일 ID 를 모은다.
// receiptUrls 는 여러 URL 이 한 문자열에 들어 있을 수 있어 전역 치환한다.
function convert(text: string, ids: Set<string>): string {
  if (revert) {
    return text.replace(PROXY_RE, (_m, id: string) => { ids.add(id); return buildDriveThumbnailUrl(id, 400) })
  }
  return text.replace(DRIVE_RE, (_m, id: string) => { ids.add(id); return buildReceiptImageUrl(id) })
}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const ids = new Set<string>()

  const expenses = await prisma.expense.findMany({ select: { id: true, receiptUrl: true, receiptUrls: true } })
  const expEdits: { id: string; receiptUrl?: string | null; receiptUrls?: string | null }[] = []
  for (const e of expenses) {
    const url = e.receiptUrl ? convert(e.receiptUrl, ids) : e.receiptUrl
    const urls = e.receiptUrls ? convert(e.receiptUrls, ids) : e.receiptUrls
    if (url !== e.receiptUrl || urls !== e.receiptUrls) expEdits.push({ id: e.id, receiptUrl: url, receiptUrls: urls })
  }

  const pendings = await prisma.pendingReceipt.findMany({ select: { id: true, imageUrl: true } })
  const penEdits: { id: string; imageUrl: string }[] = []
  for (const p of pendings) {
    const next = convert(p.imageUrl, ids)
    if (next !== p.imageUrl) penEdits.push({ id: p.id, imageUrl: next })
  }

  console.log(`지출 ${expEdits.length}건 · 대기 영수증 ${penEdits.length}건 · 파일 ${ids.size}개`)
  console.log(revert ? '  방향: 프록시 주소 -> 공개 Drive URL (권한은 다시 안 붙인다)' : '  방향: 공개 Drive URL -> 인증 프록시 주소')
  if (expEdits.length === 0 && penEdits.length === 0) { console.log('바꿀 것이 없습니다.'); await prisma.$disconnect(); return }
  if (!apply) { console.log('\n실제 반영: --apply · 되돌리기: --revert --apply'); await prisma.$disconnect(); return }

  // 1) 주소를 먼저 옮긴다
  for (const e of expEdits) {
    await prisma.expense.update({ where: { id: e.id }, data: { receiptUrl: e.receiptUrl, receiptUrls: e.receiptUrls } })
  }
  for (const p of penEdits) {
    await prisma.pendingReceipt.update({ where: { id: p.id }, data: { imageUrl: p.imageUrl } })
  }
  console.log(`\n주소 이관 완료 (지출 ${expEdits.length} · 대기 ${penEdits.length})`)

  // 2) 그다음 공개 권한을 걷는다
  if (revert) { console.log('되돌리기라 권한은 건드리지 않습니다.'); await prisma.$disconnect(); return }
  let removed = 0, failed = 0
  for (const id of ids) {
    try { if (await revokeDrivePublicAccess(id)) removed++ } catch { failed++ }
  }
  console.log(`공개 권한 회수 ${removed}건 · 실패 ${failed}건 · 원래 비공개 ${ids.size - removed - failed}건`)
  await prisma.$disconnect()
}

void main()
