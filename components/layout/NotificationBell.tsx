'use client'

// 🔔 인앱 알림센터 — 헤더 우측. "오늘 챙길 일"(미납·당일 일정·재고·수령)을 모아 보여준다.
// 목록 소스는 getMyAlerts() → computeAlerts(). 항목 클릭 시 해당 상세로 딥링크 이동 + '읽음' 처리.
// 읽음 처리는 localStorage 에 날짜별로 저장(오늘 확인한 알림은 숨김, 다음 날 여전히 살아있으면 다시 노출).
//   ※ 종은 Header(EntityModalProvider 밖)에 있어 전역 모달을 못 쓰므로 URL 딥링크로 이동한다.

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
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

const READ_KEY = 'stayeum_alert_read'
const todayStr = () => {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}
function loadReadMap(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try { return JSON.parse(localStorage.getItem(READ_KEY) || '{}') } catch { return {} }
}
function saveReadMap(m: Record<string, string>) {
  try { localStorage.setItem(READ_KEY, JSON.stringify(m)) } catch { /* ignore */ }
}

// 알림 항목 → 상세 딥링크 URL.
// tenantId 있으면 /tenants 의 URL 핸들러가 Prism 셸을 자동으로 띄움(Phase 2.3c).
function hrefOf(a: AlertItem): string | null {
  if (a.tenantId) return `/tenants?tenantId=${a.tenantId}`
  return a.href ?? null
}

export default function NotificationBell({ currentPropertyId }: { currentPropertyId: string | null }) {
  const [open, setOpen]       = useState(false)
  const [items, setItems]     = useState<AlertItem[]>([])
  const [loading, setLoading] = useState(true)
  const [readMap, setReadMap] = useState<Record<string, string>>({})
  const ref     = useRef<HTMLDivElement>(null)
  const router  = useRouter()
  const pathname = usePathname()

  useEffect(() => { setReadMap(loadReadMap()) }, [])

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

  const today = todayStr()
  // 오늘 읽음 처리한 항목은 숨김 (다음 날 여전히 살아있으면 다시 노출)
  const visible = items.filter(a => readMap[a.id] !== today)
  const count = visible.length

  const markRead = (ids: string[]) => {
    setReadMap(prev => {
      const next = { ...prev }
      for (const id of ids) next[id] = today
      saveReadMap(next)
      return next
    })
  }

  const onItem = (a: AlertItem) => {
    setOpen(false)
    markRead([a.id])           // 클릭 = 확인 → 오늘 목록에서 제거
    const href = hrefOf(a)
    if (href) router.push(href)
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
            {count > 0 && (
              <button onClick={() => markRead(visible.map(a => a.id))}
                className="text-[0.6875rem] font-medium hover:underline" style={{ color: 'var(--warm-muted)' }}>
                모두 확인 ({count})
              </button>
            )}
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
              visible.map(a => (
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
