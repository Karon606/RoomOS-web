// 위치 점검 머지 정본(lib/stockCheckMerge applyLocationCheck) 회귀 테스트 — DB 불필요.
// 2026-09-14 사고를 박제한다. 같은 날 4층 주방을 점검한 뒤 5층 주방을 점검하자, 머지가 4층의
// 실측 표식(carried=false)을 이월(true)로 뒤집어 6품목의 실측이 파생 박제로 둔갑했다.
//
// 지키는 계약.
//   · 점검한 위치만 실측(carried=false)이다. 나머지 행의 표식은 **승계**다 — 무조건 true 가 아니다.
//   · base 에 표식이 없으면(undefined) 그 base 는 다른 점검(직전 점검)에서 온 것이라 전부 이월(true).
//     이것이 createStockCheck 의 base 와 맺은 계약이다.
//   · null(표식 이전 구식 행)은 null 로 남는다 — 모르는 것을 '파생이다'로 단정하지 않는다.
//   · 보충 마커(restockedQty)도 같은 규칙으로 이월된다(신고 8319ba10).
//   · 허브 자기 점검에는 보충 마커를 붙이지 않는다(2026-09-11 김치 +17).
//
// 7장부터는 **복수 패치 접기**(applyLocationChecks, 2026-09-15)다. 아이템별 점검 폼이 한 품목의
// 여러 칸을 한 번에 보내는 원자 저장의 정본이고, 규칙은 위치 패널이 왕복으로 하던 것과 같아야 한다.
import { applyLocationCheck, applyLocationChecks, type LocBreakdown, type LocCheckPatch, type LocQtyOut } from '../lib/stockCheckMerge'

let pass = 0
const fails: string[] = []

function eq(label: string, got: unknown, want: unknown) {
  if (Object.is(got, want)) pass++
  else fails.push(`${label}: 기대 ${String(want)} / 실제 ${String(got)}`)
}

// 위치 — H=허브(창고), A=4층 주방, B=5층 주방
const H = 'loc-hub', A = 'loc-4f', B = 'loc-5f'
const rowOf = (out: LocQtyOut[], id: string) => out.find(r => r.storageLocationId === id)
function patch(p: Partial<LocCheckPatch> & { checkedLocationId: string; afterQty: number }): LocCheckPatch {
  return { restockedQty: 0, hubLocationId: H, ...p }
}

// ── 1. 앞 위치의 실측 표식은 뒤 위치 점검에도 남는다 (핵심 — 2026-09-14 사고) ──────
// 4층을 실측 3.5 로 찍어 둔 base 에 5층 점검을 머지한다. 4층은 여전히 실측이어야 한다.
{
  const base: LocBreakdown[] = [
    { locationId: H, qty: 12, carried: true },
    { locationId: A, qty: 3.5, carried: false },
    { locationId: B, qty: 1, carried: true },
  ]
  const out = applyLocationCheck(base, patch({ checkedLocationId: B, afterQty: 2.5 }))
  eq('앞 위치 실측 보존: 4층 표식', rowOf(out, A)?.carried, false)
  eq('앞 위치 실측 보존: 4층 잔량 불변', rowOf(out, A)?.qty, 3.5)
  eq('앞 위치 실측 보존: 5층은 이번 실측', rowOf(out, B)?.carried, false)
  eq('앞 위치 실측 보존: 5층 잔량은 잰 값', rowOf(out, B)?.qty, 2.5)
  eq('앞 위치 실측 보존: 허브는 이월 유지', rowOf(out, H)?.carried, true)
  eq('앞 위치 실측 보존: 허브 잔량 불변(보충 0)', rowOf(out, H)?.qty, 12)
}

