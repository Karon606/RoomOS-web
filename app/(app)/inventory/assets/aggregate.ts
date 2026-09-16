// 비품·자재 화면 집계의 순수층 — 'use server' 아님(DB·인증 무접점, 계산만).
//
// 왜 갈랐나. 'use server' 파일은 async 함수만 내보낼 수 있어(scripts/check-server-action-exports)
// 이 안의 순수 함수들을 actions.ts 에 두면 진리표가 붙을 수가 없다. 계산 규칙 정본을 밖으로
// 빼고 actions.ts 는 조회·쓰기만 지는 배치다 — inventory/ledgerShift 와 같은 선례.
//
// 여기의 계약 하나. **축이 둘이다.** 돈의 축(방에 들어간 누적 금액)은 절대 안 줄어들고,
// 물건의 축(우리가 사서 넣은 것 중 살아 있는 개수)만 폐기로 줄어든다. 자재비는 살 때 이미
// 나간 돈이라 폐기로 방별 투자금이 줄면 안 된다(knowledge/domain-room-work).
//   amount      = 살아 있는 것 + 폐기된 것   ← 절대 안 줄어든다
//   qtyValue    = 살아 있는 합
//   disposedQty = 폐기 합
// "지금까지 들어간 개수" 는 qtyValue + disposedQty 로 나오는 파생이라 셋째 축을 안 만든다.

export const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000))

// 품목 detail 문자열 재구성 (addExpense 와 동일 포맷: "[라벨] 규격 x 수량단위")
export function buildAssetDetail(e: { itemLabel: string | null; specValue: number | null; specUnit: string | null; specText?: string | null; qtyValue: number | null; qtyUnit: string | null }): string {
  const label = e.itemLabel ?? ''
  const spec = e.specText ? ` ${e.specText}` : e.specValue != null ? ` ${fmtQty(e.specValue)}${e.specUnit ?? ''}` : ''
  const qty = e.qtyValue != null ? ` x ${fmtQty(e.qtyValue)}${e.qtyUnit ?? ''}` : ''
  return `[${label}]${spec}${qty}`
}

// 이력·조회의 규격 식별자 — 아래 집계 키 중 규격 부분과 같은 3종.
// 라벨만으로 기록·조회하면 색상·사이즈가 다른 카드끼리 이력이 섞인다(오류신고 5853a0ff).
export type SpecKey = { specValue: number | null; specUnit: string | null; specText: string | null }

// 규격 식별자 직렬화 — 라벨 내 규격(색상 등) 순서 편집 키(specValue␟specUnit␟specText, SpecKey 3종과 동일 정체성).
// 전부 null이면 '␟␟'라 라벨 행 센티널 ''과 겹치지 않는다.
export const serializeSpecKey = (s: SpecKey): string => [s.specValue ?? '', s.specUnit ?? '', s.specText ?? ''].join('␟')

// ============================================================
// 폐기·분실 게이트 정본 — 서버 액션(disposeAsset)이 이 판정을 그대로 쓴다.
// 여기 있어야 진리표(scripts/test-asset-disposal)가 붙고, 배선 감지망이 "실제로 부르는가"를 본다.
// ============================================================
export type DisposalGateRow = {
  receivedAt: Date | null
  excludeFromInventory: boolean
  disposedAt: Date | string | null
  qtyValue: number | null
  qtyUnit: string | null
}

// 수령 전 거부 — 판정 축은 화면의 '수령 대기' 버킷과 같다(서비스·무형은 수령 개념이 없다).
export const DISPOSAL_DENY_UNRECEIVED = '아직 받지 않은 물건이에요. 주문 취소는 수령 대기에서 하세요.'
export const DISPOSAL_DENY_NONPOSITIVE = '0보다 큰 수량을 입력하세요.'
export const DISPOSAL_DENY_ALL_DISPOSED = '이미 폐기·분실로 기록된 항목이에요.'
// 초과는 **거부**다. 클램프로 조용히 깎으면 운영자가 다른 수량이 빠진 걸 모른다.
export const disposalDenyOver = (have: number, unit: string | null) =>
  `지금 있는 수량(${fmtQty(have)}${unit ?? '개'})보다 많아요.`

/** 폐기 게이트 넷. 통과면 null, 막히면 그 줄 전문. live = 아직 폐기 안 된 대상 행. */
export function disposalDenial(rows: DisposalGateRow[], qty: number | null): string | null {
  const live = rows.filter(r => !r.disposedAt)              // ④ 이미 폐기된 행 제외
  if (!live.length) return DISPOSAL_DENY_ALL_DISPOSED
  if (live.some(r => !r.receivedAt && !r.excludeFromInventory)) return DISPOSAL_DENY_UNRECEIVED   // ①
  if (qty == null) return null                              // null = 전량
  if (!(qty > 0)) return DISPOSAL_DENY_NONPOSITIVE          // ②
  const have = live.reduce((s, r) => s + (r.qtyValue ?? 1), 0)
  if (qty > have + 1e-9) return disposalDenyOver(have, live[0].qtyUnit)   // ③
  return null
}

