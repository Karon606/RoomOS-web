// '과납 이월' 자동 메모 백필 (운영자 승인 2026-08-02).
//
// 왜
//   이 경로에서는 진짜 과납이 발생하지 않는다. 넘어갈 달이 있으니 정의상 과납이 아니고,
//   남는 돈을 다음 달로 미는 것뿐이다. 문구가 사실과 반대로 읽힌다는 운영자 지적.
//   가리키는 달도 틀린 건이 있다 — 두 달 이상 건너뛰면 종전 문구는 startTm 을 박아 엉뚱한 달을 가리켰다
//   (421호 이종현: 2026-06 귀속 record 에 "2026-04 과납 이월").
//
// 판정 규칙 (코드 정본 savePayment 과 같다)
//   같은 결제(같은 leaseTermId + payDate)가 **직전 달**에 실제로 기여했는가.
//     기여함  -> `{직전달}분 채우고 남은 금액`
//     기여없음 -> `{직전달}분까지 완납 · 미리 낸 금액`
//   직전 달은 이 record 의 귀속월 −1개월이다. startTm 이 아니라 직전 충당월을 가리켜야 맞다.
//
// 금액·집계 영향 0. 메모는 어떤 계산에도 쓰이지 않고 파싱하는 코드도 없다(확인).
// 사용자 메모 병기(' · 내용')는 그대로 보존한다.
//
// 실행:   npx tsx --env-file=.env.local scripts/fix-carry-memo.ts [--apply]
// 되돌리기: --revert --apply
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const OLD_RE = /^(\d{4})-(\d{2}) 과납 이월/
const NEW_RE = /^(\d{4})년 (\d{1,2})월분(까지 완납 · 미리 낸 금액| 채우고 남은 금액)/

const apply = process.argv.includes('--apply')
const revert = process.argv.includes('--revert')

const prevMonthOf = (tm: string) => {
  const [y, m] = tm.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

  const targets = await prisma.paymentRecord.findMany({
    where: { deletedAt: null, memo: { contains: revert ? '월분' : '과납 이월' } },
    orderBy: [{ payDate: 'asc' }],
    select: {
      id: true, targetMonth: true, actualAmount: true, payDate: true, memo: true, leaseTermId: true,
      leaseTerm: { select: { tenant: { select: { name: true } }, room: { select: { roomNo: true } } } },
    },
  })

  const rows: { id: string; label: string; before: string; after: string }[] = []
  for (const r of targets) {
    const memo = r.memo ?? ''
    const m = revert ? NEW_RE.exec(memo) : OLD_RE.exec(memo)
    if (!m) continue
    const head = revert ? m[0] : m[0]
    const tail = memo.slice(head.length)          // ' · 사용자메모' 또는 ''
    const label = `${r.leaseTerm.room?.roomNo ?? '-'}호 ${r.leaseTerm.tenant.name}`

    let after: string
    if (revert) {
      // 되돌리기 — 직전 달 표기를 'YYYY-MM 과납 이월' 로. 원본이 startTm 이었으므로 완전 복원은 불가하나,
      // 이 백필로 바뀐 건만 대상이고 문구 형태를 원복한다.
      const prev = prevMonthOf(r.targetMonth)
      after = `${prev} 과납 이월${tail}`
    } else {
      const prev = prevMonthOf(r.targetMonth)
      // 같은 결제가 직전 달에 실제로 기여했는가 — 같은 lease + 같은 payDate 의 직전 달 record 존재 여부
      const contributed = await prisma.paymentRecord.count({
        where: {
          leaseTermId: r.leaseTermId, targetMonth: prev, payDate: r.payDate,
          isDeposit: false, isBillingAdjust: false, deletedAt: null, actualAmount: { gt: 0 },
        },
      })
      const [py, pm] = prev.split('-').map(Number)
      after = contributed > 0
        ? `${py}년 ${pm}월분 채우고 남은 금액${tail}`
        : `${py}년 ${pm}월분까지 완납 · 미리 낸 금액${tail}`
    }
    if (after !== memo) rows.push({ id: r.id, label, before: memo, after })
  }

  console.log(`대상 ${rows.length}건\n`)
  for (const r of rows) console.log(`  ${r.label.padEnd(20)} ${r.before}\n  ${''.padEnd(20)} -> ${r.after}\n`)

  if (!rows.length) { await prisma.$disconnect(); return }
  if (!apply) { console.log('실제 반영: --apply · 되돌리기: --revert --apply'); await prisma.$disconnect(); return }

  // updateMany 는 소프트삭제 익스텐션이 안 붙는다(knowledge/soft-delete-pattern) — 건별 update
  for (const r of rows) await prisma.paymentRecord.update({ where: { id: r.id }, data: { memo: r.after } })
  console.log(`${rows.length}건 반영 완료`)
  await prisma.$disconnect()
}

void main()
