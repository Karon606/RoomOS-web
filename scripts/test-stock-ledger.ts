// 재고 원장 리플레이 정본(lib/stockLedger) 회귀 테스트 — DB 불필요, 순수 함수 케이스 고정.
// 운영자 신고(2026-08-19 쌀 40kg)를 그대로 박제한다. 8/18 로 잘못 넣은 무상 입고를 8/10 으로
// 정정하면 그 사이 점검들의 저장 절대값이 그대로라 40kg 이 증발하던 사건이다.
import { planStockShift, deltaAfterCheck, purchaseAfterCheck, overbookExcess, type LedgerCheck, type LedgerDelta, type PurchaseDelta } from '../lib/stockLedger'

let pass = 0
const fails: string[] = []

function eq(label: string, got: unknown, want: unknown) {
  if (Object.is(got, want)) pass++
  else fails.push(`${label}: 기대 ${String(want)} / 실제 ${String(got)}`)
}

const D = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d)
const T = (y: number, m: number, d: number, h = 12) => Date.UTC(y, m - 1, d, h)

// 위치 — W=415호 창고(허브), K4=4층 주방, K5=5층 주방
const W = 'loc-warehouse', K4 = 'loc-kitchen4', K5 = 'loc-kitchen5'

// ── 운영자가 실제로 만든 장부 상태(무상 입고를 8/18 로 잘못 넣은 세계) ─────────
//   8/7  실사 60 전량 창고
//   8/12 위치 점검 — 주방 두 곳에 10kg 씩 보충(창고 자동 차감 20)
//   8/14 위치 점검 — 주방 두 곳에 2kg 씩 보충, 그 사이 주방 소모 3kg 씩
const check0807: LedgerCheck = {
  id: 'c0807', dateMs: D(2026, 8, 7), createdAtMs: T(2026, 8, 7), isReconcile: false,
  total: 60, hasBreakdown: true,
  byLoc: [{ locationId: W, qty: 60 }, { locationId: K4, qty: 0 }, { locationId: K5, qty: 0 }],
}
const check0812: LedgerCheck = {
  id: 'c0812', dateMs: D(2026, 8, 12), createdAtMs: T(2026, 8, 12), isReconcile: false,
  total: 60, hasBreakdown: true,
  byLoc: [{ locationId: W, qty: 40 }, { locationId: K4, qty: 10 }, { locationId: K5, qty: 10 }],
}
const check0814: LedgerCheck = {
  id: 'c0814', dateMs: D(2026, 8, 14), createdAtMs: T(2026, 8, 14), isReconcile: false,
  total: 54, hasBreakdown: true,
  byLoc: [{ locationId: W, qty: 36 }, { locationId: K4, qty: 9 }, { locationId: K5, qty: 9 }],
}
const CHECKS = [check0807, check0812, check0814]

// 무상 입고 40kg — 창고 도착. 실제 도착일 8/10, 처음 입력은 8/18.
const addWrong: LedgerDelta = { dateMs: D(2026, 8, 18), createdAtMs: T(2026, 8, 18), qty: 40, locationId: W }
const addRight: LedgerDelta = { dateMs: D(2026, 8, 10), createdAtMs: T(2026, 8, 18), qty: 40, locationId: W }

// ── 경계 술어 — overview.sumAdditions 와 같은 규칙 ────────────────────────
eq('경계: 다음 날 입수는 점검 뒤', deltaAfterCheck({ dateMs: D(2026, 8, 13), createdAtMs: T(2026, 8, 13) }, check0812), true)
eq('경계: 전날 입수는 점검 앞', deltaAfterCheck({ dateMs: D(2026, 8, 11), createdAtMs: T(2026, 8, 11) }, check0812), false)
eq('경계: 같은 날 점검보다 늦게 입력하면 뒤',
  deltaAfterCheck({ dateMs: D(2026, 8, 12), createdAtMs: T(2026, 8, 12, 18) }, check0812), true)
eq('경계: 같은 날 점검보다 먼저 입력하면 앞',
  deltaAfterCheck({ dateMs: D(2026, 8, 12), createdAtMs: T(2026, 8, 12, 6) }, check0812), false)

