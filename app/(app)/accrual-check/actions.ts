'use server'

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { redirect } from 'next/navigation'

async function getPropertyId() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const cookieStore = await cookies()
  const propertyId = cookieStore.get('selected_property_id')?.value
  if (!propertyId) redirect('/property-select')
  return { user, propertyId }
}

export type SuspectCategory =
  | 'late-payment'    // payMonth = targetMonth + 1 (다음 달에 받음 → 직전 월 매출일 가능성, 확인 필요)
  | 'pre-payment'     // payMonth = targetMonth - 1 (직전 달에 받음 → 다음 월 선납 — 정상이지만 확인용)
  | 'mismatch-other'  // 그 외 월 불일치 (수동 검토 필수)

export type SuspectRecord = {
  id: string
  payDate: string         // "YYYY-MM-DD"
  payMonth: string        // payDate가 속한 월
  targetMonth: string     // 현재 저장된 귀속 월
  actualAmount: number
  seqNo: number
  payMethod: string | null
  memo: string | null
  isDeposit: boolean
  tenantName: string
  roomNo: string | null
  leaseTermId: string
  dueDay: string | null
  isPrevOwner: boolean    // 양도인 record (payDate < cutoffDate) — 인수월에서만 별도 표시
  category: SuspectCategory
  inferredAccrualMonth: string | null  // FIFO 추정 귀속 월
}

export async function analyzePaymentTargetMonth(): Promise<{
  total: number
  matched: number
  prevOwnerCount: number
  suspects: SuspectRecord[]
}> {
  const { propertyId } = await getPropertyId()

  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { acquisitionDate: true, prevOwnerCutoffDate: true },
  })
  const cutoffRaw = property?.prevOwnerCutoffDate ?? property?.acquisitionDate ?? null
  const cutoffDate = cutoffRaw ? new Date(cutoffRaw) : null

  const records = await prisma.paymentRecord.findMany({
    where: { propertyId, isDeposit: false },
    select: {
      id: true, payDate: true, targetMonth: true, actualAmount: true,
      seqNo: true, payMethod: true, memo: true, isDeposit: true,
      leaseTermId: true,
      tenant: { select: { name: true } },
      leaseTerm: {
        select: {
          dueDay: true,
          room: { select: { roomNo: true } },
        },
      },
    },
    orderBy: { payDate: 'desc' },
  })

  const suspects: SuspectRecord[] = []
  let matched = 0
  let prevOwnerCount = 0

  // 월 비교 헬퍼
  const monthDiff = (a: string, b: string): number => {
    // a - b in months (positive: a is later)
    const [ay, am] = a.split('-').map(Number)
    const [by, bm] = b.split('-').map(Number)
    return (ay - by) * 12 + (am - bm)
  }
  const prevMonthStr = (m: string): string => {
    const [y, mn] = m.split('-').map(Number)
    const py = mn === 1 ? y - 1 : y
    const pm = mn === 1 ? 12 : mn - 1
    return `${py}-${String(pm).padStart(2, '0')}`
  }

  for (const r of records) {
    const pd = new Date(r.payDate)
    const py = pd.getFullYear()
    const pm = pd.getMonth() + 1
    const payMonth = `${py}-${String(pm).padStart(2, '0')}`

    // 양도인 record (인수일 이전 입금) — 별도 카운트, 의심 후보 X
    const isPrevOwner = !!(cutoffDate && pd < cutoffDate)
    if (isPrevOwner) {
      prevOwnerCount++
      continue
    }

    // 정상: payMonth === targetMonth
    if (payMonth === r.targetMonth) {
      matched++
      continue
    }

    // 월 불일치 — 카테고리 분류
    const diff = monthDiff(payMonth, r.targetMonth) // payMonth - targetMonth
    let category: SuspectCategory
    let inferredAccrualMonth: string | null = null

    if (diff === 1) {
      // 다음 달에 받음 — "지연 입금" 가능성. 회계상 정상이지만 사용자 확인 권장
      category = 'late-payment'
      inferredAccrualMonth = prevMonthStr(payMonth)
    } else if (diff === -1) {
      // 직전 달에 받음 — "선납" 가능성 (정상)
      category = 'pre-payment'
      inferredAccrualMonth = payMonth
    } else {
      category = 'mismatch-other'
    }

    suspects.push({
      id: r.id,
      payDate: r.payDate.toISOString().slice(0, 10),
      payMonth,
      targetMonth: r.targetMonth,
      actualAmount: r.actualAmount,
      seqNo: r.seqNo,
      payMethod: r.payMethod,
      memo: r.memo,
      isDeposit: r.isDeposit,
      tenantName: r.tenant.name,
      roomNo: r.leaseTerm.room?.roomNo ?? null,
      leaseTermId: r.leaseTermId,
      dueDay: r.leaseTerm.dueDay,
      isPrevOwner: false,
      category,
      inferredAccrualMonth,
    })
  }

  // 정렬: 호실 → 입금일
  suspects.sort((a, b) => {
    const ra = a.roomNo ?? ''
    const rb = b.roomNo ?? ''
    if (ra !== rb) return ra.localeCompare(rb, 'ko', { numeric: true })
    return a.payDate.localeCompare(b.payDate)
  })

  return { total: records.length, matched, prevOwnerCount, suspects }
}

// 단일 PaymentRecord의 targetMonth를 변경 (사용자 검토 후 수동 적용)
export async function moveRecordTargetMonth(
  recordId: string,
  newTargetMonth: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { propertyId } = await getPropertyId()

    if (!/^\d{4}-\d{2}$/.test(newTargetMonth)) {
      return { ok: false, error: '월 형식이 올바르지 않습니다 (YYYY-MM).' }
    }

    const record = await prisma.paymentRecord.findFirst({
      where: { id: recordId, propertyId },
      select: { leaseTermId: true, targetMonth: true, seqNo: true, actualAmount: true },
    })
    if (!record) return { ok: false, error: '기록을 찾을 수 없습니다.' }
    if (record.targetMonth === newTargetMonth) return { ok: true }

    // 새 월의 다음 seqNo 결정 (unique 제약 [leaseTermId, targetMonth, seqNo])
    const lastInNewMonth = await prisma.paymentRecord.findFirst({
      where: { leaseTermId: record.leaseTermId, targetMonth: newTargetMonth },
      orderBy: { seqNo: 'desc' },
      select: { seqNo: true },
    })
    const newSeqNo = (lastInNewMonth?.seqNo ?? 0) + 1

    await prisma.paymentRecord.update({
      where: { id: recordId },
      data: { targetMonth: newTargetMonth, seqNo: newSeqNo },
    })

    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}
