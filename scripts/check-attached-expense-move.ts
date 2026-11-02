// 카드에 붙어 있던 구매가 형제 카드로 옮겨진 흔적과 그것을 막는 배선을 함께 본다. 읽기 전용, 위반이 있으면 exit 1
//
// 왜(신고 573b2e06 세탁조크리너, 2026-11-02). 같은 품명에 규격이 섞이면 재고 시드가 **이미 카드에 붙어 있던 구매**까지
// 하위 이름으로 옮겨 새 카드를 세웠다. 운영자가 반년 세어 온 카드는 그 구매를 잃었고, 화면 어디에도 오류가 뜨지 않았다.
// 생성 경로는 inventory/seedLabel(붙은 묶음은 이름 그대로)과 applyMergeDecision(한 트랜잭션·지출별 CAS·붙은 지출 거부)으로
// 막았다. 이 그물은 그 배선이 풀리지 않았는지(ⓑ)와 운영 데이터에 같은 흔적이 새로 생기지 않았는지(ⓐ)를 본다.
//
// ⓐ 형제 카드 이관 흔적(DB). 활성 카드 C 에 받은 구매 E 가 붙어 있는데
//    · C 에는 E 를 받은 뒤 점검이 하나도 없고
//    · C 보다 먼저 생긴, 같은 카테고리·같은 정규화 이름(normalizeLabel)의 형제 카드 S(숨김 포함)에는 E 를 받은 뒤 점검이 있고
//    · E 의 수량 단위가 S 와 느슨하게 맞고(키친타월 (롤)/(팩)처럼 처음부터 S 에 붙을 수 없던 구매는 이관이 아니다)
//    · 두 이름의 크기 표시가 서로 다르지 않으면(50L 과 20L 봉투는 다른 물건이다)
//    E 는 S 에서 세던 물건이 C 로 옮겨진 것이다. 운영자가 S 에서 센 점검이 E 를 이미 품고 있다.
// ⓑ 정적 배선. applyMergeDecision 이 인터랙티브 트랜잭션·지출별 CAS·붙은 지출 거부이고, 새 품목 등록이 적용취소(NEW)를 남기고,
//    시드가 붙은 묶음을 옮기지 않고, 적용취소가 NEW 갈래를 갖는다.
//
// 실행: npx tsx --env-file=.env.local scripts/check-attached-expense-move.ts   (verify:db)
//       DATABASE_URL 이 없으면 ⓑ 만 본다.
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { normalizeLabel, sizeConflicts, attachedToCard } from '../app/(app)/inventory/seedLabel'

const fails: string[] = []
const need = (name: string, ok: boolean, why = '') => { if (!ok) fails.push(why ? `${name} — ${why}` : name) }

function body(src: string, header: string): string {
  const start = src.indexOf(header)
  if (start < 0) return ''
  const rest = src.slice(start + header.length)
  const m = rest.search(/\n(export )?(async )?function /)
  return src.slice(start, m < 0 ? src.length : start + header.length + m)
}

