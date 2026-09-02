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
  // 환불 0 도 확정이다(2026-09-02 '환불 없음'). 화면이나 서버가 '> 0' 으로 거르면 0 확정이 서버에
  // 안 실려 수납 정보 카드가 영영 '환불 미처리'로 선다. 그 게이트가 바로 미처리의 생성 경로였다.
  const GATES = [
    ['홈 알림', 'app/(app)/dashboard/DashboardClient.tsx', /rentRefundAmount\s*>\s*0/],
    ['프리즘 위젯', 'components/entity-modal/widgets/TenantStatusTransitions.tsx', /rentSettlement\.amount\s*>\s*0/],
    ['입주자 관리 수정', 'app/(app)/tenants/TenantClient.tsx', /rentAmt\s*>\s*0\s*\)\s*\{/],
  ]
  for (const [name, f, re] of GATES) {
    const src2 = readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, '')
    if (re.test(src2)) violations.push(`${f} — '${name}' 경로가 이용료 환불 0 을 서버에 안 싣는다('> 0' 게이트). '환불 없음' 확정이 안 남는다.`)
  }
  if (co && /rentRefundAmount\s*>\s*0/.test(co[0])) {
    violations.push(`${FILE} — checkoutWithDepositRefund 가 이용료 환불 0 을 버린다('> 0' 게이트). '환불 없음' 확정이 안 남는다.`)
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
    const block = page.match(/moveOutHasRoom:[\s\S]{0,900}?\}\)/)
    if (!block || !/roomId:/.test(block[0])) {
      violations.push("app/(app)/dashboard/page.tsx — 퇴실 알림이 방 id 를 안 싣는다. 홈 퇴실 창이 이미 잡힌 청소를 물어볼 수 없다.")
    }
  }
}

// ⓘ 퇴실 정산이 미래 달 선납을 세는가 (2026-08-31 실측 봉합, 513호).
//
//    종전에는 미리보기도 확정도 정산 귀속월 **한 달만** 봤다. 9월분을 8월에 미리 낸 사람이
//    8/31 에 나가면 9월은 하루도 안 사는데 그 돈이 집계에 아예 안 들어와 통째로 안 돌아갔다.
//    315,000원이 조용히 남았고, 미납으로도 과납으로도 안 뜨는데 매출로는 잡히는 상태였다.
//
//    어느 감지망도 못 잡았다. 그 record 가 스스로 청구를 세워 두고 그만큼 받았으니 차액이
//    0이라 대조가 정상으로 본다. 그래서 소스에서 잡는다 — 재발 형태가 정확히 'gte 가 한 달
//    비교로 되돌아가는 것'이다.
{
  for (const [name, re] of [
    ['미리보기', /export async function previewCheckoutRefund[\s\S]*?\n\}\n/],
    ['확정', /export async function finalizeRentRefund[\s\S]*?\n\}\n/],
  ]) {
    const fn = src.match(re)
    if (!fn) { violations.push(`${FILE} — '${name}' 을 못 찾았다.`); continue }
    if (!/targetMonth:\s*\{\s*gte:/.test(fn[0])) {
      violations.push(`${FILE} — 퇴실 정산 '${name}' 이 귀속월 한 달만 센다. 미래 달 선납이 통째로 안 돌아가고 매출로 잡힌다.`)
    }
  }
  // 계산 정본이 그 선납분을 따로 쥐는가 — 위약금을 물릴지 고르려면 갈라져 있어야 한다.
  const pr = readFileSync('lib/prorate.ts', 'utf8')
  if (!/futurePrepaid/.test(pr) || !/penalizeFuture/.test(pr)) {
    violations.push('lib/prorate.ts — 미래 달 선납분을 따로 안 쥔다. 위약금을 물릴지 고를 수 없다.')
  }
}

