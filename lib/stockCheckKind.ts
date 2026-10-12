// 재고 이력의 점검 한 건이 무슨 기록인지(실측 점검·맞바꿈·위치 이동·수령 반영) 저장 메모와 위치 행으로 가리는 순수함수.
//
// 점검 테이블에는 '종류' 칸이 없다. 맞바꿈·위치 이동·수령 자동 반영도 점검 한 건으로 저장되고, 그 셋을 가르는
// 단서는 저장 메모의 접두뿐이다(운영자 결정 2026-10-12 — 구조 칸 신설은 스키마 변경이라 메모 접두로 읽는다).
// 메모를 만드는 자리는 actions.ts 의 transferLocationStock(맞바꿈·이동)과 confirmReceipt(수령 자동)이고,
// 이 파일은 그 문자열을 **읽기만** 한다. 저장 메모는 백필 매칭 키이기도 해서 화면 사정으로 바꾸지 않는다.
//
// 접두만 믿으면 안 되는 이유 — 같은 날 6시간 안의 위치별 점검은 직전 점검에 **합쳐진다**(updateStockCheck
// locationPatch). 합쳐도 메모는 첫 저장 그대로라, 맞바꿈 메모를 단 기록에 손으로 센 실측과 채움 마커가 얹힐 수
// 있다. 수령 자동 점검도 2026-09-30 합치기 거부 전에는 같은 일이 있었다(DB 실측 47건 중 5건에 채움 마커).
// 그런 기록을 '맞바꿈'·'수령 반영'으로 적으면 사람이 센 값이 가려지고, 수령 반영은 읽기 전용이라 고칠 길까지
// 막힌다. 그래서 가드를 둔다. 가드를 못 지나면 종전처럼 '점검'이다(판별이 안 되는 기록은 지금처럼).
//   · 수령 반영 — 채움 마커도 실측 표식(carried:false)도 없고, 그 수령의 구매가 이력에 있을 때만(고치는 길이 그
//     구매 카드의 수정이라, 구매가 이력에 안 보이면 — 단위가 다른 지출 등 — 읽기 전용은 막다른 길이 된다).
//   · 맞바꿈·위치 이동 — 채움 마커가 없고, 직전 점검과 견준 **값**이 그 동작과 맞을 때만. 맞바꿈은 바뀐 칸이 없거나
//     두 칸이 서로 값의 거울, 이동은 한 칸이 +n 이고 다른 칸이 −n(출발지 실측이면 그 실측 값). 위치 이름으로
//     견주지 않는다 — 메모의 이름은 저장 당시 표기 경로라 그 뒤 위치를 옮기거나 이름을 바꾸면 옛 기록이 전부 '점검'이
//     된다(검수 실측 맞바꿈·이동 20건 중 8건). 바뀌지 않은 행에 실측 표식(carried:false)이 있으면 합쳐진 손 실측
//     신호라 '점검'이다 — 뒤 점검 전파(lib/stockLedger planCheckPropagation)는 값이 그대로인 행에 이월(true)을 찍는다.

export type KindLoc = { locationId: string; locationName: string; qty: number; restockedQty?: number; carried?: boolean | null }
export type KindCheck = { id: string; memo: string | null; remainingQty: number; locationBreakdown: KindLoc[]; sourceExpenseId?: string | null }
export type LocChange = { locationId: string; locationName: string; from: number; to: number }
export type CheckKind =
  | { kind: 'check' }
  | { kind: 'swap' | 'move'; memoBody: string; changes: LocChange[]; totalSame: boolean }
  | { kind: 'receipt'; memoBody: string }

