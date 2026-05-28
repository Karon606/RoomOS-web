'use client'

import { useState, useEffect, useMemo } from 'react'

// 차원별로 호실을 그룹화하고 그룹별 핵심 지표를 보여주는 위젯.
// (3차 — 사용자 요청: 층·등급·창문·방향·방타입 조합으로 대시보드에 표시)

type RoomLite = {
  roomNo: string
  isVacant: boolean
  tenantStatus: string | null  // 'ACTIVE' | 'RESERVED' | 'CHECKOUT_PENDING' | null
  type: string | null
  tier: string | null
  floor: string | null
  windowType: string | null
  direction: string | null
  baseRent: number
}

type DimKey = 'floor' | 'tier' | 'windowType' | 'direction' | 'type'

const WINDOW_LABEL: Record<string, string> = { OUTER: '외창', INNER: '내창' }
const DIR_LABEL: Record<string, string> = {
  NORTH: '북향', NORTH_EAST: '북동향', EAST: '동향', SOUTH_EAST: '남동향',
  SOUTH: '남향', SOUTH_WEST: '남서향', WEST: '서향', NORTH_WEST: '북서향',
}
const UNSET = '미지정'

const DIMENSIONS: { key: DimKey; label: string; getter: (r: RoomLite) => string }[] = [
  { key: 'floor',      label: '층',      getter: r => r.floor ? `${r.floor}층` : UNSET },
  { key: 'tier',       label: '등급',    getter: r => r.tier ?? UNSET },
  { key: 'windowType', label: '창문',    getter: r => r.windowType ? (WINDOW_LABEL[r.windowType] ?? r.windowType) : UNSET },
  { key: 'direction',  label: '방향',    getter: r => r.direction ? (DIR_LABEL[r.direction] ?? r.direction) : UNSET },
  { key: 'type',       label: '방타입',  getter: r => r.type ?? UNSET },
]

const STORAGE_KEY = 'stayeum-roomdist-dims'

function fmtMoney(n: number): string {
  if (!isFinite(n) || n === 0) return '0원'
  if (n >= 10000) {
    const eok = Math.floor(n / 100000000)
    const man = Math.floor((n % 100000000) / 10000)
    if (eok > 0) return man > 0 ? `${eok}억 ${man}만원` : `${eok}억원`
    return `${man}만원`
  }
  return `${n.toLocaleString()}원`
}

export default function RoomDistribution({ rooms }: { rooms: RoomLite[] }) {
  const [active, setActive] = useState<Set<DimKey>>(new Set(['floor', 'tier']))

  // localStorage 복원 — Next.js hydration-safe(SSR 시점엔 localStorage 없음)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as DimKey[]
        if (Array.isArray(parsed) && parsed.every(k => DIMENSIONS.some(d => d.key === k))) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setActive(new Set(parsed))
        }
      }
    } catch { /* ignore */ }
  }, [])

  // localStorage 저장
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(active))) } catch { /* ignore */ }
  }, [active])

  const toggle = (key: DimKey) => {
    setActive(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const activeDims = useMemo(() => DIMENSIONS.filter(d => active.has(d.key)), [active])

  // 그룹화
  const groups = useMemo(() => {
    if (activeDims.length === 0) {
      // 차원 0개 — 전체 합계 하나
      return [{ key: '전체', label: '전체', rooms }]
    }
    const map = new Map<string, { label: string; rooms: RoomLite[] }>()
    for (const r of rooms) {
      const parts = activeDims.map(d => d.getter(r))
      const label = parts.join(' · ')
      if (!map.has(label)) map.set(label, { label, rooms: [] })
      map.get(label)!.rooms.push(r)
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'ko'))
      .map(([key, v]) => ({ key, label: v.label, rooms: v.rooms }))
  }, [rooms, activeDims])

  const totalRooms = rooms.length

  return (
    <div className="rounded-xl p-5 flex flex-col gap-3.5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
      <div className="flex items-center justify-between gap-2 shrink-0">
        <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--ink-2)' }}>
          호실 분포
          <span style={{ fontSize: '0.6875rem', fontWeight: 400, color: 'var(--warm-muted)', marginLeft: 6 }}>
            차원 조합으로 그룹화
          </span>
        </p>
      </div>

      {/* 차원 칩 — 다중 선택 */}
      <div className="flex gap-1.5 flex-wrap">
        {DIMENSIONS.map(d => {
          const on = active.has(d.key)
          return (
            <button key={d.key} type="button" onClick={() => toggle(d.key)}
              className="px-3 py-1.5 text-xs rounded-lg transition-colors min-h-[36px]"
              style={{
                background: on ? 'var(--persimmon)' : 'var(--canvas)',
                color: on ? '#fff' : 'var(--warm-mid)',
                border: '1px solid ' + (on ? 'var(--persimmon)' : 'var(--warm-border)'),
                fontWeight: on ? 600 : 500,
              }}>
              {d.label}
            </button>
          )
        })}
      </div>

      {totalRooms === 0 ? (
        <p className="text-center py-6 text-sm" style={{ color: 'var(--warm-muted)' }}>등록된 호실 없음</p>
      ) : groups.length === 0 ? (
        <p className="text-center py-6 text-sm" style={{ color: 'var(--warm-muted)' }}>조건에 맞는 그룹 없음</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
          {groups.map(g => {
            const totalG     = g.rooms.length
            const activeN    = g.rooms.filter(r => r.tenantStatus === 'ACTIVE').length
            const reservedN  = g.rooms.filter(r => r.tenantStatus === 'RESERVED').length
            const checkoutN  = g.rooms.filter(r => r.tenantStatus === 'CHECKOUT_PENDING').length
            const vacantN    = g.rooms.filter(r => r.isVacant).length
            const occupancy  = totalG > 0 ? Math.round(((totalG - vacantN) / totalG) * 100) : 0
            const avgRent    = totalG > 0 ? Math.round(g.rooms.reduce((s, r) => s + r.baseRent, 0) / totalG) : 0
            return (
              <div key={g.key} className="rounded-lg p-3 space-y-1.5"
                style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)' }}>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold truncate" style={{ color: 'var(--ink-2)' }}>{g.label}</p>
                  <p className="text-xs shrink-0" style={{ color: 'var(--warm-muted)' }}>
                    {totalG}실 · 점유 <strong style={{ color: 'var(--coral)' }}>{occupancy}%</strong>
                  </p>
                </div>
                <div className="flex gap-x-2 gap-y-0.5 flex-wrap text-[0.6875rem]" style={{ color: 'var(--warm-mid)' }}>
                  <span>입주 <strong style={{ color: 'var(--ink-2)' }}>{activeN}</strong></span>
                  <span>·</span>
                  <span>예약 <strong style={{ color: 'var(--ink-2)' }}>{reservedN}</strong></span>
                  <span>·</span>
                  <span>퇴실예정 <strong style={{ color: 'var(--ink-2)' }}>{checkoutN}</strong></span>
                  <span>·</span>
                  <span>공실 <strong style={{ color: 'var(--ink-2)' }}>{vacantN}</strong></span>
                </div>
                <p className="text-[0.6875rem]" style={{ color: 'var(--warm-mid)' }}>
                  평균 <strong style={{ color: 'var(--ink-2)' }}>{fmtMoney(avgRent)}</strong>
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
