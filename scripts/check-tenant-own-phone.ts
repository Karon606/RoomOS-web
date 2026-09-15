// 본인 전화번호 실태 — 예약 확정 게이트와 문자 대체가 실제로 누구에게 닿는지 센다. 읽기 전용.
//
// 왜 .mjs 가 아닌가. 판정("이 사람에게 본인 번호가 있는가")을 손으로 다시 적으면 그것이 여섯째
// 사본이다. lib/tenantContact 정본을 그대로 import 해서 세야 이 숫자가 앱의 답과 같다.
//
// 아무것도 안 고친다. 게이트가 소급으로 막지 않는 결정(이미 확정된 계약은 통과)의 근거가 되는
// 숫자와, 대체로 새로 문자가 갈 사람 명단을 뽑는 것이 전부다. 번호는 마스킹해서 찍는다 —
// 터미널 로그와 보고서에 남는 값이라 전체 번호를 그대로 흘리지 않는다.
//
// 사용: npx tsx --env-file=.env.local scripts/check-tenant-own-phone.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import {
  pickTenantPhone, pickTenantPhoneWithFallback, reservationConfirmPhoneDenial,
  PHONE_CONTACT_KINDS, type TenantPhoneContactWithOwner,
} from '../lib/tenantContact'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

/** 뒤 네 자리만 남긴다 — 누구인지 이름·호실로 이미 특정되므로 번호 전체는 볼 필요가 없다. */
function mask(v: string): string {
  const d = v.replace(/[^0-9]/g, '')
  if (d.length <= 4) return '****'
  return `${'*'.repeat(Math.max(0, d.length - 4))}${d.slice(-4)}`
}

/** 이 사람이 지금 어느 단계인가 — 확정 게이트가 언제 걸리는지 보려는 축이다. */
function stageOf(leases: { status: string; reservationConfirmedAt: Date | null }[]): string {
  if (leases.some(l => l.status === 'RESERVED' && l.reservationConfirmedAt)) return '이미 확정'
  if (leases.some(l => l.status === 'ACTIVE' || l.status === 'CHECKOUT_PENDING')) return '거주중'
  if (leases.some(l => ['RESERVED', 'WAITING_TOUR', 'TOUR_DONE'].includes(l.status))) return '확정 전'
  return '그 밖'
}

async function main() {
  // 조회 한 번. 영업장 필터 없음 — 멀티테넌트 전체의 실태를 본다.
  const tenants = await prisma.tenant.findMany({
    select: {
      name: true,
      contacts: {
        select: {
          id: true, contactType: true, contactValue: true,
          isPrimary: true, isEmergency: true, isHomeCountry: true, createdAt: true,
          emergencyName: true, emergencyRelation: true,
        },
      },
      leaseTerms: {
        select: { status: true, reservationConfirmedAt: true, room: { select: { roomNo: true } } },
      },
    },
  })

  const buckets = { self: 0, emergencyOnly: 0, none: 0, messengerOnly: 0 }
  const stageOfDenied = new Map<string, number>()
  const newSmsTargets: string[] = []
  let certBlank = 0

  for (const t of tenants) {
    const contacts = t.contacts as TenantPhoneContactWithOwner[]
    // 종이 축(유선·해외 포함, 대체 없음) — 확정 게이트와 실거주 확인서가 보는 답이다.
    const own = pickTenantPhone(contacts, PHONE_CONTACT_KINDS)
    // 문자 축(휴대폰만, 대체 있음) — 실제로 문자가 갈 번호다.
    const sms = pickTenantPhoneWithFallback(contacts, ['PHONE'])
    const stage = stageOf(t.leaseTerms)
    const roomNo = t.leaseTerms.find(l => l.room?.roomNo)?.room?.roomNo ?? '호실 없음'

    if (own != null) buckets.self++
    else {
      // 게이트 문구가 갈래를 그대로 말해 준다 — 여기서 다시 나누지 않는다.
      const denial = reservationConfirmPhoneDenial({ contacts, alreadyConfirmed: false }) ?? ''
      if (denial.includes('메신저')) buckets.messengerOnly++
      else if (denial.includes('비상')) buckets.emergencyOnly++
      else buckets.none++
      stageOfDenied.set(stage, (stageOfDenied.get(stage) ?? 0) + 1)
      // 실거주 확인서는 대체를 안 쓰므로 이 사람들의 연락처 칸은 빈 채로 나간다.
      certBlank++
    }

    // 대체로 **새로** 문자가 갈 사람 — 종전에는 번호가 없어 발송 불가였다.
    if (own == null && sms?.source === 'emergency') {
      newSmsTargets.push(`${roomNo} · ${t.name} · ${mask(sms.value)} · ${sms.ownerLabel ?? '주인 표기 없음'} · ${stage}`)
    }
  }

  console.log(`[본인 전화번호 실태] 입주자 ${tenants.length}명`)
  console.log(`  본인 전화 있음        ${buckets.self}`)
  console.log(`  본인 없고 비상만      ${buckets.emergencyOnly}`)
  console.log(`  본인 없고 메신저만    ${buckets.messengerOnly}`)
  console.log(`  연락처 아예 없음      ${buckets.none}`)
  console.log(`  실거주 확인서 연락처가 빌 사람 ${certBlank}`)
  console.log(`\n  본인 번호 없는 사람의 단계별 분포`)
  for (const key of ['이미 확정', '거주중', '확정 전', '그 밖']) {
    console.log(`    ${key.padEnd(8)} ${stageOfDenied.get(key) ?? 0}`)
  }
  console.log(`\n  대체로 새로 문자가 갈 사람 ${newSmsTargets.length}명`)
  for (const line of newSmsTargets) console.log(`    - ${line}`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
