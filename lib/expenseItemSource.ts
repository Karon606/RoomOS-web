// 단일 품목 지출 저장의 정본(itemsJson)을 골라 낱개 폼 필드 위에 얹는 판정.
//
// 왜 필요한가. 지출 폼은 같은 품목을 **두 벌**로 보낸다 — hidden itemsJson 과 낱개 hidden 필드들.
// 저장 직전 확인창(단위 게이트·품명 분리 게이트)은 고친 값을 itemsJson 에만 실어 보내는데,
// 서버는 품목이 2개 이상이거나 방별 분배가 있을 때만 itemsJson 을 읽었다. 그래서 **1품목 저장에서만**
// 교정이 통째로 증발했다(김치를 '박스'로 바꿔 저장했는데 '개'로 들어간 신고 85343c79).
//
// 규칙은 하나다. **itemsJson 이 정본이고, 거기 없는 값만 낱개 필드로 채운다.**
// 없음의 기준은 undefined 뿐이다 — 빈 문자열은 '지웠다'는 뜻이라 정본으로 존중한다.

// itemsJson 한 건에서 읽는 값들(ItemPick 의 부분집합 — 낱개 폼 필드와 짝이 있는 것만).
export type SoleItemSource = {
  label?: string
  specValue?: string
  specUnit?: string
  specText?: string
  brand?: string
  productName?: string
  qtyValue?: string
  qtyUnit?: string
  // 단가 기준('spec'|'qty') — 수정 폼에만 있는 칸이라 선택 짝이다(아래 SingleItemFields 주석 참고).
  unitBasis?: string
}

// 서버가 낱개로 읽던 폼 필드들. 이름은 formData 키 그대로 둔다.
export type SingleItemFields = {
  itemLabel: string
  specValue: string
  specUnit: string
  specText: string
  brand: string
  productName: string
  qtyValue: string
  qtyUnit: string
  // 선택 짝 — 등록 폼에는 이 hidden 칸이 아예 없다. 안 넘기면 결과에도 없어 종전 거동 그대로다.
  // 수정 폼에는 있고, 내구재 세트 환산이 바로 이 칸을 'qty' 로 바꾸므로 정본 판정에 넣어야 한다.
  unitBasis?: string
}

export function resolveSingleItemFields(
  items: SoleItemSource[] | null | undefined,
  isMultiPath: boolean,
  form: SingleItemFields,
): SingleItemFields {
  // 다품목·방별 분배는 이미 itemsJson 을 정본으로 쓰는 갈래다 — 낱개 필드를 아예 안 본다.
  if (isMultiPath) return form
  // itemsJson 이 없거나 1건이 아니면 낱개 필드가 유일한 원천이다(기존 저장 결과 그대로).
  if (!items || items.length !== 1) return form
  const it = items[0]
  const pick = (v: string | undefined, fallback: string) => (v === undefined ? fallback : v)
  return {
    itemLabel:   pick(it.label,       form.itemLabel),
    specValue:   pick(it.specValue,   form.specValue),
    specUnit:    pick(it.specUnit,    form.specUnit),
    specText:    pick(it.specText,    form.specText),
    brand:       pick(it.brand,       form.brand),
    productName: pick(it.productName, form.productName),
    qtyValue:    pick(it.qtyValue,    form.qtyValue),
    qtyUnit:     pick(it.qtyUnit,     form.qtyUnit),
    // 선택 짝이라 폼이 그 칸을 안 넘겼으면 결과에도 없는 채로 둔다(등록 폼 거동 불변).
    unitBasis: form.unitBasis === undefined
      ? undefined
      : (it.unitBasis === undefined ? form.unitBasis : it.unitBasis),
  }
}
