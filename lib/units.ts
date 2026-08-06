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

// 단위 변경(L→ml 등) 시 저장값에 곱할 배율. from→to 환산 불가면 null.
export function unitFactor(from: string | null | undefined, to: string | null | undefined): number | null {
  return convertUnit(1, from, to)
}

// 규격 배수 정본 — qtyValue 에 곱할 규격값을 정한다. 곱하면 안 되는 경우 null.
//   · 품목 단위로 환산 가능(동일 표기 포함) → 환산값 (기존과 동일).
//   · specUnit 없음/미상('개'·'롤' 같은 비물리 표기) → 원값 그대로 (구식 데이터 폴백, 기존과 동일).
//   · specUnit 이 알려진 물리 단위인데 품목 단위와 차원이 다르면(예: 규격 120g, 품목 단위 '개')
//     그 규격은 개당 중량·용량 같은 속성이지 포장 입수량이 아니다 → null, 호출부는 qtyValue 만 쓴다.
//     "120g x 100개"가 100×120=12,000개로 계산되던 버그(오류신고 0d6242f0)의 근본 수정.
//   서버·클라이언트의 모든 규격 곱셈은 반드시 이 함수를 거칠 것(convertUnit 직접 곱셈 금지).
export function specMultiplier(
  specValue: number | null | undefined,
  specUnit: string | null | undefined,
  itemUnit: string | null | undefined,
): number | null {
  if (specValue == null || !(specValue > 0)) return null
  const converted = convertUnit(specValue, specUnit, itemUnit)
  if (converted != null) return converted
  if (isConvertibleUnit(specUnit) && canonicalUnit(itemUnit) != null) return null
  return specValue
}

// 규격 단위 차원 불일치 여부 — 수령·저장 단계 경고 표시와 감사 스크립트용.
export function isSpecDimensionMismatch(
  specUnit: string | null | undefined,
  itemUnit: string | null | undefined,
): boolean {
  return isConvertibleUnit(specUnit) && canonicalUnit(itemUnit) != null && convertUnit(1, specUnit, itemUnit) == null
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

// 표시용 크기 토큰 단위 집합 — app/(app)/inventory/actions.ts 의 sizeSignature(병합 가드)와 동일하다.
// 한쪽만 바꾸면 "화면에서는 크기로 떼어낸 값"과 "병합이 크기로 보는 값"이 갈린다. 집합을 바꾸면 양쪽을 함께.
const SIZE_UNITS = 'l|ml|g|kg|cm|mm|m|인치'
//   뒤에 글자·숫자가 붙으면(20L들이·1m2) 크기 표기가 아니다.
const SIZE_TOKEN = new RegExp(`\\d+(?:\\.\\d+)?\\s*(?:${SIZE_UNITS})(?![a-z0-9가-힣])`, 'gi')

// 이름 꼬리에 붙은 크기 표기를 캡션으로 떼어낸다 — **표시 전용**.
//   "종량제쓰레기봉투 (20L)" → { base: '종량제쓰레기봉투', size: '20L' }
//   "음식물쓰레기봉투 50L"   → { base: '음식물쓰레기봉투', size: '50L' }
// 정체성·병합 키·검색 매칭은 라벨 원문 그대로 쓴다. 여기서 떼어낸 값은 화면 밖으로 나가지 않는다.
// 토큰이 없거나(특수마대) 둘 이상이거나(장판몰딩 12m x 7.4cm) 이름 중간에 있으면 null — 호출부는 원문 폴백.
export function splitSizeLabel(label: string): { base: string; size: string } | null {
  const matches = [...label.matchAll(SIZE_TOKEN)]
  if (matches.length !== 1) return null
  const m = matches[0]
  const start = m.index
  const after = label.slice(start + m[0].length)
  if (!/^\s*\)?\s*$/.test(after)) return null            // 꼬리가 아니면 건드리지 않는다
  const before = label.slice(0, start).replace(/\s+$/, '')
  const hasOpen = before.endsWith('(')
  if (hasOpen !== after.includes(')')) return null       // 괄호 짝이 안 맞으면 원문 폴백
  const base = (hasOpen ? before.slice(0, -1) : before).trim()
  if (!base) return null                                 // 이름이 통째로 크기면 뗄 것이 없다
  return { base, size: m[0].replace(/\s+/g, '') }
}