// ── 2. 허브 가지도 승계다 ───────────────────────────────────────────────
// 허브를 먼저 실측(carried=false)해 둔 뒤 5층을 보충하면 허브는 자동 차감되지만,
// 표식까지 이월로 뒤집으면 방금 센 허브 실측이 전파의 덮어쓰기 대상이 된다.
{
  const base: LocBreakdown[] = [
    { locationId: H, qty: 10, carried: false },
    { locationId: B, qty: 1, carried: true },
  ]
  const out = applyLocationCheck(base, patch({ checkedLocationId: B, afterQty: 5, restockedQty: 4 }))
  eq('허브 가지 승계: 허브 표식', rowOf(out, H)?.carried, false)
  eq('허브 가지 승계: 허브 자동 차감', rowOf(out, H)?.qty, 6)
  eq('허브 가지 승계: 5층 실측', rowOf(out, B)?.carried, false)
  eq('허브 가지 승계: 5층 잔량은 잰 값', rowOf(out, B)?.qty, 5)
  eq('허브 가지 승계: 5층 보충 마커', rowOf(out, B)?.restockedQty, 4)
}

// ── 3. base 에 표식이 없으면 비점검 행은 전부 이월 (createStockCheck 계약) ─────────
// 새 점검의 base 는 직전 점검이다. 그 행의 표식은 어제의 사실이라 싣지 않고,
// 없음(undefined) = 오늘 기준 전부 이월로 읽는다.
{
  const base: LocBreakdown[] = [
    { locationId: H, qty: 8 },
    { locationId: A, qty: 2 },
    { locationId: B, qty: 1.5 },
  ]
  const out = applyLocationCheck(base, patch({ checkedLocationId: A, afterQty: 6, restockedQty: 4 }))
  eq('표식 없는 base: 허브 이월', rowOf(out, H)?.carried, true)
  eq('표식 없는 base: 허브 자동 차감', rowOf(out, H)?.qty, 4)
  eq('표식 없는 base: 비점검 5층 이월', rowOf(out, B)?.carried, true)
  eq('표식 없는 base: 4층 실측', rowOf(out, A)?.carried, false)
  eq('표식 없는 base: 4층 잔량은 잰 값', rowOf(out, A)?.qty, 6)
}

// ── 4. null 은 null 로 남는다 ───────────────────────────────────────────
// 구식 행(표식 이전)이다. true 로 접으면 '모르는 것'을 '파생이다'로 단정하는 것이고,
// planCheckPropagation 이 null 에만 걸어 둔 휴리스틱이 그 순간 무력화된다.
{
  const base: LocBreakdown[] = [
    { locationId: H, qty: 9, carried: null },
    { locationId: A, qty: 2, carried: null },
    { locationId: B, qty: 1, carried: true },
  ]
  const out = applyLocationCheck(base, patch({ checkedLocationId: B, afterQty: 4, restockedQty: 3 }))
  eq('null 보존: 허브 표식', rowOf(out, H)?.carried, null)
  eq('null 보존: 허브 자동 차감은 그대로', rowOf(out, H)?.qty, 6)
  eq('null 보존: 비점검 4층 표식', rowOf(out, A)?.carried, null)
  eq('null 보존: 5층은 실측', rowOf(out, B)?.carried, false)
}

// ── 5. 점검 행은 언제나 실측 · 허브 자기 점검엔 마커 없음 ───────────────────
{
  // base 에 없던 위치를 처음 점검 — 새 행도 실측이다.
  const out = applyLocationCheck([{ locationId: H, qty: 7, carried: true }], patch({ checkedLocationId: A, afterQty: 2.5 }))
  eq('첫 점검 행: 실측 표식', rowOf(out, A)?.carried, false)
  eq('첫 점검 행: 잰 값', rowOf(out, A)?.qty, 2.5)
  eq('첫 점검 행: 허브는 이월', rowOf(out, H)?.carried, true)

  // 허브 자기 점검 — 창고에서 창고로 옮기는 일은 없으므로 마커를 안 붙이고 차감도 없다(2026-09-11 김치).
  const hubOut = applyLocationCheck(
    [{ locationId: H, qty: 7, carried: true }, { locationId: A, qty: 2, carried: false }],
    patch({ checkedLocationId: H, afterQty: 17, restockedQty: 17 }),
  )
  eq('허브 자기 점검: 마커 없음', rowOf(hubOut, H)?.restockedQty, undefined)
  eq('허브 자기 점검: 실측 표식', rowOf(hubOut, H)?.carried, false)
  eq('허브 자기 점검: 잰 값', rowOf(hubOut, H)?.qty, 17)
  eq('허브 자기 점검: 4층 실측 보존', rowOf(hubOut, A)?.carried, false)
  eq('허브 자기 점검: 4층 잔량 불변', rowOf(hubOut, A)?.qty, 2)
}

