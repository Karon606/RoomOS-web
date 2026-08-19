// "오늘 챙길 일" 알림 목록 단일 소스 — 'use server' 아님(클라이언트 비노출). propertyId 명시 호출용.
//
// 이 모듈이 cron(푸시)·인앱 종의 **공통 소스**다. 둘이 같은 리스트를 쓰므로
// 종 뱃지 숫자 = 홈화면 푸시 뱃지 숫자가 자동으로 일치한다.
//
// 정책(2026-05-24 푸시 정책과 동일):
//   · 일정 기반(퇴실·투어·입주·고정지출 출금/납부) → "당일에 있을 일"만 (경과·예정은 제외).
//   · 진행 중(미납·재고 소진 임박·수령 대기) → 해소될 때까지 매일.
// 대시보드의 넓은 AlertsStrip(납부예정·위시·요청·고정지출 포함)과는 의도적으로 별개 — 종은 푸시와 동일 범위.
//   ※ 고정지출은 두 곳에 다 서지만 창이 다르다 — AlertsStrip 은 D-N 임박(alertDaysBefore)까지 미리 알리고,
//     여기(종·푸시)는 **오늘 실제로 돈이 나가는 건**만 센다(운영자 신고 568633fb: "출금되는 내용도 알림에
//     있어야 될듯"). 오늘 아침 푸시에 그 항목이 아예 없던 것이 이 신고의 내용이다.

import prisma from '@/lib/prisma'
import { fmtWon } from '@/lib/fmtMoney'
import { kstYmd } from '@/lib/kstDate'
import { getTrackedCategories } from '@/app/(app)/inventory/categoryConfig'
import { computeInventoryOverview } from '@/app/(app)/inventory/overview'
import { computeUnpaidStatus } from '@/app/(app)/dashboard/unpaid'
import { isContractIssued, issuingLeaseId } from '@/lib/contractIssue'
import { computeRecurringExpensesWithStatus } from '@/app/(app)/finance/recurringStatus'
import { recurringDueToday } from '@/lib/recurringDueDate'
import { effectiveRecurringAmount, recurringAmountLabel } from '@/lib/recurringEstimate'

export type AlertCategory = 'unpaid' | 'checkout' | 'tour' | 'movein' | 'lowstock' | 'receipt' | 'contact' | 'signed' | 'autodebit' | 'manualpay'

export type AlertItem = {
  id: string            // 목록 key (고유)
  category: AlertCategory
  title: string         // 예: "201호 홍길동", "쌀"
  subtitle: string      // 예: "월이용료 35만원 미납 · 5일 경과" (단기는 "이용료 …")
  tenantId?: string     // 있으면 클릭 시 EntityModal(입주자 뷰) 열기
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
  // 운영자 어휘 그대로 — 자동이체는 계좌에서 '출금'되고, 직접 내는 건은 '납부'한다(신고 568633fb 원문).
  autodebit: '오늘 출금', manualpay: '오늘 납부',
}

// 금액 표기는 정본 fmtWon 사용(감사 B4)