// 화면 표시용 — 같은 버킷(미배정/방/공용부) 안에서 동일 품목(라벨·규격·단위·카테고리)을
// 하나로 합쳐 표시. 장부(Expense)는 개별 구매 기록 그대로 유지하고 화면만 집계한다.
export type AssetItem = {
  id: string                    // 대표(React key) = ids[0]
  ids: string[]                 // 묶인 지출 id 중 **살아 있는 것**(폐기 행은 disposedIds)
  count: number                 // 묶인 구매 건수(폐기 포함)
  date: string                  // 대표(최신) 일자
  itemLabel: string
  detail: string | null         // 합계 수량으로 재구성
  specText: string | null       // 서술형 규격(카드 구분·검색용)
  specValue: number | null      // 숫자 규격값(60 등) — 카드 제목 규격 병기용(오류신고 86f1418e)
  specUnit: string | null       // 규격 단위(cm 등)
  amount: number                // 합계 금액 — **살아 있는 것 + 폐기된 것**(돈의 축은 안 줄어든다)
  qtyValue: number | null       // 살아 있는(지금 그 자리에 있는) 합계 수량
  qtyUnit: string | null
  category: string
  vendor: string | null
  roomId: string | null
  roomNo: string | null
  locationId: string | null     // 공용부(StorageLocation) 배정 시
  locationName: string | null
  isCommon: boolean             // 공용 자재(페인트 등) 표시
  isService: boolean            // 서비스·무형(시공비) — 자산 아님, 방별 비용 집계용
  assignedAt: string | null     // 방/공용부 배정일(대표=최근). null=미배정 또는 미상
  // 수량 미기록(qtyValue null) 행까지 **게이트·분할과 같은 셈법**으로 센 살아 있는 몫.
  // qtyValue 는 표시용이라 미기록 행을 0으로 접는데, 서버 게이트와 buildSplitOps 는 그 행을 1로
  // 센다. 두 셈이 갈리면 "2를 버렸다고 알고 3이 빠지고", 전 행 미기록 카드는 화면이 max 0 이라
  // 폐기를 아예 못 적는다(장부 검수 2026-09-16). 화면은 이 칸을 쓴다.
  liveUnits: number
  // 폐기·분실 축 — 이 묶음에서 그 자리를 떠난 몫. 돈(amount)에는 그대로 남아 있다.
  disposedAt: string | null     // 대표(가장 최근) 폐기일. 폐기가 없으면 null
  disposalReason: string | null // 대표(가장 최근) 폐기 사유
  disposedQty: number           // 폐기 합계 수량 — liveUnits 와 같은 셈법(미기록 행은 1)
  disposedIds: string[]         // 폐기된 지출 id
  disposals: { id: string; date: string; qty: number | null; amount: number; disposedAt: string; disposalReason: string | null }[]   // 폐기 기록(최근순)
  breakdown: { id: string; date: string; qty: number | null; amount: number; specValue: number | null; specUnit: string | null; specText: string | null; disposed: boolean }[]   // 합산 펼치기 — 개별 구매 내역(행별 규격 수정용 id 포함)
}

export type RawAsset = {
  id: string; date: string; itemLabel: string; amount: number
  qtyValue: number | null; qtyUnit: string | null; specValue: number | null; specUnit: string | null; specText: string | null
  category: string; vendor: string | null
  roomId: string | null; roomNo: string | null; locationId: string | null; locationName: string | null
  isCommon: boolean; received: boolean; assignedAt: string | null
  isService: boolean               // 서비스·무형(시공비 등) — 방별 비용에 포함, 카드에 칩 표시
  disposedAt: string | null        // null = 지금 설치돼 있음. 값(YYYY-MM-DD) = 그 날짜에 빠짐
  disposalReason: string | null
}

// 순서 편집 맵 — 2계층. label = (category␟itemLabel)→라벨 rank, spec = (category␟itemLabel␟specKey)→규격 rank,
// labelMaxSpec = (category␟itemLabel)→그 라벨 규격 rank 최대값(규격 rank 없는 카드의 라벨 내 맨 뒤 폴백용).
export type AssetOrderMaps = { label: Map<string, number>; spec: Map<string, number>; labelMaxSpec: Map<string, number> }

