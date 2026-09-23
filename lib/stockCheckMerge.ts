// #3 위치별 재고 점검 — 허브 자동 차감 + 이월을 "현재 상태(base)" 기준으로 적용하는 순수함수.
// 기존엔 클라이언트가 props의 직전 점검값으로 계산해, 6시간 머지(연속 위치 점검) 시 그 값이 stale하면
// 허브를 잘못된 기준에서 다시 빼서 과다 차감 + 앞 점검을 덮어쓰는 버그가 있었다.
// → 서버가 DB의 현재 breakdown을 base로 이 함수에 넘겨 적용하면 stale이 원천 차단된다.

// restockedQty(선택): base가 '같은 점검 행의 현재 상태'일 때 기존 보충 마커. 머지 시 비점검 위치의
// +N 마커가 지워지던 버그(신고 8319ba10) 방지용 — 새 점검 생성 base(전날 점검)는 넣지 않아 이월 안 됨.
// carried(선택): 같은 규칙이다. base 가 '같은 점검 행의 현재 상태'일 때 기존 이월/실측 표식.
// 없으면(undefined) base 가 다른 점검에서 온 것이라 이번 점검의 비점검 행은 전부 이월이다.
export type LocBreakdown = { locationId: string; qty: number; restockedQty?: number | null; carried?: boolean | null }
export type LocCheckPatch = {
  checkedLocationId: string   // 이번에 점검한 위치
  afterQty: number            // 보충 후 잔량(실측)
  restockedQty: number        // 보충량(후-전), 0이면 보충 없음
  hubLocationId: string | null
}
// carried — 이월/실측 표식(2026-09-11). 점검한 위치만 실측(false)이고 나머지는 전부 이월(true)이다.
// 허브 자동 차감 행도 이월이다 — 그 값은 실측이 아니라 '허브 이전 − 보충합' 파생값이다
// (knowledge/domain-inventory.md '허브 칸은 파생값이고 주방 칸이 유일한 실측이다').
export type LocQtyOut = { storageLocationId: string; qty: number; restockedQty?: number; carried?: boolean | null }

