// 돈 표시·수납 정합 상시 감지 — 읽기 전용, 위반 시 exit 1 (크리티컬 신고 50a2a69b 재발 감지망).
// 소스 가드: 표시 정본(billForLeaseMonth·discountedRent) 이탈 패턴이 코드에 되살아나는지.
// 데이터 대조: 보증금 중복 수납, 할인 미반영 락(되쓰기 누락 의심)을 SELECT 로 탐지.
import { readFileSync, readdirSync } from 'fs'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
const violations = []

// 카테고리·결제수단 문자열은 lib/incomeCategories 가 정본이나 이 스크립트는 .mjs 라 TS 를 못 읽는다.
// 사본이 갈리지 않게 아래 소스 가드(규칙 6)가 정본에 같은 문자열이 있는지 함께 본다.
const DEPOSIT_SOURCED_PAY_METHOD = '보유 보증금'
const CLEANING_CATEGORY = '청소비'
// '입실 때 별도로 받은 청소비' 만 — 퇴실 정산이 보증금 청소비 몫으로 만든 분은 뺀다(2026-08-11).
// NOT 만 쓰면 payMethod NULL 행까지 떨어진다(SQL 3치 논리) — 정본과 같은 OR 문법.
const CLEANING_RECEIVED_WHERE = {
  category: CLEANING_CATEGORY,
  OR: [{ payMethod: null }, { payMethod: { not: DEPOSIT_SOURCED_PAY_METHOD } }],
}

// ── 소스 가드 ──────────────────────────────────────────────
const roomsActions = readFileSync('app/(app)/rooms/actions.ts', 'utf8')
if (!roomsActions.includes('reservedExpected = discountedRent')) {
  violations.push('[소스] rooms/actions RESERVED 분기의 할인 반영(reservedExpected = discountedRent)이 사라짐 — 정본 수렴 회귀')
}
if (!roomsActions.includes('fbExpected = discountedRent(lease.discounts ?? [], fbMoveInMonth, fbBase)')) {
  violations.push('[소스] rooms/actions RESERVED fallback(fbExpected) 이 예약 인상 반영을 잃음 — 호실 배정 전후로 금액이 달라진다')
}
if (roomsActions.includes('expected: lease.rentAmount')) {
  violations.push('[소스] rooms/actions 에 원가 직표시(expected: lease.rentAmount) 재등장 — 표시 정본 이탈')
}
const entryForm = readFileSync('components/entity-modal/widgets/PaymentEntryForm.tsx', 'utf8')
if (/payDate[^\n]*moveInDate/.test(entryForm)) {
  violations.push('[소스] PaymentEntryForm 수납일 기본값이 입주일 파생으로 회귀 의심 — 수납일 정본은 오늘(받은 날)')
}
// 수납 스트립 RESERVED 혼입 가드(신고 78ea0c3d) — 예약 행 expected는 표시용이라 스트립 청구·수납 합산에서 제외돼야 한다.
// 단기 일할 가드(신고 2026-08-01) — 단기는 주 단위 정액이라 퇴실 일할 대상이 아니다.
const tenantsActions = readFileSync('app/(app)/tenants/actions.ts', 'utf8')
if (!tenantsActions.includes('if (lease.isShortTerm) {')) {
  violations.push('[소스] tenants/actions prorationDataForChange 의 단기 제외 가드가 사라짐 — 단기에 퇴실 일할이 붙어 이중 청구된다')
}