// ── 수용 기준: 운영자 쌀 시나리오 (8/18 을 8/10 으로 정정) ─────────────────
{
  const plan = planStockShift(CHECKS, addWrong, addRight)
  eq('쌀: 계획 성립', plan.ok, true)
  if (plan.ok) {
    eq('쌀: 조정 대상 점검 2건', plan.rows.length, 2)
    const r12 = plan.rows.find(r => r.checkId === 'c0812')
    const r14 = plan.rows.find(r => r.checkId === 'c0814')
    eq('쌀: 8/7 실사는 손대지 않는다', plan.rows.some(r => r.checkId === 'c0807'), false)
    eq('쌀: 8/12 총량 60 에서 100', r12?.nextTotal, 100)
    eq('쌀: 8/12 창고 40 에서 80', r12?.locs.find(l => l.locationId === W)?.nextQty, 80)
    eq('쌀: 8/12 조정 위치는 창고 하나뿐', r12?.locs.length, 1)
    eq('쌀: 8/14 총량 54 에서 94', r14?.nextTotal, 94)
    eq('쌀: 8/14 창고 36 에서 76', r14?.locs.find(l => l.locationId === W)?.nextQty, 76)
    // 주방 실측은 재계산 대상이 아니다 — 조정은 입고가 도착한 위치에만 얹힌다
    eq('쌀: 4층 주방 불변', r14?.locs.some(l => l.locationId === K4), false)
    eq('쌀: 5층 주방 불변', r14?.locs.some(l => l.locationId === K5), false)
    // 총량과 위치합 불변식 — 총 조정량 == 위치 조정량 합
    for (const r of plan.rows) {
      const locSum = r.locs.reduce((s, l) => s + (l.nextQty - (l.storedQty ?? 0)), 0)
      eq(`쌀: ${r.checkId} 총량·위치합 정합`, Math.round((r.nextTotal - r.storedTotal - locSum) * 1e6) / 1e6, 0)
    }
  }
}

// ── 정정 무해성: 정정 전 잔량과 정정 후 잔량이 같아야 한다 ────────────────
// 잘못된 날짜(8/18)일 때 화면 현재고 = 마지막 점검 54 + 그 뒤 입수 40 = 94.
// 날짜를 8/10 으로 고치면 입수가 마지막 점검 앞으로 가 0 이 되므로, 점검값이 94 가 되어야 같다.
{
  const before = 54 + 40
  const plan = planStockShift(CHECKS, addWrong, addRight)
  const after = plan.ok ? (plan.rows.find(r => r.checkId === 'c0814')?.nextTotal ?? 0) + 0 : -1
  eq('정정 무해성: 날짜 정정 전후 현재고 동일', after, before)
}

// ── 순서 독립성: 소급 생성도 같은 결과 ────────────────────────────────────
{
  const plan = planStockShift(CHECKS, null, addRight)
  eq('소급 생성: 계획 성립', plan.ok, true)
  if (plan.ok) {
    eq('소급 생성: 2건', plan.rows.length, 2)
    eq('소급 생성: 8/12 총량 100', plan.rows.find(r => r.checkId === 'c0812')?.nextTotal, 100)
    eq('소급 생성: 8/14 총량 94', plan.rows.find(r => r.checkId === 'c0814')?.nextTotal, 94)
  }
}

// ── 되돌림 대칭: 조정한 세계에서 그 기록을 지우면 원래 값으로 ─────────────
{
  const adjusted: LedgerCheck[] = [
    check0807,
    { ...check0812, total: 100, byLoc: [{ locationId: W, qty: 80 }, { locationId: K4, qty: 10 }, { locationId: K5, qty: 10 }] },
    { ...check0814, total: 94, byLoc: [{ locationId: W, qty: 76 }, { locationId: K4, qty: 9 }, { locationId: K5, qty: 9 }] },
  ]
  const plan = planStockShift(adjusted, addRight, null)
  eq('삭제 대칭: 계획 성립', plan.ok, true)
  if (plan.ok) {
    eq('삭제 대칭: 8/12 총량 60 복귀', plan.rows.find(r => r.checkId === 'c0812')?.nextTotal, 60)
    eq('삭제 대칭: 8/14 창고 36 복귀', plan.rows.find(r => r.checkId === 'c0814')?.locs.find(l => l.locationId === W)?.nextQty, 36)
  }
}

