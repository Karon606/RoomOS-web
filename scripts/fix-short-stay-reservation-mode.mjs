// 단기 입실 정책의 예약금 처리를 '보증금(퇴실 시 환불)'로 통일한다.
//
// 왜. 단기만 applyToRent(예약금에서 청소비를 떼고 남은 몫을 이용료 선납으로 충당) 예외를 두고
// 있었다. 처음에는 의도한 예외였는데, 운영해 보니 어차피 예약금을 걸어야 예약이 되고 단기와
// 일반을 따로 관리하다 보니 "누구는 환불해 주고 누구는 안 하고"가 헷갈렸다(운영자 2026-08-30).
// 다 보증금으로 통일하면 퇴실 정산에서 갈릴 일이 없다.
//
// 영업장 공통(Property.reservationDepositMode)은 이미 deposit 이라 결과는 같지만, 값을 비우지
// 않고 명시한다 — "다 보증금"이라는 결정이 설정 화면에 그대로 보여야 한다.
//
// **계약별로 이미 박힌 값은 안 건드린다.** 그 계약이 체결될 때의 약속이라 소급하면 안 된다.
//
// 예행: node --env-file=.env.local scripts/fix-short-stay-reservation-mode.mjs
// 적용: node --env-file=.env.local scripts/fix-short-stay-reservation-mode.mjs --apply
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const apply = process.argv.includes('--apply')
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
const TO = 'refundableDeposit'

const ps = await prisma.property.findMany({ select: { id: true, name: true, shortStayPolicy: true, reservationDepositMode: true } })
let changed = 0
for (const p of ps) {
  const pol = p.shortStayPolicy
  if (!pol || typeof pol !== 'object') { console.log(`[건너뜀] ${p.name} — 단기 정책이 없다.`); continue }
  if (pol.reservationMode === TO) { console.log(`[건너뜀] ${p.name} — 이미 보증금이다.`); continue }
  changed++
  console.log(`\n[${p.name}]`)
  console.log(`  영업장 공통: ${p.reservationDepositMode}`)
  console.log(`  단기 예약금: ${pol.reservationMode ?? '(미설정)'} → ${TO}`)
  console.log(`  단기 보증금 ${(pol.deposit ?? 0).toLocaleString()}원 · 청소비 ${(pol.cleaningFee ?? 0).toLocaleString()}원 (그대로)`)
  if (apply) {
    await prisma.property.update({ where: { id: p.id }, data: { shortStayPolicy: { ...pol, reservationMode: TO } } })
    console.log('  적용함')
  }
}
console.log(`\n대상 ${changed}곳 · ${apply ? '적용 완료' : '예행(적용하려면 --apply)'}`)
await prisma.$disconnect()