// 생성 자리의 문자열과 한 벌이다(scripts/test-stock-check-kind 가 actions.ts 의 템플릿을 소스째 대조한다).
//   맞바꿈 `맞바꿈: ${fromLoc} ↔ ${toLoc}`
//   이동   `이동: ${fromLoc} → ${toLoc} ${move}` · 출발지 실측이 있으면 뒤에 ` · ${fromLoc} 실측 ${measured}`
//   수령   `[수령 자동] +${receivedQty}${unit}` (백필 `[수령 자동·백필] …` 은 이 접두가 아니다)
const SWAP_RE = /^맞바꿈: (.+) ↔ (.+)$/
const MOVE_RE = /^이동: (.+) → (.+?) (\d+(?:\.\d+)?)(?: · .+ 실측 (\d+(?:\.\d+)?))?$/
const RECEIPT_PREFIX = '[수령 자동] '
// 위치별 점검 패널의 저장 메모 — 백필(`^위치별 점검 \((.+)\)$`)이 이 문자열을 키로 문다(DB 불변, 화면만 바꿔 읽는다).
const PANEL_RE = /^위치별 점검 \((.+)\)$/
// 품목 등록의 시작 수량 점검(actions createTrackedItem) · 2026-08-05 수령 백필 점검(`[수령 자동·백필] 수령 N건 합산`).
const START_MEMO = '[시작 재고]'
const BACKFILL_RE = /^\[수령 자동·백필\] (.+)$/

const same = (a: number, b: number) => Math.abs(a - b) < 1e-6
const round2 = (n: number) => Math.round(n * 100) / 100

/** 직전 점검과 비교해 값이 바뀐 칸 — 이번 점검의 행 차례(트리 순서)대로, 직전에만 있던 칸은 뒤에 0 으로. 없는 행은 0 이다. */
export function changedLocs(prev: Pick<KindCheck, 'locationBreakdown'>, cur: Pick<KindCheck, 'locationBreakdown'>): LocChange[] {
  const before = new Map(prev.locationBreakdown.map(l => [l.locationId, l]))
  const out: LocChange[] = []
  for (const l of cur.locationBreakdown) {
    const p = before.get(l.locationId)
    before.delete(l.locationId)
    const from = p?.qty ?? 0
    if (!same(from, l.qty)) out.push({ locationId: l.locationId, locationName: l.locationName, from, to: l.qty })
  }
  for (const p of before.values()) {
    if (!same(p.qty, 0)) out.push({ locationId: p.locationId, locationName: p.locationName, from: p.qty, to: 0 })
  }
  return out
}

/**
 * 점검 한 건의 종류. prev 는 이력에서 바로 앞(더 이른) 점검이다 — 없으면 맞바꿈·이동은 견줄 데가 없어 '점검'.
 * purchaseIds 는 이력에 보이는 구매 id 들이다 — 넘기면 그 안에 수령의 구매가 없는 수령 자동 점검을 '점검'으로 둔다.
 */
