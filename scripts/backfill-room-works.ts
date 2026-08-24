// 도배·장판 지출을 작업 기록으로 잇는다 (2026-08-25, 운영자 지시 — 신고 b21e4e98 후속).
//
// 실행: npx tsx --env-file=.env.local scripts/backfill-room-works.ts [--apply]
// 기본은 예행이다. --apply 없이는 아무것도 쓰지 않는다.
//
// ── 왜 이 묶음 규칙인가 (실측이 정했다) ─────────────────────────
// 처음엔 (방·종류·**날짜**)로 묶으려 했다. 그러면 58건이 나오는데, 실측을 보니 그 대부분이
// 작업이 아니라 **자재 구매**다. 장판·몰딩은 5/29·6/22·7/2 처럼 여러 방 몫을 하루에 사서
// 방별로 쪼개 넣었고, 실제 시공은 방마다 다른 날 한 번 있었다. 날짜로 묶으면 자재를 산 날마다
// 가짜 '장판 작업'이 캘린더에 서게 된다.
//
// 그래서 **(방·종류)로 하나**를 만들고, 그 작업의 날짜는 **시공 지출의 날짜**로 잡는다.
// 시공 지출이 없으면(자재만 있는 조합) 가장 늦은 자재 날짜를 쓰고 메모에 그 사실을 남긴다 —
// 앱이 지어낸 날짜가 아니라 '아는 만큼'이라는 것이 보여야 한다.
//
// 두 번 돌려도 안전하다. 이미 이어진 지출(roomWorkId 가 있는 것)은 건너뛴다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const APPLY = process.argv.includes('--apply')

