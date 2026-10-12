// 이력 점검 종류 판별(lib/stockCheckKind) 진리표 회귀 — DB 불필요.
//
// 점검 테이블에 종류 칸이 없어 맞바꿈·위치 이동·수령 반영을 저장 메모 접두로 가린다(운영자 결정 2026-10-12).
// 접두만 믿으면 같은 날 합쳐진 손 실측이 '맞바꿈'·'수령 반영'(읽기 전용) 밑에 가려진다 — 그 가드를 박제한다.
// 가드는 위치 이름이 아니라 **값**으로 선다(검수 2026-10-13 — 이름으로 견주면 위치를 옮긴 뒤의 옛 기록이 전부 '점검').
// 수령 반영은 그 구매가 이력에 있을 때만이다(고치는 길이 구매 카드라, 없으면 읽기 전용이 막다른 길).
// 김치 10/12 세 기록(15:22 수령 자동 · 16:00 위치별 점검 · 16:08 맞바꿈)은 DB 실제 값이다.
// 마지막 절은 메모를 **만드는** 자리(actions.ts)의 템플릿을 소스째 대조한다 — 생성 문자열이 바뀌면 판별이 조용히
// '점검'으로 무너지므로 여기서 빨갛게 만든다.
import { readFileSync } from 'node:fs'
import { classifyCheck, classifyChecks, checkMemoText, changedLocs, type KindCheck } from '../lib/stockCheckKind'

let pass = 0
const fails: string[] = []
function eq(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) pass++
  else fails.push(`${label}: 기대 ${w} / 실제 ${g}`)
}

const T4 = '4층 주방 김치냉장고 상단', B4 = '4층 주방 김치냉장고 하단', T5 = '5층 주방 김치냉장고 상단', B5 = '5층 주방 김치냉장고 하단'
const loc = (id: string, name: string, qty: number, o: { rs?: number; carried?: boolean | null } = {}) =>
  ({ locationId: id, locationName: name, qty, ...(o.rs ? { restockedQty: o.rs } : {}), carried: o.carried ?? null })
const chk = (id: string, memo: string | null, remainingQty: number, rows: KindCheck['locationBreakdown']): KindCheck => ({ id, memo, remainingQty, locationBreakdown: rows })

// 김치 10/12 — 최신이 앞
const c1608 = chk('1608', `맞바꿈: ${B4} ↔ ${T4}`, 22, [loc('t4', T4, 4), loc('b4', B4, 8), loc('t5', T5, 2), loc('b5', B5, 8)])
const c1600 = chk('1600', '위치별 점검 (4층 주방)', 22, [
  loc('t4', T4, 8, { rs: 8, carried: false }), loc('b4', B4, 4, { rs: 4, carried: false }),
  loc('t5', T5, 2, { carried: false }), loc('b5', B5, 8, { carried: false })])
const c1522: KindCheck = { ...chk('1522', '[수령 자동] +20kg', 24.5, [loc('t4', T4, 1.5), loc('t5', T5, 3), loc('b5', B5, 20)]), sourceExpenseId: 'exp-kimchi' }
const c1009 = chk('1009', '위치별 점검 (4층 주방)', 4.5, [
  loc('t4', T4, 1.5, { carried: false }), loc('b5', B5, 0, { carried: false }), loc('b4', B4, 0, { carried: false }), loc('t5', T5, 3, { carried: false })])
const kimchi = [c1608, c1600, c1522, c1009]

// ── ① 김치 세 기록 ───────────────────────────────────────────────
{
  const kinds = classifyChecks(kimchi)
  const k1608 = kinds.get('1608')!
  eq('① 16:08 은 맞바꿈이다', k1608.kind, 'swap')
  eq('① 16:08 바뀐 칸은 4층 상단·하단 둘이다(트리 순서)', k1608.kind === 'swap' ? k1608.changes : null, [
    { locationId: 't4', locationName: T4, from: 8, to: 4 }, { locationId: 'b4', locationName: B4, from: 4, to: 8 }])
  eq('① 16:08 총량 변화 없음', k1608.kind === 'swap' ? k1608.totalSame : null, true)
  eq('① 16:08 메모는 접두를 뗀다', checkMemoText(c1608.memo, k1608), `${B4} ↔ ${T4}`)
  eq('① 16:00 은 점검이다', kinds.get('1600')!.kind, 'check')
  eq('① 16:00 메모는 위치가 앞에 선다', checkMemoText(c1600.memo, kinds.get('1600')!), '4층 주방에서 위치별 점검')
  eq('① 15:22 는 수령 반영이다', kinds.get('1522'), { kind: 'receipt', memoBody: '+20kg' })
  eq('① 15:22 메모는 접두를 뗀다', checkMemoText(c1522.memo, kinds.get('1522')!), '+20kg')
  eq('① 구매가 이력에 있으면 수령 반영', classifyChecks(kimchi, new Set(['exp-kimchi'])).get('1522')!.kind, 'receipt')
}

