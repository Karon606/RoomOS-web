// 품목이 엉뚱한 쪽(소모품 대 비품)으로 가거나 셀 수 없는 상태로 만들어졌는지 검사 — 읽기 전용.
//
// 신고 41728d75 — "매트리스커버는 비품으로 들어가는데 왜 일반 소모품으로 가있지? 점점 이 앱이 망가지고 있는거 아냐?"
//
// **비품이냐 소모품이냐를 가르는 축은 지출 카테고리 하나다.** 영업장의 재고추적 카테고리 목록
// (기본 부식비·소모품비·폐기물 처리비)에 들면 소모품, 밖이면 비품. 품목 성격도 금액도 안 본다.
// 그래서 그 카테고리 문자열 하나가 잘못 찍히면 물건이 통째로 반대편으로 간다.
// 매트리스커버는 같은 이름으로 10건이 수선유지비에 있었는데 11번째만 소모품비로 갔다.
//
// 축 셋이고 등급이 다르다. 판정 기준은 실제 사례가 잡히는가다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

// 길이 차원 — 소모품 잔량을 길이로 세는 정당한 경우가 없다. 규격이 '한 개의 크기'라는 신호다.
// 봉투 50L 을 리터당으로 나눌 수 없는 것과 같다(운영자 지적 2026-08-04).
const LENGTH_UNITS = new Set(['mm', 'cm', 'm', 'km', 'inch', 'in', 'ft', '인치'])

type Cat = { cat: string }

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const errors: string[] = []
  const warns: string[] = []

  const props = await prisma.property.findMany({ select: { id: true, inventoryCategories: true } })
  for (const prop of props) {
    // 추적 카테고리 정본 — 설정이 없으면 기본 3종. 판정 규칙을 복제하지 않고 같은 값을 읽는다.
    const raw = prop.inventoryCategories as Cat[] | null
    const tracked = new Set(
      Array.isArray(raw) && raw.length ? raw.map(c => c.cat) : ['부식비', '소모품비', '폐기물 처리비'],
    )

    const expenses = await prisma.expense.findMany({
      where: { propertyId: prop.id, isShipping: false },
      select: { category: true, itemLabel: true },
    })

    // ── 축 1. 같은 이름이 소모품 쪽과 비품 쪽 양쪽에 있다(오류)
    //    이름이 같은데 어떤 건 세고 어떤 건 안 센다. 둘 중 하나는 잘못 찍힌 것이다.
    const byLabel = new Map<string, { inn: number; out: number; cats: Set<string> }>()
    for (const e of expenses) {
      if (!e.itemLabel) continue
      const cur = byLabel.get(e.itemLabel) ?? { inn: 0, out: 0, cats: new Set<string>() }
      if (tracked.has(e.category)) cur.inn++
      else cur.out++
      cur.cats.add(e.category)
      byLabel.set(e.itemLabel, cur)
    }
    for (const [label, v] of byLabel) {
      if (v.inn > 0 && v.out > 0) {
        errors.push(`[갈림] "${label}" 이 소모품 쪽 ${v.inn}건, 비품 쪽 ${v.out}건으로 갈려 있다 (${[...v.cats].join(', ')})`)
      }
    }

    // ── 축 2. 셀 수 없는 상태로 만들어진 카드
    const cards = await prisma.trackedItem.findMany({
      where: { propertyId: prop.id, isArchived: false },
      select: { id: true, label: true, category: true, trackUnit: true, specUnit: true },
    })
    for (const c of cards) {
      if (c.trackUnit !== 'spec') continue
      // (a) 규격 단위가 길이다 — 오류. 테프론 테이프가 15롤이 아니라 150m 로 잡힌 그 상태다.
      if (c.specUnit && LENGTH_UNITS.has(c.specUnit.trim())) {
        errors.push(`[단위] "${c.label}" 이 길이(${c.specUnit})로 잔량을 센다 — 그 규격은 한 개의 크기이지 나눌 수 있는 양이 아니다`)
        continue
      }
      // (b) 규격 근거가 아예 없다 — 경고. 지금은 수량으로 대신 세어 맞게 보이지만,
      //     규격이 붙은 구매가 한 번 들어오면 그 순간 뒤집힌다.
      if (!c.specUnit) {
        const anySpec = await prisma.expense.findFirst({
          where: { propertyId: prop.id, itemLabel: c.label, category: c.category, NOT: { specValue: null } },
          select: { id: true },
        })
        if (!anySpec) {
          warns.push(`[굳히기] "${c.label}" 이 규격 모드인데 규격 값이 하나도 없다 — 지금은 수량으로 맞게 보이지만 규격이 붙으면 뒤집힌다`)
        }
      }
    }

    // ── 축 3. 수령된 구매는 있는데 점검이 전무한 카드(오류 게이트)
    //    종전에는 위치 없는 카드가 수령 확인을 눌러도 자동 점검이 안 생겨 장부에 아무것도 안 들어갔다
    //    (신고 408b4396, 특수마대 5개). confirmReceipt 가 무위치도 점검을 만들게 고쳤고 과거분은
    //    백필로 앵커를 만들어 0건이 됐다. 이 축이 다시 1 이상이면 그 경로가 도로 새는 것이다.
    for (const c of cards) {
      const received = await prisma.expense.findFirst({
        where: {
          propertyId: prop.id, category: c.category, itemLabel: c.label,
          NOT: { receivedAt: null }, excludeFromInventory: false, isShipping: false,
        },
        select: { id: true },
      })
      if (!received) continue
      const anyCheck = await prisma.stockCheck.findFirst({ where: { trackedItemId: c.id }, select: { id: true } })
      if (!anyCheck) {
        errors.push(`[유령수령] "${c.label}" 에 수령된 구매가 있는데 점검이 하나도 없다 — 잔량이 영원히 비어 보인다`)
      }
    }
  }

  await prisma.$disconnect()

  console.log(`[품목 분류] 오류 ${errors.length}건 · 경고 ${warns.length}건`)
  for (const w of warns) console.log('  · ' + w)
  if (errors.length) {
    console.error(`\n[품목 분류] 오류 ${errors.length}건`)
    for (const e of errors) console.error('  - ' + e)
    console.error('\n  비품·소모품은 지출 카테고리 하나로 갈린다. 같은 이름이 양쪽에 있으면 하나는 잘못 찍힌 것이다.')
    process.exit(1)
  }
}

main()
