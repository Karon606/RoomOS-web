// 자재 설치·폐기 두 축 진리표 — 실행: npx tsx scripts/test-asset-disposal.ts
//
// 2026-09-16 5층 누수 수리에서 나왔다. 앵글밸브 비용은 5개인데 실제 설치된 것은 3개였고,
// 504호 고압호스는 기록 3개·실물 2개였다. 축이 하나뿐이라 "비용이 5개면 물건도 5개"로
// 읽혔기 때문이다. 축을 둘로 가른다.
//
//   **돈의 축(amount)** — 그 방에 들어간 누적 금액. **절대 안 줄어든다.** 자재비는 살 때 이미
//     나간 돈이라 폐기로 방별 투자금이 줄면 그 방의 투자 이력이 거짓이 된다(domain-room-work).
//   **물건의 축(qtyValue)** — 우리가 사서 넣은 것 중 지금 살아 있는 개수.
//   "지금까지 들어간 개수"는 qtyValue + disposedQty 로 나오는 **파생**이라 셋째 축을 안 만든다.
//
// 진리표가 잠그는 것 열. 511호 정상 / 504호 1교체 / 502호 2철거폐기 / 전량 폐기 /
// 미배정 분실 / 적용취소 / 폐기 있는 방에서 옮기기 / 초과 거부 / 수령 전 거부 / 합치기.
import {
  aggregateAssets, disposalDenial, disposalDenyOver,
  DISPOSAL_DENY_UNRECEIVED, DISPOSAL_DENY_NONPOSITIVE, DISPOSAL_DENY_ALL_DISPOSED,
  type RawAsset, type DisposalGateRow,
} from '../app/(app)/inventory/assets/aggregate'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fails.push(`${name}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
}

// 행 한 벌 만들기 — 기본은 '수령 완료·살아 있음·앵글밸브 1개'.
let seq = 0
const row = (o: Partial<RawAsset> = {}): RawAsset => ({
  id: `e${++seq}`, date: '2026-09-11', itemLabel: '앵글밸브', amount: 3610,
  qtyValue: 1, qtyUnit: '개', specValue: null, specUnit: null, specText: null,
  category: '수선유지', vendor: '철물점',
  roomId: 'r511', roomNo: '511', locationId: null, locationName: null,
  isCommon: false, received: true, assignedAt: '2026-09-11', isService: false,
  disposedAt: null, disposalReason: null,
  ...o,
})

// ── ① 511호 정상 — 온수·냉수·변기 3자리에 3개. 폐기가 없다 ─────────────
{
  const [c] = aggregateAssets([row(), row(), row()])
  eq('511호 살아 있는 수량', c.qtyValue, 3)
  eq('511호 폐기 수량', c.disposedQty, 0)
  eq('511호 금액', c.amount, 3610 * 3)
  // 폐기가 0이면 화면이 보조줄(`누적 N개`)을 아예 안 준다 — 카드가 한 픽셀도 안 바뀌는 근거.
  eq('511호 폐기 id 없음', c.disposedIds, [])
  eq('511호 폐기 기록 없음', c.disposals.length, 0)
  eq('511호 대표 폐기일 없음', c.disposedAt, null)
}

// ── ② 504호 1교체 — 몇 달 전 것이 막혀 오늘 새것으로 갈았다 ────────────
//    기록은 3개인데 살아 있는 것은 2개. **금액은 3개분 그대로다.**
{
  const rows = [
    row({ itemLabel: '고압호스', amount: 3190, date: '2026-06-02', roomId: 'r504', roomNo: '504' }),
    row({ itemLabel: '고압호스', amount: 3190, date: '2026-06-02', roomId: 'r504', roomNo: '504' }),
    row({ itemLabel: '고압호스', amount: 3190, date: '2026-06-02', roomId: 'r504', roomNo: '504',
      disposedAt: '2026-09-16', disposalReason: '노후·고장으로 교체' }),
  ]
  const [c] = aggregateAssets(rows)
  eq('504호 살아 있는 수량', c.qtyValue, 2)
  eq('504호 폐기 수량', c.disposedQty, 1)
  eq('504호 누적(파생)', (c.qtyValue ?? 0) + c.disposedQty, 3)
  eq('504호 금액은 3개분 그대로', c.amount, 3190 * 3)
  eq('504호 폐기 사유', c.disposals[0].disposalReason, '노후·고장으로 교체')
  // ids 는 **살아 있는 행만**. 폐기 행이 남으면 옮기기·합치기가 죽은 행을 집어 든다.
  eq('504호 ids 는 살아 있는 것만', c.ids.length, 2)
  eq('504호 disposedIds', c.disposedIds.length, 1)
  // 대표 행도 살아 있는 것 — 폐기 행이 대표가 되면 화면 key 와 조작 대상이 죽은 행이 된다.
  eq('504호 대표는 살아 있는 행', c.id, rows[0].id)
  // 구매 내역(breakdown)에는 폐기 행도 남는다 — 돈의 행방이 끊기면 안 된다.
  eq('504호 구매 내역 전부', c.breakdown.length, 3)
  eq('504호 구매 내역 폐기 표시', c.breakdown.filter(b => b.disposed).length, 1)
}

// ── ③ 502호 2철거폐기 — 타일·파이프를 갈며 최근에 단 밸브 2개를 함께 버렸다 ──
//    자리는 3곳이라 숫자만으로는 511호와 구별이 안 된다. 그래서 기록이 필요하다.
{
  const rows = [
    row({ roomId: 'r502', roomNo: '502' }),
    row({ roomId: 'r502', roomNo: '502', date: '2026-07-15', disposedAt: '2026-09-16', disposalReason: '시공 중 철거' }),
    row({ roomId: 'r502', roomNo: '502', date: '2026-07-15', disposedAt: '2026-09-16', disposalReason: '시공 중 철거' }),
  ]
  const [c] = aggregateAssets(rows)
  eq('502호 살아 있는 수량', c.qtyValue, 1)
  eq('502호 폐기 수량', c.disposedQty, 2)
  eq('502호 금액 불변', c.amount, 3610 * 3)
  eq('502호 폐기 기록 두 줄', c.disposals.length, 2)
  // 같은 카드 안에 남는다 — 폐기 여부는 집계 키가 아니다(갈리면 한 품목이 두 카드가 된다).
  eq('502호는 한 카드', aggregateAssets(rows).length, 1)
}

// ── ④ 전량 폐기 — 카드가 사라지면 안 된다. 사라지면 비용 행방이 끊긴다 ───
{
  const items = aggregateAssets([
    row({ disposedAt: '2026-09-16', disposalReason: '파손' }),
    row({ disposedAt: '2026-09-16', disposalReason: '파손' }),
  ])
  eq('전량 폐기도 카드는 남는다', items.length, 1)
  eq('전량 폐기 살아 있는 수량 0', items[0].qtyValue, 0)
  eq('전량 폐기 금액 그대로', items[0].amount, 3610 * 2)
  eq('전량 폐기 ids 비었다', items[0].ids, [])
  // 살아 있는 행이 하나도 없으면 대표는 폐기 행이다(id 가 없으면 화면 key 가 깨진다).
  eq('전량 폐기 대표 id 있음', typeof items[0].id, 'string')
}

// ── ⑤ 미배정 분실 — 여분 10개 중 2개가 없어졌다 ─────────────────────
{
  const [c] = aggregateAssets([
    row({ roomId: null, roomNo: null, assignedAt: null, qtyValue: 8, amount: 28880 }),
    row({ roomId: null, roomNo: null, assignedAt: null, qtyValue: 2, amount: 7220, disposedAt: '2026-09-16', disposalReason: '분실' }),
  ])
  eq('미배정 살아 있는 수량', c.qtyValue, 8)
  eq('미배정 분실 수량', c.disposedQty, 2)
  eq('미배정 금액은 10개분', c.amount, 36100)
  eq('미배정 분실 사유', c.disposals[0].disposalReason, '분실')
}

// ── ⑥ 적용취소 — 표식을 지우면 폐기 전 모양으로 정확히 돌아온다 ─────────
{
  const before = aggregateAssets([row(), row(), row()])[0]
  const disposed = aggregateAssets([row(), row(), row({ disposedAt: '2026-09-16', disposalReason: '파손' })])[0]
  eq('폐기하면 살아 있는 수량이 준다', disposed.qtyValue, 2)
  // 적용취소 = 표식 제거. 수량·금액·폐기 축이 전부 원래대로.
  const undone = aggregateAssets([row(), row(), row()])[0]
  eq('적용취소 뒤 살아 있는 수량', undone.qtyValue, before.qtyValue)
  eq('적용취소 뒤 폐기 수량', undone.disposedQty, 0)
  eq('적용취소 뒤 금액', undone.amount, before.amount)
  eq('폐기해도 금액은 내내 같다', [before.amount, disposed.amount, undone.amount], [10830, 10830, 10830])
}

// ── ⑦ 폐기 있는 방에서 옮기기 — 옮길 수 있는 것은 살아 있는 것뿐 ────────
//    화면의 옮기기는 카드의 ids·breakdown 으로 대상을 고른다. 폐기 행이 거기 남으면
//    "그 구매분 3개" 라고 말해 놓고 서버 초과 거부에 걸린다.
{
  const [c] = aggregateAssets([
    row({ roomId: 'r502', roomNo: '502', date: '2026-07-15' }),
    row({ roomId: 'r502', roomNo: '502', date: '2026-07-15', disposedAt: '2026-09-16', disposalReason: '시공 중 철거' }),
    row({ roomId: 'r502', roomNo: '502', date: '2026-09-11' }),
  ])
  // 클라 buysOf 와 같은 규칙 — 구매분별 수량에서 폐기분을 뺀다.
  const buys = new Map<string, number>()
  for (const b of c.breakdown) { if (b.disposed) continue; buys.set(b.date, (buys.get(b.date) ?? 0) + (b.qty ?? 1)) }
  eq('07-15 구매분에서 옮길 수 있는 수량', buys.get('2026-07-15'), 1)
  eq('09-11 구매분에서 옮길 수 있는 수량', buys.get('2026-09-11'), 1)
  eq('옮기기 대상 합 = 살아 있는 수량', [...buys.values()].reduce((s, n) => s + n, 0), c.qtyValue)
}

// ── ⑧ 초과 거부 — 클램프가 아니라 거부다 ───────────────────────────
{
  const g = (o: Partial<DisposalGateRow> = {}): DisposalGateRow =>
    ({ receivedAt: new Date('2026-09-11'), excludeFromInventory: false, disposedAt: null, qtyValue: 1, qtyUnit: '개', ...o })
  eq('보유 3개에 3개 폐기는 통과', disposalDenial([g(), g(), g()], 3), null)
  eq('보유 3개에 4개 폐기는 거부', disposalDenial([g(), g(), g()], 4), '지금 있는 수량(3개)보다 많아요.')
  eq('거부 문구 정본', disposalDenyOver(3, '개'), '지금 있는 수량(3개)보다 많아요.')
  eq('단위가 다르면 그 단위로 말한다', disposalDenyOver(2.5, 'm'), '지금 있는 수량(2.5m)보다 많아요.')
  eq('전량(null)은 초과가 없다', disposalDenial([g(), g()], null), null)
  eq('0 이하는 거부', disposalDenial([g()], 0), DISPOSAL_DENY_NONPOSITIVE)
  eq('음수도 거부', disposalDenial([g()], -1), DISPOSAL_DENY_NONPOSITIVE)
  // 이미 폐기된 행은 보유량에서 빠진다 — 두 번 버리는 것을 막는다.
  eq('폐기 행은 보유량에 안 센다', disposalDenial([g(), g({ disposedAt: '2026-09-16' })], 2), '지금 있는 수량(1개)보다 많아요.')
  eq('전부 폐기된 묶음은 거부', disposalDenial([g({ disposedAt: '2026-09-16' })], 1), DISPOSAL_DENY_ALL_DISPOSED)
}

// ── ⑨ 수령 전 거부 — 아직 받지도 않은 물건을 버릴 수는 없다 ──────────────
{
  const g = (o: Partial<DisposalGateRow> = {}): DisposalGateRow =>
    ({ receivedAt: new Date('2026-09-11'), excludeFromInventory: false, disposedAt: null, qtyValue: 1, qtyUnit: '개', ...o })
  eq('수령 전 행이 있으면 거부', disposalDenial([g({ receivedAt: null })], 1), DISPOSAL_DENY_UNRECEIVED)
  eq('수령 전이 섞여도 거부', disposalDenial([g(), g({ receivedAt: null })], 1), DISPOSAL_DENY_UNRECEIVED)
  eq('거부 문구 전문', DISPOSAL_DENY_UNRECEIVED, '아직 받지 않은 물건이에요. 주문 취소는 수령 대기에서 하세요.')
  // 서비스·무형(시공비)은 수령 개념이 없다 — 화면의 '수령 대기' 버킷과 같은 축이다.
  eq('서비스는 수령 전이라도 통과', disposalDenial([g({ receivedAt: null, excludeFromInventory: true })], 1), null)
  // 순서 — 전부 폐기된 묶음이 먼저다(수령 여부를 물을 대상 자체가 없다).
  eq('전부 폐기가 수령 판정보다 먼저',
    disposalDenial([g({ receivedAt: null, disposedAt: '2026-09-16' })], 1), DISPOSAL_DENY_ALL_DISPOSED)
}

// ── ⑩ 합치기 — 폐기 행도 같은 이름으로 따라와야 한 카드에 남는다 ─────────
//    단위·이름이 카드 정체성 키라, 폐기분만 옛 값으로 남으면 별도 카드로 갈라져
//    폐기 기록이 원래 카드에서 사라진다.
{
  const merged = aggregateAssets([
    row({ itemLabel: '앵글밸브', qtyUnit: '개' }),
    row({ itemLabel: '앵글밸브', qtyUnit: '개', disposedAt: '2026-09-16', disposalReason: '파손' }),
  ])
  eq('같은 이름·단위면 한 카드', merged.length, 1)
  eq('한 카드의 폐기 수량', merged[0].disposedQty, 1)
  // 폐기 행만 옛 이름으로 남은 모양 — 카드가 둘로 갈라지고 폐기 기록이 본 카드에서 사라진다.
  const split = aggregateAssets([
    row({ itemLabel: '앵글밸브', qtyUnit: '개' }),
    row({ itemLabel: '앵글 밸브', qtyUnit: '개', disposedAt: '2026-09-16', disposalReason: '파손' }),
  ])
  eq('이름이 갈리면 카드가 둘', split.length, 2)
  eq('본 카드는 폐기를 잃는다', split.find(c => c.itemLabel === '앵글밸브')!.disposedQty, 0)
  // 단위가 갈려도 같은 결과다(qtyUnit 도 집계 키).
  const unitSplit = aggregateAssets([
    row({ qtyUnit: '개' }),
    row({ qtyUnit: '세트', disposedAt: '2026-09-16', disposalReason: '파손' }),
  ])
  eq('단위가 갈려도 카드가 둘', unitSplit.length, 2)
}

// ── 무회귀 — 폐기가 하나도 없는 장부는 예전과 한 글자도 같아야 한다 ───────
{
  const rows = [row(), row({ qtyValue: 2, amount: 7220 }), row({ roomId: 'r506', roomNo: '506' })]
  const items = aggregateAssets(rows)
  eq('폐기 없으면 disposedQty 전부 0', items.map(i => i.disposedQty), items.map(() => 0))
  eq('폐기 없으면 ids 가 전 행', items.reduce((s, i) => s + i.ids.length, 0), 3)
  eq('폐기 없으면 disposals 전부 빈 배열', items.every(i => i.disposals.length === 0), true)
  eq('폐기 없으면 breakdown 이 전부 disposed:false', items.every(i => i.breakdown.every(b => !b.disposed)), true)
}

if (fails.length) {
  console.error(`\n[자재 설치·폐기] 통과 ${pass} / 실패 ${fails.length}`)
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
console.log(`[자재 설치·폐기] ${pass}건 통과 — 돈의 축은 안 줄고 물건의 축만 줄어든다`)
