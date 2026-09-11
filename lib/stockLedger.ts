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
  // carried = 이 행에 박을 이월/실측 표식. planCheckPropagation 만 채운다(입수·구매 조정은 판정하지
  //   않으므로 비워 둔다). 값이 그대로여도 표식이 다르면 행으로 나온다 — 표식만 찍는 자리다.
  locs: { locationId: string; storedQty: number | null; nextQty: number; carried?: boolean }[]
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

// 실측이 장부보다 큰가 — '입수 기록 누락 의심' 신호(백로그 4번)의 판정 정본. 안내 전용이고
// 자동 수정은 없다. 장부보다 많이 세어졌다는 것은 수령 확인·무상 입수 기록이 빠졌다는 신호다
// (반대로 적게 세어진 것은 소모라서 정상). 허용 오차는 관용 오차(0.001)와 동일, 반환은
// 표시용 2자리 반올림 초과분. null = 신호 없음.
// ── 점검 입력 해석 — 위치 한 행의 '채우기 전 → 채운 후' ──────────────
//
// 화면 합계·배지·저장·과거 점검 수정·위치별 점검이 전부 이 한 함수를 쓴다(운영자 승인 2026-07-28).
// 규칙이 두 벌이면 화면과 저장이 갈라져 유령 재고가 생긴다(김치 20kg 후속 신고).
//
// 빈칸 해석 (2026-09-01 운영자 확정 — "아무런 숫자를 입력하지 않으면 자동으로 0").
//   · '채우기 전'이 비고 '채운 후'만 있으면 **전 = 0 이다.** 입력칸의 자리표시자가 0 이라
//     말하는데 계산만 직전 잔량을 쓰면, 직전이 남아 있던 위치에서 옮김량이 조용히 줄어
//     허브가 덜 차감된다(전 7 남았다 착각 - 실제로는 다 쓰고 0). 다 쓴 위치에 0 을 손으로
//     쳐야 하는 것도 이 어긋남의 증상이었다.
//   · 안 센 위치는 두 칸 다 빈칸이다 - 이 함수 밖(entered=false)에서 직전값이 보존되므로
//     여기서 0 이 되지 않는다. '세지 않고 그대로'는 옮김 없음 버튼이 직전값을 채워 말한다.
// 음수(후 < 전)는 0 클램프 - 허브 환입 금지(종전 규칙 유지). 직전 잔량(baseline)은 이제
// 계산에 관여하지 않아 서명에서도 뺐다 - 남겨 두면 "무언가에 쓰이나" 하고 다시 잇게 된다.
export function calcLocMove(beforeStr: string, afterStr: string): {
  beforeN: number | null; afterN: number | null; restocked: number
} {
  const beforeN = beforeStr === '' ? null : Number(beforeStr)
  const afterN  = afterStr === '' ? null : Number(afterStr)
  const restocked = (afterN !== null && afterN > (beforeN ?? 0)) ? afterN - (beforeN ?? 0) : 0
  return { beforeN, afterN, restocked }
}

