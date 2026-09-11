// 점검 수정의 뒤 점검 전파 정본(lib/stockLedger planCheckPropagation) 회귀 테스트 — DB 불필요.
// 운영자 신고(2026-09-11 김치)를 그대로 박제한다. 9/10 점검을 나중에 고쳐 창고 몫을 4층으로
// 나눠 적었는데 9/11 점검이 안 딸려간 사건이다.
//
// 지키는 계약.
//   · 이월 행은 파생 박제 — 앞 점검이 바뀌면 따라간다(연쇄).
//   · 실측 행은 절대값 — 그 위치에서만 멈추고 다른 위치는 계속 간다.
//   · 보정(isReconcile)·위치 내역 없는 점검에서는 전체가 멈춘다.
//   · 총량은 위치 합으로 다시 센다. 음수는 클램프가 아니라 거부다.
//   · 표식 없는 구식 행은 휴리스틱 — 저장값이 "앞 값 + 사이 입수 − 허브 차감"과 같으면 이월.
import {
  planCheckPropagation, type PropagationCheck, type LedgerDelta, type ShiftRow,
} from '../lib/stockLedger'

let pass = 0
const fails: string[] = []

function eq(label: string, got: unknown, want: unknown) {
  if (Object.is(got, want)) pass++
  else fails.push(`${label}: 기대 ${String(want)} / 실제 ${String(got)}`)
}

const D = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d)
const T = (y: number, m: number, d: number, h = 12, mi = 0) => Date.UTC(y, m - 1, d, h, mi)

// 위치 — H=허브(창고), A·B=비허브
const H = 'loc-hub', A = 'loc-a', B = 'loc-b'

type LocIn = { id: string; qty: number; carried?: boolean | null; restocked?: number | null }
const chk = (
  id: string, dateMs: number, createdAtMs: number, locs: LocIn[],
  opts?: { isReconcile?: boolean; total?: number; noBreakdown?: boolean },
): PropagationCheck => ({
  id, dateMs, createdAtMs,
  isReconcile: opts?.isReconcile ?? false,
  total: opts?.total ?? locs.reduce((s, l) => s + l.qty, 0),
  hasBreakdown: !(opts?.noBreakdown ?? false),
  byLoc: opts?.noBreakdown ? [] : locs.map(l => ({
    locationId: l.id, qty: l.qty, carried: l.carried ?? null, restockedQty: l.restocked ?? null,
  })),
})

const NO_DELTA: LedgerDelta[] = []
const locOf = (r: ShiftRow, id: string) => r.locs.find(l => l.locationId === id)

// ── 1. 이월 연쇄 (3점검) ────────────────────────────────────────────────
// 9/01 을 고치면 이월만 담은 9/02·9/03 이 끝까지 따라간다.
{
  const checks = [
    chk('c1', D(2026, 9, 1), T(2026, 9, 1), [{ id: H, qty: 10, carried: false }, { id: A, qty: 0, carried: false }]),
    chk('c2', D(2026, 9, 2), T(2026, 9, 2), [{ id: H, qty: 10, carried: true }, { id: A, qty: 0, carried: true }]),
    chk('c3', D(2026, 9, 3), T(2026, 9, 3), [{ id: H, qty: 10, carried: true }, { id: A, qty: 0, carried: true }]),
  ]
  const plan = planCheckPropagation(checks, 'c1',
    [{ locationId: H, qty: 10 }, { locationId: A, qty: 0 }],
    [{ locationId: H, qty: 6 }, { locationId: A, qty: 4 }],
    { hubLocationId: H, deltas: NO_DELTA })
  eq('이월 연쇄: 계획 성립', plan.ok, true)
  if (plan.ok) {
    eq('이월 연쇄: 두 점검 모두 대상', plan.rows.length, 2)
    eq('이월 연쇄: c2 허브', locOf(plan.rows[0], H)?.nextQty, 6)
    eq('이월 연쇄: c2 A', locOf(plan.rows[0], A)?.nextQty, 4)
    eq('이월 연쇄: c3 허브', locOf(plan.rows[1], H)?.nextQty, 6)
    eq('이월 연쇄: c3 A', locOf(plan.rows[1], A)?.nextQty, 4)
    eq('이월 연쇄: 총량 불변(재분배)', plan.rows[1].nextTotal, 10)
  }
}

