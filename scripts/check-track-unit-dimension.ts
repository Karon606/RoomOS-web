// 최근 점검 값의 차원이 카드 추적 단위와 맞는가 · 읽기 전용, 경고만(exit 0). 실행: npx tsx --env-file=.env.local scripts/check-track-unit-dimension.ts
//
// 왜(운영자 승인 2026-11-02). 품목 설정의 추적 단위 토글이 trackUnit 만 바꾸고 지난 점검을 그대로 두던 때가 있었다. 그러면
// 4500ml 로 적힌 점검 위에 개수 구매가 더해져 잔량과 평균 소모가 틀어진다. 이제 전환은 switchTrackUnit 하나이고 값과 수령 자동
// 메모를 같은 배수로 바꾼다. 여기서는 장부에 남은 값을 본다. 점검 값의 단위를 말하는 유일한 흔적은 수령 자동 메모
// (`[수령 자동] +4500ml`)라, 카드마다 가장 최근 점검이 그 꼴이면 메모 단위와 지금 카드 단위(trackUnit 이 qty 면 수량 단위,
// 아니면 규격 단위)의 차원을 견준다. 부피·무게·길이는 서로 환산되면 같은 차원이고, 환산 단위가 아닌 낱말(개·롤·포대)끼리는
// 같은 '개수' 차원으로 본다. 어긋나면 그 카드의 점검 값이 옛 단위로 남았을 수 있다는 뜻이라 경고한다(사실 확인 대상).
//
// 멀티테넌트: 전 영업장을 본다. 특정 영업장 값을 하드코딩하지 않는다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { convertUnit, isConvertibleUnit } from '../lib/units'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL }) })

const RECEIPT_RE = /^\[수령 자동\] \+\d+(?:\.\d+)?(\S*)$/

function sameDimension(a: string, b: string): boolean {
  const ca = isConvertibleUnit(a), cb = isConvertibleUnit(b)
  if (ca !== cb) return false
  if (!ca) return true
  return convertUnit(1, a, b) != null
}

async function main() {
  const cards = await prisma.trackedItem.findMany({
    where: { isArchived: false },
    select: { id: true, label: true, trackUnit: true, specUnit: true, qtyUnit: true, property: { select: { name: true } } },
  })
  const off: string[] = []
  let judged = 0
  for (const c of cards) {
    const last = await prisma.stockCheck.findFirst({
      where: { trackedItemId: c.id }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], select: { memo: true, remainingQty: true, date: true },
    })
    const m = last?.memo ? RECEIPT_RE.exec(last.memo) : null
    if (!m) continue
    const memoUnit = m[1]
    const cardUnit = (c.trackUnit === 'qty' ? c.qtyUnit : (c.specUnit || c.qtyUnit)) ?? ''
    if (!memoUnit || !cardUnit) continue
    judged++
    if (!sameDimension(memoUnit, cardUnit)) {
      off.push(`  ${c.property.name} · ${c.label} · 카드 ${c.trackUnit === 'qty' ? '수량' : '규격'} 단위(${cardUnit}) · 최근 점검 ${last!.date.toISOString().slice(0, 10)} '${last!.memo}'`)
    }
  }
  if (off.length) {
    console.warn(`[추적 단위 차원] 주의 ${off.length}건(최근 점검 값이 카드 단위와 다른 차원으로 적혔을 수 있다)`)
    for (const l of off) console.warn(l)
    console.warn('  재고 점검으로 잔량을 지금 단위로 다시 세어 주세요.')
  }
  console.log(`[추적 단위 차원] 활성 카드 ${cards.length}장 · 판정 ${judged}장 · 주의 ${off.length}건 (경고만, 실패 아님)`)
  await prisma.$disconnect()
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(2) })
