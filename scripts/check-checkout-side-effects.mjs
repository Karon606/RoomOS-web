// 퇴실의 부수 처리가 경로마다 갈리는 것을 잡는 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가. 퇴실이 건드리는 축은 다섯이다. 상태·공실·예약가 적용·청소 예정·거주 구간 마감.
// 그런데 퇴실 경로가 셋으로 갈리면서(홈 알림·프리즘 위젯·입주자 관리 수정) **어느 경로도
// 다섯을 다 하지 않았다.** 홈과 프리즘은 이용료 환불을 못 했고, 수정 폼은 청소 예정과 예약가
// 적용을 빠뜨렸다. 8/4 이후 퇴실 9건 중 3건에 퇴실 청소가 아예 없었던 것이 그 자국이다
// (2026-08-30 실측, knowledge/open-checkout-paths-split.md).
//
// 그래서 부수 처리를 applyCheckoutSideEffects 한 자리로 모았다. 이 그물은 그것이 흩어지는 것을
// 막는다. 축은 셋이다.
//
//   ⓐ 부수 처리 정본이 존재하고 다섯 축 중 넷(공실·예약가·청소·구간)을 다 한다.
//   ⓑ 퇴실 상태를 쓰는 서버 경로가 그 정본을 부른다 — 새 경로가 생겨도 빠뜨릴 수 없게.
//   ⓒ 정본 밖에서 ensureCheckoutCleaning 을 직접 부르지 않는다. 두 벌이 되면 언젠가 갈린다.
//
// 실행: node scripts/check-checkout-side-effects.mjs
import { readFileSync } from 'node:fs'

const FILE = 'app/(app)/tenants/actions.ts'
const src = readFileSync(FILE, 'utf8')
const violations = []

// ⓐ 정본이 다섯 축 중 넷을 하는가.
const fn = src.match(/async function applyCheckoutSideEffects[\s\S]*?\n\}\n/)
if (!fn) {
  violations.push(`${FILE} — applyCheckoutSideEffects 를 못 찾았다. 이름이 바뀌었으면 이 그물도 같이 고쳐야 한다.`)
} else {
  const body = fn[0]
  for (const [needle, what] of [
    ['isVacant: true', '공실 표시'],
    ['scheduledRent', '예약가 적용'],
    ['ensureCheckoutCleaning(', '청소 예정'],
    ['closeStay(', '거주 구간 마감'],
  ]) {
    if (!body.includes(needle)) violations.push(`${FILE} — 부수 처리 정본이 '${what}' 을 안 한다.`)
  }
}