// ── 2. 실측에서 정지 — 그 위치만 ────────────────────────────────────────
// c2 의 A 가 실측(carried=false)이면 A 는 c2 에서 멈추고 c3 까지 안 간다. 허브는 계속 간다.
{
  const checks = [
    chk('c1', D(2026, 9, 1), T(2026, 9, 1), [{ id: H, qty: 10, carried: false }, { id: A, qty: 0, carried: false }]),
    chk('c2', D(2026, 9, 2), T(2026, 9, 2), [{ id: H, qty: 10, carried: true }, { id: A, qty: 2, carried: false }]),
    chk('c3', D(2026, 9, 3), T(2026, 9, 3), [{ id: H, qty: 10, carried: true }, { id: A, qty: 2, carried: true }]),
  ]
  const plan = planCheckPropagation(checks, 'c1',
    [{ locationId: H, qty: 10 }, { locationId: A, qty: 0 }],
    [{ locationId: H, qty: 6 }, { locationId: A, qty: 4 }],
    { hubLocationId: H, deltas: NO_DELTA })
  eq('실측 정지: 계획 성립', plan.ok, true)
  if (plan.ok) {
    eq('실측 정지: c2 는 허브만 바뀐다', plan.rows[0].locs.length, 1)
    eq('실측 정지: c2 A 는 손대지 않는다', locOf(plan.rows[0], A), undefined)
    eq('실측 정지: c2 허브', locOf(plan.rows[0], H)?.nextQty, 6)
    eq('실측 정지: c2 총량 = 6 + 2', plan.rows[0].nextTotal, 8)
    eq('실측 정지: c3 도 허브만', plan.rows[1].locs.length, 1)
    eq('실측 정지: c3 A 는 멈춘 채', locOf(plan.rows[1], A), undefined)
  }
}

// ── 3. 보정 점검에서 전체 정지 ─────────────────────────────────────────
{
  const checks = [
    chk('c1', D(2026, 9, 1), T(2026, 9, 1), [{ id: H, qty: 10, carried: false }, { id: A, qty: 0, carried: false }]),
    chk('c2', D(2026, 9, 2), T(2026, 9, 2), [{ id: H, qty: 10, carried: true }, { id: A, qty: 0, carried: true }], { isReconcile: true }),
    chk('c3', D(2026, 9, 3), T(2026, 9, 3), [{ id: H, qty: 10, carried: true }, { id: A, qty: 0, carried: true }]),
  ]
  const plan = planCheckPropagation(checks, 'c1',
    [{ locationId: H, qty: 10 }, { locationId: A, qty: 0 }],
    [{ locationId: H, qty: 6 }, { locationId: A, qty: 4 }],
    { hubLocationId: H, deltas: NO_DELTA })
  eq('보정 정지: 계획 성립', plan.ok, true)
  if (plan.ok) eq('보정 정지: 보정과 그 뒤는 손대지 않는다', plan.rows.length, 0)
}

// ── 3b. 위치 내역 없는 점검에서도 전체 정지 ────────────────────────────
{
  const checks = [
    chk('c1', D(2026, 9, 1), T(2026, 9, 1), [{ id: H, qty: 10, carried: false }, { id: A, qty: 0, carried: false }]),
    chk('c2', D(2026, 9, 2), T(2026, 9, 2), [], { noBreakdown: true, total: 10 }),
    chk('c3', D(2026, 9, 3), T(2026, 9, 3), [{ id: H, qty: 10, carried: true }, { id: A, qty: 0, carried: true }]),
  ]
  const plan = planCheckPropagation(checks, 'c1',
    [{ locationId: H, qty: 10 }, { locationId: A, qty: 0 }],
    [{ locationId: H, qty: 6 }, { locationId: A, qty: 4 }],
    { hubLocationId: H, deltas: NO_DELTA })
  eq('내역 없음 정지: 계획 성립', plan.ok, true)
  if (plan.ok) eq('내역 없음 정지: 이을 자리가 없으면 멈춘다', plan.rows.length, 0)
}

