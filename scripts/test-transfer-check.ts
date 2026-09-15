// 이동 점검 조립 정본(lib/transferCheck transferCheckCreateData) 진리표 회귀 — DB 불필요.
//
// 이동 점검의 행 표식은 값 대조로 안 잡힌다. 수량은 내내 맞고 carried 만 틀리며, 틀리면
// planCheckPropagation 이 옮긴 델타를 지우거나(true) 그 위치의 전파를 영구히 멈춘다(false).
// 그래서 세 경우의 표식을 여기에 박제한다.
//   ① 출발지 실측 있음 — 출발지 행만 carried:false, 도착지 행은 표식 없음(null)
//   ② 출발지 실측 없음 — 두 행 다 표식 없음
//   ③ 맞바꿈 — 두 행 다 표식 없음(맞바꿈에 실측 인자는 뜻이 없다)
// 총량(remainingQty)이 행 합이라는 불변식도 같이 본다 — 부분 breakdown 은 total != byLoc 을 만든다.
import { transferCheckCreateData } from '../lib/transferCheck'

let pass = 0
const fails: string[] = []

function eq(label: string, got: unknown, want: unknown) {
  if (Object.is(got, want)) pass++
  else fails.push(`${label}: 기대 ${String(want)} / 실제 ${String(got)}`)
}

// 위치 — H=허브(창고), A=4층 상단(출발지), B=5층 상단(도착지)
const H = 'loc-hub', A = 'loc-4f', B = 'loc-5f'
type Row = { storageLocationId: string; remainingQty: number; carried?: boolean }
const rowOf = (data: ReturnType<typeof transferCheckCreateData>, id: string) =>
  (data.locationBreakdown.create as Row[]).find(r => r.storageLocationId === id)

// ── ① 출발지 실측 있음 ────────────────────────────────────────────
// 4층 10 에서 5층으로 3 옮기고, 옮긴 뒤 4층을 직접 세니 6 이었다(장부 7 과 1 차이).
{
  const breakdown = new Map([[H, 20], [A, 6], [B, 8]])
  const data = transferCheckCreateData('item-1', breakdown, '이동: 4층 → 5층 3 · 4층 실측 6', A)
  eq('① 출발지 행이 실측이다', rowOf(data, A)?.carried, false)
  eq('① 도착지 행은 표식이 없다', rowOf(data, B)?.carried, undefined)
  eq('① 나머지 행도 표식이 없다', rowOf(data, H)?.carried, undefined)
  eq('① 총량은 행 합이다', data.remainingQty, 34)
  eq('① 행 수는 breakdown 전체다', (data.locationBreakdown.create as Row[]).length, 3)
}

// ── ② 출발지 실측 없음 ────────────────────────────────────────────
// 실측 인자를 안 넘기면 표식을 찍는 행이 하나도 없다. 이동 행은 이월도 실측도 아닌 '이월 + 델타' 다.
{
  const breakdown = new Map([[H, 20], [A, 7], [B, 8]])
  const data = transferCheckCreateData('item-1', breakdown, '이동: 4층 → 5층 3')
  eq('② 출발지 행에 표식이 없다', rowOf(data, A)?.carried, undefined)
  eq('② 도착지 행에 표식이 없다', rowOf(data, B)?.carried, undefined)
  eq('② 총량은 행 합이다', data.remainingQty, 35)
}

// ── ③ 맞바꿈 ──────────────────────────────────────────────────────
// 두 위치를 통째로 바꾼다. 센 값이 아니라 옮긴 값이라 어느 쪽도 실측이 아니다.
{
  const breakdown = new Map([[H, 20], [A, 8], [B, 5]])
  const data = transferCheckCreateData('item-1', breakdown, '맞바꿈: 4층 ↔ 5층')
  eq('③ 한쪽에 표식이 없다', rowOf(data, A)?.carried, undefined)
  eq('③ 다른 쪽에도 표식이 없다', rowOf(data, B)?.carried, undefined)
  eq('③ 총량은 행 합이다', data.remainingQty, 33)
}

// 음수는 0 으로 접는다 — 행 합 불변식이 음수로 무너지지 않게.
{
  const data = transferCheckCreateData('item-1', new Map([[A, -2], [B, 5]]), '이동')
  eq('음수 행은 0 으로 접힌다', rowOf(data, A)?.remainingQty, 0)
  eq('총량도 접은 값으로 센다', data.remainingQty, 5)
}

console.log(`\n[이동 점검 조립 진리표] 통과 ${pass}건 · 실패 ${fails.length}건`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
