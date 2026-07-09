'use client'

// 단기 입실 정보 — 단기 희망 고객 상세 전용 박스(운영자 확정 2026-07-10, a안).
// 입주 희망일·퇴실 예정일 나란히 + 희망 거주 기간 + 방 컨디션(타입·창문·가격)별 단기 요금.
// 희망 방이 있으면 그 방들의 컨디션만, 없으면 영업장 전체 컨디션을 모두 보여준다(문의 전화 대응용).
// 계산은 홈 '단기 요금 계산'과 동일(calcShortStay) — 금액이 항상 일치.

import { useEffect, useState } from 'react'
import { getRoomsForQuote } from '@/app/(app)/tenants/actions'
import { calcShortStay, stayDaysOf } from '@/lib/shortStay'
import { fmtWon } from '@/lib/fmtMoney'
import { Section } from './Section'

type LeaseLite = {
  moveInDate: Date | string | null
  expectedMoveOut: Date | string | null
  wishRooms: string | null
}

const WINDOW_LABEL: Record<string, string> = { OUTER: '외창', INNER: '내창' }
const toYmd = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '')
const fmtMD = (d: Date | string | null) => {
  if (!d) return '미정'
  const dt = new Date(d)
  return `${dt.getMonth() + 1}/${dt.getDate()}`
}

export function ShortStayInfoWidget({ lease }: { lease: LeaseLite }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getRoomsForQuote>> | null>(null)
  useEffect(() => { getRoomsForQuote().then(setData).catch(() => setData(null)) }, [])

  const days = lease.moveInDate && lease.expectedMoveOut
    ? stayDaysOf(toYmd(lease.moveInDate), toYmd(lease.expectedMoveOut))
    : null

  // 방 컨디션 그룹 — 타입·창문·가격이 같으면 한 줄(영업장별로 방마다 가격이 달라도 전부 드러남)
  const groups = (() => {
    if (!data) return []
    const wish = (lease.wishRooms ?? '').split(',').map(s => s.trim()).filter(Boolean)
    const pool = wish.length > 0 ? data.rooms.filter(r => wish.includes(r.roomNo)) : data.rooms
    const map = new Map<string, { label: string; rent: number; roomNos: string[] }>()
    for (const r of pool) {
      if (!r.baseRent || r.baseRent <= 0) continue   // 사무실 등 비대상
      const label = [r.type ?? '방', r.windowType ? WINDOW_LABEL[r.windowType] ?? r.windowType : null].filter(Boolean).join(' ')
      const key = `${label}|${r.baseRent}`
      const g = map.get(key) ?? { label, rent: r.baseRent, roomNos: [] }
      g.roomNos.push(r.roomNo)
      map.set(key, g)
    }
    return [...map.values()].sort((a, b) => a.rent - b.rent)
  })()

  const wishCount = (lease.wishRooms ?? '').split(',').map(s => s.trim()).filter(Boolean).length

  return (
    <Section title="단기 입실 정보">
      <div className="space-y-2.5">
        <p className="text-sm text-[var(--warm-dark)]">
          입주 희망 <span className="font-semibold">{fmtMD(lease.moveInDate)}</span>
          <span className="text-[var(--warm-muted)]"> → </span>
          퇴실 <span className="font-semibold">{fmtMD(lease.expectedMoveOut)}</span>
          {days != null && data && (() => {
            const s = calcShortStay(data.shortStay, 100, days)
            return (
              <span className="text-xs text-[var(--warm-mid)]"> · {days}일{s ? ` (${s.units}${data.shortStay.unitDays === 7 ? '주' : `×${data.shortStay.unitDays}일`} 계약)` : ''}</span>
            )
          })()}
        </p>
        {days == null ? (
          <p className="text-xs text-[var(--warm-muted)]">입주 희망일과 퇴실 예정일을 입력하면 방 컨디션별 요금이 자동 계산됩니다.</p>
        ) : !data ? (
          <p className="text-xs text-[var(--warm-muted)]">요금 계산 중…</p>
        ) : (
          <div>
            <p className="mb-1.5 text-xs font-semibold text-[var(--warm-mid)]">
              {wishCount > 0 ? '희망 방 기준 예상 요금' : '방 컨디션별 예상 요금'}
              <span className="ml-1 font-normal text-[var(--warm-muted)]">(청소비 포함{data.shortStay.deposit > 0 ? ` · 보증금 ${fmtWon(data.shortStay.deposit)} 별도` : ''})</span>
            </p>
            <ul className="space-y-1">
              {groups.map(g => {
                const q = calcShortStay(data.shortStay, g.rent, days)
                return (
                  <li key={`${g.label}|${g.rent}`} className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate text-[var(--warm-mid)]">
                      {g.label} <span className="text-[var(--warm-muted)]">({fmtWon(g.rent)}{wishCount > 0 ? ` · ${g.roomNos.join(', ')}호` : ` · ${g.roomNos.length}개 방`})</span>
                    </span>
                    <span className="shrink-0 tabular-nums font-semibold text-[var(--warm-dark)]">{q ? fmtWon(q.total) : '기간 초과(월 단위)'}</span>
                  </li>
                )
              })}
              {groups.length === 0 && <li className="text-xs text-[var(--warm-muted)]">계산할 방 정보가 없습니다.</li>}
            </ul>
          </div>
        )}
      </div>
    </Section>
  )
}
