// 자리 수를 넘겨 보이는 방 명부 — 읽기 전용, **위반이 아니라 확인 요청**이다. 항상 exit 0.
// 사용: npx tsx --env-file=.env.local scripts/check-asset-overinstall.ts
//
// 2026-09-16 5층 누수 수리에서 나왔다. 앵글밸브 비용은 5개인데 실제 설치는 3개였다. 자리 수
// (방당 기본 개수)를 DB 에 두는 안은 전 방·전 품목 선행 입력이 필요해 기각됐고, 대신 **다른
// 방들이 실제로 가진 개수의 최빈값**을 잠정 기준으로 삼아 그보다 많은 방만 뽑는다.
//
// **이 명부는 오답을 낸다. 그게 설계된 한계다.**
//   · 511호처럼 온수·냉수·변기 3자리가 전부 정상인 방도, 다른 방 대다수가 2개면 여기 뜬다.
//   · 반대로 한 방만 초과면 그 방이 최빈값이 되어 안 뜬다.
//   · 숫자만으로는 '초과 설치'와 '폐기 기록 누락'을 구별할 수 없다 — 502호 밸브 3개는
//     511호 3개와 글자가 같다. 어느 쪽인지는 사람만 안다.
// 그래서 자동 백필을 하지 않는다(운영자 확정 2026-09-16). 이 명부는 **어느 방을 눈으로 볼지**
// 만 알려 주고, 판단과 기록은 화면의 '폐기·분실 기록'으로 사람이 한다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { parseInventoryCategories } from '../app/(app)/inventory/categoryConfig'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })

// 최빈값 — 같은 수가 여럿이면 큰 쪽을 잡는다(작은 쪽을 잡으면 정상 방이 무더기로 뜬다).
function mode(ns: number[]): number {
  const cnt = new Map<number, number>()
  for (const n of ns) cnt.set(n, (cnt.get(n) ?? 0) + 1)
  let best = 0, bestN = -1
  for (const [n, c] of cnt) if (c > bestN || (c === bestN && n > best)) { best = n; bestN = c }
  return best
}

async function main() {
  const props = await prisma.property.findMany({ select: { id: true, name: true, inventoryCategories: true } })
  let listed = 0
  for (const p of props) {
    const trackedCats = parseInventoryCategories(p.inventoryCategories ?? null).map(c => c.cat)
    const rows = await prisma.expense.findMany({
      where: {
        propertyId: p.id, itemLabel: { not: null }, isShipping: false,
        category: { notIn: trackedCats }, excludeFromInventory: false,
        roomId: { not: null }, receivedAt: { not: null },
        disposedAt: null,              // 살아 있는 것만 센다 — 폐기를 적어 두면 이 명부에서 빠진다
      },
      select: { itemLabel: true, qtyValue: true, qtyUnit: true, roomId: true, room: { select: { roomNo: true } } },
    })
    // (품목 + 단위) → 방별 살아 있는 수량
    const byItem = new Map<string, Map<string, number>>()
    for (const r of rows) {
      const key = `${r.itemLabel}␟${r.qtyUnit ?? '개'}`
      const m = byItem.get(key) ?? new Map<string, number>()
      const roomNo = r.room?.roomNo ?? r.roomId!
      m.set(roomNo, (m.get(roomNo) ?? 0) + (r.qtyValue ?? 1))
      byItem.set(key, m)
    }
    for (const [key, m] of [...byItem.entries()].sort()) {
      // 방이 셋 미만이면 최빈값이 뜻을 갖지 못한다 — 말을 안 하는 쪽이 낫다.
      if (m.size < 3) continue
      const [label, unit] = key.split('␟')
      const base = mode([...m.values()])
      const over = [...m.entries()].filter(([, n]) => n > base + 1e-9).sort((a, b) => b[1] - a[1])
      if (!over.length) continue
      if (listed === 0) console.log(`\n[초과 후보] ${p.name}`)
      listed += over.length
      console.log(`  · ${label} — 다른 방 최빈 ${base}${unit} (방 ${m.size}곳)`)
      for (const [roomNo, n] of over) console.log(`      ${roomNo}호 ${n}${unit}  (+${Math.round((n - base) * 1000) / 1000})`)
    }
  }
  await prisma.$disconnect()

  console.log(`\n[초과 후보] ${listed}건`)
  console.log('  이것은 **위반 목록이 아니라 확인 요청 명부**다. 최빈값은 자리 수가 아니라 잠정 기준일 뿐이라,')
  console.log('  온수·냉수·변기 3자리가 정상인 방도 다른 방 대다수가 2개면 여기 뜬다(511호가 그렇다).')
  console.log('  반대로 한 방만 초과면 그 방이 최빈값이 되어 안 뜬다. 숫자만으로는 초과 설치와 폐기 누락을')
  console.log('  구별할 수 없으니, 눈으로 확인하고 화면의 "폐기·분실 기록"으로 사람이 적는다.')
}

main()
