// 발급 서류 표시값 오버라이드가 썩었는지 검사 — 읽기 전용, 위반 시 exit 1 (2026-08-09).
//
// 표시값 오버라이드는 '자동값과 다른 값'만 담는다는 약속 위에 서 있다. 자동값과 같아진 키가
// 남으면 그 순간 약속이 깨진다 — 나중에 임대료가 바뀌어도 그 칸만 옛 값에 붙박여, 운영자는
// 자동값이 따라온 줄 알고 그대로 관청에 낸다. 저장 경로(normalizeResidenceCertOverrides)가
// 그 키를 지우게 돼 있으니, 이 스크립트는 **그 방어가 뚫린 흔적**을 찾는다.
//
// 계약서 쪽(scripts/check-contract-override-lock.ts)의 형제다. 그쪽은 '서명본과 다른가'를 보고
// 이쪽은 '자동값과 같은가'를 본다 — 서류에는 서명이 없어 잠글 대상이 다르다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import {
  DOC_TYPES, RESIDENCE_CERT_KEYS, RESIDENCE_CERT_FIELD_LABEL,
  deriveResidenceCertFields, parseResidenceCertOverrides,
} from '../lib/documentFieldOverrides'

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const violations: string[] = []

  const rows = await prisma.documentFieldOverride.findMany({
    select: {
      id: true, docType: true, fields: true, propertyId: true, leaseTermId: true,
      leaseTerm: {
        select: {
          propertyId: true, moveInDate: true, expectedMoveOut: true,
          rentAmount: true, depositAmount: true,
          room: { select: { roomNo: true } },
          property: { select: { address: true } },
          tenant: { select: { name: true } },
        },
      },
    },
  })

  for (const row of rows) {
    const who = row.leaseTerm?.tenant?.name ?? '?'

    // 알 수 없는 서류 종류 — 화이트리스트가 없어 아무도 그 값을 검증하지 못한다.
    if (!(DOC_TYPES as readonly string[]).includes(row.docType)) {
      violations.push(`${who} 의 표시값 행이 알 수 없는 서류 종류다(${row.docType}) — 검증할 화이트리스트가 없다`)
      continue
    }

    // 영업장 격리 — 행의 propertyId 가 계약의 영업장과 다르면 다른 영업장 화면에 값이 샌다.
    if (row.leaseTerm && row.propertyId !== row.leaseTerm.propertyId) {
      violations.push(`${who} 의 표시값 행이 계약과 다른 영업장에 달려 있다 — 영업장 격리가 깨졌다`)
    }

    const raw = (row.fields && typeof row.fields === 'object' && !Array.isArray(row.fields))
      ? row.fields as Record<string, unknown>
      : null
    if (!raw) {
      violations.push(`${who} 의 표시값 행이 객체가 아니다 — 파싱하면 통째로 버려진다`)
      continue
    }

    const parsed = parseResidenceCertOverrides(raw) as Record<string, unknown>
    const parsedKeys = Object.keys(parsed)

    // 빈 행 — 저장 경로는 남은 키가 없으면 행을 지운다. 남아 있으면 '수정한 값이 있다'로 잘못 읽힌다.
    if (!parsedKeys.length) {
      violations.push(`${who} 의 표시값 행에 남은 키가 없다 — 빈 행은 지워져야 한다`)
      continue
    }

    // 화이트리스트 밖 키 / 검증에 걸려 버려지는 키.
    for (const key of Object.keys(raw)) {
      if (!(RESIDENCE_CERT_KEYS as readonly string[]).includes(key)) {
        violations.push(`${who} 의 표시값에 화이트리스트 밖 키가 있다(${key}) — 화면에도 종이에도 안 나가는 죽은 값이다`)
      } else if (parsed[key] === undefined) {
        violations.push(`${who} 의 표시값 ${RESIDENCE_CERT_FIELD_LABEL[key as keyof typeof RESIDENCE_CERT_FIELD_LABEL]} 이 검증을 통과하지 못한다 — 저장은 됐는데 발급에는 안 쓰인다`)
      }
    }

    if (!row.leaseTerm) continue
    const auto = deriveResidenceCertFields({
      propertyAddress: row.leaseTerm.property?.address,
      roomNo: row.leaseTerm.room?.roomNo,
      moveInDate: row.leaseTerm.moveInDate,
      expectedMoveOut: row.leaseTerm.expectedMoveOut,
      rentAmount: row.leaseTerm.rentAmount,
      depositAmount: row.leaseTerm.depositAmount,
    }) as unknown as Record<string, unknown>

    // 본 검사 — 자동값과 같은 오버라이드.
    for (const key of RESIDENCE_CERT_KEYS) {
      if (parsed[key] !== undefined && parsed[key] === auto[key]) {
        violations.push(`${who} 의 표시값 ${RESIDENCE_CERT_FIELD_LABEL[key]} 이 자동값과 같다 — 지워야 할 오버라이드가 남았다`)
      }
    }
  }

  await prisma.$disconnect()

  console.log(`[서류 표시값] 오버라이드 ${rows.length}건 대조 / 위반 ${violations.length}건`)
  if (violations.length) {
    console.error(`\n[서류 표시값] 위반 ${violations.length}건`)
    for (const v of violations) console.error('  - ' + v)
    console.error('\n  오버라이드는 자동값과 **다른** 값만 담는다. 같아진 키는 저장 경로가 지워야 한다.')
    process.exit(1)
  }
}

main()
