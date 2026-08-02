// 승계 보증금 몰취 3건에 사유·근거 소급 (운영자 확정 2026-08-02).
//
// 무슨 일인가
//   인수 전 입주자 3명(418 서민준·409 변세진·519 임형진)의 보증금 5만원씩이 퇴실 시 전액 몰취됐다.
//   그 기록에 사유가 비어 있고, 부가수익 상세에도 승계라는 사실이 없다.
//   세무 자료를 받는 쪽이 "이 입금 없는 매출은 무엇인가"를 물었을 때 답할 문장이 어디에도 없었다.
//
// 운영자 확인
//   "변세진의 보증금은 이 전 운영자에게 전달 받았던게 맞아. 다만, 그 당시 운영 원칙상
//    '키값'이라는 명목으로 안돌려줬어. 따라서, 이전 원장때 입실한 사람들은 그냥 안돌려주는걸로 하기로 했어.
//    서민준, 임형진도 마찬가지 몰취하는거지"
//
// 무엇을 고치나 — **금액은 한 원도 건드리지 않는다.** 설명만 채운다.
//   DepositRefund.reason  = '키값'
//   ExtraIncome.detail    = '{이름} 퇴실 · 키값 (인수 승계분)'
//
// 보증금 수납 record 는 만들지 않는다. 인수 전 입주자에게 record 가 없는 것이 이 영업장의 정상 상태이고
// (인수 전 계약 38건 중 35건이 그렇다), 없는 입금을 있는 것처럼 만들면 증빙 없는 기록이 된다.
// 승계 판정은 코드가 입주일과 인수일 비교로 이미 한다(getDepositBasisForLease).
//
// 실행:   npx tsx --env-file=.env.local scripts/fix-carryover-forfeit-reason.ts [--apply]
// 되돌리기: --revert --apply
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const REASON = '키값'
const NAMES = ['서민준', '변세진', '임형진']

const apply = process.argv.includes('--apply')
const revert = process.argv.includes('--revert')

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const property = await prisma.property.findFirst({ select: { id: true, acquisitionDate: true, prevOwnerCutoffDate: true } })
  const cutoff = property?.prevOwnerCutoffDate ?? property?.acquisitionDate ?? null

  const rows: { refundId: string; incId: string | null; label: string; before: string; afterReason: string | null; afterDetail: string }[] = []

  for (const name of NAMES) {
    const lease = await prisma.leaseTerm.findFirst({
      where: { tenant: { name }, propertyId: property!.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, moveInDate: true, tenant: { select: { name: true } }, room: { select: { roomNo: true } } },
    })
    if (!lease) { console.log(`  ${name} 계약을 찾지 못했습니다.`); continue }
    // 안전장치 — 인수 전 입주자가 아니면 이 규칙의 대상이 아니다
    const pre = !!(cutoff && lease.moveInDate && new Date(lease.moveInDate) < cutoff)
    if (!pre) { console.log(`  ${name} 은 인수 후 입주라 대상이 아닙니다. 건너뜁니다.`); continue }

    const refund = await prisma.depositRefund.findFirst({
      where: { leaseTermId: lease.id, propertyId: property!.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, reason: true, returnedAmount: true, withheldAmount: true },
    })
    if (!refund || refund.withheldAmount <= 0) { console.log(`  ${name} 몰취 기록이 없습니다. 건너뜁니다.`); continue }

    const inc = await prisma.extraIncome.findFirst({
      where: { leaseTermId: lease.id, propertyId: property!.id, payMethod: '보유 보증금' },
      orderBy: { createdAt: 'desc' }, select: { id: true, detail: true },
    })
    const label = `${lease.room?.roomNo ?? '-'}호 ${lease.tenant.name}`
    rows.push({
      refundId: refund.id, incId: inc?.id ?? null, label,
      before: `사유 ${refund.reason ?? '없음'} · 상세 ${inc?.detail ?? '없음'}`,
      afterReason: revert ? null : REASON,
      afterDetail: revert
        ? `${lease.tenant.name} 퇴실 · 보증금 미반환분`
        : `${lease.tenant.name} 퇴실 · ${REASON} (인수 승계분)`,
    })
  }

  console.log(`대상 ${rows.length}건 (몰취 금액은 손대지 않습니다)\n`)
  for (const r of rows) {
    console.log(`  ${r.label}`)
    console.log(`     이전: ${r.before}`)
    console.log(`     이후: 사유 ${r.afterReason ?? '없음'} · 상세 ${r.afterDetail}\n`)
  }

  if (!rows.length) { await prisma.$disconnect(); return }
  if (!apply) { console.log('실제 반영: --apply · 되돌리기: --revert --apply'); await prisma.$disconnect(); return }

  for (const r of rows) {
    await prisma.depositRefund.update({ where: { id: r.refundId }, data: { reason: r.afterReason } })
    if (r.incId) await prisma.extraIncome.update({ where: { id: r.incId }, data: { detail: r.afterDetail } })
  }
  console.log(`${rows.length}건 반영 완료`)
  await prisma.$disconnect()
}

void main()