export function classifyCheck(cur: KindCheck, prev: KindCheck | null, purchaseIds?: ReadonlySet<string>): CheckKind {
  const memo = cur.memo ?? ''
  const hasMarker = cur.locationBreakdown.some(l => (l.restockedQty ?? 0) > 0)
  if (memo.startsWith(RECEIPT_PREFIX)) {
    const measured = cur.locationBreakdown.some(l => l.carried === false)
    const orphan = purchaseIds != null && (cur.sourceExpenseId == null || !purchaseIds.has(cur.sourceExpenseId))
    return hasMarker || measured || orphan ? { kind: 'check' } : { kind: 'receipt', memoBody: memo.slice(RECEIPT_PREFIX.length) }
  }
  const swap = SWAP_RE.exec(memo)
  const move = swap ? null : MOVE_RE.exec(memo)
  if (!swap && !move) return { kind: 'check' }
  if (hasMarker || !prev) return { kind: 'check' }
  const changes = changedLocs(prev, cur)
  const changedIds = new Set(changes.map(c => c.locationId))
  // 이동 점검이 스스로 찍는 실측 표식 — 출발지를 직접 셌고 그 값이 직전과 같아 행이 안 바뀐 경우, 그 출발지 행
  // 하나(실측 값과 같은 carried:false)는 합쳐진 손 실측이 아니다(lib/transferCheck 가 출발지 실측 행에만 false 를 찍는다).
  let selfMeasured: string | null = null
  let fits: boolean
  if (swap) {
    fits = changes.length === 0 || (changes.length === 2 && same(changes[0].from, changes[1].to) && same(changes[0].to, changes[1].from))
  } else {
    const n = Number(move![3])
    const measured = move![4] != null ? Number(move![4]) : null
    const dest = changes.find(c => same(c.to - c.from, n))
    const src = changes.find(c => c !== dest)
    // 출발지를 직접 셌는데 그 값이 직전과 같으면 출발지 행은 안 바뀐다 — 바뀐 칸이 도착지 하나뿐이어도 맞는 이동이다.
    fits = dest != null && (changes.length === 2
      ? src != null && (measured != null ? same(src.to, measured) : same(src.from - src.to, n))
      : changes.length === 1 && measured != null)
    if (fits && changes.length === 1 && measured != null) {
      selfMeasured = cur.locationBreakdown.find(l => l.carried === false && !changedIds.has(l.locationId) && same(l.qty, measured))?.locationId ?? null
    }
  }
  if (!fits || cur.locationBreakdown.some(l => l.carried === false && !changedIds.has(l.locationId) && l.locationId !== selfMeasured)) return { kind: 'check' }
  return {
    kind: swap ? 'swap' : 'move',
    memoBody: memo.slice(memo.indexOf(': ') + 2),
    changes,
    totalSame: round2(cur.remainingQty) === round2(prev.remainingQty),
  }
}

/** 이력의 점검들(최신이 앞)을 한 번에 가린다 — 각 점검의 prev 는 배열에서 바로 뒤 점검이다. */
export function classifyChecks<T extends KindCheck>(checksDesc: T[], purchaseIds?: ReadonlySet<string>): Map<string, CheckKind> {
  const out = new Map<string, CheckKind>()
  checksDesc.forEach((c, i) => out.set(c.id, classifyCheck(c, checksDesc[i + 1] ?? null, purchaseIds)))
  return out
}

/**
 * 이력 카드에 적을 메모 — 화면 표시만 바꾼다(저장 메모는 그대로).
 *   · 맞바꿈·이동·수령 반영으로 가린 기록은 머리 종류가 이미 그 말을 하므로 접두를 뗀다.
 *   · 위치별 점검 패널의 `위치별 점검 (4층 주방)` 은 `4층 주방에서 위치별 점검` 으로 읽는다.
 *   · `[시작 재고]` 는 `시작 재고`, `[수령 자동·백필] 수령 1건 합산` 은 `수령 1건 합산 · 자동 백필` 로 읽는다.
 *     '점검' 으로 가린 수령 자동 기록의 `[수령 자동] +20kg` 은 `수령 +20kg · 자동 반영` 이다.
 */
export function checkMemoText(memo: string | null, kind: CheckKind): string | null {
  if (!memo) return null
  if (kind.kind !== 'check') return kind.memoBody
  const m = PANEL_RE.exec(memo)
  if (m) return `${m[1]}에서 위치별 점검`
  // 기계가 단 꼬리표 메모 — 대괄호 꼬리표는 화면 낱말이 아니다(저장 문자열은 그대로).
  if (memo === START_MEMO) return '시작 재고'
  const b = BACKFILL_RE.exec(memo)
  if (b) return `${b[1]} · 자동 백필`
  // 수령 자동 꼬리표가 남았는데 '점검' 으로 가린 기록(손 실측이 합쳐졌거나 구매가 이력에 없다) — 꼬리표만 낱말로 읽는다.
  if (memo.startsWith(RECEIPT_PREFIX)) return `수령 ${memo.slice(RECEIPT_PREFIX.length)} · 자동 반영`
  return memo
}
