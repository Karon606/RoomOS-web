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
import { dayDbRange, kstYmd } from '@/lib/kstDate'
import { getTrackedCategories } from '@/app/(app)/inventory/categoryConfig'
import { computeInventoryOverview } from '@/app/(app)/inventory/overview'
import { computeUnpaidStatus } from '@/app/(app)/dashboard/unpaid'
import { isContractIssued, issuingLeaseId } from '@/lib/contractIssue'
import { computeRecurringExpensesWithStatus } from '@/app/(app)/finance/recurringStatus'
import { recurringDueToday } from '@/lib/recurringDueDate'
import { effectiveRecurringAmount, recurringAmountLabel } from '@/lib/recurringEstimate'
import { fmtRoomNo } from '@/lib/roomNo'
import { signProgressLabel, signStage } from '@/lib/disposalSignGate'

export type AlertCategory = 'unpaid' | 'checkout' | 'tour' | 'movein' | 'lowstock' | 'receipt' | 'contact' | 'signed' | 'signpartial' | 'autodebit' | 'manualpay'

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
  contact: '연락할 때', signed: '서명 받음', signpartial: '서명 미완',
  // 운영자 어휘 그대로 — 자동이체는 계좌에서 '출금'되고, 직접 내는 건은 '납부'한다(신고 568633fb 원문).
  autodebit: '오늘 출금', manualpay: '오늘 납부',
}

// 금액 표기는 정본 fmtWon 사용(감사 B4)

