// 재고 잔량을 '잘라 쓰는 길이'로 셀지 '통으로 세는 개수'로 셀지 가르는 축(TrackedItem.trackUnit)의 판정 정본.
//
// 이 축이 뜻하는 것은 "잘라 쓰는 품목인가" 하나다. 장판처럼 재단해 쓰면 길이가 잔량이고(spec),
// 빨래줄 10m 한 세트처럼 통으로 쓰면 세트가 잔량이다(qty). 그런데 아무도 그것을 묻지 않아서
// 영수증에서 카드가 자동 생성될 때 카테고리 기본값이 그냥 굳었고, 빨래줄이 미터로 세어져
// 정합 검사에 걸렸다(2026-09-07 운영자 승인 설계).
//
// 화면(묻는 자리)과 서버(카드를 만드는 자리)가 같은 함수를 부른다. 규칙이 두 벌이 되면
// 묻는 조건과 실제로 만들어지는 값이 갈린다.
import { isLengthUnit } from './units'

export type TrackUnit = 'spec' | 'qty'

// 재단 여부가 애매한 조합인가 — 길이 규격에 개수 단위(세트·롤·개)가 붙은 경우.
//   · 빨래줄 10m 를 1세트 샀다 → 잘라 쓰는지 통으로 쓰는지 영수증만 봐서는 알 수 없다.
//   · 장판 m 를 12m 샀다(수량 자체가 길이) → 잘라 쓴다는 것이 자명하므로 애매하지 않다.
//   · 규격이 길이가 아니면(50L·20kg) 이 축의 물음이 아니다.
export function isCutAxisAmbiguous(
  specUnit: string | null | undefined,
  qtyUnit: string | null | undefined,
): boolean {
  if (!isLengthUnit(specUnit)) return false
  const qty = (qtyUnit ?? '').trim()
  if (!qty) return false
  return !isLengthUnit(qty)
}

// 지출 저장 직전에 물어야 하는가 — 넷 다 만족할 때만 묻는다.
//   tracked  추적 대상 카테고리다(비품·자재는 잔량을 세지 않는다).
//   hasCard  그 품목의 활성 재고 카드가 아직 없다. 있으면 답이 이미 카드에 있다.
//   specUnit·qtyUnit 이 애매한 조합이다(위 isCutAxisAmbiguous).
export function shouldAskCutAxis(input: {
  tracked: boolean
  hasCard: boolean
  specUnit: string | null | undefined
  qtyUnit: string | null | undefined
}): boolean {
  if (!input.tracked) return false
  if (input.hasCard) return false
  return isCutAxisAmbiguous(input.specUnit, input.qtyUnit)
}

// 새 재고 카드의 trackUnit 을 정한다.
//   · 운영자가 저장 직전에 선언한 답이 있으면 그것이 최우선이다(기억은 카드의 trackUnit 자체다).
//   · 답이 없고 애매한 조합이면 안전한 쪽인 qty. 영수증 없이 자동으로 들어오는 경로는 물을 수
//     없어서 여기로 온다. 정정은 재고 관리의 품목 설정 토글이 맡는다.
//   · 그 밖에는 종전대로 카테고리 기본값.
export function resolveTrackUnitForNewCard(input: {
  categoryDefault: TrackUnit
  specUnit: string | null | undefined
  qtyUnit: string | null | undefined
  declared?: TrackUnit | null
}): TrackUnit {
  if (input.declared === 'spec' || input.declared === 'qty') return input.declared
  if (isCutAxisAmbiguous(input.specUnit, input.qtyUnit)) return 'qty'
  return input.categoryDefault
}

// 단위 뒤에 조사 '로/으로' 를 붙인다 — 물음 문구가 단위를 보간하기 때문에 필요하다.
// 받침이 있으면 '으로'(ㄹ 받침만 '로'). '팩로'·'통로' 같은 표기가 확인창에 나가는 것을 막는다.
// 한글이 아닌 표기(m·cm)는 붙여 쓰지 않고 띄운다 — 'm로' 는 읽기 어렵다.
export function unitWithRo(unit: string | null | undefined): string {
  const s = (unit ?? '').trim()
  if (!s) return s
  const code = s.charCodeAt(s.length - 1)
  if (code < 0xac00 || code > 0xd7a3) return `${s} 로`
  const jong = (code - 0xac00) % 28
  return jong === 0 || jong === 8 ? `${s}로` : `${s}으로`
}
