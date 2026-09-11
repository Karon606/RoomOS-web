// 재고 원장 조정(lib/stockLedger) 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 지키는 것은 둘이다.
//   ⓐ 소스 가드 — 조정이 '제안 후 확인' 을 벗어나거나, 조용한 0 클램프·마커 훼손·링크 없는 breakdown
//     쓰기로 되돌아가는 것. 데이터로는 못 잡는다(조정이 옳게 적용된 결과와 원래 그랬던 값이 같다).
//   ⓑ 데이터 대조 — 총량과 위치합이 갈라지는 것. 조정이 총량만 옮기고 위치를 빠뜨리면 여기서 난다.
//     이 축에는 지금까지 감지망이 하나도 없었다.
//
// 실행: npx tsx --env-file=.env.local scripts/check-stock-ledger-parity.ts
import { readFileSync } from 'node:fs'
import { computeInventoryOverview } from '../app/(app)/inventory/overview'
import { loadPropagationChecks, loadLedgerDeltas, resolveItemHubLocationId } from '../app/(app)/inventory/ledgerShift'
import { deltaAfterCheck } from '../lib/stockLedger'
import prisma from '../lib/prisma'

const violations: string[] = []

// 못 읽으면 통과가 아니라 위반이다(knowledge/regression-nets.md) — 블록 추출이 빗나가면 그 자리에서 신고한다.
function block(src: string, startNeedle: string, endNeedle: string, what: string): string | null {
  const i = src.indexOf(startNeedle)
  if (i < 0) { violations.push(`${what} 를 소스에서 찾지 못했다 — 그물이 대조를 건너뛰었다`); return null }
  const j = src.indexOf(endNeedle, i + startNeedle.length)
  if (j < 0) { violations.push(`${what} 의 끝(${endNeedle})을 찾지 못했다 — 그물이 대조를 건너뛰었다`); return null }
  return src.slice(i, j)
}

