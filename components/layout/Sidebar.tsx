'use client'

import Link from 'next/link'
import { useState } from 'react'
import { StayQuoteModal } from '@/components/StayQuoteModal'
import { usePathname, useSearchParams } from 'next/navigation'
import { StayeumWordmark } from '@/components/brand/StayeumWordmark'
import { signOut } from '@/app/property-select/actions'
import { type AppUser } from '@/components/layout/Header'
import { useTheme } from '@/components/theme/ThemeProvider'
import type { Role } from '@/lib/role-types'
import { roleHome } from '@/lib/auth/routeScope'

// ── SVG Icons — Stayeum Design Guide v2 (Lucide style)
//   24×24 viewBox · stroke-width 1.6 · round caps/joins · currentColor
const ico = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, width: 20, height: 20, style: { flexShrink: 0 } }

// ── 아이콘 비주얼: Stayeum Icons v2 세트 (24×24·stroke 1.6·round·fill none). 라우트·라벨·매핑 불변.
// 대시보드
function IcoDashboard() {
  return <svg {...ico}><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg>
}
// 호실 관리 — 방
function IcoRooms() {
  return <svg {...ico}><path d="M5 21V5.5a1.5 1.5 0 0 1 1.5-1.5h11A1.5 1.5 0 0 1 19 5.5V21"/><path d="M3.5 21h17"/><circle cx="15.3" cy="12.5" r="1"/></svg>
}
// 고객 관리 — 사람
function IcoTenants() {
  return <svg {...ico}><circle cx="12" cy="8" r="3.5"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/></svg>
}
// 수납 관리 — 지갑+카드
function IcoFinance() {
  return <svg {...ico}><path d="M3.5 8.5A1.5 1.5 0 0 1 5 7h12.5a1 1 0 0 1 1 1V18a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18z"/><path d="M3.5 8.5V7a1.5 1.5 0 0 1 1.5-1.5h9.5"/><path d="M18.5 11.5h-2.2a1.6 1.6 0 0 0 0 3.2h2.2"/><path d="M9.5 4.2 13 7"/></svg>
}
// 지출/기타수익 — 돈의 출입(양방향 화살표)
function IcoWallet() {
  return <svg {...ico}><path d="M7 3.5 4 6.5l3 3"/><path d="M4 6.5h10.5A5.5 5.5 0 0 1 20 12"/><path d="M17 20.5l3-3-3-3"/><path d="M20 17.5H9.5A5.5 5.5 0 0 1 4 12"/></svg>
}
// 카드 정산 — CreditCard
function IcoCardSettle() {
  return <svg {...ico}><rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3 9.5h18"/><path d="M6.5 14.5h3"/></svg>
}
// 재고 관리 — 여러 상자
function IcoInventory() {
  return <svg {...ico}><rect x="3.5" y="9.5" width="8" height="7.5" rx="1.2"/><rect x="12.5" y="9.5" width="8" height="7.5" rx="1.2"/><rect x="8" y="3.5" width="8" height="6" rx="1.2"/></svg>
}
// 결산 보고서 — 문서+막대그래프
function IcoReport() {
  return <svg {...ico}><path d="M6 3.5h7.5L18 8v12a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 20V5a1.5 1.5 0 0 1 1-1.5z"/><path d="M13 3.5V8h5"/><path d="M8.5 17.5v-2.5"/><path d="M11.7 17.5v-4.5"/><path d="M14.9 17.5v-1.5"/></svg>
}
// 계약서 — 문서+서명선
function IcoContract() {
  return <svg {...ico}><path d="M6 3.5h7.5L18 8v12a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 20V5a1.5 1.5 0 0 1 1-1.5z"/><path d="M13 3.5V8h5"/><path d="M8.5 12.5h7"/><path d="M8.5 15.5c1.2-1 2-1 2.7 0s1.6 1 2.8 0"/></svg>
}
// 실거주 확인서 — 문서+체크
function IcoResidenceCert() {
  return <svg {...ico}><path d="M6 3.5h7.5L18 8v12a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 20V5a1.5 1.5 0 0 1 1-1.5z"/><path d="M13 3.5V8h5"/><path d="M8.3 14.7l1.8 1.8 3.4-3.6"/></svg>
}
// 입실료 납부확인서 — Receipt
function IcoReceipt() {
  return <svg {...ico}><path d="M6.5 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3z"/><path d="M9.5 8.5h5"/><path d="M9.5 12h5"/></svg>
}
// 체크리스트 — 목록+체크
function IcoChecklist() {
  return <svg {...ico}><path d="M9 5.5h9"/><path d="M9 12h9"/><path d="M9 18.5h9"/><path d="M4.6 5.2l1 1 1.8-2"/><path d="M4.6 11.7l1 1 1.8-2"/><path d="M4.6 18.2l1 1 1.8-2"/></svg>
}
// 시세 조사 — 돋보기+추세
function IcoMarket() {
  return <svg {...ico}><circle cx="10.5" cy="10.5" r="6.5"/><path d="M19.5 19.5l-4.4-4.4"/><path d="M7.8 12.2l1.9-2.3 1.6 1.3 2-2.5"/></svg>
}
// 방문 분석 — 막대그래프
function IcoAnalytics() {
  return <svg {...ico}><path d="M4 20.5h16"/><path d="M7 20.5v-6"/><path d="M12 20.5v-10"/><path d="M17 20.5v-4"/></svg>
}
// 요청·컴플레인 — 말풍선
function IcoRequests() {
  return <svg {...ico}><path d="M5 5.5h14A1.5 1.5 0 0 1 20.5 7v8A1.5 1.5 0 0 1 19 16.5H10l-4 3.5v-3.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5z"/><path d="M8.5 11h7"/></svg>
}
// 도면 — 평면도(접힌 지도)
function IcoFloorPlan() {
  return <svg {...ico}><path d="M3.5 6.2 9 4l6 2.2 5.5-2.2v13.8L15 20l-6-2.2L3.5 20z"/><path d="M9 4v13.8"/><path d="M15 6.2V20"/></svg>
}
// 환경설정 — Cog
function IcoSettings() {
  return <svg {...ico}><circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6"/></svg>
}

