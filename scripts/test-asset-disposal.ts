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
// 그리고 같은 구매 묶음의 행방 둘(2026-10-10, 신고 3e861137 후속) — ⑬ 구매 내역 행이 묶음 id·배정일을
// 싣는가(상세의 계보 한 줄) ⑭ 재무 지출 목록이 공용부 배정 행을 '미배정'으로 적지 않는가.
import {
  aggregateAssets, disposalDenial, disposalDenyOver,
  DISPOSAL_DENY_UNRECEIVED, DISPOSAL_DENY_NONPOSITIVE, DISPOSAL_DENY_ALL_DISPOSED,
  type RawAsset, type DisposalGateRow,
} from '../app/(app)/inventory/assets/aggregate'
import { roomsLabel, roomChipText } from '../app/(app)/finance/allocPlaceLabel'
import { sameBuyIndex, lineageLine } from '../app/(app)/inventory/assets/lineage'

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
  disposedAt: null, disposalReason: null, allocationGroupId: null,
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

// ── ⑪ 수량 미기록 축 — 집계(?? 0)와 게이트·분할(?? 1)이 갈리던 자리 ─────────
//    장부 검수 2026-09-16. 영수증에 수량이 안 적힌 행은 화면이 `N건` 으로 보여 준다.
//    그때 qtyValue 는 null 인데 서버는 그 행을 **1개로 세서** 쪼갠다. 두 셈이 갈리면
//    "2를 버렸다고 알고 3이 빠지고", 전 행 미기록 카드는 화면 max 가 0 이라 폐기를 못 적는다.
//    그래서 liveUnits·disposedQty 를 게이트와 **같은 셈법**으로 두고 화면이 그것을 쓴다.
{
  const noQty = (o: Partial<RawAsset> = {}) => row({ qtyValue: null, ...o })
  // 전 행 미기록 — 표시는 '수량 미기록'(null)이지만 셀 수 있는 몫은 3이다.
  const [c] = aggregateAssets([noQty(), noQty(), noQty()])
  eq('전 행 미기록이면 qtyValue 는 null', c.qtyValue, null)
  eq('그래도 셀 수 있는 몫은 3', c.liveUnits, 3)
  eq('미기록 카드도 폐기를 적을 수 있다(max>0)', c.liveUnits > 0, true)
  // 게이트도 같은 수를 센다 — 화면 max 와 서버 have 가 어긋나면 안 된다.
  const g = (o: Partial<DisposalGateRow> = {}): DisposalGateRow =>
    ({ receivedAt: new Date('2026-09-11'), excludeFromInventory: false, disposedAt: null, qtyValue: null, qtyUnit: '개', ...o })
  eq('미기록 3행에 3개 폐기는 통과', disposalDenial([g(), g(), g()], 3), null)
  eq('미기록 3행에 4개 폐기는 거부', disposalDenial([g(), g(), g()], 4), '지금 있는 수량(3개)보다 많아요.')
  // 섞인 카드 — 기록 2 + 미기록 1. 게이트가 세는 수는 3이고 liveUnits 도 3이어야 한다.
  const [mix] = aggregateAssets([row({ qtyValue: 2 }), noQty()])
  eq('섞인 카드의 liveUnits', mix.liveUnits, 3)
  eq('섞인 카드의 게이트 수', disposalDenial([g({ qtyValue: 2 }), g()], 3), null)
  eq('섞인 카드는 3을 넘으면 거부', disposalDenial([g({ qtyValue: 2 }), g()], 3.5), '지금 있는 수량(3개)보다 많아요.')
  // 폐기 쪽도 같은 셈법 — 미기록 행 하나를 버리면 1로 센다(0 이면 버린 것이 안 보인다).
  const [d] = aggregateAssets([noQty(), noQty({ disposedAt: '2026-09-16', disposalReason: '분실' })])
  eq('미기록 폐기도 1로 센다', d.disposedQty, 1)
  eq('미기록 카드의 남은 몫', d.liveUnits, 1)
  eq('누적은 둘의 합', d.liveUnits + d.disposedQty, 2)
  eq('미기록이어도 금액은 그대로', d.amount, 3610 * 2)
}

