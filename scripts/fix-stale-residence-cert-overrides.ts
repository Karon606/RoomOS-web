// 실거주 확인서 표시값 오버라이드 중 **자동값과 같아진 키**를 걷는 일회성 정리(백필).
//
// 왜 필요한가. 오버라이드는 자동값과 **다른** 값만 담는 칸이고, 저장 경로는 이미 같아진 키를
// 지운다(lib/documentFieldOverrides normalizeResidenceCertOverrides 의 마지막 루프). 그런데
// 그 규칙이 생기기 전에 저장된 행과, 나중에 자동값 쪽이 바뀌어 뒤늦게 같아진 행이 남아 있다.
//   - 8월분 siteAddress 셋 — 영업장 주소를 그대로 타이핑해 처음부터 자동값과 같았다.
//   - 9월분 tenantAddress 둘 — 주소 끝 층 표기를 손으로 지워 두었는데, 2026-09-07 에 조립
//     정본(tenantResidenceAddress)이 층 꼬리를 걷게 되면서 자동값이 그 값과 같아졌다.
// 남아 있어도 나오는 종이는 같다(값이 같으니까). 다만 검사(check-document-override-lock)가
// 붉게 남아 verify:db 가 거기서 멈추고, 무엇보다 '손으로 고친 값이 있다'는 거짓 신호가 된다.
//
// 판정은 **저장 경로와 같은 정본 함수**를 그대로 부른다. 빈 패치로 다시 정규화하면 같아진 키만
// 떨어진다 — 규칙을 여기 베끼면 그것이 또 어긋난다(2026-09-07 할인 사본 사고와 같은 클래스).
//
// 실행: npx tsx --env-file=.env.local scripts/fix-stale-residence-cert-overrides.ts        (예행)
//       npx tsx --env-file=.env.local scripts/fix-stale-residence-cert-overrides.ts --apply (적용)
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { deriveResidenceCertFields, normalizeResidenceCertOverrides } from '../lib/documentFieldOverrides'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL }) })
const apply = process.argv.includes('--apply')

async function main() {
  const rows = await prisma.documentFieldOverride.findMany({
    where: { docType: 'RESIDENCE_CERT' },
    select: {
      id: true, leaseTermId: true, fields: true,
      leaseTerm: {
        select: {
          moveInDate: true, expectedMoveOut: true, rentAmount: true, depositAmount: true,
          room: { select: { roomNo: true } },
          property: { select: { address: true } },
          tenant: { select: { name: true } },
        },
      },
    },
  })

  let changed = 0
  for (const r of rows) {
    const l = r.leaseTerm
    if (!l) continue
    const auto = deriveResidenceCertFields({
      propertyAddress: l.property?.address,
      roomNo: l.room?.roomNo,
      moveInDate: l.moveInDate,
      expectedMoveOut: l.expectedMoveOut,
      rentAmount: l.rentAmount,
      depositAmount: l.depositAmount,
    })
    // 빈 패치 = "고치지 말고 다시 정규화만 하라". 같아진 키만 떨어진다.
    const { value } = normalizeResidenceCertOverrides(r.fields, {}, auto)
    const before = JSON.stringify(r.fields)
    const after = value === null ? null : JSON.stringify(value)
    if (before === after) continue
    changed++
    const dropped = Object.keys((r.fields ?? {}) as Record<string, unknown>)
      .filter(k => !value || !(k in (value as Record<string, unknown>)))
    console.log(`${l.tenant?.name ?? '?'} — 걷는 키: ${dropped.join(', ')}${value === null ? ' (행 삭제)' : ''}`)
    if (!apply) continue
    if (value === null) {
      await prisma.documentFieldOverride.delete({ where: { id: r.id } })
    } else {
      await prisma.documentFieldOverride.update({ where: { id: r.id }, data: { fields: value as object } })
    }
  }

  console.log(`\n오버라이드 ${rows.length}건 검사 / 정리 대상 ${changed}건${apply ? ' — 적용함' : ' (예행, --apply 로 적용)'}`)
  await prisma.$disconnect()
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
