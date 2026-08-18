'use client'

// 인앱 알림센터 — 헤더 우측. "오늘 챙길 일"(미납·당일 일정·재고·수령)을 모아 보여준다.
// 목록 소스는 getMyAlerts() → computeAlerts(). 항목 클릭 시 해당 상세로 딥링크 이동 + '읽음' 처리.
// 읽음 처리는 localStorage 에 날짜별로 저장(오늘 확인한 알림은 숨김, 다음 날 여전히 살아있으면 다시 노출).
//   ※ 종은 Header(EntityModalProvider 밖)라 useEntityModal 을 못 쓴다. 고객이 목적지인 알림은
//     openEntityModal 열기 신호로 제자리에서 셸을 열고, 그 밖은 URL 딥링크로 이동한다.

import { useState, useEffect, useRef, useCallback } from 'react'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { openEntityModal } from '@/components/entity-modal/EntityModal'
import { useRouter, usePathname } from 'next/navigation'
import { getMyAlerts } from '@/app/(app)/dashboard/alertActions'
import type { AlertItem, AlertCategory } from '@/app/(app)/dashboard/alerts'
import { useNavRouter } from '@/lib/useNavRouter'
import { kstYmdStr } from '@/lib/kstDate'

// 카테고리별 점 색 (대시보드 알림 톤과 맞춤)
const DOT: Record<AlertCategory, string> = {
  unpaid:   'var(--tc)',
  contact:  'var(--coral)',
  checkout: 'var(--viz-4)',
  movein:   'var(--success)',
  tour:     'var(--viz-2)',
  lowstock: 'var(--viz-4)',
  receipt:  'var(--ink-m)',
  signed:   'var(--success)',
  // 고정지출 출금·납부 — 홈 AlertsStrip 의 'recurring' 점과 같은 색(var(--info-fg))이라
  // 두 화면에서 같은 종류의 알림이 같은 색으로 보인다.
  autodebit: 'var(--info-fg)',
  manualpay: 'var(--info-fg)',
}

const READ_KEY = 'stayeum_alert_read'
// 읽음 맵의 날짜 키 — KST 정본. 기기 로컬로 만들면 해외 기기·SSR(UTC)에서 하루가 어긋난다.
const todayStr = () => kstYmdStr()
function loadReadMap(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try { return JSON.parse(localStorage.getItem(READ_KEY) || '{}') } catch { return {} }
}
function saveReadMap(m: Record<string, string>) {
  try { localStorage.setItem(READ_KEY, JSON.stringify(m)) } catch { /* ignore */ }
}

// 알림 항목 → 상세 딥링크 URL.
// tenantId 있으면 /tenants 의 URL 핸들러가 Prism 셸을 자동으로 띄움(Phase 2.3c).
//
// HREF_FIRST — tenantId 보다 href 를 먼저 보는 카테고리(예외 목록).
// signed(원격 서명 완료)의 할 일은 '계약서 발급'인데 고객 모달에는 발급 대기 목록이 없다. tenantId 우선
// 규칙 그대로면 8/8 에 만든 계약서함 발급 대기 섹션에 종에서는 영영 못 닿는다. 반대로 순서를 전면
// 뒤집으면 나머지 7종에 href 가 생기는 순간 전부 목적지가 바뀌므로, 카테고리 예외로만 연다.
const HREF_FIRST: ReadonlySet<AlertCategory> = new Set<AlertCategory>(['signed'])
// 목적지가 고객 상세인 알림 — 제자리 오픈과 딥링크가 같은 판정을 쓰도록 여기 하나로 둔다.
const tenantTargetOf = (a: AlertItem): string | null =>
  (a.href && HREF_FIRST.has(a.category)) ? null : (a.tenantId ?? null)
function hrefOf(a: AlertItem): string | null {
  const tenantId = tenantTargetOf(a)
  if (tenantId) return `/tenants?tenantId=${tenantId}`
  return a.href ?? null
}