// ── ⑫ liveUnits 는 폐기가 없으면 qtyValue 와 같은 수다 ───────────────────
//    폐기 없는 장부에서 화면이 쓰던 수가 안 바뀐다는 무회귀 확인.
{
  for (const rows of [[row()], [row(), row()], [row({ qtyValue: 2.5 }), row({ qtyValue: 1.5 })]]) {
    const [c] = aggregateAssets(rows)
    eq(`폐기 없으면 liveUnits == qtyValue (${rows.length}행)`, c.liveUnits, c.qtyValue)
  }
}

// ── ⑬ 같은 구매 묶음 — 구매 내역 행이 묶음 id 와 그 조각의 배정일을 싣는가 ─────────
//    고압호스 60cm 9/11 24개 54,000원이 쪼개져 미배정 23개 + 5층 공용 화장실 1개가 됐다(묶음 하나).
//    상세의 계보 한 줄('같은 구매 24개 54,000원 · 여기 23개 · 5층 공용 화장실 1개 (09-16 배정)')은
//    버킷이 다른 두 카드를 묶음 id 로 잇는다. 그 id 와 짝마다의 배정일이 breakdown 에 실려야 한다.
//    카드 단위 assignedAt 은 대표(가장 최근)라 짝이 여럿이면 날이 섞인다.
{
  const G = 'f0727517-0000-4000-8000-000000000000'
  const h = (o: Partial<RawAsset>) => row({ itemLabel: '고압호스', specValue: 60, specUnit: 'cm', date: '2026-09-11', allocationGroupId: G, ...o })
  const [spare] = aggregateAssets([h({ roomId: null, roomNo: null, assignedAt: null, qtyValue: 23, amount: 51750 })])
  const [wc] = aggregateAssets([h({ roomId: null, roomNo: null, locationId: 'loc5', locationName: '5층 공용 화장실', assignedAt: '2026-09-16', qtyValue: 1, amount: 2250 })])
  eq('미배정 행이 묶음 id 를 싣는다', spare.breakdown[0].groupId, G)
  eq('공용부 행이 같은 묶음 id 를 싣는다', wc.breakdown[0].groupId, G)
  eq('미배정 행의 배정일은 null', spare.breakdown[0].assignedAt, null)
  eq('공용부 행의 배정일은 그 조각의 날', wc.breakdown[0].assignedAt, '2026-09-16')
  // 두 카드의 행을 묶음 id 로 모으면 산 그대로가 나온다(돈·수량 모두 폐기 포함 전 행).
  const all = [...spare.breakdown, ...wc.breakdown].filter(b => b.groupId === G)
  eq('묶음 합계 수량 = 산 수량', all.reduce((s, b) => s + (b.qty ?? 1), 0), 24)
  eq('묶음 합계 금액 = 산 금액', all.reduce((s, b) => s + b.amount, 0), 54000)
  // 한 카드 안에서 짝마다 배정일이 다르면 행마다 제 날을 싣는다(대표 하나로 덮지 않는다).
  const [room] = aggregateAssets([
    row({ allocationGroupId: G, assignedAt: '2026-08-06' }),
    row({ allocationGroupId: G, assignedAt: '2026-09-16', date: '2026-09-12' }),
  ])
  eq('행마다 제 배정일', room.breakdown.map(b => b.assignedAt), ['2026-09-16', '2026-08-06'])
  eq('카드 대표 배정일은 그대로 최근', room.assignedAt, '2026-09-16')
  // 폐기된 조각도 묶음에 남는다(합계는 폐기 포함). disposed 표식과 묶음 id 가 함께 실린다.
  const [d] = aggregateAssets([row({ allocationGroupId: G }), row({ allocationGroupId: G, disposedAt: '2026-09-16', disposalReason: '파손' })])
  eq('폐기 조각도 묶음 id 를 싣는다', d.breakdown.filter(b => b.disposed).map(b => b.groupId), [G])
  // 묶음 없는 행은 null — 화면이 계보 줄을 안 세워 그 행이 한 픽셀도 안 바뀌는 근거.
  const [plain] = aggregateAssets([row(), row()])
  eq('묶음 없는 행은 groupId null', plain.breakdown.map(b => b.groupId), [null, null])
  eq('묶음 id 는 집계 키가 아니다(한 카드)', aggregateAssets([row({ allocationGroupId: G }), row()]).length, 1)
}