// ── Nav structure ──────────────────────────────────────────────────
const NAV_GROUPS = [
  {
    label: '메인',
    items: [
      { href: '/dashboard',   label: '홈',          Icon: IcoDashboard },
      { href: '/room-manage',  label: '호실 관리',   Icon: IcoRooms },
      { href: '/tenants',      label: '입주자 관리',   Icon: IcoTenants },
    ],
  },
  {
    label: '수익/지출',
    items: [
      { href: '/rooms',     label: '수납 관리',     Icon: IcoFinance   },  // Wallet
      { href: '/finance',   label: '지출 관리',     Icon: IcoWallet    },  // TrendingUp — 부가수익은 수납 관리로 이동(2026-07-02)
      { href: '/card-settlement', label: '카드 정산', Icon: IcoCardSettle }, // CreditCard
      { href: '/inventory', label: '재고 관리',     Icon: IcoInventory },  // Boxes
      { href: '/report',    label: '결산 보고서',   Icon: IcoReport    },  // FileText
    ],
  },
  {
    label: '운영',
    items: [
      { href: '/requests',  label: '요청·컴플레인', Icon: IcoRequests  },
    ],
  },
  {
    label: '관련 서류',
    items: [
      { href: '/contracts',       label: '계약서',        Icon: IcoContract      },
      { href: '/residence-certs', label: '실거주 확인서', Icon: IcoResidenceCert },
      { href: '/rent-receipts',   label: '입실료 납부 확인서', Icon: IcoReceipt    },
    ],
  },
  {
    label: '시장분석',
    items: [
      { href: '/market-analysis', label: '시세 조사', Icon: IcoMarket },
      { href: '/marketing',       label: '방문 분석',    Icon: IcoAnalytics },
    ],
  },
  {
    label: '스테이음 Lab',
    items: [
      { href: '/floor-plan', label: '도면', Icon: IcoFloorPlan },
      { href: '/checklist', label: '체크리스트', Icon: IcoChecklist },
    ],
  },
  {
    label: '설정',
    items: [
      { href: '/settings', label: '환경설정', Icon: IcoSettings },
    ],
  },
]

