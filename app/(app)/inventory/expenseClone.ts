// 한 구매 행을 쪼갤 때 새 행이 물려받는 Expense 스칼라 전부(분할 복제 정본, 비품 분할과 소모품 부분 수령이 함께 쓴다).
//
// 왜 한 자리로 묶었나(장부 검수 2026-09-16). 쪼개는 자리가 넷(배정 분할·나눠 배정·비품 부분 수령·소모품 부분 수령)인데
// 각자 목록을 들고 있다가 하나씩 어긋났다. `roomWorkId`·`costKind` 가 빠져 있었고, 종전 방아쇠는
// 대개 작업에 걸리기 전 행에서 터져 드러나지 않았다. **폐기는 정반대로 이미 방에 설치돼 작업에
// 걸린 행을 겨눈다**. 504호 `도배(돌출부) x2회 40,000원` 에서 1회를 폐기하면 그 방 작업 이력의
// 시공비가 20,000으로 줄고, 떨어져 나온 20,000은 작업에 안 걸린 고아 지출이 되어
// check-room-work-link 가 빨개진다. `brand`·`productName`·`vendorBizNo`·`excludeFromAnchor`·
// `targetRoomId`·`breakdownJson` 도 같이 떨어지고 있었다.
//
// 소모품 부분 수령(inventory/actions confirmReceipt)은 2026-10-20 까지 손으로 쓴 목록이었다. 그 목록이 vendorBizNo·brand·
// productName·specText·unitBasis·costKind 를 빠뜨려 실제로 받은 조각에서 사업자번호·브랜드가 사라졌다(재무 패널 실측,
// 신고 a0636f36 맥락). 이제 그 자리도 이 함수를 부른다. 이미 빠진 행은 scripts/fix-clone-field-loss 가 같은 묶음
// 원행에서만 되살리고, scripts/check-clone-field-loss 가 다시 생기는지 본다.
//
// 목록은 여기 하나뿐이고, scripts/check-asset-disposal-wiring 이 **schema.prisma 에서 읽어**
// 대조한다(손으로 세는 단언은 다음 컬럼에서 또 진다). 자동 생성 셋(id·createdAt·updatedAt)만 뺀다.
// 'use server' 파일이 아니다. 서버 액션 파일은 동기 함수를 내보낼 수 없어 두 액션 파일이 함께 쓰려면 여기 있어야 한다.
import type { Prisma } from '@prisma/client'

export type ExpenseRow = Prisma.ExpenseGetPayload<Record<string, never>>

export function cloneExpenseScalars(
  e: ExpenseRow, propertyId: string, over: Partial<Prisma.ExpenseUncheckedCreateInput>,
): Prisma.ExpenseUncheckedCreateInput {
  return {
    date: e.date, amount: e.amount, category: e.category, detail: e.detail,
    vendor: e.vendor, vendorBizNo: e.vendorBizNo, memo: e.memo, payMethod: e.payMethod, settleStatus: e.settleStatus,
    receiptUrl: e.receiptUrl, receiptUrls: e.receiptUrls, financeName: e.financeName,
    targetRoomId: e.targetRoomId, breakdownJson: e.breakdownJson,
    itemLabel: e.itemLabel, costKind: e.costKind, brand: e.brand, productName: e.productName,
    specValue: e.specValue, specUnit: e.specUnit, specText: e.specText, unitBasis: e.unitBasis,
    qtyValue: e.qtyValue, qtyUnit: e.qtyUnit,
    receivedAt: e.receivedAt, disposedAt: e.disposedAt, disposalReason: e.disposalReason,
    excludeFromInventory: e.excludeFromInventory, excludeFromAnchor: e.excludeFromAnchor, targetMonth: e.targetMonth,
    allocationGroupId: e.allocationGroupId, orderId: e.orderId, isShipping: e.isShipping,
    propertyId, roomId: e.roomId,
    financialAccountId: e.financialAccountId, recurringExpenseId: e.recurringExpenseId,
    receivedLocationId: e.receivedLocationId, assignedLocationId: e.assignedLocationId, storedLocationId: e.storedLocationId,
    assignedAt: e.assignedAt, isCommonAsset: e.isCommonAsset, roomWorkId: e.roomWorkId,
    ...over,
  }
}