// ⓙ 퇴실일 기본값이 예정일인가 (2026-08-31 운영자 확정).
//
//    이 칸의 날짜가 일할 정산·환불·거주 구간 마감·보증금 반환일의 기준이다. 종전에는 기본값이
//    항상 오늘이라, 하루 늦게 처리하고 안 고치면 하루가 더 붙었다. 운영자 원문 — "9월 10일에
//    퇴실 처리를 하더라도 여기에 퇴실일이 8월 31일이면 퇴실은 8월 31일에 한 것이다".
{
  for (const [name, f] of [
    ['홈 알림', 'app/(app)/dashboard/DashboardClient.tsx'],
    ['프리즘 위젯', 'components/entity-modal/widgets/TenantStatusTransitions.tsx'],
    ['입주자 관리 수정', 'app/(app)/tenants/TenantClient.tsx'],
  ]) {
    const src2 = readFileSync(f, 'utf8')
    if (!/defaultCheckoutYmd\(/.test(src2)) {
      violations.push(`${f} — '${name}' 이 퇴실일 기본값 정본을 안 쓴다. 늦게 처리하면 퇴실일이 그날로 밀린다.`)
    }
  }
  // 알림이 예정일을 안 실으면 홈은 정본을 불러도 늘 오늘로 떨어진다.
  const page = readFileSync('app/(app)/dashboard/page.tsx', 'utf8')
  if (!/moveOutExpectedYmd:/.test(page)) {
    violations.push('app/(app)/dashboard/page.tsx — 퇴실 알림이 예정일을 안 싣는다. 홈 퇴실 창의 기본값이 늘 오늘이 된다.')
  }
}

// ⓚ 홈택스 안내가 **발행일·발행액**을 말하는가 (2026-09-01 운영자 재확인).
//
//    홈택스는 발행일로 찾는데 안내는 입금일을 적고 있었다. 두 날짜가 같을 필요가 없다는 것이
//    운영자 확정이다 — 받은 날 바로 안 끊고 모아서 끊는다(실측 33건 중 29건이 다르고
//    2026-08-22 하루에 18건이 몰려 있다). 없는 날짜를 적어 주면 운영자가 그날을 뒤진다.
//    금액도 같은 병이다. 발행액은 수납액과 다를 수 있어 표를 따로 세워 놓고(2026-08-24)
//    이 안내만 옛 방식으로 수납액을 세고 있었다.
{
  const fin = src.match(/export async function finalizeRentRefund[\s\S]*?\n\}\n/)
  if (!fin) {
    violations.push(`${FILE} — finalizeRentRefund 를 못 찾았다.`)
  } else {
    // 존재만 보면 성글다 — 발행 줄을 읽어 놓고 날짜만 payDate 로 적어도 통과한다. 둘 다 본다.
    if (!/cashReceiptIssueLines\(/.test(fin[0])) {
      violations.push(`${FILE} — 홈택스 안내가 발행 건 산출 정본을 안 쓴다. 입금일·수납액을 발행 사실로 적게 된다.`)
    }
    // 정본을 부르기만 하고 값은 옛 자리에서 퍼 오면 통과해 버린다. **cashReceipt 에 실리는 것**을 본다.
    // 발행 줄을 찾는 where 절에도 payDate 가 나오므로 창을 그 대목으로 좁힌다.
    const put = (fin[0].match(/cashReceipt:[\s\S]{0,200}/) || [''])[0]
    if (/payDate/.test(put)) {
      violations.push(`${FILE} — 홈택스 안내가 입금일(payDate)을 발행일로 적는다. 홈택스에 없는 날짜다.`)
    }
    if (/actualAmount/.test(put)) {
      violations.push(`${FILE} — 홈택스 안내가 수납액(actualAmount)을 발행액으로 적는다. 45만 받고 30만 끊은 건이 틀어진다.`)
    }
  }
  // 안내 타입이 사본이면 정본이 넓어져도 이 자리만 옛 모양으로 남는다 — 실제로 그렇게 갈려 있었다.
  if (!/export type RentRefundTaxNotice = RefundTaxNotice/.test(src)) {
    violations.push(`${FILE} — 안내 타입이 문구 정본(RefundTaxNotice)에 묶여 있지 않다. 모양이 갈린다.`)
  }
  // 문구 정본이 발행 건을 **여럿** 받는가. 한 날짜에 합계를 몰아 적으면 그 중 하나도 못 찾는다.
  const rn = readFileSync('lib/refundTaxNotice.ts', 'utf8')
  if (!/cashReceipt\?: \{ ymd: string; amount: number;?[^}]*\}\[\]/.test(rn)) {
    violations.push('lib/refundTaxNotice.ts — 발행 건을 하나만 받는다. 여러 날에 걸쳐 끊은 건을 한 날짜로 뭉갠다.')
  }
}

