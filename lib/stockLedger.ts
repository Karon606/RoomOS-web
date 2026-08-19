// 재고 원장 리플레이 정본 — 델타 기록(무상 입수)의 날짜·수량·위치가 바뀌면 그 뒤 점검들의
// 저장 잔량을 얼마나 옮겨야 하는지 계산하는 순수 함수. 쿼리 0, DB 접근 0.
//
// 왜 필요한가 (운영자 신고 2026-08-19, 쌀 40kg).
//   StockCheck.remainingQty 는 그 시점 총 잔량의 **절대값**이고 StockCheckLocation.remainingQty 도
//   위치별 절대값이다. 반면 무상 입수(StockAddition)는 델타다. 그래서 8/18 로 잘못 넣은 입고를
//   8/10 으로 고치면, 그 사이 점검(8/12·8/14)의 저장 절대값은 그대로인데 입고만 그 점검들 **앞**으로
//   가버려 잔량 계산(overview.currentStock = 마지막 점검 + 그 이후 델타)에서 통째로 증발한다.
//   즉 지금 구조는 **날짜를 정직하게 정정하는 행위를 처벌한다.** 40kg 이 조용히 사라진다.
//
// 채택한 의미론 — '기록된 소모는 보존하고, 입고 귀속만 옮긴다'.
//   각 점검이 담고 있는 그 구간의 소모(감소분)는 운영자가 실제로 관찰·입력한 사실이므로 보존한다.
//   바뀌는 것은 '이 입고가 그 점검 시점에 이미 들어와 있었는가' 하나뿐이다. 그래서 조정량은
//       shift(C) = (바뀐 뒤 기록이 C 에 반영되면 +수량) − (바뀌기 전 기록이 C 에 반영되면 +수량)
//   이라는 상수 이동이고, 두 세계 모두에서 반영되는 점검은 0 이라 손대지 않는다.
//   실측이 이미 그 입고를 포함한 시점(입고보다 뒤에 센 점검)은 자동으로 대상에서 빠진다.
//
// 안 하는 것.
//   · 자동 적용을 하지 않는다. 이 함수는 '제안'만 만들고 적용 여부는 호출부(운영자 확인)가 정한다.
//   · 전체 보정(isReconcile) 점검에서 멈춘다. 보정은 실측 리셋 선언이라 앞선 기록 변경에
//     흔들리면 안 되고, 그 뒤는 새 기준선이 이미 사실을 흡수했다.
//   · 보충 마커(restockedQty)는 건드리지 않는다. 옮긴 양은 잔량이 아니라 이동량이다.
//   · 음수가 되는 조정은 0 클램프하지 않고 거부한다. 조용한 클램프가 쌀 사건의 원형이다
//     (knowledge/domain-inventory.md '허브 차감 클램프는 조용히 삼킨다').

export const LEDGER_EPS = 1e-6

// 소수 오차 누적 방지 — 저장은 Float 이라 여기서 한 번 정규화한다(표시 반올림과 별개).
const r6 = (x: number): number => Math.round(x * 1e6) / 1e6

export type LedgerCheck = {
  id: string
  dateMs: number         // StockCheck.date (@db.Date = 그 날의 UTC 자정) 의 ms
  createdAtMs: number
  isReconcile: boolean
  total: number          // StockCheck.remainingQty
  hasBreakdown: boolean  // locationBreakdown 행이 하나라도 있는가
  byLoc: { locationId: string; qty: number }[]
}

// 델타 기록(무상 입수). locationId 는 호출부가 이미 허브 폴백까지 해석해 넣는다
// (품목에 열린 위치가 하나도 없으면 null — 그때는 위치 조정 자체가 성립하지 않는다).
export type LedgerDelta = {
  dateMs: number
  createdAtMs: number
  qty: number
  locationId: string | null
}

// 구매 수령 델타(Expense.receivedAt). 경계 술어가 무상 입수와 다르다 —
// 읽기 정본(overview.sumPurchases)이 구매를 receivedAt(실시각) > 점검.createdAt 로 가르므로,
// 반영 여부도 같은 축으로 판정해야 화면 잔량과 조정 계획이 같은 사건 집합을 본다.
// qty 는 품목 단위로 환산된 입수량(specMultiplier 적용 후)을 호출부가 넣는다.
export type PurchaseDelta = {
  receivedAtMs: number
  qty: number
  locationId: string | null
}

export type AnyLedgerDelta = LedgerDelta | PurchaseDelta

function isPurchaseDelta(d: AnyLedgerDelta): d is PurchaseDelta {
  return 'receivedAtMs' in d
}

export type ShiftRow = {
  checkId: string
  dateMs: number
  storedTotal: number
  nextTotal: number
  // storedQty null = 그 점검 breakdown 에 그 위치 행이 없었음(새로 만들어야 함)
  locs: { locationId: string; storedQty: number | null; nextQty: number }[]
}

export type ShiftPlan =
  | { ok: true; rows: ShiftRow[] }
  | { ok: false; code: 'NEGATIVE'; checkId: string; dateMs: number; value: number }
  | { ok: false; code: 'NO_LOCATION'; checkId: string; dateMs: number; value: number }

