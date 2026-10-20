// 비품 보관 위치 축(storedLocationId) 순수층 진리표. 후보 순서·미리 고르기·불변식·저장 규칙·목적지 키·문구·토큰·집계 키. 실패 시 exit 1.
// 실행: npx tsx scripts/test-asset-storage.ts
//
// 2026-10-19 신고 195e05c8("왜 여기에는 415호 창고가 없어?")·09ec10aa("어떤 창고에 보관중인지는 표시가 되어야"), 운영자 승인안.
// 실제 쓰기(수령·옮기기·되돌리기·접기·폐기·적용취소 바이트 동일·남의 영업장)는 통합 하네스 test-asset-receipt-flow 의 ST 절이 본다.
import {
  storageCandidates, defaultStorageId, canHoldStorage, storedForSave, storeKey, parseStoreKey, logPlaceLabel, storedPlaceLabel,
  STORE_GROUP_LABEL, STORE_UNKNOWN_OPTION, STORE_UNKNOWN_HEAD, UNASSIGNED_PLACE,
} from '../app/(app)/inventory/assets/storagePlace'
import {
  receiptAssignCopy, receiptToast, plainReceiveToast, partialReceiveToast, SEP,
  parseAssetUnreceiveUndo, canonicalAssetUnreceiveUndo, parseAssetFreeUndo, canonicalAssetFreeUndo, parseAssetReceiptUndo, type ReceiptPlan, type AssetReceiptUndo,
} from '../app/(app)/inventory/assets/receiptPlacement'
import { aggregateAssets, type RawAsset } from '../app/(app)/inventory/assets/aggregate'
import { roomsLabel, roomChipText } from '../app/(app)/finance/allocPlaceLabel'

let pass = 0, fail = 0
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; return }
  fail++
  console.log(`  실패 ${name}\n    기대 ${w}\n    실제 ${g}`)
}

// ① 낱말(운영자 승인안 그대로)
eq('① 무리 이름', STORE_GROUP_LABEL, '여분으로 보관 (배정 안 함)')
eq('① 모름 선택지', STORE_UNKNOWN_OPTION, '보관 위치 모름')
eq('① 미정 묶음 머리', STORE_UNKNOWN_HEAD, '보관 위치 미정')
eq('① 보관 자리 이름', storedPlaceLabel('4층 415호 창고'), '4층 415호 창고 보관')
eq('① 보관 위치 없는 미배정 자리 이름(종전)', UNASSIGNED_PLACE, '미배정(여분)')

// ② 후보 순서·미리 고르기. 기본 창고 먼저, 나머지는 받은 차례(트리 DFS) 그대로. 하드코딩 없음.
const L = (id: string, isHub = false) => ({ id, pathName: id, isHub })
eq('② 기본 창고가 맨 앞', storageCandidates([L('a'), L('b'), L('hub', true), L('c')]).map(r => r.id), ['hub', 'a', 'b', 'c'])
eq('② 기본 창고가 없으면 차례 그대로', storageCandidates([L('a'), L('b')]).map(r => r.id), ['a', 'b'])
eq('② 0곳이면 빈 목록', storageCandidates([]), [])
eq('② 기본 창고 하나면 미리 고른다', defaultStorageId([L('a'), L('hub', true)]), 'hub')
eq('② 기본 창고가 없으면 미리 고르지 않는다', defaultStorageId([L('a'), L('b')]), null)
eq('② 기본 창고가 여럿이면 미리 고르지 않는다(모호)', defaultStorageId([L('h1', true), L('h2', true)]), null)

// ③ 불변식. 받은 + 안 놓인 행만.
const row = (o: Partial<{ receivedAt: string | null; roomId: string | null; assignedLocationId: string | null; isCommonAsset: boolean }>) =>
  ({ receivedAt: '2026-10-19', roomId: null, assignedLocationId: null, isCommonAsset: false, ...o })
eq('③ 받은 미배정은 가진다', canHoldStorage(row({})), true)
eq('③ 수령 전은 못 가진다', canHoldStorage(row({ receivedAt: null })), false)
eq('③ 방 배정은 못 가진다', canHoldStorage(row({ roomId: 'r' })), false)
eq('③ 공용부 배정은 못 가진다', canHoldStorage(row({ assignedLocationId: 'l' })), false)
eq('③ 공용 자재는 못 가진다(승인안: 공용 자재로 가면 비운다)', canHoldStorage(row({ isCommonAsset: true })), false)

// ④ 재무 저장 규칙. 폼은 이 칸을 안 받는다. 저장 뒤 받은 + 안 놓인 비품이면 지키고 아니면 비운다.
const sv = (o: Partial<Parameters<typeof storedForSave>[0]>) => storedForSave({ durableGoods: true, received: true, roomId: null, assignedLocationId: null, isCommonAsset: false, existingStored: 'S', ...o })
eq('④ 그대로 저장은 지킨다', sv({}), 'S')
eq('④ 방을 고르면 비운다', sv({ roomId: 'r' }), null)
eq('④ 소모품(비품 아님)이 되면 비운다', sv({ durableGoods: false }), null)
eq('④ 수령 전이면 비운다', sv({ received: false }), null)
eq('④ 공용부에 놓인 행은 비운다', sv({ assignedLocationId: 'l' }), null)
eq('④ 원래 없으면 없다', sv({ existingStored: null }), null)

