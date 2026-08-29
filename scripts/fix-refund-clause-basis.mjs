// 계약서 §2 환불 조항의 위약금 기준액을 '총 입실 금액'에서 '잔여 이용금액'으로 바로잡는다.
//
// 왜. 소비자분쟁해결기준(공정거래위원회 고시, 고시원운영업)은 개시일 **이후** 해지에 대해
// 「총 이용금액 − 일할계산 이용료 − 잔여이용금액의 10%」를 말한다. 총액의 10% 는 개시일
// 이전, 즉 하루도 안 산 경우의 기준이다. 앱 계산은 2026-08-29 에 바로잡았는데, 계약서 문안은
// 영업장이 직접 쓴 저장값이라 코드가 못 건드린다. 종이와 계산이 다른 말을 하면 안 된다.
//
// **이미 발급된 계약서는 안 바뀐다.** 발급본은 박제되므로 새로 발급하는 것부터 적용된다.
//
// 예행: node --env-file=.env.local scripts/fix-refund-clause-basis.mjs
// 적용: node --env-file=.env.local scripts/fix-refund-clause-basis.mjs --apply
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const apply = process.argv.includes('--apply')
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

const FROM = '위약금(총 입실 금액의 10%)'
const TO = '위약금(잔여 이용금액의 10%)'
// 잔여 이용금액이 무엇인지 종이에 없으면 받는 사람이 계산을 못 한다. 한 문장을 잇는다.
const TAIL = ' 잔여 이용금액은 총 입실 금액에서 실제 이용일수만큼의 금액을 뺀 금액입니다.'

const ps = await prisma.property.findMany({ select: { id: true, name: true, contractTemplate: true } })
let changed = 0
for (const p of ps) {
  const t = p.contractTemplate
  if (!t?.sections) { console.log(`[건너뜀] ${p.name} — 저장된 계약서 본문이 없다(코드 기본 템플릿을 쓴다).`); continue }
  let hit = false
  const sections = t.sections.map(sec => ({
    ...sec,
    items: (sec.items ?? []).map(it => {
      if (!it.includes(FROM)) return it
      hit = true
      let next = it.replace(FROM, TO)
      // 꼬리 문장은 한 번만 — 이미 있으면 그대로 둔다(재실행 안전).
      if (!next.includes('잔여 이용금액은')) {
        const at = next.indexOf('환불합니다.')
        next = at >= 0 ? next.slice(0, at + 6) + TAIL + next.slice(at + 6) : next + TAIL
      }
      return next
    }),
  }))
  if (!hit) { console.log(`[건너뜀] ${p.name} — 바꿀 문구가 없다.`); continue }
  changed++
  console.log(`\n[${p.name}]`)
  for (let i = 0; i < t.sections.length; i++) {
    for (let j = 0; j < (t.sections[i].items ?? []).length; j++) {
      const a = t.sections[i].items[j], b = sections[i].items[j]
      if (a !== b) { console.log(`  전: ${a}`); console.log(`  후: ${b}`) }
    }
  }
  if (apply) {
    await prisma.property.update({ where: { id: p.id }, data: { contractTemplate: { ...t, sections } } })
    console.log('  적용함')
  }
}
console.log(`\n대상 ${changed}곳 · ${apply ? '적용 완료' : '예행(적용하려면 --apply)'}`)
await prisma.$disconnect()
