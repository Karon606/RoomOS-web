'use client'

import Link from 'next/link'

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
  rooms:             { roomNo: string; isVacant: boolean; tenantName: string | null }[]
  activity:          { text: string; timeLabel: string; dotColor: string }[]
  unpaidLeases:      { roomNo: string; tenantName: string; desc: string }[]
}

// ── 메인 ────────────────────────────────────────────────────────

export default function DashboardClient({ data, targetMonth }: { data: DashboardData; targetMonth: string }) {
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

        {/* 이번 달 수납 - accent */}
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

      {/* ── 방 현황 + 최근 활동 ─────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3.5">

        {/* 방 현황 그리드 */}
        <div className="rounded-xl p-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <div className="flex items-center justify-between mb-3.5">
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
              <div className="grid gap-[7px]" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
                {data.rooms.map(r => (
                  <div
                    key={r.roomNo}
                    className="aspect-square rounded-[7px] flex flex-col items-center justify-center gap-[3px]"
                    style={r.isVacant
                      ? { background: 'rgba(200,160,120,0.12)', color: 'var(--warm-muted)' }
                      : { background: 'rgba(244,98,58,0.09)', color: 'var(--coral)' }
                    }
                  >
                    <span style={{ fontSize: 11, fontWeight: 700 }}>{r.roomNo}</span>
                    <span style={{ fontSize: 10, fontWeight: 500 }}>{r.isVacant ? '공실' : '입실'}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-3.5 mt-3.5">
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

        {/* 최근 활동 */}
        <div className="rounded-xl p-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <div className="flex items-center justify-between mb-0.5">
            <h3 style={{ fontSize: 13, fontWeight: 600, color: '#5a4a3a' }}>최근 활동</h3>
            <Link href={`/rooms?month=${targetMonth}`} style={{ fontSize: 11, color: 'var(--coral)' }}>전체 →</Link>
          </div>

          {data.activity.length === 0 ? (
            <p className="text-sm text-center py-8" style={{ color: 'var(--warm-muted)' }}>최근 활동 없음</p>
          ) : (
            <div>
              {data.activity.map((a, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2.5 py-[11px]"
                  style={{ borderBottom: i < data.activity.length - 1 ? '1px solid var(--warm-border)' : 'none' }}
                >
                  <span
                    className="w-[7px] h-[7px] rounded-full shrink-0"
                    style={{ background: a.dotColor, marginTop: 4 }}
                  />
                  <span className="flex-1 leading-snug" style={{ fontSize: 12, color: 'var(--warm-mid)' }}>
                    {a.text}
                  </span>
                  <span className="whitespace-nowrap shrink-0" style={{ fontSize: 10, color: 'var(--warm-muted)', fontFamily: 'monospace' }}>
                    {a.timeLabel}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── 월별 수납 현황 + 미납 입주자 ───────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3.5">

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
                <div
                  key={i}
                  className="flex items-center gap-2.5 rounded-lg"
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
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
