// #3 위치별 재고 점검 — 허브 자동 차감 + 이월을 "현재 상태(base)" 기준으로 적용하는 순수함수.
// 기존엔 클라이언트가 props의 직전 점검값으로 계산해, 6시간 머지(연속 위치 점검) 시 그 값이 stale하면
// 허브를 잘못된 기준에서 다시 빼서 과다 차감 + 앞 점검을 덮어쓰는 버그가 있었다.
// → 서버가 DB의 현재 breakdown을 base로 이 함수에 넘겨 적용하면 stale이 원천 차단된다.

// restockedQty(선택): base가 '같은 점검 행의 현재 상태'일 때 기존 보충 마커. 머지 시 비점검 위치의
// +N 마커가 지워지던 버그(신고 8319ba10) 방지용 — 새 점검 생성 base(전날 점검)는 넣지 않아 이월 안 됨.
export type LocBreakdown = { locationId: string; qty: number; restockedQty?: number | null }
export type LocCheckPatch = {
  checkedLocationId: string   // 이번에 점검한 위치
  afterQty: number            // 보충 후 잔량(실측)
  restockedQty: number        // 보충량(후-전), 0이면 보충 없음
  hubLocationId: string | null
}
export type LocQtyOut = { storageLocationId: string; qty: number; restockedQty?: number }

// base(머지 대상 점검의 현재 상태 또는 직전 점검)에 한 위치 점검을 적용:
//  - 점검 위치 qty = afterQty (+ restockedQty 마커, 같은 위치 재점검은 마지막 값으로 덮어씀)
//  - 비허브 위치에 보충(restockedQty>0)이면 허브 위치 qty에서 그만큼 자동 차감(0 미만 방지)
//  - 그 외 위치는 현재 값 그대로 이월 — 기존 보충 마커 포함(같은 날 연속 위치 점검이 앞 위치의 +N을 지우던 신고 8319ba10)
export function applyLocationCheck(base: LocBreakdown[], patch: LocCheckPatch): LocQtyOut[] {
  const isHubChecked = patch.hubLocationId != null && patch.checkedLocationId === patch.hubLocationId
  const out: LocQtyOut[] = []
  let hasChecked = false
  const keepMarker = (lb: LocBreakdown) => (lb.restockedQty != null && lb.restockedQty > 0 ? { restockedQty: lb.restockedQty } : {})
  for (const lb of base) {
    if (lb.locationId === patch.checkedLocationId) {
      hasChecked = true
      out.push({ storageLocationId: lb.locationId, qty: patch.afterQty, ...(patch.restockedQty > 0 ? { restockedQty: patch.restockedQty } : {}) })
    } else if (!isHubChecked && patch.restockedQty > 0 && patch.hubLocationId && lb.locationId === patch.hubLocationId) {
      out.push({ storageLocationId: lb.locationId, qty: Math.max(0, lb.qty - patch.restockedQty), ...keepMarker(lb) })
    } else {
      out.push({ storageLocationId: lb.locationId, qty: lb.qty, ...keepMarker(lb) })
    }
  }
  // base에 점검 위치가 없으면 추가 (그 위치 첫 점검)
  if (!hasChecked) {
    out.push({ storageLocationId: patch.checkedLocationId, qty: patch.afterQty, ...(patch.restockedQty > 0 ? { restockedQty: patch.restockedQty } : {}) })
  }
  return out
}

export function totalQty(locs: { qty: number }[]): number {
  return locs.reduce((s, l) => s + l.qty, 0)
}

// 허브 부족 감지(순수) — 비허브 보충량이 허브 잔량을 넘어 조용히 0 클램프될 상황을 잡아낸다(쌀 사건).
// applyLocationCheck 의 자동 차감 조건(비허브·보충>0·허브 지정)과 정확히 같은 게이트에서만 판정한다.
// others 는 base 에서 허브·점검 위치를 뺀 잔량 보유 위치(이동 출처 후보). 이름은 서버가 채운다.
export type HubShort = {
  code: 'HUB_SHORT'
  hubLocationId: string
  hubQty: number
  shortfall: number
  others: { locationId: string; qty: number }[]
}
const HUB_SHORT_EPS = 1e-6
export function detectHubShort(base: LocBreakdown[], patch: LocCheckPatch, allowHubClamp?: boolean): HubShort | null {
  if (allowHubClamp) return null
  const isHubChecked = patch.hubLocationId != null && patch.checkedLocationId === patch.hubLocationId
  if (isHubChecked || !patch.hubLocationId || !(patch.restockedQty > 0)) return null
  const hubQty = base.find(lb => lb.locationId === patch.hubLocationId)?.qty ?? 0
  if (patch.restockedQty <= hubQty + HUB_SHORT_EPS) return null
  const others = base
    .filter(lb => lb.locationId !== patch.hubLocationId && lb.locationId !== patch.checkedLocationId && lb.qty > 0)
    .map(lb => ({ locationId: lb.locationId, qty: lb.qty }))
  return { code: 'HUB_SHORT', hubLocationId: patch.hubLocationId, hubQty, shortfall: patch.restockedQty - hubQty, others }
}
