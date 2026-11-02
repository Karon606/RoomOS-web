// 재고 카드 자동 시드의 이름 판정 정본(정규화 키·크기 표시·하위 이름·붙음·거절 규칙). 순수 함수만 둔다
//
// 왜 따로 있나(2026-11-02, 신고 573b2e06 세탁조크리너). 시드는 같은 품명에 규격이 둘 이상 섞이면 모든 묶음에
// 하위 이름('세탁조크리너 1개 (개)')을 붙여 **이미 카드에 붙어 있던 지출까지** 카드 밖으로 옮겼다. 5월 지출이 원래 카드를
// 떠나 새 카드로 갈라진 것이 그것이다. 판정을 서버 액션 파일 안에 두면 진리표로 못 박을 수 없어 여기로 뺐다.
// 서버(inventory/actions.ts)와 진리표(scripts/test-seed-relabel.ts)가 같은 함수를 부른다.

// 라벨 정규화 — 병합 후보 매칭용. 소문자화 + 괄호내용·규격/수량 표기·공백·구분자 제거.
// "종량제쓰레기봉투 (20L)" / "종량제쓰레기봉투 50L" → 둘 다 "종량제쓰레기봉투"
// 이 값은 병합 규칙(LINK·MUTE)의 키다. 바꾸면 기존 규칙이 끊긴다.
export function normalizeLabel(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')                                                // 괄호와 내용
    .replace(/\d+(\.\d+)?\s*(l|ml|g|kg|m|매|개|롤|포|포대|팩|박스|개입|구|호)?/g, ' ') // 숫자(+단위)
    .replace(/[\s\-_.,/]+/g, '')                                               // 공백·구분자
    .trim()
}

// 이름에 박힌 크기 표시. 봉투처럼 **크기가 곧 다른 물건**인 품목에서 이것이 다르면 같은 것이 아니다.
// normalizeLabel 은 병합 후보를 넓게 찾으려고 숫자·단위를 지우는데, 그 공격성 때문에
// "종량제쓰레기봉투 (50L)" 과 "종량제쓰레기봉투 (20L)" 이 같은 키가 됐고 앱이 둘 중 어디에 넣을지
// 물었다. 물을 일이 아니다. 이름에 50L 이라고 적혀 있다(운영자 지적 2026-08-05).
// 아래 단위 집합은 lib/units.ts 의 splitSizeLabel(표시용 크기 캡션 분리)과 동일하다. 바꾸면 양쪽을 함께.
export function sizeSignature(s: string): string {
  const m = s.toLowerCase().match(/\d+(\.\d+)?\s*(l|ml|g|kg|cm|mm|m|인치)\b/g)
  return m ? m.map(x => x.replace(/\s+/g, '')).sort().join(',') : ''
}

/** 크기가 둘 다 적혀 있고 서로 다르면 병합 후보가 아니다. 한쪽만 적혀 있으면 판단하지 않는다. */
export function sizeConflicts(a: string, b: string): boolean {
  const sa = sizeSignature(a), sb = sizeSignature(b)
  return !!sa && !!sb && sa !== sb
}

// 거절(MUTE) 규칙이 이 이름에 걸리는가. 규칙 키(normLabel)는 숫자·단위를 지운 값이라 '450ml 은 따로' 라는 거절이
// '530ml' 까지 막았다. 규칙을 만든 이름과 지금 이름에 크기가 둘 다 있고 서로 다르면 그 거절은 이 이름의 것이 아니다.
// 키는 그대로 둔다(기존 규칙을 끊지 않는다).
export function muteApplies(ruleSourceLabel: string, label: string): boolean {
  return !sizeConflicts(ruleSourceLabel, label)
}

// 이 지출이 지금 카드에 붙어 있는가. 잔량 산식(overview.sumPurchases)과 같은 규칙이다.
// 활성 카드가 같은 카테고리·같은 이름으로 있고, 수량 단위가 둘 다 있을 때만 같아야 한다(느슨 매칭).
export function attachedToCard(card: { qtyUnit: string | null } | null | undefined, expenseQtyUnit: string | null): boolean {
  if (!card) return false
  return !card.qtyUnit || !expenseQtyUnit || card.qtyUnit === expenseQtyUnit
}

