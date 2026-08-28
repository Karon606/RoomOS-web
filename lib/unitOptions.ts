// 단위 어휘 정본 — 규격·수량 드롭다운의 기본값과, 새 단위를 목록에 적립하는 판정.
//
// 왜 한 곳에 모으는가. 종전에는 어휘가 지출 폼(SPEC_UNITS·QTY_UNITS)과 규격 마법사(GROUPS)
// 두 곳에 나뉘어 있었고 이미 어긋나 있었다. 마법사 주석은 "지출 폼과 동일 집합에서"라고
// 적혀 있었지만 실제로는 한 낱말이 빠져 있었고, 마법사가 수량으로 저장하는 '장·매·알·권'이
// 지출 폼 목록에는 없어 다시 열면 '직접 입력'으로 떨어졌다.
//
// 실사용과도 어긋나 있었다(실측 2026-08-28). 수량 '회' 63건·'매' 30건이 목록에 없는 채로
// 저장돼 있었고 — 운영자가 매번 손으로 친 것이다 — 목록에만 있는 '봉지'는 0건이었다.
//
// **접기(fold)는 비교에만 쓰고 저장 표기는 운영자의 것을 지킨다.** canonicalUnit 결과를 그대로
// 저장하면 '인치'가 'inch' 로 바뀌어 한국어 화면에 영문이 뜬다. 목록에 이미 있는 표기와 같은
// 뜻이면 목록 쪽 표기로 접고, 없으면 친 그대로 넣는다.
//
// **왜 접어야 하는가.** 재고 매칭이 글자 그대로 비교한다(overview.sumPurchases 의 qtyUnit 조건).
// 카드가 'm' 인데 구매가 'M' 이면 그 구매는 잔량에서 통째로 빠지고 경고도 없다.

import { canonicalUnit } from './units'
import { cleanUnit } from './receiptOcr'
import { normalizeCategoryInput, matchExistingCategory } from './categoryInput'

/**
 * 규격 단위 기본값 — '몇 g 짜리', '몇 매 들이' 처럼 한 덩어리의 크기를 재는 말.
 *
 * '봉지'를 뺐다(데이터 0건, 같은 뜻의 '봉'과 두 갈래가 되던 말). '봉'·'컵'을 넣었다 —
 * 라면이 봉지일 수도 컵일 수도 있어서다(운영자 2026-08-28).
 */
export const DEFAULT_SPEC_UNITS = [
  'kg', 'g', 'ml', 'L', '매', 'm', 'cm', 'mm', '장', '개', '봉', '컵', '회', '인분', '알', '권',
]

/**
 * 수량 단위 기본값 — '몇 개 샀나' 를 세는 말.
 *
 * '회'·'매'는 실사용이 각각 63건·30건인데 목록에 없어 매번 손으로 치던 말이다.
 * '컵'은 컵라면·요구르트처럼 낱개로 세는 포장이다.
 */
export const DEFAULT_QTY_UNITS = [
  '개', '박스', '롤', '팩', '봉', '컵', '회', '매', '포대', '망', '단', '포기', '병', '통', '세트',
]

/**
 * 표기 통일 별칭 — **포장 어휘 전용**이다.
 *
 * lib/units 의 ALIASES 와 층이 다르다. 그쪽은 차원 수학에 쓰이는 물리 별칭이고, 이쪽은
 * 목록 접기와 저장 표기에만 쓰인다. 여기 넣은 말은 환산에 일절 관여하지 않는다.
 */
const PACKAGING_ALIASES: Record<string, string> = {
  '봉지': '봉',
}

/** 입력 정화 — 카테고리 정본과 같은 규칙(콤마 제거·연속 공백 축약·앞뒤 공백). */
export function normalizeUnitInput(raw: string | null | undefined): string | null {
  const t = cleanUnit(raw)                      // 글자가 하나도 없는 표기는 버린다
  if (!t) return null
  const n = normalizeCategoryInput(t)
  return n || null
}

/**
 * 같은 단위로 볼 것인가 — 비교용 열쇠. 저장 값으로 쓰지 않는다.
 *
 * 'M' 과 'm', 'ℓ' 와 'L' 은 접는다. '개' 와 '게' 는 안 접는다 — 오타를 사전으로 잡으려 들면
 * 정당한 새 단위까지 앱이 지운다. 오타는 막지 말고 설정에서 지울 수 있게 한다.
 */
export function unitFoldKey(raw: string | null | undefined): string | null {
  const n = normalizeUnitInput(raw)
  if (!n) return null
  const canon = canonicalUnit(n) ?? n
  const packed = PACKAGING_ALIASES[canon] ?? PACKAGING_ALIASES[n] ?? canon
  return packed.replace(/\s+/g, '').toLowerCase()
}

/**
 * 저장할 값과 갱신할 목록 — resolveCategoryForSave 와 같은 계약이다.
 *
 * value    실제로 저장할 표기(목록에 같은 뜻이 있으면 **목록 쪽 표기**, 빈 값이면 null).
 * nextList 설정에 새로 써야 할 목록(추가가 없으면 null).
 *
 * 목록이 이 수를 넘으면 적립을 멈춘다. 저장은 그대로 되고 목록만 안 늘어난다 —
 * 드롭다운이 스크롤 지옥이 되는 것과 오염 폭주를 함께 막는 최소 장치다.
 */
export const UNIT_LIST_MAX = 60

export function resolveUnitForSave(
  list: readonly string[],
  raw: string | null | undefined,
): { value: string | null; nextList: string[] | null } {
  const name = normalizeUnitInput(raw)
  if (!name) return { value: null, nextList: null }

  // 1) 글자가 그대로 같으면 그대로 — 가장 흔한 길에서 접기 계산을 안 한다.
  const exact = matchExistingCategory([...list], name)
  if (exact) return { value: exact, nextList: null }

  // 2) 뜻이 같은 표기가 목록에 있으면 그 표기로 접는다.
  const key = unitFoldKey(name)
  const folded = key ? list.find(u => unitFoldKey(u) === key) : undefined
  if (folded) return { value: folded, nextList: null }

  // 3) 처음 보는 단위 — 친 그대로 저장하고 목록 끝에 붙인다.
  if (list.length >= UNIT_LIST_MAX) return { value: name, nextList: null }
  return { value: name, nextList: [...list, name] }
}

/** 콤마 문자열을 목록으로 — 비었으면 기본값. Property 옵션 칼럼의 읽기 정본과 같은 문법. */
export function parseUnitOptions(raw: string | null | undefined, fallback: readonly string[]): string[] {
  const list = (raw ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return list.length > 0 ? list : [...fallback]
}
