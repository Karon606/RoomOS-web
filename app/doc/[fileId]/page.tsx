// 보관 서류 뷰어 라우트 — '보기'의 목적지. 셸 밖 단독 라우트다.
//
// 소유 검증을 여기서 한 번 더 한다. iframe 이 부르는 /api/doc-file 이 이미 검증하지만,
// 그것만 믿으면 남의 파일 id 로도 껍데기 화면은 뜬다. 없는 서류처럼 보이는 편이 맞다.
import { notFound } from 'next/navigation'
import { getPropertyAccess } from '@/lib/auth/propertyAccess'
import prisma from '@/lib/prisma'
import DocViewer from './DocViewer'

export default async function DocPage({
  params,
  searchParams,
}: {
  params: Promise<{ fileId: string }>
  searchParams: Promise<{ from?: string; tenantId?: string }>
}) {
  const { fileId } = await params
  const { from, tenantId } = await searchParams

  const access = await getPropertyAccess()
  if (!access) notFound()
  const propertyId = access.propertyId

  // /api/doc-file 과 같은 세 종류를 본다 — 한쪽만 늘어나면 '보기'가 열리는 서류와 뜨는 서류가 갈린다
  const owned =
    (await prisma.contractFile.findFirst({ where: { driveFileId: fileId, propertyId, deletedAt: null }, select: { id: true } })) ||
    (await prisma.rentReceiptFile.findFirst({ where: { driveFileId: fileId, propertyId, deletedAt: null }, select: { id: true } }).catch(() => null)) ||
    (await prisma.residenceCertFile.findFirst({ where: { driveFileId: fileId, propertyId, deletedAt: null }, select: { id: true } }).catch(() => null))
  if (!owned) notFound()

  return <DocViewer fileId={fileId} from={from} tenantId={tenantId} />
}