// ⑤ 목적지 키
eq('⑤ 보관 키', storeKey('x'), 'store:x')
eq('⑤ 모름 키', storeKey(null), 'store:')
eq('⑤ 키 읽기', [parseStoreKey('store:x'), parseStoreKey('store:'), parseStoreKey('room:1'), parseStoreKey('')], [{ id: 'x' }, { id: null }, null, null])
eq('⑤ 이력 표기: 보관', logPlaceLabel('storage', '4층 415호 창고'), '4층 415호 창고 보관')
eq('⑤ 이력 표기: 미배정 라벨은 그대로(되찾기 열쇠)', [logPlaceLabel('none', '미배정'), logPlaceLabel('none', null), logPlaceLabel('room', '519호')], ['미배정', '미배정', '519호'])

// ⑥ 수령 문구. 보관 위치를 고르면 배정 안 한 몫이 거기 놓인다고 말한다. 안 고르면 종전 그대로(무회귀).
const single: ReceiptPlan = { kind: 'single', room: { roomId: 'r', roomNo: '519', units: 1 }, units: 1, total: 1, partial: false }
const some: ReceiptPlan = { kind: 'some', room: { roomId: 'r', roomNo: '519', units: 1 }, targeted: 1, total: 3 }
const amb: ReceiptPlan = { kind: 'ambiguous', units: 1, total: 2 }
const NB = ' '
eq('⑥ F2 단일: 수령만 하면 창고에', receiptAssignCopy(single, '냉장고', '개', '4층 415호 창고')?.message, `구매할 때 519호로 적었습니다. 수령만 하면 4층 415호 창고에${NB}둡니다.`)
eq('⑥ F2 단일: 안 고르면 종전 미배정', receiptAssignCopy(single, '냉장고', '개')?.message, `구매할 때 519호로 적었습니다. 수령만 하면 미배정에${NB}둡니다.`)
eq('⑥ F2 일부: 나머지는 창고에', receiptAssignCopy(some, '의자', '개', '선반')?.message?.endsWith(`나머지 2개는 선반에${NB}둡니다.`), true)
eq('⑥ 토스트 수령만: 보관 자리', receiptToast(single, 'receive', '개', '4층 415호 창고')?.text, `수령 완료${SEP}4층 415호 창고 보관`)
eq('⑥ 토스트 수령만: 종전 미배정', receiptToast(single, 'receive', '개')?.text, `수령 완료${SEP}미배정`)
eq('⑥ 토스트 배정: 배정 몫에는 보관 위치가 안 선다', receiptToast(single, 'assign', '개', '창고')?.text, `수령 완료${SEP}519호${NB}배정`)
eq('⑥ 토스트 일부 배정: 나머지는 창고에', receiptToast(some, 'assign', '개', '창고')?.detail, '나머지 2개는 창고에 두었습니다.')
eq('⑥ 토스트 몫이 갈린 부분 도착', [receiptToast(amb, 'receive', '개', '창고')?.text, receiptToast(amb, 'receive', '개', '창고')?.detail], [`1개 수령 완료${SEP}창고 보관`, `어느 방 몫인지 정할 수 없어 창고에 두었습니다. 미배정 카드에서 배정해${NB}주세요.`])
eq('⑥ 묻지 않은 전량 수령', [plainReceiveToast('창고'), plainReceiveToast(null)], [`수령 완료${SEP}창고 보관`, '수령 완료'])
eq('⑥ 묻지 않은 부분 수령', [partialReceiveToast(2, 1, '개', '창고').text, partialReceiveToast(2, 1, '개').text], [`2개 수령 완료${SEP}창고 보관`, '2개 수령 완료'])

