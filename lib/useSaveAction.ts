'use client'

import { useTransition, useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { trackSave, pushToast } from './saveStatus'

type ActionResult = { ok: true; [k: string]: unknown } | { ok: false; error: string }

type Options = {
  successToast?: string | null   // null이면 토스트 생략 (기본: '저장됨')
  refresh?: boolean              // 성공 시 router.refresh() 호출 (기본 true)
  onSuccess?: () => void | Promise<void>
}

/**
 * 폼 저장 server action 래퍼.
 * - 호출 시 글로벌 진행 카운터 ↑ → 상단 progress bar 노출
 * - 성공 시 토스트 + router.refresh()
 * - 실패 시 에러 토스트 + 에러 문자열 반환
 *
 * 사용 예:
 *   const { run, isPending, error } = useSaveAction()
 *   await run(() => addExpense(data), { successToast: '지출 등록됨' })
 */
export function useSaveAction() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  const run = useCallback(<T extends ActionResult>(
    action: () => Promise<T>,
    opts: Options = {},
  ): Promise<T> => {
    const { successToast = '저장됨', refresh = true, onSuccess } = opts
    const release = trackSave()
    return new Promise<T>(resolve => {
      startTransition(async () => {
        try {
          const res = await action()
          if (res.ok) {
            setError('')
            if (successToast) pushToast('success', successToast)
            if (onSuccess) await onSuccess()
            if (refresh) router.refresh()
          } else {
            setError(res.error)
            pushToast('error', res.error || '저장에 실패했습니다.')
          }
          resolve(res)
        } catch (e) {
          const msg = (e as Error).message ?? '오류가 발생했습니다.'
          setError(msg)
          pushToast('error', msg)
          resolve({ ok: false, error: msg } as T)
        } finally {
          release()
        }
      })
    })
  }, [router])

  return { run, isPending, error, setError }
}