// ── 4. 행 없음 생성 ────────────────────────────────────────────────────
// 뒤 점검에 그 위치 행이 아예 없어도, 새 값이 0 보다 크면 만든다. 0 이면 만들지 않는다.
{
  const checks = [
    chk('c1', D(2026, 9, 1), T(2026, 9, 1), [{ id: H, qty: 10, carried: false }]),
    chk('c2', D(2026, 9, 2), T(2026, 9, 2), [{ id: H, qty: 10, carried: true }]),
  ]
  const plan = planCheckPropagation(checks, 'c1',
    [{ locationId: H, qty: 10 }],
    [{ locationId: H, qty: 6 }, { locationId: A, qty: 4 }, { locationId: B, qty: 0 }],
    { hubLocationId: H, deltas: NO_DELTA })
  eq('행 생성: 계획 성립', plan.ok, true)
  if (plan.ok) {
    eq('행 생성: 허브와 A 두 자리', plan.rows[0].locs.length, 2)
    eq('행 생성: A 는 없던 행', locOf(plan.rows[0], A)?.storedQty, null)
    eq('행 생성: A 새 값', locOf(plan.rows[0], A)?.nextQty, 4)
    eq('행 생성: 0 인 B 는 만들지 않는다', locOf(plan.rows[0], B), undefined)
    eq('행 생성: 총량 = 6 + 4', plan.rows[0].nextTotal, 10)
  }
}

// ── 5. 음수 거부 ───────────────────────────────────────────────────────
// c1 의 허브를 2 로 줄이면, c2 가 이미 A 로 5 를 보충해 간 만큼(허브 차감 5) 이월 허브가 −3 이 된다.
// 조용히 0 으로 누르지 않고 어느 점검의 어느 위치인지 이름으로 알린다(쌀 사건의 교훈).
{
  const checks = [
    chk('c1', D(2026, 9, 1), T(2026, 9, 1), [{ id: H, qty: 10, carried: false }, { id: A, qty: 0, carried: false }]),
    chk('c2', D(2026, 9, 2), T(2026, 9, 2), [{ id: H, qty: 5, carried: true }, { id: A, qty: 5, carried: false, restocked: 5 }]),
  ]
  const plan = planCheckPropagation(checks, 'c1',
    [{ locationId: H, qty: 10 }, { locationId: A, qty: 0 }],
    [{ locationId: H, qty: 2 }, { locationId: A, qty: 8 }],
    { hubLocationId: H, deltas: NO_DELTA })
  eq('음수 거부: 계획 실패', plan.ok, false)
  if (!plan.ok) {
    eq('음수 거부: 코드', plan.code, 'NEGATIVE')
    eq('음수 거부: 어느 점검인지', plan.checkId, 'c2')
    eq('음수 거부: 어느 위치인지', plan.locationId, H)
    eq('음수 거부: 0 클램프 아님', plan.value, -3)
  }
}

// ── 6. 사이 입수 반영 ──────────────────────────────────────────────────
// c1 과 c2 사이에 창고로 +5 가 들어왔으면 이월값은 그만큼 얹혀 있다. 전파도 같은 축을 쓴다.
{
  const deltas: LedgerDelta[] = [
    { dateMs: D(2026, 9, 1), createdAtMs: T(2026, 9, 1, 18), qty: 5, locationId: H },  // c1 뒤(같은 날 늦게 입력)
    { dateMs: D(2026, 9, 5), createdAtMs: T(2026, 9, 5), qty: 99, locationId: H },      // c2 뒤 — 이 구간 밖
  ]
  const checks = [
    chk('c1', D(2026, 9, 1), T(2026, 9, 1, 12), [{ id: H, qty: 10, carried: false }, { id: A, qty: 0, carried: false }]),
    chk('c2', D(2026, 9, 2), T(2026, 9, 2), [{ id: H, qty: 15, carried: true }, { id: A, qty: 0, carried: true }]),
  ]
  const plan = planCheckPropagation(checks, 'c1',
    [{ locationId: H, qty: 10 }, { locationId: A, qty: 0 }],
    [{ locationId: H, qty: 6 }, { locationId: A, qty: 4 }],
    { hubLocationId: H, deltas })
  eq('사이 입수: 계획 성립', plan.ok, true)
  if (plan.ok) {
    eq('사이 입수: 허브 = 새 값 6 + 입수 5', locOf(plan.rows[0], H)?.nextQty, 11)
    eq('사이 입수: A = 4', locOf(plan.rows[0], A)?.nextQty, 4)
    eq('사이 입수: 구간 밖 입수는 안 센다', plan.rows[0].nextTotal, 15)
  }
}

