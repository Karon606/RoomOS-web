// 비품 수령·배정 예정 호실·소모품 수량 관문 판정 진리표. 실행: npx tsx scripts/test-asset-receipt.ts
//
// 2026-10-15 냉장고 519호 건(계획서 비품-전환-배정 1단계 S1~S5). 고정하는 것.
//   · S1 비품 수령은 소모품 id 를 거부한다(받음·수령 대기로 둘 다, 낡은 화면).
//   · S3 수량이 빈 추적 구매는 수량을 채운 뒤에만 받는다(유령수령 봉합).
//   · S4 수령 전 비품 물품의 자리는 배정 예정 호실(targetRoomId) 하나뿐이다. 비품이 아니면 비운다.
//   · S5 받을 때 배정을 물을지·문구·토스트는 UX 패널 F2 대사 그대로다. 몫이 갈리는 부분 도착은 묻지 않는다.
import {
  assetReceiptDenial, ASSET_RECEIPT_DENY_TRACKED, ASSET_RECEIPT_DENY_STALE,
  isDurableGoods, placementForSave, plannedRoomsMeta,
  assignDenialUnreceived, unreceiveDenialPlaced, ASSET_ASSIGN_DENY_UNRECEIVED, ASSET_UNRECEIVE_DENY_PLACED,
  receiptPlacementPlan, planAsks, planTargetOf, receiptAssignCopy, receiptToast, type ReceiptRow,
  isPlaceable, PLACEABLE_WHERE, planExpectOf, planExpectMismatch, parseAssetReceiptUndo, canonicalAssetReceiptUndo,
  restPendingAsk, restPendingDone, partialReceiveToast, pendingPlaceCaption, ASSET_ASSIGN_PENDING_REASON,
  ASSET_RECEIPT_ASSIGN_UNDONE, type AssetReceiptUndo,
} from '../app/(app)/inventory/assets/receiptPlacement'
import { isUnplaced } from '../app/(app)/inventory/assets/aggregate'
import { isUnplaced as rpIsUnplaced } from '../app/(app)/inventory/assets/receiptPlacement'
import { receiptNeedsQty, qtyMissing, normalizeFillQty, fillQtyUnit, fillDetail, receiptQtyRequiredMany, RECEIPT_QTY_REQUIRED, qtyFillShapeOk, canonicalQtyFill, INVENTORY_RECEIPT_DENY_UNTRACKED } from '../app/(app)/inventory/receiptQtyGate'
import { roomsLabel, roomChipText } from '../app/(app)/finance/allocPlaceLabel'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fails.push(`${name}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
}
const TRACKED = ['부식비', '소모품비', '폐기물 처리비']

// ── S1 소모품 거부 ─────────────────────────────────────────────────
eq('S1 비품 모집단 안이면 통과', assetReceiptDenial(['a'], [{ id: 'a', category: '수선유지비' }], new Set(['a']), TRACKED), null)
eq('S1 소모품 id 는 거부(소모품 문구)', assetReceiptDenial(['a'], [{ id: 'a', category: '소모품비' }], new Set(), TRACKED), ASSET_RECEIPT_DENY_TRACKED)
eq('S1 섞여 있어도 소모품이 먼저', assetReceiptDenial(['a', 'b'], [{ id: 'a', category: '수선유지비' }, { id: 'b', category: '부식비' }], new Set(['a']), TRACKED), ASSET_RECEIPT_DENY_TRACKED)
eq('S1 영업장에 없는 id 는 낡은 화면', assetReceiptDenial(['a', 'x'], [{ id: 'a', category: '수선유지비' }], new Set(['a']), TRACKED), ASSET_RECEIPT_DENY_STALE)
eq('S1 모집단 밖(배송비 등)도 낡은 화면', assetReceiptDenial(['a'], [{ id: 'a', category: '수선유지비' }], new Set(), TRACKED), ASSET_RECEIPT_DENY_STALE)
eq('S1 같은 id 두 번은 하나로 센다', assetReceiptDenial(['a', 'a'], [{ id: 'a', category: '수선유지비' }], new Set(['a']), TRACKED), null)
eq('S1 문구(운영자 승인)', ASSET_RECEIPT_DENY_TRACKED, '소모품으로 바뀐 품목입니다. 새로고침한 뒤 재고 화면에서 수령해 주세요.')

// ── S3 소모품 수량 관문 ────────────────────────────────────────────
const tr = (o: Partial<{ category: string; itemLabel: string | null; excludeFromInventory: boolean; isShipping: boolean; qtyValue: number | null }>) =>
  ({ category: '소모품비', itemLabel: '냉장고', excludeFromInventory: false, isShipping: false, qtyValue: null, ...o })
eq('S3 추적 품목·수량 없음 = 묻는다', receiptNeedsQty(tr({}), TRACKED), true)
eq('S3 수량 0 도 없음', receiptNeedsQty(tr({ qtyValue: 0 }), TRACKED), true)
eq('S3 수량 음수도 없음', receiptNeedsQty(tr({ qtyValue: -1 }), TRACKED), true)
eq('S3 수량 있으면 안 묻는다', receiptNeedsQty(tr({ qtyValue: 1 }), TRACKED), false)
eq('S3 비품 카테고리는 대상 아님', receiptNeedsQty(tr({ category: '수선유지비' }), TRACKED), false)
eq('S3 재고 제외는 대상 아님(축 3 과 같은 축)', receiptNeedsQty(tr({ excludeFromInventory: true }), TRACKED), false)
eq('S3 배송비는 대상 아님', receiptNeedsQty(tr({ isShipping: true }), TRACKED), false)
eq('S3 품명 없으면 대상 아님', receiptNeedsQty(tr({ itemLabel: null }), TRACKED), false)
eq('S3 qtyMissing 은 서버 판정과 같은 셈', [qtyMissing(null), qtyMissing(undefined), qtyMissing(0), qtyMissing(0.5)], [true, true, true, false])
eq('S3 채울 수량. 문자열·소수 셋째 자리', [normalizeFillQty('2'), normalizeFillQty('1.23456'), normalizeFillQty(3)], [2, 1.235, 3])
eq('S3 채울 수량. 0·빈 값·문자·무한은 null', [normalizeFillQty('0'), normalizeFillQty(''), normalizeFillQty('abc'), normalizeFillQty(Infinity), normalizeFillQty(undefined), normalizeFillQty(-2)], [null, null, null, null, null, null])
eq('S3 단위. 구매 단위가 먼저', fillQtyUnit('박스', '개'), '박스')
eq('S3 단위. 없으면 카드 단위', fillQtyUnit(null, '개'), '개')
eq('S3 단위. 둘 다 없으면 비운다(지어내지 않는다)', fillQtyUnit(null, null), null)
const dRow = { itemLabel: '갈란츠 미니 1도어 냉장고', specValue: 70, specUnit: 'L', specText: '실버', qtyUnit: null }
eq('S3 세부. 자동 형식이면 수량을 덧붙인다', fillDetail('[갈란츠 미니 1도어 냉장고] 실버', dRow, 1, '개'), '[갈란츠 미니 1도어 냉장고] 실버 x 1개')
eq('S3 세부. 단위 없으면 숫자만', fillDetail('[갈란츠 미니 1도어 냉장고] 실버', dRow, 2, null), '[갈란츠 미니 1도어 냉장고] 실버 x 2')
eq('S3 세부. 사람이 고친 세부는 그대로', fillDetail('519호 냉장고', dRow, 1, '개'), '519호 냉장고')
eq('S3 여러 건 문구', receiptQtyRequiredMany(2), '구매 수량이 빈 구매 2건이 있어 한 번에 수령하지 않습니다. 재고 화면에서 도착 수량을 적고 수령해 주세요.')
eq('S3 거부 문구', RECEIPT_QTY_REQUIRED, '구매 수량이 비어 있어 재고에 넣을 수 없습니다. 도착 수량을 적고 수령해 주세요.')

// ── S4 배정 예정 호실 저장 규칙 ─────────────────────────────────────
const g = (o: Partial<{ category: string; excludeFromInventory: boolean; itemLabel: string | null; isShipping: boolean }>) =>
  ({ category: '수선유지비', excludeFromInventory: false, itemLabel: '냉장고', isShipping: false, ...o })
eq('S4 비품 물품', isDurableGoods(g({}), TRACKED), true)
eq('S4 소모품은 비품 아님', isDurableGoods(g({ category: '소모품비' }), TRACKED), false)
eq('S4 서비스(재고 제외)는 비품 물품 아님', isDurableGoods(g({ excludeFromInventory: true }), TRACKED), false)
eq('S4 배송비는 아님', isDurableGoods(g({ isShipping: true }), TRACKED), false)
eq('S4 품명 없으면 아님', isDurableGoods(g({ itemLabel: null }), TRACKED), false)
const P = (o: Partial<Parameters<typeof placementForSave>[0]>) => placementForSave({ durableGoods: true, received: false, roomId: null, formTarget: undefined, existingTarget: null, ...o })
eq('S4 받기 전 비품 + 배정할 호실 = 예정에만', P({ formTarget: 'R519' }), { roomId: null, targetRoomId: 'R519' })
eq('S4 받기 전 비품에 roomId 가 실려 오면 예정으로 옮긴다(지우지 않는다)', P({ roomId: 'R519' }), { roomId: null, targetRoomId: 'R519' })
eq('S4 받기 전 비품 · 칸 비움 = 비운다', P({ formTarget: null, existingTarget: 'R519' }), { roomId: null, targetRoomId: null })
eq('S4 받기 전 비품 · 칸 부재 = 원래 값 보존', P({ existingTarget: 'R519' }), { roomId: null, targetRoomId: 'R519' })
eq('S4 받은 비품 = roomId 그대로, 예정 보존(칸 무시)', P({ received: true, roomId: 'R404', formTarget: 'R520', existingTarget: 'R519' }), { roomId: 'R404', targetRoomId: 'R519' })
eq('S4 비품 물품이 아니면 예정 비움, roomId 는 대상 호실', P({ durableGoods: false, roomId: 'R519', formTarget: 'R520', existingTarget: 'R521' }), { roomId: 'R519', targetRoomId: null })
eq('S4 카드 메타 한 방', plannedRoomsMeta(['519']), '519호 배정 예정')
eq('S4 카드 메타 두 방(중복 접기)', plannedRoomsMeta(['519', '520', '519', null]), '519호·520호 배정 예정')
eq('S4 카드 메타 넷 이상 접기', plannedRoomsMeta(['501', '502', '503', '504']), '501호·외 3곳 배정 예정')
eq('S4 카드 메타 숫자 아닌 방', plannedRoomsMeta(['사무실']), '사무실 배정 예정')
eq('S4 카드 메타 없음', plannedRoomsMeta([null]), null)
eq('S4 수령 전 물품 배정 거부', assignDenialUnreceived([{ receivedAt: null, excludeFromInventory: false }]), ASSET_ASSIGN_DENY_UNRECEIVED)
eq('S4 서비스는 수령 개념 없음(통과)', assignDenialUnreceived([{ receivedAt: null, excludeFromInventory: true }]), null)
eq('S4 받은 물품 배정 통과', assignDenialUnreceived([{ receivedAt: new Date(), excludeFromInventory: false }]), null)
eq('S4 놓인 물품 수령 대기로 거부(방)', unreceiveDenialPlaced([{ roomId: 'R', assignedLocationId: null, isCommonAsset: false, excludeFromInventory: false }]), ASSET_UNRECEIVE_DENY_PLACED)
eq('S4 놓인 물품 수령 대기로 거부(공용부)', unreceiveDenialPlaced([{ roomId: null, assignedLocationId: 'L', isCommonAsset: false, excludeFromInventory: false }]), ASSET_UNRECEIVE_DENY_PLACED)
eq('2차 R3 공용 자재도 놓인 것(수령 대기로 거부)', unreceiveDenialPlaced([{ roomId: null, assignedLocationId: null, isCommonAsset: true, excludeFromInventory: false }]), ASSET_UNRECEIVE_DENY_PLACED)
eq('S4 미배정 물품 수령 대기로 통과', unreceiveDenialPlaced([{ roomId: null, assignedLocationId: null, isCommonAsset: false, excludeFromInventory: false }]), null)
eq('2차 R3 화면·서버가 부르는 isUnplaced 는 집계 정본 그 함수', rpIsUnplaced === isUnplaced, true)
eq('S4 재무 라벨. 예정만', [roomChipText([{ room: null, plannedRoomNo: '519', qtyValue: 2 }]), roomsLabel([{ room: null, plannedRoomNo: '519', qtyValue: 2 }])], ['방 1개 예정', '519호 배정 예정'])
eq('S4 재무 라벨. 배정된 방 + 예정 + 미배정', roomsLabel([{ room: { roomNo: '404' } }, { room: null, plannedRoomNo: '519' }, { room: null, qtyValue: 1, qtyUnit: '개' }]), '404호·519호 배정 예정·미배정 1개')
eq('S4 재무 칩. 배정된 방이 있으면 방 수', roomChipText([{ room: { roomNo: '404' } }, { room: null, plannedRoomNo: '519' }]), '방 1개')
eq('S4 재무 라벨 무회귀. 예정 없는 묶음은 종전 그대로', roomsLabel([{ room: { roomNo: '101' } }, { room: null, qtyValue: 4, qtyUnit: '개' }]), '101호·미배정 4개')

// ── S5 수령 배정(F2) 판정 ──────────────────────────────────────────
const row = (id: string, units: number, target: string | null, unplaced = true, alive = true): ReceiptRow =>
  ({ id, units, targetRoomId: target ? `R${target}` : null, targetRoomNo: target && alive ? target : null, unplaced })
eq('F2 예정 없음 = 묻지 않음', receiptPlacementPlan([row('a', 1, null)], null), { kind: 'none' })
eq('F2 지운 방 = 묻지 않음', receiptPlacementPlan([row('a', 1, '519', true, false)], null), { kind: 'none' })
eq('F2 이미 놓인 행 = 묻지 않음', receiptPlacementPlan([row('a', 1, '519', false)], null), { kind: 'none' })
const single = receiptPlacementPlan([row('a', 1, '519')], null)
eq('F2 단일 호실', single, { kind: 'single', room: { roomId: 'R519', roomNo: '519', units: 1 }, units: 1, total: 1, partial: false })
const partial = receiptPlacementPlan([row('a', 4, '519')], 2)
eq('F2 부분 도착(한 방)', partial, { kind: 'single', room: { roomId: 'R519', roomNo: '519', units: 4 }, units: 2, total: 4, partial: true })
eq('F2 전체 이상 qty 는 전량', receiptPlacementPlan([row('a', 2, '519')], 5).kind === 'single' && (receiptPlacementPlan([row('a', 2, '519')], 5) as { partial: boolean }).partial, false)
const multi = receiptPlacementPlan([row('a', 1, '520'), row('b', 1, '519')], null)
eq('F2 여러 방(방 번호순)', multi, { kind: 'multi', rooms: [{ roomId: 'R519', roomNo: '519', units: 1 }, { roomId: 'R520', roomNo: '520', units: 1 }], units: 2, rest: 0 })
const some = receiptPlacementPlan([row('a', 1, '519'), row('b', 1, null)], null)
eq('F2 일부만 호실', some, { kind: 'some', room: { roomId: 'R519', roomNo: '519', units: 1 }, targeted: 1, total: 2 })
eq('F2 부분 도착 + 여러 방 = 창 없음', receiptPlacementPlan([row('a', 1, '519'), row('b', 1, '520')], 1), { kind: 'ambiguous', units: 1, total: 2 })
eq('F2 부분 도착 + 일부만 호실 = 창 없음', receiptPlacementPlan([row('a', 2, '519'), row('b', 2, null)], 2), { kind: 'ambiguous', units: 2, total: 4 })
eq('F2 수량 미기록 행은 1로 센다', (receiptPlacementPlan([row('a', 1, '519'), row('b', 1, '519')], null) as { units: number }).units, 2)
eq('F2 묻는 판정', [single, partial, multi, some].map(planAsks), [true, true, true, true])
eq('F2 묻지 않는 판정', [receiptPlacementPlan([row('a', 1, null)], null), receiptPlacementPlan([row('a', 1, '519'), row('b', 1, '520')], 1)].map(planAsks), [false, false])
eq('F2 놓을 방. 살아 있는 예정 + 안 놓인 행만', [planTargetOf(row('a', 1, '519')), planTargetOf(row('b', 1, '519', false)), planTargetOf(row('c', 1, '519', true, false)), planTargetOf(row('d', 1, null))], ['R519', null, null, null])

// 문구. UX 패널 F2 대사 그대로(품명 '갈란츠 미니 1도어 냉장고', 단위 '개')
const L = '갈란츠 미니 1도어 냉장고'
eq('F2 단일 문구', receiptAssignCopy(single, L, '개'), {
  title: "'갈란츠 미니 1도어 냉장고'를 519호에 배정할까요?",
  message: '구매할 때 519호로 적었습니다. 수령만 하면 미배정에 둡니다.',
  confirmLabel: '519호에 배정', altLabel: '수령만',
})
eq('F2 부분 도착 문구', receiptAssignCopy(partial, L, '개'), {
  title: "'갈란츠 미니 1도어 냉장고' 2개를 519호에 배정할까요?",
  message: '4개 중 2개가 도착했습니다. 나머지 2개는 수령 대기에 둡니다.',
  confirmLabel: '519호에 배정', altLabel: '수령만',
})
eq('F2 여러 방 문구', receiptAssignCopy(multi, L, '개'), {
  title: "'갈란츠 미니 1도어 냉장고' 2개를 적어 둔 방에 배정할까요?",
  message: '구매할 때 519호 1개 · 520호 1개로 적었습니다.',
  confirmLabel: '적은 대로 배정', altLabel: '수령만',
})
eq('F2 일부만 호실 문구', receiptAssignCopy(some, L, '개'), {
  title: "'갈란츠 미니 1도어 냉장고' 2개 중 1개를 519호에 배정할까요?",
  message: '구매할 때 1개만 519호로 적었습니다. 나머지 1개는 미배정에 둡니다.',
  confirmLabel: '519호에 배정', altLabel: '수령만',
})
eq('F2 받침 있는 품명은 을', receiptAssignCopy(single, '책상', '개')?.title, "'책상'을 519호에 배정할까요?")
eq('F2 숫자 아닌 방(사무실로)', receiptAssignCopy(receiptPlacementPlan([{ id: 'a', units: 1, targetRoomId: 'X', targetRoomNo: '사무실', unplaced: true }], null), L, '개')?.message, '구매할 때 사무실로 적었습니다. 수령만 하면 미배정에 둡니다.')
eq('F2 3으로 끝나는 방은 으로', receiptAssignCopy(receiptPlacementPlan([{ id: 'a', units: 1, targetRoomId: 'X', targetRoomNo: '503', unplaced: true }], null), L, '개')?.message, '구매할 때 503호로 적었습니다. 수령만 하면 미배정에 둡니다.')
eq('F2 단위가 장이면 을·이', receiptAssignCopy(partial, L, '장')?.message, '4장 중 2장이 도착했습니다. 나머지 2장은 수령 대기에 둡니다.')
eq('F2 여러 방 + 예정 없는 몫', receiptAssignCopy(receiptPlacementPlan([row('a', 1, '519'), row('b', 1, '520'), row('c', 1, null)], null), L, '개')?.message, '구매할 때 519호 1개 · 520호 1개로 적었습니다. 나머지 1개는 미배정에 둡니다.')
eq('F2 묻지 않는 판정은 문구 없음', receiptAssignCopy({ kind: 'none' }, L, '개'), null)

// 토스트. UX 패널 F2 토스트
eq('F2 토스트 배정(단일)', receiptToast(single, 'assign', '개'), { text: '수령 완료 · 519호 배정', actionLabel: '적용취소' })
eq('F2 토스트 수령만(단일)', receiptToast(single, 'receive', '개'), { text: '수령 완료 · 미배정', actionLabel: '수령 취소' })
eq('F2 토스트 배정(부분)', receiptToast(partial, 'assign', '개'), { text: '2개 수령 완료 · 519호 배정', detail: '나머지 2개는 수령 대기에 두었습니다.', actionLabel: '적용취소' })
eq('F2 토스트 수령만(부분)', receiptToast(partial, 'receive', '개'), { text: '2개 수령 완료 · 미배정', detail: '나머지 2개는 수령 대기에 두었습니다.', actionLabel: '수령 취소' })
eq('F2 토스트 배정(여러 방)', receiptToast(multi, 'assign', '개'), { text: '수령 완료 · 519호·520호 배정', actionLabel: '적용취소' })
eq('F2 토스트 배정(일부만)', receiptToast(some, 'assign', '개'), { text: '수령 완료 · 519호 배정', detail: '나머지 1개는 미배정에 두었습니다.', actionLabel: '적용취소' })
eq('F2 토스트 부분 도착 + 여러 방(창 없음)', receiptToast(receiptPlacementPlan([row('a', 1, '519'), row('b', 1, '520')], 1), 'receive', '개'),
  { text: '1개 수령 완료 · 미배정', detail: '어느 방 몫인지 정할 수 없어 미배정에 두었습니다. 미배정 카드에서 배정해 주세요.', actionLabel: '수령 취소' })
eq('F2 토스트 묻지 않은 수령은 화면 종전 문구(null)', receiptToast({ kind: 'none' }, 'receive', '개'), null)

// ── 검수 반영(2026-10-15 독립 검수·웹디자이너 패스) ─────────────────────────────────
// F-1·F-2 집는 행의 정본. 받은 물품이거나 서비스만 방·공용부에 놓는다
eq('R isPlaceable 받은 물품', isPlaceable({ receivedAt: new Date(), excludeFromInventory: false }), true)
eq('R isPlaceable 서비스', isPlaceable({ receivedAt: null, excludeFromInventory: true }), true)
eq('R isPlaceable 수령 전 물품은 아님', isPlaceable({ receivedAt: null, excludeFromInventory: false }), false)
eq('R PLACEABLE_WHERE 는 같은 판정의 조회 조건', PLACEABLE_WHERE, { OR: [{ receivedAt: { not: null } }, { excludeFromInventory: true }] })
// R-4 안 놓인 행 정본(화면 breakdown·서버 수령이 같은 함수)
eq('R isUnplaced 아무 데도 없음', isUnplaced(null, null, false), true)
eq('R isUnplaced 공용 자재는 놓인 것', isUnplaced(null, null, true), false)
eq('R isUnplaced 방·공용부', [isUnplaced('R', null, false), isUnplaced(null, 'L', false)], [false, false])
// N-4 화면이 본 계획과 서버 계획
const rowsN4 = [row('a', 1, '519'), row('b', 1, null)]
eq('N-4 계획 그대로면 같다', planExpectMismatch(rowsN4, planExpectOf(rowsN4)), false)
eq('N-4 계획 없이 배정 요청은 다르다', planExpectMismatch(rowsN4, undefined), true)
eq('N-4 예정 호실이 바뀌면 다르다', planExpectMismatch([row('a', 1, '520'), row('b', 1, null)], planExpectOf(rowsN4)), true)
eq('N-4 행이 늘면 다르다', planExpectMismatch([...rowsN4, row('c', 1, '519')], planExpectOf(rowsN4)), true)
// N-1 토큰 모양. 이 동작이 만들 수 없는 값은 받지 않는다
const tok: AssetReceiptUndo = { v: 1, at: '2026-10-15T00:00:00.000Z', received: [{ id: 'r1', assigned: true, prevAssignedAt: null, now: { roomId: 'R519', isCommonAsset: false, itemLabel: '의자', qtyValue: 1, amount: 100 } }], split: [{ id: 's1', prevGroupId: null, prevDetail: '[의자] x 4개', now: { qtyValue: 2, amount: 50, groupId: 'g1', itemLabel: '의자' } }], created: [{ id: 'c1', fromId: 's1', roomId: 'R519', isCommonAsset: false, qtyValue: 2, amount: 50 }], logIds: ['l1'] }
eq('N-1 정상 토큰 통과', !!parseAssetReceiptUndo(JSON.parse(JSON.stringify(tok))), true)
eq('N-1 옛 모양(rows·prev 금액) 거부', parseAssetReceiptUndo({ at: tok.at, rows: [{ id: 'x', prev: { amount: 1 } }], created: [], logIds: [] }), null)
eq('N-1 묶음 id 를 다른 값으로 거부', parseAssetReceiptUndo({ ...tok, split: [{ ...tok.split[0], prevGroupId: 'other' }] }), null)
eq('N-1 조각의 원행이 토큰 밖이면 거부', parseAssetReceiptUndo({ ...tok, created: [{ ...tok.created[0], fromId: 'zz' }] }), null)
eq('N-1 배정했다면서 방 없음 거부', parseAssetReceiptUndo({ ...tok, received: [{ ...tok.received[0], now: { ...tok.received[0].now, roomId: null } }] }), null)
eq('N-1 같은 id 두 번 거부', parseAssetReceiptUndo({ ...tok, created: [{ ...tok.created[0], id: 'r1' }] }), null)
eq('N-1 정본 문자열은 키 순서·시각 표기와 무관', canonicalAssetReceiptUndo({ ...tok, at: '2026-10-15T09:00:00+09:00' }), canonicalAssetReceiptUndo(tok))
const fill = { expenseId: 'e', qtyValue: 2, qtyUnit: '포', detail: '[쌀] 20kg x 2포', prevQtyValue: null, prevQtyUnit: null, prevDetail: '[쌀] 20kg' }
eq('N-1 채움 조각 정상', qtyFillShapeOk(fill), true)
eq('N-1 채움 조각 원래 수량 999 거부', qtyFillShapeOk({ ...fill, prevQtyValue: 999 }), false)
eq('N-1 채움 조각 원래 단위가 채운 단위와 다르면 거부', qtyFillShapeOk({ ...fill, prevQtyUnit: '톤' }), false)
eq('N-1 채움 조각 원래 단위 = 채운 단위는 통과', qtyFillShapeOk({ ...fill, prevQtyUnit: '포' }), true)
eq('N-1 채움 정본 문자열(서명 대상)', canonicalQtyFill(fill), JSON.stringify(['e', 2, '포', '[쌀] 20kg x 2포', null, null, '[쌀] 20kg']))
eq('R-2 재고 화면 거부 문구', INVENTORY_RECEIPT_DENY_UNTRACKED, '비품으로 바뀐 품목입니다. 새로고침한 뒤 비품·자재 화면에서 처리해 주세요.')
// D6·D7·D8·D9 문구
eq('D6 나머지 문장 한 벌', [restPendingAsk(2, '개'), restPendingDone(2, '장')], ['나머지 2개는 수령 대기에 둡니다.', '나머지 2장은 수령 대기에 두었습니다.'])
eq('D6 묻지 않은 부분 수령 토스트', partialReceiveToast(2, 3, '개'), { text: '2개 수령 완료', detail: '나머지 3개는 수령 대기에 두었습니다.' })
eq('D8 까닭과 서버 거부는 한 벌', [ASSET_ASSIGN_PENDING_REASON, ASSET_ASSIGN_DENY_UNRECEIVED.startsWith(ASSET_ASSIGN_PENDING_REASON + '.')], ['수령 대기는 수령 완료 뒤 배정합니다', true])
eq('D9 수령 대기 상세 캡션', [pendingPlaceCaption('519호 배정 예정'), pendingPlaceCaption(null)], ['수령 대기 · 519호 배정 예정', '수령 대기 · 수령 완료 뒤 배정'])
eq('R-5 적용취소 결과(§16 형식)', ASSET_RECEIPT_ASSIGN_UNDONE, '수령과 배정을 적용취소했습니다 · 수령 대기로 복귀')
// N-6 재무 묶음 라벨에서 같은 방이 두 번 서지 않는다
eq('N-6 부분 도착 배정 직후', [roomChipText([{ room: { roomNo: '519' }, qtyValue: 2 }, { room: null, plannedRoomNo: '519', qtyValue: 2 }]), roomsLabel([{ room: { roomNo: '519' }, qtyValue: 2 }, { room: null, plannedRoomNo: '519', qtyValue: 2 }])], ['방 1개', '519호·수령 대기 2개'])
eq('N-6 부분 수령만', roomsLabel([{ room: null, qtyValue: 2, qtyUnit: '개' }, { room: null, plannedRoomNo: '519', qtyValue: 2, qtyUnit: '개' }]), '519호 배정 예정 2개·미배정 2개')
eq('N-6 예정 몫뿐이면 꼬리 없이 짧게(묶음 전체가 그 말)', roomsLabel([{ room: null, plannedRoomNo: '519', qtyValue: 2 }, { room: null, plannedRoomNo: '520', qtyValue: 2 }]), '519호·520호 배정 예정')

// 사용자 문자열 지문. em dash·느낌표·이모지·전환 화살표가 없다(§29)
const strings = [
  ...[single, partial, multi, some].flatMap(p => Object.values(receiptAssignCopy(p, L, '개') ?? {})),
  ...[single, partial, multi, some].flatMap(p => (['assign', 'receive'] as const).flatMap(c => Object.values(receiptToast(p, c, '개') ?? {}))),
  ASSET_RECEIPT_DENY_TRACKED, ASSET_RECEIPT_DENY_STALE, ASSET_ASSIGN_DENY_UNRECEIVED, ASSET_UNRECEIVE_DENY_PLACED, RECEIPT_QTY_REQUIRED,
]
eq('§29 지문 0', strings.filter(s => /[\u2014!\u2192]|\p{Extended_Pictographic}/u.test(String(s))), [])

console.log(`\n[비품 수령·배정 예정 호실·수량 관문 진리표] 통과 ${pass}건 · 실패 ${fails.length}건`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
