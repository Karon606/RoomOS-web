// 매일 스케줄(Vercel Cron) — 구독한 기기로 그날 챙길 알림을 web-push 발송 + 뱃지 갱신.
// 알림 정책 (2026-05-24 변경):
//   · 일정 기반(퇴실예정·투어예정·입주예정) → "당일에 있을 일"만. 경과(지난 날짜)는 알리지 않음.
//   · 진행 중 상태(미납·재고 소진 임박·수령 대기) → 해소될 때까지 매일.
//     - 미납: 도래·미회수(완납 시까지) — computeUnpaidStatus 재사용 (대시보드 '이달 미수납'과 동일 건수).
//     - 재고 소진 임박: computeInventoryOverview 의 lowStock 기준.
// 인증: Vercel Cron 은 Authorization: Bearer <CRON_SECRET> 헤더 전송. 수동 테스트는 ?secret= 도 허용.

import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { computeAlerts, summarizeAlerts, type AlertItem } from '@/app/(app)/dashboard/alerts'
import { kstYmdStr, ymdToDbDate } from '@/lib/kstDate'
import { runIntegrityAudit } from '@/lib/integrityAudit'
import { ensureWebPushConfigured, sendToSubscriptions } from '@/lib/pushSend'
import { canTransition } from '@/lib/leaseTransitions'
import {
  autoCheckoutDue, checkoutLeadKind,
  DEFAULT_SHORT_LEAD_DAYS, DEFAULT_NORMAL_LEAD_MONTHS,
} from '@/lib/autoCheckout'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 알림 목록은 computeAlerts(propertyId) 단일 소스를 쓴다 — 인앱 종과 같은 소스라
// 푸시 뱃지 숫자 = 종 뱃지 숫자가 자동으로 일치한다. (윈도우·당일/미납 정책은 alerts.ts 참조)

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  const secret = new URL(req.url).searchParams.get('secret')
  const cronSecret = process.env.CRON_SECRET
  const authorized = !!cronSecret && (auth === `Bearer ${cronSecret}` || secret === cronSecret)
  if (!authorized) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  // 자동 퇴실 예정 전환 — 거주중 계약이 제 리드에 닿으면 '퇴실 예정'으로.
  // 한 달 이하로 사는 사람은 퇴실 일주일 전, 그보다 오래 사는 사람은 퇴실 한 달 전이다
  // (운영자 오더 2026-08-28. 새 입실자 물색과 청소 일정을 그때부터 잡는다). 판정은
  // lib/autoCheckout 정본이 하고, 리드 일수·개월은 영업장별로 열려 있다.
  //
  // **리드가 계약마다 다르므로 DB 창 하나로 자를 수 없다.** 넓게 뽑아 JS 에서 거른다 —
  // 창은 최대 리드(영업장 설정 중 가장 긴 것) 기준이라, 어떤 영업장 설정에서도 후보를 안 놓친다.
  //
  // autoCheckoutAt 기록으로 재전환 방지(수동 복귀 존중), 퇴실일이 바뀌면 저장 경로가
  // null 로 리셋해 재무장한다(감지망 check-auto-checkout-rearm).
  //
  // **VAPID 검사보다 위에 둔다.** 종전에는 아래에 있어서 푸시 설정이 빠지면 500 으로 빠져나가며
  // 상태 전이까지 조용히 안 돌았다. 계약 상태가 알림 설정에 종속될 이유가 없다.
  //
  // 그리고 updateMany 로 한 번에 밀지 않고 건별로 돌면서 **이력을 남긴다.** 종전에는 이 전이만
  // TenantStatusLog 를 안 써서, 상태 이력에서 "언제 퇴실 예정이 됐나"가 사라졌다
  // (고객 카드 상태 이력 위젯이 생기면서 이 구멍이 드러났다).
  //
  // 창은 @db.Date 저장 축(UTC 자정)으로 잡는다 — 로컬 자정으로 만들던 시절엔 KST 기기에서
  // 창이 하루 앞으로 밀려 '오늘·내일'이 아니라 '어제·오늘' 퇴실을 집었다. 창 정본은 lib/kstDate.
  const todayYmd = kstYmdStr()
  const leadPolicies = await prisma.property.findMany({
    select: { id: true, checkoutLeadShortDays: true, checkoutLeadMonths: true },
  })
  const policyOf = new Map(leadPolicies.map(p => [p.id, {
    shortDays: p.checkoutLeadShortDays, normalMonths: p.checkoutLeadMonths,
  }]))
  // 후보 창 — 가장 긴 리드까지 넉넉히 잡는다. 개월은 31일로 환산해 위로 올린다(자르는 것은 JS 가 한다).
  const maxLeadDays = Math.max(
    ...leadPolicies.map(p => Math.max(p.checkoutLeadShortDays, p.checkoutLeadMonths * 31)),
    DEFAULT_SHORT_LEAD_DAYS, DEFAULT_NORMAL_LEAD_MONTHS * 31,
  )
  const kstToday = ymdToDbDate(todayYmd)
  const horizon = new Date(kstToday.getTime() + (maxLeadDays + 1) * 86400000)
  const flipCandidates = await prisma.leaseTerm.findMany({
    where: {
      status: 'ACTIVE', autoCheckoutAt: null,
      expectedMoveOut: { not: null, lt: horizon },
    },
    select: {
      id: true, status: true, tenantId: true, propertyId: true,
      isShortTerm: true, expectedMoveOut: true, moveInDate: true,
    },
  })
  const ymd = (d: Date | null) => d ? d.toISOString().slice(0, 10) : null
  let flippedCount = 0
  for (const lt of flipCandidates) {
    const lease = {
      isShortTerm: lt.isShortTerm,
      expectedMoveOut: ymd(lt.expectedMoveOut),
      moveInDate: ymd(lt.moveInDate),
    }
    const policy = policyOf.get(lt.propertyId) ?? {}
    if (!autoCheckoutDue(lease, todayYmd, policy)) continue
    // 전이표를 통과하는 것만 — 사람이 하는 전환과 같은 규칙을 크론에도 건다
    if (!canTransition(lt.status, 'CHECKOUT_PENDING')) continue
    await prisma.leaseTerm.update({
      where: { id: lt.id },
      data: { status: 'CHECKOUT_PENDING', autoCheckoutAt: new Date() },
    })
    await prisma.tenantStatusLog.create({
      data: {
        tenantId: lt.tenantId, leaseTermId: lt.id, propertyId: lt.propertyId,
        fromStatus: lt.status, toStatus: 'CHECKOUT_PENDING',
        // 리드가 갈리므로 이유도 갈린다 — '단기 자동 전환' 하나로 두면 일반 건이 거짓 라벨을 단다.
        // changedById 가 없는 것이 '시스템이 했다'는 표시다.
        reason: checkoutLeadKind(lease) === 'short' ? '단기 자동 전환' : '퇴실 한 달 전 자동 전환',
      },
    })
    flippedCount++
  }
  const autoFlipped = { count: flippedCount }

  if (!ensureWebPushConfigured()) {
    return NextResponse.json({ ok: false, error: 'VAPID not configured', autoFlipped: flippedCount }, { status: 500 })
  }

  // 데이터 정합 감사(운영자 오더 2026-07-20, 땜빵 금지) — 위반을 오류신고로 자동 적재.
  // 실패해도 푸시 발송은 계속(감사는 부가 기능).
  const audit = await runIntegrityAudit(prisma).catch(() => null)

  const subs = await prisma.pushSubscription.findMany()
  const byUser = new Map<string, typeof subs>()
  for (const s of subs) {
    const arr = byUser.get(s.userId)
    if (arr) arr.push(s)
    else byUser.set(s.userId, [s])
  }

  let usersNotified = 0
  let sent = 0
  for (const [userId, userSubs] of byUser) {
    const [owned, roles] = await Promise.all([
      prisma.property.findMany({ where: { ownerId: userId }, select: { id: true } }),
      prisma.userPropertyRole.findMany({ where: { userId }, select: { propertyId: true } }),
    ])
    const propIds = Array.from(new Set([...owned.map(o => o.id), ...roles.map(r => r.propertyId)]))
    if (propIds.length === 0) continue

    // 사용자가 접근 가능한 모든 영업장의 알림을 합산 (종과 같은 computeAlerts 소스)
    const allItems: AlertItem[] = []
    for (const pid of propIds) allItems.push(...await computeAlerts(pid))
    const { total, parts } = summarizeAlerts(allItems)
    if (total === 0) continue

    const payload = JSON.stringify({
      title: `스테이음 · 오늘 챙길 일 ${total}건`,
      body: parts.join(' · '),
      url: '/dashboard',
      badge: total,
      tag: 'stayeum-daily',
    })

    const userSuccess = await sendToSubscriptions(userSubs, payload)
    sent += userSuccess
    if (userSuccess > 0) usersNotified++

    // 발송 내역 기록 — 시도/성공 카운트와 함께
    try {
      await prisma.pushHistory.create({
        data: {
          userId,
          source: 'cron-daily',
          title: `스테이음 · 오늘 챙길 일 ${total}건`,
          body: parts.join(' · '),
          url: '/dashboard',
          badge: total,
          tag: 'stayeum-daily',
          endpointCount: userSubs.length,
          successCount: userSuccess,
        },
      })
    } catch { /* 히스토리 실패해도 푸시 자체 영향 X */ }
  }

  // 방문 기록 IP 보관 기간 정리 — 90일 지난 행은 ip 만 비운다(운영자 결정 2026-07-24).
  // 방문 기록·통계는 그대로 남고 개인 식별 정보만 사라진다. 실패해도 크론 본래 일(알림)에는 영향 없음.
  let ipPurged = 0
  try {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    const purged = await prisma.pageView.updateMany({
      where: { occurredAt: { lt: cutoff }, ip: { not: null } },
      data: { ip: null },
    })
    ipPurged = purged.count
  } catch { /* IP 정리 실패는 알림 발송과 무관 */ }

  return NextResponse.json({ ok: true, autoCheckout: autoFlipped.count, usersNotified, sent, integrity: audit, ipPurged })
}