export default function NotificationBell({ currentPropertyId }: { currentPropertyId: string | null }) {
  const [open, setOpen]       = useState(false)
  const [items, setItems]     = useState<AlertItem[]>([])
  const [loading, setLoading] = useState(false)
  const [readMap, setReadMap] = useState<Record<string, string>>({})
  const ref     = useRef<HTMLDivElement>(null)
  const router  = useNavRouter()   // 이동에 진행바 동반(F페이즈)
  const pathname = usePathname()

  useEffect(() => { setReadMap(loadReadMap()) }, [])

  // skeleton=true 일 때만 로딩 표시 — 백그라운드 새로고침은 뱃지 숫자를 흔들지 않는다.
  const load = useCallback(async (skeleton: boolean) => {
    if (skeleton) setLoading(true)
    try { setItems(await getMyAlerts()) }
    catch { /* 무음 — 알림은 보조 정보 */ }
    finally { if (skeleton) setLoading(false) }
  }, [])

  // 마운트·영업장 전환 시에만 조용히 새로고침 (페이지 이동마다 재조회하던 뱃지 깜빡임 제거)
  useEffect(() => { load(false) }, [load, currentPropertyId])

  // 종을 열 때 최신화 — 목록이 이미 있으면 스켈레톤 없이 조용히 교체
  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next) load(items.length === 0)
  }

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
    // 고객이 목적지인 알림은 /tenants 를 거치지 않고 이 자리에서 셸을 연다.
    // 경유하면 셸이 뜨기 전에 입주자 목록 전체를 서버에서 다시 그려 받아야 한다(제기역점 실측
    // getTenants 1,430KB · gzip 811KB, DB 130ms). 셸에 필요한 것은 tenantId 하나이고 셸이 스스로
    // 조회한다(1.3KB). 전역 검색도 같은 착지를 쓴다(GlobalSearchHost onPick).
    // 신호가 닿지 않으면(Provider 미마운트) 아래 딥링크로 그대로 흘러간다 — 무반응은 만들지 않는다.
    const tenantId = tenantTargetOf(a)
    if (tenantId && openEntityModal({ kind: 'tenant', tenantId })) return
    const href = hrefOf(a)
    if (href) {
      router.push(href)
      // 이미 같은 페이지에 있으면 push 가 화면 변화를 못 만들고 알림만 읽음 처리되던 문제(e289e69) —
      // 같은 경로일 때만 refresh 로 반응을 보장한다.
      // ⚠️ 다른 페이지로 갈 때 refresh 를 같이 부르면 refresh(현재 경로 갱신)가 push 내비게이션과
      //    경합해 이동 자체가 취소됨 — "알림만 사라지고 안 넘어감" 회귀의 원인이라 경로 비교로 분기.
      if (href.split('?')[0] === pathname) router.refresh()
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggle}
        className="w-11 h-11 flex items-center justify-center rounded-lg transition-colors hover:bg-[var(--canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--persimmon)]/30 focus-visible:ring-inset relative"
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
            className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full text-[0.65625rem] font-bold leading-none"
            style={{ background: 'var(--coral)', color: 'var(--on-solid)' }}
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 w-80 max-w-[90vw] rounded-xl shadow-lift z-[var(--z-dropdown)] overflow-hidden"
             style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <div className="px-3.5 py-2.5" style={{ borderBottom: '1px solid var(--warm-border)' }}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold" style={{ color: 'var(--warm-dark)' }}>오늘 챙길 일</span>
              {count > 0 && (
                <button onClick={() => markRead(visible.map(a => a.id))}
                  className="text-[0.6875rem] font-medium hover:underline shrink-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--persimmon)]/30" style={{ color: 'var(--warm-muted)' }}>
                  모두 확인 ({count})
                </button>
              )}
            </div>
            <p className="mt-0.5 text-[0.625rem] leading-snug" style={{ color: 'var(--warm-muted)' }}>
              푸시와 같은 핵심 알림만 표시돼요. 전체 일정과 소식은 홈 화면 알림에서 볼 수 있어요.
            </p>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {loading ? (
              <div className="px-3.5 py-3"><SkeletonRows rows={3} /></div>
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
                  className="w-full flex items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors min-h-[44px] hover:bg-[var(--canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--persimmon)]/30 focus-visible:ring-inset"
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
            className="w-full flex items-center justify-center gap-1.5 px-3.5 py-2.5 text-sm font-medium transition-colors min-h-[44px] hover:bg-[var(--canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--persimmon)]/30 focus-visible:ring-inset"
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
