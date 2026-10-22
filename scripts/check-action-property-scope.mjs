// 서버 액션이 화면에서 온 id 를 영업장 범위로만 읽고 쓰는지 지키는 정적 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가. updateTenant·updateExpense 가 입주자·계약·지출을 id 만으로 읽고 써서, 다른 영업장 id 를
// 넣으면 그 행이 바뀌었다(78bb0141 후속 B7, 운영자 승인 2026-10-13). 고친 뒤 누가 findUnique({ where: { id } })
// 로 되돌려도 아무 그물도 안 울었다(독립 검수 2026-10-13). 같은 클래스 43곳은 별건 감사 대상이고
// (stayeum development/오류신고-정비/권한-영업장범위-감사.md), 봉합하는 함수마다 여기에 축을 더한다.
//
// 실행: node scripts/check-action-property-scope.mjs
import { readFileSync } from 'node:fs'

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
]

for (const ax of AXES) {
  let src = ''
  try { src = readFileSync(ax.file, 'utf8') } catch { violations.push(`${ax.file} — 파일을 못 읽었다. 못 읽으면 통과가 아니라 위반이다`); continue }
  const body = bodyOf(src, ax.fn)
  if (body == null) { violations.push(`${ax.file} — ${ax.fn} 를 못 찾았다. 이름이 바뀌었으면 이 축도 함께 고친다`); continue }
  for (const [re, msg] of ax.must) if (!re.test(body)) violations.push(`${ax.file} ${ax.fn} — ${msg}. 다른 영업장 id 로 그 행을 읽거나 바꿀 수 있다`)
  for (const [re, msg] of ax.mustNot) if (re.test(body)) violations.push(`${ax.file} ${ax.fn} — ${msg}. 영업장 범위를 지나야 한다`)
}

console.log(`[영업장 범위] 함수 ${AXES.length}개 검사 / 위반 ${violations.length}건`)
for (const v of violations) console.log(`  - ${v}`)
process.exit(violations.length ? 1 : 0)
