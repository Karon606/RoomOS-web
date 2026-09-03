// 발급본 태그를 종이에 찍힌 문자열에서 읽어 채우는 백필 — 기본은 예행, --apply 로만 적용.
//
// **추정이 아니라 기록 낭독이다.** issuedSnapshot.facts['tenant.name'] 은 표기가 이미 적용된
// 문자열이라 그 자체가 "이 종이에 무엇이 찍혔는가"의 기록이다. 고객 정보 세 칸과 대조해
// **정확히 하나만 일치할 때만** 그 표기로 채운다. 0개거나 2개 이상이면 손대지 않는다.
//
// 어제 판(지금 시점 resolveDocNameStyle 재해석)은 방향이 반대였다. 발급 API 도 화면과 같은
// 자동값 'ko' 를 썼으므로 태그가 null 인 발급본의 종이는 대개 한글이다. 그 상태에서 en 으로
// 백필했으면 한글 종이에 영문 태그를 붙일 뻔했다(2026-09-04 정정).
//
// 박제가 없는 발급본은 채우지 않는다. 그것은 2026-08-11 이전이라 코드상 한글 확정이고,
// null 이 읽는 쪽에서 이미 한글로 해석되므로 표시가 정확하다. 채우면 기록과 유추가 섞인다.
import prisma from '../lib/prisma'
import { issuedPrintedName } from '../lib/contractPrintedFacts'
import { type DocNameStyle } from '../lib/documentName'

const apply = process.argv.includes('--apply')

async function main() {
  const rows = await prisma.contractFile.findMany({
    where: { source: 'GENERATED', nameStyle: null },
    select: { id: true, fileName: true, issuedSnapshot: true, createdAt: true,
      leaseTerm: { select: { room: { select: { roomNo: true } } } },
      tenant: { select: { name: true, englishName: true, nativeName: true } } },
    orderBy: { createdAt: 'desc' },
  })
  const plan: { id: string; who: string; style: DocNameStyle; printed: string }[] = []
  const skipped: string[] = []
  for (const r of rows) {
    const printed = issuedPrintedName(r.issuedSnapshot)
    const t = r.tenant
    if (!printed || !t) { skipped.push(`${r.fileName} — 박제 없음`); continue }
    // 세 칸 중 정확히 하나만 맞아야 한다. 개명한 사람은 어느 것과도 안 맞고, 한글명과
    // 영문명이 같은 사람은 둘이 맞는다. 둘 다 근거가 못 된다.
    const hits: DocNameStyle[] = []
    if (t.name === printed) hits.push('ko')
    if (t.englishName && t.englishName === printed) hits.push('en')
    if (t.nativeName && t.nativeName === printed) hits.push('native')
    if (hits.length !== 1) { skipped.push(`${r.fileName} — 일치 ${hits.length}개(${printed})`); continue }
    plan.push({ id: r.id, who: `${r.leaseTerm?.room?.roomNo ?? '-'}호 ${t.name}`, style: hits[0], printed })
  }
  console.log(`\n태그 없는 발급본 ${rows.length}건 중 기록으로 채울 수 있는 것 ${plan.length}건\n`)
  const byStyle = new Map<string, number>()
  for (const p of plan) {
    byStyle.set(p.style, (byStyle.get(p.style) ?? 0) + 1)
    console.log(`  ${p.who.padEnd(24)} -> ${p.style.padEnd(6)} (종이: ${p.printed})`)
  }
  console.log('\n표기별')
  for (const [k, v] of byStyle) console.log(`  ${k}: ${v}건`)
  console.log(`\n건드리지 않는 것 ${skipped.length}건`)
  for (const s of skipped.slice(0, 8)) console.log(`  ${s}`)
  if (skipped.length > 8) console.log(`  ... 외 ${skipped.length - 8}건`)
  if (!apply) { console.log('\n예행이다. 적용하려면 --apply 를 붙인다.'); return }
  for (const p of plan) await prisma.contractFile.update({ where: { id: p.id }, data: { nameStyle: p.style } })
  console.log(`\n적용 완료 ${plan.length}건`)
}
main().finally(() => prisma.$disconnect())