// 한 버킷의 행들을 동일 품목끼리 묶어 AssetItem[] 로 집계.
// 정렬 3단 — ① 라벨 rank(품목 순서, 있으면 오름차순) ② 규격 rank(라벨 안 색상·규격 순서) ③ 기존 구매일 최신순.
// 규격 rank 없는 카드는 그 라벨 내 맨 뒤(전역 MAX로 빠지면 라벨 rank 동률 시 라벨 그룹이 깨진다).
//
// **폐기 행은 같은 카드 안에 남는다.** 집계 키에 폐기 여부가 안 들어가므로 한 품목이 폐기
// 때문에 두 카드로 갈라지지 않고, 버킷 분류도 안 건드린다 — 가르는 일은 오직 여기서만 한다.
// 전량 폐기된 카드가 사라지면 그 방에 든 비용의 행방이 끊긴다(그것이 이 설계의 요점이다).
export function aggregateAssets(list: RawAsset[], orderMaps?: AssetOrderMaps): AssetItem[] {
  const map = new Map<string, { spec: number | null; specUnit: string | null; specText: string | null; rows: RawAsset[] }>()
  for (const r of list) {
    const key = [r.itemLabel, r.specValue ?? '', r.specUnit ?? '', r.specText ?? '', r.qtyUnit ?? '', r.category, r.isCommon ? 'C' : '', r.isService ? 'S' : ''].join('␟')
    const g = map.get(key) ?? { spec: r.specValue, specUnit: r.specUnit, specText: r.specText, rows: [] }
    g.rows.push(r); map.set(key, g)
  }
  const out: AssetItem[] = []
  for (const g of map.values()) {
    const rows = g.rows
    // 물건의 축 — 살아 있는 행만 센다. 돈의 축(amount)은 아래에서 전 행을 더한다.
    const live = rows.filter(r => !r.disposedAt)
    const dead = rows.filter(r => !!r.disposedAt)
    // '수량 미기록(null)' 판정은 **전 행**으로 본다. 살아 있는 행만 보면 전량 폐기된 카드가
    // 0이 아니라 '수량 미기록'이 되어 화면이 `N건`이라고 말한다 — 그 카드의 진실은 0개다.
    // 폐기가 없는 카드에서는 live === rows 라 종전과 한 글자도 안 다르다.
    const hasQty = rows.some(r => r.qtyValue != null)
    const qtyValue = hasQty ? live.reduce((s, r) => s + (r.qtyValue ?? 0), 0) : null
    // liveUnits·disposedQty 는 **게이트·분할과 같은 셈법**(미기록 행 = 1). qtyValue 와 갈리는 것은
    // 수량이 안 적힌 행이 섞였을 때뿐이고, 그때 진실을 말하는 쪽은 이쪽이다.
    const liveUnits = live.reduce((s, r) => s + (r.qtyValue ?? 1), 0)
    const disposedQty = dead.reduce((s, r) => s + (r.qtyValue ?? 1), 0)
    const amount = rows.reduce((s, r) => s + r.amount, 0)
    const date = rows.reduce((d, r) => (r.date > d ? r.date : d), rows[0].date)
    const assignedAt = rows.map(r => r.assignedAt).filter((x): x is string => !!x).sort().pop() ?? null   // 대표=가장 최근 배정일
    // 대표 행은 **살아 있는 것 우선** — 전량 폐기 카드만 폐기 행을 대표로 쓴다.
    // 폐기 행이 대표가 되면 옮기기·합치기가 죽은 행을 집어 든다.
    const rep = live[0] ?? rows[0]
    const disposals = dead
      .map(r => ({ id: r.id, date: r.date, qty: r.qtyValue, amount: r.amount, disposedAt: r.disposedAt!, disposalReason: r.disposalReason }))
      .sort((a, b) => b.disposedAt.localeCompare(a.disposedAt) || b.date.localeCompare(a.date))
    out.push({
      id: rep.id, ids: live.map(r => r.id), count: rows.length, date,
      itemLabel: rep.itemLabel, specText: g.specText, specValue: g.spec, specUnit: g.specUnit,
      detail: buildAssetDetail({ itemLabel: rep.itemLabel, specValue: g.spec, specUnit: g.specUnit, specText: g.specText, qtyValue, qtyUnit: rep.qtyUnit }),
      amount, qtyValue, qtyUnit: rep.qtyUnit, category: rep.category, vendor: rep.vendor,
      roomId: rep.roomId, roomNo: rep.roomNo, locationId: rep.locationId, locationName: rep.locationName,
      isCommon: rep.isCommon, isService: rep.isService, assignedAt, liveUnits,
      disposedAt: disposals[0]?.disposedAt ?? null, disposalReason: disposals[0]?.disposalReason ?? null,
      disposedQty, disposedIds: dead.map(r => r.id), disposals,
      breakdown: rows.map(r => ({ id: r.id, date: r.date, qty: r.qtyValue, amount: r.amount, specValue: r.specValue, specUnit: r.specUnit, specText: r.specText, disposed: !!r.disposedAt }))
        .sort((a, b) => b.date.localeCompare(a.date)),
    })
  }
  const labelRank = (i: AssetItem) => orderMaps?.label.get(`${i.category}␟${i.itemLabel}`) ?? Number.MAX_SAFE_INTEGER
  const specRank = (i: AssetItem) => {
    if (!orderMaps) return 0
    const lk = `${i.category}␟${i.itemLabel}`
    const r = orderMaps.spec.get(`${lk}␟${serializeSpecKey(i)}`)
    if (r != null) return r
    return (orderMaps.labelMaxSpec.get(lk) ?? -1) + 1   // 규격 rank 없는 카드는 그 라벨 내 맨 뒤
  }
  return out.sort((a, b) => {
    const la = labelRank(a), lb = labelRank(b)
    if (la !== lb) return la - lb
    const sa = specRank(a), sb = specRank(b)
    if (sa !== sb) return sa - sb
    return b.date.localeCompare(a.date)
  })
}
