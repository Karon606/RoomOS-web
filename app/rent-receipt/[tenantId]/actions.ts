'use server'

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import prisma from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

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
export async function getRentReceiptData(tenantId: string, month?: string): Promise<RentReceiptData | null> {
  const { propertyId } = await requireAuthAndProperty()

  const [tenant, property] = await Promise.all([
    prisma.tenant.findFirst({
      where: { id: tenantId, propertyId },
      include: {
        leaseTerms: {
          where: { status: { in: ['ACTIVE', 'RESERVED'] } },
          orderBy: [{ moveInDate: 'desc' }, { createdAt: 'desc' }],
          take: 1,
          include: { room: { select: { roomNo: true } } },
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
    // 이번 달인데 아직 기록 없음 — '방금 받은 돈' 발급 흐름의 초기값(현행 유지, 경고 없음)
    amount = lease?.rentAmount ?? 0
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
  }
}
