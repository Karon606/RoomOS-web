'use client'

import Link from 'next/link'
import { useState } from 'react'

// ── 타입 ────────────────────────────────────────────────────────

export type DashboardData = {
  totalRevenue:      number
  paidRevenue:       number
  totalExpense:      number
  netProfit:         number
  totalDeposit:      number
  paidCount:         number
  unpaidCount:       number
  unpaidAmount:      number
  categoryBreakdown: { category: string; amount: number; percent: number }[]
  trend:             { month: string; revenue: number; expense: number; profit: number }[]
  totalRooms:        number
  vacantRooms:       number
  occupiedRooms:     number
  statusCounts:      { active: number; reserved: number; checkout: number; nonResident: number }
  totalTenants:      number
  genderDist:        { label: string; count: number; percent: number }[]
  nationalityDist:   { label: string; count: number; percent: number }[]
  jobDist:           { label: string; count: number; percent: number }[]
  rooms:             { roomNo: string; isVacant: boolean; tenantName: string | null; tenantStatus: string | null; type: string | null; windowType: string | null; direction: string | null; areaPyeong: number | null; areaM2: number | null; baseRent: number }[]
  alerts:            { text: string; link: string; dotColor: string; timeLabel: string }[]
  activity:          { text: string; timeLabel: string; dotColor: string; link: string }[]
  unpaidLeases:      { roomNo: string; tenantName: string; desc: string }[]
}

// ── 레이블 ──────────────────────────────────────────────────────

const DASH_WINDOW_LABEL: Record<string, string> = { OUTER: '외창', INNER: '내창' }
const DASH_DIR_LABEL: Record<string, string> = {
  NORTH: '북향', NORTH_EAST: '북동향', EAST: '동향', SOUTH_EAST: '남동향',
  SOUTH: '남향', SOUTH_WEST: '남서향', WEST: '서향', NORTH_WEST: '북서향',
}
const DASH_STATUS_LABEL: Record<string, string> = {
  ACTIVE: '거주중', RESERVED: '입실 예정', CHECKOUT_PENDING: '퇴실 예정',
}

// ── 피드 카드 컴포넌트 ───────────────────────────────────────────

const COLLAPSED_LIMIT = 4

function FeedCard({
  title, headerRight, items, emptyText, expanded, onToggle,
}: {
  title: string
  headerRight?: React.ReactNode
  items: { text: string; link: string; dotColor: string; timeLabel: string }[]
  emptyText: string
  expanded: boolean
  onToggle: () => void
}) {
  const hasMore = items.length > COLLAPSED_LIMIT
  const visibleItems = expanded ? items : items.slice(0, COLLAPSED_LIMIT)

  return (
    <div
      className="rounded-xl flex flex-col flex-1"
      style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)', minHeight: 160 }}
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between px-5 pt-4 pb-2 shrink-0">
        <h3 style={{ fontSize: 13, fontWeight: 600, color: '#5a4a3a' }}>{title}</h3>
        {headerRight}
      </div>

      {/* 아이템 목록 */}
      <div className="flex-1 overflow-y-auto px-5">
        {items.length === 0 ? (
          <p className="text-sm text-center py-6" style={{ color: 'var(--warm-muted)' }}>{emptyText}</p>
        ) : (
          visibleItems.map((item, i) => (
            <Link
              key={i}
              href={item.link}
              className="flex items-start gap-2.5 py-[10px] hover:opacity-70 transition-opacity"
              style={{ borderBottom: i < visibleItems.length - 1 ? '1px solid var(--warm-border)' : 'none' }}
            >
              <span
                className="w-[7px] h-[7px] rounded-full shrink-0"
                style={{ background: item.dotColor, marginTop: 4 }}
              />
              <span className="flex-1 leading-snug" style={{ fontSize: 12, color: 'var(--warm-mid)' }}>
                {item.text}
              </span>
              <span className="whitespace-nowrap shrink-0" style={{ fontSize: 10, color: 'var(--warm-muted)', fontFamily: 'monospace' }}>
                {item.timeLabel}
              </span>
            </Link>
          ))
        )}
      </div>

      {/* 더보기 버튼 */}
      {hasMore && (
        <button
          onClick={onToggle}
          className="shrink-0 w-full py-2.5 flex items-center justify-center gap-1 transition-opacity hover:opacity-70"
          style={{
            fontSize: 11, color: 'var(--warm-muted)',
            borderTop: '1px solid var(--warm-border)',
          }}
        >
          {expanded
            ? <>접기 <span style={{ fontSize: 10 }}>↑</span></>
            : <>더보기 <span style={{ fontSize: 10, color: 'var(--coral)' }}>+{items.length - COLLAPSED_LIMIT}</span> <span style={{ fontSize: 10 }}>↓</span></>
          }
        </button>
      )}
    </div>
  )
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────

