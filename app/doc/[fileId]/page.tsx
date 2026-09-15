// 보관 서류 뷰어 라우트 — '보기'의 목적지. 셸 밖 단독 라우트다.
//
// 소유 검증을 여기서 한 번 더 한다. iframe 이 부르는 /api/doc-file 이 이미 검증하지만,
// 그것만 믿으면 남의 파일 id 로도 껍데기 화면은 뜬다. 없는 서류처럼 보이는 편이 맞다.
import { notFound } from 'next/navigation'
import { getPropertyAccess } from '@/lib/auth/propertyAccess'
import prisma from '@/lib/prisma'
import { docFileLabel } from '@/lib/docBundle'
import DocViewer from './DocViewer'

/** 네 번째 소유 가지 — 이 영업장 자기 사업자등록증. 그 모델에는 fileName 칸이 없어 여기서 짓는다. */
async function bizCertName(propertyId: string, fileId: string): Promise<{ fileName: string } | null> {
  const p = await prisma.property
    .findFirst({ where: { id: propertyId, bizCertDriveFileId: fileId }, select: { name: true } })
    .catch(() => null)
  return p ? { fileName: `${p.name}_${docFileLabel('bizcert', 'ko')}` } : null
}

export default async function DocPage({
  params,
  searchParams,
}: {
  params: Promise<{ fileId: string }>
  // print=1 — 목록의 [인쇄]가 공유 시트를 못 쓰는 환경에서 넘긴 진입(신고 71753b36).
  searchParams: Promise<{ from?: string; tenantId?: string; print?: string }>
}) {
  const { fileId } = await params
  const { from, tenantId, print } = await searchParams

  const access = await getPropertyAccess()
  if (!access) notFound()
  const propertyId = access.propertyId

  // /api/doc-file 과 같은 네 종류를 본다 — 한쪽만 늘어나면 '보기'가 열리는 서류와 뜨는 서류가 갈린다
  // fileName 은 세 모델이 공통으로 갖는 표시용 이름이다 — 내보내기의 파일명으로 그대로 쓴다.
  // 화면 크롬에 그리지 않으므로 임의 문자열이 끼어들 자리가 없다.
  //
  // 넷째는 그 영업장 자기 사업자등록증이다(2026-09-16, 서류 시트 동봉). 그 모델에는 fileName
  // 칸이 없어 이름을 여기서 짓는다 — 서류 이름은 정본(docFileLabel)에서 가져와 상담 도구·
  // 메일 첨부와 같은 이름이 되게 한다.
  const owned =
    (await prisma.contractFile.findFirst({ where: { driveFileId: fileId, propertyId, deletedAt: null }, select: { fileName: true } })) ||
    (await prisma.rentReceiptFile.findFirst({ where: { driveFileId: fileId, propertyId, deletedAt: null }, select: { fileName: true } }).catch(() => null)) ||
    (await prisma.residenceCertFile.findFirst({ where: { driveFileId: fileId, propertyId, deletedAt: null }, select: { fileName: true } }).catch(() => null)) ||
    (await bizCertName(propertyId, fileId))
  if (!owned) notFound()

  return <DocViewer fileId={fileId} from={from} tenantId={tenantId} autoPrint={print === '1'}
    fileName={owned.fileName.replace(/\.pdf$/i, '')} />
}