// ⓑ 퇴실 상태를 쓰는 경로가 정본을 부르는가.
//    'CHECKED_OUT' 을 status 로 쓰는 서버 함수는 전부 대상이다.
const callers = [
  ['checkoutTenant', /export async function checkoutTenant[\s\S]*?\n\}\n/],
  ['updateTenant', /export async function updateTenant[\s\S]*?\n\}\n\n/],
]
for (const [name, re] of callers) {
  const m = src.match(re)
  if (!m) { violations.push(`${FILE} — ${name} 을 못 찾았다.`); continue }
  const writesCheckout = /status:\s*'CHECKED_OUT'|=== 'CHECKED_OUT'/.test(m[0])
  if (writesCheckout && !/applyCheckoutSideEffects\(/.test(m[0])) {
    violations.push(`${FILE} — ${name} 이 퇴실 상태를 쓰면서 부수 처리 정본을 안 부른다. 청소 예정·공실이 빠진다.`)
  }
}

// ⓒ 정본 밖에서 청소를 직접 만들지 않는가.
{
  const lines = src.split('\n')
  const fnStart = src.indexOf('async function applyCheckoutSideEffects')
  const fnEnd = fnStart >= 0 ? src.indexOf('\n}\n', fnStart) : -1
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
    // 선언 자체는 대상이 아니다 — 'async function ensureCheckoutCleaning(' 은 호출이 아니라 정의다.
    if (!/ensureCheckoutCleaning\(/.test(line) || /function\s+ensureCheckoutCleaning\(/.test(line)) return
    const at = lines.slice(0, i).join('\n').length
    const insideDef = at > src.indexOf('async function ensureCheckoutCleaning') && at < src.indexOf('async function ensureCheckoutCleaning') + 2000
    const insideCanon = fnStart >= 0 && at > fnStart && at < fnEnd
    if (!insideCanon && !insideDef) {
      violations.push(`${FILE}:${i + 1} — 정본 밖에서 청소를 직접 만든다. applyCheckoutSideEffects 를 쓴다.`)
    }
  })
}

// ⓓ 세 경로가 전부 이용료 환불을 확정하는가.
//    종전에는 입주자 관리 수정 한 곳에만 있어서, 다른 경로로 나가면 확정해 둔 일할·단기 요금
//    환불이 조용히 남았다. 422호처럼 단기 요금을 적용해 둔 계약도 그 경로로 나가면 안 잡혔다.
{
  const PATHS = [
    ['홈 알림', 'app/(app)/dashboard/DashboardClient.tsx', /rentRefundAmount/],
    ['프리즘 위젯', 'components/entity-modal/widgets/TenantStatusTransitions.tsx', /finalizeRentRefund\(/],
    ['입주자 관리 수정', 'app/(app)/tenants/TenantClient.tsx', /finalizeRentRefund\(/],
  ]
  for (const [name, f, re] of PATHS) {
    const src2 = readFileSync(f, 'utf8')
    if (!re.test(src2)) {
      violations.push(`${f} — '${name}' 경로가 이용료 환불을 확정하지 않는다. 보증금만 정산되고 일할 환불이 남는다.`)
    }
  }
  // 서버 문도 그 인자를 받아야 한다 — 화면이 실어 보내도 서버가 버리면 같은 결과다.
  const co = src.match(/export async function checkoutWithDepositRefund[\s\S]*?\n\}\n/)
  if (co && !/rentRefundAmount/.test(co[0])) {
    violations.push(`${FILE} — checkoutWithDepositRefund 가 이용료 환불 인자를 안 받는다.`)
  }
}

// ⓔ 세 경로가 **같은 정산 정본**을 쓰는가 (2026-08-31).
//    확정만 하는 것으로는 부족했다. 홈·프리즘은 미리 확정해 둔 값이 있을 때만 환불했고, 정산을
//    안 해 둔 중도퇴실은 아무것도 안 묻고 만월 청구를 그대로 두었다. 납부일 1일인 사람이 15일에
//    나가면 반 달치가 회사에 남고, 퇴실 상태라 미납 집계에서도 빠져 어느 화면에도 안 보인다.
//    계산·표시 문법을 화면마다 복제하면 방금 통합한 축이 다시 세 벌이 된다.
{
  const SCREENS = [
    ['홈 알림', 'app/(app)/dashboard/DashboardClient.tsx'],
    ['프리즘 위젯', 'components/entity-modal/widgets/TenantStatusTransitions.tsx'],
    ['입주자 관리 수정', 'app/(app)/tenants/TenantClient.tsx'],
  ]
  for (const [name, f] of SCREENS) {
    const src2 = readFileSync(f, 'utf8')
    if (!/<RentSettlementSection/.test(src2)) {
      violations.push(`${f} — '${name}' 이 정산 정본(RentSettlementSection)을 안 쓴다. 정산을 안 해 둔 중도퇴실이 그 화면에서만 조용히 지나간다.`)
    }
    // 일할·위약금 계산을 화면이 직접 부르면 그 순간 문법이 갈라진다. 정본 한 곳만 부른다.
    if (/previewCheckoutRefund\(/.test(src2)) {
      violations.push(`${f} — '${name}' 이 환불 계산을 직접 부른다. 계산은 RentSettlementSection 정본이 한다.`)
    }
  }
}

// ⓕ 홈택스·카드사 조치 안내를 세 경로가 다 말하는가 (2026-08-31).
//    서버는 만들어 주는데 받아 쓰는 곳이 수정 폼 하나뿐이었다. 현금영수증을 발행한 계약을 홈
//    알림에서 퇴실 처리하면 앱 매출만 조용히 줄고 홈택스에는 원 금액이 살아 있었다(519호 클래스).
{
  for (const [name, f] of [
    ['홈 알림', 'app/(app)/dashboard/DashboardClient.tsx'],
    ['프리즘 위젯', 'components/entity-modal/widgets/TenantStatusTransitions.tsx'],
    ['입주자 관리 수정', 'app/(app)/tenants/TenantClient.tsx'],
  ]) {
    const src2 = readFileSync(f, 'utf8')
    if (!/refundTaxNoticeLines\(/.test(src2)) {
      violations.push(`${f} — '${name}' 이 홈택스 조치 안내를 안 띄운다. 앱 매출만 줄고 취소하라는 말을 아무도 못 듣는다.`)
    }
  }
  // 서버가 화면까지 물려주지 않으면 화면이 띄우고 싶어도 값이 없다.
  const co2 = src.match(/export async function checkoutWithDepositRefund[\s\S]*?\n\}\n/)
  if (co2 && !/taxNotice/.test(co2[0])) {
    violations.push(`${FILE} — checkoutWithDepositRefund 가 홈택스 안내를 화면에 안 물려준다.`)
  }
}

// ⓖ 단기 계약을 이용료 정산에서 걸러 내는가 (2026-08-31 실기 지적, 404호).
//    단기의 rentAmount 는 월세가 아니라 체류 전체 사용료라 일할이라는 개념이 없다. 329,000 을
//    내고 17일 지냈으면 그게 계약대로인데, 30일로 나눠 일할하면 128,310 을 돌려줘야 하는 것처럼
//    보인다. 서버(finalizeRentRefund)는 이미 거부하고 있었고 미리보기만 그 판정을 안 했다 —
//    화면이 서버가 거절할 금액을 제안하는 형태였다.
{
  const pv = src.match(/export async function previewCheckoutRefund[\s\S]*?\n\}\n/)
  if (!pv) {
    violations.push(`${FILE} — previewCheckoutRefund 를 못 찾았다.`)
    // 존재만 보면 성글다 — isShortTerm 은 select 와 단기 요금 분기에도 나오므로, 판정을 true 로
    // 고정해 놓아도 통과한다(역주입에서 실제로 통과했다). **파생 관계**를 본다.
  } else if (!/settlementApplies\s*=\s*!\s*lease\.isShortTerm/.test(pv[0])) {
    violations.push(`${FILE} — 미리보기의 정산 성립 판정이 단기 여부에서 나오지 않는다. 화면이 서버가 거절할 환불액을 제안한다.`)
  }
  const sec = readFileSync('components/checkout/RentSettlementSection.tsx', 'utf8')
  if (!/settlementApplies/.test(sec)) {
    violations.push(`components/checkout/RentSettlementSection.tsx — 정산 성립 여부를 안 본다. 단기 계약에 환불 칸이 선다.`)
  }
}

// ⓗ 이미 잡힌 퇴실 청소를 두 경로가 같은 문법으로 말하는가 (2026-08-31 실기 지적).
//    서버는 열린 건이 있으면 새로 만들지도 날짜를 덮지도 않는다. 그런데 홈 알림만 그 판정을
//    안 해서, 9/2 로 잡힌 청소가 있는 방을 홈에서 열면 '미정'으로 떴다. 같은 방의 같은 청소가
//    어느 문으로 들어갔느냐로 다르게 보였다.
{
  for (const [name, f] of [
    ['홈 알림', 'app/(app)/dashboard/DashboardClient.tsx'],
    ['프리즘 위젯', 'components/entity-modal/widgets/TenantStatusTransitions.tsx'],
  ]) {
    const src2 = readFileSync(f, 'utf8')
    if (!/<CheckoutCleaningPlanned/.test(src2)) {
      violations.push(`${f} — '${name}' 이 이미 잡힌 청소를 안 알린다. 날짜가 있는데 미정으로 보이고, 적어 넣은 날짜는 아무 데도 안 간다.`)
    }
  }
  // **화면만 봐서는 성글다.** 홈은 알림 데이터로 방 id 를 받는데, 그 값을 안 실으면 조회가 아예
  // 안 돌아 화면이 고쳐져 있어도 '미정'으로 뜬다(2026-08-31 실기에서 실제로 그랬다).
  {
    const page = readFileSync('app/(app)/dashboard/page.tsx', 'utf8')
    const block = page.match(/moveOutHasRoom:[\s\S]{0,400}?\}\)/)
    if (!block || !/roomId:/.test(block[0])) {
      violations.push("app/(app)/dashboard/page.tsx — 퇴실 알림이 방 id 를 안 싣는다. 홈 퇴실 창이 이미 잡힌 청소를 물어볼 수 없다.")
    }
  }
}

console.log(`[퇴실 부수 처리] 축 ⓐ 정본 4축 · ⓑ 경로가 정본 호출 · ⓒ 정본 밖 직접 생성 금지 · ⓓ 세 경로 이용료 환불 · ⓔ 정산 정본 공유 · ⓕ 홈택스 안내 · ⓖ 단기 제외 · ⓗ 기존 청소 표시 / 위반 ${violations.length}건`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error('  퇴실이 건드리는 축은 다섯이다(상태·공실·예약가·청소·구간). 상태는 경로가 쓰고')
  console.error('  나머지 넷은 applyCheckoutSideEffects 한 자리를 지난다.')
  process.exit(1)
}