// ⑦ 토큰 모양. 수령 토큰은 보관 위치를 실어야 하고 놓인 행·조각에는 보관 위치가 없다. 수령 대기로·무상 입수 토큰.
const tok = (o: Partial<AssetReceiptUndo['received'][number]['now']> = {}, assigned = false): unknown => ({ v: 1, at: '2026-10-19T00:00:00.000Z', received: [{ id: 'r', assigned, prevAssignedAt: null, now: { roomId: assigned ? 'R' : null, isCommonAsset: false, itemLabel: 'x', qtyValue: 1, amount: 1, storedLocationId: 'S', ...o } }], split: [], created: [], logIds: [] })
eq('⑦ 수령 토큰 정상', !!parseAssetReceiptUndo(tok()), true)
eq('⑦ 수령 토큰에 보관 위치 칸이 없으면(옛 모양) 거부', parseAssetReceiptUndo({ ...(tok() as object), received: [{ id: 'r', assigned: false, prevAssignedAt: null, now: { roomId: null, isCommonAsset: false, itemLabel: 'x', qtyValue: 1, amount: 1 } }] }), null)
eq('⑦ 배정한 행에 보관 위치가 있는 토큰 거부', parseAssetReceiptUndo(tok({}, true)), null)
const ur = { v: 1 as const, rows: [{ id: 'e', receivedAt: '2026-10-19T00:00:00.000Z', storedLocationId: 'S' }] }
eq('⑦ 수령 대기로 토큰 정상', !!parseAssetUnreceiveUndo(ur), true)
eq('⑦ 수령 대기로 토큰 정본 문자열', canonicalAssetUnreceiveUndo(ur), JSON.stringify([1, [['e', '2026-10-19T00:00:00.000Z', 'S']]]))
eq('⑦ 수령 대기로 토큰: 빈 행·중복·날짜 거부', [parseAssetUnreceiveUndo({ v: 1, rows: [] }), parseAssetUnreceiveUndo({ v: 1, rows: [ur.rows[0], ur.rows[0]] }), parseAssetUnreceiveUndo({ v: 1, rows: [{ ...ur.rows[0], receivedAt: 'x' }] })], [null, null, null])
const fu = { v: 1 as const, id: 'e', at: '2026-10-19T00:00:00.000Z', storedLocationId: 'S', qtyValue: 1, itemLabel: 'x', specValue: null, specUnit: null, specText: null }
eq('⑦ 무상 입수 토큰(등록 직후 모양을 싣는다, 검수 R1)', [!!parseAssetFreeUndo(fu), parseAssetFreeUndo({ ...fu, id: '' }), parseAssetFreeUndo({ ...fu, v: 2 }), parseAssetFreeUndo({ v: 1, id: 'e' }), parseAssetFreeUndo({ ...fu, at: 'x' })], [true, null, null, null, null])
eq('⑦ 무상 입수 토큰 정본 문자열', canonicalAssetFreeUndo(fu), JSON.stringify([1, 'e', '2026-10-19T00:00:00.000Z', 'S', 1, 'x', null, null, null]))

// ⑧ 집계 키. 같은 품목이라도 보관 위치가 다르면 다른 카드. 보관 위치가 없는 행끼리는 종전대로 한 카드(무회귀).
const raw = (id: string, stored: string | null, name: string | null = stored): RawAsset => ({
  id, date: '2026-10-19', itemLabel: 'TV 겸용 모니터', amount: 100, qtyValue: 1, qtyUnit: '개', specValue: null, specUnit: null, specText: null,
  category: '수선유지비', vendor: null, roomId: null, roomNo: null, locationId: null, locationName: null, isCommon: false, received: true,
  assignedAt: null, isService: false, disposedAt: null, disposalReason: null, allocationGroupId: null, storedLocationId: stored, storedLocationName: name,
})
const agg = aggregateAssets([raw('1', 'H', '4층 415호 창고'), raw('2', 'H', '4층 415호 창고'), raw('3', 'S', '선반'), raw('4', null), raw('5', null)])
eq('⑧ 보관 위치별 카드', agg.map(a => [a.storedLocationName, a.qtyValue]).sort(), [[null, 2], ['4층 415호 창고', 2], ['선반', 1]].sort())
eq('⑧ 보관 위치가 없는 행만이면 한 카드(종전과 같다)', aggregateAssets([raw('4', null), raw('5', null)]).length, 1)

// ⑨ 재무 방별 분배 라벨. 미배정 몫을 보관 위치마다 '{위치} 보관 N개', 없는 몫은 종전 '미배정 N개'. 칩은 배정 축이라 그대로.
const ar = (o: Partial<Parameters<typeof roomsLabel>[0][number]>) => ({ room: null, assignedLocationName: null, qtyValue: 1, qtyUnit: '개', plannedRoomNo: null, storedLocationName: null, ...o })
eq('⑨ 방 + 창고 보관', roomsLabel([ar({ room: { roomNo: '519' } }), ar({ storedLocationName: '4층 415호 창고', qtyValue: 2 })]), '519호·4층 415호 창고 보관 2개')
eq('⑨ 창고 보관 + 미기록', roomsLabel([ar({ storedLocationName: '창고' }), ar({})]), '창고 보관 1개·미배정 1개')
eq('⑨ 보관 위치 없는 묶음은 종전 그대로', roomsLabel([ar({ room: { roomNo: '519' } }), ar({ qtyValue: 3 })]), '519호·미배정 3개')
eq('⑨ 칩은 배정 축(보관만이면 미배정)', roomChipText([ar({ storedLocationName: '창고' })]), '미배정')

console.log(`[비품 보관 위치 진리표] 통과 ${pass}건 · 실패 ${fail}건`)
process.exit(fail ? 1 : 0)