// ── 날짜를 뒤로 미는 경우 — 두 점검에서 40 이 빠진다 ──────────────────────
{
  const adjusted: LedgerCheck[] = [
    check0807,
    { ...check0812, total: 100, byLoc: [{ locationId: W, qty: 80 }, { locationId: K4, qty: 10 }, { locationId: K5, qty: 10 }] },
    { ...check0814, total: 94, byLoc: [{ locationId: W, qty: 76 }, { locationId: K4, qty: 9 }, { locationId: K5, qty: 9 }] },
  ]
  const plan = planStockShift(adjusted, addRight, addWrong)
  eq('뒤로 밀기: 8/12 총량 60', plan.ok ? plan.rows.find(r => r.checkId === 'c0812')?.nextTotal : null, 60)
  eq('뒤로 밀기: 8/14 총량 54', plan.ok ? plan.rows.find(r => r.checkId === 'c0814')?.nextTotal : null, 54)
}

// ── 수량 정정 — 40 을 30 으로 ────────────────────────────────────────────
{
  const plan = planStockShift(CHECKS, addRight, { ...addRight, qty: 30 })
  eq('수량 정정: 8/12 총량 50', plan.ok ? plan.rows.find(r => r.checkId === 'c0812')?.nextTotal : null, 50)
  eq('수량 정정: 8/12 창고 30', plan.ok ? plan.rows.find(r => r.checkId === 'c0812')?.locs[0]?.nextQty : null, 30)
}

// ── 위치 정정 — 창고에서 4층 주방으로 ────────────────────────────────────
{
  const plan = planStockShift(CHECKS, addRight, { ...addRight, locationId: K4 })
  eq('위치 정정: 총량 불변', plan.ok ? plan.rows.length : -1, 0)
}
{
  // 총량은 같아도 위치는 옮겨야 하므로, 총량 0 조정이면 rows 가 비는 것이 현재 계약이다.
  // (위치만 바꾸는 정정은 2단계 접점으로 남긴다 — 아래 감지망 주석 참조)
  const plan = planStockShift(CHECKS, addRight, { ...addRight, locationId: K4 })
  eq('위치 정정: 계획 성립', plan.ok, true)
}

// ── 전체 보정(isReconcile)에서 전파가 멈춘다 ──────────────────────────────
{
  const recon: LedgerCheck = {
    id: 'c0813r', dateMs: D(2026, 8, 13), createdAtMs: T(2026, 8, 13), isReconcile: true,
    total: 95, hasBreakdown: true,
    byLoc: [{ locationId: W, qty: 77 }, { locationId: K4, qty: 9 }, { locationId: K5, qty: 9 }],
  }
  const plan = planStockShift([check0807, check0812, recon, check0814], addWrong, addRight)
  eq('보정 정지: 계획 성립', plan.ok, true)
  if (plan.ok) {
    eq('보정 정지: 조정 대상 1건', plan.rows.length, 1)
    eq('보정 정지: 8/12 만 조정', plan.rows[0]?.checkId, 'c0812')
    eq('보정 정지: 보정 점검 자체는 불변', plan.rows.some(r => r.checkId === 'c0813r'), false)
    eq('보정 정지: 보정 뒤 점검도 불변', plan.rows.some(r => r.checkId === 'c0814'), false)
  }
}
{
  // 창 밖의 보정은 전파를 멈추지 않는다 — 8/5 보정은 8/12·8/14 조정과 무관하다
  const early: LedgerCheck = {
    id: 'c0805r', dateMs: D(2026, 8, 5), createdAtMs: T(2026, 8, 5), isReconcile: true,
    total: 60, hasBreakdown: true, byLoc: [{ locationId: W, qty: 60 }],
  }
  const plan = planStockShift([early, ...CHECKS], addWrong, addRight)
  eq('보정 정지: 창 밖 보정은 무영향', plan.ok ? plan.rows.length : -1, 2)
}

