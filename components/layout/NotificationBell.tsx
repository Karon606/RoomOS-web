'use client'

// 🔔 인앱 알림센터 — 헤더 우측. "오늘 챙길 일"(미납·당일 일정·재고·수령)을 모아 보여준다.
// 목록 소스는 getMyAlerts() → computeAlerts() 로, 푸시 cron 과 동일 → 뱃지 숫자가 홈화면 앱 뱃지와 일치.
// 항목 클릭: 입주자 관련은 전역 EntityModal(고객 뷰) 제자리, 재고·수령은 해당 페이지로 이동.

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useEntityModal } from '@/components/entity-modal/EntityModal'
import { getMyAlerts } from '@/app/(app)/dashboard/alertActions'
import type { AlertItem, AlertCategory } from '@/app/(app)/dashboard/alerts'

// 카테고리별 점 색 (대시보드 알림 톤과 맞춤)
const DOT: Record<AlertCategory, string> = {
  unpaid:   '#dc2626',
  checkout: '#f59e0b',
  movein:   '#16a34a',
  tour:     '#6366f1',
  lowstock: '#f59e0b',
  receipt:  '#9ca3af',
}

export default function NotificationBell({ currentPropertyId }: { currentPropertyId: string | null }) {
  const [open, setOpen]       = useState(false)
  const [items, setItems]     = useState<AlertItem[]>([])
  const [loading, setLoading] = useState(true)
  const ref     = useRef<HTMLDivElement>(null)
  const router  = useRouter()
  const pathname = usePathname()
  const entityModal = useEntityModal()

  const load = useCallback(async () => {
    setLoading(true)
    try { setItems(await getMyAlerts()) }
    catch { /* 무음 — 알림은 보조 정보 */ }
    finally { setLoading(false) }
  }, [])

  // 마운트·영업장 전환·페이지 이동 시 새로고침 (작업 후 즉시 반영)
  useEffect(() => { load() }, [load, currentPropertyId, pathname])

  // 바깥 클릭 닫기
  useEffect(() => {
    if (!open) return
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  const count = items.length

  const onItem = (a: AlertItem) => {
    setOpen(false)
    if (a.tenantId) entityModal.open({ kind: 'tenant', tenantId: a.tenantId })
    else if (a.href) router.push(a.href)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-11 h-11 flex items-center justify-center rounded-xl transition-colors hover:bg-[var(--canvas)] relative"
        style={{ color: 'var(--warm-mid)' }}
        aria-label={count > 0 ? `알림 ${count}건` : '알림'}
        aria-expanded={open}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        {count > 0 && (
          <span
            className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full text-[0.625rem] font-bold leading-none"
            style={{ background: 'var(--coral)', color: '#fff' }}
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 w-80 max-w-[90vw] rounded-xl shadow-lift z-50 overflow-hidden"
             style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <div className="px-3.5 py-2.5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--warm-border)' }}>
            <span className="text-sm font-semibold" style={{ color: 'var(--warm-dark)' }}>오늘 챙길 일</span>
            {count > 0 && <span className="text-xs font-medium" style={{ color: 'var(--coral)' }}>{count}건</span>}
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {loading ? (
              <div className="px-3.5 py-6 text-center text-xs" style={{ color: 'var(--warm-muted)' }}>불러오는 중…</div>
            ) : count === 0 ? (
              <div className="px-3.5 py-7 text-center">
                <p className="text-xs leading-relaxed" style={{ color: 'var(--warm-muted)' }}>
                  오늘 챙길 일이 없어요.<br />미납·퇴실·투어·재고 알림이 여기 모여요.
                </p>
              </div>
            ) : (
              items.map(a => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onItem(a)}
                  className="w-full flex items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors min-h-[44px] hover:bg-[var(--canvas)]"
                  style={{ borderBottom: '1px solid var(--warm-border)' }}
                >
                  <span className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{ background: DOT[a.category] }} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium truncate" style={{ color: 'var(--warm-dark)' }}>{a.title}</span>
                    <span className="block text-xs truncate" style={{ color: 'var(--warm-muted)' }}>{a.subtitle}</span>
                  </span>
                  <svg className="mt-1 shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--warm-border)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6"/></svg>
                </button>
              ))
            )}
          </div>

          <button
            onClick={() => { setOpen(false); router.push('/dashboard') }}
            className="w-full flex items-center justify-center gap-1.5 px-3.5 py-2.5 text-sm font-medium transition-colors min-h-[44px] hover:bg-[var(--canvas)]"
            style={{ color: 'var(--coral)', borderTop: '1px solid var(--warm-border)' }}
          >
            대시보드에서 보기
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
          </button>
        </div>
      )}
    </div>
  )
}