// 하위 이름. 규격이 있으면 규격만 붙인다('세탁조크리너 450ml'). 그래야 splitSizeLabel 이 '세탁조크리너'/'450ml' 로 나눠
// 카드 제목과 크기 캡션이 형제 카드와 같은 꼴이 된다. 수량 단위 꼬리('(개)')는 규격이 없을 때(키친타월 (롤)/(팩)),
// 또는 같은 규격에 수량 단위만 다른 묶음이 함께 있어 꼬리 없이는 이름이 겹칠 때만 붙인다.
export function deriveSubLabel(base: string, specValue: number | null, specUnit: string | null, qtyUnit: string | null, withQtyTail = false): string {
  // 이미 라벨에 사이즈/타입이 있으면 그대로
  if (/\d+\s*(L|ml|g|kg|매|개|m)\b/.test(base) || /\([^)]+\)/.test(base)) return base
  const parts: string[] = []
  const hasSpec = !!(specValue && specValue > 0 && specUnit)
  if (hasSpec) parts.push(`${specValue}${specUnit}`)
  if (qtyUnit && (!hasSpec || withQtyTail)) parts.push(`(${qtyUnit})`)
  return parts.length > 0 ? `${base} ${parts.join(' ')}` : base
}

export type SeedGroup = {
  category: string; baseLabel: string
  specValue: number | null; specUnit: string | null; qtyUnit: string | null
}

// 같은 (카테고리, 품명) 묶음들의 최종 이름. attached 는 그 묶음이 지금 카드에 붙어 있는가.
//   · 붙은 묶음은 이름을 그대로 둔다. 이름 이전도 결정 대기도 없다(카드를 떠나게 하지 않는다).
//   · 붙지 않은 묶음이 둘 이상 섞여 있을 때만 하위 이름을 붙인다.
//   · 병합 카드(수량 단위 무시 카드)가 있으면 모두 원래 이름으로 흡수한다(attached 가 이미 참이다).
export function planSubLabels<G extends SeedGroup>(list: G[], attached: (g: G) => boolean): Map<G, string> {
  const out = new Map<G, string>()
  if (list.length === 1) { out.set(list[0], list[0].baseLabel); return out }
  const sameSpec = (a: G, b: G) => (a.specValue ?? null) === (b.specValue ?? null) && (a.specUnit ?? null) === (b.specUnit ?? null)
  for (const g of list) {
    if (attached(g)) { out.set(g, g.baseLabel); continue }
    const tail = list.some(o => o !== g && sameSpec(o, g) && (o.qtyUnit ?? null) !== (g.qtyUnit ?? null))
    out.set(g, deriveSubLabel(g.baseLabel, g.specValue, g.specUnit, g.qtyUnit, tail))
  }
  return out
}

// 병합 확인 창의 기본 선택. 새 이름이 후보 카드와 크기(이름의 크기 표시 또는 그 구매의 규격 글자)로 다르면 다른 물건일 가능성이
// 커서 기본은 '새 품목으로 등록' 이다(운영자 결정 2026-11-02 '다른 제품은 따로 둔다'). 수량 단위만 다른 경우(키친타월 (롤)/(팩))는
// 종전대로 첫 후보에 합치기가 기본이다.
export function differsBySize(newLabel: string, candidateLabel: string, rows: { specValue: number | null; specUnit: string | null }[]): boolean {
  if (sizeConflicts(newLabel, candidateLabel)) return true
  return rows.some(r => {
    if (!(r.specValue != null && r.specValue > 0) || !r.specUnit) return false
    const t = `${Number(r.specValue.toFixed(6))}${r.specUnit.trim()}`
    return newLabel.includes(t) && !candidateLabel.includes(t)
  })
}