/** propertyId 의 "오늘 챙길 일" 알림 목록 — 긴급도순 정렬해서 반환. */
export async function computeAlerts(propertyId: string): Promise<AlertItem[]> {
  // KST 오늘 [00:00, 다음날 00:00) — 일정 기반은 '당일'만
  const k = kstYmd()
  // 'YYYY-MM-DD' 는 today 와 같은 k 에서 뽑는다(두 번 재면 자정 경계에서 갈린다).
  const todayYmd = `${k.year}-${String(k.month).padStart(2, '0')}-${String(k.day).padStart(2, '0')}`
  // 창은 @db.Date 저장 축(UTC 자정)으로 잡는다 — 로컬 자정으로 만들던 시절엔 KST 기기에서
  // tourDate·moveInDate 창이 하루 앞으로 밀려 '오늘 투어'가 어제 것을 집었고, 아래 D-day
  // 계산(입주 희망일·퇴실 경과)도 9시간 어긋나 하루씩 더 세었다.
  const { gte: today, lt: tomorrow } = dayDbRange(todayYmd)
  const thisMonth = todayYmd.slice(0, 7)
  const trackedCats = await getTrackedCategories(propertyId)
  const prop = await prisma.property.findUnique({ where: { id: propertyId }, select: { contactLeadDays: true } })
  const contactLeadDays = prop?.contactLeadDays ?? 14

  const [unpaidStatus, inventory, checkoutLeases, tourLeases, moveInLeases, pendingReceipts, contactLeases, signedLinks, generatedFiles, recurringThisMonth] = await Promise.all([
    computeUnpaidStatus(propertyId),
    computeInventoryOverview(propertyId),
    // 퇴실 — 당일 + 경과(미처리) + 내일 퇴실: 처리 전까지 지속(운영자 확정 2026-07-11)
    prisma.leaseTerm.findMany({
      where: {
        propertyId, status: 'CHECKOUT_PENDING',
        OR: [
          { expectedMoveOut: { lt: tomorrow } },
          // 내일 퇴실은 자동으로 바뀐 건만 — 사람이 직접 바꾼 것은 이미 알고 있는 일이다.
          // 종전에는 이 조건이 곧 '단기'였다(자동 전환이 단기 전용이었다). 이제 일반 계약도
          // 자동으로 바뀌므로 조건은 그대로 두되 문구에서 '단기'를 뺀다.
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
      // 반쪽은 어느 쪽이 먼저 오든 반쪽이다. 계약서 서명만 보면 동의서만 서명한 계약(506호)이
      // 이 목록에 아예 못 들어와, 운영자가 볼 화면이 한 곳도 없다(2026-09-04).
      where: { propertyId, closedAt: null, OR: [{ signedAt: { not: null } }, { disposalSignedAt: { not: null } }] },
      select: {
        id: true, tenantId: true, leaseTermId: true, signedAt: true, disposalSignedAt: true,
        // 이 링크가 나갈 때 동의서가 붙는 종이였는가. **라이브 설정을 보면 안 된다** —
        // 영업장이 서류를 새로 켜는 순간 과거 계약 전부가 소급으로 반쪽이 되어 알림이 도배된다.
        // 기준은 "그 사람이 무엇을 보고 서명했나"이고 그것은 링크 스냅샷에 박제돼 있다.
        // 서명 dataURL 은 링크 발급 시점 이후에 들어오므로 이 스냅샷은 가볍다.
        templateSnapshot: true,
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
    roomNo ? `${/^\d+$/.test(roomNo) ? `${fmtRoomNo(roomNo, '')}` : roomNo} ${name}` : name

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
        // 자동 전환은 이제 퇴실 하루 전이 아니라 리드에 따라 일주일·한 달 전에 끝난다.
        // '단기 계약이라 자동 전환됨'은 일반 계약에도 뜨고 시점도 안 맞는 거짓말이 됐다.
        ? '내일 퇴실 — 퇴실 처리 준비'
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
    // 해소 판정의 기준 시각. 계약서 서명이 있으면 종전 그대로이고, 동의서만 있는 링크에서만
    // 새로 답이 생긴다.
    const signalAt = link.signedAt ?? link.disposalSignedAt
    if (!signalAt) continue
    // 딸린 계약의 종이는 부모 합본 한 장이다 — 그 종이가 생기면 이 알림도 함께 끝난다.
    // 발급 대기 목록과 같은 한 값을 본다(lib/contractIssue issuingLeaseId).
    const issueLeaseId = issuingLeaseId(link.leaseTermId, link.leaseTerm.parentLeaseTermId)
    if (isContractIssued(signalAt, issueLeaseId, generatedFiles)) continue
    // 반쪽 서명을 완료라고 부르지 않는다(신고 2026-09-03, 413호). 종전에는 signedAt 하나만 보고
    // "원격 서명 완료"라고 점등했고, 운영자는 그것을 믿고 서명란이 빈 동의서를 발급했다.
    //
    // hasContractSignature 를 리터럴 true 로 넘기지 않는다. 위 쿼리를 넓힌 순간 그 리터럴은
    // 거짓말이 된다 — 동의서만 서명된 링크가 '계약서만 서명됨'으로 뜬다(방향만 바뀐 같은 거짓말).
    const state = {
      disposalEnabled: (link.templateSnapshot as { disposalConsent?: { enabled?: boolean } } | null)
        ?.disposalConsent?.enabled === true,
      hasContractSignature: !!link.signedAt,
      hasDisposalSignature: !!link.disposalSignedAt,
    }
    const stage = signStage(state)
    if (stage === 'none') continue
    // 완료와 반쪽은 다른 카테고리다. 같은 것으로 두면 푸시 요약이 반쪽을 '서명 받음'으로 세고,
    // 그것이 운영자를 잘못된 발급으로 이끈 원래 경로다.
    // 반쪽의 할 일은 발급이 아니라 남은 서명 받기라 목적지도 다르다(href 를 안 실어 고객 상세로).
    items.push(stage === 'partial' ? {
      id: `signpartial-${link.id}`, category: 'signpartial',
      title: roomName(link.leaseTerm.room?.roomNo, link.tenant.name),
      subtitle: signProgressLabel(state),
      tenantId: link.tenant.id, leaseTermId: issueLeaseId,
      roomId: link.leaseTerm.room?.id ?? null, roomNo: link.leaseTerm.room?.roomNo, tenantName: link.tenant.name,
      // 링크 수명이 24시간이라 반쪽은 시간이 급하다. 완료(820) 위, 퇴실 경과 최대치 아래.
      urgency: 830,
    } : {
      id: `signed-${link.id}`, category: 'signed',
      title: roomName(link.leaseTerm.room?.roomNo, link.tenant.name),
      subtitle: signProgressLabel(state),
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
  // contact 가 빠져 있었다(2026-09-04 새 그물이 발견). `as` 캐스트가 타입 검사를 우회해
  // byCategory['contact']++ 가 undefined++ = NaN 이 되던 자리다. 화면에는 order 에도 없어
  // 안 드러났지만, byCategory 를 소비하는 다른 자리가 생기면 NaN 이 샌다.
  const byCategory = { unpaid: 0, checkout: 0, tour: 0, movein: 0, lowstock: 0, receipt: 0, contact: 0, signed: 0, signpartial: 0, autodebit: 0, manualpay: 0 } as Record<AlertCategory, number>
  for (const it of items) byCategory[it.category]++
  // 푸시 메시지 순서: 미납 → 퇴실 → 서명 완료 → 투어 → 입주 → 오늘 출금 → 오늘 납부 → 재고 → 수령
  // **이 배열은 타입 검사에 안 걸린다.** 카테고리를 더하고 여기를 빠뜨리면 종은 울리는데
  // 푸시 요약에서만 침묵한다. 새 그물(check-sign-progress-axis ⓔ)이 길이를 대조해 지킨다.
  const order: AlertCategory[] = ['unpaid', 'checkout', 'signed', 'signpartial', 'tour', 'movein', 'autodebit', 'manualpay', 'lowstock', 'receipt']
  const parts = order.filter(c => byCategory[c] > 0).map(c => `${CATEGORY_LABEL[c]} ${byCategory[c]}`)
  return { total: items.length, parts, byCategory }
}