// base(머지 대상 점검의 현재 상태 또는 직전 점검)에 한 위치 점검을 적용:
//  - 점검 위치 qty = afterQty (+ restockedQty 마커, 같은 위치 재점검은 마지막 값으로 덮어씀)
//  - 비허브 위치에 보충(restockedQty>0)이면 허브 위치 qty에서 그만큼 자동 차감(0 미만 방지)
//  - 그 외 위치는 현재 값 그대로 이월 — 기존 보충 마커 포함(같은 날 연속 위치 점검이 앞 위치의 +N을 지우던 신고 8319ba10)
//
// **비점검 행의 carried 는 무조건 true 가 아니라 승계다**(2026-09-14). 종전에는 여기서 true 를 박아,
// 같은 날 연속 위치 점검의 두 번째 머지가 앞 위치의 실측 표식(false)을 이월로 뒤집었다(4층 주방 다음
// 5층 주방을 점검하자 4층 6품목의 실측이 이월이 된 사고). 뒤집힌 행은 전파가 덮어써도 되는 행으로
// 보여 실측값이 조용히 사라진다. 규칙은 restockedQty 와 정확히 같다 — base 가 '같은 점검의 현재 상태'
// 면 그 행이 이미 가진 표식을 그대로 들고 가고, base 가 다른 점검(직전 점검)에서 왔으면 표식이 없어
// (undefined) 전부 이월(true)이다. 그래서 호출부도 같은 비대칭을 지킨다 — updateStockCheck 의 base 만
// carried 를 싣고 createStockCheck 의 base(직전 점검)는 싣지 않는다.
// **null 은 null 로 남긴다.** null 은 '표식 이전 구식 행'이라 모르는 것이고, true 로 접으면 모르는 것을
// '파생이다'로 단정하는 것이다. planCheckPropagation(lib/stockLedger)이 null 에만 걸어 둔 휴리스틱
// (저장값이 파생식과 같은가)이 그 순간 무력화된다.
// **허브 자기 점검에는 마커를 붙이지 않는다**(2026-09-11 김치). 보충 마커는 '창고에서 이 위치로
// 옮긴 양'이라 허브 자신에게는 뜻이 없다. 그런데 위치 패널의 허브 칸이 '채운 후'에 묶여 있어
// 후−전 = +17 이 보충으로 셈해졌고, 그 값이 허브 행에 마커로 박혀 이월 판정을 통째로 흔들었다.
// 화면 쪽(입력칸을 '전'으로)과 여기 두 겹으로 막는다 — 한쪽만 막으면 다른 경로로 다시 들어온다.
export function applyLocationCheck(base: LocBreakdown[], patch: LocCheckPatch): LocQtyOut[] {
  const isHubChecked = patch.hubLocationId != null && patch.checkedLocationId === patch.hubLocationId
  const out: LocQtyOut[] = []
  let hasChecked = false
  const keepMarker = (lb: LocBreakdown) => (lb.restockedQty != null && lb.restockedQty > 0 ? { restockedQty: lb.restockedQty } : {})
  const checkedMarker = (patch.restockedQty > 0 && !isHubChecked) ? { restockedQty: patch.restockedQty } : {}
  for (const lb of base) {
    if (lb.locationId === patch.checkedLocationId) {
      hasChecked = true
      out.push({ storageLocationId: lb.locationId, qty: patch.afterQty, ...checkedMarker, carried: false })
    } else if (!isHubChecked && patch.restockedQty > 0 && patch.hubLocationId && lb.locationId === patch.hubLocationId) {
      out.push({ storageLocationId: lb.locationId, qty: Math.max(0, lb.qty - patch.restockedQty), ...keepMarker(lb), carried: lb.carried === undefined ? true : lb.carried })
    } else {
      out.push({ storageLocationId: lb.locationId, qty: lb.qty, ...keepMarker(lb), carried: lb.carried === undefined ? true : lb.carried })
    }
  }
  // base에 점검 위치가 없으면 추가 (그 위치 첫 점검)
  if (!hasChecked) {
    out.push({ storageLocationId: patch.checkedLocationId, qty: patch.afterQty, ...checkedMarker, carried: false })
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
// 부동소수 허용오차. **화면도 이 상수를 쓴다**(InventoryClient 의 창고 잔량 예고).
// 2.2 - 1.2 = 1.0000000000000002 같은 값 때문에 화면만 -2e-16 을 부족으로 읽으면,
// 서버는 저장하는데 화면은 붉게 '0kg 부족' 이라고 말한다. 둘이 갈리면 화면이 거짓말을 한다.
export const HUB_SHORT_EPS = 1e-6
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

// 여러 위치를 한 번에 적용(순수) — 아이템별 점검 폼의 원자 저장이 쓴다(2026-09-15 운영자 결정 (c)).
//
// 왜 접기인가. 위치 패널(경로 A)은 (품목, 위치) 쌍마다 서버를 한 번씩 부르고 그 결과 위에 다음
// 쌍을 얹는다. 아이템별 폼은 한 품목의 여러 칸을 **한 번에** 보내므로, 그 '얹기'를 서버 안에서
// 그대로 반복해야 두 화면의 장부가 한 글자도 안 갈린다. 그래서 여기서 하는 일은 패널이 왕복으로
// 하던 것과 정확히 같다 — 패치마다 detectHubShort 로 게이트를 지나고 applyLocationCheck 로 접는다.
//
// 표식(carried)이 저절로 맞는 이유. 첫 패치의 base 는 직전 점검이라 표식이 없고(undefined),
// 그래서 비점검 행은 전부 이월(true)로 찍힌다. 두 번째 패치부터는 base 가 '이 점검의 현재 상태'라
// 앞 패치가 남긴 실측(false)·마커를 승계한다 — updateStockCheck 의 base 와 같은 자리가 된다.
// 결과적으로 안 적은 행 true / 적은 행 false / 허브 미입력 + 옮김 있음은 차감된 파생 true /
// 허브를 적었으면 그 패치가 마지막에 덮어 false 다.
//
// **순서와 중복은 여기서 지킨다**(검수 지적 2026-09-16). 종전에는 '허브를 맨 뒤로' 를 호출부의
// 예의에 맡겼는데, 그 규칙은 장부의 정합 조건이지 취향이 아니다 — 허브를 먼저 쓰면 그 실측 위에서
// 다시 차감돼 이중으로 빠진다. 안정 정렬로 허브 패치만 맨 뒤로 밀고(나머지 순서는 받은 그대로),
// 같은 위치가 두 번 오면 **거부**한다. 중복은 마지막 값으로 덮는 것이 자연스러워 보이지만, 앞의
// 패치가 이미 허브를 깎은 뒤라 뒤엣것이 덮어도 그 차감은 남는다 — 조용히 틀리느니 막는다.
//
// 원자성. 한 패치라도 허브 부족에 걸리면 **몇 번째 패치**인지를 실어 돌려주고 아무것도 내지 않는다.
// 부분 반영으로 끝나면 화면은 '저장됨'인데 장부는 절반이 되고, 그 절반이 다음 base 가 된다.
// index 는 **정렬한 뒤의 자리**다 — 호출부가 그 자리의 위치 이름을 말하려면 같은 정렬을 본 배열이
// 필요하므로, 정렬 결과를 `patches` 로 함께 돌려준다.
export type LocChecksResult =
  | { ok: true; out: LocQtyOut[]; patches: LocCheckPatch[] }
  | { ok: false; index: number; short: HubShort; patches: LocCheckPatch[] }
  | { ok: false; duplicate: string }
export function applyLocationChecks(base: LocBreakdown[], patches: LocCheckPatch[], allowHubClamp?: boolean): LocChecksResult {
  const seen = new Set<string>()
  for (const p of patches) {
    if (seen.has(p.checkedLocationId)) return { ok: false, duplicate: p.checkedLocationId }
    seen.add(p.checkedLocationId)
  }
  // 안정 정렬 — 허브 자기 점검만 맨 뒤로. Array.prototype.sort 가 안정이라 나머지는 받은 순서 그대로다.
  const ordered = [...patches].sort((a, b) => {
    const ah = a.hubLocationId != null && a.checkedLocationId === a.hubLocationId ? 1 : 0
    const bh = b.hubLocationId != null && b.checkedLocationId === b.hubLocationId ? 1 : 0
    return ah - bh
  })
  let cur: LocBreakdown[] = base
  // 패치가 0건이면 접을 것이 없다 — 그때의 결과는 '전부 이월'이다(한 행도 실측이 아니다).
  let out: LocQtyOut[] = base.map(lb => ({
    storageLocationId: lb.locationId, qty: lb.qty,
    ...(lb.restockedQty != null && lb.restockedQty > 0 ? { restockedQty: lb.restockedQty } : {}),
    carried: lb.carried === undefined ? true : lb.carried,
  }))
  for (let i = 0; i < ordered.length; i++) {
    const short = detectHubShort(cur, ordered[i], allowHubClamp)
    if (short) return { ok: false, index: i, short, patches: ordered }
    out = applyLocationCheck(cur, ordered[i])
    // 다음 패치의 base = 이 패치까지 반영된 현재 상태. 마커·표식을 그대로 들고 간다.
    cur = out.map(o => ({ locationId: o.storageLocationId, qty: o.qty, restockedQty: o.restockedQty ?? null, carried: o.carried ?? null }))
  }
  return { ok: true, out, patches: ordered }
}