// 인상 예약 락 되쓰기 가드(A페이즈) — 없으면 이미 선납된 달의 락이 인상을 이겨 인상분이 영원히 미청구.
// 정본 자리는 rooms/paymentEngine (2026-08-10 보안 감사 — 'use server' 파일에 두면 무권한 엔드포인트가 된다).
const paymentEngine = readFileSync('app/(app)/rooms/paymentEngine.ts', 'utf8')
if (!paymentEngine.includes('export async function rewriteLockedExpectedForRentSchedule')) {
  violations.push('[소스] rooms/paymentEngine 의 인상 예약 락 되쓰기(rewriteLockedExpectedForRentSchedule)가 사라짐 — 선납된 달의 인상분이 미청구로 남는다')
}
// 되쓰기 3형제는 서버 액션이 아니어야 한다. 'use server' 로 되돌아가면 권한·격리 없이 남의 청구액을 되쓸 수 있다.
if (/^\s*['"]use server['"]/m.test(paymentEngine)) {
  violations.push("[소스] rooms/paymentEngine 에 'use server' 가 붙었다 — 내부 헬퍼가 무권한 서버 액션 엔드포인트로 노출된다")
}
const roomManage = readFileSync('app/(app)/room-manage/actions.ts', 'utf8')
if ((roomManage.match(/rewriteLockedExpectedForRentSchedule/g) ?? []).length < 2) {
  violations.push('[소스] room-manage 의 인상 예약 되쓰기 호출이 빠짐 — 단건·일괄 두 경로 모두 걸려 있어야 한다')
}

const roomsClient = readFileSync('app/(app)/rooms/RoomsClient.tsx', 'utf8')
if (!roomsClient.includes("occupied.filter(r => r.status !== 'RESERVED')")) {
  violations.push('[소스] RoomsClient 스트립의 RESERVED 제외 필터(billableRows)가 사라짐 — 예약 전액이 청구·수납에 혼입되는 회귀')
}
if (/expectedSum\s*=\s*occupied\.reduce/.test(roomsClient)) {
  violations.push('[소스] RoomsClient expectedSum 이 occupied 직접 합산으로 회귀 — RESERVED 행 혼입(청구·수납 부풀림)')
}

// ── 데이터 대조 ────────────────────────────────────────────
// 간이 할인 계산 — lib/rentDiscount 규칙(amount/percent, permanent/temporary 월 범위, 0 하한)과 동일
function discounted(discounts, month, base) {
  let total = 0
  for (const d of discounts) {
    const inRange = d.scope === 'permanent'
      || ((d.startMonth == null || month >= d.startMonth) && (d.endMonth == null || month <= d.endMonth))
    if (!inRange) continue
    total += d.discountType === 'percent' ? Math.floor(base * d.value / 100) : d.value
  }
  return Math.max(0, base - total)
}

// 1. 보증금 중복 수납 — lease 별 isDeposit 실수납 합 > 계약 보증금
const leases = await prisma.leaseTerm.findMany({
  where: { depositAmount: { gt: 0 } },
  select: {
    id: true, depositAmount: true, rentAmount: true, isShortTerm: true, checkoutProratedMonth: true,
    tenant: { select: { name: true } },
    discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
    paymentRecords: { where: { deletedAt: null }, select: { isDeposit: true, actualAmount: true, expectedAmount: true, targetMonth: true } },
  },
})
for (const l of leases) {
  const depositPaid = l.paymentRecords.filter(r => r.isDeposit).reduce((s, r) => s + r.actualAmount, 0)
  if (depositPaid > l.depositAmount) {
    violations.push(`[데이터] ${l.tenant.name}: 보증금 실수납 ${depositPaid.toLocaleString()}원 > 계약 ${l.depositAmount.toLocaleString()}원 — 중복 수납 의심`)
  }
  // 2. 할인 적용월의 락이 원가 그대로면 되쓰기 누락 의심 (협의 락은 원가와 다른 값이라 미탐지, 일할 월 제외)
  if (l.isShortTerm || l.discounts.length === 0) continue
  const byMonth = new Map()
  for (const r of l.paymentRecords.filter(r => !r.isDeposit)) {
    byMonth.set(r.targetMonth, Math.max(byMonth.get(r.targetMonth) ?? 0, r.expectedAmount))
  }
  for (const [mon, lockedMax] of byMonth) {
    if (lockedMax <= 0 || mon === l.checkoutProratedMonth) continue
    const want = discounted(l.discounts, mon, l.rentAmount)
    if (want !== l.rentAmount && lockedMax === l.rentAmount) {
      violations.push(`[데이터] ${l.tenant.name} ${mon}: 락 ${lockedMax.toLocaleString()}원이 할인 미반영 원가 그대로 — 되쓰기 누락 의심(기준 ${want.toLocaleString()}원)`)
    }
  }
}

// 3. 미래 수납일 — '받은 날'이 아직 오지 않았다면 입주일 등 파생값이 샌 것(수납일 기본값 회귀 흔적).
//    월 필터 화면에서 사라져 보여 중복 수납을 부른다(신고 50a2a69b 의 직접 원인, 백필 후 감시).
// (이 스크립트는 원시 클라이언트라 lib/prisma 의 소프트삭제 자동 필터가 없다 — deletedAt 명시 필수)
const futurePays = await prisma.paymentRecord.findMany({
  where: { deletedAt: null, payDate: { gt: new Date(Date.now() + 9 * 3600000) } },
  select: { payDate: true, actualAmount: true, leaseTerm: { select: { tenant: { select: { name: true } } } } },
})
for (const r of futurePays) {
  violations.push(`[데이터] ${r.leaseTerm?.tenant?.name ?? '?'}: 수납일 ${r.payDate.toISOString().slice(0, 10)} 이 미래 — 받은 날이 아닌 파생값 의심`)
}

// 4. 단기인데 퇴실 일할이 붙은 계약 — 그 기간 전액을 이미 받았는데 일할이 더해지면 이중 청구
const shortProrated = await prisma.leaseTerm.findMany({
  where: { isShortTerm: true, checkoutProratedAmount: { not: null } },
  select: { checkoutProratedMonth: true, checkoutProratedAmount: true, tenant: { select: { name: true } } },
})
for (const l of shortProrated) {
  violations.push(`[데이터] ${l.tenant.name}: 단기 계약에 퇴실 일할 ${l.checkoutProratedAmount?.toLocaleString()}원(${l.checkoutProratedMonth}) — 주 단위 정액이라 일할 대상 아님(이중 청구)`)
}

// 5. 현금영수증 집계 배타 — 카드는 매출전표가 증빙을 대신하므로 현금영수증 합계에 넣지 않는다.
//    두 if 가 배타가 아니면 같은 금액이 양쪽에 계상돼 세무 대사가 틀어진다(520호 172,000원 사례).
if (!roomsActions.includes('else if (r.cashReceiptIssuedAt)')) {
  violations.push('[소스] getMonthPaymentAggregates 의 현금영수증·카드 배타 처리가 사라짐 — 카드 건이 양쪽에 이중 계상된다')
}

// 6. 보증금 몰취 수입의 카테고리 — 옛 이름 '보증금' 이 남으면 세무 자료에서 예수보증금(부채)으로
//    읽힌다(회계 패널 2026-08-01). 코드는 lib/incomeCategories 정본을 쓰고 과거분은 백필했다.
//    새로 생기면 여기서 잡는다(백필만 하고 감지가 없으면 또 갈린다).
const legacyForfeit = await prisma.extraIncome.findMany({
  where: { deletedAt: null, category: '보증금', payMethod: '보유 보증금' },
  select: { date: true, amount: true, detail: true },
})
for (const r of legacyForfeit) {
  violations.push(`[데이터] ${r.date.toISOString().slice(0, 10)} ${r.amount.toLocaleString()}원 — 몰취 수입 카테고리가 옛 이름 '보증금' (정본 '보증금 몰취'). ${r.detail ?? ''}`)
}
// import 만 남아도 통과하지 않게 '사용'을 본다 — 감지망이 통과만 하면 무력해진다(같은 실수 전례:
// check-standalone-scroll 의 lockBackgroundScroll).
if (!/:\s*FORFEIT_CATEGORY/.test(tenantsActions)) {
  violations.push("[소스] 몰취 카테고리가 lib/incomeCategories 정본을 안 탄다 — 문자열이 흩어지면 개명 때 일부만 바뀐다")
}

// 6-2. 퇴실 미반환분의 성격 분류 (운영자 정본 2026-08-11).
//
//   "보증금 5만원에 이미 청소비 2만원이 포함되어 있었고 난 3만원을 돌려준 거야. 즉 정상적인 청소비를
//    받은 거야. 보증금 몰취는 시설물이 파손되거나 했을 때 (잔여) 3만원에서 차감할 때 몰취가 되는 거지."
//
//   보증금 안의 청소비 몫은 '청소비', 그 몫을 넘는 차감만 '보증금 몰취'다. 종전에는 사유와 무관하게
//   전부 몰취로 찍혀 정상 청소비 수취 3건이 손해배상성 잡수입으로 서 있었다.
//   여기(게이트)는 **구조 정합**만 본다 — 미반환분 부가수익 합이 DepositRefund.withheldAmount 와
//   어긋나면 분리 기록이 깨진 것이다(한쪽만 만들어졌거나, 적용취소가 한 행만 지웠거나).
//   분류가 맞는지(청소비 몫이 몰취로 잡혀 있는지)는 verify:data 쪽 비차단 축이 본다.
{
  const refunds = await prisma.depositRefund.findMany({
    select: {
      id: true, leaseTermId: true, withheldAmount: true, date: true,
      leaseTerm: { select: { cleaningFee: true, room: { select: { roomNo: true } }, tenant: { select: { name: true } } } },
    },
  })
  for (const r of refunds) {
    if (r.withheldAmount <= 0) continue
    const who = `${r.leaseTerm?.room?.roomNo ?? '-'}호 ${r.leaseTerm?.tenant?.name ?? '?'}`
    const rows = await prisma.extraIncome.findMany({
      where: { leaseTermId: r.leaseTermId, payMethod: DEPOSIT_SOURCED_PAY_METHOD, deletedAt: null },
      select: { category: true, amount: true },
    })
    // 입실 때 따로 받았으면 퇴실 공제는 0 이다(계약서 §2-4 either/or) — 판정은 코드와 같은 규칙.
    const receivedAtMoveIn = await prisma.extraIncome.aggregate({
      where: { leaseTermId: r.leaseTermId, ...CLEANING_RECEIVED_WHERE }, _sum: { amount: true },
    })
    const cleaningPortion = (receivedAtMoveIn._sum.amount ?? 0) > 0 ? 0 : (r.leaseTerm?.cleaningFee ?? 0)
    const expectedCleaning = Math.min(r.withheldAmount, cleaningPortion)

    const gotCleaning = rows.filter(x => x.category === CLEANING_CATEGORY).reduce((s, x) => s + x.amount, 0)
    const gotOther    = rows.filter(x => x.category !== CLEANING_CATEGORY).reduce((s, x) => s + x.amount, 0)
    // 분류 자체(청소비 몫이 몰취로 잡혀 있는가)는 여기서 막지 않는다 — 과거분 재분류는 운영자가
    // '파손 차감이 섞이지 않았다'를 확인해 줘야 하는 판단이라, 게이트로 두면 확인될 때까지 모든
    // 배포가 막히는 영구 실패 게이트가 된다(G-4 2026-08-03 과 같은 이유).
    // 그 축은 scripts/check-withhold-classification.mjs 가 verify:data 로 매번 보여 준다.
    void expectedCleaning
    if (rows.length > 0 && gotCleaning + gotOther !== r.withheldAmount) {
      violations.push(`[데이터] ${who} ${r.date.toISOString().slice(0, 10)} — 미반환 ${r.withheldAmount.toLocaleString()}원인데 보증금 출처 부가수익 합이 ${(gotCleaning + gotOther).toLocaleString()}원이다(행 ${rows.length}개). 분리 기록이나 적용취소가 한쪽만 됐다`)
    }
  }
}
// 소스 가드 — 분류 정본과 '입실 수령분만' 조건이 사라지면 이 규칙의 전제가 무너진다.
{
  const incomeCats = readFileSync('lib/incomeCategories.ts', 'utf8')
  if (!incomeCats.includes(`'${DEPOSIT_SOURCED_PAY_METHOD}'`) || !incomeCats.includes('CLEANING_FEE_RECEIVED_WHERE')) {
    violations.push('[소스] lib/incomeCategories 에 보증금 출처 표식·입실 수령 조건 정본이 없다 — 이 스크립트의 사본과 갈린다')
  }
  if (!readFileSync('lib/depositComposition.ts', 'utf8').includes('export function splitWithheldDeposit')) {
    violations.push('[소스] 미반환분 분류 정본(splitWithheldDeposit)이 사라졌다 — 청소비 몫이 다시 몰취로 뭉친다')
  }
  if (!tenantsActions.includes('splitWithheldDeposit(withheld')) {
    violations.push('[소스] recordDepositReturn 이 미반환분을 성격대로 가르지 않는다 — 정상 청소비 수취가 몰취로 기록된다')
  }
  // 청소비 몫을 세는 자리가 퇴실 정산 파생분까지 '입실 수령' 으로 읽으면 either/or 가 뒤집힌다.
  for (const f of ['app/(app)/tenants/actions.ts', 'app/(app)/finance/actions.ts', 'app/(app)/rooms/actions.ts',
                   'app/(app)/dashboard/page.tsx', 'app/rent-receipt/[tenantId]/actions.ts']) {
    const src = readFileSync(f, 'utf8')
    // 전개 형태로 본다 — 이름만 스치는 오탐/오통과(예: 접미사 붙은 변수)를 피한다.
    if (!src.includes('...CLEANING_FEE_RECEIVED_WHERE')) {
      violations.push(`[소스] ${f} 이 입실 수령 청소비 조건 정본을 안 쓴다 — 퇴실 정산이 만든 청소비까지 입실 수령분으로 센다`)
    }
  }
}

// 6-3. 부가수익 '입주자 연결' 이 저장할 때마다 조용히 끊기지 않는가 (실기 발견 2026-08-12).
//
//   select 는 defaultValue 가 옵션 목록에 없으면 첫 항목을 고른다. 부가수익 수정 폼의 첫 항목은
//   '연결 안 함' 이라, 목록에 없는 사람(퇴실자)에게 묶인 수익은 **카테고리만 고쳐 저장해도 연결이
//   사라졌다.** 끊긴 연결은 뱃지 하나가 아니라 원장의 대조 축이다 — 보증금 출처 부가수익은
//   leaseTermId 로 미반환분(6-2)과 맞춰 보고 청소비 잔고도 계약별로 묶인다.
{
  const incomeSection = readFileSync('app/(app)/rooms/IncomeSection.tsx', 'utf8')
  if (!/const missing = cur !== '' && !leaseOptions\.some/.test(incomeSection)) {
    violations.push('[소스] 부가수익 입주자 선택이 목록에 없는 기존 연결을 항목으로 세우지 않는다 — 저장할 때마다 연결이 조용히 끊긴다')
  }
  const financeActions = readFileSync('app/(app)/finance/actions.ts', 'utf8')
  if (!/export async function getExtraIncomeLeaseOptions/.test(financeActions)
      || !/'RESERVED', 'CHECKED_OUT'/.test(financeActions)) {
    violations.push('[소스] 부가수익 연결 선택지 정본이 없거나 퇴실 계약을 뺐다 — 퇴실자에게 묶이는 수익(미반환분·퇴실 청소비)을 연결할 수 없다')
  }
  // 칸이 없는 폼과 '연결 안 함' 을 같게 읽으면, 연결 칸을 안 그리는 폼이 저장할 때마다 연결을 지운다.
  if (!/if \(leaseRaw !== null \|\| tenantRaw !== null\)/.test(financeActions)) {
    violations.push("[소스] updateExtraIncome 이 '칸 없음' 과 '연결 안 함' 을 구분하지 않는다 — 연결 칸이 없는 폼이 기존 연결을 지운다")
  }
}

// 7. 환불 재기록의 증빙 메타 승계 — 빠지면 그 결제일 달의 카드·현금영수증 합계에서 금액이
//    통째로 사라진다(519호 임형진 사례). 소스에서 승계 여부를 본다.
for (const field of ['payMethod:', 'paymentConfirmedAt:', 'paymentConfirmedBy:', 'bankTxRef:']) {
  const re = new RegExp(`${field}\\s*firstRecord\\?\\.`)
  if (!re.test(tenantsActions)) {
    violations.push(`[소스] finalizeRentRefund 재기록이 ${field.replace(':', '')} 를 승계하지 않는다 — 카드·현금영수증 합계에서 금액이 사라진다`)
  }
}
// cashReceiptIssuedAt 은 반대로 **승계하면 안 된다** — 앱 숫자가 홈택스보다 앞서 나간다.
if (/cashReceiptIssuedAt:\s*firstRecord\?\./.test(tenantsActions)) {
  violations.push('[소스] finalizeRentRefund 가 cashReceiptIssuedAt 을 승계한다 — 홈택스에는 원 금액이 살아 있는데 앱만 줄어 조용히 어긋난다')
}
// 홈택스 안내 경로가 살아 있는지 — 타입 이름만 보면 다른 줄에 남은 참조로 통과한다(이번 세션 3번째
// 반쪽 감지망). 서버가 '내려보내는지'와 화면이 '띄우는지'를 각각 본다.
if (!/return \{ ok: true[^}]*taxNotice/.test(tenantsActions)) {
  violations.push('[소스] finalizeRentRefund 가 taxNotice 를 반환하지 않는다 — 홈택스 조치 안내가 화면까지 못 간다')
}
// 8. 과거 회계월 보호 — 정산액이 락인보다 우선하고 이 앱엔 월 마감이 없어 여기가 유일한 방어선이다.
if (!/checkSettlementMonth\(/.test(tenantsActions)) {
  violations.push('[소스] finalizeRentRefund 에 과거 회계월 가드(checkSettlementMonth)가 없다 — 신고 끝난 달을 조용히 뒤집을 수 있다')
}
if (!/if \(!monthVerdict\.ok\) return/.test(tenantsActions)) {
  violations.push('[소스] 과거 회계월 가드가 호출만 되고 차단하지 않는다 — 판정 결과를 버리면 없는 것과 같다')
}
// 일할 저장(setCheckoutProration)에도 같은 가드 — 없으면 환불 쪽 가드가 이 문으로 우회된다.
// checkoutProratedAmount 는 락인보다 우선하므로 여기가 곧 과거 달을 덮어쓰는 두 번째 통로다.
if (!/if \(!settleVerdict\.ok\) return/.test(tenantsActions)) {
  violations.push('[소스] setCheckoutProration 에 과거 회계월 가드가 없다 — 환불 쪽 가드가 우회된다')
}

const tenantClient = readFileSync('app/(app)/tenants/TenantClient.tsx', 'utf8')
if (!tenantClient.includes('홈택스')) {
  violations.push('[소스] 환불 후 홈택스 안내 문구가 사라짐 — 앱과 국세청은 연동되지 않아 알려주는 것이 유일한 방어다')
}

// 9. 청소비가 보증금 record 로 들어가면 매출에서 빠지고 동시에 없는 보유 보증금으로 잡힌다.
//    입실 청소비는 ExtraIncome('청소비')이 정본이다(회계 패널 2026-08-02).
const cleaningAsDeposit = await prisma.paymentRecord.findMany({
  where: { isDeposit: true, deletedAt: null },
  select: {
    actualAmount: true, targetMonth: true,
    leaseTerm: { select: { depositAmount: true, cleaningFee: true, tenant: { select: { name: true } } } },
  },
})
for (const r of cleaningAsDeposit) {
  const l = r.leaseTerm
  if (l.depositAmount === 0 && l.cleaningFee > 0 && r.actualAmount === l.cleaningFee) {
    violations.push(`[데이터] ${l.tenant.name} ${r.targetMonth} ${r.actualAmount.toLocaleString()}원 — 청소비가 보증금 record 로 들어가 매출에서 빠졌다(정본: ExtraIncome '청소비')`)
  }
}
// 화면 경로도 본다 — saveDepositPayment 로 되돌아가면 같은 사고가 재발한다
const payForm = readFileSync('components/entity-modal/widgets/PaymentEntryForm.tsx', 'utf8')
if (!/isCleaningFeeMode\)\s*\{[\s\S]{0,400}?saveCleaningFeePayment\(/.test(payForm)) {
  violations.push("[소스] 청소비 수납이 saveCleaningFeePayment 정본을 안 탄다 — 보증금으로 저장되면 매출 누락 + 유령 보증금")
}

// 10. 계약 미납액은 그 달 record 의 **최댓값**으로 잡아야 한다. 합으로 잡으면 한 달에 나눠 낸
//     사람이 전원 미납으로 뜬다(신고 2026-08-02, 실측 11건 5,987,000원 부풀림).
//     데이터 대조는 그물이 못 된다 — 한 달에 여러 번 낸 계약이 있는 것 자체는 정상이라 늘 걸린다.
//     감시해야 할 것은 **코드가 다시 자기 식을 쓰는 것**이다.
const sumGuards = [
  ['components/entity-modal/bodies/TenantBody.tsx', 'unpaidForLease'],
  ['app/(app)/tenants/actions.ts', 'unpaidForLease'],
  ['app/(app)/report/actions.ts', 'unpaidForLease'],
]
for (const [file, canon] of sumGuards) {
  const src = readFileSync(file, 'utf8')
  if (/reduce\(\([^)]*\)\s*=>\s*\w+\s*\+\s*\w+\.expectedAmount/.test(src)) {
    violations.push(`[소스] ${file} 이 expectedAmount 를 합산한다 — 청구액은 그 달 최댓값이다(lib/billing ${canon})`)
  }
  if (!src.includes(canon)) {
    violations.push(`[소스] ${file} 이 미납액 정본(${canon})을 안 쓴다`)
  }
}
// 정본 함수 자체가 살아 있는지
const billingSrc = readFileSync('lib/billing.ts', 'utf8')
if (!/export function unpaidForLease/.test(billingSrc) || !/if \(r\.expectedAmount > cur\.billed\)/.test(billingSrc)) {
  violations.push('[소스] lib/billing 의 unpaidForLease 최댓값 규칙이 사라졌다')
}

// 10b. **정본을 부르는 것만으로는 부족하다. 정본이 요구하는 것을 주는지도 봐야 한다.**
//   세 플래그가 옵셔널이면 select 에서 빠뜨려도 컴파일이 통과하고, 그러면 보증금이 월세 record 로
//   취급돼 미납액이 정확히 보증금만큼 어긋난다. 실제로 두 번 났다 — 2026-08-02 커밋이 형제 화면만
//   고치고 getTenantDetail 을 빠뜨려 완납 8명이 -5만원으로, 진짜 미납 91,000 이 41,000 으로 떴다.
//   1) 타입이 필수인가. 이게 주력 그물이다 — 필수면 안 실어 보내는 호출부가 전부 tsc 에서 죽는다.
const unpaidType = billingSrc.match(/export type UnpaidRecord = \{[\s\S]*?\n\}/)
if (!unpaidType) {
  violations.push('[소스] lib/billing 의 UnpaidRecord 타입을 찾지 못했다. 대조가 건너뛰어졌다. 감지망을 고쳐야 한다')
} else {
  for (const f of ['isDeposit', 'isPrevOwner', 'isBillingAdjust']) {
    if (new RegExp(f + '\\s*\\?').test(unpaidType[0])) {
      violations.push(`[소스] UnpaidRecord 의 ${f} 가 옵셔널로 돌아갔다 — select 에서 빠뜨려도 컴파일이 통과해 미납액이 보증금만큼 어긋난다`)
    }
  }
}
//   2) 입주자 상세를 대는 쿼리가 세 플래그를 실어 보내는가. 파일 전체 검색은 안 된다 —
//      주석에도 같은 낱말이 있다. paymentRecords select 블록만 잘라서 본다.
{
  const src = readFileSync('app/(app)/rooms/actions.ts', 'utf8')
  const block = src.match(/paymentRecords:\s*\{[\s\S]*?select:\s*\{[\s\S]*?\}/)
  if (!block) {
    violations.push('[소스] rooms/actions.ts 의 paymentRecords select 블록을 찾지 못했다. 대조가 건너뛰어졌다')
  } else {
    for (const f of ['isDeposit', 'isPrevOwner', 'isBillingAdjust']) {
      if (!new RegExp(f + '\\s*:\\s*true').test(block[0])) {
        violations.push(`[소스] getTenantDetail 의 paymentRecords select 에 ${f} 가 없다 — 입주자 상세 미납액이 보증금만큼 어긋난다`)
      }
    }
  }
}

// 11. 현금영수증 스탬프는 **결제 단위**다. 한 결제가 여러 달로 쪼개졌는데 일부에만 찍히면
//     합계(payDate 기준 record 합)가 실제 발행액과 어긋난다(2026-08-03 봉합).
//     쪼개진 결제가 있는 것 자체는 정상이라 위반 조건은 '한 결제 안에서 갈림' 하나다.
const crRecords = await prisma.paymentRecord.findMany({
  where: { isBillingAdjust: false },
  select: { id: true, leaseTermId: true, payDate: true, payMethod: true, createdAt: true,
    actualAmount: true, cashReceiptIssuedAt: true, isDeposit: true,
    leaseTerm: { select: { tenant: { select: { name: true } } } } },
})
const crGroups = new Map()
for (const r of crRecords) {
  // 생성시각 2초 버킷 — payDate 만으로 묶으면 같은 날 따로 입력한 별개 결제가 섞인다
  const bucket = Math.floor(r.createdAt.getTime() / 2000)
  const key = `${r.leaseTermId}|${r.payDate.toISOString().slice(0, 10)}|${r.payMethod ?? ''}|${bucket}`
  if (!crGroups.has(key)) crGroups.set(key, [])
  crGroups.get(key).push(r)
}
for (const [, g] of crGroups) {
  if (g.length < 2) continue
  const on = g.filter(r => r.cashReceiptIssuedAt).length
  if (on > 0 && on < g.length) {
    const missing = g.filter(r => !r.cashReceiptIssuedAt).reduce((s, r) => s + r.actualAmount, 0)
    violations.push(`[데이터] ${g[0].leaseTerm.tenant.name} ${g[0].payDate.toISOString().slice(0, 10)} — 한 결제가 ${g.length}건으로 쪼개졌는데 ${on}건만 현금영수증 표시. 합계에서 ${missing.toLocaleString()}원 누락`)
  }
}
// 카드 계열에 현금영수증 스탬프 — 매출전표가 증빙이라 대상이 아니다
for (const r of crRecords) {
  if (r.cashReceiptIssuedAt && r.payMethod && ['신용카드', '결제선생'].includes(r.payMethod)) {
    violations.push(`[데이터] ${r.leaseTerm.tenant.name} ${r.payDate.toISOString().slice(0, 10)} ${r.payMethod} ${r.actualAmount.toLocaleString()}원 — 카드 결제에 현금영수증 표시가 켜져 있다(매출전표가 증빙)`)
  }
}
// 소스 가드 — isOriginalMonth 로 되돌아가면 같은 사고가 재발한다
const roomsSrcCr = readFileSync('app/(app)/rooms/actions.ts', 'utf8')
if (/cashReceiptIssuedAt:\s*\(data\.cashReceiptIssued && isOriginalMonth/.test(roomsSrcCr)) {
  violations.push('[소스] 현금영수증 스탬프가 첫 달 record 에만 찍힌다 — 쪼개진 결제는 합계에서 일부만 잡힌다')
}

// 12. 청소비 이중 징수 — 계약서 §2-4 가 either/or 로 약정한다(입실 수납 또는 퇴실 공제).
//     입실 때 받았는데 퇴실 정산에서 또 뗐으면 위반. 실측 김민정 건이 그 직전 상태였다(2026-08-03).
const cfLeases = await prisma.leaseTerm.findMany({
  select: { id: true, cleaningFee: true, tenant: { select: { name: true } }, room: { select: { roomNo: true } } },
})
for (const l of cfLeases) {
  const paid = await prisma.extraIncome.aggregate({
    // 퇴실 정산이 보증금 청소비 몫으로 만든 '청소비'(payMethod '보유 보증금')는 입실 수령분이 아니다.
    // 안 빼면 2026-08-11 분류 규칙 이후 정상 퇴실이 전부 '이중 징수' 로 찍힌다.
    where: { leaseTermId: l.id, ...CLEANING_RECEIVED_WHERE }, _sum: { amount: true },
  })
  const received = paid._sum.amount ?? 0
  if (received <= 0) continue
  const rf = await prisma.depositRefund.findFirst({
    where: { leaseTermId: l.id }, select: { withheldAmount: true, reason: true },
  })
  if (rf && rf.reason === '청소비' && rf.withheldAmount > 0) {
    violations.push(`[데이터] ${l.room?.roomNo ?? '-'}호 ${l.tenant.name} — 청소비를 입실 때 ${received.toLocaleString()}원 받고 퇴실에서 ${rf.withheldAmount.toLocaleString()}원 또 뗐다(계약서는 둘 중 하나만 약정)`)
  }
}
// 소스 가드 — 퇴실 폼이 입실 수납 이력을 안 보면 같은 사고가 재발한다.
// 조회 정본이 getDepositCompositionForLease 로 합쳐졌다(2026-08-10) — 둘 중 하나면 통과.
for (const f of ['app/(app)/tenants/TenantClient.tsx', 'components/entity-modal/widgets/TenantStatusTransitions.tsx']) {
  const src = readFileSync(f, 'utf8')
  if (!src.includes('getCleaningFeeReceivedForLease') && !src.includes('getDepositCompositionForLease')) {
    violations.push(`[소스] ${f} 이 입실 청소비 수납 이력을 안 본다 — 퇴실에서 이중 공제된다`)
  }
}

// 13. 서류 발행번호 원장 — 번호가 저장되지 않으면 대조할 근거가 없다(E페이즈 2026-08-03).
//     같은 영업장에서 번호가 겹치거나, 예약만 하고 업로드가 안 끝난 자리가 남으면 위반.
const dupReceipt = await prisma.$queryRawUnsafe(
  `SELECT "propertyId", "receiptNo", count(*)::int AS n FROM "rent_receipt_files"
   WHERE "receiptNo" IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1`)
for (const r of dupReceipt) violations.push(`[데이터] 영수증 발행번호 중복 ${r.receiptNo} (${r.n}건)`)
const dupContract = await prisma.$queryRawUnsafe(
  `SELECT "propertyId", "contractNo", count(*)::int AS n FROM "contract_files"
   WHERE "contractNo" IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1`)
for (const r of dupContract) violations.push(`[데이터] 계약번호 중복 ${r.contractNo} (${r.n}건)`)
const stranded = await prisma.contractFile.count({ where: { driveFileId: '' } })
if (stranded > 0) violations.push(`[데이터] 번호만 예약되고 파일이 안 붙은 계약서 ${stranded}건 — 발급 도중 실패한 흔적`)
// 소스 가드 — count+1 로 그 자리에서 번호를 만들면 저장이 안 되고 미리보기에도 같은 번호가 나간다
for (const f of ['app/api/rent-receipt/generate/route.ts', 'app/api/contract/generate/route.ts']) {
  const src = readFileSync(f, 'utf8')
  if (!/receiptNo|contractNo/.test(src)) violations.push(`[소스] ${f} 이 발행번호를 저장하지 않는다`)
}

// 14. 서류 파일이 무인증 공개로 올라가면 안 된다(E페이즈 2026-08-03).
//     uploadToDrive 가 기본으로 공개 권한을 붙여 계약서·영수증·거주확인서 56건이
//     링크만 알면 로그인 없이 열렸다. 기본을 비공개로 바꿨고, 되돌아가면 여기서 잡는다.
const driveSrc = readFileSync('lib/google-drive.ts', 'utf8')
if (/const fileId = res\.data\.id!\s*\n\s*await setDrivePublicReadable\(fileId\)/.test(driveSrc)) {
  violations.push('[소스] uploadToDrive 가 모든 업로드를 공개로 만든다 — 서류 PDF 가 무인증 링크로 열린다')
}
for (const f of ['app/api/contract/generate/route.ts', 'app/api/rent-receipt/generate/route.ts', 'app/api/residence-cert/generate/route.ts']) {
  if (/uploadToDrive\([^)]*publicRead:\s*true/.test(readFileSync(f, 'utf8'))) {
    violations.push(`[소스] ${f} 이 서류를 공개로 올린다 — 앱은 /api/doc-file 로만 연다`)
  }
}

// 15. Drive 공개 읽기 권한 — 공개해도 되는 것만 공개한다(D페이즈 2026-08-03).
//     서류 PDF 56건과 오류신고 첨부 16장이 같은 이유로 무만료 공개였다. 둘 다 앱이 안 쓰는데
//     권한만 붙어 있었다. 새 업로드 경로가 습관적으로 공개를 붙이는 것이 이 클래스의 재발 경로라
//     **공개를 붙여도 되는 자리를 명단으로 못 박고, 명단 밖에서 쓰이면 위반으로 잡는다.**
//     명단에 넣으려면 "공개 URL 을 화면이 실제로 쓰는가"에 답할 수 있어야 한다.
// D6 이후 남은 것은 **진짜 공개 자산 둘뿐**이다. 영수증은 인증 프록시로, 도장은 data URI 로 옮겼다.
const PUBLIC_OK = new Map([
  ['app/(app)/settings/actions.ts',     2],  // 영업장 로고 · 앱 로고 (공개 갤러리·랜딩에서 쓴다)
  ['app/(app)/room-manage/actions.ts',  2],  // 호실 사진 (공개 갤러리에서 쓴다)
])
const grantRe = /setDrivePublicReadable\s*\(|publicRead:\s*true/g
const scanDirs = ['app', 'lib', 'components']
const GRANT_IMPL = 'lib/google-drive.ts'  // 정의부. 호출부가 아니라 세지 않는다
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap(e => {
  const full = `${d}/${e.name}`
  return e.isDirectory() ? walk(full) : (/\.(ts|tsx)$/.test(e.name) ? [full] : [])
})
for (const file of scanDirs.flatMap(walk)) {
  if (file === GRANT_IMPL) continue
  const n = (readFileSync(file, 'utf8').match(grantRe) ?? []).length
  if (n === 0) continue
  const allowed = PUBLIC_OK.get(file) ?? 0
  if (n > allowed) {
    violations.push(allowed === 0
      ? `[소스] ${file} 가 Drive 공개 읽기 권한을 붙인다 — 명단에 없는 자리다. 링크만 알면 로그인 없이 열린다`
      : `[소스] ${file} 의 공개 권한 부여가 ${allowed}곳에서 ${n}곳으로 늘었다 — 새로 늘어난 자리가 공개여도 되는지 확인하라`)
  }
}
// 신고 첨부는 절대 공개가 아니다 — 소비처가 스크립트뿐이라 예외가 성립하지 않는다
if (grantRe.test(readFileSync('app/(app)/errorReports.ts', 'utf8'))) {
  violations.push('[소스] errorReports 가 첨부에 공개 권한을 붙인다 — 첨부는 남의 입주자 정보가 찍힌 화면 사진이다')
}
if (/drive\.google\.com\/file\//.test(readFileSync('scripts/check-error-reports.mjs', 'utf8'))) {
  violations.push('[소스] check-error-reports 가 첨부 공개 URL 을 출력한다 — 첨부는 비공개다')
}

// 15-2. 영수증·도장은 저장된 주소 자체가 공개 Drive URL 이면 안 된다 (D페이즈 2026-08-03).
//       화면이 그 URL 을 직접 물고 있어서 권한만 걷으면 화면이 깨진다. 주소와 권한이 한 세트다.
const financeSrc = readFileSync('app/(app)/finance/actions.ts', 'utf8')
const pendingSrc = readFileSync('app/(app)/dashboard/pendingReceipt.ts', 'utf8')
for (const [name, src] of [['finance/actions', financeSrc], ['dashboard/pendingReceipt', pendingSrc]]) {
  if (!/buildReceiptImageUrl\(/.test(src)) {
    violations.push(`[소스] ${name} 이 영수증 주소를 buildReceiptImageUrl 로 만들지 않는다 — 공개 URL 이 다시 DB 에 쌓인다`)
  }
}
const badExpense = await prisma.expense.count({
  where: { OR: [{ receiptUrl: { contains: 'drive.google.com' } }, { receiptUrls: { contains: 'drive.google.com' } }] },
})
const badPending = await prisma.pendingReceipt.count({ where: { imageUrl: { contains: 'drive.google.com' } } })
if (badExpense > 0) violations.push(`[데이터] 지출 ${badExpense}건의 영수증 주소가 공개 Drive URL 이다 — scripts/migrate-receipt-image-urls 로 이관하라`)
if (badPending > 0) violations.push(`[데이터] 대기 영수증 ${badPending}건의 주소가 공개 Drive URL 이다 — 같은 스크립트로 이관하라`)

// 도장은 URL 이 아니라 바이트를 심는다 — 비로그인 서명 페이지와 헤드리스 PDF 렌더까지 덮으려면 이 방식뿐이다
for (const f of ['lib/contractData.ts', 'app/residence-cert/[tenantId]/actions.ts', 'app/api/contract/generate/route.ts', 'app/(app)/settings/actions.ts']) {
  const src = readFileSync(f, 'utf8')
  if (/stampDriveFileId, \d+\)/.test(src)) {
    violations.push(`[소스] ${f} 가 도장을 공개 Drive 썸네일 URL 로 내보낸다 — 받아다 위조 서류에 얹을 수 있다`)
  }
}

// 16. 무인증 라우트를 여는 비밀값은 CSPRNG 여야 한다 (D페이즈 2026-08-03).
//     calendarToken 이 Math.random 이었다. 이 토큰 하나가 전 입주자 명부를 무인증 ICS 로 연다.
//     서명 토큰은 처음부터 randomBytes 였다 — 같은 성격의 값인데 규칙이 갈렸다.
const settingsActions = readFileSync('app/(app)/settings/actions.ts', 'utf8')
if (/genCalToken\s*=\s*\(\)\s*=>[^\n]*Math\.random/.test(settingsActions)) {
  violations.push('[소스] genCalToken 이 Math.random 을 쓴다 — 이 토큰은 무인증으로 전 입주자 명부를 여는 값이다')
}
const weakTokens = await prisma.property.findMany({
  where: { calendarToken: { not: null } }, select: { name: true, calendarToken: true },
})
for (const p of weakTokens) {
  if (p.calendarToken.length < 43) violations.push(`[데이터] ${p.name} 의 캘린더 토큰이 약한 난수다(길이 ${p.calendarToken.length}) — scripts/rotate-calendar-tokens 로 재발급하라`)
}

// 15-3. 크론의 상태 전이는 알림 설정에 종속되면 안 되고, 이력을 남겨야 한다 (2026-08-03).
//   종전에는 단기 자동 퇴실 전환이 VAPID 검사 **아래**에 있어서 푸시 설정이 빠지면
//   500 으로 빠져나가며 상태 전이까지 조용히 안 돌았다. 계약 상태가 알림 설정에 매달릴 이유가 없다.
//   게다가 updateMany 로 한 번에 밀어서 이 전이만 TenantStatusLog 를 안 남겼다.
{
  const cron = readFileSync('app/api/cron/push-alerts/route.ts', 'utf8')
  const vapidAt = cron.indexOf('ensureWebPushConfigured()')
  const flipAt = cron.indexOf('autoCheckoutAt: new Date()')
  if (vapidAt >= 0 && flipAt >= 0 && vapidAt < flipAt) {
    violations.push('[소스] 크론의 단기 자동 전환이 VAPID 검사 아래에 있다 — 푸시 설정이 빠지면 상태 전이도 조용히 안 돈다')
  }
  if (!/tenantStatusLog\.create/.test(cron)) {
    violations.push('[소스] 크론의 단기 자동 전환이 상태 이력을 안 남긴다 — 이 전이만 이력에서 사라진다')
  }
  if (!/canTransition\(/.test(cron)) {
    violations.push('[소스] 크론의 단기 자동 전환이 전이표를 안 본다 — 사람이 하는 전환과 규칙이 갈린다')
  }
}

// 15-4. 공실로 되돌릴 때 그 방의 다른 계약을 봐야 한다 (B페이즈).
//   안 보면 한 방에 비거주자와 거주자가 공존할 때 한쪽 퇴실로 **거주자 있는 방이 공실**이 된다.
if (!/roomStillOccupied\(/.test(tenantsActions)) {
  violations.push('[소스] applyStatusTransition 이 다른 계약의 점유를 안 본다 — 거주자가 있는 방이 공실로 표시될 수 있다')
}

// 15-4b. 청구액을 내는 곳은 전부 billForLeaseMonth 정본을 쓴다 (A페이즈 P2, 2026-08-03).
//   캘린더가 자기 규칙(일할 > 할인가)을 만들어 **예약 인상·락인·단기 이중청구 차단이 전부 빠져** 있었다.
//   캘린더는 외부로 나가는 문서라 금액이 틀리면 그대로 상대방에게 간다.
{
  const cal = readFileSync('app/api/calendar/[token]/route.ts', 'utf8')
  if (!/billForLeaseMonth\(/.test(cal)) {
    violations.push('[소스] 캘린더가 billForLeaseMonth 정본을 안 쓴다 — 예약 인상·락인이 빠진 금액이 외부로 나간다')
  }
  if (!/lockedMap/.test(cal)) {
    violations.push('[소스] 캘린더가 청구 락을 안 본다 — 확정된 과거 청구가 캘린더에서만 다른 금액으로 나간다')
  }
}

// 15-5. 서류 문구 — 이 축만 상시 감지가 없었다(G-2 잔여, 2026-08-03).
//
//   계약서는 저장된 템플릿의 {{키}} 를 코드가 치환해 인쇄한다. 매칭이 없으면 renderContractText 가
//   **원문을 그대로 남긴다** — 즉 `{{청소비}}` 같은 자리표시자가 실제 계약서에 찍혀 나간다.
//   실제로 청소비 자리표시자 때문에 29건이 비문이 됐다(E페이즈).
//   그리고 변수 표를 화면(ContractView)과 인쇄(contractPrintHtml)가 각자 만든다 — 갈리면
//   같은 계약서가 화면과 종이에서 다르게 읽힌다. 그것이 그 비문의 원인이었다.
{
  const printSrc = readFileSync('lib/contractPrintHtml.ts', 'utf8')
  const viewSrc = readFileSync('app/contract/[tenantId]/ContractView.tsx', 'utf8')
  // 'const vars' 부터 객체 리터럴이 닫힐 때까지를 중괄호 깊이로 떠낸다.
  // 처음엔 정규식으로 잡으려다 ContractView 의 useMemo<Record<string,string>> 제네릭에서 빗나가
  // **null 을 돌려주고 대조 자체가 조용히 건너뛰어졌다**(역주입에서 발견). 깊이 추적이 안전하다.
  const keysOf = (src) => {
    const at = src.indexOf('const vars')
    if (at < 0) return null
    const open = src.indexOf('{', src.indexOf('=', at))
    if (open < 0) return null
    let lvl = 0, end = -1
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') lvl++
      else if (src[i] === '}') { lvl--; if (lvl === 0) { end = i; break } }
    }
    if (end < 0) return null
    const body = src.slice(open + 1, end)
    const set = new Set()
    for (const k of body.matchAll(/^\s*([\wㄱ-ㅎ가-힣]+)\s*:/gm)) set.add(k[1])
    if (/cleaningFeeVars\(/.test(body)) for (const k of ['청소비', '청소비조항', '청소비공제']) set.add(k)
    return set
  }
  const pk = keysOf(printSrc), vk = keysOf(viewSrc)
  // 못 읽었으면 통과가 아니라 위반이다 — 조용히 건너뛰는 그물은 없는 것과 같다
  if (!pk || !vk) violations.push('[소스] 계약서 변수 표를 읽지 못했다 — 대조가 건너뛰어졌다. 감지망을 고쳐야 한다')
  if (pk && vk) {
    for (const k of pk) if (!vk.has(k)) violations.push(`[소스] 계약서 변수 '${k}' 가 인쇄에만 있다 — 화면과 종이가 다르게 읽힌다`)
    for (const k of vk) if (!pk.has(k)) violations.push(`[소스] 계약서 변수 '${k}' 가 화면에만 있다 — 화면과 종이가 다르게 읽힌다`)
  }
  // 저장된 템플릿에 코드가 못 채우는 자리표시자가 있으면 그대로 인쇄된다
  if (pk) {
    const props = await prisma.property.findMany({ select: { name: true, contractTemplate: true } })
    for (const prop of props) {
      if (!prop.contractTemplate) continue
      const used = new Set([...JSON.stringify(prop.contractTemplate).matchAll(/\{\{([^}\\"]+)\}\}/g)].map(m => m[1].trim()))
      for (const k of used) {
        if (!pk.has(k)) violations.push(`[데이터] ${prop.name} 계약서 템플릿의 '{{${k}}}' 를 코드가 못 채운다 — 자리표시자가 그대로 인쇄된다`)
      }
    }
  }
}

// 16-1. 초과 납부 처리는 반드시 묻고 간다 (운영자 오더 2026-08-03).
//   종전에는 폼 안 체크박스가 결정 지점이었다. 금액만 치고 저장을 누르면 초과 블록을 못 보고 지나가고,
//   기타수익으로 잡혔어야 할 돈이 조용히 다음 달로 넘어간다. 결정을 확인창 한 자리로 올렸다.
//   체크박스가 다시 생기면 결정 지점이 둘이 되고 두 곳의 기본값이 갈린다.
// 파일 어디에 choiceDialog 가 있으면 통과하는 느슨한 검사였다 — 예약금 폼에 다른 용도로 하나 생기면
// 초과분 처리가 사라져도 못 잡는다. excess 조건과 짝지어 본다.
if (!/excess > 0\)[\s\S]{0,400}?choiceDialog\(/.test(payForm)) {
  violations.push('[소스] PaymentEntryForm 이 초과분(excess) 처리를 확인창으로 묻지 않는다 — 기타수익이 조용히 이월로 처리된다')
}
// 자릿수 확인창을 다시 분리하면 확인창 두 개가 전환 표시 없이 연속으로 뜬다(연타가 돈 처리를 결정한다)
if (/confirmDialog\(\{[\s\S]{0,200}?SUSPICIOUS|SUSPICIOUS_MULTIPLIER[\s\S]{0,300}?confirmDialog\(/.test(payForm)) {
  violations.push('[소스] 자릿수 확인창이 초과분 확인창과 분리돼 있다 — 확인창 두 개가 연속으로 떠 오클릭이 돈 처리를 정한다')
}
if (/setExcessAsIncome|checked=\{excessAsIncome\}/.test(payForm)) {
  violations.push('[소스] PaymentEntryForm 에 초과분 체크박스가 되살아났다 — 확인창과 결정 지점이 둘로 갈린다')
}

// 16-1b. 기타수익으로 돌린 초과분은 되돌릴 수 있어야 한다 (2026-08-03).
//   16-1 이 만든 확인창은 한 번 누르면 서로 다른 두 테이블에 record 를 만든다. 손으로 되돌리려면
//   수납 내역과 부가수익 탭을 각각 찾아가야 해서, 토스트 적용취소가 사실상 유일한 되돌리기다.
//   반쪽만 되돌아가면 안 되돌린 것보다 나쁘다 — 그 달이 미수로 뜨면서 초과분은 수익에 남아,
//   운영자가 미수를 보고 다시 수납을 넣는 순간 이중계상이 된다.
{
  // 'createdIds' 는 batchRecordRentPayment 에도 있어 파일 전체 검색은 변경 전에도 통과한다.
  // savePayment 본문만 떠서 본다. 못 읽으면 통과가 아니라 위반이다.
  const at  = roomsActions.indexOf('export async function savePayment')
  const end = roomsActions.indexOf('\nexport ', at + 10)
  if (at < 0 || end < 0) {
    violations.push('[소스] savePayment 본문을 읽지 못했다 — 적용취소 대조가 건너뛰어졌다. 감지망을 고쳐야 한다')
  } else {
    const body = roomsActions.slice(at, end)
    if (!/=\s*await prisma\.paymentRecord\.create\(/.test(body) || !/createdIds\.push\(/.test(body)) {
      violations.push('[소스] savePayment 이 만든 record id 를 모으지 않는다 — 적용취소가 지울 대상을 잃는다')
    }
    if (!/return \{[^}]*createdIds/.test(body)) {
      violations.push('[소스] savePayment 반환에 createdIds 가 없다 — 화면이 되돌릴 id 를 못 받아 적용취소 버튼이 조용히 사라진다')
    }
    // 바로 아래 allocations.push 는 portion > 0 로 막혀 있다. 그 줄을 흉내 내 가드 안으로 들어가면
    // 0원 흔적 record 가 적용취소 후에도 남는다.
    //
    // 거리로 근사하면 안 된다 — 가드를 씌워도 앞 줄과 몇 글자 떨어져 있지 않아 그대로 통과한다(실측).
    // record 생성 블록을 열고 중괄호 깊이를 직접 세서, 수집이 그 블록 바로 아래(깊이 1)에 있고
    // 한 줄 if 로도 감싸이지 않았는지 본다.
    const blockOpen = body.indexOf('if (portion > 0 || (isOriginalMonth && remaining === 0)) {')
    if (blockOpen < 0) {
      violations.push('[소스] savePayment 의 record 생성 블록을 찾지 못했다 — 적용취소 대조가 건너뛰어졌다. 감지망을 고쳐야 한다')
    } else {
      let depth = 0, at = -1
      for (let i = body.indexOf('{', blockOpen); i < body.length; i++) {
        if (body[i] === '{') depth++
        else if (body[i] === '}') { depth--; if (depth === 0) break }
        else if (depth === 1 && body.startsWith('createdIds.push(', i)) { at = i; break }
      }
      const line = at < 0 ? '' : body.slice(body.lastIndexOf('\n', at) + 1, at)
      if (at < 0 || /\bif\s*\(/.test(line)) {
        violations.push('[소스] savePayment 의 id 수집이 portion > 0 가드 안으로 들어갔다 — 0원 흔적 record 가 적용취소 후에 남는다')
      }
    }
  }
}
if (!/export type SavePaymentResult = \{[\s\S]{0,600}?createdIds/.test(roomsActions)) {
  violations.push('[소스] SavePaymentResult 에 createdIds 가 없다 — 되돌릴 id 를 담을 자리가 사라졌다')
}
{
  const at  = financeSrc.indexOf('export async function addExtraIncome')
  const end = financeSrc.indexOf('\nexport ', at + 10)
  if (at < 0 || end < 0) {
    violations.push('[소스] addExtraIncome 본문을 읽지 못했다 — 적용취소 대조가 건너뛰어졌다. 감지망을 고쳐야 한다')
  } else {
    const body = financeSrc.slice(at, end)
    if (!/=\s*await prisma\.extraIncome\.create\(/.test(body) || !/return \{ ok: true[^}]*id/.test(body)) {
      violations.push('[소스] addExtraIncome 이 만든 id 를 돌려주지 않는다 — 적용취소가 이용료만 지우고 기타수익은 남긴다')
    }
  }
}
// 서버가 '내려보내는지'와 화면이 '띄우는지'를 각각 본다(반쪽 감지망 전례).
// 낱말 '적용취소'는 이 파일 주석에도 나올 수 있으므로 호출 형태를 본다.
if (!/action:\s*\{\s*label:\s*'적용취소'/.test(payForm)) {
  violations.push('[소스] 과납 기타수익 성공 토스트에 적용취소가 없다 — 확인창 한 번으로 정해진 돈 처리를 되돌릴 길이 사라진다')
}
if (!/undoOverpayExtraIncome\(/.test(payForm)) {
  violations.push('[소스] 과납 적용취소가 수납과 기타수익을 함께 되돌리지 않는다 — 반쪽만 지워지면 이중계상으로 이어진다')
}
// 기타수익 기록이 실패했는데 성공 토스트로 흘러가면, 없는 기타수익을 되돌리겠다고 약속하는 버튼이 뜬다
if (!/if \(!incRes\.ok\)[\s\S]{0,300}?return/.test(payForm)) {
  violations.push('[소스] 기타수익 기록이 실패해도 성공 토스트로 넘어간다 — 없는 기타수익을 되돌리겠다는 적용취소가 뜬다')
}
// 액션 토스트를 합치면 버튼이 먼저 뜬 토스트의 대상을 계속 가리킨다(연속 수납 시 앞엣것이 취소된다)
{
  const feedback = readFileSync('components/feedback/SaveFeedback.tsx', 'utf8')
  if (!/const dup = t\.action \? undefined/.test(feedback)) {
    violations.push('[소스] 액션 달린 토스트가 dedup 대상에 다시 포함됐다 — 적용취소가 방금 것이 아니라 앞 건을 되돌린다')
  }
}

// 16-2. 상태 이력은 쌓기만 하고 볼 수 없으면 안 된다 (신고 ad517231, 2026-08-03).
//
//   TenantStatusLog 에 167건이 쌓여 있는데 읽는 화면이 하나도 없었다(설정의 데이터 내보내기가 유일).
//   더 나쁜 것은 목록에 표시 코드가 있긴 했는데 **죽어 있었다** — statusException('CANCELLED') 이 null 이라
//   게이트가 항상 false 였고 그 안의 quietSub 삼항식은 한 번도 실행된 적이 없다.
//   "코드가 있으니 된다"가 아니라 "그 코드에 도달하는가"를 봐야 한다.
const roomsActionsSrc = readFileSync('app/(app)/rooms/actions.ts', 'utf8')
const tenantBody = readFileSync('components/entity-modal/bodies/TenantBody.tsx', 'utf8')

// 상세 모달이 취소 계약을 못 열면 그 사람의 이력·계약 정보가 통째로 안 그려진다
const detailWhere = roomsActionsSrc.match(/leaseTerms:\s*\{[\s\S]{0,400}?status:\s*\{\s*in:\s*\[([^\]]*)\]/)
if (detailWhere && !detailWhere[1].includes('CANCELLED')) {
  violations.push("[소스] getTenantDetail 이 CANCELLED 계약을 제외한다 — 취소된 고객 상세가 통째로 빈다")
}
if (!/<TenantStatusHistory/.test(tenantBody)) {
  violations.push('[소스] 고객 카드에 상태 이력 위젯이 없다 — 입실 취소·퇴실 사유를 볼 곳이 사라진다')
}
// 모바일 카드 게이트 — 여기가 죽으면 취소 단계가 화면에 영원히 안 뜬다.
// 정규식으로 조건절을 잡으려다 statusException( 의 괄호에서 끊겨 못 잡았다(역주입에서 발견).
// 게이트 시작점부터 <StatusChip 까지의 구간을 통째로 떠서 본다.
{
  const gateStart = tenantClient.indexOf("{(status === 'RESERVED'")
  const chipAt = gateStart >= 0 ? tenantClient.indexOf('<StatusChip', gateStart) : -1
  if (gateStart >= 0 && chipAt > gateStart) {
    const gate = tenantClient.slice(gateStart, chipAt)
    if (!gate.includes("status === 'CANCELLED'")) {
      violations.push("[소스] 카드 StatusChip 게이트가 CANCELLED 를 막는다 — 그 안의 quietSub 는 실행되지 않는 죽은 코드가 된다")
    }
  }
}
// 사유를 받는 곳과 고칠 수 있는 곳이 한 정본을 봐야 한다
for (const [file, src] of [['TenantStatusTransitions', readFileSync('components/entity-modal/widgets/TenantStatusTransitions.tsx', 'utf8')],
                           ['TenantClient', tenantClient],
                           ['tenants/actions', tenantsActions]]) {
  if (!/reasonsForStatus\(/.test(src)) {
    violations.push(`[소스] ${file} 이 사유 판정을 statusReasons 정본으로 하지 않는다 — 받는 곳과 고치는 곳이 갈린다`)
  }
}
// 사유를 받는 전이와 목록이 가져오는 전이가 같아야 한다.
// 디자이너 패스에서 잡힌 결함 — statusReasons 는 CHECKOUT_PENDING 에서도 사유를 받는데
// 목록 쿼리는 CANCELLED·CHECKED_OUT 만 가져와서, 퇴실 예정에서 적은 사유가 표·카드에서 통째로 사라졌다.
// 같은 사실이 상세(이력 위젯)에는 보이고 목록에는 안 보이는 모순 상태였다.
{
  const reasonBearing = ['CANCELLED', 'CHECKOUT_PENDING', 'CHECKED_OUT']
  const m = tenantsActions.match(/statusLogs:\s*\{[\s\S]{0,600}?toStatus:\s*\{\s*in:\s*\[([^\]]*)\]/)
  if (m) {
    for (const st of reasonBearing) {
      if (!m[1].includes(st)) {
        violations.push(`[소스] getTenants 의 statusLogs 가 ${st} 를 안 가져온다 — 그 지점에서 적은 사유가 목록에서 사라진다`)
      }
    }
  }
}

// 16-3. 무효 처리한 이력이 사유 파생에 섞이면 안 된다 (신고 e000c791, 2026-08-10).
//
//   중첩 관계 조회(include 의 statusLogs)는 소프트삭제 자동필터가 **안 걸린다**.
//   여기서 deletedAt 이 빠지면 잘못 적은 퇴실 사유가 무효 처리 뒤에도 살아 있다가,
//   그 사람이 실제로 퇴실하는 날 목록·카드의 퇴실 사유로 튀어나온다(조정미 님 '개인 사정').
for (const [name, src] of [['tenants/actions getTenants', tenantsActions],
                           ['api/calendar 투어 피드', readFileSync('app/api/calendar/[token]/route.ts', 'utf8')]]) {
  const i = src.indexOf('statusLogs: {')
  if (i < 0) continue
  // select: 앞까지가 그 블록의 조회 조건이다. 키 순서에 안 기대게 블록을 통째로 본다.
  // 주석은 걷어낸다 — 'deletedAt 을 손수 적는다' 같은 설명문이 코드 대신 검사를 통과시킨다(역주입에서 발견).
  const end = src.indexOf('select:', i)
  const blk = src.slice(i, end > i ? end : i + 700).split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  if (!blk.includes('deletedAt')) {
    violations.push(`[소스] ${name} 의 중첩 statusLogs 에 deletedAt 필터가 없다 — 무효 처리한 이력이 파생값으로 되살아난다`)
  }
}

// 등록 로그는 전이가 아니다. leaseTermId 를 안 채우면 계약 단위 조회에서 사라지고,
// fromStatus 를 지어내면 전이표 검증에 유령 데이터가 섞인다(실제로 44건이 그랬다).
// 무효 처리분은 뺀다 — 없던 일로 한 행을 백필하라고 요구하면 그 지시가 거짓이 된다.
const orphanLogs = await prisma.tenantStatusLog.count({ where: { leaseTermId: null, deletedAt: null } })
if (orphanLogs > 0) violations.push(`[데이터] 계약이 안 붙은 상태 로그 ${orphanLogs}건 — scripts/backfill-status-log-creation 로 정정하라`)

// 17. 상태 전이 — 서버에 전이표가 없어 8x8 전부가 통과했고, 상태를 바꾸는 경로가 넷이라
//     경로마다 규칙이 갈렸다(B페이즈 조사 2026-08-03).
if (!/canTransition\(lease\.status, input\.toStatus\)/.test(tenantsActions)) {
  violations.push('[소스] applyStatusTransition 이 전이표를 검사하지 않는다 — 뜻이 안 서는 상태 변경이 그대로 저장된다')
}
// 예약 선납 재앵커 — 호출부 넷 중 하나라도 빠지면 그 경로만 돈 처리가 달라진다
for (const fn of ['moveInTenant', 'confirmReservationToActive', 'applyStatusTransition', 'updateTenant']) {
  const idx = tenantsActions.indexOf(`export async function ${fn}`)
  if (idx < 0) continue
  const end = tenantsActions.indexOf('\nexport async function', idx + 10)
  const body = tenantsActions.slice(idx, end < 0 ? undefined : end)
  if (!/reanchorReservationPrepaid/.test(body)) {
    violations.push(`[소스] ${fn} 에 예약 선납 재앵커가 없다 — 이 경로로 예약->거주중 하면 선납이 옛 달에 남아 입주월이 미납으로 뜬다`)
  }
}
// 실제로 발생한 전이를 전이표가 막으면 안 된다 — 쓰이는 흐름은 뜻이 성립하는 것이다.
// 무효 처리분은 뺀다 — 잘못 입력해서 없던 일로 한 전이를 근거로 전이표를 넓히면 오답이 규칙이 된다.
const { canTransition } = await import('../lib/leaseTransitions.ts')
const logs = await prisma.tenantStatusLog.findMany({ where: { deletedAt: null }, select: { fromStatus: true, toStatus: true } })
const blockedKinds = new Set()
for (const l of logs) if (!canTransition(l.fromStatus, l.toStatus)) blockedKinds.add(`${l.fromStatus}->${l.toStatus}`)
for (const k of blockedKinds) violations.push(`[데이터] 실제로 쓰인 전이 ${k} 를 전이표가 막는다 — 운영 흐름이 끊긴다`)

// 18. 홈과 수납 관리가 적는 '같은 이름의 숫자' — 예상 축과 실수납 축 (2026-08-07 캡션, 2026-08-11 실수납 축).
//
//   홈 예상 수입 = 이 달 청구 합 + 예약 확정 전액 + 퇴실 귀속 인식 + 기타수익
//   홈 실수납    = 이 달 수납 합 + 퇴실 귀속 인식 + 기타수익
//   수납 관리 스트립 아래 캡션이 이 두 등식을 그대로 적는다. 운영자가 두 화면 숫자를 다르게 읽은 것이
//   세 번(7/31, 8/07, 8/11) 있었고, 마지막 것은 방마다 대표 계약 하나만 행으로 만들던 규칙 때문이었다.
//
//   종전 이 검사의 stripBilled 모델은 '방이 붙은 청구 대상 계약 전부'를 가정했다. 실제 코드는 방마다
//   대표 하나(+비거주 하나)만 행으로 만들고 있었는데 모델이 그걸 몰라서, 402호 황인정 329,000 이
//   화면에서 통째로 빠진 날에도 위반 0으로 통과했다. 그래서 여기서는 **행 생성 규칙을 소스에서 읽어**
//   그대로 모델링하고, 그 위에 '청구 대상인데 행이 없는 계약'을 직접 센다.
{
  const dash = readFileSync('app/(app)/dashboard/page.tsx', 'utf8')
  if (!/\+ checkedOutRecognized \+ reservedExpected/.test(dash)) {
    violations.push('[소스] 홈 totalExpected 의 구성(청구 + 퇴실 귀속 + 예약 확정)이 바뀌었다 — 수납 관리 캡션의 등식이 거짓이 된다')
  }
  // 줄 끝까지 본다 — 항이 하나 더 붙어도 통과하면 다섯 번째 항을 못 잡는다(역주입에서 발견)
  if (!/const projectedRevenue = totalExpected \+ extraRevenue\s*$/m.test(dash)) {
    violations.push('[소스] 홈 projectedRevenue 가 totalExpected + extraRevenue 가 아니다 — 캡션이 적는 항이 실제와 어긋난다')
  }
  // 실수납 축도 같은 모양이어야 한다. 홈이 자기 식을 다시 만들면 캡션의 '수납'과 '퇴실 귀속'이 갈린다.
  if (!/const paidRevenue = paidBreakdown\.total\s*$/m.test(dash) || !/getPaidRevenue\(prisma, propertyId, targetMonth\)/.test(dash)) {
    violations.push('[소스] 홈 paidRevenue 가 lib/leaseStatus getPaidRevenue 정본이 아니다 — 퇴실 캡 비대칭이 되살아난다')
  }
  if (/leaseRentMap\.get\(id\)/.test(dash)) {
    violations.push('[소스] 홈 실수납 캡이 lease.rentAmount(오늘의 가격표)로 되돌아갔다 — 락인된 과거 청구가 소급 재계산된다')
  }
  // 두 화면이 같은 헬퍼를 불러야 한다. 한쪽이 자기 식을 만들면 같은 이름의 항이 다른 값이 된다.
  const roomsPage = readFileSync('app/(app)/rooms/page.tsx', 'utf8')
  for (const [name, src] of [['dashboard/page', dash], ['rooms/page', roomsPage]]) {
    for (const fn of ['getReservedFullMonthRevenue', 'getCheckedOutRecognizedRevenue']) {
      if (!src.includes(`${fn}(prisma, propertyId, targetMonth)`)) {
        violations.push(`[소스] ${name} 이 ${fn} 정본을 안 쓴다 — 홈과 수납 관리의 같은 항이 다른 값이 된다`)
      }
    }
  }
  const leaseStatusSrc = readFileSync('lib/leaseStatus.ts', 'utf8')
  if (!/export async function getReservedFullMonthRevenue/.test(leaseStatusSrc) || !/billForLeaseMonth\(l, targetMonth, null\)/.test(leaseStatusSrc)) {
    violations.push('[소스] getReservedFullMonthRevenue 정본이 사라졌거나 billForLeaseMonth 를 안 탄다 — 예약 확정 전액이 화면마다 갈린다')
  }
  if (!/export async function getPaidRevenue/.test(leaseStatusSrc)) {
    violations.push('[소스] getPaidRevenue 정본이 사라졌다 — 홈 실수납 식이 다시 화면 안으로 들어갔다')
  }
  // 퇴실 항은 두 축이 문자 그대로 같은 값이어야 한다. 실수납 쪽에만 캡을 걸면 인식 축(무캡)과 갈린다.
  if (!/checkedOut,\s*total: occupied \+ checkedOut/.test(leaseStatusSrc)) {
    violations.push('[소스] getPaidRevenue 의 퇴실 항이 getCheckedOutRecognizedRevenue 와 같은 값이 아니다 — 예상 축과 실수납 축이 갈린다')
  }
  if (!/expectedSum \+ reservedExpected \+ checkedOutRecognized \+ incomeSum/.test(roomsClient)) {
    violations.push('[소스] RoomsClient 캡션의 홈 예상 수입 등식이 네 항 합이 아니다 — 캡션 숫자가 홈과 안 맞는다')
  }
  if (!/collectedSum \+ checkedOutRecognized \+ incomeSum/.test(roomsClient)) {
    violations.push('[소스] RoomsClient 캡션의 홈 실수납 등식에 퇴실 귀속 항이 없다 — 홈 실수납과 그만큼 어긋난다')
  }
  // 미래월은 안 받은 돈을 걷었다고 말하면 안 된다(2026-08-11). 서버가 그 달 청구를 0으로 잠그기 때문에
  // 수납액이 청구액과 같아져 늘 100% 로 뜬다. 게이지와 등식 두 줄을 미래월에서 걷어낸 가드.
  if (!/const showHomeBridge\s*=\s*!isFutureMonth &&/.test(roomsClient)) {
    violations.push('[소스] RoomsClient 캡션 등식이 미래월에도 렌더된다 — 대조할 상대가 없는 달에 거짓 등식을 적는다')
  }
  if (!/\{!isFutureMonth && \(/.test(roomsClient)) {
    violations.push('[소스] RoomsClient 수납 진행바가 미래월에도 렌더된다 — 안 받은 돈이 100% 로 보인다')
  }
  if (!/isFutureMonth = targetMonth > kstMonthStr\(\)/.test(roomsPage)) {
    violations.push('[소스] rooms/page 가 미래월 판정을 서버(KST)에서 내리지 않는다 — 클라가 오늘을 다시 구하면 하이드레이션이 갈린다')
  }

  // ── 등식 문장 정본 (2026-08-12) ──
  // 값이 원 단위로 같아도 두 화면이 **각자 문장을 조립하면** 항 구성·항 이름이 갈린다.
  // 한쪽만 '퇴실 귀속'을 빠뜨리거나 한쪽만 '이 달 청구'라 부르면 같은 숫자에 다른 설명이 붙는다.
  // 그래서 문장은 components/ui/MoneyEquation 하나가 만들고, 두 화면이 그걸 부른다.
  const dashClient = readFileSync('app/(app)/dashboard/DashboardClient.tsx', 'utf8')
  const eqSrc      = readFileSync('components/ui/MoneyEquation.tsx', 'utf8')
  for (const [name, src] of [['RoomsClient', roomsClient], ['dashboard/DashboardClient', dashClient]]) {
    if (!/expectedRevenueTerms\(\{/.test(src) || !/<MoneyEquation terms=/.test(src)) {
      violations.push(`[소스] ${name} 이 등식 문장을 MoneyEquation 정본으로 안 만든다 — 화면마다 항 구성이 갈린다`)
    }
  }
  if (!/label: '이 달 청구액'.+\n.+label: '예약 확정'.+\n.+label: '퇴실 귀속'.+\n.+label: '기타수익'/.test(eqSrc)) {
    violations.push('[소스] MoneyEquation 예상 수입 등식의 네 항 이름·순서가 바뀌었다 — 두 화면이 같은 문장을 못 쓴다')
  }
  // 운영이익 등식의 마지막 항은 '실제로 뺀 금액'이어야 한다. 서버는 과거월에 미기록 고정지출
  // 추정을 안 더하는데(page.tsx isPastMonth 분기) 캡션이 추정치를 그대로 빼면 그 금액만큼
  // 등식이 거짓이 된다. 6월 실데이터로 706,457 원짜리 거짓말이 될 수 있던 자리다.
  if (!/pendingRecurring:\s*data\.expectedExpense - data\.totalExpense/.test(dashClient)) {
    violations.push('[소스] 홈 운영이익 캡션의 고정 지출(예정) 항이 expectedExpense - totalExpense 유도가 아니다 — 과거월에 안 뺀 돈을 뺐다고 적는다')
  }
  if (/projectedRecurringExpense/.test(dashClient.slice(dashClient.indexOf('const profitTerms')))) {
    violations.push('[소스] 홈 운영이익 캡션 경로가 projectedRecurringExpense 를 직접 쓴다 — 과거월 분기를 안 타 등식이 거짓이 된다')
  }
  if (!/const projectedNetProfit = projectedRevenue - expectedExpense/.test(dash)) {
    violations.push('[소스] 홈 projectedNetProfit 이 projectedRevenue - expectedExpense 가 아니다 — 운영이익 캡션이 실제 산식과 어긋난다')
  }
  if (!/expectedExpense = isPastMonth \? totalExpense : totalExpense \+ projectedRecurringExpense/.test(dash)) {
    violations.push('[소스] 홈 예상 지출의 과거월 분기가 바뀌었다 — 운영이익 캡션의 마지막 항이 실제로 뺀 금액과 갈린다')
  }
  if (!/label: '예상 수입'.+\n.+label: '기록된 지출'.+\n.+label: '고정 지출 \(예정\)'/.test(eqSrc)) {
    violations.push('[소스] MoneyEquation 운영이익 등식의 항 이름·순서가 바뀌었다 — 지출 관리·결산 보고서 어휘와 갈린다')
  }
  if (!/const totalExpected  = billedThisMonth\s*\n\s*\+ checkedOutRecognized \+ reservedExpected/.test(dash)) {
    violations.push('[소스] 홈 totalExpected 의 첫 항이 billedThisMonth 가 아니다 — 예상 수입 캡션의 첫 항이 되계산으로 돌아갔다')
  }
  // 항이 하나뿐인 달엔 등식을 적지 않는다 — 바로 위 큰 숫자를 그대로 되풀이할 뿐이다.
  // 미래월 가드는 수납 관리와 같은 달에 뜨고 사라지게 하려는 것이다(한쪽만 비면 그게 또 불일치다).
  if (!/!data\.isFutureMonth && hasRevenueBridge\(/.test(dashClient)) {
    violations.push('[소스] 홈 예상 수입 캡션이 미래월·무차이 달에도 렌더된다 — 수납 관리와 뜨고 지는 달이 갈린다')
  }
  // 등식 줄은 전체 자릿수라야 눈으로 검산이 된다(§06 축약 금지 구역).
  if (/fmtKorMoney|fmtManShort/.test(eqSrc)) {
    violations.push('[소스] MoneyEquation 이 축약 포맷을 쓴다 — 자릿수가 흔들려 두 화면 대조가 안 된다')
  }

  // ── 값 대조 ──
  // (여기 재현은 lib/billing 의 일할→락인→단기→할인 순서를 그대로 옮긴 간이 구현이다.)
  const monthOf = (d) => {
    if (!d) return null
    const dt = new Date(d)
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
  }
  const effBase = (l, mon) => {
    if (l.status === 'NON_RESIDENT') {
      const s = l.room?.nonResidentScheduled ?? null
      const m = l.room?.nonResidentRentDate ? monthOf(l.room.nonResidentRentDate) : null
      return (s != null && s > 0 && m && mon >= m) ? s : l.rentAmount
    }
    const s = l.room?.scheduledRent ?? null
    const m = l.room?.rentUpdateDate ? monthOf(l.room.rentUpdateDate) : null
    return (s != null && s > 0 && m && mon >= m) ? s : l.rentAmount
  }
  const billFor = (l, mon, locked) => {
    if (l.checkoutProratedAmount != null && l.checkoutProratedMonth === mon) return l.checkoutProratedAmount
    if (locked && locked > 0) return locked
    if (l.isShortTerm && l.moveInDate) {
      const im = monthOf(l.moveInDate)
      if (im && mon !== im) return 0
    }
    return discounted(l.discounts, mon, effBase(l, mon))
  }
  const resolveDue = (raw, mon) => {
    if (!raw) return null
    if (raw.includes('-')) {
      const [fy, fm, fd] = raw.split('-').map(Number)
      return [fy, fm, fd].some(isNaN) ? null : new Date(fy, fm - 1, fd, 23, 59, 59, 999)
    }
    const [y, m] = mon.split('-').map(Number)
    const last = new Date(y, m, 0).getDate()
    let day
    if (raw.includes('말')) day = last
    else { day = parseInt(raw, 10); if (isNaN(day)) return null; day = Math.min(day, last) }
    return new Date(y, m - 1, day, 23, 59, 59, 999)
  }
  const noBillingMonth = (l, mon, due) => {
    if (l.checkoutProratedAmount != null && l.checkoutProratedMonth === mon) return false
    if (!l.expectedMoveOut || !due) return false
    if (monthOf(l.expectedMoveOut) !== mon) return false
    return new Date(l.expectedMoveOut).getTime() <= due.getTime()
  }
  const afterMoveOut = (l, mon) => {
    const mo = monthOf(l.expectedMoveOut ?? null)
    return !!mo && mon > mo
  }
  const inMonth = (l, mon) => {
    const mi = monthOf(l.moveInDate ?? null)
    if (mi && mi > mon) return false
    const mo = monthOf(l.expectedMoveOut ?? null)
    if (mo && mo < mon) return false
    return true
  }

  const kstNow = new Date(Date.now() + 9 * 3600000)
  const nowMonth = `${kstNow.getUTCFullYear()}-${String(kstNow.getUTCMonth() + 1).padStart(2, '0')}`
  const eqMonths = [-1, 0, 1].map(off => {
    const d = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth() + off, 1))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  })
  // 수납 화면의 행 생성 규칙을 소스에서 읽는다. 정본 헬퍼를 쓰면 계약마다 한 행, 아니면 종전 대표 1건 규칙.
  const rowRuleIsPerLease = roomsActions.includes('roomLeaseRowOrder(')
  const leaseSelect = {
    id: true, status: true, rentAmount: true, isShortTerm: true, moveInDate: true, expectedMoveOut: true,
    dueDay: true, overrideDueDay: true, overrideDueDayMonth: true, roomId: true,
    checkoutProratedAmount: true, checkoutProratedMonth: true,
    discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
    room: { select: { roomNo: true, scheduledRent: true, rentUpdateDate: true, nonResidentScheduled: true, nonResidentRentDate: true } },
    tenant: { select: { name: true } },
  }
  for (const prop of await prisma.property.findMany({ select: { id: true, name: true, acquisitionDate: true, prevOwnerCutoffDate: true } })) {
    // 양도인 귀속 기준일 — 수납 화면(getRoomPaymentStatus)·홈(getPaidRevenue) 과 같은 기준.
    const cutoff = prop.prevOwnerCutoffDate ?? prop.acquisitionDate ?? null
    const [screenLeases, checkedOutLeases, hist] = await Promise.all([
      // 수납 화면이 보는 집합 그대로 — 여기서 billable(거주·비거주)과 예약을 갈라 쓴다.
      prisma.leaseTerm.findMany({
        where: { propertyId: prop.id, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
        select: leaseSelect,
      }),
      prisma.leaseTerm.findMany({ where: { propertyId: prop.id, status: 'CHECKED_OUT' }, select: { id: true, room: { select: { roomNo: true } }, tenant: { select: { name: true } } } }),
      prisma.paymentRecord.findMany({
        where: { propertyId: prop.id, isDeposit: false, targetMonth: { in: eqMonths }, deletedAt: null },
        select: { leaseTermId: true, targetMonth: true, expectedAmount: true, actualAmount: true, isPrevOwner: true, payDate: true },
      }),
    ])
    const billableLeases = screenLeases.filter(l => ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'].includes(l.status))
    const reservedLeases = screenLeases.filter(l => l.status === 'RESERVED' && l.rentAmount > 0)
    const checkedOutIds = new Map(checkedOutLeases.map(c => [c.id, c]))

    const prevOwnerMonths = new Map()
    const lockedByLease = new Map()
    const paidByLeaseMonth = new Map()   // `${leaseId}|${mon}` → 그 달 귀속 수납 합(양도인 컷오프 이후)
    for (const p of hist) {
      if (p.isPrevOwner) {
        if (!prevOwnerMonths.has(p.leaseTermId)) prevOwnerMonths.set(p.leaseTermId, new Set())
        prevOwnerMonths.get(p.leaseTermId).add(p.targetMonth)
        continue
      }
      if (cutoff && new Date(p.payDate) < cutoff) continue
      if (!lockedByLease.has(p.leaseTermId)) lockedByLease.set(p.leaseTermId, new Map())
      const m = lockedByLease.get(p.leaseTermId)
      if (p.expectedAmount > (m.get(p.targetMonth) ?? 0)) m.set(p.targetMonth, p.expectedAmount)
      const k = `${p.leaseTermId}|${p.targetMonth}`
      paidByLeaseMonth.set(k, (paidByLeaseMonth.get(k) ?? 0) + p.actualAmount)
    }
    const paidOf = (l, mon) => paidByLeaseMonth.get(`${l.id}|${mon}`) ?? 0

    for (const mon of eqMonths) {
      const isFuture = mon > nowMonth
      // 홈의 그 달 청구액 — dashboard billThisMonth.
      const billThisMonth = (l) => {
        if (prevOwnerMonths.get(l.id)?.has(mon)) return 0
        const dueRaw = (l.overrideDueDayMonth === mon && l.overrideDueDay) ? l.overrideDueDay : l.dueDay
        if (noBillingMonth(l, mon, resolveDue(dueRaw, mon))) return 0
        return billFor(l, mon, lockedByLease.get(l.id)?.get(mon) ?? null)
      }
      // 수납 화면 행의 그 달 청구액 — 퇴실월 초과도 0(홈은 inMonth 게이트가 같은 일을 한다).
      const rowExpected = (l) => afterMoveOut(l, mon) ? 0 : billThisMonth(l)

      // 화면 행 생성 — 소스에서 읽은 규칙 그대로.
      const rowLeases = []
      const byRoom = new Map()
      for (const l of screenLeases) {
        if (!l.roomId) continue
        if (!byRoom.has(l.roomId)) byRoom.set(l.roomId, [])
        byRoom.get(l.roomId).push(l)
      }
      for (const ls of byRoom.values()) {
        const chosen = rowRuleIsPerLease
          ? ls
          : [ls.find(x => ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'].includes(x.status)), ls.find(x => x.status === 'NON_RESIDENT')].filter(Boolean)
        for (const l of chosen) {
          // RESERVED 는 입주 전에도 예약 확인용으로 남고, 나머지는 입주월이 지나야 행이 된다.
          if (l.status !== 'RESERVED') {
            const mi = monthOf(l.moveInDate)
            if (mi && mi > mon) continue
          }
          rowLeases.push(l)
        }
      }
      const rowIds = new Set(rowLeases.map(l => l.id))
      const stripRows = rowLeases.filter(l => l.status !== 'RESERVED')

      const homeRows = billableLeases.filter(l => l.rentAmount > 0 && inMonth(l, mon))
      const homeBilled = homeRows.reduce((s, l) => s + billThisMonth(l), 0)
      const stripBilled = stripRows.reduce((s, l) => s + rowExpected(l), 0)
      if (homeBilled !== stripBilled) {
        violations.push(`[데이터] ${prop.name} ${mon}: 홈 청구 합 ${homeBilled.toLocaleString()} ≠ 수납 화면 청구 합 ${stripBilled.toLocaleString()} — 캡션 등식의 첫 항이 어긋난다`)
      }
      // 행이 아예 없는 계약을 직접 센다. 합만 보면 두 누락이 상쇄될 때 통과한다.
      for (const l of homeRows) {
        if (rowIds.has(l.id)) continue
        violations.push(`[데이터] ${prop.name} ${mon}: ${l.room?.roomNo ?? '방 없음'}호 ${l.tenant.name}(${l.status}) 이 청구 대상인데 수납 화면에 행이 없다 — 그 달 청구 ${billThisMonth(l).toLocaleString()} 이 홈에만 잡힌다`)
      }
      // 청구가 0이어도 사람은 보여야 한다 — 예약·무청구 퇴실월 행이 통째로 사라지는 클래스(404호 두 예약).
      for (const l of screenLeases) {
        if (!l.roomId || rowIds.has(l.id)) continue
        if (l.status !== 'RESERVED') {
          const mi = monthOf(l.moveInDate)
          if (mi && mi > mon) continue
          if (!inMonth(l, mon)) continue
        }
        violations.push(`[데이터] ${prop.name} ${mon}: ${l.room?.roomNo}호 ${l.tenant.name}(${l.status}) 계약이 수납 화면 목록에서 통째로 빠진다`)
      }

      const reserved = reservedLeases.filter(l => inMonth(l, mon)).reduce((s, l) => s + billFor(l, mon, null), 0)
      const coAgg = await prisma.paymentRecord.aggregate({
        where: { propertyId: prop.id, targetMonth: mon, isDeposit: false, isPrevOwner: false, deletedAt: null, leaseTerm: { status: 'CHECKED_OUT' } },
        _sum: { actualAmount: true },
      })
      const checkedOut = coAgg._sum.actualAmount ?? 0
      const [yy, mm2] = mon.split('-').map(Number)
      const incAgg = await prisma.extraIncome.aggregate({
        where: { propertyId: prop.id, deletedAt: null, date: { gte: new Date(yy, mm2 - 1, 1), lte: new Date(yy, mm2, 0) } },
        _sum: { amount: true },
      })
      const extra = incAgg._sum.amount ?? 0
      const homeProjected = homeBilled + checkedOut + reserved + extra
      const captionSum = stripBilled + reserved + checkedOut + extra
      if (homeProjected !== captionSum) {
        violations.push(`[데이터] ${prop.name} ${mon}: 홈 예상 수입 ${homeProjected.toLocaleString()} ≠ 캡션 등식 ${captionSum.toLocaleString()} — 두 화면이 다시 갈렸다`)
      }

      // ── 실수납 축 ── 미래월은 화면이 수납을 말하지 않으므로 대조 대상이 아니다.
      if (!isFuture) {
        const homePaidOccupied = billableLeases.reduce((s, l) => {
          const paid = paidOf(l, mon)
          if (paid <= 0) return s
          const mi = monthOf(l.moveInDate)
          if (mi && mi > mon) return s
          return s + Math.min(paid, rowExpected(l))
        }, 0)
        const stripCollected = stripRows.reduce((s, l) => {
          const exp = rowExpected(l)
          const owed = Math.max(0, exp - paidOf(l, mon))
          return s + (exp - Math.min(exp, owed))
        }, 0)
        if (homePaidOccupied !== stripCollected) {
          violations.push(`[데이터] ${prop.name} ${mon}: 홈 실수납의 거주·비거주 항 ${homePaidOccupied.toLocaleString()} ≠ 수납 화면 수납액 ${stripCollected.toLocaleString()} — 같은 이름의 숫자가 갈렸다`)
        }
        const homeRevenue = homePaidOccupied + checkedOut + extra
        const captionCollected = stripCollected + checkedOut + extra
        if (homeRevenue !== captionCollected) {
          violations.push(`[데이터] ${prop.name} ${mon}: 홈 실수납 ${homeRevenue.toLocaleString()} ≠ 캡션 실수납 등식 ${captionCollected.toLocaleString()}`)
        }
      }

      // 퇴실 계약의 그 달 수납이 그 달 락인 청구를 넘는가.
      // 회계 패널(2026-08-11)이 퇴실 항에도 캡을 걸자고 했으나, 캡을 걸면 인식 축(무캡)과 갈려
      // 같은 이름의 숫자가 화면마다 달라진다. 그 보호 취지를 캡이 아니라 여기로 옮겼다 —
      // 넘는 돈이 생기면 조용히 수익이 되는 대신 위반으로 뜬다(선수금인지 잡수입인지 사람이 정할 일이다).
      for (const [id, c] of checkedOutIds) {
        const paid = paidOf({ id }, mon)
        if (paid <= 0) continue
        const locked = lockedByLease.get(id)?.get(mon) ?? 0
        if (locked > 0 && paid > locked) {
          violations.push(`[데이터] ${prop.name} ${mon}: 퇴실 계약 ${c.room?.roomNo ?? '-'}호 ${c.tenant.name} 의 그 달 수납 ${paid.toLocaleString()} 이 락인 청구 ${locked.toLocaleString()} 을 넘는다 — 초과분이 선수금인지 잡수입인지 정해야 한다`)
        }
      }
    }
  }
}

// 19. 청소비가 보증금 안의 몫인 영업장 — 이중 계상과 판정 정본 이탈 (2026-08-10, 운영자 승인 구조).
//
//   (a) 데이터. 포함형 영업장에서 현금으로 받은 보증금이 '계약 보증금 − 기수령 청소비'를 넘으면
//       같은 돈이 두 번 잡힌 것이다. 520호 김민정이 정정 전 정확히 그 상태였고(계약 50,000 ·
//       현금 50,000 · 청소비 20,000), 앱은 아무 말도 하지 않았다. 존량이 아니라 유량이 위험하다 —
//       단기가 월 계약으로 전환될 때마다 프리필이 같은 길을 다시 연다.
{
  const inclusiveProps = await prisma.property.findMany({
    where: { cleaningFeeInDeposit: true }, select: { id: true, name: true },
  })
  for (const prop of inclusiveProps) {
    const ls = await prisma.leaseTerm.findMany({
      where: { propertyId: prop.id, depositAmount: { gt: 0 } },
      select: {
        depositAmount: true,
        tenant: { select: { name: true } },
        room: { select: { roomNo: true } },
        // 중첩 where 는 소프트삭제 자동 필터가 안 붙는다(원시 클라이언트라 더욱) — deletedAt 명시 필수
        paymentRecords: { where: { isDeposit: true, deletedAt: null }, select: { actualAmount: true } },
        extraIncomes:   { where: { ...CLEANING_RECEIVED_WHERE, deletedAt: null }, select: { amount: true } },
      },
    })
    for (const l of ls) {
      const cleaningPaid = l.extraIncomes.reduce((s, i) => s + i.amount, 0)
      if (cleaningPaid <= 0) continue
      const depositPaid = l.paymentRecords.reduce((s, r) => s + r.actualAmount, 0)
      const cashDue = Math.max(0, l.depositAmount - Math.min(l.depositAmount, cleaningPaid))
      if (depositPaid > cashDue) {
        violations.push(`[데이터] ${prop.name} ${l.room?.roomNo ?? '-'}호 ${l.tenant.name} — 청소비 ${cleaningPaid.toLocaleString()}원을 이미 받았는데 현금 보증금이 ${depositPaid.toLocaleString()}원(현금 몫 ${cashDue.toLocaleString()}원). ${(depositPaid - cashDue).toLocaleString()}원이 이중 계상`)
      }
    }
  }
}
//   (b) 소스. 판정식이 다시 흩어지면 자리마다 청소비 몫이 갈린다 — 종전에 딱 그래서 화면이 5만,
//       서버가 3만이었다. 보증금 구성을 읽는 자리는 lib/depositComposition 정본을 통해야 한다.
{
  const COMPOSITION_CALLERS = [
    'components/entity-modal/widgets/DepositStatusPanel.tsx',
    'components/entity-modal/widgets/TenantStatusTransitions.tsx',
    'app/(app)/tenants/TenantClient.tsx',
    'app/(app)/tenants/actions.ts',
    'app/(app)/dashboard/page.tsx',
    'app/(app)/finance/actions.ts',
    'app/(app)/rooms/actions.ts',
    'app/rent-receipt/[tenantId]/actions.ts',
    'lib/depositEntryGuard.ts',
  ]
  for (const f of COMPOSITION_CALLERS) {
    if (!readFileSync(f, 'utf8').includes('@/lib/depositComposition')) {
      violations.push(`[소스] ${f} 이 보증금 구성 판정 정본(lib/depositComposition)을 안 쓴다 — 청소비 몫이 자리마다 갈린다`)
    }
  }
  // 정본을 부르면서 옆에서 또 계산하는 경우까지 잡는다. import 만 보면 통과하는 반쪽 그물이 된다.
  const REIMPL = /(coveredByCleaning|cleaningCredit|cashDue)\s*=\s*Math\.(min|max)/
  const walkTs = (d) => readdirSync(d, { withFileTypes: true }).flatMap(e => {
    const full = `${d}/${e.name}`
    return e.isDirectory() ? walkTs(full) : (/\.(ts|tsx)$/.test(e.name) ? [full] : [])
  })
  for (const file of ['app', 'lib', 'components'].flatMap(walkTs)) {
    if (file === 'lib/depositComposition.ts') continue   // 정의부
    if (REIMPL.test(readFileSync(file, 'utf8'))) {
      violations.push(`[소스] ${file} 이 청소비 몫을 직접 계산한다 — lib/depositComposition 정본을 쓸 것`)
    }
  }
}

console.log(`\n[돈 정합] 위반 ${violations.length}건`)
for (const v of violations) console.log('  - ' + v)
console.log(`검사 lease ${leases.length}건`)
await prisma.$disconnect()
if (violations.length > 0) process.exit(1)