// ── ⑭ 재무 지출 목록의 방별 분배 라벨 — 방, 공용부, 진짜 미배정 순 ──────────────
//    종전에는 방 축만 알아 공용부 배정 행을 '미배정'으로 적었다. 고압호스 60cm 9/11 묶음이
//    재무에서 `미배정` 칩으로 읽혀 5층 공용 화장실 1개의 행방이 흐려졌다.
{
  const r = (roomNo: string | null, loc: string | null = null, qtyValue: number | null = 1, qtyUnit: string | null = '개') =>
    ({ room: roomNo ? { roomNo } : null, assignedLocationName: loc, qtyValue, qtyUnit })
  // 방만 — 종전과 한 글자도 같아야 한다.
  eq('방만 칩', roomChipText([r('501'), r('502')]), '방 2개')
  eq('방만 라벨', roomsLabel([r('501'), r('502')]), '501호·502호')
  eq('방 넷이면 외 N곳', roomsLabel([r('501'), r('502'), r('503'), r('504')]), '501호·외 3곳')
  eq('사무실은 호를 안 붙인다', roomsLabel([r('사무실')]), '사무실')
  // 공용부만 — 미배정이 아니다.
  eq('공용부만 칩', roomChipText([r(null, '5층 공용 화장실')]), '공용부 1곳')
  eq('공용부만 라벨', roomsLabel([r(null, '5층 공용 화장실')]), '5층 공용 화장실')
  // 섞임 — 방, 공용부, 미배정 순. 고압호스 60cm 9/11 묶음의 모양.
  eq('공용부 + 미배정 칩', roomChipText([r(null, null, 23), r(null, '5층 공용 화장실')]), '공용부 1곳')
  eq('공용부 + 미배정 라벨', roomsLabel([r(null, null, 23), r(null, '5층 공용 화장실')]), '5층 공용 화장실·미배정 23개')
  eq('방 + 공용부 칩은 방 수', roomChipText([r('502', null, 2), r(null, '5층 공용 화장실'), r('511', null, 2)]), '방 2개')
  eq('방 + 공용부 라벨은 방이 먼저', roomsLabel([r(null, '5층 공용 화장실'), r('502', null, 2), r('511', null, 2)]), '502호·511호·5층 공용 화장실')
  // 접기는 방에만 건다. 공용부는 늘 이름으로 뒤에 선다(7/20 묶음 — 칩 `방 3개`와 자리 수가 맞는다).
  eq('방 셋 + 공용부는 안 접는다', roomsLabel([r('502'), r(null, '5층 공용 화장실'), r('511'), r('504')]), '502호·511호·504호·5층 공용 화장실')
  eq('방이 넷이면 방만 접고 공용부는 이름으로', roomsLabel([r('501'), r('502'), r(null, '5층 공용 화장실'), r('503'), r('504')]), '501호·외 3곳·5층 공용 화장실')
  // 방이 있는 행은 공용부 이름이 있어도 방으로 센다(방이 먼저다).
  eq('방이 있으면 방으로', roomsLabel([r('502', '5층 공용 화장실')]), '502호')
  // 진짜 미배정 — 방도 공용부도 없는 행만.
  eq('진짜 미배정 칩', roomChipText([r(null), r(null)]), '미배정')
  eq('진짜 미배정 라벨은 수량과 함께', roomsLabel([r(null, null, 3), r(null, null, 1)]), '미배정 4개')
  eq('수량 없는 미배정', roomsLabel([r(null, null, null, null)]), '미배정')
  eq('같은 공용부 두 행은 한 곳', roomChipText([r(null, '창고'), r(null, '창고')]), '공용부 1곳')
}

