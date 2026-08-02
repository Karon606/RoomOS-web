'use server'

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { getMyRole } from '@/lib/role'
import { canReadScope } from '@/lib/auth/routeScope'
import { discountedRent } from '@/lib/rentDiscount'
import prisma from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import type { ReceiptKind } from '@/lib/rentReceiptPdf'

// 입실료 납부 확인서 자동 채움 — 입실자/계약/영업장에서.
export type RentReceiptData = {
  tenantId: string
  leaseTermId: string | null
  name: string            // 수령인(입주자) 성명
  room: string            // 호실
  period: string          // 거주 기간 (예 '2026.01.15 ~ 2026.07.14')
  targetMonth: string     // 납부 대상월 (예 '2026년 6월분')
  amount: number          // 월세
  payDate: string         // 납부일 (예 '2026년 6월 16일')
  payMethod: string       // 납부방법 (계좌이체 · 계좌번호 / 현금)
  note: string            // 비고 (기본: 다음 납부 예정일)
  recipientName: string   // 임대인 대표 성명
  anchorMonth: string     // 대상 주기 시작월 'YYYY-MM' (발급 화면 월 스테퍼 기준)
  todayMonth: string      // 이번 달 'YYYY-MM' (KST) — 과거 월 배지·미래 월 차단 판정용
  isShortTerm: boolean    // 단기 입주자 — 입주월 단일 청구라 월 스테퍼 숨김(회계 오더 2026-07-27)
  // 화면 전용 경고(인쇄물 미출력) — noRecord: 그 달 수납 기록 없음(0원), partial: 실입금이 청구액보다 부족
  warning: 'noRecord' | 'partial' | null
  kind: ReceiptKind       // 'deposit' 이면 보증금 영수증(월 개념 없음 — 스테퍼 숨김)
  preResidence: boolean   // 입주 전 보증금(예약금 성격) — 거주 기간 비움 + 반환 조건 문구가 다르다
}

const dotPad = (ymd: string) => { const [y, m, d] = ymd.split('-'); return `${y}.${(m ?? '').padStart(2, '0')}.${(d ?? '').padStart(2, '0')}` }
const kor = (ymd: string) => { const [y, m, d] = ymd.split('-').map(Number); return `${y}년 ${m}월 ${d}일` }

// 월세 1달 선납 주기 — 납부일(dueDay) 기준(없으면 입주일의 일). 예) dueDay 5 → 6/5~7/4.
// anchorMonth('YYYY-MM')를 주면 그 달의 dueDay 를 주기 시작으로 잡는다(과거 달 발급). 없으면 오늘 기준 현재 주기.
function rentCyclePeriod(dueDay: string | null, moveIn: Date | null, anchorMonth?: string | null): { start: string; end: string } {
  let day = parseInt((dueDay ?? '').replace(/[^0-9]/g, ''), 10)
  if (!Number.isFinite(day) || day < 1 || day > 31) day = moveIn ? new Date(moveIn).getUTCDate() : 1
  const now = new Date(Date.now() + 9 * 3600 * 1000) // KST
  const y = now.getUTCFullYear(), m = now.getUTCMonth(), d = now.getUTCDate()
  const daysIn = (yy: number, mm: number) => new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate()
  const anchor = /^\d{4}-\d{2}$/.test(anchorMonth ?? '') ? (anchorMonth as string).split('-').map(Number) : null
  let sy = y, sm = m
  if (anchor) { sy = anchor[0]; sm = anchor[1] - 1 }
  else if (d < Math.min(day, daysIn(y, m))) { sm = m - 1; if (sm < 0) { sm = 11; sy = y - 1 } }
  const start = new Date(Date.UTC(sy, sm, Math.min(day, daysIn(sy, sm))))
  let ny = sy, nm = sm + 1; if (nm > 11) { nm = 0; ny = sy + 1 }
  const nextStart = new Date(Date.UTC(ny, nm, Math.min(day, daysIn(ny, nm))))
  const end = new Date(nextStart.getTime() - 86400000)
  const fmt = (dt: Date) => dt.toISOString().slice(0, 10)
  return { start: fmt(start), end: fmt(end) }
}

type BusinessInfo = { name?: string; registrationNo?: string; ceoName?: string; address?: string }

async function requireAuthAndProperty() {
  const { userId, propertyId } = await requirePropertyAccess()
  return { userId, propertyId }
}

const fmtRoom = (v: string | null | undefined) => v ? (/^\d+$/.test(v.trim()) ? `${v.trim()}호` : v) : ''