function sourceGuards() {
  const ledger = readFileSync('lib/stockLedger.ts', 'utf8')
  const actions = readFileSync('app/(app)/inventory/actions.ts', 'utf8')
  // 적용층 공용 모듈 — 무상 입수(inventory)와 지출 전파(finance)가 같은 적용·되돌리기를 쓴다.
  const shiftDb = readFileSync('app/(app)/inventory/ledgerShift.ts', 'utf8')
  const client = readFileSync('app/(app)/inventory/InventoryClient.tsx', 'utf8')

  // ── 계산 정본 ──────────────────────────────────────────────────────────
  // 이름 뒤에 여는 괄호까지 붙여 찾는다. 'planStockShift' 만 찾으면 planStockShiftV2 로 개명해도 통과한다.
  const plan = block(ledger, 'export function planStockShift(', '\n}\n', 'planStockShift')
  if (plan) {
    // 전체 보정은 실측 리셋 선언이라 앞선 기록 변경에 흔들리면 안 된다.
    if (!/c\.isReconcile/.test(plan) || !/stopped/.test(plan)) {
      violations.push('planStockShift 가 전체 보정(isReconcile)에서 전파를 멈추지 않는다 — 실측 리셋이 앞 기록 변경에 흔들린다')
    }
    // 조용한 0 클램프가 쌀 사건의 원형이다. 음수는 막고 어느 점검인지 알려야 한다.
    if (/Math\.max\(\s*0\s*,/.test(plan)) {
      violations.push('planStockShift 가 0 클램프를 쓴다 — 부족분이 조용히 삼켜진다(NEGATIVE 거부가 정본)')
    }
    // 거부 지점은 둘이다 — 총량과 위치별. 하나만 남아도 나머지 한쪽이 음수로 저장된다.
    // 존재 여부가 아니라 **각 판정문이 살아 있는지** 를 본다(한쪽을 지워도 다른 쪽 문자열이 통과시켰다).
    if (!/nextTotal < -LEDGER_EPS[\s\S]{0,160}code:\s*'NEGATIVE'/.test(plan)) {
      violations.push('planStockShift 가 총량 음수 조정을 거부하지 않는다')
    }
    if (!/nextQty < -LEDGER_EPS[\s\S]{0,180}code:\s*'NEGATIVE'/.test(plan)) {
      violations.push('planStockShift 가 위치별 음수 조정을 거부하지 않는다')
    }
    // 총량만 옮기고 위치를 빠뜨리면 총량 대 위치합 불변식이 깨진다.
    if (!/code:\s*'NO_LOCATION'/.test(plan)) {
      violations.push('planStockShift 가 귀속 위치 미상을 거부하지 않는다 — 총량만 옮겨 위치합이 갈라진다')
    }
  }
  // 경계 술어는 정본 하나여야 한다(overview.sumAdditions 와 같은 규칙).
  if (!/export function deltaAfterCheck\(/.test(ledger)) {
    violations.push('lib/stockLedger 에 경계 술어 정본(deltaAfterCheck)이 없다')
  }
  // 적용부가 그 정본을 실제로 부르는가 — 개명·자체 구현으로 갈라지면 여기서 걸린다.
  if (!/planStockShift\(/.test(shiftDb) || !/from '@\/lib\/stockLedger'/.test(shiftDb)) {
    violations.push('원장 조정 공용층이 계산 정본(lib/stockLedger planStockShift)을 쓰지 않는다')
  }
  // 액션이 공용층을 안 거치고 자체 구현으로 갈라지는 것도 잡는다.
  if (!/from '\.\/ledgerShift'/.test(actions)) {
    violations.push('재고 액션이 조정 공용층(ledgerShift)을 쓰지 않는다')
  }

  // ── 적용부 ────────────────────────────────────────────────────────────
  const apply = block(shiftDb, 'async function applyShiftRows', '\n}\n', 'applyShiftRows')
  if (apply) {
    // 쓰기 계약 — 링크 없이 StockCheckLocation 행을 만들지 않는다. 만들면 그 재고가 화면에서 통째로 사라진다.
    const linkAt = apply.indexOf('trackedItemLocation.create')
    const rowAt = apply.indexOf('stockCheckLocation.create')
    if (linkAt < 0) violations.push('applyShiftRows 가 breakdown 행을 만들 때 링크를 보장하지 않는다(불변식 B)')
    else if (rowAt >= 0 && linkAt > rowAt) violations.push('applyShiftRows 가 링크보다 breakdown 행을 먼저 만든다 — 같은 트랜잭션에서 링크가 먼저여야 한다')
    // 보충 마커는 이동량이지 잔량이 아니다. 건드리면 undoConfirmReceipt 의 '실측 머지' 판정이 무너진다.
    if (/restockedQty/.test(apply)) {
      violations.push('applyShiftRows 가 보충 마커(restockedQty)를 쓴다 — 마커는 읽기만 해야 한다')
    }
    // 표식은 **새 행만**이 아니라 덮어쓴 행·정지 행에도 찍혀야 한다. 안 찍으면 그 행들이
    // 구식(null)으로 남아 다음 수정 때 또 휴리스틱으로 추측된다(운영자 후속 오더 2026-09-11).
    if (!/updateMany\(\{[\s\S]{0,320}carried: l\.carried/.test(apply)) {
      violations.push('applyShiftRows 가 덮어쓴 행에 표식을 안 찍는다 — 전파가 지나간 행이 구식으로 남는다')
    }
    if (!/create\(\{[\s\S]{0,320}carried: l\.carried/.test(apply)) {
      violations.push('applyShiftRows 가 새로 만든 행에 계획의 표식을 안 쓴다')
    }
    // 표식의 이전 값을 안 담으면 되돌려도 표식만 새 판정으로 남는다.
    if (!/carried: wasCarried\.get\(/.test(apply)) {
      violations.push('applyShiftRows 의 스냅샷이 표식의 이전 값을 안 담는다 — 적용취소가 표식을 못 되돌린다')
    }
  }
  const revertCarried = block(shiftDb, 'async function revertShiftRows(', '\n}\n', 'revertShiftRows')
  if (revertCarried && !/l\.carried !== undefined[\s\S]{0,80}carried: l\.carried/.test(revertCarried)) {
    violations.push('revertShiftRows 가 표식을 되돌리지 않는다(§16)')
    // createdAt 을 밀면 구간 귀속 순서(effTime)가 조용히 바뀐다.
    if (/createdAt/.test(apply)) {
      violations.push('applyShiftRows 가 점검 createdAt 을 바꾼다 — 구간 귀속 순서가 조용히 달라진다')
    }
  }

  // 되돌리기 페이로드는 클라이언트발이다. 품목 스코프 검증이 빠지면 남의 점검을 덮어쓸 수 있다.
  // ⚠️ 함수 어딘가에 trackedItemId 가 있는지로 보면 안 된다 — 링크 정리 쪽에도 같은 문자열이 있어
  //    소유 검증만 지워도 통과했다(역주입 실측). **소유 조회 그 자리**를 본다.
  const revert = block(shiftDb, 'async function revertShiftRows(', '\n}\n', 'revertShiftRows')
  if (revert && !/id:\s*\{\s*in:\s*ids\s*\}\s*,\s*trackedItemId:\s*undo\.trackedItemId/.test(revert)) {
    violations.push('revertShiftRows 가 되돌릴 점검을 품목 스코프로 검증하지 않는다')
  }

  // ── 게이트 — 조정은 운영자가 고른 경우에만 ────────────────────────────
  for (const fn of ['createStockAddition', 'deleteStockAddition', 'updateStockAddition']) {
    const b = block(actions, `export async function ${fn}(`, '\n}\n', fn)
    if (!b) continue
    if (!/adjustFollowing/.test(b)) {
      violations.push(`${fn} 에 조정 게이트(adjustFollowing)가 없다 — 조정이 자동으로 걸리거나 아예 빠진다`)
    }
    if (/applyShiftRows/.test(b) && !/if \(.*adjustFollowing.*\)/s.test(b)) {
      violations.push(`${fn} 이 게이트 없이 조정을 적용한다`)
    }
  }
  if (!/export async function previewStockAdditionShift/.test(actions)) {
    violations.push('조정 미리보기(previewStockAdditionShift)가 없다 — 운영자가 숫자를 보기 전에 적용된다')
  }
  // 클라가 적용 전에 반드시 묻는가. 이름만 보면 개명 한 번에 통과하므로 **물음의 결과가 저장 인자로
  // 흘러가는지** 를 본다 — 물음을 지우면 ask.result.adjust 를 만들 수 없어 구조적으로 걸린다.
  if (!/async function askLedgerShift\(/.test(client) || !/previewStockAdditionShift\(/.test(client)) {
    violations.push('재고 화면이 조정 전에 영향을 묻지 않는다(askLedgerShift/previewStockAdditionShift 소실)')
  }
  const wired = (client.match(/adjustFollowing:\s*ask\.result\.adjust/g) ?? []).length
  // 등록 1 · 수정 1 · 삭제 2(타임라인 행 버튼, 수정 폼 안 삭제) = 4 자리.
  if (wired < 4) {
    violations.push(`조정 인자가 물음 결과에서 오지 않는 경로가 있다 — 연결 ${wired}/4`)
  }

  // ── 지출 전파 게이트(점보롤 백로그 1번) — 지출 수정·삭제·수령 취소·제외의 조정도
  //    '제안 후 확인' 계약을 지키는가. 무상 입수 게이트와 같은 축이다.
  const fin = readFileSync('app/(app)/finance/actions.ts', 'utf8')
  const finClient = readFileSync('app/(app)/finance/FinanceClient.tsx', 'utf8')
  if (!/export async function previewExpenseStockShift/.test(actions)) {
    violations.push('지출 조정 미리보기(previewExpenseStockShift)가 없다 — 운영자가 숫자를 보기 전에 적용된다')
  }
  for (const fn of ['updateExpense', 'deleteExpense']) {
    const b = block(fin, `export async function ${fn}(`, '\n}\n', fn)
    if (!b) continue
    if (/applyShiftRows/.test(b) && !/adjustStock/.test(b)) {
      violations.push(`${fn} 이 게이트(adjustStock) 없이 조정을 적용한다`)
    }
  }
  const cancelCore = block(actions, 'async function cancelReceiptCore(', '\n}\n', 'cancelReceiptCore')
  if (cancelCore) {
    if (!/adjustFollowing/.test(cancelCore)) {
      violations.push('cancelReceiptCore 에 조정 게이트(adjustFollowing)가 없다 — 수령 취소 조정이 자동으로 걸리거나 아예 빠진다')
    }
    if (!/restockedQty/.test(cancelCore)) {
      violations.push('cancelReceiptCore 가 실측 머지 가드(restockedQty)를 잃었다 — 수령 취소가 실측을 지운다')
    }
  }
  // 수령일 비움(updateExpenseFromInventory)이 취소 정본을 우회해 자동 점검을 직접 지우면 뒷문이 된다.
  const updFromInv = block(actions, 'export async function updateExpenseFromInventory(', '\n}\n', 'updateExpenseFromInventory')
  if (updFromInv && !/cancelReceiptCore\(/.test(updFromInv)) {
    violations.push('updateExpenseFromInventory 의 수령일 비움이 취소 정본(cancelReceiptCore)을 안 탄다 — 실측 머지·반영 가드가 통째로 우회된다')
  }
  // 클라 물음의 결과가 저장 인자로 흐르는가 — 물음을 지우면 이 문자열을 만들 수 없다.
  if (!/fd\.set\('adjustStock', '1'\)/.test(finClient) || !/askShiftRows\(/.test(finClient)) {
    violations.push('지출 화면이 조정 전에 영향을 묻지 않는다(askShiftRows/adjustStock 연결 소실)')
  }

  // ── 점검 수정의 뒤 점검 전파(2026-09-11 김치) ─────────────────────────
  // 이월 행은 파생 박제고 실측 행은 절대값이다. 그 구분이 무너지는 자리는 넷이다 —
  // 표식을 안 찍는 저장 경로, 게이트 없는 자동 적용, 미리보기를 건너뛰는 화면, 허브 자기 마커.
  const merge = readFileSync('lib/stockCheckMerge.ts', 'utf8')
  const applyLoc = block(merge, 'export function applyLocationCheck(', '\n}\n', 'applyLocationCheck')
  if (applyLoc) {
    if (!/carried:\s*false/.test(applyLoc) || !/carried:\s*true/.test(applyLoc)) {
      violations.push('applyLocationCheck 이 이월/실측 표식(carried)을 안 찍는다 — 전파 판정이 통째로 휴리스틱으로 후퇴한다')
    }
    // 창고에서 창고로 옮기는 일은 없다. 허브 자기 점검에 마커가 붙으면 허브 차감 계산이 흔들린다.
    if (!/restockedQty:\s*patch\.restockedQty[\s\S]{0,80}\}/.test(applyLoc) || !/!isHubChecked\s*\)\s*\?\s*\{\s*restockedQty/.test(applyLoc)) {
      violations.push('applyLocationCheck 이 허브 자기 점검에도 보충 마커를 붙인다(2026-09-11 김치 +17 재발)')
    }
  }
  const planProp = block(ledger, 'export function planCheckPropagation(', '\n}\n', 'planCheckPropagation')
  if (planProp) {
    if (!/c\.isReconcile/.test(planProp) || !/hasBreakdown/.test(planProp)) {
      violations.push('planCheckPropagation 이 보정·내역 없는 점검에서 전체 정지하지 않는다')
    }
    // 표식이 false 면 반드시 실측으로 읽고, 실측이면 그 위치를 live 에서 빼야 한다.
    // 존재 여부로 보면 안 된다 — `carried === false ? true` 한 글자로 뒤집어도 통과했다(역주입 실측).
    if (!/carried === false\s*\?\s*false/.test(planProp) || !/if \(!isCarried\)[\s\S]{0,200}live\.delete\(/.test(planProp)) {
      violations.push('planCheckPropagation 이 실측 행에서 그 위치를 멈추지 않는다 — 실측값을 조용히 덮는다')
    }
    // 값이 같아도 표식이 다르면 행으로 내야 한다 — 조용히 넘기면 그 행은 영원히 구식으로 남는다.
    if (!/row\.carried === true\) continue/.test(planProp)) {
      violations.push('planCheckPropagation 이 값이 같으면 표식 차이를 무시한다 — 전파가 지나간 행이 구식으로 남는다')
    }
    if (!/carried: false/.test(planProp) || !/carried: true/.test(planProp)) {
      violations.push('planCheckPropagation 이 판정 결과를 표식으로 안 내보낸다')
    }
    if (/Math\.max\(\s*0\s*,/.test(planProp)) {
      violations.push('planCheckPropagation 이 0 클램프를 쓴다 — 부족분이 조용히 삼켜진다(NEGATIVE 거부가 정본)')
    }
    if (!/nextQty < -LEDGER_EPS[\s\S]{0,200}code:\s*'NEGATIVE'/.test(planProp)) {
      violations.push('planCheckPropagation 이 음수 조정을 거부하지 않는다')
    }
  }
  const create = block(actions, 'export async function createStockCheck(', '\n}\n', 'createStockCheck')
  if (create) {
    if (!/carried:\s*true/.test(create)) {
      violations.push('createStockCheck 의 이월(carryOver) 행이 표식(carried: true)을 안 찍는다')
    }
    if (!/carried:\s*false/.test(create)) {
      violations.push('createStockCheck 의 입력 행이 실측 표식(carried: false)을 안 찍는다')
    }
    if (!/carried:\s*lq\.carried/.test(create)) {
      violations.push('createStockCheck 이 표식을 breakdown 에 저장하지 않는다 — 계산해 놓고 버린다')
    }
  }
  const update = block(actions, 'export async function updateStockCheck(', '\n}\n', 'updateStockCheck')
  if (update) {
    if (!/propagate\?:\s*boolean/.test(update)) {
      violations.push('updateStockCheck 에 전파 게이트(propagate)가 없다 — 전파가 자동으로 걸리거나 아예 빠진다')
    }
    // 게이트 없이 계획을 세우면 그대로 적용된다. **계획 자체가 게이트 안**이어야 한다.
    if (!/if \(data\.propagate[\s\S]{0,200}buildCheckPropagationPlan\(/.test(update)) {
      violations.push('updateStockCheck 이 게이트 없이 전파 계획을 세운다')
    }
    if (!/carried:\s*false/.test(update)) {
      violations.push('updateStockCheck 의 수정 입력 행이 실측 표식(carried: false)을 안 찍는다')
    }
    // 수정과 전파가 한 트랜잭션이 아니면 중간 상태(수정만 반영)가 장부에 남는다.
    const tx = block(update, 'await prisma.$transaction(', '\n    })\n', 'updateStockCheck 트랜잭션')
    if (tx && !/applyShiftRows\(/.test(tx)) {
      violations.push('updateStockCheck 이 전파를 트랜잭션 밖에서 적용한다 — 중간 실패 시 수정만 남는다')
    }
  }
  if (!/export async function previewStockCheckPropagation/.test(actions)) {
    violations.push('점검 전파 미리보기(previewStockCheckPropagation)가 없다 — 운영자가 숫자를 보기 전에 적용된다')
  }
  if (!/export async function undoUpdateStockCheck/.test(actions)) {
    violations.push('점검 수정 적용취소(undoUpdateStockCheck)가 없다 — 되돌릴 길 없는 원장 쓰기다(§16)')
  }
  // 화면이 물음의 결과를 저장 인자로 흘리는가 — 물음을 지우면 ask.propagate 를 만들 수 없어 구조적으로 걸린다.
  if (!/previewStockCheckPropagation\(/.test(client) || !/propagate:\s*ask\.propagate/.test(client)) {
    violations.push('재고 화면이 점검 수정 전에 뒤 점검 영향을 묻지 않는다(askCheckPropagation/propagate 연결 소실)')
  }
  if (!/undoUpdateStockCheck\(/.test(client)) {
    violations.push('점검 수정 토스트에 적용취소가 연결돼 있지 않다(§16)')
  }
  // 확인창 본문은 공용 정본(lib/stockShiftAsk)과 같은 4단이다 — 유지 한 줄 · 영향 한 줄 · 행 · 안내.
  // 행부터 시작하면 '무엇이 몇 곳 어긋났는지' 를 말하지 않는 확인창이 된다(웹디자이너 패스 2026-09-11).
  const askProp = client.indexOf('async function askCheckPropagation(')
  if (askProp >= 0) {
    const body = client.slice(askProp, askProp + 2400)
    if (!/이 점검은 입력한 대로 저장됩니다\./.test(body)) {
      violations.push('점검 전파 확인창에 유지 줄(무엇이 안 바뀌는지)이 없다')
    }
    if (!/이어받은 이월 위치 \$\{[^}]+\}곳이 뒤 점검에 있습니다/.test(body)) {
      violations.push('점검 전파 확인창에 영향 줄(몇 곳이 어긋났는지)이 없다')
    }
    if (!/실측한 위치는 그대로 두고 이월된 위치만 맞춥니다\./.test(body)) {
      violations.push('점검 전파 확인창에 마지막 안내 줄이 없다')
    }
  }
  // §29 — 값 전환은 화살표 표기다. 조사를 붙이면 단위 없는 품목에서 '4개으로' 가 된다.
  const ask = readFileSync('lib/stockShiftAsk.ts', 'utf8')
  for (const [f, src] of [['lib/stockShiftAsk', ask], ['재고 화면', client]] as const) {
    if (/\}에서 \$\{|\} 에서 \$\{[^}]*\} 으로|\}으로`/.test(src)) {
      violations.push(`${f} 의 원장 확인창이 값 전환에 조사를 붙인다 — 단위 없는 품목에서 '4개으로' 가 된다(§29 화살표 표기)`)
    }
  }
  // 허브 칸은 실측이지 옮김이 아니다 — 위치 패널의 허브 입력이 '채운 후'로 돌아가면 마커가 다시 박힌다.
  if (!/허브 위치 점검 — 잔량 1칸[\s\S]{0,1400}value=\{beforeStr\}/.test(client)) {
    violations.push('위치 패널의 허브 잔량 칸이 채우기 전(beforeQtys)에 묶여 있지 않다 — 후 − 전이 보충으로 셈해진다')
  }

  // ── 경계 규칙 — getStockAsOf 가 입수·폐기 정본을 쓰는가 ────────────────
  const asOf = block(actions, 'export async function getStockAsOf', 'const expectedTotal', 'getStockAsOf')
  if (asOf) {
    if (!/sumAdditions\(/.test(asOf) || !/sumDisposals\(/.test(asOf)) {
      violations.push('getStockAsOf 가 입수·폐기 경계를 정본(sumAdditions/sumDisposals)으로 안 쓴다 — 같은 날 늦게 입력된 입수가 프리필에서 빠진다')
    }
    if (/stockAddition\.aggregate/.test(asOf)) {
      violations.push('getStockAsOf 가 입수 경계를 직접 다시 적는다 — 정본과 갈라진다')
    }
  }
}

async function dataParity() {
  // ⓑ-1 점검 헤더와 위치합 — 조정이 총량만 옮기면 여기서 즉시 갈라진다.
  const checks = await prisma.stockCheck.findMany({
    select: {
      id: true, date: true, remainingQty: true,
      trackedItem: { select: { label: true, property: { select: { name: true } } } },
      locationBreakdown: { select: { remainingQty: true } },
    },
  })
  const headerBad: string[] = []
  let withBreakdown = 0
  for (const c of checks) {
    if (c.locationBreakdown.length === 0) continue
    withBreakdown++
    const sum = c.locationBreakdown.reduce((s, l) => s + l.remainingQty, 0)
    if (Math.abs(sum - c.remainingQty) > 0.001) {
      headerBad.push(`${c.trackedItem.property.name} · ${c.trackedItem.label} ${c.date.toISOString().slice(0, 10)} 총 ${c.remainingQty} 대 위치합 ${Math.round(sum * 1000) / 1000}`)
    }
  }

  // ⓑ-2 화면 잔량의 두 경로 — 총량(마지막 점검 + 이후 델타)과 위치별 잔량(위치별 재구성)이 같은가.
  // 음수 위치가 0 으로 클램프되면 위치합이 총량보다 커진다(문서화된 비대칭) — 그 방향은 현황으로만 센다.
  const props = await prisma.property.findMany({ select: { id: true, name: true } })
  const totalBad: string[] = []
  const clampNote: string[] = []
  let items = 0
  for (const p of props) {
    const rows = await computeInventoryOverview(p.id)
    for (const r of rows) {
      items++
      if (r.currentStock == null || r.currentLocationBreakdown.length === 0) continue
      const byLoc = r.currentLocationBreakdown.reduce((s, l) => s + l.qty, 0)
      const diff = Math.round((byLoc - r.currentStock) * 1000) / 1000
      if (Math.abs(diff) <= 0.01) continue
      const line = `${p.name} · ${r.label} 총량 ${Math.round(r.currentStock * 100) / 100} 대 위치합 ${Math.round(byLoc * 100) / 100}`
      if (diff > 0) clampNote.push(line)   // 위치합이 큼 = 음수 위치 0 클램프(기존 비대칭)
      else totalBad.push(line)             // 위치합이 작음 = 어딘가에서 수량이 빠졌다
    }
  }
  await prisma.$disconnect()

  console.log(`[원장 조정] 점검 ${withBreakdown}건(위치별) · 품목 ${items}개 대조`)
  if (clampNote.length) {
    console.log(`  [현황] 음수 위치 0 클램프로 위치합이 총량보다 큰 품목 ${clampNote.length}건`)
    for (const l of clampNote) console.log('    - ' + l)
  }
  for (const l of headerBad) violations.push(`점검 헤더와 위치합이 다르다 — ${l}`)
  for (const l of totalBad) violations.push(`총량보다 위치합이 작다(수량이 어느 위치에도 없다) — ${l}`)
}

// ⓒ 이월 행 대조(2026-09-11) — carried=true 로 선언된 행은 파생값이므로 반드시
//   "직전 같은 위치 값 + 사이 입수 − 이번 점검의 허브 차감" 과 같아야 한다. 어긋났다는 것은
//   전파가 반만 걸렸거나 이월 계산이 갈라졌다는 뜻이다. 표식 없는 구식 행(null)은 대상 밖 —
//   그 시절엔 이 불변식을 선언한 적이 없다.
async function carriedParity() {
  const marked = await prisma.stockCheckLocation.findMany({
    where: { carried: true }, select: { stockCheck: { select: { trackedItemId: true } } },
  })
  const itemIds = [...new Set(marked.map(m => m.stockCheck.trackedItemId))]
  if (itemIds.length === 0) { console.log('[이월 행 대조] 표식 행 없음 — 대조 생략'); return }
  const items = await prisma.trackedItem.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, label: true, hubLocationId: true, propertyId: true, property: { select: { name: true } } },
  })
  let rowsChecked = 0
  for (const it of items) {
    const [checks, deltas, hubId] = await Promise.all([
      loadPropagationChecks(it.id),
      loadLedgerDeltas(it, it.propertyId),
      resolveItemHubLocationId(it.id, it.hubLocationId, it.propertyId),
    ])
    for (let i = 1; i < checks.length; i++) {
      const c = checks[i], prev = checks[i - 1]
      if (!c.hasBreakdown) continue
      const hubDeduct = hubId == null ? 0
        : c.byLoc.reduce((s, l) => s + (l.locationId === hubId ? 0 : (l.restockedQty ?? 0)), 0)
      for (const l of c.byLoc) {
        if (l.carried !== true) continue
        rowsChecked++
        const between = deltas.reduce((s, d) =>
          s + (d.locationId === l.locationId && deltaAfterCheck(d, prev) && !deltaAfterCheck(d, c) ? d.qty : 0), 0)
        const prevQty = prev.byLoc.find(p => p.locationId === l.locationId)?.qty ?? 0
        const expected = prevQty + between - (l.locationId === hubId ? hubDeduct : 0)
        // 이월 코드는 순변동이 음수면 0 클램프한다 — 그 방향은 설계된 비대칭이라 위반이 아니다.
        if (Math.abs(l.qty - expected) <= 0.001) continue
        if (expected < 0 && Math.abs(l.qty) <= 0.001) continue
        violations.push(
          `이월 행이 파생식과 다르다 — ${it.property.name} · ${it.label} ${new Date(c.dateMs).toISOString().slice(0, 10)} `
          + `저장 ${Math.round(l.qty * 1000) / 1000} 대 기대 ${Math.round(expected * 1000) / 1000}`,
        )
      }
    }
  }
  console.log(`[이월 행 대조] 품목 ${items.length}개 · 표식 행 ${rowsChecked}건 대조`)
}

async function main() {
  sourceGuards()
  await dataParity()
  await carriedParity()
  console.log(`[원장 조정] 위반 ${violations.length}건`)
  for (const v of violations) console.log('  - ' + v)
  if (violations.length > 0) process.exit(1)
}

main()
