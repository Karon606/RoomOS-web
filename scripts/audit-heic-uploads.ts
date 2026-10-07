// 이미 저장된 HEIC 업로드가 몇 건인지 세는 **읽기 전용** 예행 — 아무것도 고치지 않는다.
// 실행: npx tsx --env-file=.env.local scripts/audit-heic-uploads.ts
//
// 왜 세기만 하는가(2026-09-16). 정규화는 브라우저에서 돈다 — 서버에는 HEIC 를 디코드할 수단이
// 없다(sharp 의 libheif 가 AVIF 만 문다, 실측). 그래서 이미 저장된 HEIC 는 **코드로 못 고친다.**
// 고치는 길은 그 영업장에 재업로드를 요청하는 것뿐이고, 그러려면 먼저 몇 곳인지 알아야 한다.
//
// 사업자등록증·통장사본은 저장된 mime(Property.bizCertMimeType·bankBookKo/EnMimeType)으로 세고,
// 도장·로고는 그 칸이 없어 Drive 메타(files.get)로 묻는다. 둘 다 조회일 뿐 쓰기는 없다.

import prisma from '../lib/prisma'
import { ownedDriveFileMime } from '../lib/google-drive'

const isHeic = (m: string | null | undefined) =>
  !!m && (m.toLowerCase().includes('heic') || m.toLowerCase().includes('heif'))

async function main() {
  const props = await prisma.property.findMany({
    select: {
      id: true, name: true,
      bizCertDriveFileId: true, bizCertMimeType: true,
      bankBookKoDriveFileId: true, bankBookKoMimeType: true,
      bankBookEnDriveFileId: true, bankBookEnMimeType: true,
      stampDriveFileId: true, logoDriveFileId: true, appLogoDriveFileId: true,
    },
    orderBy: { name: 'asc' },
  })

  const hits: string[] = []
  let certChecked = 0, imgChecked = 0

  for (const p of props) {
    for (const [label, fileId, mime] of [
      ['사업자등록증', p.bizCertDriveFileId, p.bizCertMimeType],
      ['국문 통장사본', p.bankBookKoDriveFileId, p.bankBookKoMimeType],
      ['영문 통장사본', p.bankBookEnDriveFileId, p.bankBookEnMimeType],
    ] as const) {
      if (!fileId) continue
      certChecked++
      if (isHeic(mime)) hits.push(`${p.name} · ${label} (${mime})`)
    }
    for (const [label, fileId] of [
      ['도장', p.stampDriveFileId],
      ['계약서용 로고', p.logoDriveFileId],
      ['영업장 로고', p.appLogoDriveFileId],
    ] as const) {
      if (!fileId) continue
      imgChecked++
      const mime = await ownedDriveFileMime(fileId)
      if (isHeic(mime)) hits.push(`${p.name} · ${label} (${mime})`)
    }
  }

  console.log(`영업장 ${props.length}곳 / 등록증·통장사본 ${certChecked}건 · 도장·로고 ${imgChecked}건 확인`)
  console.log(`HEIC·HEIF 로 저장된 파일: ${hits.length}건`)
  for (const h of hits) console.log(`  - ${h}`)
  if (hits.length > 0) {
    console.log('\n서버에서 변환할 수단이 없다 — 해당 영업장에 재업로드를 요청해야 한다([[open-issues]]).')
  }
}

void main()
  .catch(err => { console.error(err); process.exit(1) })
  .finally(() => prisma.$disconnect())