// 델타가 점검보다 '뒤'인가 — overview.sumAdditions / actions.additionsSinceCheckByLocation 과
// 정확히 같은 경계 규칙(날짜 우선, 같은 날이면 입력 시각). 이 술어가 갈리면 화면 잔량과
// 조정 계획이 서로 다른 사건 집합을 보게 된다.
export function deltaAfterCheck(
  d: { dateMs: number; createdAtMs: number },
  c: { dateMs: number; createdAtMs: number },
): boolean {
  return d.dateMs > c.dateMs || (d.dateMs === c.dateMs && d.createdAtMs > c.createdAtMs)
}

// 구매가 점검보다 '뒤'인가 — overview.sumPurchases(receivedAt > 점검.createdAt)와 같은 경계 규칙.
// 같으면(receivedAt == createdAt) 반영으로 본다(sumPurchases 의 gt 와 동일).
export function purchaseAfterCheck(
  d: { receivedAtMs: number },
  c: { createdAtMs: number },
): boolean {
  return d.receivedAtMs > c.createdAtMs
}

// 그 점검의 저장 잔량이 이 델타를 이미 담고 있는가(= 점검보다 앞이거나 같은 시각).
function reflectedIn(d: AnyLedgerDelta | null, c: LedgerCheck): number {
  if (!d) return 0
  if (isPurchaseDelta(d)) return purchaseAfterCheck(d, c) ? 0 : d.qty
  return deltaAfterCheck(d, c) ? 0 : d.qty
}

// before → after 로 델타 기록이 바뀔 때(생성=before null, 삭제=after null) 점검별 조정 계획.
// 반환 rows 는 조정량이 0 이 아닌 점검만, 날짜 오름차순.
//
// 구매 델타(PurchaseDelta)도 같은 계획을 탄다 — 반영 술어만 다르다(reflectedIn 분기).
// 순회·보정 정지 축은 두 종류 모두 (date, createdAt) 로 같다. 구매 반영은 createdAt 단독 축이라
// 백필 점검(과거 날짜, 최근 입력)이 끼면 두 축이 어긋날 수 있는데, 읽기 정본(overview)이
// 기준선·통계를 날짜 축으로 세우므로 계획도 날짜 축을 따른다(케이스는 회귀 테스트에 박제).
export function planStockShift(
  checks: LedgerCheck[],
  before: AnyLedgerDelta | null,
  after: AnyLedgerDelta | null,
): ShiftPlan {
  const sorted = [...checks].sort((a, b) => a.dateMs - b.dateMs || a.createdAtMs - b.createdAtMs)
  const rows: ShiftRow[] = []
  let stopped = false

  for (const c of sorted) {
    const shift = r6(reflectedIn(after, c) - reflectedIn(before, c))
    if (Math.abs(shift) < LEDGER_EPS) continue      // 두 세계에서 같게 보이는 점검 — 손대지 않는다
    if (stopped) continue                            // 보정 뒤는 새 기준선이 이미 사실을 흡수했다
    if (c.isReconcile) { stopped = true; continue }  // 실측 리셋 선언은 앞선 기록 변경에 안 흔들린다

    const nextTotal = r6(c.total + shift)
    if (nextTotal < -LEDGER_EPS) {
      return { ok: false, code: 'NEGATIVE', checkId: c.id, dateMs: c.dateMs, value: nextTotal }
    }

    const locs: ShiftRow['locs'] = []
    if (c.hasBreakdown) {
      // 총량과 위치합 불변식(actions.transferCheckCreateData 선언)을 지키려면 같은 조정량을
      // 위치에도 얹어야 한다. 귀속 위치를 못 정하면 총량만 옮길 수 없으므로 거부한다.
      const byLocDelta = new Map<string, number>()
      const add = (locId: string | null, q: number) => {
        if (locId == null) return false
        byLocDelta.set(locId, r6((byLocDelta.get(locId) ?? 0) + q))
        return true
      }
      const okAfter = reflectedIn(after, c) === 0 || add(after!.locationId, after!.qty)
      const okBefore = reflectedIn(before, c) === 0 || add(before!.locationId, -before!.qty)
      if (!okAfter || !okBefore) {
        return { ok: false, code: 'NO_LOCATION', checkId: c.id, dateMs: c.dateMs, value: shift }
      }
      for (const [locationId, delta] of byLocDelta) {
        if (Math.abs(delta) < LEDGER_EPS) continue
        const found = c.byLoc.find(l => l.locationId === locationId)
        const storedQty = found ? found.qty : null
        const nextQty = r6((storedQty ?? 0) + delta)
        if (nextQty < -LEDGER_EPS) {
          return { ok: false, code: 'NEGATIVE', checkId: c.id, dateMs: c.dateMs, value: nextQty }
        }
        locs.push({ locationId, storedQty, nextQty })
      }
    }

    rows.push({ checkId: c.id, dateMs: c.dateMs, storedTotal: c.total, nextTotal, locs })
  }

  return { ok: true, rows }
}
