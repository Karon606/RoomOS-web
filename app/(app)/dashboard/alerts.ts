// "오늘 챙길 일" 알림 목록 단일 소스 — 'use server' 아님(클라이언트 비노출). propertyId 명시 호출용.
//
// 이 모듈이 cron(푸시)·인앱 종의 **공통 소스**다. 둘이 같은 리스트를 쓰므로
// 종 뱃지 숫자 = 홈화면 푸시 뱃지 숫자가 자동으로 일치한다.
//
// 정책(2026-05-24 푸시 정책과 동일):
//   · 일정 기반(퇴실·투어·입주) → "당일에 있을 일"만 (경과·예정은 제외).
//   · 진행 중(미납·재고 소진 임박·수령 대기) → 해소될 때까지 매일.
// 대시보드의 넓은 AlertsStrip(납부예정·위시·요청·고정지출 포함)과는 의도적으로 별개 — 종은 푸시와 동일 범위.

import prisma from '@/lib/prisma'
import { fmtWon } from '@/lib/fmtMoney'
import { kstYmd } from '@/lib/kstDate'
import { getTrackedCategories } from '@/app/(app)/inventory/categoryConfig'
import { computeInventoryOverview } from '@/app/(app)/inventory/overview'
import { computeUnpaidStatus } from '@/app/(app)/dashboard/unpaid'

export type AlertCategory = 'unpaid' | 'checkout' | 'tour' | 'movein' | 'lowstock' | 'receipt' | 'contact' | 'signed'

export type AlertItem = {
  id: string            // 목록 key (고유)
  category: AlertCategory
  title: string         // 예: "201호 홍길동", "쌀"
  subtitle: string      // 예: "월세 35만원 미납 · 5일 경과"
  tenantId?: string     // 있으면 클릭 시 EntityModal(고객 뷰) 열기
  href?: string         // tenantId 없으면 이 경로로 이동 (재고·수령)
  urgency: number       // 정렬용 (높을수록 급함)
  // Prism 수납 face 진입용 — '수납 관리 보기' 버튼이 사용. lease 알림에는 항상 채움.
  leaseTermId?: string
  roomId?: string | null
  roomNo?: string
  tenantName?: string
}

const CATEGORY_LABEL: Record<AlertCategory, string> = {
  unpaid: '미납', checkout: '퇴실', tour: '오늘 투어',
  movein: '오늘 입주', lowstock: '재고 소진 임박', receipt: '수령 대기',
  contact: '연락할 때', signed: '서명 완료',
}

// 금액 표기는 정본 fmtWon 사용(감사 B4)

