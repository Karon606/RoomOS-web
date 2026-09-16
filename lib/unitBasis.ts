// 지출 단가 기준(규격당 / 완제품 1개당) 정본 — **기록이 있으면 따르고, 없으면 규칙으로 간다.**
//
// 왜 한 자리로 모았나(2026-09-17, 신고 73c18e13).
// 운영자 원문 — "단가 기본이 L당으로 잡혀. 이전에 어떻게 저장했는지에 따라서 기준을 맞춰가면
// 좋겠는데…". 봉투 20매를 샀는데 단가가 `1L 당 100원`으로 잡혔다. 실제로는 1매 500원이다.
//
// 기준을 정하는 자리가 다섯이었는데 **규칙을 아는 곳은 하나뿐**이었다.
//   · 지출 폼 피커 휴리스틱      — 길이·부피·추적단위를 다 알았다
//   · 피커 리셋 세 자리           — 무조건 'spec'
//   · 담은 품목의 basisOf         — `it.unitBasis ?? 'spec'`
//   · 영수증 인식 행              — 기준을 아예 안 실었다(= 위 'spec' 으로 떨어진다)
//   · 과거 복원(getLastItemUnits) — 기록이 없는데 **규격 값이 있다는 이유로 'spec' 을 날조**했고,
//                                   받는 쪽이 그것을 사람이 고른 값으로 대접해 basisTouched 를 세워
//                                   부피 판정을 통째로 껐다
// 그래서 2026-08-05 에 운영자가 직접 지적해 만든 규칙(isVolumeSizeLabel)이 날조된 과거값에 덮였다.
// 한 자리만 고치면 나머지 넷에서 또 샌다 — 다섯이 이 파일을 부른다.
//
// **날조하지 않는다.** 기록이 없으면 null 이고, 그때 비로소 규칙이 답한다. 규칙은 언제 다시 물어도
// 같은 답을 주므로 '없음'을 지어내 박제할 이유가 없다.
//
// 재고 환산(lib/units 의 specMultiplier)과는 **다른 축이다.** 저쪽은 specValue·specUnit·품목 단위로만
// 계산하고 unitBasis 를 보지 않는다 — 여기서 기준이 바뀌어도 재고 수학은 한 톨도 안 움직인다.
import { isLengthUnit, isVolumeSizeLabel } from './units'

export type UnitBasis = 'spec' | 'qty'

/** 저장된 기준 — 'spec'|'qty' 만 기록으로 인정한다. 빈 값·옛 표기·null 은 전부 '기록 없음'이다. */
export function storedUnitBasis(raw: string | null | undefined): UnitBasis | null {
  return raw === 'spec' || raw === 'qty' ? raw : null
}

/** 기준을 정할 때 보는 것 전부. 모르는 칸은 그냥 비워 둔다(안 알려진 것은 판정에 안 쓴다). */
export type UnitBasisFacts = {
  specUnit?: string | null
  qtyUnit?: string | null
  /** 서술형 규격(색상·치수 등). 있으면 계산 비관여라 규격당이 뜻이 없다. */
  specText?: string | null
  /** 이 품목의 재고 추적 단위 — 'qty' 면 개당 단가가 기본(오류신고 c7cf6180). */
  trackUnit?: string | null
}

/**
 * 기록이 없을 때의 기준. 규칙은 이 네 줄이 전부다.
 *   ① 서술 규격이면 개당 — 계산에 안 들어가는 규격이라 나눌 수가 없다.
 *   ② 규격 단위가 길이면 개당 — 장판 1cm당 가격은 뜻이 없다(오류신고 4e2ffe04).
 *   ③ 부피 규격 + 매·장 수량이면 개당 — 그 부피는 양이 아니라 **물건의 크기 표시**다.
 *      종량제봉투 50L 20매에 25,000원이면 1매당 1,250원이지 리터당 25원이 아니다(운영자 2026-08-05).
 *   ④ 품목의 재고 추적 단위가 '수량'이면 개당 — 봉투·장판 등(오류신고 c7cf6180).
 * 그 밖은 규격당이다(40개입 3박스 = 120개당).
 */
export function inferUnitBasis(f: UnitBasisFacts): UnitBasis {
  if ((f.specText ?? '').trim()) return 'qty'
  if (isLengthUnit(f.specUnit)) return 'qty'
  if (isVolumeSizeLabel(f.specUnit, f.qtyUnit)) return 'qty'
  if (f.trackUnit === 'qty') return 'qty'
  return 'spec'
}

/** 기록이 있으면 그대로, 없으면 규칙. 기준을 읽는 모든 자리가 이 함수 하나를 부른다. */
export function resolveUnitBasis(f: UnitBasisFacts & { recorded?: string | null }): UnitBasis {
  return storedUnitBasis(f.recorded) ?? inferUnitBasis(f)
}