// ⓛ 환불 **적용취소**도 홈택스 조치를 말하는가 (2026-09-01).
//
//    안내를 보고 홈택스에서 이미 취소했는데 적용취소를 누르면, 앱 매출은 돌아오고 홈택스에는
//    없다. 519호 클래스를 뒤집은 같은 병이다. 게다가 원 수납이 되살아나 발행 표시도 함께
//    돌아오므로 앱 안에서는 아무 이상이 없어 보인다 — 그래서 더 위험하다.
{
  const un = src.match(/export async function undoRentRefund[\s\S]*?\n\}\n/)
  if (!un) {
    violations.push(`${FILE} — undoRentRefund 를 못 찾았다.`)
  } else if (!/cashReceiptIssueLines\(/.test(un[0]) || !/taxNotice/.test(un[0])) {
    violations.push(`${FILE} — 환불 적용취소가 홈택스 안내를 안 만든다. 앱 매출만 돌아오고 홈택스는 취소된 채 남는다.`)
  }
  // 서버가 만들어 줘도 화면이 버리면 아무도 못 듣는다 — ⓕ 에서 실제로 그랬다.
  for (const [name, f] of [
    ['입주자 관리 수정', 'app/(app)/tenants/TenantClient.tsx'],
    ['수납 정보 이용료 정산', 'components/entity-modal/widgets/RentSettlementPanel.tsx'],
  ]) {
    const src2 = readFileSync(f, 'utf8')
    if (/undoRentRefund\(/.test(src2) && !/undoRefundTaxNoticeLines\(/.test(src2)) {
      violations.push(`${f} — '${name}' 이 적용취소 뒤 재발행 안내를 안 띄운다.`)
    }
  }
  // 한 발행 줄이 환불 대상 밖 수납까지 덮으면 그 몫도 함께 취소된다 — 재발행액에 얹어야 한다.
  const cr = readFileSync('lib/cashReceipt.ts', 'utf8')
  if (!/outside\?: number/.test(cr)) {
    violations.push('lib/cashReceipt.ts — 발행 줄에 딸린 환불 대상 밖 몫을 안 센다. 보증금·지난 달 몫이 말없이 취소된다.')
  }
  const rn2 = readFileSync('lib/refundTaxNotice.ts', 'utf8')
  if (!/i\.outside/.test(rn2)) {
    violations.push('lib/refundTaxNotice.ts — 딸려 취소되는 몫을 안 알린다.')
  }
  // 감지망이 정상 중간 상태를 유령으로 울면 진짜 유령도 같이 안 읽힌다.
  const orph = readFileSync('scripts/check-cash-receipt-orphan.ts', 'utf8')
  if (!/receiptRowVerdict\(/.test(orph)) {
    violations.push('scripts/check-cash-receipt-orphan.ts — 발행 줄 판정 정본을 안 쓴다. 환불할 때마다 유령으로 운다.')
  }
}

// ⓜ 보증금 반환의 현금영수증 안내가 **조건부**인가 (2026-09-01 세무 패널).
//
//    보증금은 반환을 전제로 받는 예수금이라 애초에 발급 대상이 아니다. 그래서 안내는 그 계약에
//    보증금 포함 발행(inclDeposit)이 실제로 있을 때만 서야 한다 — 반환마다 일률로 띄우면
//    "보증금에도 세무 조치가 필요하다"는 잘못된 인식을 심는다. 반대로 조건 조회가 사라지면
//    포함 발행이 있어도 아무도 확인을 못 듣는다. 켜기 전 경고(두 화면)와 반환 뒤 안내가 한 쌍이다.
{
  const rd = src.match(/export async function recordDepositReturn[\s\S]*?\n\}\n/)
  if (!rd) {
    violations.push(`${FILE} — recordDepositReturn 을 못 찾았다.`)
  } else {
    if (!/inclDeposit: true/.test(rd[0]) || !/depositReturnReceiptNoticeLine\(/.test(rd[0])) {
      violations.push(`${FILE} — 보증금 반환이 포함 발행 여부를 안 본다. 보증금 포함 현금영수증이 있어도 확인을 권하지 못한다.`)
    }
    if (!/receiptNotice/.test(rd[0])) {
      violations.push(`${FILE} — 보증금 반환이 안내를 화면에 안 물려준다.`)
    }
  }
  // 홈 경로는 notice 문자열로 승계한다 — 서버가 만들어도 안 실으면 홈만 침묵한다(ⓕ에서 실제 있던 병).
  // 이름 존재만 보면 성글다 — 선언과 조인이 남은 채 승계 대입만 끊겨도 값은 늘 null 이다
  // (역주입에서 실제로 통과했다). **대입 자체**를 본다.
  const co3 = src.match(/export async function checkoutWithDepositRefund[\s\S]*?\n\}\n/)
  if (co3 && !/depositReceiptNotice\s*=\s*refundRes\.receiptNotice/.test(co3[0])) {
    violations.push(`${FILE} — 홈 퇴실 경로가 보증금 발행 안내를 안 물려준다.`)
  }
  // 나머지 두 직접 호출 화면도 띄워야 한다.
  for (const [name, f] of [
    ['입주자 관리 수정', 'app/(app)/tenants/TenantClient.tsx'],
    ['보증금 패널', 'components/entity-modal/widgets/DepositStatusPanel.tsx'],
    ['프리즘 상태 위젯', 'components/entity-modal/widgets/TenantStatusTransitions.tsx'],
  ]) {
    const src3 = readFileSync(f, 'utf8')
    if (/recordDepositReturn\(/.test(src3) && !/receiptNotice/.test(src3)) {
      violations.push(`${f} — '${name}' 이 보증금 발행 안내를 버린다.`)
    }
  }
  // 켜기 전 경고 — 보증금 몫이 발행에 섞이는 두 화면이 같은 정본 문구를 쓴다.
  for (const f of ['components/entity-modal/widgets/PaymentEntryForm.tsx', 'components/rooms/CashReceiptTab.tsx']) {
    if (!/depositCashReceiptWarning\(/.test(readFileSync(f, 'utf8'))) {
      violations.push(`${f} — 보증금 포함 발행 경고 정본을 안 쓴다. 화면마다 말이 갈리거나 없다.`)
    }
  }
}

// ⓝ '나중에 반환'이 세 경로에 서고, 반환 대기가 잊히지 않는가 (2026-09-01 운영자 승인).
//
//    실무 순서는 [방 확인 - 퇴실 - 계좌 수령 - 반환]인데 종전에는 퇴실 순간 반환을 강제해,
//    안 보낸 돈을 '반환함'으로 미리 찍는 길뿐이었다. 그 기록은 앱이 "끝났다"고 말해 어떤
//    그물에도 안 걸린다. 미룸은 저장 없는 파생 상태(퇴실 완료 + 기록 없음 + 기준액)로 선다.
{
  // 서버 — 홈 경로가 미룸 인자를 실제로 지키는가(인자만 받고 무시하면 미뤄도 기록된다).
  const co4 = src.match(/export async function checkoutWithDepositRefund[\s\S]*?\n\}\n/)
  if (co4 && !/!params\.deferDeposit/.test(co4[0])) {
    violations.push(`${FILE} — 홈 퇴실 경로가 deferDeposit 를 무시한다. '나중에 반환'을 골라도 기록된다.`)
  }
  // 세 화면 — 선택지가 실제로 서는가.
  // 라벨 글자로 보면 주석("'나중에 반환'이 없어")에 속는다(역주입에서 실제로 통과했다).
  // 세그먼트 **선택지 값**을 본다 — 이것이 지워지면 화면에서 고를 길이 없다.
  for (const [name, f] of [
    ['홈 정산 창', 'app/(app)/dashboard/DashboardClient.tsx'],
    ['프리즘 상태 위젯', 'components/entity-modal/widgets/TenantStatusTransitions.tsx'],
    ['입주자 관리 수정', 'app/(app)/tenants/TenantClient.tsx'],
  ]) {
    if (!/value:\s*'later',\s*label:\s*'나중에 반환'/.test(readFileSync(f, 'utf8'))) {
      violations.push(`${f} — '${name}' 에 '나중에 반환' 선택지가 없다. 안 보낸 돈을 반환함으로 미리 찍게 된다.`)
    }
  }
  // 프리즘 — 예약 취소 계열 제외. CANCELED 는 반환 대기 판정 밖이라 미루면 그대로 잊힌다.
  const tst = readFileSync('components/entity-modal/widgets/TenantStatusTransitions.tsx', 'utf8')
  if (!/deferNow = transDefer && def\.withDeposit === true && !active\?\.resvCancel && !active\?\.resvCancelPrepaid/.test(tst)) {
    violations.push('components/entity-modal/widgets/TenantStatusTransitions.tsx — 미룸 판정이 예약 취소 계열을 제외하지 않는다. 취소 몰취가 조용히 잊힌다.')
  }
  // 홈 — 대기 알림과 KPI 합산. 이 둘이 없으면 미룸은 그냥 잊는 기능이다.
  const page = readFileSync('app/(app)/dashboard/page.tsx', 'utf8')
  if (!/category:\s*'depositReturn'/.test(page) || !/pendingDepositReturns/.test(page)) {
    violations.push("app/(app)/dashboard/page.tsx — 보증금 반환 대기 알림이 없다. '나중에'가 곧 '영영'이 된다.")
  }
  // [^)]* 는 화살표 인자 (sum, l) 의 닫는 괄호를 못 넘는다 — 합산이 있어도 없다고 읽었다(실제 오탐).
  if (!/pendingDepositReturns\.reduce\([^;]*l\.basis/.test(page)) {
    violations.push('app/(app)/dashboard/page.tsx — 보유 보증금 KPI 가 반환 대기분을 안 더한다. 부채가 집계에서 사라진다.')
  }
  // 판정 정본 공유 — 알림·감지망·서버가 같은 기준액 식을 써야 한 쪽만 우는 상태가 안 생긴다.
  if (!/depositBasisOf\(/.test(page) || !/depositBasisOf\(/.test(src)) {
    violations.push('보증금 기준액 판정이 정본(lib/depositPending)을 안 쓴다. 알림과 서버가 다른 답을 낸다.')
  }
  const net = readFileSync('scripts/check-deposit-settlement.ts', 'utf8')
  if (!/depositBasisOf\(/.test(net) || !/DEPOSIT_RETURN_GRACE_DAYS/.test(net)) {
    violations.push('scripts/check-deposit-settlement.ts — 그물이 기준액 정본·유예를 안 쓴다.')
  }
}

// ⓞ 퇴실 예정 때 고른 사유를 퇴실 처리가 이어받는가 (2026-09-02 신고, 506호).
//
//    사유를 말하는 시점은 통보를 받는 '퇴실 예정'인데, 퇴실 처리 폼은 사유 칸을 빈 채로 열었고
//    홈 알림 경로는 아예 묻지 않았다. 예정 행에만 남고 확정 행은 비어, 표·카드의 퇴실 사유가
//    사라졌다. 판정은 lib/checkoutReason 한 벌이다 — 화면(프리필)과 서버(이어받기)와 사후
//    그물(감사)이 같은 함수를 봐야 어느 한 경로만 옛 사유를 붙이거나 빠뜨리지 않는다.
{
  // 서버 — 화면 없는 경로는 사유를 스스로 잇고, 그 값을 확정 행에 싣는다.
  const co5 = src.match(/export async function checkoutTenant\([\s\S]*?\n\}\n/)
  if (!co5) {
    violations.push(`${FILE} — checkoutTenant 를 못 찾았다.`)
  } else {
    const logBlock = co5[0].match(/tenantStatusLog\.create\(\{[\s\S]*?\}\)/)
    if (!/latestCheckoutReasonFor\(/.test(co5[0]) || !logBlock || !/\breason\b/.test(logBlock[0])) {
      violations.push(`${FILE} — 홈 퇴실 경로가 퇴실 예정 사유를 안 잇는다. 확정 행의 사유가 빈 채 굳는다.`)
    }
  }
  // 두 화면 — 퇴실 처리 사유를 정본 판정으로 채운다.
  for (const [name, f] of [
    ['프리즘 입주자 본문', 'components/entity-modal/bodies/TenantBody.tsx'],
    ['입주자 관리 수정', 'app/(app)/tenants/TenantClient.tsx'],
  ]) {
    if (!/inheritableCheckoutReason\(/.test(readFileSync(f, 'utf8'))) {
      violations.push(`${f} — '${name}' 이 퇴실 예정 사유 판정 정본을 안 쓴다. 폼이 빈 채 열린다.`)
    }
  }
  // 프리즘 미니폼 — 본문이 넘긴 값을 실제로 시작값으로 쓴다(넘기기만 하고 안 쓰면 같은 병).
  const tst2 = readFileSync('components/entity-modal/widgets/TenantStatusTransitions.tsx', 'utf8')
  if (!/lease\.checkoutReason/.test(tst2) || !/setTransReasonPrefill\(/.test(tst2)) {
    violations.push('components/entity-modal/widgets/TenantStatusTransitions.tsx — 퇴실 미니폼이 예정 사유로 시작하지 않는다.')
  }
  // 사후 그물 — 확정 행이 비었는데 이어받을 사유가 있던 건을 같은 판정으로 잡는다.
  const audit = readFileSync('lib/integrityAudit.ts', 'utf8')
  if (!/checkout-reason-dropped/.test(audit) || !/inheritableCheckoutReason\(/.test(audit)) {
    violations.push('lib/integrityAudit.ts — 퇴실 사유 누락 감사(규칙 7)가 없거나 판정 정본을 안 쓴다.')
  }
}

// ⓟ 수납 정보의 이용료 정산 카드 (2026-09-02 운영자 요청).
//
//    퇴실 예정·완료 계약의 이용료 환불은 이 카드가 정본이다 — 예상액·확정 결과·적용취소·금액 수정이
//    한 자리에 선다. 입주자 정보 탭의 적용취소 행은 퇴실 완료 계약을 안 실어 정작 퇴실자에게 안 그려졌다.
//    그래서 세 가지를 본다. 카드가 실제로 수납 정보에 서는가, 카드의 확정(재확정·환불 기록)도 홈택스
//    안내를 띄우는가, 확정이 만든 수납 기록이 스냅샷과 어긋나면 사후 그물이 잡는가.
{
  const pb = readFileSync('components/entity-modal/bodies/PaymentBody.tsx', 'utf8')
  if (!/<RentSettlementPanel\b/.test(pb)) {
    violations.push('components/entity-modal/bodies/PaymentBody.tsx — 수납 정보에 이용료 정산 카드가 없다. 퇴실자의 환불 결과·적용취소를 볼 자리가 사라진다.')
  }
  const rp = readFileSync('components/entity-modal/widgets/RentSettlementPanel.tsx', 'utf8')
  if (!/finalizeRentRefund\(/.test(rp) || !/refundTaxNoticeLines\(/.test(rp)) {
    violations.push('components/entity-modal/widgets/RentSettlementPanel.tsx — 카드의 환불 확정이 홈택스 안내(refundTaxNoticeLines)를 안 띄운다.')
  }
  if (!/undoRentRefund\(/.test(rp)) {
    violations.push('components/entity-modal/widgets/RentSettlementPanel.tsx — 카드에 적용취소가 없다(§16 상시 진입점).')
  }
  const audit2 = readFileSync('lib/integrityAudit.ts', 'utf8')
  if (!/rent-refund-record-drift/.test(audit2)) {
    violations.push('lib/integrityAudit.ts — 환불 스냅샷과 수납 기록의 어긋남 감사(규칙 8)가 없다.')
  }
  // '환불 없음' 출구(2026-09-02). 카드의 [환불 없음]과 서버의 0 확정이 같은 셈(rentRefundPendingFor)을
  // 써야 카드가 보여 준 숫자와 서버가 거부하는 기준이 안 갈린다. 서버는 뒤 달 선납이 있으면 0 을 거부하고,
  // 스냅샷이 살아 있으면 어떤 확정도 다시 받지 않는다. 확정 뒤 청구가 다시 손대지면 감사가 잡는다.
  const fin = src.match(/export async function finalizeRentRefund[\s\S]*?\n\}\n/)
  const pend = src.match(/export async function getPendingRentRefundNotice[\s\S]*?\n\}\n/)
  if (!fin || !/rentRefundPendingFor\(/.test(fin[0]) || !pend || !/rentRefundPendingFor\(/.test(pend[0])) {
    violations.push(`${FILE} — finalizeRentRefund 와 getPendingRentRefundNotice 가 같은 셈(rentRefundPendingFor)을 안 쓴다. 카드의 미처리액과 서버의 0 확정 기준이 갈린다.`)
  }
  if (fin && !/later\s*>\s*0/.test(fin[0])) {
    violations.push(`${FILE} — finalizeRentRefund 의 0 갈래가 뒤 달 선납(later)을 거부하지 않는다. 이용하지 않은 달의 선납이 '환불 없음'으로 닫힌다.`)
  }
  if (fin && !/if \(undoBase\.refund/.test(fin[0])) {
    violations.push(`${FILE} — finalizeRentRefund 에 스냅샷 존재 가드가 없다. 전액 환불·환불 없음 뒤 재확정이 이중으로 선다.`)
  }
  if (!/SETTLEMENT_PICK_LABEL\.none/.test(rp)) {
    violations.push('components/entity-modal/widgets/RentSettlementPanel.tsx — 카드에 [환불 없음] 출구가 없다. 안 돌려주기로 한 계약이 영영 미처리로 선다.')
  }
  if (!/refund-billing-drift/.test(audit2)) {
    violations.push('lib/integrityAudit.ts — 환불 확정 뒤 청구 재수정 감사(규칙 3-b refund-billing-drift)가 없다.')
  }
}

// ⓠ 환불 확정 뒤 청구 쓰기 거부 (2026-09-03).
//
//    finalizeRentRefund 가 확정한 청구(prepaid − refunded)는 고정값이다. 그런데 일할 위젯의
//    setCheckoutProration 은 스냅샷을 안 보고 그 값을 일할값으로 덮었다. 수납이 과납으로 보여 정산이
//    다시 '환불 가능'으로 서는 이중 환불 입구였다. 술어는 hasRentRefundSnapshot 하나다. 이름 하나로
//    걸어야 세 자리(set·clear·prorationDataForChange)에 흩어진 `'refund' in undo` 관용구가 다시 안 생긴다.
{
  const guarded = [
    ['setCheckoutProration', /export async function setCheckoutProration[\s\S]*?\n\}\n/],
    ['clearCheckoutProration', /export async function clearCheckoutProration[\s\S]*?\n\}\n/],
    ['prorationDataForChange', /function prorationDataForChange[\s\S]*?\n\}\n/],
  ]
  for (const [name, re] of guarded) {
    const m = src.match(re)
    if (!m) { violations.push(`${FILE} — ${name} 을 못 찾았다. 이름이 바뀌었으면 이 그물도 같이 고쳐야 한다.`); continue }
    if (!/hasRentRefundSnapshot\(/.test(m[0])) {
      violations.push(`${FILE} — ${name} 에 환불 스냅샷 가드(hasRentRefundSnapshot)가 없다. 환불 확정 뒤 청구가 덮이거나 지워진다.`)
    }
    if (name === 'setCheckoutProration') {
      const g = m[0].indexOf('hasRentRefundSnapshot(')
      const c = m[0].indexOf('settlementCalcFor(')
      if (g >= 0 && c >= 0 && g > c) {
        violations.push(`${FILE} — setCheckoutProration 의 환불 가드가 정산 계산 뒤에 선다. 확정 계약도 일할 계산을 지나 버린다.`)
      }
    }
  }
  if (/'refund' in \(/.test(src)) {
    violations.push(`${FILE} — 스냅샷 판정을 'refund' in 관용구로 직접 쓴다. hasRentRefundSnapshot 하나로 모은다.`)
  }
  const sentence = /이용료 환불이 확정된 계약입니다\. 환불 적용취소를 먼저 진행해 주세요\./g
  const n = (src.match(sentence) || []).length
  if (n !== 2) {
    violations.push(`${FILE} — 환불 확정 거부 문장이 ${n}회다(기대 2회 set·clear). 자리가 늘었으면 이 수를, 문장이 갈렸으면 문장을 맞춘다.`)
  }
}

console.log(`[퇴실 부수 처리] 축 ⓐ 정본 4축 · ⓑ 경로가 정본 호출 · ⓒ 정본 밖 직접 생성 금지 · ⓓ 세 경로 이용료 환불 · ⓔ 정산 정본 공유 · ⓕ 홈택스 안내 · ⓖ 단기 제외 · ⓗ 기존 청소 표시 · ⓘ 미래 선납 집계 · ⓙ 퇴실일 기본값 · ⓚ 발행일 축 · ⓛ 적용취소 안내 · ⓜ 보증금 발행 조건부 · ⓝ 나중에 반환 · ⓞ 퇴실 사유 승계 · ⓟ 수납 정보 정산 카드 · ⓠ 환불 확정 뒤 청구 쓰기 거부 / 위반 ${violations.length}건`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error('  퇴실이 건드리는 축은 다섯이다(상태·공실·예약가·청소·구간). 상태는 경로가 쓰고')
  console.error('  나머지 넷은 applyCheckoutSideEffects 한 자리를 지난다.')
  process.exit(1)
}