// ── ② 합쳐진 기록은 접두가 있어도 '점검' 이다 ─────────────────────
{
  // 맞바꿈 뒤 6시간 안 위치별 점검이 합쳐져 5층 상단을 세고 채웠다 — 채움 마커가 있다.
  const merged = chk('m1', `맞바꿈: ${B4} ↔ ${T4}`, 25, [loc('t4', T4, 4), loc('b4', B4, 8), loc('t5', T5, 5, { rs: 3, carried: false }), loc('b5', B5, 8)])
  eq('② 채움 마커가 얹힌 맞바꿈 메모는 점검', classifyCheck(merged, c1600).kind, 'check')
  // 같은 두 칸(4층 상단)만 다시 세고 창고에서 채웠다 — 바뀐 칸은 메모의 두 위치뿐이라 채움 마커 하나가 합쳐짐을 말한다.
  const mergedSame = chk('m3', `맞바꿈: ${B4} ↔ ${T4}`, 24, [loc('t4', T4, 6, { rs: 2, carried: false }), loc('b4', B4, 8), loc('t5', T5, 2), loc('b5', B5, 8)])
  eq('② 메모의 두 칸만 바뀌어도 채움 마커가 있으면 점검', classifyCheck(mergedSame, c1600).kind, 'check')
  // 두 칸만 바뀌었는데 서로 값의 거울이 아니다(상단을 다시 세어 6) — 맞바꿈이 아니다.
  const notMirror = chk('m4', `맞바꿈: ${B4} ↔ ${T4}`, 24, [loc('t4', T4, 6), loc('b4', B4, 8), loc('t5', T5, 2), loc('b5', B5, 8)])
  eq('② 거울이 아닌 두 칸 변화는 점검', classifyCheck(notMirror, c1600).kind, 'check')
  // 값은 거울인데 채움 마커가 얹혔다(합쳐진 채움) — 마커 하나가 합쳐짐을 말한다.
  const mirrorMarked = chk('m8', `맞바꿈: ${B4} ↔ ${T4}`, 22, [loc('t4', T4, 4), loc('b4', B4, 8, { rs: 4 }), loc('t5', T5, 2), loc('b5', B5, 8)])
  eq('② 거울이어도 채움 마커가 있으면 점검', classifyCheck(mirrorMarked, c1600).kind, 'check')
  // 9/30 이전 표식 없던 시절의 합쳐진 수령 자동 — 채움 마커만 있고 실측 표식은 없다(DB 실측 1dc2fc25 모양).
  const rcvMarkerOnly: KindCheck = { ...chk('r4', '[수령 자동] +125개', 162, [loc('a', '4층 주방', 9, { rs: 5 }), loc('h', '415호 창고', 145)]), sourceExpenseId: 'exp-ramen' }
  eq('② 채움 마커만 얹힌 수령 자동도 점검', classifyCheck(rcvMarkerOnly, null, new Set(['exp-ramen'])).kind, 'check')
  // 맞바꿈은 거울인데 바뀌지 않은 칸(5층 상단)에 실측 표식이 있다 — 같은 값을 다시 센 합쳐진 손 실측이다.
  const quietMeasured = chk('m5', `맞바꿈: ${B4} ↔ ${T4}`, 22, [loc('t4', T4, 4), loc('b4', B4, 8), loc('t5', T5, 2, { carried: false }), loc('b5', B5, 8)])
  eq('② 바뀌지 않은 칸에 실측 표식이 있으면 점검', classifyCheck(quietMeasured, c1600).kind, 'check')
  // 옛 맞바꿈 — 메모 이름이 지금 표기 경로와 다르지만(위치 트리 개편 전) 두 칸이 거울이다.
  const oldSwap = chk('m6', '맞바꿈: 4층 김치냉장고 하단 ↔ 4층 김치냉장고 상단', 22, [loc('t4', T4, 4), loc('b4', B4, 8), loc('t5', T5, 2), loc('b5', B5, 8)])
  eq('② 이름이 바뀐 옛 맞바꿈도 거울이면 맞바꿈', classifyCheck(oldSwap, c1600).kind, 'swap')
  eq('② 같은 값끼리 맞바꿔 바뀐 칸이 없으면 맞바꿈', classifyCheck(chk('m7', `맞바꿈: ${B4} ↔ ${T4}`, 22, c1600.locationBreakdown.map(l => ({ ...l, restockedQty: undefined, carried: null }))), c1600).kind, 'swap')
  // 수령의 구매가 이력에 없다(단위가 다른 지출 — 빨래줄 실데이터). 읽기 전용이면 고칠 길이 없다.
  eq('② 구매가 이력에 없는 수령 자동은 점검(수정 가능)', classifyCheck(c1522, null, new Set(['다른 구매'])).kind, 'check')
  eq('② 구매 id 가 없는 수령 자동도 점검', classifyCheck({ ...c1522, sourceExpenseId: null }, null, new Set(['exp-kimchi'])).kind, 'check')
  // 채움 없이 다른 칸(5층 상단)만 세어 값이 바뀌었다 — 메모에 없는 칸이 바뀌었다.
  const merged2 = chk('m2', `맞바꿈: ${B4} ↔ ${T4}`, 21, [loc('t4', T4, 4), loc('b4', B4, 8), loc('t5', T5, 1, { carried: false }), loc('b5', B5, 8)])
  eq('② 메모에 없는 칸이 바뀐 맞바꿈 메모는 점검', classifyCheck(merged2, c1600).kind, 'check')
  // 9/30 이전 합치기 — 수령 자동 점검에 손 실측이 얹혔다(DB 실측 47건 중 5건).
  const rcvMerged = chk('r1', '[수령 자동] +20kg', 20, [loc('a', '4층 주방', 10, { rs: 10, carried: false }), loc('h', '415호 창고', 0)])
  eq('② 채움·실측이 얹힌 수령 자동은 점검(고칠 수 있게)', classifyCheck(rcvMerged, null).kind, 'check')
  const rcvMeasured = chk('r2', '[수령 자동] +125봉', 143, [loc('a', '4층 주방', 8, { carried: false }), loc('h', '415호 창고', 135)])
  eq('② 실측 표식만 얹힌 수령 자동도 점검', classifyCheck(rcvMeasured, null).kind, 'check')
  eq('② 백필 수령은 수령 반영 접두가 아니다', classifyCheck(chk('r3', '[수령 자동·백필] 수령 1건 합산', 3, []), null).kind, 'check')
  eq('② 점검으로 가린 수령 자동의 메모는 꼬리표만 낱말로', checkMemoText(rcvMerged.memo, { kind: 'check' }), '수령 +20kg · 자동 반영')
}

