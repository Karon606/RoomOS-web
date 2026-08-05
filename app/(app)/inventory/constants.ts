export const TRACKED_CATEGORIES = ['부식비', '소모품비', '폐기물 처리비'] as const

// 재고관리 카테고리 = 지출 카테고리(cat) + 재고관리 표시명(alias).
export type InventoryCategory = { cat: string; alias: string }

// 지출 카테고리 → 재고관리 표시명 제안 (사용자가 카테고리를 추가할 때 기본 별칭으로).
export const SUGGESTED_INVENTORY_ALIAS: Record<string, string> = {
  '부식비': '식료품',
  '소모품비': '소모품',
  '폐기물 처리비': '폐기물 처리용품',
  '수선유지비': '수리부품',
  '청소용역비': '청소용품',
}

// 설정(Property.inventoryCategories) 이 없을 때의 기본 재고 카테고리 + 표시명.
export const DEFAULT_INVENTORY_CATEGORIES: InventoryCategory[] = [
  { cat: '부식비', alias: '식료품' },
  { cat: '소모품비', alias: '소모품' },
  { cat: '폐기물 처리비', alias: '폐기물 처리용품' },
]

// 지출 카테고리에 대한 재고 표시명 제안 (없으면 그대로).
export function suggestInventoryAlias(cat: string): string {
  return SUGGESTED_INVENTORY_ALIAS[cat] ?? cat
}

export type PendingPurchase = {
  id: string
  date: Date
  qtyValue: number
  specValue: number | null
  specUnit: string | null
  qtyUnit: string | null
  // null = 금액 읽기 차단 역할에게 서버가 지운 값(C페이즈 2026-08-03). 화면은 금액 자리를 비운다.
  amount: number | null
  vendor: string | null
  memo: string | null
}

export type InventoryRow = {
  id: string
  category: string
  label: string
  specUnit: string | null
  qtyUnit: string | null
  // 표시 전용 단위 폴백 — 잔량 산식에 들어간 구매들의 qtyUnit 이 전원일치일 때만 그 값, 혼재·부재면 null.
  // qtyUnit 이 비어도 잔량이 맨숫자로 보이지 않게 하는 힌트다. 카드 qtyUnit(느슨 매칭 상태)을 대체하지 않는다.
  unitHint: string | null
  alertThresholdDays: number
  // 실효 알림 임계값 = max(설정 D-N, 재주문 리드타임 + 2일) — 판정·표시는 이 값, 설정 폼은 원값(신고 edffb4a7)
  effectiveAlertDays: number
  createdAt: string            // 품목 생성일 ISO — 정렬 프리셋 '최근 추가순'용
  reorderMemo: string | null
  purchaseUrl: string | null       // 구매 링크 (쿠팡·아마존 등)
  memo: string | null              // 재고 파악 기준 등 자유 메모
  trackUnit: 'spec' | 'qty'        // 'spec' = qty×spec 환산 (쌀, 물티슈), 'qty' = qty만 (폐기물 봉투)
  isArchived: boolean
  lastCheckId: string | null
  lastCheckDate: Date | null
  lastCheckCreatedAt: Date | null
  lastRemainingQty: number | null
  currentStock: number | null
  avgDaily: number | null       // 최근 30일 합산 기준 일 평균 소모. 0 = 관측했으나 안 씀, null = 추정 불가
  avgDailyBasisDays: number | null  // avgDaily 를 낸 실제 관측 일수 — 창 경계 구간을 통째로 포함해 30 을 넘을 수 있음
  daysUntilEmpty: number | null
  lastPeriodConsumption: number | null
  lastPeriodDays: number | null
  avgUnitPrice: number | null   // 최근 12개월 구매 평균 단가 (원/qtyUnit)
  lastUnitPrice: number | null  // 가장 최근 구매의 단가
  pendingPurchases: PendingPurchase[]  // 수령 대기 중인 구매 내역
  locations: StorageLocationItem[]    // 이 품목이 보관되는 위치 목록(원본 — 절대 필터 안 함, closedAt 실림)
  // 숨긴 위치(closedAt != null) 중 현재 잔량이 비어(< 0.001) 화면에서 가릴 위치 id. 히스토리 소비자는 무시.
  // 표시 소비자는 이 집합 멤버십으로만 거른다 — 술어(ε·잔량 소스)를 서버 한 곳에 모으기 위함.
  hiddenLocationIds: string[]
  lastCheckLocationBreakdown: LocationQtyEntry[]  // 최신 실사의 위치별 잔량
  // 위치별 '현재' 잔량 = 최신 실사 + 이후 입수·폐기(허브 귀속, 음수 0 클램프). 화면 기준선은 이걸 쓴다 —
  // 점검 시점 값(lastCheck...)을 기준선으로 쓰면 입수 직후 재고가 0 으로 보인다(신고 e48ca8ac 김치 20kg).
  currentLocationBreakdown: LocationQtyEntry[]
  // 최근 6개월 사용량 (YYYY-MM 오래된 것부터, 마지막 슬롯 = 진행 중인 이번 달).
  // qty: 0 = 점검했으나 안 씀, null = 그 달엔 점검 자체가 없음(미관측). 둘을 뭉개면 추적 시작 전 달이 '사용량 0' 으로 보인다.
  monthlyConsumption: { month: string; qty: number | null }[]
}