// ── 6. 같은 위치 재점검 — 마지막 값으로 덮되 앞 위치 마커는 보존 (신고 8319ba10) ────
{
  const base: LocBreakdown[] = [
    { locationId: H, qty: 10, carried: true },
    { locationId: A, qty: 6, restockedQty: 4, carried: false },
    { locationId: B, qty: 3, carried: false },
  ]
  const out = applyLocationCheck(base, patch({ checkedLocationId: B, afterQty: 5, restockedQty: 2 }))
  eq('재점검 머지: 4층 보충 마커 보존', rowOf(out, A)?.restockedQty, 4)
  eq('재점검 머지: 4층 실측 표식 보존', rowOf(out, A)?.carried, false)
  eq('재점검 머지: 5층 잔량은 마지막 잰 값', rowOf(out, B)?.qty, 5)
  eq('재점검 머지: 5층 마커는 이번 보충량', rowOf(out, B)?.restockedQty, 2)
  eq('재점검 머지: 허브 자동 차감', rowOf(out, H)?.qty, 8)
  eq('재점검 머지: 행 수 불변', out.length, 3)
}

// ── 7. 복수 패치 — 비허브 두 칸의 옮김이 허브에서 **누적** 차감된다 ─────────────
// 아이템별 폼이 4층 +4, 5층 +3 을 한 번에 보내면 허브는 12 − 7 = 5 여야 한다. 한 번만 빠지면
// 장부가 옮긴 양보다 많이 남고, 두 번 빠지면 모자란다 — 둘 다 조용한 오차다.
{
  const base: LocBreakdown[] = [{ locationId: H, qty: 12 }, { locationId: A, qty: 2 }, { locationId: B, qty: 1 }]
  const r = applyLocationChecks(base, [
    patch({ checkedLocationId: A, afterQty: 6, restockedQty: 4 }),
    patch({ checkedLocationId: B, afterQty: 4, restockedQty: 3 }),
  ])
  eq('복수 패치: 게이트 통과', r.ok, true)
  if (r.ok) {
    eq('복수 패치: 허브 누적 차감', rowOf(r.out, H)?.qty, 5)
    eq('복수 패치: 4층 잔량', rowOf(r.out, A)?.qty, 6)
    eq('복수 패치: 4층 마커', rowOf(r.out, A)?.restockedQty, 4)
    eq('복수 패치: 5층 잔량', rowOf(r.out, B)?.qty, 4)
    eq('복수 패치: 5층 마커', rowOf(r.out, B)?.restockedQty, 3)
    // carried 세 경우 — 적은 행은 실측, 허브는 차감된 파생이라 이월, 안 적은 행도 이월.
    eq('복수 패치 carried: 적은 4층은 실측', rowOf(r.out, A)?.carried, false)
    eq('복수 패치 carried: 적은 5층은 실측', rowOf(r.out, B)?.carried, false)
    eq('복수 패치 carried: 허브 파생은 이월', rowOf(r.out, H)?.carried, true)
  }
  // 원본 base 를 건드리지 않는다 — 같은 base 로 다시 접으면 같은 답이 나와야 한다(멱등).
  const again = applyLocationChecks(base, [
    patch({ checkedLocationId: A, afterQty: 6, restockedQty: 4 }),
    patch({ checkedLocationId: B, afterQty: 4, restockedQty: 3 }),
  ])
  eq('복수 패치: 두 번 접어도 같은 답(base 불변)', again.ok && JSON.stringify(again.out), r.ok && JSON.stringify(r.out))
  eq('복수 패치: base 원본 허브 불변', base.find(b => b.locationId === H)?.qty, 12)
}

