// 퇴실 이용료 정산의 갈래 판단이 화면마다 갈리는 것을 잡는 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가. 갈래(위약금 / 면제 / 단기 요금 / 환불 안 함) 판단이 퇴실 정산 위젯 한 곳에만
// 있었다. 퇴실 처리 화면의 정본 섹션은 서버를 '위약금' 고정으로 불러 단기 견적을 버렸고, 같은
// 계약을 두 화면이 다르게 답했다. 506호가 그 틈으로 79,800원을 환불받았다(2026-09-02 신고).
// 판단을 lib/checkoutSettlement 한 벌로 모았고, 이 그물은 그것이 다시 흩어지는 것을 막는다.
//
//   ⓐ 서버 미리보기가 기본 갈래(defaultPick)를 정본 함수로 내려준다 — 화면이 제각기 정하지 않게.
//   ⓑ 정본 섹션과 위젯이 둘 다 lib 정본을 import 하고 세그먼트 선택지를 정본 함수로 만든다.
//      라벨을 직접 적으면 두 화면이 한 글자씩 어긋난다.
//   ⓒ 정본 섹션이 서버의 defaultPick 을 실제로 반영한다 — 받아만 두고 'legal' 로 시작하면 종전과 같다.
//   ⓓ 이용료 환불을 확정하는 세 화면이 전부 공용 확인창(confirmRentSettlement)을 부른다.
//      한 곳만 빠지면 환불 0·계산값과 다른 금액이 그 화면에서 조용히 확정된다.
//   ⓔ 정본 밖에 '전액 환불' 확인 문장을 따로 두지 않는다. 두 벌이 되면 언젠가 갈린다.
//
// 실행: node scripts/check-rent-settlement-branch.mjs
import { readFileSync } from 'node:fs'

const read = f => readFileSync(f, 'utf8')
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const violations = []

const ACTIONS = 'app/(app)/tenants/actions.ts'
const SECTION = 'components/checkout/RentSettlementSection.tsx'
const WIDGET = 'components/entity-modal/widgets/CheckoutProrationWidget.tsx'
const LIB = '@/lib/checkoutSettlement'

// ⓐ 서버가 기본 갈래를 정본 함수로 내려주는가.
{
  const src = read(ACTIONS)
  const fn = src.match(/export async function previewCheckoutRefund[\s\S]*?\n\}\n/)
  if (!fn) violations.push(`${ACTIONS} — previewCheckoutRefund 를 못 찾았다. 이름이 바뀌었으면 이 그물도 같이 고쳐야 한다.`)
  else if (!/defaultPick:\s*defaultSettlementPick\(/.test(stripComments(fn[0]))) {
    violations.push(`${ACTIONS} — previewCheckoutRefund 가 defaultPick 을 defaultSettlementPick() 으로 내려주지 않는다. 화면이 제각기 갈래를 정하게 된다.`)
  }
}

// ⓑ 두 화면이 정본을 쓰는가.
for (const file of [SECTION, WIDGET]) {
  const src = stripComments(read(file))
  if (!src.includes(`from '${LIB}'`)) violations.push(`${file} — lib/checkoutSettlement 를 import 하지 않는다. 갈래 판단이 두 벌이 된다.`)
  if (!/settlementPickOptions\(/.test(src)) violations.push(`${file} — 세그먼트 선택지를 settlementPickOptions() 로 만들지 않는다.`)
  if (!/settlementAmounts\(/.test(src)) violations.push(`${file} — 갈래별 금액을 settlementAmounts() 로 구하지 않는다.`)
  // 라벨만 정본이면 설명이 두 벌로 갈린다 — 실제로 단기 갈래를 두 화면이 다른 근거로 설명했다(웹디자이너 패스 2026-09-02).
  if (!/settlementPickCaption\(/.test(src)) violations.push(`${file} — 갈래 캡션을 settlementPickCaption() 으로 그리지 않는다. 같은 갈래를 화면마다 다르게 설명하게 된다.`)
  if (!/settlementPremise\(/.test(src)) violations.push(`${file} — 세그먼트 위 전제문을 settlementPremise() 로 그리지 않는다. '면제'가 무엇의 면제인지 화면마다 갈린다.`)
  for (const label of ['위약금 적용', '위약금 면제', '단기 요금', '환불 안 함']) {
    if (new RegExp(`label:\\s*'${label}'`).test(src)) violations.push(`${file} — 갈래 라벨 '${label}' 을 직접 적었다. SETTLEMENT_PICK_LABEL 정본을 쓴다.`)
  }
}

// ⓒ 정본 섹션이 서버의 defaultPick 을 반영하는가.
{
  const src = stripComments(read(SECTION))
  if (!/setPick\([a-zA-Z_]+\.defaultPick\)/.test(src)) {
    violations.push(`${SECTION} — 서버 응답의 defaultPick 을 setPick 에 넣지 않는다. 단기 자격인 계약도 '위약금' 으로 시작한다.`)
  }
}

// ⓓ 이용료 환불을 확정하는 화면이 전부 공용 확인창을 부르는가.
{
  const SCREENS = [
    ['홈 알림', 'app/(app)/dashboard/DashboardClient.tsx'],
    ['프리즘 위젯', 'components/entity-modal/widgets/TenantStatusTransitions.tsx'],
    ['입주자 관리 수정', 'app/(app)/tenants/TenantClient.tsx'],
  ]
  for (const [name, file] of SCREENS) {
    const src = stripComments(read(file))
    const finalizes = /finalizeRentRefund\(|rentRefundAmount/.test(src)
    if (!finalizes) { violations.push(`${file} — ${name} 이 이용료 환불을 확정하지 않는다. 경로가 바뀌었으면 이 그물도 같이 고쳐야 한다.`); continue }
    if (!/await confirmRentSettlement\(/.test(src)) {
      violations.push(`${file} — ${name} 이 이용료 환불을 확정하면서 confirmRentSettlement 를 안 부른다. 환불 0·계산값과 다른 금액이 조용히 확정된다.`)
    }
  }

  // ⓔ 정본 밖의 '전액 환불' 확인 문장.
  for (const [name, file] of SCREENS) {
    const src = stripComments(read(file))
    if (/이용료를 전액 환불할까요/.test(src)) violations.push(`${file} — ${name} 에 '전액 환불' 확인 문장이 따로 있다. confirmRentSettlement 한 벌로 묻는다.`)
  }
}

if (violations.length) {
  console.error('퇴실 정산 갈래 감지망 위반')
  for (const v of violations) console.error('  ' + v)
  process.exit(1)
}
console.log('퇴실 정산 갈래 감지망 통과 — 서버 defaultPick·두 화면 정본 공유·세 화면 확인창 연결')
