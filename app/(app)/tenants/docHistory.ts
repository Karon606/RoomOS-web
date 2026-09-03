'use server'

// 입주자별 발급 서류 이력 조회 — 규칙은 lib/docHistory 정본이 쥐고 여기는 읽어 오는 자리다.
//
// 계약서는 안 읽는다. 바로 위 계약서 파일 패널이 판본·폐기·구버전이라는 제 개념으로 그 종이를
// 다루고 있어, 여기 다시 실으면 같은 파일이 한 화면에 두 번 선다(패널 판정 2026-09-03).
//
// **펼칠 때만 부른다.** 입주자 모달은 열릴 때 하는 일이 이미 많고 이 목록은 기본 접힘이라,
// 안 쓸 수도 있는 조회를 열림 시점에 얹지 않는다(PaymentHistoryAll 과 같은 처방).

import prisma from '@/lib/prisma'
import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { sortDocHistory, type DocHistoryFile } from '@/lib/docHistory'

export type DocHistoryRow = {
  id: string
  docType: DocHistoryFile['docType']
  driveFileId: string
  /** ISO — 화면이 fmtDateDot 으로 그린다. Date 를 그대로 넘기면 서버 경계에서 형태가 흔들린다. */
  issuedAt: string
  receiptNo: string | null
  targetMonth: string | null
  roomNo: string | null
}

export async function getTenantDocHistory(tenantId: string): Promise<{ rows: DocHistoryRow[]; showRoom: boolean }> {
  const { propertyId } = await requirePropertyAccess()
  const [receipts, certs] = await Promise.all([
    prisma.rentReceiptFile.findMany({
      where: { tenantId, propertyId, deletedAt: null },
      select: {
        id: true, driveFileId: true, issuedAt: true, receiptNo: true, kind: true,
        targetMonth: true, leaseTermId: true, leaseTerm: { select: { room: { select: { roomNo: true } } } },
      },
    }),
    prisma.residenceCertFile.findMany({
      where: { tenantId, propertyId, deletedAt: null },
      select: {
        id: true, driveFileId: true, issuedAt: true,
        leaseTermId: true, leaseTerm: { select: { room: { select: { roomNo: true } } } },
      },
    }),
  ])

  const files: DocHistoryFile[] = [
    ...receipts.map(r => ({
      id: r.id,
      docType: (r.kind === 'deposit' ? 'deposit' : 'rent') as DocHistoryFile['docType'],
      driveFileId: r.driveFileId,
      issuedAt: r.issuedAt,
      receiptNo: r.receiptNo,
      targetMonth: r.targetMonth,
      leaseTermId: r.leaseTermId,
      roomNo: r.leaseTerm?.room?.roomNo ?? null,
    })),
    ...certs.map(c => ({
      id: c.id,
      docType: 'residence' as const,
      driveFileId: c.driveFileId,
      issuedAt: c.issuedAt,
      leaseTermId: c.leaseTermId,
      roomNo: c.leaseTerm?.room?.roomNo ?? null,
    })),
  ]

  // 방 번호는 계약이 둘 이상일 때만 행에 붙인다 — 하나뿐이면 겹말이다. 판정은 **이력에 실제로
  // 나타난 방**으로 한다(계약 수가 아니라). 같은 방으로 재계약한 사람에게 방을 두 번 말하지 않는다.
  const rooms = new Set(files.map(f => f.roomNo).filter(Boolean))
  return {
    rows: sortDocHistory(files).map(f => ({
      id: f.id,
      docType: f.docType,
      driveFileId: f.driveFileId,
      issuedAt: f.issuedAt.toISOString(),
      receiptNo: f.receiptNo ?? null,
      targetMonth: f.targetMonth ?? null,
      roomNo: f.roomNo ?? null,
    })),
    showRoom: rooms.size > 1,
  }
}