// ── ⓑ 정적 배선 ──────────────────────────────────────────────────────
const inv = readFileSync('app/(app)/inventory/actions.ts', 'utf8')
const apply = body(inv, 'export async function applyMergeDecision(')
need('ⓑ applyMergeDecision 을 찾음', apply.length > 0)
need('ⓑ1 병합 결정이 한 인터랙티브 트랜잭션이다', /await prisma\.\$transaction\(async tx =>/.test(apply) && !/\bprisma\.(expense|trackedItem|trackedItemMergeRule|trackedItemMergeUndo)\./.test(apply),
  '트랜잭션 밖 쓰기가 있으면 중간에 멈출 때 반쪽(이름만 옮김·규칙만 남음)이 남는다')
need('ⓑ2 지출마다 화면이 본 이름에서만 옮긴다(CAS)', /tx\.expense\.updateMany\(\{ where: \{ id: r\.id, propertyId, category, itemLabel: prev \}/.test(apply) && /c\.count !== 1\) throw new MergeDecisionDenied\(MERGE_DECISION_STALE\)/.test(apply),
  '확인하지 않고 옮기면 그 사이 붙은 구매까지 옮긴다')
need('ⓑ3 지금 카드에 붙은 지출이 섞이면 거부한다', /attachedToCard\(cards\.find\(c => c\.label === r\.itemLabel\), r\.qtyUnit\)\) throw new MergeDecisionDenied\(MERGE_DECISION_ATTACHED\)/.test(apply),
  '5월 세탁조크리너가 원래 카드를 떠난 길')
need("ⓑ4 '새 품목으로 등록' 이 적용취소 기록(NEW)을 남긴다", /payload: \{ kind: 'NEW',/.test(apply) && /return \{ ok: true, undoId \}/.test(apply),
  '적용하는 모든 기능엔 적용취소가 있어야 한다(§16)')
const seed = body(inv, 'export async function seedTrackedItemsFromExpenses(')
need('ⓑ 시드를 찾음', seed.length > 0)
need('ⓑ5 시드가 붙은 묶음을 옮기지 않는다', /planSubLabels\(list, g => attachedToCard\(card, g\.qtyUnit\)\)/.test(seed),
  '붙은 묶음에 하위 이름을 붙이면 원래 카드의 구매가 새 카드로 간다')
need('ⓑ6 시드 이름 이전이 원래 이름일 때만 옮긴다', !/expense\.updateMany\(\{\s*where: \{ id: \{ in: g\.expenseIds \} \}/.test(seed))
need('ⓑ7 거절 규칙이 크기를 본다', /muteApplies\(src, label\)/.test(seed), "'450ml 은 따로' 가 '530ml' 까지 막는다")
const unmerge = body(inv, 'export async function unmergeTrackedItem(')
need("ⓑ8 적용취소가 NEW 갈래를 갖는다", /if \(p\?\.kind === 'NEW'\) \{[\s\S]{0,300}undoNewMergeDecisionTx\(tx, propertyId, undo\.id, p\)/.test(unmerge))
const client = readFileSync('app/(app)/inventory/InventoryClient.tsx', 'utf8')
need('ⓑ9 병합 확인 창이 지출마다 화면이 본 이름을 보낸다', /const expenses = d\.rows\.map\(r => \(\{ id: r\.id, fromLabel: r\.fromLabel \}\)\)/.test(client))
need('ⓑ10 병합 확인 결과 토스트에 적용취소가 있다', /run: undoAll\(undoIds\)/.test(client))

// ── ⓐ 운영 데이터 흔적 ───────────────────────────────────────────────
async function db() {
  if (!process.env.DATABASE_URL) { console.log('  (DATABASE_URL 없음, ⓐ 건너뜀)'); return }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  try {
    const cards = await prisma.trackedItem.findMany({
      select: { id: true, propertyId: true, category: true, label: true, qtyUnit: true, isArchived: true, createdAt: true },
    })
    const byKey = new Map<string, typeof cards>()
    for (const c of cards) {
      const k = `${c.propertyId}|${c.category}|${normalizeLabel(c.label)}`
      if (!byKey.has(k)) byKey.set(k, [])
      byKey.get(k)!.push(c)
    }
    let seen = 0
    for (const list of byKey.values()) {
      if (list.length < 2) continue
      for (const C of list) {
        if (C.isArchived) continue
        const sibs = list.filter(S => S.id !== C.id && S.createdAt < C.createdAt && !sizeConflicts(S.label, C.label))
        if (!sibs.length) continue
        const recv = await prisma.expense.findMany({
          where: {
            propertyId: C.propertyId, category: C.category, itemLabel: C.label, NOT: { receivedAt: null }, excludeFromInventory: false, isShipping: false,
            ...(C.qtyUnit ? { OR: [{ qtyUnit: null }, { qtyUnit: C.qtyUnit }] } : {}),
          },
          select: { id: true, receivedAt: true, qtyUnit: true, date: true, vendor: true },
        })
        for (const E of recv) {
          seen++
          const afterOnC = await prisma.stockCheck.count({ where: { trackedItemId: C.id, createdAt: { gt: E.receivedAt! } } })
          if (afterOnC > 0) continue
          for (const S of sibs) {
            if (!attachedToCard(S, E.qtyUnit)) continue   // 처음부터 S 에 붙을 수 없던 구매(키친타월 (롤)/(팩))
            const afterOnS = await prisma.stockCheck.count({ where: { trackedItemId: S.id, createdAt: { gt: E.receivedAt! } } })
            if (afterOnS === 0) continue
            fails.push(`ⓐ '${C.label}'(${C.id.slice(0, 8)}) 의 구매 ${E.id.slice(0, 8)} ${E.date.toISOString().slice(0, 10)} ${E.vendor ?? ''} — `
              + `받은 뒤 이 카드엔 점검 0, 먼저 생긴 '${S.label}'(${S.id.slice(0, 8)}${S.isArchived ? '·숨김' : ''}) 엔 점검 ${afterOnS}. 그 카드에서 옮겨진 구매로 보인다`)
          }
        }
      }
    }
    console.log(`  ⓐ 형제 카드가 있는 활성 카드의 받은 구매 ${seen}건을 봤다`)
  } finally {
    await prisma.$disconnect()
  }
}

db().then(() => {
  console.log(`\n[붙은 구매 이관] 위반 ${fails.length}건`)
  for (const f of fails) console.log('  - ' + f)
  if (fails.length > 0) process.exit(1)
})