// ── ③ 위치 이동 ─────────────────────────────────────────────────
{
  const A = '4층 주방', B = '5층 주방', H = '4층 415호 창고'
  const prev = chk('p', null, 30, [loc('a', A, 7), loc('b', B, 3), loc('h', H, 20)])
  const mv = chk('mv', `이동: ${A} → ${B} 3`, 30, [loc('a', A, 4), loc('b', B, 6), loc('h', H, 20)])
  const k = classifyCheck(mv, prev)
  eq('③ 이동 메모는 위치 이동', k.kind, 'move')
  eq('③ 이동 총량 변화 없음', k.kind === 'move' ? k.totalSame : null, true)
  eq('③ 이동 메모 본문', checkMemoText(mv.memo, k), `${A} → ${B} 3`)
  // 출발지 실측 — 출발지 행만 carried:false, 총량이 실측 차이만큼 준다. 그래도 위치 이동이다.
  const mvM = chk('mvm', `이동: ${A} → ${B} 3 · ${A} 실측 3`, 29, [loc('a', A, 3, { carried: false }), loc('b', B, 6), loc('h', H, 20)])
  const km = classifyCheck(mvM, prev)
  eq('③ 출발지 실측 이동도 위치 이동', km.kind, 'move')
  eq('③ 실측 차이가 있으면 총량 변화 없음이 아니다', km.kind === 'move' ? km.totalSame : null, false)
  // 소수 이동량
  eq('③ 소수 이동량도 읽는다', classifyCheck(chk('mvd', `이동: ${A} → ${B} 0.2`, 30, [loc('a', A, 6.8), loc('b', B, 3.2), loc('h', H, 20)]), prev).kind, 'move')
  // 이름 끝이 숫자인 칸(선반 2)
  const S2 = '창고 선반 2'
  const prevS = chk('ps', null, 10, [loc('a', A, 7), loc('s', S2, 3)])
  eq('③ 끝이 숫자인 칸 이름도 읽는다', classifyCheck(chk('mvs', `이동: ${A} → ${S2} 3`, 10, [loc('a', A, 4), loc('s', S2, 6)]), prevS).kind, 'move')
  // 위치 이름이 그 뒤 바뀌었다 — 메모 이름과 지금 표기 경로가 달라 가리지 못한다.
  // 위치 이름이 그 뒤 바뀌었다(메모 이름은 저장 당시 표기 경로) — 값이 이동과 맞으면 위치 이동이다(검수 실측 8건이 이 경우).
  eq('③ 이름이 바뀐 옛 기록도 값이 맞으면 위치 이동', classifyCheck(chk('mvr', `이동: 4층 부엌 → ${B} 3`, 30, [loc('a', A, 4), loc('b', B, 6), loc('h', H, 20)]), prev).kind, 'move')
  eq('③ 이동량과 다른 변화는 점검', classifyCheck(chk('mvx', `이동: ${A} → ${B} 3`, 30, [loc('a', A, 5), loc('b', B, 5), loc('h', H, 20)]), prev).kind, 'check')
  eq('③ 출발지 실측이 메모 값과 다르면 점검', classifyCheck(chk('mvy', `이동: ${A} → ${B} 3 · ${A} 실측 2`, 29, [loc('a', A, 3, { carried: false }), loc('b', B, 6), loc('h', H, 20)]), prev).kind, 'check')
  // 출발지를 세어 보니 직전 그대로였다 — 출발지 행이 안 바뀌어 바뀐 칸은 도착지 하나다.
  const prevSame = chk('ps2', null, 30, [loc('a', A, 7), loc('b', B, 3), loc('h', H, 20)])
  eq('③ 출발지 실측이 직전과 같으면 바뀐 칸 하나도 위치 이동', classifyCheck(chk('mvz', `이동: ${A} → ${B} 3 · ${A} 실측 7`, 33, [loc('a', A, 7, { carried: false }), loc('b', B, 6), loc('h', H, 20)]), prevSame).kind, 'move')
  eq('③ 그때도 다른 안 바뀐 칸에 실측 표식이 있으면 점검', classifyCheck(chk('mvw', `이동: ${A} → ${B} 3 · ${A} 실측 7`, 33, [loc('a', A, 7, { carried: false }), loc('b', B, 6), loc('h', H, 20, { carried: false })]), prevSame).kind, 'check')
  eq('③ 직전 점검이 없으면 견줄 데가 없어 점검', classifyCheck(mv, null).kind, 'check')
}

