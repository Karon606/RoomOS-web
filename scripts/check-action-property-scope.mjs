// 서버 액션이 화면에서 온 id 를 영업장 범위로만 읽고 쓰는지 지키는 정적 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가. updateTenant·updateExpense 가 입주자·계약·지출을 id 만으로 읽고 써서, 다른 영업장 id 를
// 넣으면 그 행이 바뀌었다(78bb0141 후속 B7, 운영자 승인 2026-10-13). 고친 뒤 누가 findUnique({ where: { id } })
// 로 되돌려도 아무 그물도 안 울었다(독립 검수 2026-10-13). 같은 클래스 43곳은 별건 감사 대상이고
// (stayeum development/오류신고-정비/권한-영업장범위-감사.md), 봉합하는 함수마다 여기에 축을 더한다.
//
// 실행: node scripts/check-action-property-scope.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const violations = []

/** export async function 이름( 부터 다음 export 직전까지. 못 찾으면 null. */
function bodyOf(src, name) {
  const start = src.indexOf(`export async function ${name}(`)
  if (start < 0) return null
  const next = src.indexOf('\nexport ', start + 1)
  return src.slice(start, next < 0 ? undefined : next)
}

const AXES = [
  // 납입일 영구 변경과 그 적용취소, 조정 행 전용 수정 문(신고 df82ce57 독립 검수 2026-10-20).
  {
    file: 'app/(app)/tenants/actions.ts',
    fn: 'changeDueDay',
    must: [[/leaseTerm\.findFirst\(\{\s*where:\s*\{\s*id:\s*leaseTermId,\s*propertyId\s*\}/, '계약을 영업장 범위로 읽지 않는다']],
    mustNot: [[/leaseTerm\.findUnique\(\{\s*where:\s*\{\s*id:\s*leaseTermId\s*\}/, '계약을 id 만으로 읽는다']],
  },
  {
    file: 'app/(app)/tenants/actions.ts',
    fn: 'undoChangeDueDay',
    must: [
      [/verifyUndoBody\(DUE_DAY_CHANGE_UNDO_DOMAIN, propertyId,/, '적용취소 토큰 서명을 대조하지 않는다'],
      [/paymentRecord\.findFirst\(\{\s*where:\s*\{\s*id:\s*u\.adjustRecordId,\s*leaseTermId:\s*u\.leaseTermId,\s*propertyId,\s*\.\.\.dueDayAdjustWhere\(\)/, '지울 조정 행을 계약·영업장·조정 행 범위로 찾지 않는다'],
    ],
    mustNot: [[/paymentRecord\.deleteMany\(/, '조정 행을 하드 삭제한다']],
  },
  {
    file: 'app/(app)/rooms/actions.ts',
    fn: 'updateDueDayAdjust',
    must: [[/paymentRecord\.findFirst\(\{\s*where:\s*\{\s*id:\s*paymentId,\s*propertyId\s*\}/, '조정 행을 영업장 범위로 읽지 않는다']],
    mustNot: [],
  },
  {
    file: 'app/(app)/tenants/actions.ts',
    fn: 'updateTenant',
    must: [
      [/leaseTerm\.findFirst\(\{\s*where:\s*\{\s*id:\s*leaseTermId,\s*propertyId,\s*tenantId\s*\}/, '계약을 영업장·입주자 범위로 먼저 읽지 않는다'],
      [/tenant\.findFirst\(\{\s*where:\s*\{\s*id:\s*tenantId,\s*propertyId\s*\}/, '입주자를 영업장 범위로 확인하지 않는다'],
      [/room\.findFirst\(\{\s*where:\s*\{\s*id:\s*newRoomId,\s*propertyId\s*\}/, '새로 고른 호실이 이 영업장 것인지 보지 않는다'],
    ],
    mustNot: [
      [/leaseTerm\.findUnique\(\{\s*where:\s*\{\s*id:\s*leaseTermId\s*\}/, '계약을 id 만으로 읽는다'],
      [/tenant\.findUnique\(\{\s*where:\s*\{\s*id:\s*tenantId\s*\}/, '입주자를 id 만으로 읽는다'],
    ],
  },
  {
    file: 'app/(app)/finance/actions.ts',
    fn: 'updateExpense',
    must: [
      [/expense\.findFirst\(\{\s*where:\s*\{\s*id,\s*propertyId\s*\}/, '지출을 영업장 범위로 먼저 읽지 않는다'],
      [/room\.count\(\{\s*where:\s*\{\s*id:\s*\{\s*in:\s*formRoomIds\s*\},\s*propertyId\s*\}/, '폼의 호실·방별 분배 id 를 영업장 범위로 보지 않는다'],
      [/financialAccount\.findFirst\(\{\s*where:\s*\{\s*id:\s*financialAccountId,\s*propertyId\s*\}/, '결제 계정을 영업장 범위로 보지 않는다'],
    ],
    mustNot: [
      [/expense\.findUnique\(\{\s*where:\s*\{\s*id\s*\}/, '지출을 id 만으로 읽는다'],
    ],
  },
  // 비품의 배정 예정 호실(targetRoomId)은 FK 없는 text 칸이다(2026-10-15 S4). 등록·수정 둘 다 폼의 호실 칸 셋
  // (대상 호실·방별 분배·배정할 호실)을 영업장 방으로 본다. 등록은 종전에 이 관문이 아예 없었다.
  {
    file: 'app/(app)/finance/actions.ts',
    fn: 'addExpense',
    must: [
      [/formRoomIds\s*=\s*\[\.\.\.new Set\(\[roomId,\s*formTarget,/, "폼의 '배정할 호실'을 영업장 검증 목록에 넣지 않는다"],
      [/room\.count\(\{\s*where:\s*\{\s*id:\s*\{\s*in:\s*formRoomIds\s*\},\s*propertyId\s*\}/, '폼의 호실·방별 분배·배정할 호실 id 를 영업장 범위로 보지 않는다'],
    ],
    mustNot: [],
  },
  {
    file: 'app/(app)/finance/actions.ts',
    fn: 'updateExpense',
    must: [
      [/formRoomIds\s*=\s*\[\.\.\.new Set\(\[roomId,\s*formTarget,/, "폼의 '배정할 호실'을 영업장 검증 목록에 넣지 않는다"],
    ],
    mustNot: [],
  },
  // 비품 수령(+배정)과 그 적용취소(2026-10-15 S5). 토큰은 클라가 들고 오는 값이라 쓰기 조건마다 영업장을 건다.
  {
    file: 'app/(app)/inventory/assets/actions.ts',
    fn: 'setAssetReceived',
    must: [
      [/expense\.findMany\(\{\s*where:\s*\{\s*id:\s*\{\s*in:\s*expenseIds\s*\},\s*propertyId\s*\}/, '받을 지출을 영업장 범위로 읽지 않는다'],
      [/room\.findMany\(\{\s*where:\s*\{\s*id:\s*\{\s*in:\s*tIds\s*\},\s*propertyId\s*\}/, '배정 예정 호실을 영업장 방으로만 찾지 않는다(남의 방에 배정된다)'],
    ],
    mustNot: [],
  },
  {
    file: 'app/(app)/inventory/assets/actions.ts',
    fn: 'undoAssetReceipt',
    must: [
      [/deleteMany\(\{\s*where:\s*\{\s*id:\s*c\.id,\s*propertyId,/, '분할 수령 조각을 영업장 범위 없이 지운다'],
      [/updateMany\(\{\s*where:\s*\{\s*id:\s*row\.id,\s*propertyId,/, '행 복원을 영업장 범위 없이 쓴다'],
      [/assetAssignmentLog\.deleteMany\(\{\s*where:\s*\{\s*id:\s*\{\s*in:\s*undo\.logIds\s*\},\s*propertyId\s*\}/, '이력 줄을 영업장 범위 없이 지운다'],
    ],
    mustNot: [],
  },
  // 비품 전환(2026-10-15 계획서 2단계). 적용취소 토큰은 클라가 들고 오는 값이라 되돌리는 쓰기마다 영업장을 건다.
  // 되돌림 몸통은 공용층(durableConvert)에 있고 재무 undoDurableConvert 가 트랜잭션으로 부른다.
  {
    file: 'app/(app)/inventory/durableConvert.ts',
    fn: 'applyDurableConvertUndo',
    must: [
      [/expense\.count\(\{\s*where:\s*\{\s*id:\s*\{\s*in:\s*ids\s*\},\s*propertyId\s*\}/, '토큰의 지출이 이 영업장 것인지 보지 않는다'],
      [/updateMany\(\{\s*where:\s*\{\s*id:\s*r\.id,\s*propertyId,/, 'F1 행 복원을 영업장 범위 없이 쓴다'],
      [/updateMany\(\{\s*where:\s*\{\s*id:\s*p\.id,\s*propertyId,/, 'F3 행 복원을 영업장 범위 없이 쓴다'],
      [/trackedItem\.count\(\{\s*where:\s*\{\s*id:\s*c\.trackedItemId,\s*propertyId\s*\}/, '되살릴 자동 점검의 카드가 이 영업장 것인지 보지 않는다'],
      [/assetAssignmentLog\.deleteMany\(\{\s*where:\s*\{\s*id:\s*\{\s*in:\s*undo\.logIds\s*\},\s*propertyId\s*\}/, '이력 줄을 영업장 범위 없이 지운다'],
    ],
    mustNot: [],
  },
  {
    file: 'app/(app)/finance/actions.ts',
    fn: 'updateExpense',
    must: [
      [/room\.findFirst\(\{\s*where:\s*\{\s*id:\s*place\.roomId,\s*propertyId\s*\}/, 'F3 배정 호실을 영업장 방으로만 찾지 않는다'],
    ],
    mustNot: [],
  },
  // 비품 보관 위치(2026-10-19 storedLocationId). FK 는 영업장을 모른다. 화면·토큰에서 온 위치 id 는 영업장 위치여야 쓴다.
  {
    file: 'app/(app)/inventory/assets/actions.ts',
    fn: 'setAssetReceived',
    must: [[/storageInProperty\(propertyId,\s*storeId\)/, '수령 창 보관 위치를 영업장 위치로 보지 않는다(남의 영업장 위치 FK)']],
    mustNot: [],
  },
  {
    file: 'app/(app)/inventory/assets/actions.ts',
    fn: 'addFreeAsset',
    must: [[/storageInProperty\(propertyId,\s*input\.storedLocationId\)/, '무상 입수 보관 위치를 영업장 위치로 보지 않는다']],
    mustNot: [],
  },
  {
    file: 'app/(app)/inventory/assets/actions.ts',
    fn: 'undoAssetUnreceive',
    must: [
      [/durableExpenseWhere\(propertyId,\s*trackedCats\),\s*id:\s*\{\s*in:\s*ids\s*\}/, '토큰의 지출이 이 영업장 비품인지 보지 않는다'],
      [/updateMany\(\{\s*where:\s*\{\s*id:\s*r\.id,\s*propertyId,/, '수령 대기로 적용취소를 영업장 범위 없이 쓴다'],
    ],
    mustNot: [],
  },
  {
    file: 'app/(app)/inventory/assets/actions.ts',
    fn: 'undoAddFreeAsset',
    must: [[/deleteMany\(\{\s*where:\s*\{\s*id:\s*undo\.id,\s*propertyId,/, '무상 입수 적용취소가 영업장 범위 없이 지운다']],
    mustNot: [],
  },
  {
    file: 'app/(app)/inventory/actions.ts',
    fn: 'toggleStorageLocationHub',
    must: [
      [/storageLocation\.findFirst\(\{\s*where:\s*\{\s*id,\s*propertyId\s*\}/, '위치를 영업장 범위로 먼저 읽지 않는다'],
      [/updateMany\(\{\s*where:\s*\{\s*propertyId,\s*isHub:\s*true,\s*NOT:\s*\{\s*id\s*\}\s*\}/, '다른 기본 창고 해제가 영업장 범위가 아니다(남의 영업장 기본 창고를 끈다)'],
    ],
    mustNot: [],
  },
  // 납부일 임시 조정과 그 삭제(2026-10-22 2차 사유 목록, 운영자 승인 별건 권한). 종전에는 계약을 id 만으로 고쳤다.
  {
    file: 'app/(app)/rooms/actions.ts',
    fn: 'setDueDayOverride',
    must: [
      [/leaseTerm\.findFirst\(\{\s*where:\s*\{\s*id:\s*leaseTermId,\s*propertyId\s*\}/, '계약을 영업장 범위로 먼저 읽지 않는다'],
      [/leaseTerm\.update\(\{\s*where:\s*\{\s*id:\s*lease\.id\s*\}/, '영업장 범위로 찾은 계약이 아닌 화면 id 로 쓴다'],
    ],
    mustNot: [[/leaseTerm\.update\(\{\s*where:\s*\{\s*id:\s*leaseTermId\s*\}/, '계약을 화면 id 만으로 고친다']],
  },
  {
    file: 'app/(app)/rooms/actions.ts',
    fn: 'clearDueDayOverride',
    must: [
      [/leaseTerm\.findFirst\(\{\s*where:\s*\{\s*id:\s*leaseTermId,\s*propertyId\s*\}/, '계약을 영업장 범위로 먼저 읽지 않는다'],
      [/leaseTerm\.update\(\{\s*where:\s*\{\s*id:\s*lease\.id\s*\}/, '영업장 범위로 찾은 계약이 아닌 화면 id 로 쓴다'],
    ],
    mustNot: [[/leaseTerm\.update\(\{\s*where:\s*\{\s*id:\s*leaseTermId\s*\}/, '계약을 화면 id 만으로 고친다']],
  },
  {
    file: 'app/(app)/inventory/actions.ts',
    fn: 'restoreStorageHubs',
    must: [
      [/storageLocation\.count\(\{\s*where:\s*\{\s*id:\s*\{\s*in:\s*ids\s*\},\s*propertyId\s*\}/, '되살릴 위치가 이 영업장 것인지 보지 않는다'],
      [/updateMany\(\{\s*where:\s*\{\s*propertyId,\s*isHub:\s*true,\s*id:\s*\{\s*notIn:\s*ids\s*\}\s*\}/, '기본 창고 해제가 영업장 범위가 아니다'],
    ],
    mustNot: [],
  },
  // 기타수익·고정지출이 폼에서 받는 연결 id(2026-10-23 운영자 승인, 01 과 같은 클래스). 빈 값은 허용, 남의 영업장 id 는 거절.
  ...['addExtraIncome', 'updateExtraIncome'].map(fn => ({
    file: 'app/(app)/finance/actions.ts',
    fn,
    must: [
      [/leaseTerm\.findFirst\(\{\s*where:\s*\{\s*id:\s*leaseTermId,\s*propertyId\s*\}[^\n]*\n\s*if \(!lt\) return \{ ok: false/, '폼의 계약을 영업장 범위로 보고 없으면 닫지 않는다(남의 영업장 계약이 이어진다)'],
      [/tenant\.findFirst\(\{\s*where:\s*\{\s*id:\s*tenantId,\s*propertyId\s*\}/, '폼의 입주자를 영업장 범위로 보지 않는다'],
      [/financialAccount\.findFirst\(\{\s*where:\s*\{\s*id:\s*financialAccountId,\s*propertyId\s*\}/, '폼의 결제 계정을 영업장 범위로 보지 않는다'],
    ],
    mustNot: [],
  })),
  ...[['addRecurringExpense', 'fields'], ['updateRecurringExpense', 'fields'], ['groupRecurringExpenses', 'data']].map(([fn, obj]) => ({
    file: 'app/(app)/settings/actions.ts',
    fn,
    must: [[new RegExp(`financialAccount\\.findFirst\\(\\{\\s*where:\\s*\\{\\s*id:\\s*${obj}\\.financialAccountId,\\s*propertyId\\s*\\}`), '폼의 결제 계정을 영업장 범위로 보지 않는다(남의 영업장 계좌가 이어진다)']],
    mustNot: [],
  })),
  // 고정지출 등록·수정은 화면 객체를 허용 칸 화이트리스트로만 거른다(2026-10-23 독립 검수 블로커). data 의 fields·updateData 는 이 조립을 거친 값이다.
  ...['addRecurringExpense', 'updateRecurringExpense'].map(fn => ({
    file: 'app/(app)/settings/actions.ts',
    fn,
    must: [
      [/const fields = pickRecurringFields\(rest\)\n\s*if \(!fields\b[^\n]*return \{ ok: false, error: RECURRING_INPUT_INVALID \}/, '화면 객체를 허용 칸 화이트리스트로 거르지 않는다(propertyId·connect 가 실린다)'],
      ...(fn === 'updateRecurringExpense' ? [[/const updateData: Record<string, unknown> = \{ \.\.\.fields \}/, '수정 data 를 거른 값(fields)에서 시작하지 않는다']] : []),
      ...(fn === 'addRecurringExpense' ? [[/\.\.\.fields,[^\n]*\n\s*propertyId,/, '등록 data 에서 propertyId 가 거른 값 뒤에 와서 서버 값으로 서지 않는다']] : []),
    ],
    mustNot: [[/\.\.\.rest\b(?!\s*\}\s*=)/, '화면 객체(rest)를 그대로 펼친다']],
  })),
  // ── 2차 확대(2026-10-23 운영자 승인): 같은 클래스 sweep. 화면·토큰의 id 는 영업장 범위로 먼저 읽거나, 연결 id 는 저장 전에 영업장 것인지 본다 ──
  // 이 표식 뒤의 축은 순서도 본다(검수 2026-10-23). 관문 문장이 있어도 그보다 앞에서 id 만으로 쓰면 이미 늦다.
  { orderFrom: true },
  // 결제 계정을 거는 다른 폼. updateExpense·기타수익과 같은 관문이다.
  ...[['addExpense', 'financialAccountId'], ['batchUpdateExpenses', 'data\\.financialAccountId'], ['recordRecurringExpense', 'data\\.financialAccountId'],
    ['addReserveDeposit', 'input\\.linkedAccountId'], ['addReserveWithdrawDirect', 'input\\.linkedAccountId'], ['saveFinancialAccount', 'linkedAccountId'], ['saveFinancialAccount', '']].map(([fn, v]) => ({
    file: 'app/(app)/finance/actions.ts',
    fn,
    // v 가 빈 글자면 단축 속성(where: { id, propertyId }, 수정할 계정 자신)이다.
    must: [[new RegExp(`financialAccount\\.findFirst\\(\\{\\s*where:\\s*\\{\\s*id${v ? `:\\s*${v}` : ''},\\s*propertyId\\s*\\}`), `폼의 결제 계정(${v.replace(/\\\\/g, '') || '수정할 계정 id'})을 영업장 범위로 보지 않는다(남의 영업장 계좌가 이어진다)`]],
    mustNot: [],
  })),
  // 계약을 화면 id 로 읽는 전이·정산 문. id 만으로 읽으면 남의 계약 상태·방·일할이 바뀐다.
  ...[['checkoutTenant', 'leaseTermId'], ['moveInTenant', 'leaseTermId'], ['confirmReservationToActive', 'leaseTermId'], ['applyStatusTransition', 'input\\.leaseTermId'],
    ['setCheckoutProration', 'leaseTermId'], ['clearCheckoutProration', 'leaseTermId'], ['checkoutWithDepositRefund', 'params\\.leaseTermId']].map(([fn, v]) => ({
    file: 'app/(app)/tenants/actions.ts',
    fn,
    must: [[new RegExp(`leaseTerm\\.findFirst\\(\\{\\s*where:\\s*\\{\\s*id:\\s*${v},\\s*propertyId\\s*\\}`), '계약을 영업장 범위로 먼저 읽지 않는다']],
    mustNot: [[new RegExp(`leaseTerm\\.findUnique\\(\\{\\s*where:\\s*\\{\\s*id:\\s*${v}\\s*\\}`), '계약을 화면 id 만으로 읽는다']],
  })),
  // 이력·환불·수익 행에 싣는 입주자 id 도 영업장 사람만.
  ...[['checkoutTenant', 'tenantId'], ['moveInTenant', 'tenantId'], ['applyStatusTransition', 'input\\.tenantId'], ['deleteTenant', 'tenantId'],
    ['recordDepositReturn', 'params\\.tenantId'], ['recordReservationPrepaidCancel', 'params\\.tenantId']].map(([fn, v]) => ({
    file: 'app/(app)/tenants/actions.ts',
    fn,
    must: [[new RegExp(`if \\(!\\(await tenantInProperty\\(propertyId,\\s*${v}\\)\\)\\) return \\{ ok: false`), '화면의 입주자 id 를 영업장 사람으로 보고 아니면 닫지 않는다']],
    mustNot: [],
  })),
  ...['recordDepositReturn', 'recordReservationPrepaidCancel'].map(fn => ({
    file: 'app/(app)/tenants/actions.ts',
    fn,
    must: [[/leaseTerm\.findFirst\(\{\s*where:\s*\{\s*id:\s*params\.leaseTermId,\s*propertyId\s*\}[^\n]*\n\s*return \{ ok: false/, '화면의 계약 id 를 영업장 범위로 보고 아니면 닫지 않는다']],
    mustNot: [],
  })),
  {
    file: 'app/(app)/tenants/actions.ts',
    fn: 'deleteTenant',
    must: [[/tenant\.delete\(\{\s*where:\s*\{\s*id:\s*tenantId,\s*propertyId\s*\}/, '입주자 삭제가 영업장 범위가 아니다']],
    mustNot: [],
  },
  {
    file: 'app/(app)/tenants/actions.ts',
    fn: 'batchUpdateTenants',
    must: [[/const allLive = await prisma\.leaseTerm\.findMany\(\{\s*where:\s*\{\s*tenantId:\s*\{\s*in:\s*tenantIds\s*\},\s*propertyId,/, '고를 계약을 영업장 범위로 읽지 않는다(남의 입주자 계약 보증금·상태가 바뀐다)']],
    mustNot: [],
  },
  ...['createTenantRequest', 'updateTenantRequest'].map(fn => ({
    file: 'app/(app)/tenants/actions.ts',
    fn,
    must: [[/if \(data\.tenantId && !\(await prisma\.tenant\.findFirst\(\{\s*where:\s*\{\s*id:\s*data\.tenantId,\s*propertyId\s*\}/, '폼의 입주자를 영업장 범위로 보지 않는다(남의 입주자 호실이 스냅샷으로 샌다)']],
    mustNot: [],
  })),
  // 수납·청소비: 계약·입주자 id 짝을 영업장 범위로 본다.
  ...['savePayment', 'saveDepositPayment', 'saveCleaningFeePayment'].map(fn => ({
    file: 'app/(app)/rooms/actions.ts',
    fn,
    must: [[/const scopeErr = await leaseTenantScopeDenial\(propertyId, data\.leaseTermId, data\.tenantId\); if \(scopeErr\) return/, '수납의 계약·입주자 id 를 영업장 범위로 보지 않는다(남의 계약 미납·이월이 다시 계산된다)']],
    mustNot: [[/leaseTerm\.findUnique\(\{\s*where:\s*\{\s*id:\s*data\.leaseTermId\s*\}/, '계약을 화면 id 만으로 읽는다']],
  })),
  {
    file: 'app/(app)/rooms/actions.ts',
    fn: 'saveReservationDeposit',
    must: [[/prisma\.tenant\.findFirst\(\{\s*where:\s*\{\s*id:\s*data\.tenantId,\s*propertyId\s*\}/, '예약금의 입주자 id 를 영업장 범위로 보지 않는다']],
    mustNot: [],
  },
  {
    file: 'app/(app)/room-manage/cleaningActions.ts',
    fn: 'createCleaning',
    must: [[/leaseTerm\.findFirst\(\{\s*where:\s*\{\s*id:\s*input\.leaseTermId,\s*propertyId\s*\}/, '청소에 잇는 계약을 영업장 범위로 보지 않는다(청소비 부담 귀속이 남의 계약으로 간다)']],
    mustNot: [],
  },
  // 호실 관리: 화면 id 를 영업장 범위로 먼저 확인하고, 일괄 편집·적용취소는 허용 칸만.
  {
    file: 'app/(app)/room-manage/actions.ts',
    fn: 'updateRoom',
    must: [[/room\.findFirst\(\{\s*where:\s*\{\s*id,\s*propertyId\s*\}[^\n]*\n\s*if \(!prevRoom\) return \{ ok: false, error: ROOM_GONE \}/, '호실을 영업장 범위로 먼저 읽고 없으면 닫지 않는다']],
    mustNot: [[/room\.findUnique\(\{\s*where:\s*\{\s*id\s*\}/, '호실을 화면 id 만으로 읽는다']],
  },
  {
    file: 'app/(app)/room-manage/actions.ts',
    fn: 'deleteRoom',
    must: [[/const owned = await prisma\.room\.findFirst\(\{\s*where:\s*\{\s*id,\s*propertyId\s*\}[^\n]*\n\s*if \(!owned\) return \{ ok: false, error: ROOM_GONE \}\n\s*\n\s*const activeLeases/, '호실을 영업장 범위로 먼저 확인하지 않는다(건수 안내·연쇄 삭제가 남의 방에 돈다)']],
    mustNot: [],
  },
  {
    file: 'app/(app)/room-manage/actions.ts',
    fn: 'batchUpdateRooms',
    must: [
      [/const roomFields = pickBatchRoomFields\(data\)\n\s*if \(!roomFields\) return \{ ok: false, error: BATCH_ROOM_INPUT_INVALID \}/, '화면 객체를 허용 칸으로 거르지 않는다(propertyId·roomNo·마스터키가 실린다)'],
      [/leaseTerm\.findMany\(\{\s*where:\s*\{\s*roomId:\s*\{\s*in:\s*roomIds\s*\},\s*propertyId,/, '계약 스냅샷을 영업장 범위로 뜨지 않는다(남의 계약이 적용취소 토큰에 실린다)'],
    ],
    mustNot: [[/\bdata\.\w+\s*=(?!=)/, '화면 객체(data)를 고쳐 쓴다. 거른 값(roomFields)만 쓴다']],
  },
  {
    file: 'app/(app)/room-manage/actions.ts',
    fn: 'undoBatchUpdateRooms',
    must: [
      [/const roomFields = pickBatchRoomFields\(x\.fields\)\n\s*if \(!roomFields\) return \{ ok: false, error: BATCH_ROOM_INPUT_INVALID \}\n\s*restore\.push\(\{ id: x\.id, roomFields \}\)/, '토큰의 방 칸을 허용 칸으로 거르지 않는다'],
      [/leaseTerm\.updateMany\(\{\s*where:\s*\{\s*id:\s*l\.id,\s*propertyId\s*\}/, '토큰의 계약을 영업장 범위 없이 되돌린다'],
    ],
    mustNot: [[/Object\.fromEntries\(Object\.entries\(x\.fields\)/, '토큰 객체를 통째로 data 로 바꾼다']],
  },
  {
    file: 'app/(app)/room-manage/actions.ts',
    fn: 'undoApplyScheduledRent',
    must: [[/leaseTerm\.updateMany\(\{\s*where:\s*\{\s*id:\s*l\.id,\s*propertyId\s*\}/, '토큰의 계약을 영업장 범위 없이 되돌린다']],
    mustNot: [[/leaseTerm\.update\(\{\s*where:\s*\{\s*id:\s*l\.id\s*\}/, '토큰의 계약을 id 만으로 고친다']],
  },
  // 시세 조사: 경쟁업체를 붙일 조사는 이 영업장 것.
  {
    file: 'app/(app)/market-analysis/actions.ts',
    fn: 'addCompetitor',
    must: [[/marketSurvey\.findFirst\(\{\s*where:\s*\{\s*id:\s*surveyId,\s*propertyId\s*\}/, '붙일 조사를 영업장 범위로 보지 않는다(남의 영업장 조사에 행이 붙는다)']],
    mustNot: [],
  },
  // 체크리스트 완료: 항목을 영업장 범위로 먼저 읽어야 이력(자식) 생성이 남의 항목에 붙지 않는다.
  {
    file: 'app/(app)/checklist/actions.ts',
    fn: 'markChecklistDone',
    must: [[/checklist\.findFirst\(\{\s*where:\s*\{\s*id:\s*input\.id,\s*propertyId\s*\}[^\n]*\n\s*if \(!cur\) return \{ ok: false/, '항목을 영업장 범위로 먼저 읽고 없으면 닫지 않는다']],
    mustNot: [],
  },
  // 재고 적용취소 토큰.
  {
    file: 'app/(app)/inventory/actions.ts',
    fn: 'undoDeleteStockCheck',
    must: [
      [/locationsInProperty\(propertyId, undo\.locations\.flatMap\(l => \[l\.storageLocationId, l\.fromLocationId\]\)\)/, '토큰의 위치 id 를 영업장 위치로 보지 않는다'],
      [/expense\.findFirst\(\{\s*where:\s*\{\s*id:\s*undo\.sourceExpenseId,\s*propertyId\s*\}/, '토큰의 원천 지출을 영업장 범위로 보지 않는다'],
    ],
    mustNot: [[/create:\s*undo\.locations\b(?!\s*\.)/, '토큰 배열을 중첩 create 에 통째로 넘긴다']],
  },
  {
    file: 'app/(app)/inventory/actions.ts',
    fn: 'undoUpdateStockCheck',
    must: [
      [/revertShiftRows\(tx, propertyId, \{ \.\.\.undo\.shift, trackedItemId: c\.trackedItemId \}\)/, '토큰의 품목 대신 확인한 점검의 품목으로 되돌리지 않는다'],
      [/locationsInProperty\(propertyId, undo\.locations\.flatMap\(l => \[l\.storageLocationId, l\.fromLocationId\]\)\)/, '토큰의 위치 id 를 영업장 위치로 보지 않는다'],
    ],
    mustNot: [],
  },
  {
    file: 'app/(app)/inventory/ledgerShift.ts',
    fn: 'revertShiftRows',
    must: [[/export async function revertShiftRows\(tx: InventoryTx, propertyId: string, undo: LedgerShiftUndo\)[^\n]*\n(\s*\/\/[^\n]*\n)*\s*if \(!\(await tx\.trackedItem\.findFirst\(\{ where: \{ id: undo\.trackedItemId, propertyId \}/, '되돌리기 공용층이 품목의 영업장을 먼저 보지 않는다(부르는 쪽이 빠뜨리면 남의 점검을 덮는다)']],
    mustNot: [],
  },
  // 지출 삭제 적용취소: 토큰 행은 맨 칸만, 배송비 줄은 이 영업장 것만, id 목록 재연결은 영업장 범위로.
  {
    file: 'app/(app)/finance/actions.ts',
    fn: 'undoDeleteExpense',
    must: [
      [/const data = pickScalars<ExpenseRowSnap>\(undo\.expense, EXPENSE_SCALARS\)/, '토큰의 지출 행을 맨 칸으로 거르지 않는다(관계 칸 connect 가 실린다)'],
      [/const row = pickScalars<ExpenseRowSnap>\(s, EXPENSE_SCALARS\)\n\s*if \(!row \|\| row\.propertyId !== propertyId\) return/, '배송비 줄을 맨 칸·영업장으로 거르지 않는다'],
      [/pickScalars<[^>]*>\(undo\.order, EXPENSE_ORDER_SCALARS\)/, '토큰의 주문 행을 맨 칸으로 거르지 않는다'],
      [/stockCheck\.updateMany\(\{\s*where:\s*\{\s*id:\s*\{\s*in:\s*undo\.stockCheckIds\s*\},\s*trackedItem:\s*\{\s*propertyId\s*\}/, '점검 재연결이 영업장 범위가 아니다'],
      [/reserveTransaction\.updateMany\(\{\s*where:\s*\{\s*id:\s*\{\s*in:\s*undo\.reserveTxIds\s*\},\s*propertyId\s*\}/, '예비비 재연결이 영업장 범위가 아니다'],
    ],
    mustNot: [[/\{\s*\.\.\.undo\.expense\s*\}|\{\s*\.\.\.s\s*\}\s*as\s*ExpenseRowSnap/, '토큰 객체를 그대로 펼친다']],
  },
  // 입수·폐기·수령 취소 적용취소의 위치 id(검수 2026-10-23, 점검 적용취소와 같은 클래스).
  ...[['undoDeleteStockAddition', 'undo\\.storageLocationId'], ['undoUpdateStockAddition', 'undo\\.before\\.storageLocationId'], ['undoDeleteStockDisposal', 'undo\\.storageLocationId'],
    ['undoCancelReceipt', 'undo\\.receivedLocationId, \\.\\.\\.undo\\.autoChecks\\.flatMap\\(c => c\\.locations\\.map\\(lb => lb\\.storageLocationId\\)\\)']].map(([fn, v]) => ({
    file: 'app/(app)/inventory/actions.ts',
    fn,
    must: [[new RegExp(`if \\(!\\(await locationsInProperty\\(propertyId, \\[${v}\\]\\)\\)\\) \\{?\\s*return \\{ ok: false`), '토큰의 위치 id 를 영업장 위치로 보고 아니면 닫지 않는다']],
    mustNot: [],
  })),
  // 되돌리기 공용층은 품목이 사라진 경우(병합)와 남의 영업장을 가른다. 사라지면 조정만 건너뛰고, 부르는 쪽은 복원을 마저 하고 알린다.
  {
    file: 'app/(app)/inventory/ledgerShift.ts',
    fn: 'revertShiftRows',
    must: [[/if \(await tx\.trackedItem\.findUnique\(\{ where: \{ id: undo\.trackedItemId \}[^\n]*throw new Error\('다른 영업장의 기록입니다\.'\)\n\s*return 'itemGone'/, '품목이 사라진 경우와 남의 영업장을 가르지 않는다(병합 뒤 적용취소가 틀린 말로 통째 실패한다)']],
    mustNot: [],
  },
  ...['undoDeleteExpense', 'undoCancelReceipt'].map(fn => ({
    file: fn === 'undoDeleteExpense' ? 'app/(app)/finance/actions.ts' : 'app/(app)/inventory/actions.ts',
    fn,
    must: [[/\(await revertShiftRows\(tx, propertyId, undo\.shift\)\) === 'itemGone'/, '조정을 건너뛴 사실을 받아 알리지 않는다'], [/SHIFT_ITEM_GONE_NOTICE/, '건너뛴 사유를 돌려주지 않는다']],
    mustNot: [],
    noOrder: true,   // 관문이 아니라 복원 뒤 알림을 보는 축이다
  })),
]
// 표식 뒤 축에 순서 검사를 켠다.
{
  const at = AXES.findIndex(a => a.orderFrom)
  if (at < 0) violations.push('순서 검사 표식(orderFrom)을 못 찾았다. 순서 축이 장식이 된다')
  else { AXES.splice(at, 1); for (let i = at; i < AXES.length; i++) AXES[i].order = !AXES[i].noOrder }
}
// 쓰기 호출(모델 대리자 메서드·원시 SQL). 순서 축은 관문 문장보다 앞에 이것이 있으면 위반이다.
const WRITE_CALL = /\.\s*\w+\s*\.\s*(create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|delete|deleteMany|upsert)\s*\(|\$executeRaw/
// 축 문장이 쓰기 자체인가(앞 점 없이 tenant.delete( 로 시작하는 축도 있다).
const WRITE_STMT = /\b\w+\s*\.\s*(create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|delete|deleteMany|upsert)\s*\(/

for (const ax of AXES) {
  let src = ''
  try { src = readFileSync(ax.file, 'utf8') } catch { violations.push(`${ax.file} — 파일을 못 읽었다. 못 읽으면 통과가 아니라 위반이다`); continue }
  const body = bodyOf(src, ax.fn)
  if (body == null) { violations.push(`${ax.file} — ${ax.fn} 를 못 찾았다. 이름이 바뀌었으면 이 축도 함께 고친다`); continue }
  for (const [re, msg] of ax.must) {
    const m = body.match(re)
    if (!m) { violations.push(`${ax.file} ${ax.fn} — ${msg}. 다른 영업장 id 로 그 행을 읽거나 바꿀 수 있다`); continue }
    // 순서 축: 관문(읽기·확인)보다 앞선 쓰기를 막는다. 축 자체가 쓰기 문장이면(where 범위를 보는 축) 순서는 안 본다.
    if (ax.order && !WRITE_STMT.test(m[0])) {
      const w = body.slice(0, m.index).match(WRITE_CALL)
      if (w) violations.push(`${ax.file} ${ax.fn} — 관문(${msg.split('(')[0]}) 보다 앞에서 쓴다(${w[0].trim()}). 확인 전에 화면 id 로 쓰면 늦다`)
    }
  }
  for (const [re, msg] of ax.mustNot) if (re.test(body)) violations.push(`${ax.file} ${ax.fn} — ${msg}. 영업장 범위를 지나야 한다`)
}

// ── 모델 전수 축: 기타수익·고정지출(+세부항목) 쓰기는 where 에 영업장을 건다 (2026-10-23 운영자 승인) ──
// 함수 단위 축은 이름이 박힌 자리만 본다. updateExtraIncome·updateRecurringExpense 가 id 만으로 쓰던 것을 고치면서
// 같은 모델의 형제 쓰기(삭제·복원·기록·묶기 해제·트랜잭션 안 쓰기)까지 클래스로 막는다. 앱 코드(app·lib) 전부를 훑어
// update·updateMany·delete·deleteMany·upsert 의 where 객체 안에 propertyId 가 없으면 위반이다. 세부항목은 부모 관계
// 필터(recurringExpense: { propertyId })로 건다. where 를 변수로 넘기면 범위를 못 읽으므로 그것도 위반이다(닫힌 쪽으로 실패).
//
// 2차 보강(2026-10-23 독립 검수 블로커). 화면 객체를 data 에 펼치면 propertyId·expenses: { connect }·financialAccount: { connect }
// 가 그대로 실려 남의 영업장으로 옮기거나 남의 행을 붙였다. 그래서 create·createMany·update·updateMany·upsert 의 data 를 본다.
//   ⓐ data 안의 펼침(...이름, ...(식))은 출처를 따라간 값만. ⓑ data 를 변수로 넘기는 것은 출처를 따라간 변수만.
//   ⓒ 기타수익·고정지출 create 의 data 에는 propertyId 가 있어야 한다. ⓓ prisma·tx 의 모델 대리자를 변수에 담거나 구조분해하지 않는다.
//   ⓔ 쓰기 개수는 정확한 수로 고정한다. 새 쓰기를 더하면 이 숫자도 함께 고친다(조용히 빠지거나 늘지 않게).
// 3차 보강(2026-10-23 재검수 우회로). ⓕ 출처 추적: 펼치거나 data 로 넘기는 변수는 이름이 아니라 그 함수 안의 선언(화이트리스트
//   pickRecurringFields·normalizeCycle·서버가 짠 연결)과 그 뒤 변경(Object.assign·속성 대입·재대입)을 따라가 허용한다.
//   ⓖ 화이트리스트 자체: RECURRING_FIELDS 키는 RecurringExpense 의 맨 칸(관계·id·propertyId 아님)만, 고르는 함수는 그 표만 돈다.
//   ⓗ 다른 모델을 거친 중첩 쓰기: 어느 모델 쓰기든 data 안에서 세 모델로 가는 관계 칸(스키마에서 읽음)에 쓰기 연산을 걸지 않는다.
const SCOPED_MODELS = ['extraIncome', 'recurringExpense', 'recurringExpenseItem']
const SCOPED_TYPES = ['ExtraIncome', 'RecurringExpense', 'RecurringExpenseItem']
const MODEL_ALT = SCOPED_MODELS.join('|')
const WHERE_OPS = ['update', 'updateMany', 'delete', 'deleteMany', 'upsert']
const DATA_OPS = ['create', 'createMany', 'update', 'updateMany', 'upsert']
// 줄바꿈·공백을 허용한다(prisma.extraIncome\n  .update(). 뒤의 \s*\( 로 updateMany 와 update 를 가른다.
const CALL_RE = new RegExp(`\\.\\s*(${MODEL_ALT})\\s*\\.\\s*(create|createMany|update|updateMany|delete|deleteMany|upsert)\\s*\\(`, 'g')
// prisma·tx 대리자에 메서드 호출이 안 붙는 자리(별칭 할당·인자로 넘김)와 계산된 접근, 구조분해만 잡는다.
// 행의 관계 읽기(p.recurringExpense·row.extraIncome)는 대리자가 아니라 잡지 않는다.
const ALIAS_RE = new RegExp(`\\b(prisma|tx)\\s*\\.\\s*(${MODEL_ALT})\\b(?!\\s*\\.\\s*\\w+\\s*\\()|\\b(prisma|tx)\\s*\\[|\\{[^{}]*\\b(${MODEL_ALT})\\b[^{}]*\\}\\s*=\\s*(prisma|tx)\\b`, 'g')
const EXPECTED = { where: 22, data: 24 }

// ⓕ 출처 정본. 선언이 그 함수 안에 이 꼴로 있어야 하고, 그 뒤 변경은 여기 적은 꼴만 허용한다.
const PROVENANCE = {
  fields: { decl: /const fields = pickRecurringFields\(rest\)/ },
  cycle: { decl: /const cycle = normalizeCycle\(/ },
  link: { decl: /let link: \{ tenantId: string \| null; leaseTermId: string \| null \} \| null = null/, reassign: /^link = \{ tenantId, leaseTermId \}$/ },
  updateData: {
    decl: /const updateData: Record<string, unknown> = \{ \.\.\.fields \}/,
    assignKeys: new Set(['category', 'activeSince', 'amount', 'isVariable']),
    assignFrom: /^normalizeCycle\(/,
  },
}
const SAFE_LITERALS = new Set(['null', 'undefined', 'true', 'false'])

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(p)
  }
  return out
}

/** open 위치의 여는 괄호와 짝인 닫는 괄호 위치. 문자열·주석은 단순히 건너뛴다. */
function matchClose(src, open) {
  const pairs = { '(': ')', '{': '}', '[': ']' }
  const stack = [pairs[src[open]]]
  for (let i = open + 1; i < src.length; i++) {
    const c = src[i]
    if (c === "'" || c === '"' || c === '`') { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++ } continue }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (pairs[c]) stack.push(pairs[c])
    else if (c === stack[stack.length - 1]) { stack.pop(); if (!stack.length) return i }
  }
  return -1
}

/** 인자 객체의 최상위 key 값. 객체면 { obj }, 그 밖의 식이면 { raw }(최상위 쉼표까지), 단축 속성이면 { raw: key }, 없으면 null. */
function topLevel(arg, key) {
  let depth = 0
  for (let i = 0; i < arg.length; i++) {
    const c = arg[i]
    if (c === '{' || c === '(' || c === '[') depth++
    else if (c === '}' || c === ')' || c === ']') depth--
    else if (depth === 1 && arg.startsWith(key, i) && !/[\w$]/.test(arg[i - 1] ?? '') && !/[\w$]/.test(arg[i + key.length] ?? '')) {
      let j = i + key.length
      while (/\s/.test(arg[j])) j++
      if (arg[j] !== ':') return { raw: key }
      j++
      while (/\s/.test(arg[j])) j++
      if (arg[j] === '{') { const e = matchClose(arg, j); return { obj: arg.slice(j, e + 1) } }
      let k = j
      for (; k < arg.length; k++) {
        const ch = arg[k]
        if (ch === '(' || ch === '{' || ch === '[') { k = matchClose(arg, k); if (k < 0) break; continue }
        if (ch === ',' || ch === '}') break
      }
      return { raw: arg.slice(j, k < 0 ? undefined : k).trim() }
    }
  }
  return null
}

/** 호출 위치를 감싼 함수의 시작(가장 가까운 function 선언). */
function fnStartOf(src, idx) {
  let best = 0
  for (const m of src.slice(0, idx).matchAll(/(^|\n)[ \t]*(export\s+)?(async\s+)?function\s+\w+/g)) best = m.index
  return best
}

/** ⓕ 변수 v 의 출처를 body(함수 시작부터 쓰기 직전까지) 안에서 따라간다. 위반 문구 배열을 돌려준다. */
function provenanceIssues(v, body) {
  const rule = PROVENANCE[v]
  if (!rule) return [`${v} 는 출처 정본(PROVENANCE)에 없다. 화이트리스트에서 나온 값인지 따라갈 수 없다`]
  // 같은 이름을 여러 함수가 쓰면 정본 꼴이 여럿이다(결제 계정 data: 화면 저장·엑셀 가져오기). 그 함수 안에 하나가 있어야 한다.
  const decls = Array.isArray(rule.decl) ? rule.decl : [rule.decl]
  const d = decls.map(re => body.match(re)).find(Boolean)
  if (!d) return [`${v} 의 선언이 정본 꼴(${decls.map(re => re.source).join(' · ')})이 아니다. 화이트리스트를 거치지 않은 값일 수 있다`]
  const issues = []
  const after = body.slice(d.index + d[0].length)
  const esc = v.replace(/\$/g, '\\$')
  for (const m of after.matchAll(new RegExp(`(Object\\.assign|Object\\.defineProperty|Object\\.defineProperties|Reflect\\.set)\\(\\s*${esc}\\b\\s*,\\s*([^\\n]*)`, 'g'))) {
    if (!(m[1] === 'Object.assign' && rule.assignFrom && rule.assignFrom.test(m[2]))) issues.push(`${v} 에 ${m[1]}(${m[2].slice(0, 30).trim()}) 로 칸을 더한다. 화이트리스트 밖 키가 실린다`)
  }
  for (const m of after.matchAll(new RegExp(`(?<![\\w$.])${esc}\\s*(\\.\\s*([\\w$]+)|\\[[^\\]]*\\])\\s*=(?!=)`, 'g'))) {
    if (!(m[2] && rule.assignKeys?.has(m[2]))) issues.push(`${v}${m[1]} 에 대입한다. 허용 칸(${[...(rule.assignKeys ?? [])].join('·') || '없음'}) 밖이다`)
  }
  for (const m of after.matchAll(new RegExp(`(?<![\\w$.])${esc}\\s*=(?!=)[^\\n]*`, 'g'))) {
    if (!(rule.reassign && rule.reassign.test(m[0].trim()))) issues.push(`${v} 를 다시 대입한다(${m[0].trim().slice(0, 40)}). 출처가 바뀐다`)
  }
  return issues
}

/** ⓐ 펼침 ...( 식 ) 안에서 값 자리에 선 맨 이름을 뽑는다. 삼항의 조건(뒤가 ?)은 값이 아니라 뺀다. */
function valueIdentsInParen(expr) {
  const out = []
  for (const m of expr.matchAll(/(^|[?:(]|\?\?|\|\||&&)\s*([A-Za-z_$][\w$]*)\s*(?=$|[):]|\?\?|\|\||&&)/g)) {
    if (!SAFE_LITERALS.has(m[2])) out.push(m[2])
  }
  return out
}

let body = ''
/** data 값 하나를 본다: 펼침·변수의 출처, (create 면) propertyId. */
function checkData(at, val, { needProperty, allowRaw }) {
  if (!val) { violations.push(`${at} · data 를 못 찾았다`); return }
  if (val.raw != null) {
    if (/^[A-Za-z_$][\w$]*$/.test(val.raw)) {
      for (const i of provenanceIssues(val.raw, body)) violations.push(`${at} · data 변수: ${i}`)
      return
    }
    if (!(allowRaw && allowRaw.test(val.raw))) { violations.push(`${at} · data 를 식(${val.raw.slice(0, 40)})으로 넘긴다. 화면 객체가 실릴 수 있다. 객체로 칸을 적는다`); return }
  }
  const text = val.obj ?? val.raw
  for (const s of text.matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*)/g)) {
    for (const i of provenanceIssues(s[1], body)) violations.push(`${at} · data 펼침: ${i}`)
  }
  for (const s of text.matchAll(/\.\.\.\s*\(/g)) {
    const open = s.index + s[0].length - 1
    const close = matchClose(text, open)
    const expr = text.slice(open + 1, close)
    for (const id of valueIdentsInParen(expr)) for (const i of provenanceIssues(id, body)) violations.push(`${at} · data 펼침 식: ${i}`)
  }
  if (needProperty && !/\bpropertyId\b/.test(text)) violations.push(`${at} · create 의 data 에 propertyId 가 없다. 어느 영업장 행인지 서버가 정하지 않는다`)
}

// ⓗ 스키마에서 세 모델로 가는 관계 칸을 읽는다(모델 이름 → 칸 이름 목록).
const schema = readFileSync('prisma/schema.prisma', 'utf8')
const REL_FIELDS = new Map()
{
  let cur = null
  for (const line of schema.split('\n')) {
    const mm = line.match(/^model\s+(\w+)/)
    if (mm) { cur = mm[1]; continue }
    const fm = cur && line.match(new RegExp(`^\\s+(\\w+)\\s+(${SCOPED_TYPES.join('|')})(\\[\\])?\\??(\\s|$)`))
    if (fm) REL_FIELDS.set(cur, [...(REL_FIELDS.get(cur) ?? []), fm[1]])
  }
}
const REL_NAMES = [...new Set([...REL_FIELDS.values()].flat())]
if (REL_NAMES.length === 0) violations.push('스키마에서 기타수익·고정지출로 가는 관계 칸을 못 읽었다. 중첩 쓰기 축이 장식이 된다')
const NESTED_OPS = 'create|createMany|connect|connectOrCreate|update|updateMany|upsert|delete|deleteMany|set|disconnect'
// 부모가 영업장 범위로 서는 자리의 자식 생성만 허용한다(고정지출 create 안의 세부항목 create).
const NESTED_ALLOW = [{ model: 'recurringExpense', op: 'create', field: 'items', nested: 'create' }]
const ANY_WRITE_RE = /\.\s*(\w+)\s*\.\s*(create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert)\s*\(/g
const NESTED_RE = new RegExp(`\\b(${REL_NAMES.join('|')})\\s*:\\s*(\\{\\s*(${NESTED_OPS})\\b|[A-Za-z_$])`, 'g')

// ⓖ 화이트리스트 자체를 본다.
{
  const sf = 'app/(app)/settings/actions.ts'
  const s = readFileSync(sf, 'utf8')
  const tbl = s.match(/const RECURRING_FIELDS = (\{[\s\S]*?\}) as const/)
  const block = schema.match(/model RecurringExpense \{([\s\S]*?)\n\}/)
  if (!tbl || !block) violations.push(`${sf} · RECURRING_FIELDS 표나 RecurringExpense 모델을 못 찾았다. 화이트리스트를 볼 수 없다`)
  else {
    const scalars = new Set([...block[1].matchAll(/^\s+(\w+)\s+(String|Int|Boolean|DateTime|Float|Decimal|Json|BigInt)\??(\s|$)/gm)].map(m => m[1]))
    for (const k of ['id', 'propertyId', 'createdAt', 'updatedAt']) scalars.delete(k)
    for (const m of tbl[1].matchAll(/(\w+)\s*:\s*'/g)) if (!scalars.has(m[1])) violations.push(`${sf} · RECURRING_FIELDS 에 ${m[1]} 가 있다. 맨 칸(관계·id·propertyId 아님)만 허용한다`)
    const fn = s.match(/function pickRecurringFields\([\s\S]*?\n\}/)
    if (!fn || !/for \(const \[key, kind\] of Object\.entries\(RECURRING_FIELDS\)\)/.test(fn[0]) || !/typeof v !== base/.test(fn[0]) || /\.\.\.\s*src|Object\.assign\(\s*out\s*,\s*src/.test(fn[0])) {
      violations.push(`${sf} · pickRecurringFields 가 RECURRING_FIELDS 표만 돌며 형을 보는 꼴이 아니다. 화면 객체가 통째로 넘어간다`)
    }
  }
}

let whereCount = 0, dataCount = 0
for (const file of [...walk('app', []), ...walk('lib', [])]) {
  const src = readFileSync(file, 'utf8')
  const lineOf = idx => src.slice(0, idx).split('\n').length
  for (const m of src.matchAll(ALIAS_RE)) {
    violations.push(`${file}:${lineOf(m.index)} · prisma·tx 의 모델 대리자를 변수에 담거나 구조분해하거나 계산된 이름으로 꺼낸다. 별칭을 거치면 이 그물이 쓰기를 못 본다. prisma.모델.메서드( 로 바로 부른다`)
  }
  for (const m of src.matchAll(CALL_RE)) {
    const [model, op] = [m[1], m[2]]
    const open = m.index + m[0].length - 1
    const close = matchClose(src, open)
    const at = `${file}:${lineOf(m.index)} ${model}.${op}`
    if (close < 0) { violations.push(`${at} · 호출 괄호를 못 읽었다. 못 읽으면 통과가 아니라 위반이다`); continue }
    const arg = src.slice(open + 1, close).trim()
    body = src.slice(fnStartOf(src, m.index), m.index)
    if (WHERE_OPS.includes(op)) {
      whereCount++
      const w = topLevel(arg, 'where')
      if (!w) violations.push(`${at} · where 를 못 찾았다. 영업장 범위를 볼 수 없다`)
      else if (w.raw != null) violations.push(`${at} · where 를 변수(${w.raw})로 넘겨 영업장 범위를 못 읽는다. where 객체 안에 propertyId 를 직접 쓴다`)
      else if (!/\bpropertyId\b/.test(w.obj)) violations.push(`${at} · where 에 propertyId 가 없다(id 만으로 쓴다). 다른 영업장 id 로 그 행을 바꿀 수 있다`)
    }
    if (DATA_OPS.includes(op)) {
      dataCount++
      const needProperty = op.startsWith('create') && model !== 'recurringExpenseItem'
      // 세부항목 일괄 생성은 부모를 영업장 범위로 확인한 뒤 화면 배열을 칸별로 다시 짜는 꼴만 허용한다.
      const allowRaw = model === 'recurringExpenseItem' && op === 'createMany' ? /^items\.map\(\(it, i\) => \(\{ recurringExpenseId: id, name: it\.name, amount: Number\(it\.amount\) \|\| 0, isVariable: !!it\.isVariable, sortOrder: i \}\)\)$/ : null
      if (op === 'upsert') {
        checkData(`${at}(create)`, topLevel(arg, 'create'), { needProperty: model !== 'recurringExpenseItem' })
        checkData(`${at}(update)`, topLevel(arg, 'update'), { needProperty: false })
      } else checkData(at, topLevel(arg, 'data'), { needProperty, allowRaw })
    }
  }
  // ⓗ 다른 모델(또는 같은 모델)을 거친 중첩 쓰기.
  for (const m of src.matchAll(ANY_WRITE_RE)) {
    const [model, op] = [m[1], m[2]]
    const open = m.index + m[0].length - 1
    const close = matchClose(src, open)
    if (close < 0) continue
    const arg = src.slice(open + 1, close)
    const parts = op === 'upsert' ? [topLevel(arg, 'create'), topLevel(arg, 'update')] : [topLevel(arg, 'data')]
    for (const part of parts) {
      const text = part?.obj ?? part?.raw ?? ''
      for (const n of text.matchAll(NESTED_RE)) {
        const nestedOp = n[3] ?? '(변수)'
        if (NESTED_ALLOW.some(a => a.model === model && a.op === op && a.field === n[1] && a.nested === nestedOp)) continue
        violations.push(`${file}:${lineOf(m.index)} ${model}.${op} · data 의 ${n[1]}: ${nestedOp} 로 기타수익·고정지출을 중첩해서 쓴다. 영업장 범위·화이트리스트를 비켜 간다. 그 모델을 직접 부른다`)
      }
    }
  }
}
// ── 2차 모델 묶음 전수 축 (2026-10-23 운영자 승인 확대) ──
// 결제 계정·체크리스트(+이력)·입주자 요청·시세 조사(+경쟁업체)는 앱 코드 전부, 호실은 호실 관리 액션 파일에서 쓰기마다 본다.
//   ⓐ where 최상위에 propertyId(자식 모델은 부모 관계 필터 { 부모: { propertyId } })가 서야 한다. 변수 where 는 위반.
//   ⓑ data 의 펼침·변수는 1차와 같은 출처 추적(PROVENANCE)만 통과. 식으로 넘기는 data 는 적힌 꼴(ALLOW_RAW2)만.
//   ⓒ 자기 영업장 칸이 있는 모델의 create data 에는 propertyId 가 있어야 한다.
//   ⓓ 대리자 별칭 금지(1차 ALIAS 와 같은 꼴), 중첩 쓰기로 이 모델들의 관계 칸을 건드리지 않는다(호실은 범위가 넓어 뺀다).
//   ⓔ 모델마다 쓰기 개수를 고정한다.
// 일괄 편집 허용 칸 표(BATCH_ROOM_FIELDS)는 Room 의 맨 칸 중 위험 칸(id·propertyId·roomNo·isVacant·마스터키 등)이 아닌 것만이어야 한다.
const SCOPE2 = {
  financialAccount: { parent: null },
  checklist: { parent: null },
  checklistLog: { parent: 'checklist' },
  tenantRequest: { parent: null },
  marketSurvey: { parent: null },
  marketCompetitor: { parent: 'marketSurvey' },
  room: { parent: null, files: ['app/(app)/room-manage/actions.ts'] },
}
const SCOPE2_TYPES = { financialAccount: 'FinancialAccount', checklist: 'Checklist', checklistLog: 'ChecklistLog', tenantRequest: 'TenantRequest', marketSurvey: 'MarketSurvey', marketCompetitor: 'MarketCompetitor' }
// 식으로 넘겨도 되는 data(파일·모델·정확한 글자). 거른 값을 담은 배열의 원소만 허용한다.
const ALLOW_RAW2 = [{ file: 'app/(app)/room-manage/actions.ts', model: 'room', raw: /^x\.roomFields$/ }]
const EXPECTED2 = {
  financialAccount: { where: 4, data: 5 },
  checklist: { where: 4, data: 4 },
  checklistLog: { where: 1, data: 1 },
  tenantRequest: { where: 5, data: 7 },
  marketSurvey: { where: 2, data: 2 },
  marketCompetitor: { where: 2, data: 2 },
  room: { where: 7, data: 7 },
}
const MODEL2_ALT = Object.keys(SCOPE2).join('|')
const CALL2_RE = new RegExp(`\\.\\s*(${MODEL2_ALT})\\s*\\.\\s*(create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|delete|deleteMany|upsert)\\s*\\(`, 'g')
const ALIAS2_RE = new RegExp(`\\b(prisma|tx)\\s*\\.\\s*(${MODEL2_ALT})\\b(?!\\s*\\.\\s*\\w+\\s*\\()|\\{[^{}]*\\b(${MODEL2_ALT})\\b[^{}]*\\}\\s*=\\s*(prisma|tx)\\b`, 'g')
// 1차 출처 정본에 2차 data 변수를 더한다. 결제 계정 data 는 서버가 폼 값을 칸별로 짠 객체, 호실 일괄 편집은 허용 칸 표를 거친 값이다.
PROVENANCE.data = { decl: [/const data = \{\n\s*type:\s*type as any,\n\s*brand,/, /const data = \{\n\s*type, brand, alias,\n/] }
PROVENANCE.roomFields = { decl: /const roomFields = pickBatchRoomFields\((data|x\.fields)\)/, assignKeys: new Set(['rentUpdateDate']) }

const REL2 = new Map()
{
  let cur = null
  const types = Object.values(SCOPE2_TYPES)
  for (const line of schema.split('\n')) {
    const mm = line.match(/^model\s+(\w+)/)
    if (mm) { cur = mm[1]; continue }
    const fm = cur && line.match(new RegExp(`^\\s+(\\w+)\\s+(${types.join('|')})(\\[\\])?\\??(\\s|$)`))
    if (fm) REL2.set(cur, [...(REL2.get(cur) ?? []), fm[1]])
  }
}
const REL2_NAMES = [...new Set([...REL2.values()].flat())]
if (REL2_NAMES.length === 0) violations.push('스키마에서 2차 모델로 가는 관계 칸을 못 읽었다. 중첩 쓰기 축이 장식이 된다')
const NESTED2_RE = new RegExp(`\\b(${REL2_NAMES.join('|')})\\s*:\\s*(\\{\\s*(${NESTED_OPS})\\b|[A-Za-z_$])`, 'g')

// 허용 칸 표 BATCH_ROOM_FIELDS 를 본다.
{
  const rf = 'app/(app)/room-manage/actions.ts'
  const s = readFileSync(rf, 'utf8')
  const tbl = s.match(/const BATCH_ROOM_FIELDS = (\{[\s\S]*?\}) as const/)
  const block = schema.match(/model Room \{([\s\S]*?)\n\}/)
  if (!tbl || !block) violations.push(`${rf} · BATCH_ROOM_FIELDS 표나 Room 모델을 못 찾았다. 일괄 편집 화이트리스트를 볼 수 없다`)
  else {
    const scalars = new Set([...block[1].matchAll(/^\s+(\w+)\s+(String|Int|Boolean|DateTime|Float|Decimal|Json|BigInt)\??(\s|$)/gm)].map(m => m[1]))
    for (const k of ['id', 'propertyId', 'createdAt', 'updatedAt', 'roomNo', 'isVacant', 'doorMasterKeyEnc', 'showOnSite']) scalars.delete(k)
    for (const m of tbl[1].matchAll(/(\w+)\s*:\s*'/g)) if (!scalars.has(m[1])) violations.push(`${rf} · BATCH_ROOM_FIELDS 에 ${m[1]} 가 있다. 일괄 편집은 위험 칸(id·propertyId·roomNo·isVacant·마스터키·공개)이 아닌 맨 칸만 허용한다`)
    const fn = s.match(/function pickBatchRoomFields\([\s\S]*?\n\}/)
    if (!fn || !/for \(const \[key, kind\] of Object\.entries\(BATCH_ROOM_FIELDS\)\)/.test(fn[0]) || !/typeof v !== base/.test(fn[0]) || /\.\.\.\s*s\b|Object\.assign\(\s*out\s*,\s*s/.test(fn[0])) {
      violations.push(`${rf} · pickBatchRoomFields 가 BATCH_ROOM_FIELDS 표만 돌며 형을 보는 꼴이 아니다. 화면 객체가 통째로 넘어간다`)
    }
  }
}

const count2 = Object.fromEntries(Object.keys(SCOPE2).map(k => [k, { where: 0, data: 0 }]))
let revertCalls = 0
for (const file of [...walk('app', []), ...walk('lib', [])]) {
  const src = readFileSync(file, 'utf8')
  const lineOf = idx => src.slice(0, idx).split('\n').length
  for (const m of src.matchAll(ALIAS2_RE)) {
    const model = m[2] ?? m[3]
    if (SCOPE2[model]?.files && !SCOPE2[model].files.includes(file)) continue
    violations.push(`${file}:${lineOf(m.index)} · prisma·tx 의 ${model} 대리자를 변수에 담거나 구조분해한다. 별칭을 거치면 이 그물이 쓰기를 못 본다`)
  }
  // 재고 되돌리기 공용층은 언제나 영업장을 받는다.
  for (const m of src.matchAll(/\brevertShiftRows\(\s*tx\s*,\s*([^,)]+)/g)) {
    revertCalls++
    if (m[1].trim() !== 'propertyId' && !file.endsWith('ledgerShift.ts')) violations.push(`${file}:${lineOf(m.index)} · revertShiftRows 둘째 인자가 영업장(propertyId)이 아니다(${m[1].trim()})`)
  }
  for (const m of src.matchAll(CALL2_RE)) {
    const [model, op] = [m[1], m[2]]
    const cfg = SCOPE2[model]
    if (cfg.files && !cfg.files.includes(file)) continue
    const open = m.index + m[0].length - 1
    const close = matchClose(src, open)
    const at = `${file}:${lineOf(m.index)} ${model}.${op}`
    if (close < 0) { violations.push(`${at} · 호출 괄호를 못 읽었다. 못 읽으면 통과가 아니라 위반이다`); continue }
    const arg = src.slice(open + 1, close).trim()
    body = src.slice(fnStartOf(src, m.index), m.index)
    if (WHERE_OPS.includes(op) || op === 'updateManyAndReturn') {
      count2[model].where++
      const w = topLevel(arg, 'where')
      if (!w) violations.push(`${at} · where 를 못 찾았다. 영업장 범위를 볼 수 없다`)
      else if (w.raw != null) violations.push(`${at} · where 를 변수(${w.raw})로 넘겨 영업장 범위를 못 읽는다`)
      else if (cfg.parent) {
        const rel = topLevel(w.obj, cfg.parent)
        if (!rel?.obj || !topLevel(rel.obj, 'propertyId')) violations.push(`${at} · where 에 부모 관계 필터(${cfg.parent}: { propertyId })가 없다. 다른 영업장 행을 바꿀 수 있다`)
      } else if (!topLevel(w.obj, 'propertyId')) violations.push(`${at} · where 최상위에 propertyId 가 없다(id 만으로 쓴다). 다른 영업장 id 로 그 행을 바꿀 수 있다`)
    }
    if (op.startsWith('create') || op.startsWith('update') || op === 'upsert') {
      count2[model].data++
      const needProperty = op.startsWith('create') && !cfg.parent
      const allow = ALLOW_RAW2.find(a => a.file === file && a.model === model)
      if (op === 'upsert') {
        checkData(`${at}(create)`, topLevel(arg, 'create'), { needProperty: !cfg.parent })
        checkData(`${at}(update)`, topLevel(arg, 'update'), { needProperty: false })
      } else checkData(at, topLevel(arg, 'data'), { needProperty, allowRaw: allow?.raw })
    }
  }
  for (const m of src.matchAll(ANY_WRITE_RE)) {
    const [model, op] = [m[1], m[2]]
    const open = m.index + m[0].length - 1
    const close = matchClose(src, open)
    if (close < 0) continue
    const arg = src.slice(open + 1, close)
    const parts = op === 'upsert' ? [topLevel(arg, 'create'), topLevel(arg, 'update')] : [topLevel(arg, 'data')]
    for (const part of parts) {
      const text = part?.obj ?? part?.raw ?? ''
      for (const n of text.matchAll(NESTED2_RE)) {
        violations.push(`${file}:${lineOf(m.index)} ${model}.${op} · data 의 ${n[1]}: ${n[3] ?? '(변수)'} 로 2차 모델을 중첩해서 쓴다. 영업장 범위를 비켜 간다. 그 모델을 직접 부른다`)
      }
    }
  }
}
for (const [model, c] of Object.entries(count2)) {
  const e = EXPECTED2[model]
  if (c.where !== e.where || c.data !== e.data) violations.push(`${model} 쓰기가 where ${c.where}·data ${c.data}곳이다(고정 where ${e.where}·data ${e.data}). 새 쓰기를 더했거나 정규식이 낡았다. 범위를 확인하고 EXPECTED2 를 함께 고친다`)
}
if (revertCalls < 7) violations.push(`revertShiftRows 호출이 ${revertCalls}곳만 보인다(7곳 이상). 정규식이 낡았다`)

if (whereCount !== EXPECTED.where) violations.push(`where 를 거는 쓰기가 ${whereCount}곳이다(고정 ${EXPECTED.where}). 새 쓰기를 더했거나 정규식이 낡았다. 범위를 확인하고 EXPECTED 를 함께 고친다`)
if (dataCount !== EXPECTED.data) violations.push(`data 를 싣는 쓰기가 ${dataCount}곳이다(고정 ${EXPECTED.data}). 새 쓰기를 더했거나 정규식이 낡았다. 펼침을 확인하고 EXPECTED 를 함께 고친다`)

const w2 = Object.values(count2).reduce((s, c) => s + c.where, 0), d2 = Object.values(count2).reduce((s, c) => s + c.data, 0)
console.log(`[영업장 범위] 함수 ${AXES.length}개 + 기타수익·고정지출 쓰기 where ${whereCount}곳·data ${dataCount}곳 + 관계 칸 ${REL_NAMES.length}개 + 2차 묶음 ${Object.keys(SCOPE2).length}모델 where ${w2}곳·data ${d2}곳·관계 칸 ${REL2_NAMES.length}개 검사 / 위반 ${violations.length}건`)
for (const v of violations) console.log(`  - ${v}`)
process.exit(violations.length ? 1 : 0)