// month('YYYY-MM')를 주면 그 달 주기로 자동값을 채운다(과거 달 발급). 미지정이면 현재 주기 — 기존 재발급 링크 무회귀.
export async function getRentReceiptData(tenantId: string, month?: string, kind: ReceiptKind = 'rent'): Promise<RentReceiptData | null> {
  // 이 라우트는 (app) 셸 밖이라 canAccessRoute 가 안 걸린다. 목록은 막혀 있는데
  // 상세 URL 로 직접 들어가면 금액·생년월일·전화가 그대로 보였다(E페이즈 조사 2026-08-03).
  if (!canReadScope(await getMyRole(), 'money')) throw new Error('권한이 없습니다.')
  const { propertyId } = await requireAuthAndProperty()

  const [tenant, property] = await Promise.all([
    prisma.tenant.findFirst({
      where: { id: tenantId, propertyId },
      include: {
        leaseTerms: {
          // CHECKOUT_PENDING 누락 — 퇴실 예정자에게 확인서를 못 뗐다. 계약서(contractData)와
          // 실거주확인서는 원래 포함한다. 실측 5명이 해당하고 507·509호는 이미 발급 이력이 있다.
          where: { status: { in: ['ACTIVE', 'CHECKOUT_PENDING', 'RESERVED'] } },
          orderBy: [{ moveInDate: 'desc' }, { createdAt: 'desc' }],
          take: 1,
          include: { room: { select: { roomNo: true } }, discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } } },
        },
      },
    }),
    prisma.property.findUnique({
      where: { id: propertyId },
      select: { phone: true, businessInfo: true, bankAccount: true },
    }),
  ])

  if (!tenant) return null

  const lease = tenant.leaseTerms[0] ?? null
  const biz = (property?.businessInfo as BusinessInfo | null) ?? {}
  const isShortTerm = !!lease?.isShortTerm
  // 단기는 입주월 단일 청구 — anchor 를 입주월로 고정(스테퍼도 화면에서 숨김, 회계 오더 2026-07-27)
  const requestedMonth = /^\d{4}-\d{2}$/.test(month ?? '') ? (month as string) : null
  const anchorMonth = isShortTerm && lease?.moveInDate
    ? new Date(lease.moveInDate).toISOString().slice(0, 7)
    : requestedMonth
  const cycle = rentCyclePeriod(lease?.dueDay ?? null, lease?.moveInDate ?? null, anchorMonth)
  const nextDue = dotPad(new Date(new Date(`${cycle.end}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10))
  const [cy, cm] = cycle.start.split('-').map(Number)
  const todayKst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
  const todayMonth = todayKst.slice(0, 7)
  const viewMonth = cycle.start.slice(0, 7)

  // ── 보증금 영수증(kind='deposit') ─────────────────────────────────────
  // 보증금은 귀속 월이 없는 1회성 수령이고 반환 예정 채무다. 따라서 월 필터를 타지 않고
  // lease 전체의 isDeposit 실수납을 합산한다("받은 돈은 조회월과 무관" 정본).
  // 약정액(lease.depositAmount)을 자동기입하지 않는 것은 이용료와 같은 규칙 — 안 받은 돈을 받았다고
  // 적으면 허위 서류다. 부분 수령이면 화면 경고만 띄우고 발급 자체는 막지 않는다.
  if (kind === 'deposit') {
    const bank = property?.bankAccount ? `계좌이체 · ${property.bankAccount}` : '현금'
    let paid = 0
    let last: { payDate: Date; payMethod: string | null } | null = null
    if (lease) {
      const recs = await prisma.paymentRecord.findMany({
        where: { leaseTermId: lease.id, isDeposit: true, isPrevOwner: false },
        select: { actualAmount: true, payDate: true, payMethod: true },
        orderBy: { payDate: 'asc' },
      })
      for (const r of recs) {
        if (r.actualAmount <= 0) continue
        paid += r.actualAmount
        last = { payDate: r.payDate, payMethod: r.payMethod }
      }
    }
    const contracted = lease?.depositAmount ?? 0
    const moveInYmd = lease?.moveInDate ? new Date(lease.moveInDate).toISOString().slice(0, 10) : null
    // 아직 입주 전이면 거주한 적이 없으므로 거주 기간을 비운다(운영자 지적 2026-07-31).
    // 보증금은 입주 전에 받는 돈이라 이 경우가 오히려 일반적이고, 살지도 않은 기간을 적으면 허위 기재다.
    const notMovedIn = lease?.status === 'RESERVED' || (!!moveInYmd && moveInYmd > todayKst)
    return {
      tenantId: tenant.id,
      leaseTermId: lease?.id ?? null,
      name: tenant.name,
      room: fmtRoom(lease?.room?.roomNo),
      period: notMovedIn ? '' : `${dotPad(cycle.start)} ~ ${dotPad(cycle.end)}`,
      targetMonth: moveInYmd ? kor(moveInYmd) : '',
      amount: paid,
      payDate: kor(last ? new Date(last.payDate.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10) : todayKst),
      payMethod: last?.payMethod ?? bank,
      // 입주 전이면 예약금과 성격이 같다 — 입실 취소 시 반환되지 않는다는 점을 비고에 명시(운영자 지시)
      note: notMovedIn
        ? (contracted > 0 && paid < contracted
            ? `계약 보증금 ${contracted.toLocaleString()}원 중 일부 · 입실 취소 시 반환되지 않습니다`
            : '입주 전 예약금 · 입실 취소 시 반환되지 않습니다')
        : (contracted > 0 && paid < contracted
            ? `계약 보증금 ${contracted.toLocaleString()}원 중 일부 수령`
            : '퇴실 시 미납금·손해배상액 공제 후 반환'),
      recipientName: biz.ceoName ?? '',
      anchorMonth: viewMonth,
      todayMonth,
      isShortTerm,
      warning: paid <= 0 ? 'noRecord' : (contracted > 0 && paid < contracted ? 'partial' : null),
      kind,
      preResidence: notMovedIn,
    }
  }

  // 납부 확인서의 정본은 실입금(회계 오더 2026-07-27) — 그 귀속월(targetMonth=주기 시작월)의 수납 기록.
  // 보증금·양도인 몫·청구 조정 전표 제외. 소프트삭제는 prisma 확장이 자동 필터(where 에 deletedAt 금지).
  let paidSum = 0
  let lastRec: { payDate: Date; payMethod: string | null } | null = null
  let lockMax = 0
  if (lease) {
    const recs = await prisma.paymentRecord.findMany({
      where: { leaseTermId: lease.id, targetMonth: viewMonth, isDeposit: false, isPrevOwner: false },
      select: { actualAmount: true, expectedAmount: true, payDate: true, payMethod: true, isBillingAdjust: true },
      orderBy: { payDate: 'asc' },
    })
    for (const r of recs) {
      lockMax = Math.max(lockMax, r.expectedAmount)   // 청구 락(조정 전표 포함) — 부분 납부 판정용
      if (r.isBillingAdjust) continue                 // 조정 전표는 실입금 아님
      if (r.actualAmount > 0) { paidSum += r.actualAmount; lastRec = { payDate: r.payDate, payMethod: r.payMethod } }
    }
  }

  const defaultPayMethod = property?.bankAccount ? `계좌이체 · ${property.bankAccount}` : '현금'
  const isPastMonth = viewMonth < todayMonth
  let amount: number
  let payDateYmd: string
  let payMethod = defaultPayMethod
  let warning: 'noRecord' | 'partial' | null = null
  if (paidSum > 0 && lastRec) {
    // 실입금이 있으면 과거·이번 달 공통으로 실입금 합 + 최종 입금일 + 그 record 의 납부방법
    amount = paidSum
    payDateYmd = new Date(lastRec.payDate.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10)
    payMethod = lastRec.payMethod ?? defaultPayMethod
    if (lockMax > 0 && paidSum < lockMax) warning = 'partial'
  } else if (isPastMonth) {
    // 기록 없는 과거 달 — 계약액 자동기입은 허위 서류가 된다. 0원 + 경고(발급 차단은 안 함, 수동 입력 허용)
    amount = 0
    payDateYmd = cycle.start
    warning = 'noRecord'
  } else {
    // 이번 달인데 아직 기록 없음 — '방금 받은 돈' 발급 흐름의 초기값. 할인 반영 청구액이 정직한 기본값
    // (원가 직표시 금지 — 크리티컬 신고 50a2a69b 정본 수렴)
    amount = lease ? discountedRent(lease.discounts ?? [], viewMonth, lease.rentAmount) : 0
    payDateYmd = todayKst
  }

  return {
    tenantId: tenant.id,
    leaseTermId: lease?.id ?? null,
    name: tenant.name,
    room: fmtRoom(lease?.room?.roomNo),
    period: `${dotPad(cycle.start)} ~ ${dotPad(cycle.end)}`,
    targetMonth: `${cy}년 ${cm}월분`,
    amount,
    payDate: kor(payDateYmd),
    payMethod,
    note: `다음 납부 예정일 ${nextDue}`,
    recipientName: biz.ceoName ?? '',
    anchorMonth: viewMonth,
    todayMonth,
    isShortTerm,
    warning,
    kind,
    preResidence: false,
  }
}
