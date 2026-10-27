// 방 점검을 만들 때 넣을 항목을 정하는 순수 함수(영업장 목록 + 그 방 비품 품명). DB 를 모른다.
//
// 항목 이름은 만드는 순간의 스냅샷이다. 목록 이름을 바꾸거나 비품을 폐기해도 이미 만든 점검의 항목은 안 바뀐다
// (운영자 승인 2026-10-27). 그래서 여기서 정한 글자가 곧 그 점검의 기록이다.
//
// 비품 규칙(승인 계획 그대로). 그 영업장·그 방 지출 행 중 받았고(receivedAt) 폐기 안 했고(disposedAt) 배송비 줄이 아니고
// 재고 제외 표시가 없고 품명이 있으며 소모품으로 추적하는 카테고리가 아닌 것. 분류 관리 '점검 제외 품목' 에 적은 품명은 뺀다.
// 같은 품명이 여러 행이면 한 항목이다(의자 둘을 따로 샀어도 '의자' 하나를 본다). 영업장 목록에 이미 있는 이름도 한 번만 선다.

export type SeedStage = 'CHECKOUT' | 'AFTER_CLEANING' | 'BEFORE_MOVEIN'

export type SeedAssetRow = {
  id: string
  itemLabel: string | null
  category: string
  receivedAt: Date | string | null
  disposedAt: Date | string | null
  isShipping: boolean
  excludeFromInventory: boolean
}

export type SeedItem = {
  label: string
  sortOrder: number
  source: 'TEMPLATE' | 'ASSET'
  expenseId: string | null
}

/** 이름 비교 열쇠. 앞뒤 공백을 걷고 안쪽 공백을 하나로 접는다(목록 이름 정규화와 같은 잣대). */
export function inspectionLabelKey(label: string): string {
  return label.trim().replace(/\s+/g, ' ')
}

/** 이 지출 행이 퇴실 점검에 들어갈 비품인가. DB 조회 조건과 같은 규칙을 한 번 더 본다(조회가 넓어져도 여기서 걸린다). */
export function isInspectableAsset(row: SeedAssetRow, trackedCategories: readonly string[]): boolean {
  if (!row.receivedAt || row.disposedAt) return false
  if (row.isShipping || row.excludeFromInventory) return false
  if (!row.itemLabel || !inspectionLabelKey(row.itemLabel)) return false
  if (trackedCategories.includes(row.category)) return false
  return true
}

/**
 * 점검 항목을 정한다. 영업장 목록 차례가 먼저 서고, 비품을 넣는 단계면 그 뒤에 비품 품명이 지출 행 차례(부르는 쪽이 정렬한다)로 선다.
 * 빈 이름·중복 이름은 한 번만 선다. sortOrder 는 0부터 빈틈없이 매긴다.
 */
export function seedInspectionItems(input: {
  stage: SeedStage
  template: readonly string[]
  assets: readonly SeedAssetRow[]
  excluded: readonly string[]
  trackedCategories: readonly string[]
  /** 비품 품명을 넣는 단계(inspectionConstants INSPECTION_ASSET_STAGES). */
  assetStages: readonly SeedStage[]
}): SeedItem[] {
  const out: SeedItem[] = []
  const seen = new Set<string>()
  for (const raw of input.template) {
    const label = inspectionLabelKey(raw)
    if (!label || seen.has(label)) continue
    seen.add(label)
    out.push({ label, sortOrder: out.length, source: 'TEMPLATE', expenseId: null })
  }
  if (!input.assetStages.includes(input.stage)) return out
  const excluded = new Set(input.excluded.map(inspectionLabelKey).filter(Boolean))
  for (const row of input.assets) {
    if (!isInspectableAsset(row, input.trackedCategories)) continue
    const label = inspectionLabelKey(row.itemLabel as string)
    if (excluded.has(label) || seen.has(label)) continue
    seen.add(label)
    out.push({ label, sortOrder: out.length, source: 'ASSET', expenseId: row.id })
  }
  return out
}
