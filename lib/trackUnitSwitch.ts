// 재고 추적 단위(규격 단위 대 수량 단위) 전환이 지난 점검·입수·폐기 값을 몇 배로 바꿔야 하는지 가르는 정본(순수).
//
// 왜(운영자 승인 2026-11-02 '응 진행해'). 종전 품목 설정은 trackUnit 만 바꾸고 저장된 점검·입수·폐기 값을 그대로 뒀다.
// 잔량 산식은 바뀐 단위로 구매를 세는데 지난 점검은 옛 단위라, 예를 들어 4500ml 점검 위에 개수 구매가 더해져 잔량과
// 평균 소모가 틀어졌다. 활성 카드 29장 중 27장이 지금 바꾸면 그렇게 어긋날 자리였다(규격 단위 + 점검 12, 점검 있는 수량 15).
//
// 규칙. 잔량 산식의 축은 overview 의 useSpec = trackUnit !== 'qty' && specUnit 하나다. 그 값이 안 바뀌면 배수는 1 이다.
// 바뀌면 그 품명 구매의 규격 이력이 물리 동치로 한 규격일 때만 그 배수(specMultiplier 정본)로 바꾼다. 규격이 섞였거나
// 규격 이력이 없거나 카드 단위로 환산되지 않는 규격이 있으면, 바꿀 기록(점검·입수·폐기)이 있을 때 거부하고 까닭을 말한다.
// 바꿀 기록이 없으면 배수가 필요 없다(구매는 계산 때 새 단위로 다시 센다).
import { specMultiplier } from './units'

export type TrackUnit = 'spec' | 'qty'
export type TrackUnitSwitchPlan =
  | { ok: true; factor: number; multiplier: number | null }
  | { ok: false; reason: 'mixed' | 'none' | 'dimension'; message: string }

const sameNum = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
const fmt = (n: number) => `${Number(n.toFixed(6))}`

/** 잔량을 규격으로 세는가(overview useSpec 과 같은 식). */
export function countsBySpec(trackUnit: string, specUnit: string | null | undefined): boolean {
  return trackUnit !== 'qty' && !!(specUnit && specUnit.trim())
}

export function planTrackUnitSwitch(input: {
  from: TrackUnit
  to: TrackUnit
  cardSpecUnit: string | null
  purchases: { specValue: number | null; specUnit: string | null }[]
  hasRecords: boolean
}): TrackUnitSwitchPlan {
  const before = countsBySpec(input.from, input.cardSpecUnit)
  const after = countsBySpec(input.to, input.cardSpecUnit)
  if (before === after || !input.hasRecords) return { ok: true, factor: 1, multiplier: null }
  const specs = input.purchases.filter(p => p.specValue != null && p.specValue > 0)
  const ms: { m: number; label: string }[] = []
  for (const p of specs) {
    const m = specMultiplier(p.specValue, p.specUnit, input.cardSpecUnit)
    const label = `${fmt(p.specValue!)}${p.specUnit ?? ''}`
    if (m == null) {
      return { ok: false, reason: 'dimension', message: `구매 규격 ${label} 은 카드 단위(${input.cardSpecUnit})로 환산되지 않아 지난 점검 값을 바꿀 배수를 정할 수 없습니다.` }
    }
    if (!ms.some(x => sameNum(x.m, m))) ms.push({ m, label })
  }
  if (ms.length === 0) {
    return { ok: false, reason: 'none', message: '구매 규격 기록이 없어 지난 점검 값을 바꿀 배수를 정할 수 없습니다.' }
  }
  if (ms.length > 1) {
    return { ok: false, reason: 'mixed', message: `구매 규격이 ${ms.map(x => x.label).join(', ')} 로 섞여 있어 지난 점검 값을 바꿀 배수를 정할 수 없습니다.` }
  }
  const m = ms[0].m
  return { ok: true, factor: before ? 1 / m : m, multiplier: m }
}

/** 수령 자동 점검 메모(`[수령 자동] +N단위`)를 새 단위로 다시 쓴다. 그 꼴이 아니면 null(손대지 않는다). */
export function rescaleReceiptMemo(memo: string | null, factor: number, unit: string): string | null {
  if (!memo) return null
  const m = /^\[수령 자동\] \+(\d+(?:\.\d+)?)(\S*)$/.exec(memo)
  if (!m) return null
  return `[수령 자동] +${Number((Number(m[1]) * factor).toFixed(3))}${unit}`
}
