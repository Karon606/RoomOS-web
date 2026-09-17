'use server'

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireEdit } from '@/lib/role'
import { DEFAULT_CHECKLIST_ALERT_DAYS_BEFORE } from '@/lib/appConfig'
import { assertNotFuture, resolveCompletionAt } from '@/lib/completionDate'

async function getPropertyId() {
  const { propertyId, userId } = await requirePropertyAccess()
  return { propertyId, userId }
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

/**
 * 점검 완료 — lastCheckedAt 갱신 + 로그 기록.
 *
 * **점검일도 운영자가 적는다**(지시 2026-09-17). 매일 누르는 자리라 묻지 말자는 안도 있었지만,
 * 세 자리(요청·점검·현금영수증)가 같은 문법이 되는 쪽을 골랐다(운영자 결정). 실측으로도 이 화면은
 * 로그 8건이 전부 2026-05-06 하루뿐이라, 한 번 누르는 데 드는 손이 문제가 되는 자리가 아니다.
 *
 * `ChecklistLog` 에는 수정 문이 없다 — 삭제가 곧 적용취소다. 그 대칭을 깨지 않으려고 날짜는
 * **완료 시점에만** 받는다(나중에 고치려면 지우고 다시 기록한다).
 */
export async function markChecklistDone(input: {
  id: string
  memo?: string
  /** 운영자가 고른 점검일 'YYYY-MM-DD'(KST). 안 넘기면 지금. */
  doneDate?: string | null
  /** 적용취소 복원용 — 지운 로그의 원래 시각을 밀리초까지 되돌린다. */
  restoreCheckedAt?: string | null
}): Promise<{ ok: true; logId: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { userId } = await getPropertyId()
    const guard = assertNotFuture(input.doneDate)
    if (!guard.ok) return { ok: false, error: guard.reason }
    // 로그는 매번 새 줄이라 '기존 값'이 없다 — 지난 점검 시각을 물려받으면 이번 점검이 사라진다.
    const at = input.restoreCheckedAt
      ? new Date(input.restoreCheckedAt)
      : resolveCompletionAt({ picked: input.doneDate, column: 'timestamp' })
    // 지난 점검을 뒤늦게 적을 수 있게 되면서 lastCheckedAt 이 **뒤로 밀 수 있다.** 9/15 에 점검한
    // 항목에 9/10 을 적으면 다음 예정일이 앞당겨져 멀쩡한 항목이 '경과'로 뜬다. 마지막 점검은
    // 언제나 가장 늦은 로그다 — deleteChecklistLog 가 삭제 후 하는 재계산과 같은 규칙이다.
    const cur = await prisma.checklist.findUnique({ where: { id: input.id }, select: { lastCheckedAt: true } })
    const last = cur?.lastCheckedAt && cur.lastCheckedAt > at ? cur.lastCheckedAt : at
    // 적용취소(undo)용으로 생성된 로그 id를 반환 — 취소는 기존 deleteChecklistLog 재사용.
    const [, log] = await prisma.$transaction([
      prisma.checklist.update({
        where: { id: input.id },
        data: { lastCheckedAt: last },
      }),
      prisma.checklistLog.create({
        data: {
          checklistId: input.id,
          checkedAt: at,
          checkedBy: userId,
          memo: input.memo?.trim() || null,
        },
      }),
    ])
    revalidatePath('/checklist')
    revalidatePath('/dashboard')
    return { ok: true, logId: log.id }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 점검 이력 삭제 — 이것이 곧 완료의 적용취소다(ChecklistLog 에 수정 문은 없다).
//
// **지운 로그의 시각·메모를 스냅샷으로 돌려준다**(현금영수증 prevIssuedAt 선례). 종전에는
// 되돌렸다 다시 완료하면 오늘이 박혔다. 화면이 이 값을 들고 있다가 restoreCheckedAt 으로 되살린다.
export async function deleteChecklistLog(logId: string): Promise<{ ok: true; prev: { checklistId: string; checkedAt: string; memo: string | null } } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const log = await prisma.checklistLog.findUnique({
      where: { id: logId },
      select: { checklistId: true, checkedAt: true, memo: true },
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
    return { ok: true, prev: { checklistId: log.checklistId, checkedAt: log.checkedAt.toISOString(), memo: log.memo } }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}
