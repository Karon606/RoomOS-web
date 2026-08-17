'use client'

// 입퇴실 캘린더 — 그 달 방별 변동을 데스크톱은 간트로, 768px 미만은 날짜순 리스트로 그린다.
//
// 조립·판정은 lib/moveCalendar 정본이 서버에서 끝낸다. 이 파일은 그 결과를 배치할 뿐이고
// 겹침·충돌을 다시 세지 않는다 — 화면이 사본을 들면 감지망이 사고라 부르는 상태와 갈린다.
//
// 두 편성은 같은 한 벌(rows·events)을 나눠 쓴다. 별도 조회가 없으므로 폭이 바뀌어도 같은 달이다.

import { useLayoutEffect, useRef, useState } from 'react'
import { useEntityModal } from '@/components/entity-modal/EntityModal'
import { EmptyState } from '@/components/ui/EmptyState'
import { RoomCard } from '@/components/ui/RoomCard'
import { StatusBadge, statusTipColor, type BadgeTone } from '@/components/ui/StatusBadge'
import { fmtRoomNo } from '@/lib/roomNo'
import { fmtMD } from '@/lib/fmtDate'
import type { MoveBar, MoveCalendarMonth, MoveCalendarRow, MoveDaySpan, MoveGap } from '@/lib/moveCalendar'

/** 호실 열 폭. sticky 로 붙어 있어 가로 스크롤 중에도 어느 방인지 안 잃는다(§23). */
const ROOM_COL = 66
/** 하루의 최소 폭 — 이보다 좁아지면 트랙이 가로로 스크롤된다(페이지는 안 밀린다). */
const MIN_DAY = 18
/** 캡션 'N일 공실'을 세울 최소 폭. 이보다 좁으면 공백은 색 없는 빈 자리로만 말한다. */
const GAP_CAPTION_MIN = 40

/** 11px 글자의 대략 폭 — 한글·전각은 11, 나머지는 6.2. 라벨을 바 안에 넣을지 밖에 낼지의 자다. */
function estWidth(s: string): number {
  let w = 0
  for (const ch of s) w += ch.codePointAt(0)! > 0x2e80 ? 11 : 6.2
  return w
}

/** 막대 색 — 전부 기존 토큰이다(§03·§04). 거주는 퇴실 계열 카멜, 예약은 info 계열 인디고. */
function barTone(bar: MoveBar): { bg: string; fg: string } {
  return bar.kind === 'reserved'
    // --info-bg 는 알파 .08 이라 트랙 위 막대로는 안 보인다. §03 이 농도가 필요한 자리로 열어 둔
    // 같은 hue 의 밴드 단계를 쓰고 글자만 --info-fg 로 둔다(라이트 6.16:1 · 다크 5.19:1).
    ? { bg: 'var(--band-await-bg)', fg: 'var(--info-fg)' }
    : { bg: 'var(--badge-exit-bg)', fg: 'var(--badge-exit-fg)' }
}

/** 막대 모서리 — 월 밖으로 이어지는 쪽은 직각, 이 달 안에서 끝나는 쪽만 둥글다. */
function barRadius(bar: MoveBar): string {
  const l = bar.clippedStart ? '0' : 'var(--radius-xs)'
  const r = bar.clippedEnd ? '0' : 'var(--radius-xs)'
  return `${l} ${r} ${r} ${l}`
}

