'use client'

import { selectProperty } from '@/app/property-select/actions'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { pushToast } from '@/lib/saveStatus'
import NotificationBell from '@/components/layout/NotificationBell'

// 레이아웃이 getClaims()로 넘기는 최소 사용자 정보 (Header에서 쓰는 필드만)
export type AppUser = {
  email?: string
  user_metadata?: { avatar_url?: string; full_name?: string }
}
// 영업장 스위처용 — id·name·앱로고(원형)
export type SwitchProperty = { id: string; name: string; appLogoUrl?: string | null }

export default function Header({
  properties,
  currentPropertyId,
  startNavigation,
}: {
  properties: SwitchProperty[]
  currentPropertyId: string | null
  startNavigation?: (fn: () => void) => void
}) {
  const [propOpen, setPropOpen] = useState(false)  // 영업장 스위처
  const router   = useRouter()
  const propRef  = useRef<HTMLDivElement>(null)

  const currentProperty = properties.find(p => p.id === currentPropertyId) ?? properties[0]

  // 영업장 스위처 바깥 클릭 시 닫기 (종은 NotificationBell 가 자체 처리)
  // (월 네비는 MonthSelector(페이지 콘텐츠 상단)로 분리됨 — 헤더는 스위처·종만)
  useEffect(() => {
    if (!propOpen) return
    const handle = (e: MouseEvent) => {
      const t = e.target as Node
      if (propRef.current && !propRef.current.contains(t)) setPropOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [propOpen])

  // 영업장 전환 — 권한은 selectProperty가 재확인. 전환 후 대시보드로(타 영업장 딥링크 깨짐 방지).
  const onSelectProperty = (id: string) => {
    setPropOpen(false)
    if (id === currentPropertyId) return
    const run = async () => {
      const res = await selectProperty(id)
      if (res.ok) { router.push('/dashboard'); router.refresh() }
      else pushToast('error', res.error)
    }
    if (startNavigation) startNavigation(run)
    else run()
  }

  return (
    /* relative z-[var(--z-sticky)]: 헤더가 사이드바(z-50)보다 항상 위 → 드롭다운 겹침 방지 */
    <header
      data-peek-hide
      className="h-14 md:h-16 flex items-center justify-between gap-2 px-3 md:px-6 shrink-0 relative z-[100]"
      style={{ background: 'var(--cream)', borderBottom: '1px solid var(--warm-border)' }}
    >
      {/* ── 좌: 영업장 스위처 ── (월 네비는 각 페이지 상단 MonthSelector로 이동) */}
      <div className="flex items-center gap-1 min-w-0">
        <div ref={propRef} className="relative min-w-0">
          <button
            onClick={() => setPropOpen(v => !v)}
            className="flex items-center gap-1.5 max-w-[60vw] md:max-w-none px-2 py-2 rounded-xl transition-colors hover:bg-[var(--canvas)]"
            aria-label="영업장 선택"
            aria-expanded={propOpen}
          >
            {currentProperty?.appLogoUrl && (
              <img src={currentProperty.appLogoUrl} alt=""
                className="w-7 h-7 rounded-full object-cover shrink-0"
                style={{ border: '1px solid var(--warm-border)' }} />
            )}
            <span className="text-sm font-bold truncate" style={{ color: 'var(--warm-dark)' }}>
              {currentProperty?.name ?? '영업장 선택'}
            </span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--warm-muted)', flexShrink: 0 }}>
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>

          {propOpen && (
            <div className="absolute left-0 top-12 w-60 rounded-xl shadow-lift z-[var(--z-dropdown)] overflow-hidden"
                 style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
              <div className="px-3 pt-2.5 pb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide"
                   style={{ color: 'var(--warm-muted)' }}>
                영업장
              </div>
              <div className="max-h-[50vh] overflow-y-auto p-1">
                {properties.map(p => {
                  const active = p.id === (currentProperty?.id ?? '')
                  return (
                    <button key={p.id} type="button" onClick={() => onSelectProperty(p.id)}
                      className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-left transition-colors min-h-[44px] hover:bg-[var(--canvas)]"
                      style={{ color: 'var(--warm-dark)', background: active ? 'color-mix(in srgb, var(--coral) 6%, transparent)' : undefined }}>
                      {p.appLogoUrl && (
                        <img src={p.appLogoUrl} alt="" className="w-5 h-5 rounded-full object-cover shrink-0"
                          style={{ border: '1px solid var(--warm-border)' }} />
                      )}
                      <span className="flex-1 truncate" style={{ fontWeight: active ? 600 : 400, color: active ? 'var(--coral)' : 'var(--warm-dark)' }}>
                        {p.name}
                      </span>
                      {active && (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--coral)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7"/></svg>
                      )}
                    </button>
                  )
                })}
              </div>
              <Link href="/property-select" onClick={() => setPropOpen(false)}
                className="flex items-center gap-2 px-3 py-2.5 text-sm transition-colors min-h-[44px] hover:bg-[var(--canvas)]"
                style={{ color: 'var(--warm-mid)', borderTop: '1px solid var(--warm-border)' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                영업장 관리·추가
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* ── 우: 알림 ── (프로필/계정은 전체 메뉴로 이동) */}
      <div className="flex items-center gap-0.5 shrink-0">
        <NotificationBell currentPropertyId={currentPropertyId} />
      </div>
    </header>
  )
}