// ── 7. 허브 차감 반영 ──────────────────────────────────────────────────
// c2 가 A 에 +3 보충했으면 그 점검의 허브 이월값은 3 만큼 깎여 있다.
// 허브 자기 행에 붙은 마커(표시 버그의 흔적)는 차감으로 세지 않는다.
{
  const checks = [
    chk('c1', D(2026, 9, 1), T(2026, 9, 1), [{ id: H, qty: 10, carried: false }, { id: A, qty: 0, carried: false }]),
    chk('c2', D(2026, 9, 2), T(2026, 9, 2), [
      { id: H, qty: 7, carried: true, restocked: 99 },   // 99 = 허브 자기 마커(무시 대상)
      { id: A, qty: 3, carried: false, restocked: 3 },
    ]),
  ]
  const plan = planCheckPropagation(checks, 'c1',
    [{ locationId: H, qty: 10 }, { locationId: A, qty: 0 }],
    [{ locationId: H, qty: 8 }, { locationId: A, qty: 0 }, { locationId: B, qty: 2 }],
    { hubLocationId: H, deltas: NO_DELTA })
  eq('허브 차감: 계획 성립', plan.ok, true)
  if (plan.ok) {
    eq('허브 차감: 허브 = 새 값 8 − 보충 3', locOf(plan.rows[0], H)?.nextQty, 5)
    eq('허브 차감: 비허브 B 는 차감 없음', locOf(plan.rows[0], B)?.nextQty, 2)
    eq('허브 차감: A 실측이라 3 유지 → 총 5+3+2', plan.rows[0].nextTotal, 10)
  }
}

// ── 8. 표식 없는 구식 행 휴리스틱 ──────────────────────────────────────
// 저장값이 "앞 값 + 사이 입수 − 허브 차감"과 같으면 이월(일치), 다르면 실측(불일치).
{
  const base = (aQty: number) => [
    chk('c1', D(2026, 9, 1), T(2026, 9, 1), [{ id: H, qty: 10, carried: null }, { id: A, qty: 2, carried: null }]),
    chk('c2', D(2026, 9, 2), T(2026, 9, 2), [{ id: H, qty: 10, carried: null }, { id: A, qty: aQty, carried: null }]),
  ]
  const run = (aQty: number) => planCheckPropagation(base(aQty), 'c1',
    [{ locationId: H, qty: 10 }, { locationId: A, qty: 2 }],
    [{ locationId: H, qty: 6 }, { locationId: A, qty: 6 }],
    { hubLocationId: H, deltas: NO_DELTA })

  const same = run(2)   // 앞 값 그대로 = 이월로 본다
  eq('휴리스틱 일치: 계획 성립', same.ok, true)
  if (same.ok) {
    eq('휴리스틱 일치: A 를 이월로 보고 옮긴다', locOf(same.rows[0], A)?.nextQty, 6)
    eq('휴리스틱 일치: 허브도 옮긴다', locOf(same.rows[0], H)?.nextQty, 6)
  }
  const diff = run(1)   // 앞 값과 다름 = 그 사이 센 값이다
  eq('휴리스틱 불일치: 계획 성립', diff.ok, true)
  if (diff.ok) {
    // 값은 그대로 두되 판정(실측)은 표식으로 박는다 — 조용히 넘기지 않는다.
    eq('휴리스틱 불일치: A 는 값 그대로', locOf(diff.rows[0], A)?.nextQty, 1)
    eq('휴리스틱 불일치: A 는 값이 안 움직인다', locOf(diff.rows[0], A)?.storedQty, 1)
    eq('휴리스틱 불일치: A 에 실측 표식을 박는다', locOf(diff.rows[0], A)?.carried, false)
    eq('휴리스틱 불일치: 허브는 계속 간다', locOf(diff.rows[0], H)?.nextQty, 6)
    eq('휴리스틱 불일치: 총량 = 6 + 1', diff.rows[0].nextTotal, 7)
  }
}

// ── 9. 총량 재계산 ─────────────────────────────────────────────────────
// 저장 총량(헤더)이 위치합과 어긋나 있어도 새 총량은 **위치 합**으로 다시 센다.
{
  const checks = [
    chk('c1', D(2026, 9, 1), T(2026, 9, 1), [{ id: H, qty: 10, carried: false }]),
    chk('c2', D(2026, 9, 2), T(2026, 9, 2), [{ id: H, qty: 10, carried: true }, { id: A, qty: 5, carried: false }], { total: 99 }),
  ]
  const plan = planCheckPropagation(checks, 'c1',
    [{ locationId: H, qty: 10 }], [{ locationId: H, qty: 4 }],
    { hubLocationId: H, deltas: NO_DELTA })
  eq('총량 재계산: 계획 성립', plan.ok, true)
  if (plan.ok) {
    eq('총량 재계산: 저장 총량은 그대로 보고', plan.rows[0].storedTotal, 99)
    eq('총량 재계산: 새 총량 = 위치 합 4 + 5', plan.rows[0].nextTotal, 9)
  }
}