// ── 음수는 0 클램프가 아니라 거부다 ──────────────────────────────────────
{
  const small: LedgerCheck = {
    id: 'cSmall', dateMs: D(2026, 8, 12), createdAtMs: T(2026, 8, 12), isReconcile: false,
    total: 5, hasBreakdown: true, byLoc: [{ locationId: W, qty: 5 }],
  }
  const plan = planStockShift([small], addRight, null)
  eq('음수 거부: 계획 실패', plan.ok, false)
  eq('음수 거부: 코드', plan.ok ? '' : plan.code, 'NEGATIVE')
  eq('음수 거부: 대상 점검', plan.ok ? '' : plan.checkId, 'cSmall')
}
{
  // 총량은 남는데 그 위치만 모자란 경우도 거부한다(위치별 음수 금지)
  const skew: LedgerCheck = {
    id: 'cSkew', dateMs: D(2026, 8, 12), createdAtMs: T(2026, 8, 12), isReconcile: false,
    total: 100, hasBreakdown: true,
    byLoc: [{ locationId: W, qty: 10 }, { locationId: K4, qty: 90 }],
  }
  const plan = planStockShift([skew], addRight, null)
  eq('위치 음수 거부: 계획 실패', plan.ok, false)
  eq('위치 음수 거부: 코드', plan.ok ? '' : plan.code, 'NEGATIVE')
}

// ── 위치를 안 쓰는 품목 — 총량만 조정 ────────────────────────────────────
{
  const flat: LedgerCheck = {
    id: 'cFlat', dateMs: D(2026, 8, 12), createdAtMs: T(2026, 8, 12), isReconcile: false,
    total: 12, hasBreakdown: false, byLoc: [],
  }
  const plan = planStockShift([flat], addWrong, { ...addRight, locationId: null })
  eq('위치 없는 품목: 총량 52', plan.ok ? plan.rows[0]?.nextTotal : null, 52)
  eq('위치 없는 품목: 위치 조정 없음', plan.ok ? plan.rows[0]?.locs.length : -1, 0)
}

// ── 귀속 위치를 못 정하면 거부(총량만 옮기면 위치합 불변식이 깨진다) ──────
{
  const plan = planStockShift(CHECKS, addWrong, { ...addRight, locationId: null })
  eq('귀속 불가: 계획 실패', plan.ok, false)
  eq('귀속 불가: 코드', plan.ok ? '' : plan.code, 'NO_LOCATION')
}

// ── 점검 breakdown 에 그 위치 행이 없으면 새로 만들 대상으로 표시 ─────────
{
  const noW: LedgerCheck = {
    id: 'cNoW', dateMs: D(2026, 8, 12), createdAtMs: T(2026, 8, 12), isReconcile: false,
    total: 20, hasBreakdown: true, byLoc: [{ locationId: K4, qty: 20 }],
  }
  const plan = planStockShift([noW], null, addRight)
  eq('행 신설: 저장값 없음 표시', plan.ok ? plan.rows[0]?.locs[0]?.storedQty : 'x', null)
  eq('행 신설: 새 값 40', plan.ok ? plan.rows[0]?.locs[0]?.nextQty : null, 40)
  eq('행 신설: 총량 60', plan.ok ? plan.rows[0]?.nextTotal : null, 60)
}

// ── 입고보다 뒤에 센 점검은 두 세계에서 같으므로 손대지 않는다 ────────────
{
  const later: LedgerCheck = {
    id: 'cLater', dateMs: D(2026, 8, 20), createdAtMs: T(2026, 8, 20), isReconcile: false,
    total: 88, hasBreakdown: true, byLoc: [{ locationId: W, qty: 88 }],
  }
  const plan = planStockShift([...CHECKS, later], addWrong, addRight)
  eq('실측 우선: 입고 뒤 점검은 불변', plan.ok ? plan.rows.some(r => r.checkId === 'cLater') : true, false)
}

// ── 소수 오차 누적 방어 ──────────────────────────────────────────────────
{
  const frac: LedgerCheck = {
    id: 'cFrac', dateMs: D(2026, 8, 12), createdAtMs: T(2026, 8, 12), isReconcile: false,
    total: 0.3, hasBreakdown: true, byLoc: [{ locationId: W, qty: 0.3 }],
  }
  const plan = planStockShift([frac], null, { ...addRight, qty: 0.1 })
  eq('소수: 총량 0.4', plan.ok ? plan.rows[0]?.nextTotal : null, 0.4)
  eq('소수: 위치 0.4', plan.ok ? plan.rows[0]?.locs[0]?.nextQty : null, 0.4)
}

// ══ 구매 델타(PurchaseDelta) — 지출 수량 정정의 재고 전파 (2026-08-19 점보롤) ══════
// 구매 반영 경계는 무상 입수와 다르다 — receivedAt(실시각) > 점검.createdAt 이면 미반영
// (overview.sumPurchases 의 gt 와 동일). 같으면 반영.

