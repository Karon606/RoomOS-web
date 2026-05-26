// #3 위치별 재고 점검 — 허브 자동 차감 + 이월을 "현재 상태(base)" 기준으로 적용하는 순수함수.
// 기존엔 클라이언트가 props의 직전 점검값으로 계산해, 6시간 머지(연속 위치 점검) 시 그 값이 stale하면
// 허브를 잘못된 기준에서 다시 빼서 과다 차감 + 앞 점검을 덮어쓰는 버그가 있었다.
// → 서버가 DB의 현재 breakdown을 base로 이 함수에 넘겨 적용하면 stale이 원천 차단된다.

export type LocBreakdown = { locationId: string; qty: number }
export type LocCheckPatch = {
  checkedLocationId: string   // 이번에 점검한 위치
  afterQty: number            // 보충 후 잔량(실측)
  restockedQty: number        // 보충량(후-전), 0이면 보충 없음
  hubLocationId: string | null
}
export type LocQtyOut = { storageLocationId: string; qty: number; restockedQty?: number }

// base(머지 대상 점검의 현재 상태 또는 직전 점검)에 한 위치 점검을 적용:
//  - 점검 위치 qty = afterQty (+ restockedQty 마커)
//  - 비허브 위치에 보충(restockedQty>0)이면 허브 위치 qty에서 그만큼 자동 차감(0 미만 방지)
//  - 그 외 위치는 현재 값 그대로 이월
export function applyLocationCheck(base: LocBreakdown[], patch: LocCheckPatch): LocQtyOut[] {
  const isHubChecked = patch.hubLocationId != null && patch.checkedLocationId === patch.hubLocationId
  const out: LocQtyOut[] = []
  let hasChecked = false
  for (const lb of base) {
    if (lb.locationId === patch.checkedLocationId) {
      hasChecked = true
      out.push({ storageLocationId: lb.locationId, qty: patch.afterQty, ...(patch.restockedQty > 0 ? { restockedQty: patch.restockedQty } : {}) })
    } else if (!isHubChecked && patch.restockedQty > 0 && patch.hubLocationId && lb.locationId === patch.hubLocationId) {
      out.push({ storageLocationId: lb.locationId, qty: Math.max(0, lb.qty - patch.restockedQty) })
    } else {
      out.push({ storageLocationId: lb.locationId, qty: lb.qty })
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
