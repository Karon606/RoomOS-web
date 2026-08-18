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
  if (!/planStockShift\(/.test(actions) || !/from '@\/lib\/stockLedger'/.test(actions)) {
    violations.push('재고 액션이 조정 계산 정본(lib/stockLedger planStockShift)을 쓰지 않는다')
  }

  // ── 적용부 ────────────────────────────────────────────────────────────
  const apply = block(actions, 'async function applyShiftRows', '\n}\n', 'applyShiftRows')
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
    // createdAt 을 밀면 구간 귀속 순서(effTime)가 조용히 바뀐다.
    if (/createdAt/.test(apply)) {
      violations.push('applyShiftRows 가 점검 createdAt 을 바꾼다 — 구간 귀속 순서가 조용히 달라진다')
    }
  }

  // 되돌리기 페이로드는 클라이언트발이다. 품목 스코프 검증이 빠지면 남의 점검을 덮어쓸 수 있다.
  // ⚠️ 함수 어딘가에 trackedItemId 가 있는지로 보면 안 된다 — 링크 정리 쪽에도 같은 문자열이 있어
  //    소유 검증만 지워도 통과했다(역주입 실측). **소유 조회 그 자리**를 본다.
  const revert = block(actions, 'async function revertShiftRows(', '\n}\n', 'revertShiftRows')
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

async function main() {
  sourceGuards()
  await dataParity()
  console.log(`[원장 조정] 위반 ${violations.length}건`)
  for (const v of violations) console.log('  - ' + v)
  if (violations.length > 0) process.exit(1)
}

main()