export function MoveCalendar({ data }: { data: MoveCalendarMonth }) {
  const entityModal = useEntityModal()
  const trackRef = useRef<HTMLDivElement>(null)
  const [dayWidth, setDayWidth] = useState(0)
  const dim = data.daysInMonth

  // 하루의 실측 폭 — 라벨을 바 안에 넣을지, 공백 캡션을 세울지가 여기서 갈린다.
  // ViewTabs 와 같은 실측 문법(레이아웃 직후 측정 + ResizeObserver).
  useLayoutEffect(() => {
    const el = trackRef.current
    if (!el) return
    const measure = () => setDayWidth(Math.max(0, (el.clientWidth - ROOM_COL) / dim))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [dim])

  const openLease = (roomId: string, leaseId: string, tenantId: string) =>
    entityModal.open({ kind: 'room', roomId, leaseTermId: leaseId, tenantId })

  if (data.rows.length === 0) {
    return (
      <EmptyState
        title="이달 입퇴실 변동이 없습니다"
        description="입주·퇴실·입실 예약이 잡히면 이 달력에 나타납니다."
      />
    )
  }

  const cols = `${ROOM_COL}px repeat(${dim}, minmax(0, 1fr))`
  const days = Array.from({ length: dim }, (_, i) => i + 1)

  return (
    <div className="space-y-3">
      {/* 충돌 요약 — §18 Status Row(좌 3px 팁 + danger-bg). 충돌이 없으면 이 줄 자체가 없다. */}
      {data.conflicts.length > 0 && (
        <div className="space-y-1.5">
          {data.conflicts.map((c, i) => (
            <div key={`${c.leaseId}-${c.kind}-${i}`}
              className="flex items-center gap-3 rounded-lg border-l-[3px] px-3.5 py-2.5"
              style={{ borderLeftColor: 'var(--coral)', background: 'var(--danger-bg)' }}>
              <p className="flex-1 min-w-0 text-xs font-medium" style={{ color: 'var(--danger-fg)' }}>{c.text}</p>
              <button type="button" onClick={() => openLease(c.roomId, c.leaseId, c.tenantId)}
                className="shrink-0 min-h-[44px] inline-flex items-center text-[0.6875rem] font-semibold px-2.5 rounded-md border transition-colors hover:bg-[var(--coral)]/10"
                style={{ borderColor: 'color-mix(in srgb, var(--coral) 45%, transparent)', color: 'var(--tc-text)' }}>
                계약 보기
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── 데스크톱 간트 ── 768px 이상. 카드 셸은 §24(cream · border · r-xl · 그림자 없음). */}
      <div className="hidden md:block rounded-xl overflow-hidden" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
        <div className="overflow-x-auto">
          <div ref={trackRef} className="move-track" style={{ minWidth: ROOM_COL + dim * MIN_DAY }}>

            {/* 날짜 눈금 — 오늘만 원형 강조(다른 달에서는 아예 없다). */}
            <div className="grid items-center" style={{ gridTemplateColumns: cols, borderBottom: '1px solid var(--warm-border)' }}>
              <div className="sticky left-0 z-20 px-2 py-1.5 text-[0.65625rem] font-bold uppercase"
                style={{ background: 'var(--cream)', color: 'var(--ink-m)' }}>호실</div>
              {days.map(d => (
                <div key={d} className="py-1.5 flex justify-center">
                  <span className="inline-flex items-center justify-center tnum text-[0.65625rem] leading-none"
                    style={d === data.todayDay
                      ? { width: 17, height: 17, borderRadius: 9999, background: 'var(--coral)', color: 'var(--on-solid)', fontWeight: 700 }
                      : { color: 'var(--ink-m)' }}>{d}</span>
                </div>
              ))}
            </div>

            {data.rows.map((row, ri) => (
              <GanttRow key={row.roomId} row={row} dim={dim} cols={cols} dayWidth={dayWidth}
                todayDay={data.todayDay} first={ri === 0} onOpen={openLease} />
            ))}
          </div>
        </div>
      </div>

      {/* ── 모바일 리스트 ── 768px 미만. 같은 한 벌의 다른 편성이다(§20). */}
      <ul className="md:hidden space-y-2">
        {data.events.map(e => {
          const tone: BadgeTone = e.type === 'out' ? 'exit' : e.kind === 'reserved' ? 'await' : 'movein'
          const label = e.type === 'out' ? '퇴실' : e.kind === 'reserved' ? '입실 예약' : '입실'
          const span = [e.stayFrom ? fmtMD(e.stayFrom) : '이전부터', e.stayTo ? fmtMD(e.stayTo) : '퇴실일 미정'].join(' ~ ')
          return (
            <li key={`${e.leaseId}-${e.type}`}>
              <RoomCard kind="neutral" tipColor={statusTipColor(tone)} onClick={() => openLease(e.roomId, e.leaseId, e.tenantId)}>
                <div className="px-3.5 py-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-bold tnum" style={{ color: 'var(--ink-2)' }}>
                      {fmtMD(`${data.month}-${String(e.day).padStart(2, '0')}`)} · {fmtRoomNo(e.roomNo)}
                    </p>
                    <StatusBadge tone={tone}>{label}</StatusBadge>
                  </div>
                  <p className="truncate text-xs" style={{ color: 'var(--ink-s)' }}>
                    {e.tenantName} <span className="tnum" style={{ color: 'var(--ink-m)' }}>{span}</span>
                  </p>
                </div>
              </RoomCard>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** 한 막대의 라벨을 어디에 어떻게 놓을지. 공백 캡션이 이 결과를 보고 자리를 비켜 준다. */
type Placed = {
  bar: MoveBar
  full: string
  mode: 'full' | 'name' | 'outside'
  side: 'right' | 'left' | null
  /**
   * 바 밖 라벨이 차지할 열 구간 — 글자가 실제로 먹는 만큼만 잡는다(다음 막대 앞에서 끊는다).
   * 남는 칸까지 통째로 잡으면 상자가 공백 캡션 위에 겹쳐 앉아, 글자는 안 부딪혀도
   * 캡션이 어디에 설 수 있는지 계산할 근거가 사라진다.
   */
  ink: MoveDaySpan | null
}

function place(bar: MoveBar, row: MoveCalendarRow, dim: number, dayWidth: number): Placed {
  const full = `${bar.tenantName} · ${bar.label}`
  const px = (bar.endDay - bar.startDay + 1) * dayWidth
  // 실측 전(첫 프레임)은 이름만 — 가장 흔한 결말이라 측정 뒤 흔들림이 가장 작다.
  const fits: Placed['mode'] = dayWidth === 0 ? 'name'
    : px >= estWidth(full) + 16 ? 'full'
      : px >= estWidth(bar.tenantName) + 16 ? 'name' : 'outside'
  const bare: Placed = { bar, full, mode: fits, side: null, ink: null }
  if (fits !== 'outside') return bare

  // 같은 층에서 다음 막대가 시작하는 날 — 바 밖 라벨이 그 위로 넘어가지 않게 끊는 자리.
  const next = row.bars.filter(b => b.lane === bar.lane && b.startDay > bar.endDay)
    .reduce((m, b) => Math.min(m, b.startDay), dim + 1)
  const needDays = Math.max(1, Math.ceil((estWidth(full) + 8) / dayWidth))
  if (bar.endDay < dim && next > bar.endDay + 1) {
    const limit = Math.min(next - 1, dim)
    return { ...bare, side: 'right', ink: { startDay: bar.endDay + 1, endDay: Math.min(bar.endDay + needDays, limit) } }
  }
  if (bar.startDay > 1) {
    return { ...bare, side: 'left', ink: { startDay: Math.max(1, bar.startDay - needDays), endDay: bar.startDay - 1 } }
  }
  // 양옆이 다 막힌 자리 — 잘린 이름이라도 바 안에 둔다(아무것도 없는 것보다는 낫다).
  return { ...bare, mode: 'name' }
}

function GanttRow({ row, dim, cols, dayWidth, todayDay, first, onOpen }: {
  row: MoveCalendarRow
  dim: number
  cols: string
  dayWidth: number
  todayDay: number | null
  first: boolean
  onOpen: (roomId: string, leaseId: string, tenantId: string) => void
}) {
  const attn = row.conflicts.length > 0
  const placed = row.bars.map(bar => place(bar, row, dim, dayWidth))
  // 캡션은 0층(gridRow 1)에 그리므로 0층의 바 밖 라벨과만 자리를 다툰다.
  const blocked = placed.filter(p => p.bar.lane === 0 && p.ink).map(p => p.ink!)

  /** 공백에서 바 밖 라벨을 뺀 뒤 남은 가장 넓은 구간. 40px 이 안 나오면 캡션을 세우지 않는다. */
  const captionSpan = (g: MoveGap): MoveDaySpan | null => {
    const taken = new Set<number>()
    for (const b of blocked) for (let d = b.startDay; d <= b.endDay; d++) taken.add(d)
    let best: MoveDaySpan | null = null
    let cur: MoveDaySpan | null = null
    for (let d = g.startDay; d <= g.endDay + 1; d++) {
      if (d <= g.endDay && !taken.has(d)) cur = cur ? { startDay: cur.startDay, endDay: d } : { startDay: d, endDay: d }
      else if (cur) {
        if (!best || cur.endDay - cur.startDay > best.endDay - best.startDay) best = cur
        cur = null
      }
    }
    if (!best) return null
    return (best.endDay - best.startDay + 1) * dayWidth >= GAP_CAPTION_MIN ? best : null
  }

  return (
    <div>
      <div className="grid" style={{
        gridTemplateColumns: cols,
        gridTemplateRows: `repeat(${row.laneCount}, var(--mc-lane))`,
        borderTop: first ? 'none' : '1px solid var(--warm-border)',
      }}>
        {/* 호실 열 — sticky(§23). 충돌 행은 좌 3px 코랄 팁(§18 .attn). */}
        <div className="sticky left-0 z-20 flex items-center px-2 tnum text-xs font-bold"
          style={{
            gridColumn: '1 / 2', gridRow: '1 / -1',
            background: 'var(--cream)', color: 'var(--ink-2)',
            borderLeft: `3px solid ${attn ? 'var(--coral)' : 'transparent'}`,
          }}>
          {fmtRoomNo(row.roomNo)}
        </div>

        {/* 공백 캡션 — 바 밖 라벨을 피해 남은 자리에, 폭이 나올 때만. 색은 없다(트랙 그대로). */}
        {row.gaps.map(g => {
          const span = captionSpan(g)
          return span && (
            <div key={`gap-${g.startDay}`} className="flex items-center justify-center text-[0.65625rem] tnum pointer-events-none"
              style={{ gridColumn: `${span.startDay + 1} / ${span.endDay + 2}`, gridRow: '1 / 2', color: 'var(--ink-m)' }}>
              {g.days}일 공실
            </div>
          )
        })}

        {/* 막대 */}
        {placed.map(p => (
          <Bar key={p.bar.leaseId} p={p} onOpen={() => onOpen(row.roomId, p.bar.leaseId, p.bar.tenantId)} />
        ))}

        {/* 겹친 구간 — 막대 위에 얹는다. 반투명이라 아래 막대가 비치고, 그 위 글자는 --ink-2 다(§03). */}
        {row.overlaps.map(s => (
          <div key={`ov-${s.startDay}`} aria-hidden className="pointer-events-none"
            style={{
              gridColumn: `${s.startDay + 1} / ${s.endDay + 2}`, gridRow: '1 / -1',
              background: 'var(--band-overdue-bg)', borderRadius: 'var(--radius-xs)',
            }} />
        ))}

        {/* 오늘 — 트랙을 가로지르는 세로 1px. 다른 달에서는 todayDay 가 null 이라 아예 없다. */}
        {todayDay != null && (
          <div aria-hidden className="pointer-events-none"
            style={{ gridColumn: `${todayDay + 1} / span 1`, gridRow: '1 / -1', width: 1, justifySelf: 'start', background: 'var(--tc-text)' }} />
        )}
      </div>

      {/* 꼬리 — 트랙 밖(다음 달)의 사실을 한 줄로. 막대로 그리면 이 달에 있는 일로 읽힌다. */}
      {row.tail && (
        <div className="grid" style={{ gridTemplateColumns: cols }}>
          <div className="sticky left-0 z-20" style={{ gridColumn: '1 / 2', background: 'var(--cream)' }} />
          <p className="pb-1.5 pl-1 text-[0.65625rem] truncate" style={{ gridColumn: `2 / -1`, color: 'var(--ink-m)' }}>
            {row.tail}
          </p>
        </div>
      )}
    </div>
  )
}

function Bar({ p, onOpen }: { p: Placed; onOpen: () => void }) {
  const { bar, full, mode, side, ink } = p
  const tone = barTone(bar)

  return (
    <>
      <button type="button" onClick={onOpen} title={full}
        className="min-w-0 self-center flex items-center px-2 text-[0.6875rem] font-semibold truncate transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--coral)]"
        style={{
          gridColumn: `${bar.startDay + 1} / ${bar.endDay + 2}`,
          gridRow: `${bar.lane + 1} / span 1`,
          height: 'calc(var(--mc-lane) - 12px)',
          background: tone.bg,
          // 겹친 구간의 짙은 밴드가 위에 얹히므로 충돌 막대의 글자는 중립 잉크로 둔다(§03).
          color: bar.conflicted ? 'var(--ink-2)' : tone.fg,
          borderRadius: barRadius(bar),
        }}>
        {mode === 'full' ? full : mode === 'name' ? bar.tenantName : ''}
      </button>
      {side && ink && (
        <span className="self-center px-1 text-[0.6875rem] font-medium truncate pointer-events-none"
          style={{
            gridColumn: `${ink.startDay + 1} / ${ink.endDay + 2}`,
            gridRow: `${bar.lane + 1} / span 1`,
            textAlign: side === 'right' ? 'left' : 'right',
            color: 'var(--ink-s)',
          }}>
          {full}
        </span>
      )}
    </>
  )
}
