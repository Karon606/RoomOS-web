// 퇴실 예정 때 고른 사유를 퇴실 처리가 이어받는 정본 — 화면 프리필과 서버 이어받기가 같은 판정을 쓴다.
//
// 왜 필요한가. 사유를 말하는 시점은 통보를 받는 '퇴실 예정'인데, 퇴실 처리 미니폼은 열 때마다
// 사유를 비웠고 홈 알림 경로는 아예 안 물었다. 그래서 퇴실 예정에 '개인 사정'을 적어 둔 사람의
// 퇴실 행이 빈 사유로 남았다(506호, 2026-09-02 신고). 판정을 여기 한 벌로 둔다.
import type { PrismaDb } from '@/lib/prisma'
import { CHECKOUT_REASONS, parseReason } from '@/lib/statusReasons'

type LogRow = { fromStatus: string; toStatus: string; reason: string | null; deletedAt?: Date | string | null }

/**
 * 최신순 이력에서 이어받을 퇴실 사유. 없으면 null.
 *
 * 가장 최근의 '퇴실 예정' 행부터 거슬러 올라가며 운영자가 고른 사유(정본 목록에 있는 것)를 찾는다.
 * '퇴실 한 달 전 자동 전환' 같은 시스템 라벨은 사유가 아니라 건너뛴다. 퇴실 예정이 아닌 전이
 * (연장으로 거주중 복귀, 이미 퇴실)를 먼저 만나면 그 예정은 끝난 것이라 멈춘다 — 옛 사유가
 * 다음 퇴실에 붙으면 안 된다. 무효 처리된 행은 없던 일이다.
 */
export function inheritableCheckoutReason(logsNewestFirst: LogRow[]): string | null {
  for (const r of logsNewestFirst) {
    if (r.deletedAt) continue
    if (r.toStatus !== 'CHECKOUT_PENDING') {
      // 등록 행(from === to)은 전이가 아니다. 그 밖의 다른 전이를 만나면 예정 구간 밖이다.
      if (r.fromStatus === r.toStatus) continue
      return null
    }
    const { selected } = parseReason(r.reason)
    if (selected && (CHECKOUT_REASONS as readonly string[]).includes(selected)) return r.reason
  }
  return null
}

/** 서버 경로용 — 이 계약의 이력을 읽어 같은 판정을 한다. 화면이 없는 경로(홈 알림)가 쓴다. */
export async function latestCheckoutReasonFor(prisma: PrismaDb, leaseTermId: string): Promise<string | null> {
  const rows = await prisma.tenantStatusLog.findMany({
    where: { leaseTermId },
    orderBy: { changedAt: 'desc' },
    take: 10,
    select: { fromStatus: true, toStatus: true, reason: true, deletedAt: true },
  })
  return inheritableCheckoutReason(rows)
}