// ── 8. 허브 패치는 **맨 뒤**에서 파생값을 덮는다 ─────────────────────────────
// 창고를 직접 센 값이 있으면 그것이 진실이다. 차감 파생(12−4=8)이 아니라 잰 값 9 가 남고,
// 그 행은 실측(false)이며 허브 자기 행에는 마커가 붙지 않는다.
{
  const base: LocBreakdown[] = [{ locationId: H, qty: 12 }, { locationId: A, qty: 2 }, { locationId: B, qty: 1 }]
  const r = applyLocationChecks(base, [
    patch({ checkedLocationId: A, afterQty: 6, restockedQty: 4 }),
    patch({ checkedLocationId: H, afterQty: 9, restockedQty: 0 }),
  ])
  eq('허브 마지막: 게이트 통과', r.ok, true)
  if (r.ok) {
    eq('허브 마지막: 잰 값이 파생을 덮는다', rowOf(r.out, H)?.qty, 9)
    eq('허브 마지막: 허브는 실측', rowOf(r.out, H)?.carried, false)
    eq('허브 마지막: 허브 자기 행에 마커 없음', rowOf(r.out, H)?.restockedQty, undefined)
    eq('허브 마지막: 4층 실측 보존', rowOf(r.out, A)?.carried, false)
    eq('허브 마지막: 안 적은 5층은 이월', rowOf(r.out, B)?.carried, true)
    eq('허브 마지막: 안 적은 5층 잔량 불변', rowOf(r.out, B)?.qty, 1)
  }
}

// ── 9. HUB_SHORT — **걸린 패치 인덱스**를 실어 돌려주고 한 건도 내지 않는다 ─────────
// 첫 패치(+4)까지는 통과하고 두 번째(+9)에서 허브가 모자란다. 그때 부분 반영으로 끝나면
// 화면은 '저장됨' 인데 장부는 절반이 되고, 그 절반이 다음 점검의 base 가 된다.
{
  const base: LocBreakdown[] = [{ locationId: H, qty: 10 }, { locationId: A, qty: 2 }, { locationId: B, qty: 1 }]
  const r = applyLocationChecks(base, [
    patch({ checkedLocationId: A, afterQty: 6, restockedQty: 4 }),
    patch({ checkedLocationId: B, afterQty: 10, restockedQty: 9 }),
  ])
  eq('HUB_SHORT: 막힌다', r.ok, false)
  if (!r.ok) {
    eq('HUB_SHORT: 걸린 패치 인덱스', r.index, 1)
    // 남은 허브는 10 − 4 = 6 이라 +9 는 3 이 모자란다.
    eq('HUB_SHORT: 그 시점의 허브 잔량', r.short.hubQty, 6)
    eq('HUB_SHORT: 부족분', r.short.shortfall, 3)
  }
  eq('HUB_SHORT: base 원본 불변', base.find(b => b.locationId === H)?.qty, 10)
  // allowHubClamp 면 같은 입력이 통과하고 0 클램프된다(강행 저장).
  const forced = applyLocationChecks(base, [
    patch({ checkedLocationId: A, afterQty: 6, restockedQty: 4 }),
    patch({ checkedLocationId: B, afterQty: 10, restockedQty: 9 }),
  ], true)
  eq('HUB_SHORT: 강행이면 통과', forced.ok, true)
  if (forced.ok) eq('HUB_SHORT: 강행은 0 클램프', rowOf(forced.out, H)?.qty, 0)
}

// ── 10. 패치 0건 — 한 행도 실측이 아니다 ────────────────────────────────────
{
  const r = applyLocationChecks([{ locationId: H, qty: 3 }, { locationId: A, qty: 1 }], [])
  eq('패치 0건: 통과', r.ok, true)
  if (r.ok) {
    eq('패치 0건: 행 수 불변', r.out.length, 2)
    eq('패치 0건: 전부 이월', r.out.every(o => o.carried === true), true)
  }
}

console.log(`\n위치 점검 머지 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