export default function DashboardClient({ data, targetMonth }: { data: DashboardData; targetMonth: string }) {
  const [selectedRoom,     setSelectedRoom]     = useState<DashboardData['rooms'][number] | null>(null)
  const [alertsExpanded,   setAlertsExpanded]   = useState(false)
  const [activityExpanded, setActivityExpanded] = useState(false)

  const prev = data.trend[data.trend.length - 2]
  const cur  = data.trend[data.trend.length - 1]

  const revChange = prev && prev.revenue > 0
    ? Math.round((cur.revenue - prev.revenue) / prev.revenue * 100)
    : null

  const maxRevenue = Math.max(...data.trend.map(t => t.revenue), 1)

  return (
    <div className="space-y-3.5">

      {/* ── 통계 카드 ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">

        {/* 이번 달 수납 */}
        <div className="rounded-xl" style={{ background: 'var(--coral)', padding: '18px 20px' }}>
          <p style={{ fontSize: '10.5px', fontWeight: 500, letterSpacing: '0.02em', textTransform: 'uppercase', color: 'rgba(255,252,247,0.6)', marginBottom: 8 }}>
            이번 달 수납
          </p>
          <p style={{ fontSize: 26, fontWeight: 700, color: '#fff', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 6 }}>
            {Math.round(data.totalRevenue / 10000).toLocaleString()}
            <small style={{ fontSize: 13, fontWeight: 400, color: 'rgba(255,252,247,0.6)', marginLeft: 2 }}>만</small>
          </p>
          <p style={{ fontSize: 11, color: 'rgba(255,252,247,0.55)' }}>
            {revChange != null && (
              <em style={{ fontStyle: 'normal', color: '#fbbf24', marginRight: 3 }}>
                {revChange >= 0 ? '+' : ''}{revChange}%
              </em>
            )}
            전월 대비
          </p>
        </div>

        {/* 입실 현황 */}
        <div className="rounded-xl" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)', padding: '18px 20px' }}>
          <p style={{ fontSize: '10.5px', fontWeight: 500, letterSpacing: '0.02em', textTransform: 'uppercase', color: 'var(--warm-muted)', marginBottom: 8 }}>
            입실 현황
          </p>
          <p style={{ fontSize: 26, fontWeight: 700, color: '#5a4a3a', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 6 }}>
            {data.occupiedRooms}
            <small style={{ fontSize: 13, fontWeight: 400, color: 'var(--warm-muted)' }}> / {data.totalRooms}</small>
          </p>
          <p style={{ fontSize: 11, color: 'var(--warm-muted)' }}>
            공실 <em style={{ fontStyle: 'normal', color: 'var(--coral)' }}>{data.vacantRooms}개</em>
          </p>
        </div>

        {/* 이번 달 지출 */}
        <div className="rounded-xl" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)', padding: '18px 20px' }}>
          <p style={{ fontSize: '10.5px', fontWeight: 500, letterSpacing: '0.02em', textTransform: 'uppercase', color: 'var(--warm-muted)', marginBottom: 8 }}>
            이번 달 지출
          </p>
          <p style={{ fontSize: 26, fontWeight: 700, color: '#5a4a3a', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 6 }}>
            {Math.round(data.totalExpense / 10000).toLocaleString()}
            <small style={{ fontSize: 13, fontWeight: 400, color: 'var(--warm-muted)', marginLeft: 2 }}>만</small>
          </p>
          <p style={{ fontSize: 11, color: 'var(--warm-muted)' }}>이달 지출 합계</p>
        </div>

        {/* 미납 금액 */}
        <div className="rounded-xl" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)', padding: '18px 20px' }}>
          <p style={{ fontSize: '10.5px', fontWeight: 500, letterSpacing: '0.02em', textTransform: 'uppercase', color: 'var(--warm-muted)', marginBottom: 8 }}>
            미납 금액
          </p>
          <p style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 6, color: data.unpaidCount > 0 ? '#ef4444' : '#5a4a3a' }}>
            {Math.round(data.unpaidAmount / 10000).toLocaleString()}
            <small style={{ fontSize: 13, fontWeight: 400, color: 'var(--warm-muted)', marginLeft: 2 }}>만</small>
          </p>
          <p style={{ fontSize: 11, color: 'var(--warm-muted)' }}>
            <em style={{ fontStyle: 'normal', color: data.unpaidCount > 0 ? 'var(--coral)' : 'var(--warm-muted)' }}>{data.unpaidCount}명</em> 미납
          </p>
        </div>
      </div>

      {/* ── 방 현황 + 알림/최근활동 ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-3.5 lg:items-stretch">

        {/* 방 현황 그리드 */}
        <div className="rounded-xl p-5 flex flex-col" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <div className="flex items-center justify-between mb-3.5 shrink-0">
            <p style={{ fontSize: 13, fontWeight: 600, color: '#5a4a3a' }}>
              방 현황
              <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--warm-muted)', marginLeft: 6 }}>
                {data.totalRooms}개 호실
              </span>
            </p>
            <Link href="/room-manage" style={{ fontSize: 11, color: 'var(--coral)' }}>전체 보기 →</Link>
          </div>

          {data.rooms.length === 0 ? (
            <p className="text-center py-8 text-sm" style={{ color: 'var(--warm-muted)' }}>등록된 호실 없음</p>
          ) : (
            <>
              {/* 반응형 그리드: 컨테이너 폭에 맞춰 타일이 자연스럽게 줄어듦 */}
              <div
                className="grid gap-[6px]"
                style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}
              >
                {data.rooms.map(r => {
                  const rentMan = r.baseRent > 0 ? `${Math.round(r.baseRent / 10000)}만` : null
                  const winLabel = r.windowType === 'OUTER' ? '외창' : r.windowType === 'INNER' ? '내창' : null
                  return (
                    <div
                      key={r.roomNo}
                      onClick={() => setSelectedRoom(r)}
                      className="rounded-[8px] flex flex-col px-2 py-2 gap-[3px] cursor-pointer transition-opacity hover:opacity-75 overflow-hidden"
                      style={r.isVacant
                        ? { background: 'rgba(200,160,120,0.12)', color: 'var(--warm-muted)' }
                        : { background: 'rgba(244,98,58,0.09)', color: 'var(--coral)' }
                      }
                    >
                      <span className="truncate font-bold leading-tight" style={{ fontSize: 12 }}>{r.roomNo}호</span>
                      <span className="leading-tight" style={{ fontSize: 10, fontWeight: 500 }}>{r.isVacant ? '공실' : '입실'}</span>
                      {r.type && <span className="truncate leading-tight" style={{ fontSize: 9, opacity: 0.75 }}>{r.type}</span>}
                      {winLabel && <span className="leading-tight" style={{ fontSize: 9, opacity: 0.75 }}>{winLabel}</span>}
                      {rentMan && <span className="leading-tight font-semibold" style={{ fontSize: 10, marginTop: 1 }}>{rentMan}</span>}
                    </div>
                  )
                })}
              </div>
              <div className="flex gap-3.5 mt-3 shrink-0">
                <div className="flex items-center gap-[5px]" style={{ fontSize: 10, color: 'var(--warm-muted)' }}>
                  <span className="inline-block w-[7px] h-[7px] rounded-[2px]" style={{ background: 'rgba(244,98,58,0.25)' }} />입실
                </div>
                <div className="flex items-center gap-[5px]" style={{ fontSize: 10, color: 'var(--warm-muted)' }}>
                  <span className="inline-block w-[7px] h-[7px] rounded-[2px]" style={{ background: 'rgba(200,160,120,0.25)' }} />공실
                </div>
              </div>
            </>
          )}
        </div>

        {/* 우측: 알림 + 최근 활동 (각 절반씩) */}
        <div className="flex flex-col gap-3.5" style={{ minHeight: 600 }}>
          <FeedCard
            title="알림"
            items={data.alerts}
            emptyText="새 알림 없음"
            expanded={alertsExpanded}
            onToggle={() => setAlertsExpanded(v => !v)}
            headerRight={
              data.alerts.length > 0
                ? <span className="rounded-full text-[10px] font-semibold px-2 py-0.5" style={{ background: 'rgba(244,98,58,0.1)', color: 'var(--coral)' }}>{data.alerts.length}</span>
                : undefined
            }
          />
          <FeedCard
            title="최근 활동"
            items={data.activity}
            emptyText="최근 활동 없음"
            expanded={activityExpanded}
            onToggle={() => setActivityExpanded(v => !v)}
            headerRight={
              <Link href={`/rooms?month=${targetMonth}`} style={{ fontSize: 11, color: 'var(--coral)' }}>전체 →</Link>
            }
          />
        </div>
      </div>

      {/* ── 월별 수납 현황 + 미납 입주자 ───────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-3.5">

        {/* 월별 수납 현황 */}
        <div className="rounded-xl p-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <div className="flex items-center justify-between mb-3">
            <h3 style={{ fontSize: 13, fontWeight: 600, color: '#5a4a3a' }}>월별 수납 현황</h3>
            <Link href={`/finance?month=${targetMonth}`} style={{ fontSize: 11, color: 'var(--coral)' }}>리포트 →</Link>
          </div>
          <div className="space-y-[9px]">
            {data.trend.map(t => {
              const pct = Math.round((t.revenue / maxRevenue) * 100)
              return (
                <div key={t.month} className="flex items-center gap-2.5">
                  <span className="w-7 shrink-0 text-right" style={{ fontSize: '10.5px', color: 'var(--warm-muted)' }}>
                    {parseInt(t.month.slice(5))}월
                  </span>
                  <div className="flex-1 h-[7px] rounded-full overflow-hidden" style={{ background: 'rgba(200,160,120,0.15)' }}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, background: 'var(--coral)', transition: 'width 0.6s ease' }}
                    />
                  </div>
                  <span className="w-14 text-right shrink-0" style={{ fontSize: '10.5px', fontWeight: 600, color: '#5a4a3a', fontFamily: 'monospace' }}>
                    {Math.round(t.revenue / 10000).toLocaleString()}만
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* 미납 입주자 */}
        <div className="rounded-xl p-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <div className="flex items-center justify-between mb-3">
            <h3 style={{ fontSize: 13, fontWeight: 600, color: '#5a4a3a' }}>미납 입주자</h3>
            {data.unpaidCount > 0 && (
              <span
                className="rounded-full"
                style={{ fontSize: 10, fontWeight: 600, padding: '4px 11px', background: 'rgba(244,98,58,0.1)', color: 'var(--coral)' }}
              >
                {data.unpaidCount}건
              </span>
            )}
          </div>

          {data.unpaidLeases.length === 0 ? (
            <p className="text-sm text-center py-8" style={{ color: 'var(--warm-muted)' }}>미납 없음 🎉</p>
          ) : (
            <div className="space-y-2">
              {data.unpaidLeases.map((l, i) => (
                <Link
                  key={i}
                  href="/tenants"
                  className="flex items-center gap-2.5 rounded-lg hover:opacity-70 transition-opacity"
                  style={{ background: 'rgba(200,160,120,0.06)', padding: '10px 12px' }}
                >
                  <div
                    className="w-[30px] h-[30px] rounded-full flex items-center justify-center shrink-0"
                    style={{ background: 'var(--sand)', fontSize: 11, fontWeight: 700, color: '#c08050' }}
                  >
                    {l.tenantName.slice(0, 1)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate" style={{ fontSize: 12, color: '#5a4a3a' }}>{l.tenantName}</p>
                    <p style={{ fontSize: 10, color: 'var(--warm-muted)' }}>{l.roomNo}호 · {l.desc}</p>
                  </div>
                  <span
                    className="rounded-full shrink-0"
                    style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', background: 'rgba(244,98,58,0.1)', color: 'var(--coral)' }}
                  >
                    미납
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── 방 상세 팝업 ─────────────────────────────────────────── */}
      {selectedRoom && <RoomDetailPopup room={selectedRoom} onClose={() => setSelectedRoom(null)} />}
    </div>
  )
}

// ── 방 상세 팝업 ─────────────────────────────────────────────────

function RoomDetailPopup({ room, onClose }: { room: DashboardData['rooms'][number]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}>
      <div className="bg-[var(--cream)] rounded-2xl shadow-2xl w-full max-w-xs overflow-hidden"
        onClick={e => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--warm-border)]">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-[var(--warm-dark)]">{room.roomNo}호</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium
              ${room.isVacant ? 'bg-[var(--canvas)] text-[var(--warm-mid)]' : 'bg-[var(--coral)]/20 text-[var(--coral)]'}`}>
              {room.isVacant ? '공실' : (DASH_STATUS_LABEL[room.tenantStatus ?? ''] ?? '입주중')}
            </span>
          </div>
          <button onClick={onClose} className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-lg leading-none">✕</button>
        </div>
        {/* 정보 */}
        <div className="px-5 py-4 space-y-2 text-sm">
          {room.tenantName && (
            <div className="flex justify-between">
              <span className="text-[var(--warm-muted)]">입주자</span>
              <span className="font-medium text-[var(--warm-dark)]">{room.tenantName}</span>
            </div>
          )}
          {room.type && (
            <div className="flex justify-between">
              <span className="text-[var(--warm-muted)]">타입</span>
              <span className="text-[var(--warm-dark)]">{room.type}</span>
            </div>
          )}
          {room.windowType && (
            <div className="flex justify-between">
              <span className="text-[var(--warm-muted)]">창문</span>
              <span className="text-[var(--warm-dark)]">{DASH_WINDOW_LABEL[room.windowType] ?? room.windowType}</span>
            </div>
          )}
          {room.direction && (
            <div className="flex justify-between">
              <span className="text-[var(--warm-muted)]">방향</span>
              <span className="text-[var(--warm-dark)]">{DASH_DIR_LABEL[room.direction] ?? room.direction}</span>
            </div>
          )}
          {(room.areaPyeong || room.areaM2) && (
            <div className="flex justify-between">
              <span className="text-[var(--warm-muted)]">면적</span>
              <span className="text-[var(--warm-dark)]">
                {[room.areaPyeong ? `${room.areaPyeong}평` : null, room.areaM2 ? `${room.areaM2}㎡` : null].filter(Boolean).join(' / ')}
              </span>
            </div>
          )}
          <div className="flex justify-between border-t border-[var(--warm-border)] pt-2 mt-1">
            <span className="text-[var(--warm-muted)]">기본이용료</span>
            <span className="font-semibold text-[var(--warm-dark)]">{room.baseRent.toLocaleString()}원</span>
          </div>
        </div>
      </div>
    </div>
  )
}
