// 지출 저장 직전 '단위가 재고와 다릅니다' 확인창의 판정 정본(이력 최빈 단위와 품목 묶음).
//
// 왜 필요한가(2026-10-09 재활용품수거봉투 사건, 운영자 승인 설계). 확인창은 재고 카드의 qtyUnit 과
// 지출에 적은 단위를 대조해 품목마다 물었다. 그런데 품목 병합으로 '어떤 단위든 받는 카드'가 된 카드는
// qtyUnit 이 비어 있어 조회에서 빠졌고, 같은 지출에 60L 은 묻고 100L 은 묻지 않는 일이 생겼다.
// 그 카드의 단위는 지출 이력에 남아 있으니 이력의 최빈 단위를 대신 쓴다(dominantUnit).
// 또 같은 단위를 같은 단위로 바꾸라는 물음을 품목 수만큼 연달아 띄우면 피로해 하나로 묶는다.
//
// 서버(이력 조회)와 화면(확인창)이 같은 함수를 부른다. 규칙이 두 벌이 되면 묻는 조건이 갈린다.

export type UnitSource = 'card' | 'history'

// 가장 많이 쓴 단위. 동률이면 뒤에 온 것(호출부가 오래된 순으로 넘기므로 최근 것)을 고른다.
// 앞뒤 공백은 털고 빈 값은 세지 않는다. 남는 것이 없으면 null(묻지 않는다).
export function dominantUnit(units: string[]): string | null {
  const count = new Map<string, number>()
  const lastAt = new Map<string, number>()
  units.forEach((raw, i) => {
    const u = (raw ?? '').trim()
    if (!u) return
    count.set(u, (count.get(u) ?? 0) + 1)
    lastAt.set(u, i)
  })
  let best: string | null = null
  for (const [u, n] of count) {
    if (best === null) { best = u; continue }
    const bn = count.get(best)!
    if (n > bn || (n === bn && lastAt.get(u)! > lastAt.get(best)!)) best = u
  }
  return best
}

export type UnitMismatchGroup = {
  entered: string
  target: string
  source: UnitSource
  indexes: number[]
  labels: string[]
}

// 단위가 어긋난 품목을 (적은 단위, 바꿀 단위, 근거) 하나당 한 묶음으로 모은다. 확인창은 묶음마다 한 번 뜬다.
// 근거까지 키에 넣는 까닭은 근거마다 확인창 문장이 달라서다(카드: 집계에서 빠진다 / 이력: 이력과 갈린다).
// 카드 정보가 없거나, 적은 단위가 비었거나, 이미 같으면 묻지 않는다. 묶음 순서는 첫 등장 순이다.
// 같은 품명이 두 줄이면 indexes 에는 둘 다 넣고 labels 에는 한 번만 적는다('외 N개' 숫자가 부풀지 않게).
export function groupUnitMismatches(
  items: { index: number; label: string; entered: string }[],
  info: Record<string, { qtyUnit: string; source: UnitSource }>,
): UnitMismatchGroup[] {
  const groups: UnitMismatchGroup[] = []
  const byKey = new Map<string, UnitMismatchGroup>()
  for (const it of items) {
    const label = (it.label ?? '').trim()
    const entered = (it.entered ?? '').trim()
    const card = label ? info[label] : undefined
    const target = (card?.qtyUnit ?? '').trim()
    if (!card || !entered || !target || entered === target) continue
    const key = `${entered}\u0000${target}\u0000${card.source}`
    let g = byKey.get(key)
    if (!g) {
      g = { entered, target, source: card.source, indexes: [], labels: [] }
      byKey.set(key, g)
      groups.push(g)
    }
    g.indexes.push(it.index)
    if (!g.labels.includes(label)) g.labels.push(label)
  }
  return groups
}