// ── 경계 술어 ─────────────────────────────────────────────────────────────
eq('구매 경계: 점검 생성 뒤 수령은 뒤', purchaseAfterCheck({ receivedAtMs: T(2026, 8, 12, 13) }, check0812), true)
eq('구매 경계: 점검 생성 전 수령은 앞', purchaseAfterCheck({ receivedAtMs: T(2026, 8, 12, 11) }, check0812), false)
eq('구매 경계: 같은 시각이면 반영(앞)', purchaseAfterCheck({ receivedAtMs: T(2026, 8, 12) }, check0812), false)

// ── 점보롤 시나리오: 구매 수량 12 를 16 으로 정정 ─────────────────────────
// 8/5 수령(창고 도착) 후 8/7·8/12·8/14 점검이 그 구매를 이미 삼켰다.
// 수량을 +4 고치면 세 점검 모두 +4 옮겨져야 잔량이 산술로 맞는다(점검 8건 손 트랜잭션의 클래스 봉합).
{
  const bought12: PurchaseDelta = { receivedAtMs: T(2026, 8, 5), qty: 12, locationId: W }
  const bought16: PurchaseDelta = { receivedAtMs: T(2026, 8, 5), qty: 16, locationId: W }
  const plan = planStockShift(CHECKS, bought12, bought16)
  eq('점보롤: 계획 성립', plan.ok, true)
  if (plan.ok) {
    eq('점보롤: 세 점검 모두 조정', plan.rows.length, 3)
    eq('점보롤: 8/7 총량 60 에서 64', plan.rows.find(r => r.checkId === 'c0807')?.nextTotal, 64)
    eq('점보롤: 8/12 창고 40 에서 44', plan.rows.find(r => r.checkId === 'c0812')?.locs.find(l => l.locationId === W)?.nextQty, 44)
    eq('점보롤: 8/14 총량 54 에서 58', plan.rows.find(r => r.checkId === 'c0814')?.nextTotal, 58)
    eq('점보롤: 주방 실측 불변', plan.rows.every(r => r.locs.every(l => l.locationId === W)), true)
  }
}

// ── 수령이 마지막 점검 뒤면 조정 대상 없음(잔량 산식이 스스로 반영) ────────
{
  const recent: PurchaseDelta = { receivedAtMs: T(2026, 8, 15), qty: 12, locationId: W }
  const plan = planStockShift(CHECKS, recent, { ...recent, qty: 16 })
  eq('최근 수령: 조정 0건', plan.ok ? plan.rows.length : -1, 0)
}

// ── 백필 점검(과거 날짜, 최근 입력)은 구매를 반영으로 본다 — 축 차이 박제 ──
// 반영 술어는 createdAt 단독 축이라, 8/3 날짜로 8/20 에 입력한 점검도
// 8/5 수령(입력 시각보다 앞)을 이미 담은 것으로 판정된다.
{
  const backfilled: LedgerCheck = {
    id: 'cBack', dateMs: D(2026, 8, 3), createdAtMs: T(2026, 8, 20), isReconcile: false,
    total: 30, hasBreakdown: true, byLoc: [{ locationId: W, qty: 30 }],
  }
  const bought: PurchaseDelta = { receivedAtMs: T(2026, 8, 5), qty: 12, locationId: W }
  const plan = planStockShift([backfilled], bought, { ...bought, qty: 16 })
  eq('백필 점검: 반영으로 판정(+4)', plan.ok ? plan.rows[0]?.nextTotal : null, 34)
}

// ── 삭제(수령 취소 포함): 델타 제거 시 반영 점검에서 수량이 빠진다 ─────────
{
  const bought: PurchaseDelta = { receivedAtMs: T(2026, 8, 5), qty: 12, locationId: W }
  const plan = planStockShift(CHECKS, bought, null)
  eq('구매 삭제: 8/7 총량 48', plan.ok ? plan.rows.find(r => r.checkId === 'c0807')?.nextTotal : null, 48)
  eq('구매 삭제: 8/14 창고 24', plan.ok ? plan.rows.find(r => r.checkId === 'c0814')?.locs.find(l => l.locationId === W)?.nextQty : null, 24)
}

