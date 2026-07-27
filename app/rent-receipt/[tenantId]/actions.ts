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
  const anchorMonth = /^\d{4}-\d{2}$/.test(month ?? '') ? (month as string) : null
  const cycle = rentCyclePeriod(lease?.dueDay ?? null, lease?.moveInDate ?? null, anchorMonth)
  const nextDue = dotPad(new Date(new Date(`${cycle.end}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10))
  const [cy, cm] = cycle.start.split('-').map(Number)
  const todayKst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
  const todayMonth = todayKst.slice(0, 7)
  // 납부일 기본값 — 과거 월 발급이면 그 주기 시작일, 이번 달(또는 월 미지정)이면 오늘.
  const payDate = anchorMonth && anchorMonth < todayMonth ? cycle.start : todayKst

  return {
    tenantId: tenant.id,
    leaseTermId: lease?.id ?? null,
    name: tenant.name,
    room: fmtRoom(lease?.room?.roomNo),
    period: `${dotPad(cycle.start)} ~ ${dotPad(cycle.end)}`,
    targetMonth: `${cy}년 ${cm}월분`,
    amount: lease?.rentAmount ?? 0,
    payDate: kor(payDate),
    payMethod: property?.bankAccount ? `계좌이체 · ${property.bankAccount}` : '현금',
    note: `다음 납부 예정일 ${nextDue}`,
    recipientName: biz.ceoName ?? '',
    anchorMonth: cycle.start.slice(0, 7),
    todayMonth,
  }
}