export function overbookExcess(measured: number, book: number): number | null {
  if (!(measured > book + 1e-3)) return null
  const excess = Math.round((measured - book) * 100) / 100
  return excess > 0 ? excess : null
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

// ── 점검 수정의 뒤 점검 전파 (운영자 신고 2026-09-11, 김치) ─────────────────
//
// 증상. 9/10 점검을 나중에 고쳐(4층 상단 4·하단 6) 창고 몫을 나눠 적었는데 9/11 점검이 안 딸려갔다.
// updateStockCheck 이 뒤 점검을 아예 안 보고, 이월 경로(createStockCheck 의 base·carryOver)는
// qty 만 복사해 "이 값이 어디서 왔는가"를 버렸기 때문이다.
//
// 채택 의미론(운영자 승인).
//   · **이월 행은 파생 박제다.** "직전 같은 위치 값 + 사이 입수 − 이번 점검의 허브 차감" 을 저장해
//     둔 것뿐이므로, 앞 점검이 바뀌면 따라간다.
//   · **실측 행만 절대값이다.** 그 위치에서 전파가 멈춘다(그 위치만 — 다른 위치는 계속 간다).
//   · 총량(StockCheck.remainingQty)도 위치 합으로 다시 세운다. overview 가 총량과 위치 행을
//     둘 다 읽어서, 한쪽만 옮기면 화면 두 경로가 갈라진다.
//   · 전체 보정(isReconcile)·위치 내역 없는 점검을 만나면 **전체 정지**. 보정은 실측 리셋 선언이고
//     내역 없는 점검은 위치 축이 없어 이을 자리가 없다(planStockShift 의 정지 규칙과 같은 축).
//   · 음수는 0 클램프가 아니라 거부다. 어느 점검의 어느 위치인지 이름으로 알린다.
//
// 이월/실측 판정. 2026-09-11 부터 쓰는 행은 StockCheckLocation.carried 에 표식이 있다.
// 그 이전 구식 행(null)은 휴리스틱 — 저장값이 "직전 같은 위치 값 + 사이 입수 − 그 점검의 허브 차감"
// 과 같으면 이월로 본다(행이 없으면 값 0). 애매하면 실측으로 보는 쪽이 안전하다(덜 옮긴다).

// 뒤 점검 한 행. carried 는 표식(2026-09-11~), null 은 구식 행(휴리스틱 판정 대상).
export type PropagationLoc = {
  locationId: string
  qty: number
  carried: boolean | null
  restockedQty: number | null
}

export type PropagationCheck = {
  id: string
  dateMs: number
  createdAtMs: number
  isReconcile: boolean
  total: number
  hasBreakdown: boolean
  byLoc: PropagationLoc[]
}

// 수정된 점검의 위치별 절대값(수정 전 / 수정 후). 없는 위치는 0 으로 본다.
export type CheckSnapshot = { locationId: string; qty: number }[]

export type CheckPropagationPlan =
  | { ok: true; rows: ShiftRow[] }
  | { ok: false; code: 'NEGATIVE'; checkId: string; dateMs: number; locationId: string; value: number }

// 두 점검 사이에 들어온 델타(무상 입수 +, 폐기 −)를 위치별로 합산.
// 경계는 정본 deltaAfterCheck — actions.additionsSinceCheckByLocation(이월을 실제로 만드는 코드)과
// 같은 규칙이라야 휴리스틱이 그 이월값을 되짚을 수 있다.
// 알려진 비대칭: 이월 코드는 합이 음수면 0 클램프하는데 여기서는 클램프하지 않는다. 클램프된 행은
// 휴리스틱이 어긋나 실측으로 보이고, 그 위치에서 전파가 멈춘다(보수 방향이라 그대로 둔다).
function deltasBetween(
  deltas: LedgerDelta[],
  from: { dateMs: number; createdAtMs: number },
  to: { dateMs: number; createdAtMs: number },
): Map<string, number> {
  const m = new Map<string, number>()
  for (const d of deltas) {
    if (d.locationId == null) continue
    if (!deltaAfterCheck(d, from)) continue
    if (deltaAfterCheck(d, to)) continue
    m.set(d.locationId, r6((m.get(d.locationId) ?? 0) + d.qty))
  }
  return m
}

export function planCheckPropagation(
  checks: PropagationCheck[],
  editedCheckId: string,
  before: CheckSnapshot,
  after: CheckSnapshot,
  ctx: { hubLocationId: string | null; deltas: LedgerDelta[] },
): CheckPropagationPlan {
  const sorted = [...checks].sort((a, b) => a.dateMs - b.dateMs || a.createdAtMs - b.createdAtMs)
  const at = sorted.findIndex(c => c.id === editedCheckId)
  if (at < 0) return { ok: true, rows: [] }

  const toMap = (s: CheckSnapshot) => new Map(s.map(l => [l.locationId, l.qty]))
  // prevOld = 바뀌기 전 세계의 앞 점검 값, prevNew = 바뀐 뒤 세계의 앞 점검 값.
  let prevOld = toMap(before)
  let prevNew = toMap(after)
  let prev: { dateMs: number; createdAtMs: number } = sorted[at]

  // live = 아직 전파 중인 위치. 값이 안 바뀐 위치도 판정 대상이다 — 옮길 값은 없어도
  // '이 행이 이월인가 실측인가' 라는 판정은 똑같이 서고, 그 판정을 표식으로 박아 두면
  // 다음 수정부터 휴리스틱이 아니라 표식으로 갈린다(운영자 후속 오더 2026-09-11).
  const live = new Set<string>([...prevOld.keys(), ...prevNew.keys()])

  const rows: ShiftRow[] = []
  for (let i = at + 1; i < sorted.length && live.size > 0; i++) {
    const c = sorted[i]
    if (c.isReconcile || !c.hasBreakdown) break   // 전체 정지

    const add = deltasBetween(ctx.deltas, prev, c)
    // 이번 점검의 허브 차감 = **비허브 행의 보충 마커 합**. 허브 자기 점검이 남긴 제 마커는 세지
    // 않는다(그건 차감이 아니라 표시 버그의 흔적 — scripts/fix-hub-restock-marker).
    const hubDeduct = ctx.hubLocationId == null ? 0 : r6(
      c.byLoc.reduce((s, l) => s + (l.locationId === ctx.hubLocationId ? 0 : (l.restockedQty ?? 0)), 0),
    )

    const nextOld = new Map<string, number>()
    const nextNew = new Map<string, number>()
    const locs: ShiftRow['locs'] = []
    const seen = new Set<string>()
    for (const locationId of [...c.byLoc.map(l => l.locationId), ...live]) {
      if (seen.has(locationId)) continue
      seen.add(locationId)
      const row = c.byLoc.find(l => l.locationId === locationId) ?? null
      const storedQty = row ? row.qty : null
      // 바뀌기 전 세계에서 이 점검의 그 위치 값은 저장값 그대로다(우리가 안 건드린 세계).
      nextOld.set(locationId, storedQty ?? 0)
      if (!live.has(locationId)) { nextNew.set(locationId, storedQty ?? 0); continue }

      const dedu = locationId === ctx.hubLocationId ? hubDeduct : 0
      const carriedExpected = r6((prevOld.get(locationId) ?? 0) + (add.get(locationId) ?? 0) - dedu)
      const isCarried = row?.carried === true ? true
        : row?.carried === false ? false
        : Math.abs((storedQty ?? 0) - carriedExpected) < LEDGER_EPS
      if (!isCarried) {
        // 실측 — 그 위치만 정지. 다른 위치는 계속 간다.
        // 값은 그대로 두되 **판정은 표식으로 박는다** — 이 행이 전파가 멈추는 자리라는 사실이
        // 다음 수정 때 다시 휴리스틱으로 추측되지 않도록.
        live.delete(locationId)
        nextNew.set(locationId, storedQty ?? 0)
        if (row != null && row.carried !== false) {
          locs.push({ locationId, storedQty: row.qty, nextQty: row.qty, carried: false })
        }
        continue
      }

      const nextQty = r6((prevNew.get(locationId) ?? 0) + (add.get(locationId) ?? 0) - dedu)
      if (nextQty < -LEDGER_EPS) {
        return { ok: false, code: 'NEGATIVE', checkId: c.id, dateMs: c.dateMs, locationId, value: nextQty }
      }
      nextNew.set(locationId, nextQty)
      if (row == null) {
        if (nextQty <= LEDGER_EPS) continue                       // 없던 행을 0 으로 만들지 않는다
        locs.push({ locationId, storedQty: null, nextQty, carried: true })
        continue
      }
      // 값이 같아도 표식이 다르면 행으로 낸다 — 표식만 찍는 자리다(조용히 넘기지 않는다).
      if (Math.abs(nextQty - row.qty) < LEDGER_EPS && row.carried === true) continue
      locs.push({ locationId, storedQty, nextQty, carried: true })
    }

    if (locs.length > 0) {
      // 총량은 위치 합으로 다시 센다(설계 A) — 행을 안 만드는 0 위치는 0 을 더할 뿐이라 무해.
      let nextTotal = 0
      for (const v of nextNew.values()) nextTotal += v
      rows.push({ checkId: c.id, dateMs: c.dateMs, storedTotal: c.total, nextTotal: r6(nextTotal), locs })
    }
    prevOld = nextOld
    prevNew = nextNew
    prev = c
  }

  return { ok: true, rows }
}