// 종류 판정 — 품목·상세·카테고리를 합쳐 본다. 몰딩은 장판 부속이라 장판으로 센다.
//
// **둘이 함께 적힌 지출이 있다.** 507·509호의 "도배+장판" 23만원이 그것이다(상세를 나눠 적기
// 전 시기, 운영자 확인 2026-08-25). 처음엔 먼저 걸리는 하나만 골랐고 그래서 두 방의 **도배가
// 통째로 사라졌다.** 종류를 하나만 돌려주는 함수 모양 자체가 그 결함을 부른 것이라 배열로 낸다.
const kindsOf = (s: string): string[] => {
  const out: string[] = []
  if (/장판|몰딩/.test(s)) out.push('장판')
  if (/도배|벽지/.test(s)) out.push('도배')
  return out
}
// 시공(공임) 지출인가 — 그 날이 작업일이다.
//
// '시공'·'하리'(현장 용어)에 더해, 종류 이름이 **단독으로** 적힌 것도 공임으로 본다.
// '벽지도배' 14만원이 그렇다 — 자재를 따로 안 사고 한 줄로 적은 도배 공임인데, 종전 규칙이
// '시공' 글자만 봐서 자재로 분류했고 그 결과 402·409·418호에 "자재 구매일로 기록했습니다"라는
// **거짓 메모**가 붙었다(날짜는 맞았다). 운영자 확인 — "장판시공으로 되어있는게 장판 시공한 날짜야".
const isLabor = (s: string): boolean => /시공|하리|벽지도배|도배\+장판/.test(s)

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

  const rows = await prisma.expense.findMany({
    where: {
      OR: [
        { category: { contains: '도배' } }, { category: { contains: '장판' } },
        { itemLabel: { contains: '도배' } }, { itemLabel: { contains: '장판' } },
        { itemLabel: { contains: '벽지' } }, { itemLabel: { contains: '몰딩' } },
        { detail: { contains: '도배' } }, { detail: { contains: '장판' } },
      ],
    },
  })

  type Group = {
    propertyId: string; roomId: string; kind: string
    laborDates: Date[]; matDates: Date[]
    expenseIds: string[]; amount: number
    /** 비용이 다른 종류 기록에 함께 걸려 있으면 그 종류 이름. 화면이 "왜 0원인가"를 말할 근거다. */
    sharedWith?: string
  }
  const groups = new Map<string, Group>()
  let skippedNoKind = 0, skippedNoRoom = 0, skippedLinked = 0

  for (const r of rows) {
    if (r.roomWorkId) { skippedLinked += 1; continue }
    const kinds = kindsOf(`${r.itemLabel ?? ''} ${r.detail ?? ''} ${r.category}`)
    if (kinds.length === 0) { skippedNoKind += 1; continue }
    // 방이 없으면 어느 방 작업인지 앱이 알 수 없다. 지어내지 않고 남겨 둔다.
    if (!r.roomId) { skippedNoRoom += 1; continue }
    const labor = isLabor(`${r.itemLabel ?? ''} ${r.detail ?? ''}`)
    for (const kind of kinds) {
      const key = `${r.roomId}|${kind}`
      const g = groups.get(key) ?? {
        propertyId: r.propertyId, roomId: r.roomId, kind,
        laborDates: [], matDates: [], expenseIds: [], amount: 0,
      }
      ;(labor ? g.laborDates : g.matDates).push(r.date)
      // 지출은 **한 작업에만** 걸 수 있다(Expense.roomWorkId 는 단일). 둘에 걸친 지출은
      // 첫 종류에만 걸고 나머지 쪽 기록에는 그 사실을 메모로 남긴다 — 금액을 임의로
      // 쪼개면 앱이 지어낸 숫자가 장부에 들어간다.
      if (kind === kinds[0]) { g.expenseIds.push(r.id); g.amount += r.amount }
      else g.sharedWith = kinds[0]
      groups.set(key, g)
    }
  }

  const roomNo = new Map(
    (await prisma.room.findMany({ select: { id: true, roomNo: true } })).map(r => [r.id, r.roomNo]),
  )
  const latest = (ds: Date[]) => ds.slice().sort((a, b) => b.getTime() - a.getTime())[0]

  console.log(`대상 지출 ${rows.length}건`)
  console.log(`  건너뜀 — 종류 판정 불가 ${skippedNoKind}건 · 방 없음 ${skippedNoRoom}건 · 이미 이어짐 ${skippedLinked}건`)
  console.log(`→ 작업 기록 ${groups.size}건`)

  let noLabor = 0
  const plan = [...groups.values()].map(g => {
    const useLabor = g.laborDates.length > 0
    if (!useLabor) noLabor += 1
    return {
      g,
      doneDate: useLabor ? latest(g.laborDates) : latest(g.matDates),
      guessed: !useLabor,
    }
  })
  console.log(`  시공 지출로 날짜를 정한 것 ${plan.length - noLabor}건 / 자재 날짜로 대신한 것 ${noLabor}건`)
  const byKind = new Map<string, number>()
  for (const p of plan) byKind.set(p.g.kind, (byKind.get(p.g.kind) ?? 0) + 1)
  console.log('  종류별:', [...byKind.entries()].map(([k, v]) => `${k} ${v}건`).join(' / '))
  for (const p of plan.slice(0, 6)) {
    console.log(`    ${roomNo.get(p.g.roomId) ?? '?'} ${p.g.kind} ${p.doneDate.toISOString().slice(0, 10)}${p.guessed ? ' (자재일)' : ''} · 지출 ${p.g.expenseIds.length}건 ${p.g.amount.toLocaleString()}원`)
  }

  if (!APPLY) {
    console.log('\n예행이다. 실제로 쓰려면 --apply 를 붙일 것.')
    await prisma.$disconnect()
    return
  }

  let made = 0, linked = 0
  for (const p of plan) {
    const work = await prisma.roomWork.create({
      data: {
        propertyId: p.g.propertyId, roomId: p.g.roomId, kind: p.g.kind,
        status: 'DONE', doneDate: p.doneDate,
        memo: p.g.sharedWith
          ? `비용은 같은 날 ${p.g.sharedWith} 건에 함께 기록돼 있습니다.`
          : p.guessed ? '시공 지출이 없어 자재 구매일로 기록했습니다.' : null,
      },
    })
    made += 1
    const res = await prisma.expense.updateMany({
      where: { id: { in: p.g.expenseIds } },
      data: { roomWorkId: work.id },
    })
    linked += res.count
  }
  console.log(`\n작업 기록 ${made}건 신설 / 지출 ${linked}건 연결`)
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
