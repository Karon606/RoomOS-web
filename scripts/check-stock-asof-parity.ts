// 재고 잔량 경계 규칙이 두 곳에서 갈리는지 잡는다 (C페이즈 2026-08-03).
//
// 화면 현재고(overview.ts)는 구매 경계를 **점검 생성 시각(createdAt)** 으로 잡는다.
// 보정 폼 프리필(getStockAsOf)이 점검 날짜(자정)를 쓰는 바람에, 그 점검이 이미 반영한
// 같은 날 수령을 한 번 더 더했다. 그대로 저장하면 오차가 기준선으로 박혀 영구 편입된다.
//   실측 — 종량제쓰레기봉투 50L 21매를 31매로, 리클린 1.5L 를 3.5L 로 채웠다.
//
// 데이터 대조는 그물이 못 된다 — 같은 날 수령과 점검이 함께 있는 것 자체는 정상이라 늘 걸린다.
// 감시할 것은 **코드가 다시 날짜 경계로 돌아가는 것**이다.
//
// 실행: npx tsx --env-file=.env.local scripts/check-stock-asof-parity.ts
import { readFileSync } from 'node:fs'

const violations: string[] = []
const src = readFileSync('app/(app)/inventory/actions.ts', 'utf8')

// getStockAsOf 의 구매 조회가 createdAt 컷오프를 쓰는가
const asOfBlock = src.slice(src.indexOf('export async function getStockAsOf'))
const purchaseWhere = asOfBlock.slice(0, asOfBlock.indexOf('const purchaseTotal'))
if (!/basePurchaseCutoff/.test(purchaseWhere)) {
  violations.push('getStockAsOf 가 구매 경계에 점검 생성 시각을 안 쓴다 — 같은 날 수령이 이중 계상된다')
}
if (/receivedAt:\s*\{[^}]*gt:\s*baseDate/.test(purchaseWhere)) {
  violations.push('getStockAsOf 가 구매 경계로 점검 날짜(자정)를 쓴다 — overview 의 정본과 규칙이 다르다')
}

// 정본 쪽이 createdAt 을 유지하는가
const ov = readFileSync('app/(app)/inventory/overview.ts', 'utf8')
if (!/sumPurchases\([^)]*last\.createdAt/.test(ov)) {
  violations.push('overview 의 현재고 계산이 점검 생성 시각 기준을 잃었다')
}

// 금액 노출 — 재고 축에 canReadScope('money') 가 한 군데도 없어 제한 스태프가 단가·금액을 다 봤다.
// UI 만 가리면 서버 액션 호출로 뚫리므로 서버 지우기가 정본이다.
if (!/canSeeMoney/.test(src)) violations.push('inventory/actions 에 금액 읽기 가드(canSeeMoney)가 없다')
for (const fn of ['getMonthlyInflow', 'getPriceHistory']) {
  const idx = src.indexOf(`export async function ${fn}`)
  if (idx < 0) continue
  if (!/canSeeMoney/.test(src.slice(idx, idx + 400))) violations.push(`${fn} 이 금액을 가드 없이 반환한다`)
}
if (!/avgUnitPrice: null/.test(src)) violations.push('getInventoryOverview 가 금액을 서버에서 지우지 않는다')
const assetsSrc = readFileSync('app/(app)/inventory/assets/actions.ts', 'utf8')
if (!/canReadScope\(await getMyRole\(\), 'money'\)/.test(assetsSrc)) {
  violations.push('비품·자재 조회에 금액 읽기 가드가 없다')
}

console.log(`[재고 경계] 위반 ${violations.length}건`)
for (const v of violations) console.log('  - ' + v)
if (violations.length > 0) process.exitCode = 1