// ── 전체 보정 정지는 구매 델타에도 같다 ───────────────────────────────────
{
  const recon: LedgerCheck = {
    id: 'c0813r', dateMs: D(2026, 8, 13), createdAtMs: T(2026, 8, 13), isReconcile: true,
    total: 95, hasBreakdown: true,
    byLoc: [{ locationId: W, qty: 77 }, { locationId: K4, qty: 9 }, { locationId: K5, qty: 9 }],
  }
  const bought: PurchaseDelta = { receivedAtMs: T(2026, 8, 5), qty: 12, locationId: W }
  const plan = planStockShift([check0807, check0812, recon, check0814], bought, { ...bought, qty: 16 })
  eq('구매 보정 정지: 계획 성립', plan.ok, true)
  if (plan.ok) {
    eq('구매 보정 정지: 8/7·8/12 만 조정', plan.rows.length, 2)
    eq('구매 보정 정지: 보정 뒤 점검 불변', plan.rows.some(r => r.checkId === 'c0814'), false)
  }
}

// ── 음수 거부·귀속 불가 거부는 구매 델타에도 같다 ─────────────────────────
{
  const small: LedgerCheck = {
    id: 'cSmall', dateMs: D(2026, 8, 12), createdAtMs: T(2026, 8, 12), isReconcile: false,
    total: 5, hasBreakdown: true, byLoc: [{ locationId: W, qty: 5 }],
  }
  const bought: PurchaseDelta = { receivedAtMs: T(2026, 8, 5), qty: 12, locationId: W }
  const plan = planStockShift([small], bought, null)
  eq('구매 음수 거부: 계획 실패', plan.ok, false)
  eq('구매 음수 거부: 코드', plan.ok ? '' : plan.code, 'NEGATIVE')
}
{
  const bought: PurchaseDelta = { receivedAtMs: T(2026, 8, 5), qty: 12, locationId: null }
  const plan = planStockShift(CHECKS, bought, { ...bought, qty: 16 })
  eq('구매 귀속 불가: 계획 실패', plan.ok, false)
  eq('구매 귀속 불가: 코드', plan.ok ? '' : plan.code, 'NO_LOCATION')
}

// ── 정정 대칭: 12 에서 16 으로 간 세계에서 16 에서 12 로 돌리면 원값 복귀 ──
{
  const bought12: PurchaseDelta = { receivedAtMs: T(2026, 8, 5), qty: 12, locationId: W }
  const bought16: PurchaseDelta = { receivedAtMs: T(2026, 8, 5), qty: 16, locationId: W }
  const adjusted: LedgerCheck[] = [
    { ...check0807, total: 64, byLoc: [{ locationId: W, qty: 64 }, { locationId: K4, qty: 0 }, { locationId: K5, qty: 0 }] },
    { ...check0812, total: 64, byLoc: [{ locationId: W, qty: 44 }, { locationId: K4, qty: 10 }, { locationId: K5, qty: 10 }] },
    { ...check0814, total: 58, byLoc: [{ locationId: W, qty: 40 }, { locationId: K4, qty: 9 }, { locationId: K5, qty: 9 }] },
  ]
  const plan = planStockShift(adjusted, bought16, bought12)
  eq('구매 정정 대칭: 8/7 총량 60 복귀', plan.ok ? plan.rows.find(r => r.checkId === 'c0807')?.nextTotal : null, 60)
  eq('구매 정정 대칭: 8/14 창고 36 복귀', plan.ok ? plan.rows.find(r => r.checkId === 'c0814')?.locs.find(l => l.locationId === W)?.nextQty : null, 36)
}

// ── 입수 과소 의심 신호(overbookExcess, 백로그 4번) — 실측 > 장부일 때만 ────
eq('과소 신호: 같으면 없음', overbookExcess(10, 10), null)
eq('과소 신호: 부동소수 오차는 없음', overbookExcess(10.0005, 10), null)
eq('과소 신호: 적게 세면(소모) 없음', overbookExcess(8, 10), null)
eq('과소 신호: 많이 세면 초과분', overbookExcess(12, 10), 2)
eq('과소 신호: 소수 초과분 2자리', overbookExcess(10.257, 10), 0.26)
eq('과소 신호: 장부 0 에서 실측 존재', overbookExcess(3, 0), 3)

console.log(`\n재고 원장 리플레이 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
