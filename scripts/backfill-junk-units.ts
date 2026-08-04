// 뜻 없는 단위 표기 정리 (2026-08-04, 신고 102d768f·c977db2a).
//
// 영수증의 단위 칸이 비어 있으면 줄표(—)가 들어 있는데, AI 가 그것을 단위로 읽어 넘겼고
// 앱이 검사 없이 그대로 적었다. 화면에 '20—' 이 뜬다. 지금은 잔량이 우연히 맞다 —
// 그 품목 카드의 단위가 비어 있어 느슨 매칭이 단위 비교를 건너뛰었기 때문이다.
// 단위가 채워진 카드에 이런 구매가 들어오면 그 구매가 재고 매칭에서 통째로 탈락한다.
//
// 값은 지어내지 않는다. 근거의 우선순위는 **품목 카드 > 형제 구매** 다.
// 형제 다수결만 쓰면 과거에 단위가 섞여 들어온 품목에서 엉뚱한 값이 뽑힌다 —
// 음식물쓰레기봉투 5L 은 과거에 '개'2건 '매'1건이라 다수결이 '개'가 되는데,
// 그 품목의 원본 카드와 운영자 확인은 둘 다 '매'다. 카드가 품목 단위의 정본이다.
// 어느 쪽에도 근거가 없으면 비운다(빈 단위는 느슨 매칭을 위한 정상 상태다).
// 수량 장부는 건드리지 않는다 — 이미 정확하다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const APPLY = process.argv.includes('--apply')
const HAS_WORD = /[\p{L}\p{N}]/u
const junk = (v: string | null) => !!v && !HAS_WORD.test(v.trim())

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

  // 크기 표기를 지운 이름으로 카드를 찾는다 — "음식물쓰레기봉투 (5L)" 의 정본은 "음식물쓰레기봉투" 카드다
  const baseName = (v: string) => v.replace(/\([^)]*\)/g, ' ').replace(/\d+\s*[a-zA-Z가-힣]*/g, ' ').replace(/\s+/g, ' ').trim()
  const cards = await prisma.trackedItem.findMany({ select: { label: true, category: true, qtyUnit: true, specUnit: true } })

  const all = await prisma.expense.findMany({
    select: { id: true, date: true, itemLabel: true, category: true, qtyValue: true, qtyUnit: true, specValue: true, specUnit: true, specText: true, detail: true },
  })
  const bad = all.filter(e => junk(e.qtyUnit) || junk(e.specUnit))
  console.log(`지출 ${all.length}건 중 뜻 없는 단위 ${bad.length}건${APPLY ? '' : ' (미리보기)'}`)

  for (const e of bad) {
    // 같은 품목의 다른 구매에서 실제로 쓰인 단위를 찾는다. 없으면 비운다.
    const siblings = all.filter(o => o.id !== e.id && o.itemLabel === e.itemLabel && o.category === e.category)
    const pickUnit = (key: 'qtyUnit' | 'specUnit') => {
      // 1순위 — 이름이 정확히 같은 카드
      const exact = cards.find(c => c.category === e.category && c.label === e.itemLabel)
      if (exact?.[key] && !junk(exact[key])) return exact[key]
      // 2순위 — 크기 표기를 지운 이름이 같은 카드(원본 카드)
      const base = baseName(e.itemLabel ?? '')
      const parent = cards.find(c => c.category === e.category && baseName(c.label) === base && c[key] && !junk(c[key]))
      if (parent) return parent[key]
      // 3순위 — 형제 구매의 다수결
      const counts = new Map<string, number>()
      for (const o of siblings) {
        const v = o[key]
        if (v && !junk(v)) counts.set(v, (counts.get(v) ?? 0) + 1)
      }
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    }
    const qtyUnit = junk(e.qtyUnit) ? pickUnit('qtyUnit') : e.qtyUnit
    const specUnit = junk(e.specUnit) ? pickUnit('specUnit') : e.specUnit
    const detail = `[${e.itemLabel}]${e.specText ? ` ${e.specText}` : e.specValue ? ` ${e.specValue}${specUnit ?? ''}` : ''}${e.qtyValue ? ` x ${e.qtyValue}${qtyUnit ?? ''}` : ''}`
    console.log(`  - ${e.date.toISOString().slice(0, 10)} "${e.itemLabel}" 수량단위 ${e.qtyUnit ?? '-'} → ${qtyUnit ?? '(비움)'} · 표기 "${e.detail}" → "${detail}"`)
    if (APPLY) await prisma.expense.update({ where: { id: e.id }, data: { qtyUnit, specUnit, detail } })
  }

  if (!APPLY) { console.log('\n--apply 를 붙이면 실제로 씁니다.'); await prisma.$disconnect(); return }
  const left = (await prisma.expense.findMany({ select: { qtyUnit: true, specUnit: true } }))
    .filter(e => junk(e.qtyUnit) || junk(e.specUnit)).length
  console.log(`\n적용 완료 ${bad.length}건 · 남은 오염 ${left}건`)
  await prisma.$disconnect()
}

main()