// ── 10. 김치 3점검 실제 값 (운영자 신고 2026-09-11) ─────────────────────
//
// 실제 장부. 9/10 04:37Z 수령 자동(창고 20) → 9/10 04:38Z 점검(오늘 수정됨) → 9/11 01:36Z 위치별 점검.
// 수정 전 9/10 = 5층 상단 3 · 5층 하단(창고) 17, 총 20.
// 수정 후 9/10 = 4층 상단 4(+4) · 4층 하단 6(+6) · 4층 주방 0 · 5층 상단 3(+3) · 5층 하단 7, 총 20.
// 9/11 = 5층 상단 1.5(실측) · 5층 하단 17(이월), 총 18.5.
// 기대 — 4층 두 자리가 생기고 창고가 7 로 따라오며, 그날 실제로 센 5층 상단 1.5 는 그대로. 총 18.5.
{
  const K4U = 'loc-4-upper', K4L = 'loc-4-lower', K4K = 'loc-4-kitchen', K5U = 'loc-5-upper', K5L = 'loc-5-lower'
  const checks = [
    chk('auto', D(2026, 9, 10), T(2026, 9, 10, 4, 37), [{ id: K5L, qty: 20, carried: null }]),
    chk('edited', D(2026, 9, 10), T(2026, 9, 10, 4, 38), [
      { id: K4U, qty: 4, carried: null, restocked: 4 },
      { id: K4L, qty: 6, carried: null, restocked: 6 },
      { id: K4K, qty: 0, carried: null },
      { id: K5U, qty: 3, carried: null, restocked: 3 },
      { id: K5L, qty: 7, carried: null },
    ]),
    chk('next', D(2026, 9, 11), T(2026, 9, 11, 1, 36), [
      { id: K5U, qty: 1.5, carried: null },
      { id: K5L, qty: 17, carried: null, restocked: 17 },   // 허브 자기 마커(표시 버그) — 차감 아님
    ], { total: 18.5 }),
  ]
  const plan = planCheckPropagation(checks, 'edited',
    [{ locationId: K5U, qty: 3 }, { locationId: K5L, qty: 17 }],
    [{ locationId: K4U, qty: 4 }, { locationId: K4L, qty: 6 }, { locationId: K4K, qty: 0 },
     { locationId: K5U, qty: 3 }, { locationId: K5L, qty: 7 }],
    { hubLocationId: K5L, deltas: NO_DELTA })
  eq('김치: 계획 성립', plan.ok, true)
  if (plan.ok) {
    eq('김치: 9/11 한 건만 대상', plan.rows.length, 1)
    const r = plan.rows[0]
    eq('김치: 4층 상단 4 (없던 행)', locOf(r, K4U)?.nextQty, 4)
    eq('김치: 4층 상단은 새 행', locOf(r, K4U)?.storedQty, null)
    eq('김치: 4층 하단 6 (없던 행)', locOf(r, K4L)?.nextQty, 6)
    eq('김치: 4층 주방은 0 이라 안 만든다', locOf(r, K4K), undefined)
    eq('김치: 5층 하단 17 에서 7 로', locOf(r, K5L)?.nextQty, 7)
    eq('김치: 5층 하단 저장값', locOf(r, K5L)?.storedQty, 17)
    eq('김치: 5층 상단 값은 1.5 그대로', locOf(r, K5U)?.nextQty, 1.5)
    eq('김치: 5층 상단 저장값도 1.5', locOf(r, K5U)?.storedQty, 1.5)
    eq('김치: 5층 상단에 실측 표식을 박는다', locOf(r, K5U)?.carried, false)
    eq('김치: 총 18.5', r.nextTotal, 18.5)
    eq('김치: 저장 총량도 18.5(재분배라 총량 불변)', r.storedTotal, 18.5)
  }
}