// ── ⑮ 계보 한 줄 — 짝을 행이 아니라 카드로 접는다(2026-10-10 디자이너 패스 후속, 운영자 승인) ──────
//    행 단위로 늘어놓으면 같은 자리가 한 줄에 두 번 섰다(`504호 1개 (09-16 폐기) · 504호 1개 (06-30 배정)`).
//    지금 카드의 행은 `여기` 하나로, 다른 카드는 카드마다 한 토막. 날짜는 형제 블록과 같은 YY-MM-DD.
{
  const G = 'a1b2c3d4-0000-4000-8000-000000000000'
  const ctx = {
    placeOf: (x: { roomNo: string | null; locationName: string | null }) => (x.roomNo ? `${x.roomNo}호` : x.locationName ?? '미배정(여분)'),
    isPending: () => false,
    won: (n: number) => `${n.toLocaleString('en-US')}원`,
    fmtQty: (n: number) => String(n),
  }
  const hose = (o: Partial<RawAsset>) => row({ itemLabel: '고압호스', specValue: 60, specUnit: 'cm', amount: 2250, allocationGroupId: G, ...o })
  const card = (rows: RawAsset[]) => aggregateAssets(rows)[0]

  // 고압호스 9/11 — 미배정 23개 + 5층 공용 화장실 1개.
  const spare = card([hose({ roomId: null, roomNo: null, assignedAt: null, qtyValue: 23, amount: 51750 })])
  const wc = card([hose({ roomId: null, roomNo: null, locationId: 'loc5', locationName: '5층 공용 화장실', assignedAt: '2026-09-16' })])
  let idx = sameBuyIndex([spare, wc])
  eq('미배정 카드에서 본 9/11 묶음', lineageLine(idx.get(G), spare.id, ctx), '같은 구매 24개 54,000원 · 여기 23개 · 5층 공용 화장실 1개 (26-09-16 배정)')
  eq('공용부 카드에서 본 9/11 묶음', lineageLine(idx.get(G), wc.id, ctx), '같은 구매 24개 54,000원 · 여기 1개 · 미배정(여분) 23개')

  // 504호 — 같은 묶음 두 행(살아 있는 1, 9/16 폐기 1)이 한 카드. 같은 자리는 한 토막이고 폐기는 쉼표 뒤 부기.
  const r402 = card([hose({ roomId: 'r402', roomNo: '402', qtyValue: 2, amount: 4500, assignedAt: '2026-06-25' })])
  const r504 = card([
    hose({ roomId: 'r504', roomNo: '504', assignedAt: '2026-06-30' }),
    hose({ roomId: 'r504', roomNo: '504', assignedAt: '2026-06-30', disposedAt: '2026-09-16', disposalReason: '교체' }),
  ])
  const r519 = card([hose({ roomId: 'r519', roomNo: '519', qtyValue: 2, amount: 4500, assignedAt: '2026-07-23' })])
  idx = sameBuyIndex([r402, r504, r519])
  eq('504호 카드는 여기에 살아 있는 몫과 폐기를 함께', lineageLine(idx.get(G), r504.id, ctx),
    '같은 구매 6개 13,500원 · 여기 1개, 폐기 1개 (26-09-16) · 402호 2개 (26-06-25 배정) · 519호 2개 (26-07-23 배정)')
  eq('다른 카드에서 본 504호는 한 토막', lineageLine(idx.get(G), r402.id, ctx),
    '같은 구매 6개 13,500원 · 여기 2개 · 504호 1개 (26-06-30 배정), 폐기 1개 (26-09-16) · 519호 2개 (26-07-23 배정)')

  // 한 카드 안에서 배정일이 갈리면 날짜를 안 쓴다(대표 하나를 골라 지어내지 않는다).
  const r502 = card([hose({ roomId: 'r502', roomNo: '502', assignedAt: '2026-08-06' }), hose({ roomId: 'r502', roomNo: '502', assignedAt: '2026-09-16', date: '2026-09-12' })])
  idx = sameBuyIndex([spare, r502])
  eq('배정일이 갈린 카드는 날짜 없이 합친다', lineageLine(idx.get(G), spare.id, ctx), '같은 구매 25개 56,250원 · 여기 23개 · 502호 2개')

  // 폐기만 남은 카드 — 다른 카드에서는 `{자리} 폐기 N개`, 그 카드 자신에서는 `여기 폐기 N개`.
  const gone = card([hose({ roomId: 'r503', roomNo: '503', disposedAt: '2026-09-20', disposalReason: '파손' })])
  idx = sameBuyIndex([spare, gone])
  eq('폐기만 남은 짝', lineageLine(idx.get(G), spare.id, ctx), '같은 구매 24개 54,000원 · 여기 23개 · 503호 폐기 1개 (26-09-20)')
  eq('폐기만 남은 지금 카드', lineageLine(idx.get(G), gone.id, ctx), '같은 구매 24개 54,000원 · 여기 폐기 1개 (26-09-20) · 미배정(여분) 23개')
  // 폐기일이 갈리면 폐기 날짜도 안 쓴다.
  const gone2 = card([
    hose({ roomId: 'r503', roomNo: '503', disposedAt: '2026-09-20', disposalReason: '파손' }),
    hose({ roomId: 'r503', roomNo: '503', disposedAt: '2026-09-25', disposalReason: '파손', date: '2026-09-12' }),
  ])
  idx = sameBuyIndex([spare, gone2])
  eq('폐기일이 갈린 짝은 날짜 없이', lineageLine(idx.get(G), spare.id, ctx), '같은 구매 25개 56,250원 · 여기 23개 · 503호 폐기 2개')

  // 수령 대기 짝은 배정일 대신 (수령 대기).
  idx = sameBuyIndex([spare, wc])
  eq('수령 대기 짝', lineageLine(idx.get(G), wc.id, { ...ctx, isPending: (x: { id: string }) => x.id === spare.id }),
    '같은 구매 24개 54,000원 · 여기 1개 · 미배정(여분) 23개 (수령 대기)')

  // 줄이 안 서는 경우 셋. 묶음 없음 · 이 카드뿐(추적할 행방이 없다) · 단위가 섞임.
  eq('묶음이 없으면 줄이 없다', lineageLine(undefined, spare.id, ctx), null)
  idx = sameBuyIndex([r504])
  eq('같은 묶음이 이 카드에만 있으면 줄이 없다', lineageLine(idx.get(G), r504.id, ctx), null)
  const meter = card([hose({ roomId: null, roomNo: null, assignedAt: null, qtyUnit: 'm', qtyValue: 3 })])
  idx = sameBuyIndex([meter, wc])
  eq('단위가 섞이면 줄이 없다', lineageLine(idx.get(G), wc.id, ctx), null)
  // 다른 자리가 둘 이상이고 전부 같은 날 배정됐으면 그 날을 `여기` 뒤에 한 번만(SUS 앵글밸브 15A 17곳 같은 날).
  const a1 = card([hose({ roomId: 'r501', roomNo: '501', assignedAt: '2026-09-16' })])
  const a2 = card([hose({ roomId: 'r502', roomNo: '502', qtyValue: 3, amount: 6750, assignedAt: '2026-09-16' })])
  const a3 = card([hose({ roomId: null, roomNo: null, locationId: 'loc5', locationName: '5층 공용 화장실', qtyValue: 2, amount: 4500, assignedAt: '2026-09-16' })])
  idx = sameBuyIndex([spare, a1, a2, a3])
  eq('다른 자리 셋이 같은 날이면 날짜를 한 번만', lineageLine(idx.get(G), spare.id, ctx),
    '같은 구매 29개 65,250원 · 여기 23개 · 나머지 26-09-16 배정 · 501호 1개 · 502호 3개 · 5층 공용 화장실 2개')
  idx = sameBuyIndex([spare, a1, a2])
  eq('다른 자리 둘이 같은 날이어도 한 번만', lineageLine(idx.get(G), spare.id, ctx),
    '같은 구매 27개 60,750원 · 여기 23개 · 나머지 26-09-16 배정 · 501호 1개 · 502호 3개')
  // 미배정 짝은 배정일이 없는 게 정상이라 판정에서 빠지고 `나머지` 앞에 선다(앵글밸브를 방 카드에서 볼 때).
  idx = sameBuyIndex([spare, a1, a2, a3])
  eq('미배정 짝은 나머지 앞에, 방·공용부만 날짜 판정', lineageLine(idx.get(G), a1.id, ctx),
    '같은 구매 29개 65,250원 · 여기 1개 · 미배정(여분) 23개 · 나머지 26-09-16 배정 · 502호 3개 · 5층 공용 화장실 2개')
  // 방인데 배정일이 빈 카드(418호)가 있으면 접지 않는다 — 그 날 배정이라고 지어내지 않는다.
  const a4 = card([hose({ roomId: 'r418', roomNo: '418', qtyValue: 2, amount: 4500, assignedAt: null })])
  idx = sameBuyIndex([spare, a1, a2, a4])
  eq('배정일 빈 방이 섞이면 안 접는다', lineageLine(idx.get(G), spare.id, ctx),
    '같은 구매 29개 65,250원 · 여기 23개 · 501호 1개 (26-09-16 배정) · 502호 3개 (26-09-16 배정) · 418호 2개')
  // 하나라도 어긋나면 지금 모양 그대로 — 폐기 부기가 있거나 수령 대기가 섞이면 접지 않는다.
  const a1dead = card([hose({ roomId: 'r501', roomNo: '501', assignedAt: '2026-09-16' }), hose({ roomId: 'r501', roomNo: '501', assignedAt: '2026-09-16', disposedAt: '2026-09-20', disposalReason: '파손' })])
  idx = sameBuyIndex([spare, a1dead, a2])
  eq('폐기 부기가 섞이면 날짜를 안 접는다', lineageLine(idx.get(G), spare.id, ctx),
    '같은 구매 28개 63,000원 · 여기 23개 · 501호 1개 (26-09-16 배정), 폐기 1개 (26-09-20) · 502호 3개 (26-09-16 배정)')
  idx = sameBuyIndex([wc, a1, a2])
  eq('수령 대기가 섞이면 날짜를 안 접는다', lineageLine(idx.get(G), wc.id, { ...ctx, isPending: (x: { id: string }) => x.id === a2.id }),
    '같은 구매 5개 11,250원 · 여기 1개 · 501호 1개 (26-09-16 배정) · 502호 3개 (수령 대기)')
  // 수량 미기록 행은 1로 센다(liveUnits·게이트·분할과 같은 셈법).
  const blank = card([hose({ roomId: 'r511', roomNo: '511', qtyValue: null, assignedAt: '2026-09-16' })])
  idx = sameBuyIndex([spare, blank])
  eq('수량 미기록 짝은 1로', lineageLine(idx.get(G), spare.id, ctx), '같은 구매 24개 54,000원 · 여기 23개 · 511호 1개 (26-09-16 배정)')
}

if (fails.length) {
  console.error(`\n[자재 설치·폐기] 통과 ${pass} / 실패 ${fails.length}`)
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
console.log(`[자재 설치·폐기] ${pass}건 통과 — 돈의 축은 안 줄고 물건의 축만 줄어든다`)
