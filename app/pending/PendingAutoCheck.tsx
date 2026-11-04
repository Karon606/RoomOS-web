'use client'

// 승인 대기 화면의 자동 재확인. 탭 복귀·30초마다·[승인 확인] 누름에 본인 상태를 다시 읽고, 승인되면 앱으로 넘어간다.
// 종전에는 '승인되면 다시 로그인해주세요' 뿐이라, 승인해도 화면이 그대로여서 승인이 안 된 줄 알았다(2026-11-04 운영자 승인 '추천대로').
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/components/ui/Btn'
import { checkMyAccess, type MyAccessStatus } from './actions'

export const PENDING_RECHECK_MS = 30_000

export default function PendingAutoCheck({ initial }: { initial: 'PENDING' | 'REJECTED' }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const last = useRef<MyAccessStatus>(initial)

  const check = useCallback(async (manual: boolean) => {
    if (manual) setBusy(true)
    try {
      const s = await checkMyAccess()
      if (s === 'APPROVED') { window.location.replace('/dashboard'); return }
      if (s === 'SIGNED_OUT') { window.location.replace('/login'); return }
      if (s !== last.current) { last.current = s; router.refresh() }
      if (manual) setNote(s === 'REJECTED' ? '승인되지 않은 계정입니다.' : '아직 승인 전입니다. 승인되면 이 화면이 저절로 넘어갑니다.')
    } catch {
      if (manual) setNote('상태를 확인하지 못했습니다. 잠시 후 다시 눌러 주세요.')
    } finally {
      if (manual) setBusy(false)
    }
  }, [router])

  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void check(false) }, PENDING_RECHECK_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void check(false) }
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [check])

  return (
    <div className="space-y-2">
      <Btn variant="secondary" size="md" fullWidth disabled={busy} onClick={() => { void check(true) }}>
        {busy ? '확인 중…' : '승인 확인'}
      </Btn>
      <p className="text-xs min-h-[1.25rem]" style={{ color: 'var(--warm-muted)' }} aria-live="polite">{note}</p>
    </div>
  )
}
