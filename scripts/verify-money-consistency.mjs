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
// 대소문자를 무시하지 않으면 실제 위반을 놓친다 — 호출 이름이 setPayDateVal 이라 종전 정규식이
// 대문자 P 에서 빗나갔고, 그 사이 두 자리가 입주일을 프리필하고 있었다(2026-08-24 실측 확인).
if (/set[Pp]ay[Dd]ate[^\n]*moveInDate/.test(entryForm)) {
  violations.push('[소스] PaymentEntryForm 수납일 기본값이 입주일 파생으로 회귀 — 수납일 정본은 오늘(받은 날)')
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
  violations.push("[소스] getTenantDetail 이 CANCELLED 계약을 제외한다 — 취소된 입주자 상세가 통째로 빈다")
}
if (!/<TenantStatusHistory/.test(tenantBody)) {
  violations.push('[소스] 입주자 카드에 상태 이력 위젯이 없다 — 입실 취소·퇴실 사유를 볼 곳이 사라진다')
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
  // 마지막 항 이름은 '부가수익'(2026-08-12 운영자 확정 — 수납 관리 탭 어휘가 정본, '기타수익' 폐기).
  if (!/label: '이 달 청구액'.+\n.+label: '예약 확정'.+\n.+label: '퇴실 귀속'.+\n.+label: '부가수익'/.test(eqSrc)) {
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
  // 지출 두 항의 이름은 상수 하나에서 나온다(2026-08-12 용어 통일). 운영이익 등식은 빼고
  // 예상 지출 등식은 더하는 **같은 두 값**이라, 문자열이 두 곳에 흩어지면 한쪽만 고쳐졌을 때
  // 같은 모집단이 두 이름을 갖는다 — 그게 이번 지적("두 카드 용어 통일")의 형태였다.
  if (!/L_RECORDED_EXPENSE\s+=\s+'기록된 지출'/.test(eqSrc) || !/L_PENDING_RECURRING\s+=\s+'고정 지출 \(예정\)'/.test(eqSrc)) {
    violations.push('[소스] MoneyEquation 지출 항 이름 상수가 바뀌었다 — 홈 타일·지출 관리·결산 보고서 어휘와 갈린다')
  }
  if (!/label: '예상 수입'.+\n.+label: L_RECORDED_EXPENSE.+\n.+label: L_PENDING_RECURRING/.test(eqSrc)) {
    violations.push('[소스] MoneyEquation 운영이익 등식의 항 이름·순서가 바뀌었다 — 지출 관리·결산 보고서 어휘와 갈린다')
  }
  if (!/expectedExpenseTerms[\s\S]{0,400}?label: L_RECORDED_EXPENSE[\s\S]{0,200}?label: L_PENDING_RECURRING/.test(eqSrc)) {
    violations.push('[소스] MoneyEquation 예상 지출 등식이 운영이익 등식과 같은 항 이름 상수를 안 쓴다 — 두 카드가 같은 돈을 다른 말로 부른다')
  }
  // 예상 지출 캡션도 운영이익 캡션과 **같은 차분**을 받아야 한다. 미기록 추정치를 직접 넘기면
  // 과거월(추정을 안 더하는 달)에 좌변보다 큰 우변을 적게 된다.
  if (!/expectedExpenseTerms\(\{[\s\S]{0,200}?pendingRecurring:\s*data\.expectedExpense - data\.totalExpense/.test(dashClient)) {
    violations.push('[소스] 홈 예상 지출 캡션의 고정 지출(예정) 항이 expectedExpense - totalExpense 유도가 아니다 — 과거월에 없는 항을 적는다')
  }
  // 홈 세부 재무 요약 타일과 등식이 같은 변수를 다른 이름으로 부르던 자리(2026-08-12 정정).
  if (!/label: '기록된 지출', value: data\.totalExpense/.test(dashClient)) {
    violations.push('[소스] 홈 세부 재무 요약의 totalExpense 타일 이름이 등식 항과 갈렸다 — 같은 숫자에 두 이름이 붙는다')
  }
  // 지출 카테고리 도넛 중앙 문구는 도넛이 실제로 나눈 값의 이름이다. 2026-08-12 에는 그 값이
  // totalExpense 라 '기록된 지출'이었고(그때 '총 지출'이라는 두 번째 이름을 걷어냈다),
  // 2026-08-13 에 도넛이 예정분까지 담으면서 값이 expectedExpense 로 바뀌었다 — 이름도 함께 옮겼다.
  // 잠금은 아래 18-4 축이 잇는다(중앙 라벨·중앙 문구·분모를 한자리에서 본다).
  // 지출 카테고리 색은 **그 달 금액 순위**가 아니라 영업장 설정 등록 순서다(2026-08-13).
  // 순위로 칠하던 시절엔 같은 임대료가 7월 카멜·8월 테라코타여서 두 달 도넛을 나란히 못 봤다
  // (실측: 13종 중 8종이 5개월 사이 색이 흔들렸고 수선유지비는 다섯 색을 돌았다).
  if (!/expenseCategoryColor\(category, data\.expenseCategoryOrder\)/.test(dashClient)) {
    violations.push('[소스] 홈 지출 카테고리 색이 등록 순서 정본(expenseCategoryColor)을 안 탄다 — 달마다 같은 카테고리가 다른 색이 된다')
  }
  if (/chartColor\(i\)/.test(dashClient)) {
    violations.push('[소스] 홈이 순위 인덱스 색(chartColor(i))으로 되돌아갔다 — 지출 카테고리 색이 그 달 금액 순위를 따라 흔들린다')
  }
  // 같은 숫자 한 이름 — totalRevenue(= paidRevenue + extraRevenue)는 '실수납'이다.
  // 수납 관리 캡션이 원 단위로 같은 값을 그렇게 부르고 아래 [데이터] 축이 그 항등을 잠근다.
  // 종전 홈 보조줄 '수납+기타'가 같은 숫자의 두 번째 이름이었다(2026-08-12 정정).
  // 폐기 이름은 **화면 문자열로** 되살아났는지만 본다(정정 기록을 적은 주석은 대상이 아니라
  // JSX 텍스트 노드 시작 '>' 로 자리를 좁힌다 — 바로 위 순이익 가드와 같은 문법).
  if (!/실수납 \{fmtWon\(data\.totalRevenue\)\}/.test(dashClient) || />\s*수납\+기타/.test(dashClient)) {
    violations.push('[소스] 홈 예상 수입 보조줄이 totalRevenue 를 실수납이라 부르지 않는다 — 수납 관리 캡션과 같은 숫자에 두 이름이 붙는다')
  }
  // 반대 방향 — '실수납'이라는 이름이 보증금 축으로 새면 홈 안에서 탭만 바꿔도 같은 말이
  // 다른 숫자를 가리킨다. 보유 보증금 분해는 depositCompositionLabel 과 같은 말('받은 보증금')을 쓴다.
  // '청소비 몫'도 마찬가지다 — 그 값은 청소비 수익이 아니라 보증금 중 청소비가 채운 몫이다.
  if (!/받은 보증금 \$\{fmtKorMoney\(data\.depositReceived\)\}/.test(dashClient)) {
    violations.push('[소스] 홈 보유 보증금 분해가 depositReceived 를 받은 보증금이라 부르지 않는다 — 이용료 축의 실수납과 이름이 겹친다')
  }
  // 2026-08-13 운영자 확정으로 이 개념의 이름은 '보증금 안의 청소비'가 됐다. '청소비 몫'은
  // 무엇 안의 몫인지가 빠져 청소비 수익 총액으로 읽혔다. 상위 항이 이미 '받은 보증금'이라고
  // 말한 이 자리에서만 '이 중 청소비'로 줄인다('이 중'이 곧 '보증금 안의').
  if (!/이 중 청소비 \$\{fmtKorMoney\(data\.depositByCleaning\)\}/.test(dashClient)) {
    violations.push("[소스] 홈 보유 보증금 분해가 depositByCleaning 을 '이 중 청소비'라 부르지 않는다 — 청소비 수익 총액으로 읽힌다")
  }
  // paidRevenue 는 **이용료 축만**이다. '수납액 (귀속)'은 옆 칸 부가수익까지 합친 말로 읽혀
  // 두 칸의 합이 어딘가 세 번째에 있는 것처럼 보였다(운영자 확정 2026-08-13).
  // 두 축을 더한 값의 이름은 '실수납' 하나다.
  // 폐기 어휘는 **라벨 자리로** 좁혀 본다 — 정정 기록을 적은 주석까지 잡으면 근거가 사라진다
  // (위 '순이익' 가드가 JSX 텍스트 노드로 자리를 좁힌 것과 같은 문법).
  if (/label: '[^']*수납액 \(귀속\)'|label="[^"]*수납액 \(귀속\)"/.test(dashClient)) {
    violations.push("[소스] 홈에 '수납액 (귀속)' 어휘가 되살아났다 — paidRevenue 는 이용료 축이고 두 축의 합은 '실수납'이다")
  }
  // 라벨 자리 두 곳(요약 타일·수납 현황 금액 줄)에 다 서야 한다. 설명 모달 본문은 세지 않는다 —
  // 본문이 그 말을 한 번 쓰는 것만으로 통과하면 한쪽만 개명해도 그물이 안 걸린다(역주입에서 발견).
  if ((dashClient.match(/label: '이용료 수납 \(귀속\)'|label="이용료 수납 \(귀속\)"/g) ?? []).length < 2) {
    violations.push('[소스] 홈 요약 타일과 수납 현황이 같은 paidRevenue 를 다른 이름으로 부른다 — 같은 값에 두 이름이 붙는다')
  }
  // 폐기 어휘가 **화면·프롬프트 문자열로** 되살아났는지만 본다(주석의 정정 기록은 대상이 아니라
  // JSX 텍스트 노드 시작 '>' 와 프롬프트 항목 '- ' 로 자리를 좁힌다).
  const dashActions = readFileSync('app/(app)/dashboard/actions.ts', 'utf8')
  if (/>\s*(장부 )?순이익|>\s*순수익/.test(dashClient) || /^- (순수익|순이익):/m.test(dashActions)) {
    violations.push('[소스] 홈에 폐기 어휘(순이익·순수익)가 되살아났다 — netProfit 의 이름은 운영이익 하나다')
  }
  if (!/const totalExpected  = billedThisMonth\s*\n\s*\+ checkedOutRecognized \+ reservedExpected/.test(dash)) {
    violations.push('[소스] 홈 totalExpected 의 첫 항이 billedThisMonth 가 아니다 — 예상 수입 캡션의 첫 항이 되계산으로 돌아갔다')
  }
  // 재무 탭이 세운 나머지 두 등식의 좌변 정의(2026-08-13, 죽어 있던 payload 필드 기용).
  //   운영 가용 자금 = 운영이익 − 이 달 예비비 적립 · 이 달 미수납 = 예상 수입 − 실수납
  // 좌변을 서버가 다르게 만들기 시작하면 캡션이 조용히 거짓이 된다 — 화면은 그 값을 검산하지 않는다.
  if (!/operatingCashAvailable: \(totalRevenue - totalExpense\) - reserveAccrualFromThisMonth/.test(dash)) {
    violations.push('[소스] operatingCashAvailable 이 운영이익 − 이 달 예비비 적립 이 아니다 — 재무 탭 운영 가용 자금 등식이 거짓이 된다')
  }
  if (!/netProfit: totalRevenue - totalExpense/.test(dash)) {
    violations.push('[소스] 홈 netProfit 이 실수납 − 기록된 지출 이 아니다 — 운영 가용 자금 등식의 첫 항과 갈린다')
  }
  if (!/const pendingRevenue = Math\.max\(0, projectedRevenue - totalRevenue\)/.test(dash)) {
    violations.push('[소스] pendingRevenue 가 예상 수입 − 실수납 이 아니다 — 재무 탭 이 달 미수납 등식이 거짓이 된다')
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

// 18-2. 홈 수납 현황 도넛 — 한 모집단을 한 축으로 배타 분할 (2026-08-12 회계 패널).
//
//   종전에는 완납만 '그 달 축'(billableLeases 중 그 달 귀속 수납 >= 그 달 청구)이고 수납예정·미납은
//   '누적 축'이었다. 셋이 아무 모집단도 분할하지 않아 세 가지가 한꺼번에 어긋났다.
//     완납이면서 이월 미수가 있는 계약이 분모에 두 번 서고(잠복), 그 달 청구가 0인 계약이
//     0 >= 0 이라 완납으로 세어지고(2026-08 2건), 그 달 귀속 수납이 모자란데 누적으로는 완납인
//     계약은 어디에도 안 서서 도넛에서 증발했다(2026-04 3건, 정체는 인수월 양도인 자동 처리분).
//
//   데이터 대조로는 못 잡는다 — 세 건수는 화면 파생값이라 SQL 로 독립 재현할 대상이 없고,
//   '건수가 안 맞는 것' 자체가 정상인 상태가 없다(규칙 10 주석과 같은 판단). 감시할 것은
//   **코드가 다시 자기 축·자기 분모를 만드는 것**이다.
{
  const dash = readFileSync('app/(app)/dashboard/page.tsx', 'utf8')
  const dashClient = readFileSync('app/(app)/dashboard/DashboardClient.tsx', 'utf8')
  const dashActions = readFileSync('app/(app)/dashboard/actions.ts', 'utf8')
  const aiRoute = readFileSync('app/api/ai-analysis/route.ts', 'utf8')

  // (a) 모집단이 미납 루프에서 나온다 — 그 루프만이 인수월 양도인 자동 처리·양도인 귀속월·
  //     무청구 퇴실월·퇴실월 초과·단기 비청구월 게이트를 전부 물고 있다.
  if (!/const paymentStatusPool = new Set<string>\(\)/.test(dash) || !/paymentStatusPool\.add\(l\.id\)/.test(dash)) {
    violations.push('[소스] 홈 수납 현황의 모집단(paymentStatusPool)이 미납 루프에서 나오지 않는다 — 청구 게이트 사본이 다시 갈린다')
  }
  // (b) 세 항이 배타다. 완납을 모집단에서 빼서 구하지 않으면 합이 모집단과 어긋날 수 있다.
  if (!/const paidCount = paymentPool\.length - unpaidCount - awaitingCount/.test(dash)) {
    violations.push('[소스] 홈 완납 건수가 모집단 빼기로 나오지 않는다 — 세 항이 다시 서로 다른 축을 갖는다')
  }
  if (!/const awaitingCount = paymentPool\.filter\(l =>\s*\n?\s*\(overdueByLease\[l\.id\] \?\? 0\) === 0 && \(upcomingByLease\[l\.id\] \?\? 0\) > 0\)\.length/.test(dash)) {
    violations.push('[소스] 홈 수납예정 건수가 도래분 0 조건을 잃었다 — 이월 미수가 있는 계약이 미납과 수납예정 양쪽에 선다')
  }
  // (c) 종전의 그 달 축 완납이 되살아나지 않았는가.
  if (/paymentByLeaseForStatus\[l\.id\] \?\? 0\) >= billThisMonth\(l\)/.test(dash)) {
    violations.push('[소스] 홈 완납 건수가 그 달 축(billThisMonth)으로 되돌아갔다 — 나머지 두 항과 모집단이 갈린다')
  }
  // (d) 수납률 분모는 서버에 하나뿐이다. 화면·프롬프트가 각자 나누던 시절 같은 화면이 100% 와 61% 를
  //     동시에 말했다(2026-08). 세 소비처가 전부 서버 값을 읽는지 본다.
  if (!/const paymentRate = paymentPool\.length > 0/.test(dash)) {
    violations.push('[소스] 홈 수납률 정본(paymentRate)이 서버에서 사라졌다 — 분모가 다시 화면마다 생긴다')
  }
  if (!/centerLabel=\{`\$\{data\.paymentRate\}%`\}/.test(dashClient)) {
    violations.push('[소스] 홈 도넛 수납률이 서버 정본을 안 쓴다 — 화면이 자기 분모를 만든다')
  }
  for (const [name, src] of [['dashboard/actions AI 프롬프트', dashActions], ['api/ai-analysis 프롬프트', aiRoute]]) {
    if (/\(data\.paidCount \+ data\.unpaidCount\)/.test(src)) {
      violations.push(`[소스] ${name} 이 수납률을 자기 분모로 다시 나눈다 — 수납예정이 빠져 화면과 다른 비율을 적는다`)
    }
    if (!/data\.paymentRate/.test(src)) {
      violations.push(`[소스] ${name} 이 서버 수납률(paymentRate)을 안 읽는다`)
    }
  }
  // (e) 건수와 금액은 모집단이 다르다 — 건수에는 퇴실 계약이 없고 금액(paidRevenue)에는 그 달 귀속분이
  //     들어 있다(2026-06 퇴실 귀속 381만·10건). 값을 맞추는 대신 라벨로 가르기로 했으므로 그 라벨을 잠근다.
  // 소제목은 2026-08-13 에 '건수와 이 달 청구 (현 입주자)' 로 늘었다(금액 병기). 잠그는 것은
  //     한정어 자체이지 문장 전체가 아니다 — 앞말이 늘어도 모집단 표시는 살아 있어야 한다.
  if (!/건수[^\n]{0,20}\(현 입주자\)/.test(dashClient)) {
    violations.push('[소스] 홈 수납 현황 카드의 건수 모집단 한정어가 사라졌다 — 퇴실 귀속이 들어간 금액과 같은 모집단으로 읽힌다')
  }
}

// 18-3. 추이 막대의 수입은 KPI 실수납과 같은 정본이다 (2026-08-12 회계 패널).
//
//   종전 추이는 그 달 귀속 record 의 무캡 합이었다. 홈 KPI 는 그 달 청구액으로 캡한 합이라,
//   같은 화면에서 같은 달을 두 식이 말했다(오늘 실데이터로는 6개월 전부 차 0원인 잠복 상태였다).
//   막대 모드만 수렴한다 — 일간·주간은 납부일 축이라 '그 달 청구 캡'이라는 개념이 성립하지 않는다.
{
  const dash = readFileSync('app/(app)/dashboard/page.tsx', 'utf8')
  const dashActions = readFileSync('app/(app)/dashboard/actions.ts', 'utf8')
  const dashClient = readFileSync('app/(app)/dashboard/DashboardClient.tsx', 'utf8')
  const leaseStatusSrc = readFileSync('lib/leaseStatus.ts', 'utf8')

  if (!/export async function getPaidRevenueByMonths\(/.test(leaseStatusSrc)) {
    violations.push('[소스] 배치형 정본(getPaidRevenueByMonths)이 사라졌다 — 추이가 다시 자기 합산식을 갖는다')
  }
  // 단건이 배치에 위임하는가. 사본이 둘로 갈리면 아래 호출부 가드가 전부 무의미해진다.
  if (!/const byMonth = await getPaidRevenueByMonths\(prisma, propertyId, \[targetMonth\]\)/.test(leaseStatusSrc)) {
    violations.push('[소스] getPaidRevenue 가 배치형 위임이 아니다 — 같은 식이 두 벌이 됐다')
  }
  if (!/getPaidRevenueByMonths\(prisma, propertyId, last6Months\)/.test(dash)) {
    violations.push('[소스] 홈 6개월 추이가 정본을 안 쓴다 — 마지막 막대가 KPI 실수납과 갈린다')
  }
  if (/trendPayments\.filter\(p => p\.targetMonth === m\)/.test(dash)) {
    violations.push('[소스] 홈 추이가 무캡 합산(targetMonth 직접 합)으로 되돌아갔다')
  }
  // 막대 5분기(월간·반년·분기·연간·전체)가 전부 정본을 탄다. 호출 형태로 본다 — import 만 보면 통과한다.
  if ((dashActions.match(/paidRevenueForMonths\(propertyId, /g) ?? []).length < 3) {
    violations.push('[소스] getTrendData 의 막대 분기 일부가 정본(paidRevenueForMonths)을 안 탄다 — 범위 버튼마다 수입 축이 갈린다')
  }
  if (/payments\.filter\(p => p\.targetMonth === m\)|payments\.filter\(p => months\.includes\(p\.targetMonth/.test(dashActions)) {
    violations.push('[소스] getTrendData 막대 분기에 귀속월 무캡 합산이 되살아났다')
  }
  // 면적 모드(일간·주간)는 납부일 축 그대로다. 여기에 캡을 걸면 '납부일 기준' 배지가 거짓이 된다.
  // 일간·주간 두 곳이다. 존재만 보면 한쪽이 사라져도 나머지 하나로 통과한다(역주입에서 발견).
  if ((dashActions.match(/payments\.filter\(p => p\.payDate && /g) ?? []).length < 2) {
    violations.push('[소스] getTrendData 의 납부일 축(일간·주간) 합산이 사라졌다 — 배지 문구와 실제가 어긋난다')
  }
  // 범례 이름 — 막대는 KPI 와 같은 값이라 같은 이름('실수납'·'기록된 지출')을 쓰고, 면적은 다른 축이라 안 쓴다.
  if (!/isAreaRange \? '수입 \(수납 기준\)' : '실수납'/.test(dashClient)) {
    violations.push('[소스] 추이 범례가 막대 모드에서 KPI 와 같은 이름(실수납)을 안 쓴다 — 같은 값에 두 이름이 붙는다')
  }
  if (!/isAreaRange \? '지출' : '기록된 지출'/.test(dashClient)) {
    violations.push('[소스] 추이 범례의 지출 이름이 KPI 타일·도넛과 갈렸다')
  }
}

// 18-4. 홈 지출 카테고리 도넛 = 예상 지출 (2026-08-13).
//
//   도넛이 기록분만 세던 시절에는 아직 안 낸 임대료 396만이 그 달 지출 그림에서 통째로 빠져,
//   8월 도넛이 청소용역비를 두 번째로 큰 지출로 그렸다(실제 1위는 46% 임대료).
//   지금은 조각 합이 KPI '예상 지출'과 원 단위로 같아야 한다:
//       sum(categoryBreakdown.amount) === expectedExpense
//   이 항등은 세 가지가 동시에 지켜져야 성립한다. 하나라도 풀리면 도넛과 KPI 가 갈린다.
//     (a) 예정 항을 **과거월에는 안 더한다** — expectedExpense 와 같은 isPastMonth 가드.
//         이 가드가 풀리면 지난달 도넛만 KPI 보다 커진다(가장 눈에 안 띄는 형태의 거짓).
//     (b) 예정 항의 모집단·추정식이 projectedRecurringExpense 와 같다(같은 필터·같은 정본 헬퍼).
//     (c) 퍼센트 분모가 expectedExpense 다 — 기록분으로 나누면 합이 100% 를 넘는다.
//   (d) 는 데이터 축이다: 카테고리로 모은 합이 그 달 지출 총액과 같아야 한다(어느 행도 새지 않음).
{
  const dash = readFileSync('app/(app)/dashboard/page.tsx', 'utf8')
  const dashClient = readFileSync('app/(app)/dashboard/DashboardClient.tsx', 'utf8')
  if (!/if \(!isPastMonth\) \{\s*\n\s*for \(const r of recurringWithStatus\)/.test(dash)) {
    violations.push('[소스] 홈 지출 카테고리 예정분에 과거월 가드(isPastMonth)가 없다 — 지난달 도넛 합계가 예상 지출보다 커진다')
  }
  if (!/if \(r\.isPending \|\| r\.recordedExpenseId\) continue/.test(dash)) {
    violations.push('[소스] 홈 지출 카테고리 예정분의 모집단이 projectedRecurringExpense 와 다르다 — 도넛 합계와 예상 지출이 갈린다')
  }
  if (!/pendingByCategory\[r\.category\][\s\S]{0,80}effectiveRecurringAmount\(r\)/.test(dash)) {
    violations.push('[소스] 홈 지출 카테고리 예정분이 추정식 정본(effectiveRecurringAmount)을 안 쓴다')
  }
  if (!/percent: expectedExpense > 0 \? Math\.round\(\(c\.amount \/ expectedExpense\) \* 100\)/.test(dash)) {
    violations.push('[소스] 홈 지출 카테고리 퍼센트 분모가 예상 지출이 아니다 — 조각 비율 합이 100% 를 넘는다')
  }
  if (!/centerSub="예상 지출"/.test(dashClient) || !/centerLabel=\{`\$\{data\.expectedExpense/.test(dashClient)) {
    violations.push('[소스] 홈 지출 도넛 중앙이 예상 지출을 말하지 않는다 — 조각이 나눈 값과 가운데 글자가 갈린다')
  }
  // (e) 드릴다운 딥링크는 **두 화면이 맺은 계약**이다. 한쪽만 고치면 '전체 보기'가 필터 없이 착지해
  //     운영자가 카테고리를 다시 고르게 된다(그러면 조각을 눌러 온 뜻이 사라진다).
  const finPage = readFileSync('app/(app)/finance/page.tsx', 'utf8')
  if (!/cat\?: string/.test(finPage) || !/initialCategory=/.test(finPage)) {
    violations.push('[소스] 지출 관리가 ?cat= 을 안 받는다 — 홈 도넛 드릴다운의 전체 보기가 필터 없이 착지한다')
  }
  if (!/\/finance\?tab=expense&month=\$\{targetMonth\}&cat=\$\{encodeURIComponent/.test(dashClient)) {
    violations.push('[소스] 홈 도넛 드릴다운 링크가 지출 관리 계약(tab=expense&month&cat)과 어긋난다')
  }
  // (d) 데이터 — 카테고리 합 == 그 달 지출 총액. 카테고리가 빈 문자열·null 인 행이 생기면 여기서 갈린다.
  const nowKst = new Date(Date.now() + 9 * 3600 * 1000)
  for (const off of [0, -1]) {
    const d = new Date(Date.UTC(nowKst.getUTCFullYear(), nowKst.getUTCMonth() + off, 1))
    const y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1
    const gte = new Date(y, mo - 1, 1), lte = new Date(y, mo, 0)
    for (const prop of await prisma.property.findMany({ select: { id: true, name: true } })) {
      const [byCat, all] = await Promise.all([
        prisma.expense.groupBy({ by: ['category'], where: { propertyId: prop.id, date: { gte, lte } }, _sum: { amount: true } }),
        prisma.expense.aggregate({ where: { propertyId: prop.id, date: { gte, lte } }, _sum: { amount: true } }),
      ])
      const catSum = byCat.reduce((s, c) => s + (c._sum.amount ?? 0), 0)
      const total  = all._sum.amount ?? 0
      if (catSum !== total) {
        violations.push(`[데이터] ${prop.name} ${y}-${String(mo).padStart(2, '0')} 지출 카테고리 합 ${catSum.toLocaleString()}원 ≠ 총 지출 ${total.toLocaleString()}원 — 도넛에서 새는 행이 있다`)
      }
    }
  }
}

// 18-5. 홈 방 속성 세그먼트 = 이 달 청구액을 나눈 것 (2026-08-13, 운영자 승인).
//
//   카드는 이 달 청구액을 방의 속성(창·등급·층)으로 나눠 보여 준다. 나눈 조각의 합이 나누기 전
//   값과 다르면 그 카드는 없는 돈을 말하거나 있는 돈을 감춘다. 항등은 축마다 하나다:
//       Σ rows.amount === billedThisMonth
//   구조로 먼저 지킨다 — 세그먼트는 billedThisMonth 를 만든 **그 배열**(billedContributors)을
//   **그 함수**(billThisMonth)로 다시 훑는다. 여기서는 그 구조가 유지되는지를 본다.
{
  const dash = readFileSync('app/(app)/dashboard/page.tsx', 'utf8')

  // (a) 합계와 세그먼트가 같은 배열에서 나온다. 배열이 갈리면 항등은 그 순간 우연이 된다.
  if (!/const billedContributors = billableLeases\.filter\(l => !prevOwnerLeaseIds\.has\(l\.id\)\)/.test(dash)
      || !/const billedThisMonth = billedContributors\s*\n\s*\.reduce\(\(s, l\) => s \+ billThisMonth\(l\), 0\)/.test(dash)) {
    violations.push('[소스] 홈 billedThisMonth 가 billedContributors 배열에서 나오지 않는다 — 세그먼트가 다른 모집단을 나누게 된다')
  }
  if (!/for \(const l of billedContributors\) \{[\s\S]{0,240}?row\.amount \+= billThisMonth\(l\)/.test(dash)) {
    violations.push('[소스] 홈 방 속성 세그먼트가 billedContributors·billThisMonth 정본을 안 탄다 — 조각 합이 이 달 청구액과 갈린다')
  }
  // (b) 흡수 칸 — 방이 없는 계약이 떨어지면 항등이 조용히 깨진다.
  if (!/touch\(fields\.map\(f => \(\{ field: f, value: segmentValue\(l\.room, f\) \}\)\), !l\.room\)/.test(dash)) {
    violations.push('[소스] 홈 세그먼트에 방 미배정 흡수 칸이 없다 — 방 없는 청구 계약이 어느 칸에도 안 서서 조각 합이 모자란다')
  }
  // (c) 방 모집단은 방 목록 전체다. 집계 제외 방을 빼면 415호·사무실의 비거주 청구가
  //     '전체 0실 중 입실 1실' 이 된다(그 방들의 이용료는 billedThisMonth 안에 있다).
  if (!/for \(const r of roomsWithTenants\) \{\s*\n\s*touch\(fields\.map\(f => \(\{ field: f, value: segmentValue\(r, f\) \}\)\), false\)\.rooms \+= 1/.test(dash)) {
    violations.push('[소스] 홈 세그먼트의 방 모집단이 방 목록 전체가 아니다 — 계약이 사는 칸의 분모가 사라진다')
  }
  // (d) 비율 분모는 서버에 하나뿐이다. 화면이 나누면 축마다 다른 분모가 생긴다(수납률 전례).
  if (!/percent: billedThisMonth > 0 \? Math\.round\(\(r\.amount \/ billedThisMonth\) \* 100\)/.test(dash)) {
    violations.push('[소스] 홈 세그먼트 비율의 분모가 이 달 청구액이 아니다 — 조각 비율 합이 100% 를 벗어난다')
  }
  // (e) 데이터 — 청구 대상 계약의 방이 방 목록 안에 있어야 속성 칸을 얻는다. 밖에 있으면
  //     그 금액은 '전체 0실'인 칸에 서고 방 수 합도 전체 방 수와 어긋난다.
  const monthOfSeg = (d) => { if (!d) return null; const t = new Date(d); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}` }
  const kstSeg = new Date(Date.now() + 9 * 3600000)
  const segMonths = [-1, 0, 1].map(off => {
    const d = new Date(Date.UTC(kstSeg.getUTCFullYear(), kstSeg.getUTCMonth() + off, 1))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  })
  for (const prop of await prisma.property.findMany({ select: { id: true, name: true } })) {
    const [propRooms, segLeases] = await Promise.all([
      prisma.room.findMany({ where: { propertyId: prop.id }, select: { id: true, tier: true, floor: true, windowType: true } }),
      prisma.leaseTerm.findMany({
        where: { propertyId: prop.id, status: { in: ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'] }, rentAmount: { gt: 0 } },
        select: { id: true, roomId: true, moveInDate: true, expectedMoveOut: true, room: { select: { roomNo: true } }, tenant: { select: { name: true } } },
      }),
    ])
    const roomIds = new Set(propRooms.map(r => r.id))
    for (const mon of segMonths) {
      for (const l of segLeases) {
        const mi = monthOfSeg(l.moveInDate); if (mi && mi > mon) continue
        const mo = monthOfSeg(l.expectedMoveOut); if (mo && mo < mon) continue
        if (l.roomId && !roomIds.has(l.roomId)) {
          violations.push(`[데이터] ${prop.name} ${mon}: ${l.room?.roomNo ?? '-'}호 ${l.tenant.name} 의 방이 이 영업장 방 목록 밖이다 — 세그먼트에서 전체 0실인 칸에 금액만 선다`)
        }
      }
    }
    // 축마다 방 수 합이 전체 방 수여야 한다. null 속성 방을 떨어뜨리면 여기서 걸린다.
    for (const fields of [['window', 'tier'], ['tier'], ['window'], ['floor']]) {
      const by = new Map()
      for (const r of propRooms) {
        const k = fields.map(f => (f === 'window' ? r.windowType : f === 'tier' ? r.tier : r.floor) ?? ' ').join('')
        by.set(k, (by.get(k) ?? 0) + 1)
      }
      const sum = [...by.values()].reduce((a, b) => a + b, 0)
      if (sum !== propRooms.length) {
        violations.push(`[데이터] ${prop.name} 세그먼트 축 ${fields.join('-')}: 방 수 합 ${sum} 이 전체 방 ${propRooms.length} 과 다르다`)
      }
    }
  }
}

// 18-6. 홈 미수 에이징과 두 벌 미납 루프 (2026-08-13).
//
//   에이징은 발생주의 미납 루프의 **부산물**이다. 버킷은 귀속월 그대로이고 담는 것은 도래·미회수분뿐이라
//       Σ 버킷 금액 === overdueAmount (= 누적 미납)
//   가 정의상 성립한다. 성립을 깨는 길은 하나뿐이다 — 부산물이 그 분기 밖으로 나가는 것.
//
//   그리고 이 루프는 **두 벌**이다(dashboard/page.tsx · dashboard/unpaid.ts). 한쪽은 홈 화면이,
//   한쪽은 푸시 크론이 쓴다. 종전에는 둘을 잇는 그물이 하나도 없었고 잠금은 unpaid.ts 머리의
//   "한쪽을 고치면 양쪽을 함께" 라는 **주석 문장**뿐이었다. 주석은 그물이 아니다.
{
  const dash = readFileSync('app/(app)/dashboard/page.tsx', 'utf8')
  const unpaidSrc = readFileSync('app/(app)/dashboard/unpaid.ts', 'utf8')

  // (a) 부산물이 도래 분기 안에 있는가. 밖으로 나가면 미도래분까지 버킷에 담겨 항등이 깨진다.
  if (!/if \(days == null \|\| days >= 0\) \{ leaseOverdue \+= monthUnpaid; addAging\(agingOverdue, mon, l\.id, monthUnpaid\) \}/.test(dash)) {
    violations.push('[소스] 홈 미수 에이징이 도래 분기 밖으로 나갔다 — 버킷 합이 누적 미납과 갈린다')
  }
  // (b)(c) 두 벌 사본의 청구 가능 월 게이트와 FIFO 충당 규칙이 같은가. 주석·공백만 정규화해 글자로 대조한다.
  //   부산물 한 줄은 page 쪽에만 붙으므로 FIFO 는 **충당 네 줄과 도래 판정까지**만 자른다 —
  //   전문을 비교하면 그물이 늘 발화해 무시하게 되고, 안 자르면 게이트가 갈려도 안 걸린다.
  const normLoop = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').trim()
  const sliceLoop = (src, from, to) => {
    const a = src.indexOf(from)
    if (a < 0) return null
    const b = src.indexOf(to, a)
    return b < 0 ? null : src.slice(a, b + to.length)
  }
  const LOOP_BLOCKS = [
    ['청구 가능 월 게이트', 'const billableMonthList: string[] = []', 'billableMonthList.push(mon)',
      '홈 미수납 건수와 푸시 알림 건수가 어긋난다'],
    ['FIFO 충당 규칙', 'for (const mon of billableMonthList) {\n      const monthBill = billForMonth(mon)', 'const days = daysOverdueForMonth(l, mon)',
      '같은 사람의 미납액이 화면과 알림에서 달라진다'],
  ]
  for (const [name, from, to, harm] of LOOP_BLOCKS) {
    const a = sliceLoop(dash, from, to)
    const b = sliceLoop(unpaidSrc, from, to)
    if (!a || !b) {
      violations.push(`[소스] 미납 루프의 ${name} 블록을 두 파일에서 찾지 못했다 — 대조 그물이 무력해졌다`)
    } else if (normLoop(a) !== normLoop(b)) {
      violations.push(`[소스] dashboard/page.tsx 와 dashboard/unpaid.ts 의 ${name} 이 갈렸다 — ${harm}`)
    }
  }
  // (d) 표시용 부산물은 홈에만 둔다. unpaid.ts 는 푸시 전용이라 소비처가 없어 죽은 코드가 된다.
  if (/agingOverdue/.test(unpaidSrc)) {
    violations.push('[소스] unpaid.ts 에 에이징 부산물이 들어갔다 — 소비처가 없는 죽은 코드다(표시는 page.tsx 몫)')
  }
}

// 18-7. 홈 수납 현황 카드의 금액 3항과 예약 확정 줄 (2026-08-13, 운영자 지시 + 회계 패널).
//
//   건수 옆에 금액을 병기한다. 금액 축은 **그 달 청구액**이고 항등은
//       완납 + 수납예정 + 미납 === billedThisMonth
//   다. 실수납 축을 쓰지 않는 이유 — '완납'은 누적 축 판정이라 그 달 귀속 수납이 그 달 청구보다
//   적은 완납 계약이 정상적으로 존재한다(2026-04 3건 사건의 정체). 완납 줄 옆에 청구보다 작은
//   수납액이 서면 카드가 자기 분류를 반박한다.
{
  const dash = readFileSync('app/(app)/dashboard/page.tsx', 'utf8')
  const dashClient = readFileSync('app/(app)/dashboard/DashboardClient.tsx', 'utf8')
  const leaseStatusSrc3 = readFileSync('lib/leaseStatus.ts', 'utf8')

  // (a) 완납 금액은 **나머지**다 — 건수를 모집단 빼기로 구하는 것과 같은 이유.
  if (!/const paidBilled = billedThisMonth - unpaidBilled - awaitingBilled/.test(dash)) {
    violations.push('[소스] 홈 완납 금액이 나머지로 나오지 않는다 — 세 항의 합이 이 달 청구액과 갈린다')
  }
  // (b) 계약별 금액은 billedThisMonth 를 만든 그 배열에서 길어 온다. 모집단(paymentPool)을 직접
  //     훑으면 퇴실월이 지난 계약·양도인 계약이 섞여 합이 어긋난다.
  if (!/const billedByLease = new Map\(billedContributors\.map\(l => \[l\.id, billThisMonth\(l\)\]\)\)/.test(dash)) {
    violations.push('[소스] 홈 수납 현황 금액이 billedContributors 에서 나오지 않는다 — 모집단이 달라 합이 이 달 청구액과 갈린다')
  }
  // (c) 예약 확정은 배타 3분류 밖이다. 도넛 조각에 들어가면 현 입주자 모집단이 아닌 값이 수납률 분모를 흔든다.
  if (/const paymentSegments = \[[\s\S]{0,300}?reserved/.test(dashClient)) {
    violations.push('[소스] 홈 수납 현황 도넛 조각에 예약 확정이 들어갔다 — 수납률 분모가 현 입주자 모집단을 벗어난다')
  }
  // (d) 건수와 금액이 같은 게이트에서 나온다. 화면이 RESERVED 를 따로 세면 둘 중 하나가 거짓이 된다.
  if (!/amount: billable\.reduce\(\(s, l\) => s \+ billForLeaseMonth\(l, targetMonth, null\), 0\),\s*\n\s*count:  billable\.length,/.test(leaseStatusSrc3)) {
    violations.push('[소스] 예약 확정 금액과 건수가 같은 필터에서 나오지 않는다 — 다음 달 입주 예정자가 건수에만 선다')
  }
  if (!/reservedCount: reservedBreakdown\.count/.test(dash)) {
    violations.push('[소스] 홈 예약 확정 건수가 금액과 같은 정본에서 나오지 않는다')
  }
  // (e) 데이터 — 청구 대상 계약이 전부 미납 루프 모집단에 들어야 완납 금액(나머지)이 참이 된다.
  //     안 드는 계약이 있으면 그 청구액이 조용히 완납 금액으로 흘러든다.
  const monthOfPool = (d) => { if (!d) return null; const t = new Date(d); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}` }
  const kstPool = new Date(Date.now() + 9 * 3600000)
  const poolMonths = [-1, 0, 1].map(off => {
    const d = new Date(Date.UTC(kstPool.getUTCFullYear(), kstPool.getUTCMonth() + off, 1))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  })
  for (const prop of await prisma.property.findMany({ select: { id: true, name: true, acquisitionDate: true, prevOwnerCutoffDate: true } })) {
    const acqP = prop.prevOwnerCutoffDate ?? prop.acquisitionDate ?? null
    const cutMonth = acqP ? `${new Date(acqP).getFullYear()}-${String(new Date(acqP).getMonth() + 1).padStart(2, '0')}` : null
    const poolLeases = await prisma.leaseTerm.findMany({
      where: { propertyId: prop.id, status: { in: ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'] }, rentAmount: { gt: 0 } },
      select: { id: true, moveInDate: true, expectedMoveOut: true, room: { select: { roomNo: true } }, tenant: { select: { name: true } } },
    })
    for (const mon of poolMonths) {
      for (const l of poolLeases) {
        const mi = monthOfPool(l.moveInDate); if (mi && mi > mon) continue          // billableLeases 게이트
        const mo = monthOfPool(l.expectedMoveOut); if (mo && mo < mon) continue
        // 미납 루프 모집단 게이트 — firstMonth = max(입주월, 인수월) 이 조회월보다 뒤면 셋 중 어디에도 안 선다.
        const startMonth = mi ?? cutMonth ?? mon
        const firstMonth = cutMonth && startMonth < cutMonth ? cutMonth : startMonth
        if (firstMonth > mon) {
          violations.push(`[데이터] ${prop.name} ${mon}: ${l.room?.roomNo ?? '-'}호 ${l.tenant.name} 이 청구 대상인데 수납 현황 모집단 밖이다 — 그 청구액이 완납 금액으로 흘러든다`)
        }
      }
    }
  }
}

// 18-8. 홈 추이 게이지 적층 (2026-08-13, 운영자 지시 + 회계 패널).
//
//   막대는 게이지가 된다 — 진한 채움이 실적이고 그 위 옅은 층이 아직 안 들어온/안 나간 몫이다.
//   층 두께는 KPI 카드가 이미 쓰는 두 값과 원 단위로 같아야 한다:
//       수입 옅은 층 === pendingRevenue ('이 달 미수납')
//       지출 옅은 층 === expectedExpense − totalExpense ('고정 지출 (예정)')
//
//   적층은 **조회월 막대 하나**에만 얹는다. projectedRevenue·expectedExpense 는 조회월 하나를
//   위해 정의된 값이라, 과거 달에 다시 계산하면 '오늘의 계약 로스터로 그 달을 다시 청구해 본 값'
//   이 나온다 — 그 달에 존재한 적 없는 숫자다. 미래월은 두 축 모두 안 얹는다(발생하지 않은 수익).
{
  const dashClient = readFileSync('app/(app)/dashboard/DashboardClient.tsx', 'utf8')
  const trendChart = readFileSync('app/(app)/dashboard/TrendChart.tsx', 'utf8')

  // (a) 층 두께가 KPI 정본 두 값에서 나온다. 화면이 자기 식을 조립하면 같은 이름이 다른 값이 된다.
  if (!/revenuePending: isTargetBar \? Math\.max\(0, man\(t\.revenue \+ data\.pendingRevenue\) - revenue\) : 0/.test(dashClient)) {
    violations.push('[소스] 추이 수입 옅은 층이 pendingRevenue 정본에서 나오지 않는다 — 게이지가 카드와 다른 미수납을 그린다')
  }
  if (!/expensePending: isTargetBar \? Math\.max\(0, man\(t\.expense \+ \(data\.expectedExpense - data\.totalExpense\)\) - expense\) : 0/.test(dashClient)) {
    violations.push('[소스] 추이 지출 옅은 층이 고정 지출 (예정) 정본에서 나오지 않는다')
  }
  // (b) 적층 대상은 조회월 막대 하나. 두 범위(반년·월간)는 목록이 조회월로 끝나므로 마지막 점이다.
  if (!/const stackMonthBar = \(trendRange === 'biannual' \|\| trendRange === 'monthly'\) && !data\.isFutureMonth/.test(dashClient)) {
    violations.push('[소스] 추이 적층이 조회월 막대 하나로 좁혀져 있지 않거나 미래월 가드를 잃었다 — 정의되지 않은 과거 예상액을 그린다')
  }
  if (!/const isTargetBar = stackMonthBar && i === trendPoints\.length - 1/.test(dashClient)) {
    violations.push('[소스] 추이 적층 대상 막대가 조회월(마지막 점)이 아니다')
  }
  // (c) 옅은 층 색은 도넛 예정 틴트와 **같은 문법**이다(같은 hue 70%). 새 색을 만들면
  //     이 화면에서 '옅다'가 자리마다 다른 뜻이 된다.
  if (!/const pendingTint = \(color\) => `color-mix\(in srgb, \$\{color\} 70%, transparent\)`/.test(trendChart.replace(/: string/g, ''))) {
    violations.push('[소스] 추이 옅은 층이 도넛 예정 틴트와 다른 문법으로 만들어진다 — 같은 뜻에 두 시각 어휘가 생긴다')
  }
  // (d) 시리즈 색은 §19 페어 한 쌍뿐이다(축 눈금 글자색은 별개 축이라 보지 않는다).
  //     --coral 은 다크에서 안 밝아져 크림 카드 위 2.78:1 이고 그 70% 층은 1.97:1 이다.
  //     지출은 범례가 --ink-m(#93816F)·막대가 --neutral-fg(#C7B5A2)라 같은 시리즈가 두 색이었다.
  if (!/const REV = 'var\(--tc-text\)'/.test(trendChart) || !/const EXP = 'var\(--ink-s\)'/.test(trendChart)) {
    violations.push('[소스] 추이 시리즈 색이 §19 페어(--tc-text·--ink-s)가 아니다 — 다크에서 대비가 무너진다')
  }
  for (const bad of [/(fill|stroke|stopColor)=\{?["']?var\(--coral\)/, /(fill|stroke|stopColor)=\{?["']?var\(--neutral-fg\)/, /(fill|stroke)=\{?["']?var\(--ink-m\)/]) {
    if (bad.test(trendChart)) {
      violations.push('[소스] 추이 시리즈 채움·선이 §19 페어를 벗어났다 — 범례 스와치와 막대 색이 다크에서 갈린다')
    }
  }
  // 범례 스와치도 같은 토큰이어야 한다 — 한 곳만 고치면 스와치와 막대가 다른 색이 된다.
  if (!/TrendLegendChip color="var\(--tc-text\)"/.test(dashClient) || !/TrendLegendChip color="var\(--ink-s\)"/.test(dashClient)) {
    violations.push('[소스] 추이 범례 스와치가 막대 시리즈 색과 갈렸다')
  }
  // (e) 라운드는 그 달 최상단 층에만. 두 층 모두에 주면 사이에 초승달 빈틈이 생겨 세 번째 층처럼 읽힌다.
  if (!/\(d\.revenuePending \?\? 0\) > 0 \? 0 :/.test(trendChart) || !/\(d\.expensePending \?\? 0\) > 0 \? 0 :/.test(trendChart)) {
    violations.push('[소스] 추이 적층 막대의 라운드가 최상단 층 판정을 잃었다 — 두 층 사이에 빈틈이 생긴다')
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

// 20. 현금영수증·카드 합계의 **축 한정어는 상시 텍스트여야 한다** (오류신고 8b9b6c43, 2026-08-24).
//
//   신고 원문 "현금영수증 합계금액이 안맞아. 직접 계산해보면 764만원인데 상단 합계는717만원이야".
//   계산은 정확했다. 상단은 payDate(입금일) 축 7,170,000 이고 운영자가 목록을 손으로 더한 값은
//   targetMonth(귀속월) 축 7,640,000 이다. 차액 470,000 은 7/31 에 받은 8월분 한 건이 전부였다.
//   축 설명이 InfoHint(접힌 물음표) 안에만 있어서 화면이 그 차이를 말하지 않은 것이 결함이었다.
//
//   **파일 전체 includes 는 그물이 못 된다.** 같은 낱말이 InfoHint 본문에도 있어서, 한정어가 다시
//   InfoHint 안으로 되숨는 바로 그 회귀에서 통과해 버린다(위 7번 주석이 적은 '반쪽 감지망' 전례와
//   같은 함정이다). 그래서 '<InfoHint 앞' 상시 텍스트 조각만 잘라서 본다.
{
  const AXIS = '입금일 기준'
  // 상시 텍스트 조각 — 조건식부터 InfoHint 가 열리기 직전까지. JSX 주석은 화면에 안 뜨므로 걷어낸다.
  const strip = roomsClient.match(/payAggregates\.cashReceiptSum !== 0[\s\S]*?<InfoHint/)
  if (!strip) {
    violations.push('[소스] RoomsClient 현금영수증·카드 합계 줄을 못 찾았다 — 대조가 통째로 건너뛰어졌다. 감지망을 고칠 것')
  } else {
    const visible = strip[0].replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    if (!visible.includes(AXIS)) {
      violations.push(`[소스] RoomsClient 현금영수증·카드 합계에 축 한정어('${AXIS}')가 상시 텍스트로 없다 — InfoHint 안으로 되숨으면 목록을 귀속월로 손수 더한 값과 달라 보이는 신고가 재발한다`)
    }
    if (/납부일/.test(visible)) {
      violations.push("[소스] RoomsClient 축 한정어가 '납부일' 로 되돌아갔다 — 이 화면의 '납부일' 은 LeaseTerm.dueDay(약정 지급일)라 반대 축(귀속월)의 앵커다. 정본은 '입금일'")
    }
  }
  // 상시 한정어와 InfoHint 본문은 짝이다. 한쪽만 남으면 반쪽이라 각각 본다.
  const hint = roomsClient.match(/<InfoHint title="현금영수증·카드 합계">[\s\S]*?<\/InfoHint>/)
  if (!hint) {
    violations.push('[소스] RoomsClient 현금영수증·카드 합계 InfoHint 를 못 찾았다 — 대조가 건너뛰어졌다. 감지망을 고칠 것')
  } else {
    if (/납부일/.test(hint[0])) {
      violations.push("[소스] 현금영수증·카드 InfoHint 가 축을 '납부일' 로 부른다 — 같은 화면에서 한 숫자가 두 축 이름을 갖는다")
    }
    // 문구는 다듬어도 되지만 이 세 축은 설명이 살아 있다는 앵커다.
    for (const [needle, why] of [
      ['귀속월', '귀속월 축과 다를 수 있다는 설명이 사라졌다 — 손수 더한 값과의 차이를 아무도 설명하지 않는다'],
      ['지난달', '월말 선납이 지난달 합계에 잡힌다는 설명이 사라졌다 — 이번 신고의 실제 원인(7/31 수납 470,000)이 다시 미설명이 된다'],
      ['매출전표', '카드와 현금영수증이 겹치지 않는다는 설명이 사라졌다 — 두 값이 이중 계상으로 읽힌다(520호 172,000원 전례)'],
    ]) {
      if (!hint[0].includes(needle)) violations.push(`[소스] 현금영수증·카드 InfoHint: ${why}`)
    }
  }
  // 캡션이 '입금일'이라 말하려면 서버가 실제로 payDate 축이어야 한다. 축이 바뀌면 캡션이 거짓이 된다.
  const roomsActions = readFileSync('app/(app)/rooms/actions.ts', 'utf8')
  const aggFn = roomsActions.match(/export async function getMonthPaymentAggregates[\s\S]*?\n}/)
  if (!aggFn) {
    violations.push('[소스] getMonthPaymentAggregates 를 못 찾았다 — 캡션이 말하는 축을 대조할 수 없다. 감지망을 고칠 것')
  } else if (!/payDate:\s*\{\s*gte:/.test(aggFn[0])) {
    violations.push('[소스] getMonthPaymentAggregates 가 payDate 창으로 안 센다 — 화면 캡션의 \'입금일 기준\' 이 거짓이 된다')
  }
}


// 21. 보증금 수납 경로 (2026-08-24, 신고 98fb6fce·00c39371·9e6c7cb3).
//
//   8/23 514호에서 보증금 5만이 일반 수납으로 들어가 이용료 record 가 됐고, 우회로였던 '받음 기록'
//   경로가 결제일 '오늘'과 결제수단 '기타'를 박았다. 세 축을 함께 본다 — 호출부가 날짜를 넘기는가,
//   역할 경계가 살아 있는가, 그 지문을 가진 record 가 늘어나는가.
{
  // (a) 소스 — recordDepositReceived 호출부가 payDate 를 넘기는가.
  //     거리로 근사하지 않고 괄호 깊이로 호출 인자 블록을 잘라 그 안만 본다.
  const CALLERS = ['app/(app)/tenants/actions.ts', 'app/(app)/rooms/DepositSection.tsx']
  const sliceCallArgs = (src, fnName) => {
    const out = []
    let i = 0
    for (;;) {
      const at = src.indexOf(`${fnName}(`, i)
      if (at < 0) break
      let d = 0, j = at + fnName.length
      for (; j < src.length; j++) {
        if (src[j] === '(') d++
        else if (src[j] === ')') { d--; if (d === 0) { j++; break } }
      }
      out.push(src.slice(at, j))
      i = j
    }
    return out
  }
  let calls = 0
  for (const f of CALLERS) {
    const src = readFileSync(f, 'utf8')
    for (const args of sliceCallArgs(src, 'recordDepositReceived')) {
      calls += 1
      if (!/payDate\s*:/.test(args)) {
        violations.push(`[소스] ${f} 의 recordDepositReceived 호출이 payDate 를 안 넘긴다 — 앱이 버튼 누른 날을 입금일로 박는다(514호 사고 경로)`)
      }
    }
  }
  // 못 읽으면 통과가 아니라 위반이다. 아무것도 안 보고 지나가는 그물이 가장 나쁘다.
  if (calls < 3) violations.push(`[소스] recordDepositReceived 호출부를 ${calls}곳만 찾았다(3곳이어야 한다) — 그물이 대상을 놓쳤다`)

  // (b) 소스 — 두 함수의 역할 경계. 사라지면 실입금이 다시 가드 없는 소급 경로로 샌다.
  if (!roomsActions.includes('소급 기록 전용')) {
    violations.push('[소스] recordDepositReceived 의 역할 경계 주석(소급 기록 전용)이 사라짐 — 가드 없는 경로로 실입금이 샌다')
  }
  if (!roomsActions.includes('export async function saveDepositPaymentForLease')) {
    violations.push('[소스] 계약 단위 보증금 진입로(saveDepositPaymentForLease)가 사라짐 — 미수납 자리에 수납 CTA 가 없어진다')
  }

  // (c) 소스 — 화면이 보증금 잔여를 서버 정본에서 읽는가. 계약액으로 대신 세면 부분수납·청소비
  //     포함형 계약에서 화면과 저장이 갈린다(서버는 depositComposition().shortfall 기준).
  const panelSrc = readFileSync('components/entity-modal/widgets/DepositStatusPanel.tsx', 'utf8')
  if (!entryForm.includes('getDepositCompositionForLease')) {
    violations.push('[소스] PaymentEntryForm 이 보증금 잔여를 서버 정본에서 안 읽는다 — 화면이 자기 숫자를 만든다')
  }
  if (!entryForm.includes('proposeDepositEntrySplit')) {
    violations.push('[소스] PaymentEntryForm 이 분해 제안 정본(proposeDepositEntrySplit)을 안 쓴다 — 제안 산식이 화면마다 갈린다')
  }
  // 이름만 보면 안 된다. 선언과 **저장 버튼 결선**을 함께 본다 — 변수만 남고 버튼에서 빠지면
  // 그물은 통과하는데 화면은 합이 안 맞아도 저장된다.
  if (!/const splitBlocked\s*=/.test(entryForm) || !/disabled=\{[^}]*splitBlocked\}/.test(entryForm)) {
    violations.push('[소스] 분해 폼의 합 불일치 저장 차단이 없다(선언 또는 저장 버튼 결선) — 앱이 말없이 보정하면 안 된다(운영자 오더 2026-08-24)')
  }
  // 제출 경로에도 같은 차단이 걸려 있어야 한다. 버튼만 막으면 엔터 제출로 새어 나간다.
  if (!entryForm.includes('if (splitBlocked) return')) {
    violations.push('[소스] 분해 폼 제출 경로에 합 불일치 차단이 없다 — 버튼만 막으면 엔터 제출로 샌다')
  }
  if (!panelSrc.includes('saveDepositPaymentForLease')) {
    violations.push('[소스] 보증금 패널이 실입금 정본 경로를 안 탄다 — 가드 없는 소급 경로로 되돌아갔다')
  }
  // 승계 계약에 수납 CTA 가 서면 안 된다. carriedOver 로 거르면 '일부를 받은 승계'가 새어 나간다.
  if (!panelSrc.includes('!data.preAcquisition')) {
    violations.push('[소스] 보증금 수납 CTA 가 인수 승계 계약을 안 거른다 — 승계 보증금에 record 를 만들면 퇴실 정산 기준액이 바뀐다')
  }
}

// 20-2. 데이터 — 앱이 날짜와 수단을 묻지 않고 박은 지문. 존량은 운영자 정정 대기라 기준선 래칫이다.
//   memo 는 recordDepositReceived 만 쓰는 문자열이라 경로 식별자로 쓴다.
const AUTO_STAMP_BASELINE = 6   // 2026-08-24 실측. 정정이 끝나면 0 으로 내린다.
{
  const suspects = await prisma.paymentRecord.findMany({
    where: { deletedAt: null, isDeposit: true, payMethod: '기타', memo: { contains: '받음 기록' } },
    select: {
      payDate: true, createdAt: true, actualAmount: true,
      leaseTerm: { select: { room: { select: { roomNo: true } } } },
    },
  })
  // 결제일이 만든 날과 같으면 '오늘'이 그대로 박힌 것이다. payDate 는 @db.Date(UTC 자정),
  // createdAt 은 시각이라 KST 로 맞춰 비교한다.
  const kstDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  const hits = suspects.filter(r => r.payDate.toISOString().slice(0, 10) === kstDay(r.createdAt))
  if (hits.length > AUTO_STAMP_BASELINE) {
    for (const r of hits) {
      violations.push(`[데이터] ${r.leaseTerm?.room?.roomNo ?? '-'}호 ${r.payDate.toISOString().slice(0, 10)} ${r.actualAmount.toLocaleString()}원 — 결제일이 만든 날과 같고 수단이 '기타'다(앱이 묻지 않고 박은 흔적). 기준선 ${AUTO_STAMP_BASELINE}건 초과`)
    }
  }
}

// 20-3. 데이터 — 인수 전 입주 계약에 보증금 record 가 늘었는가.
//   정본: 승계 보증금에 수납 record 를 만들지 않는다(없는 입금을 만들면 증빙 없는 기록이 되고,
//   코드가 승계를 인식하는 근거도 꺼진다). 존량은 기준선으로 두고 증가만 위반으로 센다.
const PREACQ_WITH_RECORD_BASELINE = 3   // 2026-08-24 실측(405·418·519호)
{
  let preHits = []
  for (const prop of await prisma.property.findMany({ select: { id: true, name: true, acquisitionDate: true, prevOwnerCutoffDate: true } })) {
    const cutoff = prop.prevOwnerCutoffDate ?? prop.acquisitionDate ?? null
    if (!cutoff) continue
    const rows = await prisma.leaseTerm.findMany({
      where: { propertyId: prop.id, moveInDate: { lt: cutoff } },
      select: { room: { select: { roomNo: true } }, paymentRecords: { where: { isDeposit: true, deletedAt: null }, select: { id: true } } },
    })
    preHits = preHits.concat(rows.filter(l => l.paymentRecords.length > 0).map(l => `${prop.name} ${l.room?.roomNo ?? '-'}호`))
  }
  if (preHits.length > PREACQ_WITH_RECORD_BASELINE) {
    violations.push(`[데이터] 인수 전 입주 계약에 보증금 수납 record 가 ${preHits.length}건(기준선 ${PREACQ_WITH_RECORD_BASELINE}) — 승계 보증금에 없는 입금을 만들면 퇴실 정산 기준액이 계약액에서 실수납액으로 바뀐다. ${preHits.join(' · ')}`)
  }
}

// 20-4. 나열 — 보증금 미기록 의심(위반 아님). 진짜 미수납인지 무보증 합의인지는 운영자만 안다.
//   게이트로 걸면 사람이 값을 넣기 전까지 배포가 막힌다. 그래서 세지 않고 보여만 준다.
{
  const rows = []
  let examined = 0
  for (const prop of await prisma.property.findMany({ select: { id: true, name: true, cleaningFeeInDeposit: true, acquisitionDate: true, prevOwnerCutoffDate: true } })) {
    const cutoff = prop.prevOwnerCutoffDate ?? prop.acquisitionDate ?? null
    const ls = await prisma.leaseTerm.findMany({
      where: { propertyId: prop.id, status: { in: ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'] }, depositAmount: { gt: 0 } },
      select: {
        depositAmount: true, moveInDate: true,
        room: { select: { roomNo: true } },
        paymentRecords: { where: { isDeposit: true, deletedAt: null }, select: { actualAmount: true } },
        extraIncomes: { where: { ...CLEANING_RECEIVED_WHERE, deletedAt: null }, select: { amount: true } },
        depositRefunds: { select: { id: true } },
      },
    })
    examined += ls.length
    for (const l of ls) {
      // 인수 전 입주는 record 가 없는 것이 정상이다. 정산이 끝난 계약도 대상이 아니다.
      if (cutoff && l.moveInDate && new Date(l.moveInDate) < new Date(cutoff)) continue
      if (l.depositRefunds.length > 0) continue
      const depositPaid = l.paymentRecords.reduce((s, r) => s + r.actualAmount, 0)
      const cleaningPaid = l.extraIncomes.reduce((s, r) => s + r.amount, 0)
      const credit = prop.cleaningFeeInDeposit ? Math.min(l.depositAmount, cleaningPaid) : 0
      const raw = Math.max(0, l.depositAmount - depositPaid)
      const shortfall = Math.max(0, raw - Math.min(raw, credit))
      if (shortfall <= 0) continue
      rows.push(`  ${l.room?.roomNo ?? '-'}호 계약 ${l.depositAmount.toLocaleString()}원 · 실수납 ${depositPaid.toLocaleString()}원`
        + (credit > 0 ? ` · 청소비 몫 ${credit.toLocaleString()}원` : '')
        + ` · 부족 ${shortfall.toLocaleString()}원`)
    }
  }
  console.log(`\n[보증금 미기록 의심] 검사 ${examined}건 중 ${rows.length}건 (위반 아님 — 운영자 확인 대기)`)
  for (const r of rows) console.log(r)
}

console.log(`\n[돈 정합] 위반 ${violations.length}건`)
for (const v of violations) console.log('  - ' + v)
console.log(`검사 lease ${leases.length}건`)
await prisma.$disconnect()
if (violations.length > 0) process.exit(1)