// 제한 스태프 전용 내비 — 재고 쓰기 + 입주자·호실 조회 + 요청. 그 외 전부 은닉(65992b0a).
const LIMITED_STAFF_NAV_GROUPS = [
  {
    label: '업무',
    items: [
      { href: '/inventory',   label: '재고 관리',   Icon: IcoInventory },
      { href: '/room-manage', label: '호실 관리',   Icon: IcoRooms },
      { href: '/tenants',     label: '입주자 관리', Icon: IcoTenants },
    ],
  },
  {
    label: '운영',
    items: [
      { href: '/requests', label: '요청·컴플레인', Icon: IcoRequests },
    ],
  },
]

function navGroupsFor(role: Role) {
  return role === 'LIMITED_STAFF' ? LIMITED_STAFF_NAV_GROUPS : NAV_GROUPS
}

// ── Logo variants ──────────────────────────────────────────────────
// 가이드 § 01 WORDMARK: 통합 워드마크 (마크+텍스트 일체) 사용
function LogoFull() {
  return <StayeumWordmark height={22} />
}

// 가이드 § 02 SYMBOL MARK: 선 마크만 (아이콘 크기 컨텍스트)
function LogoMark() {
  return <StayeumWordmark height={30} markOnly />
}

// ── NavContent ─────────────────────────────────────────────────────
function NavContent({
  variant,
  pathname,
  month,
  user,
  isSuperAdmin,
  role,
  onClose,
}: {
  variant: 'sidebar' | 'drawer'
  pathname: string
  month: string | null
  user: AppUser
  isSuperAdmin?: boolean
  role: Role
  onClose?: () => void
}) {
  const drawer = variant === 'drawer'
  const navGroups = navGroupsFor(role)
  const homeHref = roleHome(role)   // 로고 클릭 목적지 — 제한 스태프는 /inventory
  // 계정 행(영업장 관리·로그아웃)도 nav 링크와 동일한 반응형 패턴
  const acctRow = drawer
    ? 'flex items-center gap-2.5 px-5 py-3 min-h-[44px] w-full text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--persimmon)]/30 focus-visible:ring-inset'
    : 'flex items-center gap-0 py-3 justify-center min-h-[44px] w-full text-left transition-colors lg:gap-2.5 lg:px-5 lg:justify-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--persimmon)]/30 focus-visible:ring-inset'
  const acctLabel = `text-[0.8125rem] ${drawer ? 'block' : 'hidden lg:block'}`

  return (
    <>
      {/* Logo — 클릭 시 홈(대시보드)으로 (월 컨텍스트 유지) */}
      <div
        className="flex items-center shrink-0"
        style={{
          minHeight: 56,
          padding: drawer ? '0 20px' : undefined,
          borderBottom: '1px solid var(--warm-border)',
        }}
      >
        <Link
          href={month ? `${homeHref}?month=${month}` : homeHref}
          onClick={onClose}
          aria-label="홈으로"
          className="flex items-center w-full rounded-lg transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--persimmon)]/30 focus-visible:ring-inset"
        >
          {drawer ? (
            <LogoFull />
          ) : (
            <>
              <div className="hidden lg:flex px-5"><LogoFull /></div>
              <div className="flex lg:hidden w-full justify-center"><LogoMark /></div>
            </>
          )}
        </Link>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto py-1">
        {navGroups.map(group => (
          <div key={group.label}>
            {/* Group label — HIG 최소 11pt */}
            <div
              className={drawer ? 'block' : 'hidden lg:block'}
              style={{
                padding: '12px 20px 4px',
                fontSize: '0.6875rem',
                fontWeight: 600,
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
                color: 'var(--warm-muted)',
              }}
            >
              {group.label}
            </div>

            {group.items.map(({ href, label, Icon }) => {
              const isActive = pathname === href
              const linkHref = month ? `${href}?month=${month}` : href
              return (
                <Link
                  key={href}
                  href={linkHref}
                  onClick={onClose}
                  /* HIG: 최소 44pt 터치 타겟 — py-3.5로 달성 (14×2 + 아이콘17 = 45px) */
                  className={[
                    'flex items-center transition-colors duration-[var(--dur-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--persimmon)]/30 focus-visible:ring-inset min-h-[44px]',
                    drawer
                      ? 'gap-2.5 px-5 py-3.5 border-l-[2.5px]'
                      : 'gap-0 py-3.5 justify-center border-l-0 lg:gap-2.5 lg:px-5 lg:justify-start lg:border-l-[2.5px]',
                  ].join(' ')}
                  style={isActive ? {
                    color: 'var(--coral)',
                    fontWeight: 500,
                    background: 'color-mix(in srgb, var(--coral) 7%, transparent)',
                    borderLeftColor: 'var(--coral)',
                  } : {
                    color: 'var(--warm-muted)',
                    borderLeftColor: 'transparent',
                  }}
                >
                  <Icon />
                  <span className={`text-[0.8125rem] ${drawer ? 'block' : 'hidden lg:block'}`}>
                    {label}
                  </span>
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* ── 계정 (하단 고정) — 헤더에서 이동: 프로필·영업장 관리·로그아웃 ── */}
      <div className="shrink-0" style={{ borderTop: '1px solid var(--warm-border)' }}>
        {/* 프로필 표시 */}
        <div className={drawer ? 'flex items-center gap-2.5 px-5 py-3' : 'flex items-center gap-0 py-3 justify-center lg:gap-2.5 lg:px-5 lg:justify-start'}>
          {user.user_metadata?.avatar_url ? (
            <img src={user.user_metadata.avatar_url} alt="" className="w-7 h-7 rounded-full shrink-0" />
          ) : (
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold text-[var(--on-solid)] shrink-0"
                 style={{ background: 'var(--coral)' }}>
              {user.email?.[0]?.toUpperCase()}
            </div>
          )}
          <span className={`${acctLabel} truncate`} style={{ color: 'var(--warm-mid)' }}>
            {user.user_metadata?.full_name ?? user.email}
          </span>
        </div>

        {/* 운영자(슈퍼관리자) 전용 */}
        {isSuperAdmin && (
          <Link href="/admin" onClick={onClose} className={acctRow} style={{ color: 'var(--persimmon)' }}>
            <svg {...ico}><path d="M12 2 4 6v6c0 5 3.4 7.7 8 10 4.6-2.3 8-5 8-10V6l-8-4Z"/></svg>
            <span className={acctLabel}>운영자</span>
          </Link>
        )}

        {/* 영업장 관리 */}
        <Link href="/property-select" onClick={onClose} className={acctRow} style={{ color: 'var(--warm-muted)' }}>
          <svg {...ico}><path d="M3 21h18M6 21V7l6-4 6 4v14M10 9h.01M10 13h.01M10 17h.01M14 9h.01M14 13h.01M14 17h.01"/></svg>
          <span className={acctLabel}>영업장 관리</span>
        </Link>

        {/* 로그아웃 */}
        <form action={signOut}>
          <button type="submit" className={acctRow} style={{ color: 'var(--danger-fg)' }}>
            <svg {...ico}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
            <span className={acctLabel}>로그아웃</span>
          </button>
        </form>
      </div>
    </>
  )
}

// ── Sidebar ────────────────────────────────────────────────────────
export default function Sidebar({
  user,
  isSuperAdmin = false,
  role = 'OWNER',
  isOpen = false,
  onClose,
}: {
  user: AppUser
  isSuperAdmin?: boolean
  role?: Role
  isOpen?: boolean
  onClose?: () => void
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const month = searchParams.get('month')

  const style = {
    background: 'var(--cream)',
    borderRight: '1px solid var(--warm-border)',
  }

  return (
    <>
      {/* ── 태블릿(md) + 데스크탑(lg): in-flow 사이드바 ── */}
      <aside
        data-peek-hide
        className="hidden md:flex md:w-16 lg:w-[220px] flex-col shrink-0"
        style={style}
      >
        <NavContent variant="sidebar" pathname={pathname} month={month} user={user} isSuperAdmin={isSuperAdmin} role={role} />
      </aside>

      {/* ── 모바일: 전체화면 메뉴 (배경 페이지가 의미 없으므로 풀스크린 + 그리드로 한 화면에) ── */}
      {isOpen && (
        <MobileMenu pathname={pathname} month={month} user={user} isSuperAdmin={isSuperAdmin} role={role} onClose={onClose} />
      )}
    </>
  )
}

// ── 모바일 전체화면 메뉴 — 모든 메뉴를 스크롤 없이 한 화면에 (그리드 타일) ──
function MobileMenu({
  pathname, month, user, isSuperAdmin, role, onClose,
}: {
  pathname: string; month: string | null; user: AppUser; isSuperAdmin?: boolean; role: Role; onClose?: () => void
}) {
  const [quoteOpen, setQuoteOpen] = useState(false)   // 요금 계산(도구 타일)
  const { isDark, setMode } = useTheme()              // 다크/라이트 빠른 전환(도구 타일)
  const navGroups = navGroupsFor(role)
  const homeHref = roleHome(role)                     // 로고 목적지 — 제한 스태프는 /inventory
  const isLimited = role === 'LIMITED_STAFF'          // 도구(단기 요금 계산 등) 숨김
  return (
    <div className="fixed inset-0 z-[var(--z-drawer)] flex flex-col md:hidden safe-b" style={{ background: 'var(--cream)' }}>
      {/* 헤더: 로고 + 닫기 */}
      <div className="flex items-center justify-between shrink-0 px-5" style={{ minHeight: 56, borderBottom: '1px solid var(--warm-border)' }}>
        <Link href={month ? `${homeHref}?month=${month}` : homeHref} onClick={onClose} aria-label="홈으로"
          className="rounded-lg transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--persimmon)]/30 focus-visible:ring-inset">
          <LogoFull />
        </Link>
        <button onClick={onClose} aria-label="닫기"
          className="w-11 h-11 -mr-2 flex items-center justify-center rounded-lg transition-colors hover:bg-[var(--canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--persimmon)]/30 focus-visible:ring-inset"
          style={{ color: 'var(--warm-mid)' }}>
          <svg {...ico} width={22} height={22}><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>

      {/* 메뉴 그리드 — 그룹별 라벨 + 3열 타일. 한 화면에 다 들어오게 컴팩트하게. */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {navGroups.map(group => (
          <div key={group.label} className="mb-1.5">
            <div className="px-1.5 pt-2 pb-1 text-[0.65625rem] font-semibold uppercase tracking-wide" style={{ color: 'var(--warm-muted)' }}>
              {group.label}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {group.items.map(({ href, label, Icon }) => {
                const isActive = pathname === href
                const linkHref = month ? `${href}?month=${month}` : href
                return (
                  <Link key={href} href={linkHref} onClick={onClose}
                    className="flex flex-col items-center justify-center gap-1.5 rounded-xl py-3 px-1 text-center transition-colors min-h-[64px]"
                    style={isActive
                      ? { background: 'color-mix(in srgb, var(--coral) 8%, transparent)', color: 'var(--coral)', border: '1px solid color-mix(in srgb, var(--coral) 30%, transparent)' }
                      : { background: 'var(--canvas)', color: 'var(--warm-mid)', border: '1px solid var(--warm-border)' }}>
                    <Icon />
                    <span className="text-[0.6875rem] font-medium leading-tight">{label}</span>
                  </Link>
                )
              })}
            </div>
          </div>
        ))}

        {/* 도구 — 페이지 이동 없는 즉시 도구(요금 계산·테마). 단기 요금 계산은 제한 스태프에게 무의미하므로 숨김 */}
        <div className="mb-1.5">
          <div className="px-1.5 pt-2 pb-1 text-[0.65625rem] font-semibold uppercase tracking-wide" style={{ color: 'var(--warm-muted)' }}>
            도구
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {!isLimited && (
            <button type="button" onClick={() => setQuoteOpen(true)}
              className="flex flex-col items-center justify-center gap-1.5 rounded-xl py-3 px-1 text-center transition-colors min-h-[64px]"
              style={{ background: 'var(--canvas)', color: 'var(--warm-mid)', border: '1px solid var(--warm-border)' }}>
              <svg {...ico} width={19} height={19}><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8.5 7.5h7"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 15.5h.01M12 15.5h.01M15.5 15.5h.01"/></svg>
              <span className="text-[0.6875rem] font-medium leading-tight">단기 요금 계산</span>
            </button>
            )}
            {/* 다크/라이트 즉시 전환 — 명시적 light/dark 만 순환(system·time 사용자 설정 덮어쓰지 않음) */}
            <button type="button" onClick={() => setMode(isDark ? 'light' : 'dark')}
              className="flex flex-col items-center justify-center gap-1.5 rounded-xl py-3 px-1 text-center transition-colors min-h-[64px]"
              style={{ background: 'var(--canvas)', color: 'var(--warm-mid)', border: '1px solid var(--warm-border)' }}>
              {isDark ? (
                <svg {...ico} width={19} height={19}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
              ) : (
                <svg {...ico} width={19} height={19}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
              )}
              <span className="text-[0.6875rem] font-medium leading-tight">{isDark ? '라이트 모드' : '다크 모드'}</span>
            </button>
          </div>
        </div>
      </div>
      <StayQuoteModal open={quoteOpen} onClose={() => setQuoteOpen(false)} />

      {/* 계정 (하단 고정) */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2" style={{ borderTop: '1px solid var(--warm-border)' }}>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {user.user_metadata?.avatar_url ? (
            <img src={user.user_metadata.avatar_url} alt="" className="w-7 h-7 rounded-full shrink-0" />
          ) : (
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold text-[var(--on-solid)] shrink-0" style={{ background: 'var(--coral)' }}>
              {user.email?.[0]?.toUpperCase()}
            </div>
          )}
          <span className="text-xs truncate" style={{ color: 'var(--warm-mid)' }}>{user.user_metadata?.full_name ?? user.email}</span>
        </div>
        {isSuperAdmin && (
          <Link href="/admin" onClick={onClose}
            className="flex items-center gap-1 px-2.5 py-2 rounded-lg text-xs transition-colors hover:bg-[var(--canvas)]" style={{ color: 'var(--persimmon)' }}>
            <svg {...ico} width={16} height={16}><path d="M12 2 4 6v6c0 5 3.4 7.7 8 10 4.6-2.3 8-5 8-10V6l-8-4Z"/></svg>
            운영자
          </Link>
        )}
        <Link href="/property-select" onClick={onClose}
          className="flex items-center gap-1 px-2.5 py-2 rounded-lg text-xs transition-colors hover:bg-[var(--canvas)]" style={{ color: 'var(--warm-muted)' }}>
          <svg {...ico} width={16} height={16}><path d="M3 21h18M6 21V7l6-4 6 4v14"/></svg>
          영업장
        </Link>
        <form action={signOut}>
          <button type="submit" className="flex items-center gap-1 px-2.5 py-2 rounded-lg text-xs transition-colors hover:bg-[var(--canvas)]" style={{ color: 'var(--danger-fg)' }}>
            <svg {...ico} width={16} height={16}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
            로그아웃
          </button>
        </form>
      </div>
      {/* 하단 전폭 닫기 — 모바일 엄지 동선. '전체' 탭을 눌렀던 자리를 다시 눌러도 안전하게 닫힘(로그아웃 오탭 방지) */}
      <button type="button" onClick={onClose}
        className="mt-1 w-full safe-b rounded-t-xl border-t border-[var(--warm-border)] py-3 text-sm font-semibold text-[var(--warm-mid)] transition-colors hover:bg-[var(--canvas)] active:bg-[var(--canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--persimmon)]/30 focus-visible:ring-inset">
        메뉴 닫기
      </button>
    </div>
  )
}