// ── ④ 그 밖 ─────────────────────────────────────────────────────
{
  eq('④ 메모 없는 점검', classifyCheck(chk('x', null, 1, []), null).kind, 'check')
  eq('④ 전체 위치 점검 메모는 그대로', checkMemoText('전체 위치 점검', { kind: 'check' }), '전체 위치 점검')
  eq('④ 손으로 적은 메모는 그대로', checkMemoText('창고 10개 / 주방 각 1개', { kind: 'check' }), '창고 10개 / 주방 각 1개')
  eq('④ 위치별 점검 접두가 아닌 괄호 메모는 그대로', checkMemoText('위치별 점검 (4층) 재확인', { kind: 'check' }), '위치별 점검 (4층) 재확인')
  eq('④ 시작 재고 꼬리표', checkMemoText('[시작 재고]', { kind: 'check' }), '시작 재고')
  eq('④ 수령 백필 꼬리표', checkMemoText('[수령 자동·백필] 수령 2건 합산', { kind: 'check' }), '수령 2건 합산 · 자동 백필')
  eq('④ 직전에만 있던 칸은 0 으로 바뀐 것', changedLocs(chk('p', null, 3, [loc('a', 'A', 3)]), chk('c', null, 0, [])), [{ locationId: 'a', locationName: 'A', from: 3, to: 0 }])
  eq('④ 없는 행과 0 행은 같다', changedLocs(chk('p', null, 0, [loc('a', 'A', 0)]), chk('c', null, 0, [])), [])
}

// ── ⑤ 생성 자리 템플릿 대조 ──────────────────────────────────────
{
  const actions = readFileSync('app/(app)/inventory/actions.ts', 'utf8')
  eq('⑤ 맞바꿈 메모 템플릿', actions.includes('memo = `맞바꿈: ${fromLoc} ↔ ${toLoc}`'), true)
  eq('⑤ 이동(실측) 메모 템플릿', actions.includes('? `이동: ${fromLoc} → ${toLoc} ${move} · ${fromLoc} 실측 ${measured}`'), true)
  eq('⑤ 이동 메모 템플릿', actions.includes(': `이동: ${fromLoc} → ${toLoc} ${move}`'), true)
  eq('⑤ 수령 자동 메모 템플릿 두 자리', (actions.match(/memo: `\[수령 자동\] \+\$\{receivedQty\}\$\{unit\}`/g) ?? []).length, 2)
}

console.log(`\n[이력 점검 종류 판별 진리표] 통과 ${pass}건 · 실패 ${fails.length}건`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