/** propertyId 의 "오늘 챙길 일" 알림 목록 — 긴급도순 정렬해서 반환. */
export async function computeAlerts(propertyId: string): Promise<AlertItem[]> {
  // KST 오늘 [00:00, 다음날 00:00) — 일정 기반은 '당일'만
  const k = kstYmd()
  const today = new Date(k.year, k.month - 1, k.day)
  const tomorrow = new Date(today.getTime() + 86400000)
  const trackedCats = await getTrackedCategories(propertyId)
  const contactLeadDays = (await prisma.property.findUnique({ where: { id: propertyId }, select: { contactLeadDays: true } }))?.contactLeadDays ?? 14

  const [unpaidStatus, inventory, checkoutLeases, tourLeases, moveInLeases, pendingReceipts, contactLeases, signedLinks, generatedFiles] = await Promise.all([
    computeUnpaidStatus(propertyId),
    computeInventoryOverview(propertyId),
    // 퇴실 — 당일 + 경과(미처리) + 단기 자동 전환 D-1(내일): 처리 전까지 지속(운영자 확정 2026-07-11)
    prisma.leaseTerm.findMany({
      where: {
        propertyId, status: 'CHECKOUT_PENDING',
        OR: [
          { expectedMoveOut: { lt: tomorrow } },
          // 내일 퇴실은 단기 자동 전환 건만 — 전환 당일 '몰래 바뀌지 않게' 고지
          { expectedMoveOut: { gte: tomorrow, lt: new Date(tomorrow.getTime() + 86400000) }, autoCheckoutAt: { not: null } },
        ],
      },
      select: { id: true, expectedMoveOut: true, autoCheckoutAt: true, room: { select: { id: true, roomNo: true } }, tenant: { select: { id: true, name: true } } },
    }),
    prisma.leaseTerm.findMany({
      where: { propertyId, status: 'WAITING_TOUR', tourDate: { gte: today, lt: tomorrow } },
      select: { id: true, room: { select: { id: true, roomNo: true } }, tenant: { select: { id: true, name: true } } },
    }),
    prisma.leaseTerm.findMany({
      where: { propertyId, status: 'RESERVED', moveInDate: { gte: today, lt: tomorrow } },
      select: { id: true, room: { select: { id: true, roomNo: true } }, tenant: { select: { id: true, name: true } } },
    }),
    prisma.expense.findMany({
      where: { propertyId, category: { in: trackedCats }, itemLabel: { not: null }, receivedAt: null, excludeFromInventory: false },
      select: { id: true, itemLabel: true, vendor: true, amount: true, date: true },
      orderBy: { date: 'asc' },
    }),
    // 잠재 고객 연락 — 입주 희망일 D-14 이내(운영자 기준 2026-07-10): 빈방 가능 여부를 먼저 알려주기.
    // 예약 확정(방 확보) 건은 제외 — 입주 당일 알림이 따로 있다. 해소(상태 변경·희망일 경과) 전까지 매일.
    prisma.leaseTerm.findMany({
      where: {
        propertyId, status: { in: ['WAITING_TOUR', 'TOUR_DONE', 'RESERVED'] }, reservationConfirmedAt: null,
        moveInDate: { gte: today },
        OR: [
          { contactAlertDate: { lte: today } },   // 고객별 지정일 도래
          { contactAlertDate: null, moveInDate: { lt: new Date(today.getTime() + contactLeadDays * 86400000) } },
        ],
      },
      select: { id: true, moveInDate: true, isShortTerm: true, room: { select: { id: true, roomNo: true } }, tenant: { select: { id: true, name: true } } },
    }),
    // 원격 서명 완료 — 서명 수신(signedAt) 후 정식 계약서(GENERATED)가 아직 발급되지 않은 링크. 발급 시 자동 소멸.
    // closedAt: null — 운영자가 서명된 링크를 닫으면(계약 무산) 알림도 해소.
    prisma.contractShareLink.findMany({
      where: { propertyId, signedAt: { not: null }, closedAt: null },
      select: {
        id: true, tenantId: true, leaseTermId: true, signedAt: true,
        leaseTerm: { select: { room: { select: { id: true, roomNo: true } } } },
        tenant: { select: { id: true, name: true } },
      },
    }),
    // 해소 판정용 — 발급된 정식 계약서(GENERATED, 미삭제). 같은 계약(leaseTermId)의 서명 이후 발급본이 있으면 제외.
    prisma.contractFile.findMany({
      where: { propertyId, source: 'GENERATED', deletedAt: null },
      select: { leaseTermId: true, createdAt: true },
    }),
  ])

  const items: AlertItem[] = []
  const roomName = (roomNo: string | null | undefined, name: string) =>
    roomNo ? `${/^\d+$/.test(roomNo) ? `${roomNo}호` : roomNo} ${name}` : name

  // 미납 — 가장 급함. 경과 일수가 클수록 urgency↑
  for (const l of unpaidStatus.unpaidLeases) {
    const overdueLabel = l.daysOverdue != null
      ? (l.daysOverdue > 0 ? `${l.daysOverdue}일 경과` : l.daysOverdue === 0 ? '오늘 도래' : '')
      : ''
    items.push({
      id: `unpaid-${l.leaseId}`,
      category: 'unpaid',
      title: roomName(l.roomNo, l.tenantName),
      subtitle: [`월세 ${fmtWon(l.unpaidAmount)} 미납`, overdueLabel].filter(Boolean).join(' · '),
      tenantId: l.tenantId,
      leaseTermId: l.leaseId,
      roomId: l.roomId,
      roomNo: l.roomNo,
      tenantName: l.tenantName,
      urgency: 1000 + Math.max(0, l.daysOverdue ?? 0),
    })
  }

  // 잠재 고객 연락(D-14) — 미납 다음 순위. 희망일이 가까울수록 급함.
  for (const l of contactLeases) {
    if (!l.moveInDate) continue
    const dLeft = Math.ceil((l.moveInDate.getTime() - today.getTime()) / 86400000)
    const md = `${l.moveInDate.getMonth() + 1}/${l.moveInDate.getDate()}`
    items.push({
      id: `contact-${l.id}`, category: 'contact',
      title: roomName(l.room?.roomNo, l.tenant.name),
      subtitle: `입주 희망 ${md} (D-${dLeft})${l.isShortTerm ? ' · 단기' : ''} — 빈방 가능 여부 연락`,
      tenantId: l.tenant.id, leaseTermId: l.id,
      roomId: l.room?.id ?? null, roomNo: l.room?.roomNo, tenantName: l.tenant.name,
      urgency: 900 - dLeft * 10,
    })
  }

  // 퇴실 — 내일(단기 자동 전환 고지) → 당일 → 경과 N일, 처리 전까지 지속
  for (const l of checkoutLeases) {
    const overdueDays = l.expectedMoveOut
      ? Math.floor((today.getTime() - l.expectedMoveOut.getTime()) / 86400000)
      : 0
    items.push({
      id: `checkout-${l.id}`, category: 'checkout',
      title: roomName(l.room?.roomNo, l.tenant.name),
      subtitle: overdueDays < 0
        ? '내일 퇴실 — 단기 계약이라 퇴실 예정으로 자동 전환됨'
        : overdueDays > 0 ? `퇴실 예정일 경과 ${overdueDays}일 — 퇴실 처리 필요` : '오늘 퇴실 예정',
      tenantId: l.tenant.id, leaseTermId: l.id,
      roomId: l.room?.id ?? null, roomNo: l.room?.roomNo, tenantName: l.tenant.name,
      urgency: overdueDays < 0 ? 750 : 800 + Math.min(overdueDays * 5, 90),   // 미납(950대)은 넘지 않게
    })
  }
  // 오늘 입주
  for (const l of moveInLeases) {
    items.push({
      id: `movein-${l.id}`, category: 'movein',
      title: roomName(l.room?.roomNo, l.tenant.name), subtitle: '오늘 입주 예정',
      tenantId: l.tenant.id, leaseTermId: l.id,
      roomId: l.room?.id ?? null, roomNo: l.room?.roomNo, tenantName: l.tenant.name,
      urgency: 700,
    })
  }
  // 오늘 투어
  for (const l of tourLeases) {
    items.push({
      id: `tour-${l.id}`, category: 'tour',
      title: roomName(l.room?.roomNo, l.tenant.name), subtitle: '오늘 투어 예정',
      tenantId: l.tenant.id, leaseTermId: l.id,
      roomId: l.room?.id ?? null, roomNo: l.room?.roomNo, tenantName: l.tenant.name,
      urgency: 600,
    })
  }

  // 재고 소진 임박 — daysUntilEmpty 가 작을수록 급함
  for (const r of inventory) {
    if (r.daysUntilEmpty == null || r.daysUntilEmpty > r.alertThresholdDays) continue
    items.push({
      id: `lowstock-${r.id}`, category: 'lowstock',
      title: r.label,
      subtitle: r.daysUntilEmpty <= 0 ? '재고 소진' : `약 ${r.daysUntilEmpty}일 후 소진`,
      href: '/inventory',
      urgency: 500 - Math.min(500, r.daysUntilEmpty),
    })
  }

  // 수령 대기 (구매했으나 미수령)
  for (const e of pendingReceipts) {
    items.push({
      id: `receipt-${e.id}`, category: 'receipt',
      title: e.itemLabel ?? '품목',
      subtitle: [e.vendor, e.amount > 0 ? fmtWon(e.amount) : '', '수령 대기'].filter(Boolean).join(' · '),
      href: '/inventory',
      urgency: 300,
    })
  }

  // 원격 서명 완료 — 서명본 수신 후 정식 계약서 발급 전. 발급(GENERATED)되면 소멸, 파일 삭제 시 재출현.
  const genFilesByLease = new Map<string, Date[]>()
  for (const f of generatedFiles) {
    if (!f.leaseTermId) continue   // 특정 계약에 귀속되지 않은 발급본은 서명 링크 해소 근거로 쓰지 않음
    const arr = genFilesByLease.get(f.leaseTermId) ?? []
    arr.push(f.createdAt)
    genFilesByLease.set(f.leaseTermId, arr)
  }
  for (const link of signedLinks) {
    if (!link.signedAt) continue
    // 같은 계약(leaseTermId)의 서명 이후 발급본만 해소 인정 — 같은 입주자의 다른 계약 발급본이 오해소하지 않게
    const resolved = (genFilesByLease.get(link.leaseTermId) ?? []).some(c => c.getTime() >= link.signedAt!.getTime())
    if (resolved) continue
    items.push({
      id: `signed-${link.id}`, category: 'signed',
      title: roomName(link.leaseTerm.room?.roomNo, link.tenant.name),
      subtitle: '원격 서명 완료 · 계약서 발급 필요',
      tenantId: link.tenant.id, leaseTermId: link.leaseTermId,
      roomId: link.leaseTerm.room?.id ?? null, roomNo: link.leaseTerm.room?.roomNo, tenantName: link.tenant.name,
      urgency: 820,
    })
  }

  items.sort((a, b) => b.urgency - a.urgency)
  return items
}

/** cron 메시지용 — 카테고리별 건수 + 합계. computeAlerts 와 같은 소스라 종 뱃지와 일치. */
export function summarizeAlerts(items: AlertItem[]): { total: number; parts: string[]; byCategory: Record<AlertCategory, number> } {
  const byCategory = { unpaid: 0, checkout: 0, tour: 0, movein: 0, lowstock: 0, receipt: 0, signed: 0 } as Record<AlertCategory, number>
  for (const it of items) byCategory[it.category]++
  // 푸시 메시지 순서: 미납 → 퇴실 → 서명 완료 → 투어 → 입주 → 재고 → 수령
  const order: AlertCategory[] = ['unpaid', 'checkout', 'signed', 'tour', 'movein', 'lowstock', 'receipt']
  const parts = order.filter(c => byCategory[c] > 0).map(c => `${CATEGORY_LABEL[c]} ${byCategory[c]}`)
  return { total: items.length, parts, byCategory }
}
