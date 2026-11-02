// 규격이 다른 구매를 같은 품목으로 둘지 물을 자리인가를 가르는 정본(순수). 지출 등록·수정·대기 영수증 승인·서버 저장이 한 벌로 쓴다
//
// 왜(신고 573b2e06 세탁조크리너, 운영자 결정 2026-11-02 '다른 제품은 따로 둔다, 묻는 기능은 남긴다'). 카드 단위가 '개'인 세탁조크리너에
// 450ml 을 '개'로 적으면 이름·수량 단위가 같아 그대로 그 카드에 붙었다. 크기가 곧 다른 물건인 구매를 묻지도 않고 섞은 것이다.
// 종전에는 이 판정이 지출 등록 화면 안에만 있었고, 대기 영수증 승인과 지출 수정은 묻지 않았다.
//
// 묻는 조건은 전부 AND 다(보수 편향). 하나라도 어긋나면 침묵한다.
//   · 이름에 숫자가 없다(크기가 이미 이름에 있으면 그것이 정체성이다)
//   · 규격 값·단위가 있고, 그 규격이 수량 계산에 참여하지 않는다(규격 × 수량 단위가 곱해지면 그건 양이다)
//   · 같은 이름의 활성 카드가 있고, 그 카드가 개수로 세거나, 규격으로 세는데 새 규격이 카드 단위로 환산되지 않는다
//   · 그 이름으로 적은 규격 이력이 있고, 새 규격이 이력의 어느 것과도 물리 동치가 아니다(classifySpecChoice 'new')
import { specMultiplier } from './units'
import { classifySpecChoice } from './specNotation'

export type SizeHistory = { value: number; unit: string; count?: number }

export const sizeText = (v: number, u: string) => `${Number(v.toFixed(6))}${u}`

export function sizeIdentityAsks(
  it: { label: string; specValue: number | string | null | undefined; specUnit: string | null | undefined; qtyUnit: string | null | undefined },
  card: { trackUnit: string; specUnit: string | null } | null | undefined,
  history: SizeHistory[],
): boolean {
  const label = (it.label ?? '').trim()
  if (!label || /\d/.test(label)) return false
  const v = Number(it.specValue)
  const u = (it.specUnit ?? '').trim()
  if (!(v > 0) || !u) return false
  if (specMultiplier(v, u, it.qtyUnit) != null) return false
  if (!card) return false
  if (card.trackUnit !== 'qty' && specMultiplier(v, u, card.specUnit) != null) return false
  if (!history.length) return false
  return classifySpecChoice({ specValue: v, specUnit: u }, history.map(h => ({ specValue: h.value, specUnit: h.unit }))) === 'new'
}

// 이력 규격을 물리 동치로 묶는다(2.1L 과 2100ml 은 한 규격). 묻는 창이 '여러 규격' 을 셀 때 쓴다.
export function groupSizes(history: SizeHistory[]): { value: number; unit: string; count: number }[] {
  const out: { value: number; unit: string; count: number }[] = []
  for (const h of history) {
    const hit = out.find(s => classifySpecChoice({ specValue: h.value, specUnit: h.unit }, [{ specValue: s.value, specUnit: s.unit }]) !== 'new')
    if (hit) hit.count += h.count ?? 1
    else out.push({ value: h.value, unit: h.unit, count: h.count ?? 1 })
  }
  return out
}
