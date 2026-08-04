// 돈 표시·수납 정합 상시 감지 — 읽기 전용, 위반 시 exit 1 (크리티컬 신고 50a2a69b 재발 감지망).
// 소스 가드: 표시 정본(billForLeaseMonth·discountedRent) 이탈 패턴이 코드에 되살아나는지.
// 데이터 대조: 보증금 중복 수납, 할인 미반영 락(되쓰기 누락 의심)을 SELECT 로 탐지.
import { readFileSync, readdirSync } from 'fs'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
const violations = []

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
if (!roomsActions.includes('export async function rewriteLockedExpectedForRentSchedule')) {
  violations.push('[소스] rooms/actions 의 인상 예약 락 되쓰기(rewriteLockedExpectedForRentSchedule)가 사라짐 — 선납된 달의 인상분이 미청구로 남는다')
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
    where: { leaseTermId: l.id, category: '청소비' }, _sum: { amount: true },
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
// 소스 가드 — 퇴실 폼이 입실 수납 이력을 안 보면 같은 사고가 재발한다
for (const f of ['app/(app)/tenants/TenantClient.tsx', 'components/entity-modal/widgets/TenantStatusTransitions.tsx']) {
  if (!readFileSync(f, 'utf8').includes('getCleaningFeeReceivedForLease')) {
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

// 등록 로그는 전이가 아니다. leaseTermId 를 안 채우면 계약 단위 조회에서 사라지고,
// fromStatus 를 지어내면 전이표 검증에 유령 데이터가 섞인다(실제로 44건이 그랬다).
const orphanLogs = await prisma.tenantStatusLog.count({ where: { leaseTermId: null } })
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
// 실제로 발생한 전이를 전이표가 막으면 안 된다 — 쓰이는 흐름은 뜻이 성립하는 것이다
const { canTransition } = await import('../lib/leaseTransitions.ts')
const logs = await prisma.tenantStatusLog.findMany({ select: { fromStatus: true, toStatus: true } })
const blockedKinds = new Set()
for (const l of logs) if (!canTransition(l.fromStatus, l.toStatus)) blockedKinds.add(`${l.fromStatus}->${l.toStatus}`)
for (const k of blockedKinds) violations.push(`[데이터] 실제로 쓰인 전이 ${k} 를 전이표가 막는다 — 운영 흐름이 끊긴다`)

console.log(`\n[돈 정합] 위반 ${violations.length}건`)
for (const v of violations) console.log('  - ' + v)
console.log(`검사 lease ${leases.length}건`)
await prisma.$disconnect()
if (violations.length > 0) process.exit(1)
