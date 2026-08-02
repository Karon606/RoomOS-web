// 돈 표시·수납 정합 상시 감지 — 읽기 전용, 위반 시 exit 1 (크리티컬 신고 50a2a69b 재발 감지망).
// 소스 가드: 표시 정본(billForLeaseMonth·discountedRent) 이탈 패턴이 코드에 되살아나는지.
// 데이터 대조: 보증금 중복 수납, 할인 미반영 락(되쓰기 누락 의심)을 SELECT 로 탐지.
import { readFileSync } from 'fs'
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

console.log(`\n[돈 정합] 위반 ${violations.length}건`)
for (const v of violations) console.log('  - ' + v)
console.log(`검사 lease ${leases.length}건`)
await prisma.$disconnect()
if (violations.length > 0) process.exit(1)