/** propertyId 의 "오늘 챙길 일" 알림 목록 — 긴급도순 정렬해서 반환. */
export async function computeAlerts(propertyId: string): Promise<AlertItem[]> {
  // KST 오늘 [00:00, 다음날 00:00) — 일정 기반은 '당일'만
  const k = kstYmd()
  const today = new Date(k.year, k.month - 1, k.day)
  const tomorrow = new Date(today.getTime() + 86400000)
  // 고정지출 판정용 'YYYY-MM-DD' — 위 today 와 같은 k 에서 뽑는다(두 번 재면 자정 경계에서 갈린다).
  const todayYmd = `${k.year}-${String(k.month).padStart(2, '0')}-${String(k.day).padStart(2, '0')}`
  const thisMonth = todayYmd.slice(0, 7)
  const trackedCats = await getTrackedCategories(propertyId)
  const contactLeadDays = (await prisma.property.findUnique({ where: { id: propertyId }, select: { contactLeadDays: true } }))?.contactLeadDays ?? 14

  const [unpaidStatus, inventory, checkoutLeases, tourLeases, moveInLeases, pendingReceipts, contactLeases, signedLinks, generatedFiles, recurringThisMonth] = await Promise.all([
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
    // '연락할 때' 알림 — 입주 희망일 D-14 이내(운영자 기준 2026-07-10): 빈방 가능 여부를 먼저 알려주기.
    // 예약 확정(방 확보) 건은 제외 — 입주 당일 알림이 따로 있다. 해소(상태 변경·희망일 경과) 전까지 매일.
    prisma.leaseTerm.findMany({
      where: {
        propertyId, status: { in: ['WAITING_TOUR', 'TOUR_DONE', 'RESERVED'] }, reservationConfirmedAt: null,
        moveInDate: { gte: today },
        OR: [
          { contactAlertDate: { lte: today } },   // 입주자별 지정일 도래
          { contactAlertDate: null, moveInDate: { lt: new Date(today.getTime() + contactLeadDays * 86400000) } },
        ],
      },
      select: { id: true, moveInDate: true, isShortTerm: true, room: { select: { id: true, roomNo: true } }, tenant: { select: { id: true, name: true } } },
    }),
    // 원격 서명 완료 — 서명 수신(signedAt) 후 정식 계약서가 아직 없는 링크. 발급본·스캔본이 생기면 자동 소멸.
    // closedAt: null — 운영자가 서명된 링크를 닫으면(계약 무산) 알림도 해소.
    prisma.contractShareLink.findMany({
      where: { propertyId, signedAt: { not: null }, closedAt: null },
      select: {
        id: true, tenantId: true, leaseTermId: true, signedAt: true,
        // 딸린 계약이면 발급될 종이는 부모 것이다 — 해소 판정·지목이 그 계약을 봐야 종이 안 꺼지는 일이 없다.
        leaseTerm: { select: { room: { select: { id: true, roomNo: true } }, parentLeaseTermId: true } },
        tenant: { select: { id: true, name: true } },
      },
    }),
    // 해소 판정용 — 그 계약의 정식 계약서(미삭제). 같은 계약(leaseTermId)의 서명 이후 파일이 있으면 제외.
    // UPLOADED(스캔 본 첨부)도 인정한다 — 종이로 출력·서명한 계약서도 정식 계약서이고, 스캔해 첨부하면
    // 시스템에 사본이 남아 목적(보관)을 달성한다. GENERATED 만 인정하면 종이 계약 운영에서 알림이
    // 영원히 안 꺼진다(운영자 질의 2026-08-01). 단순 출력만 하고 첨부하지 않으면 알림은 유지된다 —
    // 사본이 없는 상태를 알려 주는 것이 이 알림의 목적이다.
    prisma.contractFile.findMany({
      where: { driveFileId: { not: '' }, propertyId, source: { in: ['GENERATED', 'UPLOADED'] }, deletedAt: null },
      select: { leaseTermId: true, createdAt: true },
    }),
    // 고정지출 이번 달 현황 — 재무 지출 탭이 예정 행을 세울 때 쓰는 그 함수 그대로.
    // 기록 여부(recordedExpenseId)를 여기서 손으로 다시 판정하지 않는다.
    computeRecurringExpensesWithStatus(propertyId, thisMonth),
  ])

  const items: AlertItem[] = []
  const roomName = (roomNo: string | null | undefined, name: string) =>
    roomNo ? `${/^\d+$/.test(roomNo) ? `${roomNo}호` : roomNo} ${name}` : name

  // 미납 — 가장 급함. 경과 일수가 클수록 urgency↑
  for (const l of unpaidStatus.unpaidLeases) {
    // 기한을 미뤄준 건은 홈 위젯이 '납부 유예'라고 부른다. 같은 화면의 종 알림과 푸시가
    // 그냥 '미납'이라고만 하면 유예해 준 사실이 알림에서만 사라진다(2026-08-02).
    const overdueLabel = l.deferredDue
      ? `유예 ${l.deferredDue}까지`
      : l.daysOverdue != null
        ? (l.daysOverdue > 0 ? `${l.daysOverdue}일 경과` : l.daysOverdue === 0 ? '오늘 도래' : '')
        : ''
    items.push({
      id: `unpaid-${l.leaseId}`,
      category: 'unpaid',
      title: roomName(l.roomNo, l.tenantName),
      subtitle: [`${l.isShortTerm ? '이용료' : '월이용료'} ${fmtWon(l.unpaidAmount)} 미납`, overdueLabel].filter(Boolean).join(' · '),   // 단기는 월 단위가 아니라 '이용료'(운영자 지시 2026-07-20)
      tenantId: l.tenantId,
      leaseTermId: l.leaseId,
      roomId: l.roomId,
      roomNo: l.roomNo,
      tenantName: l.tenantName,
      urgency: 1000 + Math.max(0, l.daysOverdue ?? 0),
    })
  }

  // '연락할 때' 알림(D-14) — 미납 다음 순위. 희망일이 가까울수록 급함.
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

  // 오늘 나가는 돈 — 고정지출 중 오늘이 실제 출금일(자동이체)·납부일(직접 납부)인 건.
  // 날짜는 lib/recurringDueDate 정본 하나만 본다(recurringDueToday): 자동이체는 주말·공휴일 시프트 후
  // 실제 이체일, 비자동은 기준일 그대로(말일 클램프만). 이번 달 기록이 이미 있으면 빠진다 —
  // 재무 지출 탭에서 예정 행이 사라지는 것과 같은 판정이라 두 화면이 어긋나지 않는다.
  // 금액도 재무 탭·홈 알림과 같은 정본 추정식(effectiveRecurringAmount)을 쓴다 — 기본액을 그대로
  // 적으면 예약금액·과거평균이 반영된 실제 금액과 갈린다(2026-07-30 신고).
  for (const re of recurringThisMonth) {
    if (!recurringDueToday(re, todayYmd)) continue
    const amountLabel = recurringAmountLabel(re)   // 금액의 출처('예약금액'·'작년 8월'·'3개월 평균'·'기본액')
    items.push({
      id: `recurring-${re.id}`,
      category: re.isAutoDebit ? 'autodebit' : 'manualpay',
      title: re.title,
      subtitle: [
        fmtWon(effectiveRecurringAmount(re)),
        amountLabel,
        ...(re.isAutoDebit ? ['오늘 출금', '자동이체'] : ['오늘 납부']),
      ].filter(Boolean).join(' · '),
      // 할 일은 '기록'이라 목적지는 예정 행이 서 있는 재무 지출 탭이다(이번 달).
      href: `/finance?tab=expense&month=${thisMonth}`,
      // 직접 납부가 자동이체보다 위 — 하나는 오늘 사람이 해야 하고 하나는 계좌가 알아서 한다.
      // 둘 다 '오늘 입주'(700) 아래, '오늘 투어'(600) 위.
      urgency: re.isAutoDebit ? 660 : 680,
    })
  }

  // 재고 소진 임박 — daysUntilEmpty 가 작을수록 급함
  for (const r of inventory) {
    if (r.daysUntilEmpty == null || r.daysUntilEmpty > r.effectiveAlertDays) continue
    items.push({
      id: `lowstock-${r.id}`, category: 'lowstock',
      title: r.label,
      subtitle: r.daysUntilEmpty <= 0 ? '재고 소진' : `약 ${r.daysUntilEmpty}일 후 소진`,
      href: '/inventory?focus=inventory-lowstock',
      urgency: 500 - Math.min(500, r.daysUntilEmpty),
    })
  }

  // 수령 대기 (구매했으나 미수령)
  for (const e of pendingReceipts) {
    items.push({
      id: `receipt-${e.id}`, category: 'receipt',
      title: e.itemLabel ?? '품목',
      subtitle: [e.vendor, e.amount > 0 ? fmtWon(e.amount) : '', '수령 대기'].filter(Boolean).join(' · '),
      href: '/inventory?focus=inventory-pending',
      urgency: 300,
    })
  }

  // 원격 서명 완료 — 서명본 수신 후 정식 계약서가 아직 없는 상태. 발급본·스캔본이 생기면 소멸, 파일 삭제 시 재출현.
  // 판정은 lib/contractIssue 정본을 쓴다 — 계약서 파일 패널이 같은 규칙으로 '계약서 발급'을 주 동작으로 올린다.
  for (const link of signedLinks) {
    if (!link.signedAt) continue
    // 딸린 계약의 종이는 부모 합본 한 장이다 — 그 종이가 생기면 이 알림도 함께 끝난다.
    // 발급 대기 목록과 같은 한 값을 본다(lib/contractIssue issuingLeaseId).
    const issueLeaseId = issuingLeaseId(link.leaseTermId, link.leaseTerm.parentLeaseTermId)
    if (isContractIssued(link.signedAt, issueLeaseId, generatedFiles)) continue
    items.push({
      id: `signed-${link.id}`, category: 'signed',
      title: roomName(link.leaseTerm.room?.roomNo, link.tenant.name),
      subtitle: '원격 서명 완료 · 계약서 발급 필요',
      // 할 일이 '계약서 발급'이라 목적지는 입주자 모달이 아니라 계약서함의 발급 대기 섹션이다.
      // tenantId 도 유지한다 — 종은 아래 카테고리 예외로 href 를 먼저 보고, 다른 소비처는 종전대로 쓴다.
      href: '/contracts?focus=contracts-pending-issue',
      tenantId: link.tenant.id, leaseTermId: issueLeaseId,
      roomId: link.leaseTerm.room?.id ?? null, roomNo: link.leaseTerm.room?.roomNo, tenantName: link.tenant.name,
      urgency: 820,
    })
  }

  items.sort((a, b) => b.urgency - a.urgency)
  return items
}

/** cron 메시지용 — 카테고리별 건수 + 합계. computeAlerts 와 같은 소스라 종 뱃지와 일치. */
export function summarizeAlerts(items: AlertItem[]): { total: number; parts: string[]; byCategory: Record<AlertCategory, number> } {
  const byCategory = { unpaid: 0, checkout: 0, tour: 0, movein: 0, lowstock: 0, receipt: 0, signed: 0, autodebit: 0, manualpay: 0 } as Record<AlertCategory, number>
  for (const it of items) byCategory[it.category]++
  // 푸시 메시지 순서: 미납 → 퇴실 → 서명 완료 → 투어 → 입주 → 오늘 출금 → 오늘 납부 → 재고 → 수령
  const order: AlertCategory[] = ['unpaid', 'checkout', 'signed', 'tour', 'movein', 'autodebit', 'manualpay', 'lowstock', 'receipt']
  const parts = order.filter(c => byCategory[c] > 0).map(c => `${CATEGORY_LABEL[c]} ${byCategory[c]}`)
  return { total: items.length, parts, byCategory }
}
