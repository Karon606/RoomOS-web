'use client'

// 새 배포 감지 — 배포 후 이전 빌드로 페이지를 이동하면 클라이언트 조각이 서버와 안 맞아
// 전체 새로고침(초기 스플래시)으로 폴백된다(운영자 신고 2026-07-09: "간헐적으로 스켈레톤 대신 초기 화면").
// 탭 복귀·주기 체크로 새 버전을 미리 감지해 토스트로 알리고, 원할 때 새로고침하게 한다.
// 입력 중일 수 있으므로 자동 새로고침은 하지 않는다(§13.2 입력 유실 방지).

import { useEffect, useRef } from 'react'
import { pushToast } from '@/lib/saveStatus'

const CHECK_MS = 10 * 60 * 1000   // 보이는 동안 10분마다
const NOTICE_GAP_MS = 30 * 60 * 1000   // 같은 안내 반복 최소 간격

export default function NewVersionNotice() {
  const baseline = useRef<string | null>(null)
  const lastNotice = useRef(0)

  useEffect(() => {
    let alive = true
    const fetchId = async (): Promise<string | null> => {
      try {
        const r = await fetch('/api/build', { cache: 'no-store' })
        if (!r.ok) return null
        const j = (await r.json()) as { id?: string }
        return j.id ?? null
      } catch { return null }
    }
    const check = async () => {
      const id = await fetchId()
      if (!alive || !id || id === 'dev') return
      if (!baseline.current) { baseline.current = id; return }
      if (id === baseline.current) return
      const now = Date.now()
      if (now - lastNotice.current < NOTICE_GAP_MS) return
      lastNotice.current = now
      pushToast('info', '앱이 새 버전으로 업데이트됐어요', {
        detail: '새로고침하면 이어서 빠르게 열립니다. 입력 중이면 저장 후 눌러주세요.',
        duration: 12000,
        action: { label: '새로고침', run: () => window.location.reload() },
      })
    }
    void check()   // 최초 기준값 확보
    const iv = setInterval(() => { if (!document.hidden) void check() }, CHECK_MS)
    const onVisible = () => { if (!document.hidden) void check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { alive = false; clearInterval(iv); document.removeEventListener('visibilitychange', onVisible) }
  }, [])
  return null
}
