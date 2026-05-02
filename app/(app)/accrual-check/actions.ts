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

export type SuspectRecord = {
  id: string
  payDate: string         // "YYYY-MM-DD"
  payMonth: string        // "YYYY-MM" (payDate가 속한 월)
  targetMonth: string     // 현재 저장된 귀속 월
  actualAmount: number
  seqNo: number
  payMethod: string | null
  memo: string | null
  isDeposit: boolean
  tenantName: string
  roomNo: string | null
  leaseTermId: string
  // 분석 카테고리
  category: 'next-month-early' | 'mismatch-other'
  // 추정 발생 월 (월 1~10일 입금이면 직전 월일 가능성)
  inferredAccrualMonth: string | null
}

export async function analyzePaymentTargetMonth(): Promise<{
  total: number
  matched: number
  suspects: SuspectRecord[]
}> {
  const { propertyId } = await getPropertyId()

  const records = await prisma.paymentRecord.findMany({
    where: { propertyId, isDeposit: false },
    select: {
      id: true, payDate: true, targetMonth: true, actualAmount: true,
      seqNo: true, payMethod: true, memo: true, isDeposit: true,
      leaseTermId: true,
      tenant: { select: { name: true } },
      leaseTerm: { select: { room: { select: { roomNo: true } } } },
    },
    orderBy: { payDate: 'desc' },
  })

  const suspects: SuspectRecord[] = []
  let matched = 0

  for (const r of records) {
    const pd = new Date(r.payDate)
    const py = pd.getFullYear()
    const pm = pd.getMonth() + 1
    const pday = pd.getDate()
    const payMonth = `${py}-${String(pm).padStart(2, '0')}`

    if (payMonth === r.targetMonth) {
      matched++
      continue
    }

    // 발생주의 의심 케이스 분류
    // 1) 월 초(1~10일) 입금인데 targetMonth가 그 입금일이 속한 월 → 직전 월 임대료를 늦게 받았을 가능성
    let category: SuspectRecord['category'] = 'mismatch-other'
    let inferredAccrualMonth: string | null = null

    const prevYear  = pm === 1 ? py - 1 : py
    const prevMonth = pm === 1 ? 12 : pm - 1
    const prevMonthStr = `${prevYear}-${String(prevMonth).padStart(2, '0')}`

    if (pday <= 10 && r.targetMonth === payMonth) {
      // payMonth와 targetMonth가 같지 않으면 위에서 matched로 빠짐. 실제로는 도달 X
    }

    // 더 일반적인 케이스: payDate가 다음 달 1~10일이고 targetMonth가 입금월(=다음 달)이면 직전 달 분일 가능성
    // 즉 targetMonth === payMonth이고 pday가 작은 케이스
    if (r.targetMonth === payMonth && pday <= 10) {
      category = 'next-month-early'
      inferredAccrualMonth = prevMonthStr
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
      category,
      inferredAccrualMonth,
    })
  }

  // 추가: payMonth === targetMonth지만 payDate가 월 초(1~10일)인 케이스도 의심 후보로 추가
  for (const r of records) {
    const pd = new Date(r.payDate)
    const pday = pd.getDate()
    const py = pd.getFullYear()
    const pm = pd.getMonth() + 1
    const payMonth = `${py}-${String(pm).padStart(2, '0')}`

    if (payMonth !== r.targetMonth) continue
    if (pday > 10) continue

    const prevYear  = pm === 1 ? py - 1 : py
    const prevMonth = pm === 1 ? 12 : pm - 1
    const prevMonthStr = `${prevYear}-${String(prevMonth).padStart(2, '0')}`

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
      category: 'next-month-early',
      inferredAccrualMonth: prevMonthStr,
    })
  }

  // 정렬: 호실/입금일 순
  suspects.sort((a, b) => {
    const ra = a.roomNo ?? ''
    const rb = b.roomNo ?? ''
    if (ra !== rb) return ra.localeCompare(rb, 'ko', { numeric: true })
    return a.payDate.localeCompare(b.payDate)
  })

  return { total: records.length, matched, suspects }
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
