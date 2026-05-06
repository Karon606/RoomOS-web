'use server'

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireEdit } from '@/lib/role'
import { DEFAULT_CHECKLIST_ALERT_DAYS_BEFORE } from '@/lib/appConfig'

async function getPropertyId() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const cookieStore = await cookies()
  const propertyId = cookieStore.get('selected_property_id')?.value
  if (!propertyId) redirect('/property-select')
  return { propertyId, userId: user.id }
}

export type ChecklistRow = {
  id: string
  title: string
  memo: string | null
  intervalDays: number
  alertDaysBefore: number
  lastCheckedAt: string | null   // ISO
  nextDueAt: string | null       // ISO (lastCheckedAt + intervalDays). null이면 한 번도 점검 안 함
  daysUntilDue: number | null    // 양수=남은일수, 0=오늘, 음수=경과
  isActive: boolean
  sortOrder: number
  recentLogs: { id: string; checkedAt: string; memo: string | null }[]
}

function computeNextDue(lastCheckedAt: Date | null, intervalDays: number): Date | null {
  if (!lastCheckedAt) return null
  const d = new Date(lastCheckedAt)
  d.setDate(d.getDate() + intervalDays)
  return d
}

function daysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

export async function getChecklists(): Promise<ChecklistRow[]> {
  const { propertyId } = await getPropertyId()
  const items = await prisma.checklist.findMany({
    where: { propertyId },
    orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    include: {
      logs: { orderBy: { checkedAt: 'desc' }, take: 5 },
    },
  })

  const now = new Date()
  return items.map(it => {
    const nextDue = computeNextDue(it.lastCheckedAt, it.intervalDays)
    const daysUntilDue = nextDue ? daysBetween(now, nextDue) : null
    return {
      id: it.id,
      title: it.title,
      memo: it.memo,
      intervalDays: it.intervalDays,
      alertDaysBefore: it.alertDaysBefore,
      lastCheckedAt: it.lastCheckedAt ? it.lastCheckedAt.toISOString() : null,
      nextDueAt: nextDue ? nextDue.toISOString() : null,
      daysUntilDue,
      isActive: it.isActive,
      sortOrder: it.sortOrder,
      recentLogs: it.logs.map(l => ({
        id: l.id,
        checkedAt: l.checkedAt.toISOString(),
        memo: l.memo,
      })),
    }
  })
}

// 대시보드 알림용 — D-N 임계 이내 + 경과 항목만 추출
export async function getDueChecklists(): Promise<ChecklistRow[]> {
  const all = await getChecklists()
  return all.filter(c => {
    if (!c.isActive) return false
    if (c.daysUntilDue == null) return true   // 한 번도 점검 안 함 → 알림
    return c.daysUntilDue <= c.alertDaysBefore  // D-N 이내 또는 경과
  })
}

export async function createChecklist(input: {
  title: string
  memo?: string
  intervalDays: number
  alertDaysBefore?: number
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    if (!input.title.trim()) return { ok: false, error: '제목을 입력해주세요.' }
    if (!Number.isFinite(input.intervalDays) || input.intervalDays < 1) {
      return { ok: false, error: '주기는 1일 이상이어야 합니다.' }
    }
    const maxOrder = await prisma.checklist.aggregate({
      where: { propertyId },
      _max: { sortOrder: true },
    })
    const created = await prisma.checklist.create({
      data: {
        propertyId,
        title: input.title.trim(),
        memo: input.memo?.trim() || null,
        intervalDays: input.intervalDays,
        alertDaysBefore: input.alertDaysBefore ?? DEFAULT_CHECKLIST_ALERT_DAYS_BEFORE,
        sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
      },
    })
    revalidatePath('/checklist')
    revalidatePath('/dashboard')
    return { ok: true, id: created.id }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function updateChecklist(input: {
  id: string
  title: string
  memo?: string
  intervalDays: number
  alertDaysBefore?: number
  isActive?: boolean
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    if (!input.title.trim()) return { ok: false, error: '제목을 입력해주세요.' }
    if (!Number.isFinite(input.intervalDays) || input.intervalDays < 1) {
      return { ok: false, error: '주기는 1일 이상이어야 합니다.' }
    }
    await prisma.checklist.update({
      where: { id: input.id },
      data: {
        title: input.title.trim(),
        memo: input.memo?.trim() || null,
        intervalDays: input.intervalDays,
        alertDaysBefore: input.alertDaysBefore ?? DEFAULT_CHECKLIST_ALERT_DAYS_BEFORE,
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    })
    revalidatePath('/checklist')
    revalidatePath('/dashboard')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function deleteChecklist(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    await prisma.checklist.delete({ where: { id } })
    revalidatePath('/checklist')
    revalidatePath('/dashboard')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 점검 완료 — lastCheckedAt 갱신 + 로그 기록
export async function markChecklistDone(input: {
  id: string
  memo?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { userId } = await getPropertyId()
    const now = new Date()
    await prisma.$transaction([
      prisma.checklist.update({
        where: { id: input.id },
        data: { lastCheckedAt: now },
      }),
      prisma.checklistLog.create({
        data: {
          checklistId: input.id,
          checkedAt: now,
          checkedBy: userId,
          memo: input.memo?.trim() || null,
        },
      }),
    ])
    revalidatePath('/checklist')
    revalidatePath('/dashboard')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function deleteChecklistLog(logId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const log = await prisma.checklistLog.findUnique({
      where: { id: logId },
      select: { checklistId: true },
    })
    if (!log) return { ok: false, error: '로그를 찾을 수 없습니다.' }
    await prisma.checklistLog.delete({ where: { id: logId } })
    // 마지막 점검일 재계산
    const latest = await prisma.checklistLog.findFirst({
      where: { checklistId: log.checklistId },
      orderBy: { checkedAt: 'desc' },
    })
    await prisma.checklist.update({
      where: { id: log.checklistId },
      data: { lastCheckedAt: latest ? latest.checkedAt : null },
    })
    revalidatePath('/checklist')
    revalidatePath('/dashboard')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}
