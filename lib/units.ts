// 단위 변환 코어 — 재고관리에서 같은 차원(부피·무게·길이)의 다른 표기법을 자동 환산.
// 예) 주방세제 품목 단위 ml 인데 새 영수증이 L 로 들어와도 1L=1000ml 로 합산.
// 서버(overview·actions)와 클라이언트(InventoryClient) 양쪽에서 import.
//
// 설계 원칙:
//  · 비파괴 — 저장값은 그대로 두고, 계산/표시 시점에 환산한다.
//  · 안전 폴백 — 단위가 비었거나 서로 호환 안 되면 환산하지 않고 원값 유지(기존 동작 = 회귀 0).
//  · oz 는 부피(액량온스)·무게(온스) 양쪽 — 대상 단위의 차원을 보고 자동 선택.

export type UnitDim = 'volume' | 'weight' | 'length'

// 정규(canonical) 단위 → { 차원: 그 차원 기준단위로의 배율 }
//   부피 기준 = ml / 무게 기준 = g / 길이 기준 = mm
const UNIT_DIMS: Record<string, Partial<Record<UnitDim, number>>> = {
  ml:   { volume: 1 },
  cc:   { volume: 1 },
  L:    { volume: 1000 },
  mg:   { weight: 0.001 },
  g:    { weight: 1 },
  kg:   { weight: 1000 },
  t:    { weight: 1_000_000 },
  mm:   { length: 1 },
  cm:   { length: 10 },
  m:    { length: 1000 },
  km:   { length: 1_000_000 },
  inch: { length: 25.4 },
  ft:   { length: 304.8 },
  // oz: 액량온스(부피)·온스(무게) 양쪽. 대상 단위 차원에 맞춰 자동 선택.
  oz:   { volume: 29.5735, weight: 28.3495 },
}

// 입력 표기(소문자) → 정규 단위. 한글·영문·기호 별칭 흡수.
const ALIASES: Record<string, string> = {
  // 부피
  'ml': 'ml', '㎖': 'ml', '밀리리터': 'ml', '미리리터': 'ml',
  'cc': 'cc', '시시': 'cc', '㏄': 'cc',
  'l': 'L', 'ℓ': 'L', '리터': 'L', '리타': 'L', 'litre': 'L', 'liter': 'L',
  // 무게
  'mg': 'mg', '밀리그램': 'mg',
  'g': 'g', '그램': 'g', '그람': 'g', 'gram': 'g',
  'kg': 'kg', '킬로': 'kg', '키로': 'kg', '킬로그램': 'kg', '키로그램': 'kg', 'kilogram': 'kg',
  't': 't', '톤': 't', 'ton': 't',
  // 길이
  'mm': 'mm', '밀리미터': 'mm',
  'cm': 'cm', '센티': 'cm', '센치': 'cm', '센티미터': 'cm',
  'm': 'm', '미터': 'm', '메타': 'm', 'meter': 'm', 'metre': 'm',
  'km': 'km', '킬로미터': 'km',
  'inch': 'inch', 'in': 'inch', '인치': 'inch', '"': 'inch', '″': 'inch',
  'ft': 'ft', '피트': 'ft', 'feet': 'ft', 'foot': 'ft',
  // 양쪽
  'oz': 'oz', '온스': 'oz', 'ounce': 'oz',
}

// 입력 표기를 정규 단위로. 모르는 단위면 다듬은 원문 반환(환산은 안 됨).
export function canonicalUnit(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  return ALIASES[trimmed.toLowerCase()] ?? trimmed
}

function dimsOf(canon: string): Partial<Record<UnitDim, number>> | null {
  return UNIT_DIMS[canon] ?? null
}

// 환산 테이블에 등록된(차원을 아는) 단위인가. '개'·'롤' 같은 비물리 단위는 false.
export function isConvertibleUnit(unit: string | null | undefined): boolean {
  const canon = canonicalUnit(unit)
  return canon != null && dimsOf(canon) != null
}

// value(from 단위)를 to 단위로 환산. 환산 불가(단위 모름·차원 다름)면 null.
//   같은 단위면 그대로. oz↔ml 은 부피, oz↔g 은 무게로 자동.
export function convertUnit(value: number, from: string | null | undefined, to: string | null | undefined): number | null {
  const cf = canonicalUnit(from)
  const ct = canonicalUnit(to)
  if (cf == null || ct == null) return null
  if (cf === ct) return value
  const df = dimsOf(cf)
  const dt = dimsOf(ct)
  if (!df || !dt) return null
  for (const dim of Object.keys(df) as UnitDim[]) {
    const ff = df[dim]
    const ft = dt[dim]
    if (ff != null && ft != null) return value * (ff / ft)
  }
  return null
}

// from·to 가 환산 가능한가(같은 차원 공유 또는 동일 단위).
export function areUnitsCompatible(a: string | null | undefined, b: string | null | undefined): boolean {
  return convertUnit(1, a, b) != null
}

// 환산이 실제로 필요한가 — 호환되면서 단위 표기가 다른 경우.
export function needsConversion(from: string | null | undefined, to: string | null | undefined): boolean {
  const cf = canonicalUnit(from)
  const ct = canonicalUnit(to)
  if (cf == null || ct == null || cf === ct) return false
  return convertUnit(1, from, to) != null
}

// 계산용 — specValue 를 품목 단위(toUnit)로 환산. 환산 불가/단위 없음이면 원값 유지(폴백).
//   기존 데이터(specUnit=null) 나 호환 안 되는 단위는 지금까지처럼 raw 로 합산 → 회귀 0.
export function convertSpecValue(
  specValue: number | null | undefined,
  fromUnit: string | null | undefined,
  toUnit: string | null | undefined,
): number | null | undefined {
  if (specValue == null) return specValue
  const c = convertUnit(specValue, fromUnit, toUnit)
  return c == null ? specValue : c
}

// 단위 변경(L→ml 등) 시 저장값에 곱할 배율. from→to 환산 불가면 null.
export function unitFactor(from: string | null | undefined, to: string | null | undefined): number | null {
  return convertUnit(1, from, to)
}

// 주어진 단위와 같은 차원의 단위 목록(자기 자신 제외) — 단위 변경 드롭다운용.
//   oz 처럼 두 차원에 걸친 단위면 양쪽 차원 단위를 모두 반환.
export function listCompatibleUnits(unit: string | null | undefined): string[] {
  const canon = canonicalUnit(unit)
  if (canon == null) return []
  const self = dimsOf(canon)
  if (!self) return []
  const selfDims = Object.keys(self) as UnitDim[]
  const out: string[] = []
  for (const [u, dims] of Object.entries(UNIT_DIMS)) {
    if (u === canon) continue
    if (selfDims.some(d => dims[d] != null)) out.push(u)
  }
  return out
}
