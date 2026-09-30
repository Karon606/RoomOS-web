// 위치별 점검 저장 체인의 두 규칙을 지키는 그물 — 창고 부족 칸은 미루고, 수령 자동 점검에는 합치지 않는다
//
// 신고 2026-09-30(쌀 20kg). 4층 주방에서 쌀 10kg 옮김과 김치·주방세제·세탁세제 소진을 한 번에 저장했다.
// 창고 쌀이 0이라 체인이 쌀에서 멈췄고, 팝업을 닫자 뒤의 품목이 저장되지 않은 채 체크 전 값으로 남았다.
//   규칙 1. 첫 바퀴는 창고 부족 칸을 미루고 계속 달린다(runChain 의 deferShort). 부족 칸은 두 번째 바퀴에서 팝업으로.
//   규칙 2. 팝업을 닫으면 저장 안 된 칸을 목록(saveFailed)으로 말한다.
//   규칙 3. 서버 updateStockCheck 는 locationPatch 를 수령 자동 점검(sourceExpenseId)에 합치지 않는다.
//           합치면 수령 취소·수령일 변경이 손 실측까지 지운다.
import fs from 'node:fs'

const client = fs.readFileSync(new URL('../app/(app)/inventory/InventoryClient.tsx', import.meta.url), 'utf8')
const actions = fs.readFileSync(new URL('../app/(app)/inventory/actions.ts', import.meta.url), 'utf8')

/** 이름으로 함수 본문을 자른다 — 다음 최상위·같은 들여쓰기 const 선언 전까지. */
function region(src, startMarker) {
  const i = src.indexOf(startMarker)
  if (i < 0) return null
  const rest = src.slice(i + startMarker.length)
  const m = rest.match(/\n  const [A-Za-z]+ = |\nexport |\nfunction /)
  return rest.slice(0, m ? m.index : rest.length)
}

const fails = []

const runChain = region(client, 'const runChain = async (')
if (!runChain) fails.push('runChain 을 찾을 수 없다')
else {
  if (!/deferShort/.test(runChain)) fails.push('runChain 에 deferShort 인자가 없다')
  const shortBlock = runChain.slice(runChain.indexOf("res.code === 'HUB_SHORT'"))
  if (!/if \(deferShort\)\s*\{[\s\S]{0,200}deferredRef\.current\.push\(u\)[\s\S]{0,120}continue/.test(shortBlock))
    fails.push("runChain 의 HUB_SHORT 분기가 deferShort 일 때 칸을 미루고 계속 달리지 않는다")
  if (!/deferredItemsRef\.current\.has\(u\.r\.id\)/.test(runChain))
    fails.push('같은 품목의 뒤 칸을 함께 미루지 않는다(체인 이음·허브 행 순서가 깨진다)')
}

const doSave = region(client, 'const doSave = async (')
if (!doSave) fails.push('doSave 를 찾을 수 없다')
else {
  if (!/runChain\(units, !!forceMerge, 0, units\.length, true\)/.test(doSave))
    fails.push('doSave 의 첫 바퀴가 deferShort=true 로 달리지 않는다')
  if (!/runChain\(deferred,/.test(doSave))
    fails.push('doSave 가 미룬 칸을 두 번째 바퀴로 처리하지 않는다')
}

const onExit = region(client, 'const onHubShortExit = (')
if (!onExit) fails.push('onHubShortExit 를 찾을 수 없다')
else if (!/setSaveFailed\(unsaved\.map/.test(onExit))
  fails.push('팝업을 닫을 때 저장 안 된 칸을 목록으로 말하지 않는다')

const upd = region(actions, 'export async function updateStockCheck(')
if (!upd) fails.push('updateStockCheck 를 찾을 수 없다')
else if (!/if \(data\.locationPatch && c\.sourceExpenseId\)\s*\{\s*return \{ ok: false, code: 'AUTO_RECEIPT_TARGET'/.test(upd))
  fails.push('updateStockCheck 가 수령 자동 점검에 위치별 점검을 합치는 것을 막지 않는다')

const saveUnit = region(client, 'const saveUnit = async (')
if (!saveUnit || !/AUTO_RECEIPT_TARGET/.test(saveUnit))
  fails.push('saveUnit 이 AUTO_RECEIPT_TARGET 을 받아 새 점검으로 내려가지 않는다')

if (fails.length) {
  console.log(`[위치별 점검 체인 미루기] 위반 ${fails.length}건`)
  for (const f of fails) console.log('  - ' + f)
  process.exit(1)
}
console.log('[위치별 점검 체인 미루기] 위반 0건 (부족 칸 미루기 · 닫을 때 목록 · 수령 자동 점검 합치기 거부)')