export type PricePoint = {
  date: Date
  unitPrice: number    // amount / qtyValue
  qty: number
  amount: number
}

export type MonthlyInflowRow = {
  month: string                // "YYYY-MM"
  purchaseQty: number
  additionQty: number
  totalQty: number
  purchaseAmount: number
}

export type StorageLocationItem = {
  id: string
  name: string
  sortOrder: number
  isHub: boolean
  // null/미정의 = 표시(열림). 값 = 이 품목에서 이 위치를 숨긴 시점.
  // 영업장 위치 목록(getStorageLocations)에선 항상 미정의 — 숨김은 (품목,위치) 쌍의 속성이라 영업장 위치엔 없다.
  closedAt?: string | null
}

export type LocationQtyEntry = {
  locationId: string
  locationName: string
  qty: number               // "보충 후" 잔량
  restockedQty?: number     // 이 점검에서 이 위치에 보충한 양 ("전" = qty - restockedQty)
  fromHubQty?: number       // (레거시) 명시적 이동 유입 수량
  fromLocationId?: string   // (레거시) 이동 유입 출처
}

// 영수증→재고 자동등록 시, 새 라벨에 대한 병합 후보(기존 카드)
export type MergeCandidate = { itemId: string; label: string }
// 사용자 확인이 필요한 병합 결정 — 새 라벨 + 후보 카드들
export type MergeDecision = {
  newLabel: string          // 새로 만들려던 라벨
  category: string
  expenseIds: string[]      // 이 결정에 묶인 지출들
  specUnit: string | null
  qtyUnit: string | null
  candidates: MergeCandidate[]
}
// 병합 규칙 (관리 UI용) — LINK: 추천 연결 / MUTE: 추천 안 함(거절 기억)
export type MergeRuleRow = {
  id: string
  category: string
  sourceLabel: string
  kind: 'LINK' | 'MUTE'
  targetItemId: string
  targetLabel: string | null   // 대상 카드가 삭제됐으면 null
}
// 되돌릴 수 있는 병합 (병합 해제 UI용)
export type MergeUndoRow = {
  id: string
  label: string                // "원라벨 → 대상라벨"
  targetLabel: string | null
  kind: 'IMPORT' | 'CARD'
  createdAt: string            // ISO
}

export type TimelineEntry =
  | { type: 'check';    id: string; date: Date; createdAt: Date; remainingQty: number; memo: string | null; locationBreakdown: LocationQtyEntry[]; isHub?: boolean; isReconcile?: boolean }
  | { type: 'purchase'; id: string; date: Date; createdAt: Date; qtyValue: number; qtyUnit: string | null; specValue: number | null; specUnit: string | null; amount: number; vendor: string | null; memo: string | null; receivedAt: Date | null; receivedLocationName: string | null }
  | { type: 'addition'; id: string; date: Date; createdAt: Date; addedQty: number; source: string | null; memo: string | null; storageLocationId: string | null; storageLocationName: string | null }
  | { type: 'disposal'; id: string; date: Date; createdAt: Date; disposedQty: number; reason: string | null; memo: string | null; storageLocationId: string | null; storageLocationName: string | null }
