// 현금영수증 발행 줄 점검 재료를 DB 에서 읽는 공용 로더. 점검과 정리 예행이 같은 재료로 같은 판정을 돌린다.
//
// 부르는 곳은 둘이다. scripts/check-cash-receipt-orphan.ts(verify:db)와 scripts/fix-cash-receipt-422-519.ts 의
// 예행('정리 뒤 점검 결과'). 판정은 lib/cashReceiptAudit 가 하고 여기는 읽기만 한다. 쓰기 쿼리는 없다.
//
// 수납은 **지워진 것까지 전부** 읽는다. (자) 태어날 때부터 죽은 줄과 환불 대기 판별이 지워진 수납을 봐야 한다.
// where 에 deletedAt: undefined 를 일부러 적는다. 확장 없는 클라이언트면 아무 조건이 아니고, 소프트삭제
// 익스텐션이 걸린 클라이언트(lib/prisma)면 'deletedAt 을 명시했다'로 읽혀 자동 필터가 안 붙는다. 어느 쪽으로
// 불러도 같은 재료가 나온다.
import { Prisma, type PrismaClient } from '@prisma/client'
import type { AuditLine, AuditRecord } from '../lib/cashReceiptAudit'

export type CashReceiptAuditData = { lines: AuditLine[]; records: AuditRecord[]; refundDeletedIds: Set<string> }

/** 전역 클라이언트도 트랜잭션 클라이언트도 받는다. 부르는 쪽이 READ ONLY 트랜잭션 안에서 부르면 쓰기가 구조로 막힌다. */
export type CashReceiptAuditDb = Pick<PrismaClient, 'cashReceipt' | 'paymentRecord' | 'leaseTerm'>

/** READ ONLY 트랜잭션 안에서 읽는다. 풀러(트랜잭션 모드)는 세션 옵션을 무시해 트랜잭션 단위로 건다. */
export async function loadCashReceiptAuditDataReadOnly(prisma: PrismaClient): Promise<CashReceiptAuditData> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`
    return loadCashReceiptAuditData(tx)
  }, { timeout: 60_000 })
}

export async function loadCashReceiptAuditData(prisma: CashReceiptAuditDb): Promise<CashReceiptAuditData> {
  const lines = await prisma.cashReceipt.findMany({
    // CashReceipt 는 소프트삭제 익스텐션 대상이 아니라 늘 손으로 거른다.
    where: { deletedAt: null },
    select: {
      id: true, leaseTermId: true, payDate: true, payMethod: true, amount: true, issuedAt: true, createdAt: true,
      inclDeposit: true, inclCleaning: true, memo: true,
    },
  })
  const records = await prisma.paymentRecord.findMany({
    where: { deletedAt: undefined },
    select: {
      id: true, leaseTermId: true, payDate: true, payMethod: true, actualAmount: true,
      isDeposit: true, isBillingAdjust: true, cashReceiptIssuedAt: true, deletedAt: true,
    },
  })
  // 이용료 환불이 만드는 정상 중간 상태(환불 대기)를 유령과 가르는 재료(2026-09-01, lib/cashReceipt receiptRowVerdict).
  const leases = await prisma.leaseTerm.findMany({
    where: { checkoutProrationUndo: { not: Prisma.DbNull } },
    select: { checkoutProrationUndo: true },
  })
  const refundDeletedIds = new Set<string>()
  for (const l of leases) {
    const snap = (l.checkoutProrationUndo as { refund?: { deletedRecordIds?: unknown } } | null)?.refund
    if (!Array.isArray(snap?.deletedRecordIds)) continue
    for (const id of snap.deletedRecordIds) if (typeof id === 'string') refundDeletedIds.add(id)
  }
  return { lines, records, refundDeletedIds }
}