// ── 10b. 값이 이미 같아도 표식이 다르면 넘어가지 않는다 ────────────────
//
// 김치 백필을 적용한 뒤 같은 계획을 다시 돌린 상황이다. 값은 전부 맞아 있고 표식만 비어 있다.
// 여기서 '변화 없음'으로 조용히 넘기면 그 행들은 영원히 구식(null)으로 남아 다음 수정 때
// 또 휴리스틱으로 추측된다. 값이 같아도 표식이 다르면 행으로 나와야 한다(운영자 후속 오더).
{
  const checks = [
    chk('c1', D(2026, 9, 1), T(2026, 9, 1), [{ id: H, qty: 6, carried: false }, { id: A, qty: 4, carried: false }]),
    chk('c2', D(2026, 9, 2), T(2026, 9, 2), [
      { id: H, qty: 6, carried: null },    // 전파가 덮어쓴 구식 행 — 이월로 박아야 한다
      { id: A, qty: 1, carried: null },    // 그날 센 값 — 실측으로 박아야 한다
      { id: B, qty: 2, carried: true },    // 이미 표식이 맞는 행 — 나오면 안 된다
    ]),
  ]
  // before == after — 값으로는 옮길 것이 하나도 없다.
  const same = [{ locationId: H, qty: 6 }, { locationId: A, qty: 4 }]
  const plan = planCheckPropagation(checks, 'c1', same, same, { hubLocationId: H, deltas: NO_DELTA })
  eq('표식만: 계획 성립', plan.ok, true)
  if (plan.ok) {
    eq('표식만: 조용히 넘기지 않는다', plan.rows.length, 1)
    const r = plan.rows[0]
    eq('표식만: 두 행만 나온다', r.locs.length, 2)
    eq('표식만: 총량은 그대로', r.nextTotal, r.storedTotal)
    eq('표식만: 허브는 값 그대로', locOf(r, H)?.nextQty, 6)
    eq('표식만: 허브에 이월 표식', locOf(r, H)?.carried, true)
    eq('표식만: A 는 값 그대로', locOf(r, A)?.nextQty, 1)
    eq('표식만: A 에 실측 표식', locOf(r, A)?.carried, false)
    eq('표식만: 이미 맞는 행은 안 나온다', locOf(r, B), undefined)
  }
}

// ── 11. 되돌림이 전파 전으로 복귀 ──────────────────────────────────────
// 적용층(ledgerShift applyShiftRows/revertShiftRows)의 계약을 메모리로 재현한다 —
// 스냅샷은 '바뀌기 전 값'이고, 없던 행(storedQty null)은 되돌릴 때 지운다.
{
  const qty = new Map<string, number | null>([[`n:${H}`, 10], [`n:${A}`, null]])
  const flag = new Map<string, boolean | null>([[`n:${H}`, null], [`n:${A}`, null]])
  const rows: ShiftRow[] = [{
    checkId: 'n', dateMs: D(2026, 9, 2), storedTotal: 10, nextTotal: 10,
    locs: [
      { locationId: H, storedQty: 10, nextQty: 6, carried: true },
      { locationId: A, storedQty: null, nextQty: 4, carried: true },
    ],
  }]
  // applyShiftRows 의 스냅샷 계약 — 값과 **표식의 이전 값**을 함께 담는다(null 도 유효한 이전 값).
  const snapshot = rows.flatMap(r => r.locs.map(l => ({
    key: `${r.checkId}:${l.locationId}`, was: l.storedQty, wasCarried: flag.get(`${r.checkId}:${l.locationId}`) ?? null,
  })))
  for (const r of rows) for (const l of r.locs) {
    qty.set(`${r.checkId}:${l.locationId}`, l.nextQty)
    flag.set(`${r.checkId}:${l.locationId}`, l.carried ?? null)
  }
  eq('되돌림: 적용 후 허브', qty.get(`n:${H}`), 6)
  eq('되돌림: 적용 후 허브 표식', flag.get(`n:${H}`), true)
  eq('되돌림: 적용 후 새 행 A', qty.get(`n:${A}`), 4)
  for (const s of snapshot) { qty.set(s.key, s.was); flag.set(s.key, s.wasCarried) }
  eq('되돌림: 허브 원복', qty.get(`n:${H}`), 10)
  eq('되돌림: 허브 표식도 원복(null)', flag.get(`n:${H}`), null)
  eq('되돌림: 없던 행은 다시 없음', qty.get(`n:${A}`), null)
}

console.log(`\n점검 전파 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
