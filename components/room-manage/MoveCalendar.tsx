'use client'

// 입퇴실 캘린더 — 여러 달을 이어 붙인 하나의 연속 간트. 하루는 24px 고정이고 트랙이 가로로 스크롤된다.
//
// 조립·판정은 lib/moveCalendar 정본이 서버에서 끝낸다. 이 파일은 그 결과를 배치할 뿐이고
// 겹침·충돌을 다시 세지 않는다 — 화면이 사본을 들면 감지망이 사고라 부르는 상태와 갈린다.
//
// **편성은 하나다**(운영자 2026-08-17 "횡스크롤이 가능하다면 모바일에서도 카드타입을 안 해도 되지 않나").
// 종전에는 768px 미만을 날짜순 리스트로 갈라 그렸는데, 트랙 자체가 가로로 흐르게 되자 좁은 폭은
// 같은 트랙을 좁은 창으로 보는 것으로 족해졌다. 두 편성이 사라지면서 "같은 방이 두 화면에서 다른
// 날짜로 뜬다"는 위험도 함께 사라진다. 리스트가 답하던 '다음 일정' 질문은 위의 고정 요약 줄이 받는다.
//
// 스크롤은 두 축이 공존해야 한다 — 트랙은 가로로만 진짜 스크롤러이므로 overscroll 제어도 X 축에만
// 건다. 두 축에 걸면 세로로는 넘칠 일이 없는 '가짜 스크롤러'가 되어 Android Blink 가 터치를 래치하고
// 페이지 세로 스크롤이 먹통이 된다(knowledge/mobile-scroll-viewport, 신고 d8554128).

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEntityModal } from '@/components/entity-modal/EntityModal'
import { Btn } from '@/components/ui/Btn'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { StatusBadge, type BadgeTone } from '@/components/ui/StatusBadge'
import { acknowledgeOverlap, releaseOverlapAck } from '@/app/(app)/room-manage/actions'
import { withSave } from '@/lib/saveStatus'
import { fmtRoomNo } from '@/lib/roomNo'
import { fmtMD } from '@/lib/fmtDate'
import { UPCOMING_DAYS, shiftMonth, type MoveBar, type MoveCalendarRange, type MoveCalendarRow, type MoveConflict, type MoveDaySpan, type MoveEvent, type MoveGap, type MoveRangeMonth } from '@/lib/moveCalendar'

/** 호실 열 폭. sticky 로 붙어 있어 가로 스크롤 중에도 어느 방인지 안 잃는다(§23). */
const ROOM_COL = 66
/**
 * 하루의 고정 폭. 월 페이지에서는 한 달이 폭에 맞게 늘어났지만, 연속 트랙에서는 달마다 폭이
 * 달라지면 같은 하루가 자리마다 다른 크기가 된다. 24px 이면 기본 뷰포트에 서너 주가 들어오고
 * 320px 좁은 폭에서도 열흘 남짓이 남는다.
 */
const DAY_W = 24
/** 캡션 'N일 공실'을 세울 최소 폭. 이보다 좁으면 공백은 색 없는 빈 자리로만 말한다. */
const GAP_CAPTION_MIN = 40
/** 고정 요약 줄에 세울 최대 건수. 넘치면 '외 N건'으로 접는다(방 많은 영업장에서 벽이 되지 않게). */
const UPCOMING_MAX = 8

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

/** 막대 모서리 — 범위 밖으로 이어지는 쪽은 직각, 트랙 안에서 끝나는 쪽만 둥글다. */
function barRadius(bar: MoveBar): string {
  const l = bar.clippedStart ? '0' : 'var(--radius-xs)'
  const r = bar.clippedEnd ? '0' : 'var(--radius-xs)'
  return `${l} ${r} ${r} ${l}`
}

/** 한 변동의 뱃지 톤·라벨 — 트랙의 막대 색과 같은 축이다. */
function eventTone(e: MoveEvent): { tone: BadgeTone; label: string } {
  return e.type === 'out' ? { tone: 'exit', label: '퇴실' }
    : e.kind === 'reserved' ? { tone: 'await', label: '입실 예약' }
      : { tone: 'movein', label: '입실' }
}

export function MoveCalendar({ data }: { data: MoveCalendarRange }) {
  const entityModal = useEntityModal()
  const router = useRouter()
  const searchParams = useSearchParams()
  const scrollRef = useRef<HTMLDivElement>(null)
  /** 마지막으로 내려앉은 달. null 이면 아직 첫 착지 전이다. */
  const landedRef = useRef<string | null>(null)
  const [todayOff, setTodayOff] = useState(false)
  const days = data.days
  const todayDay = data.todayDay

  const openLease = (roomId: string, leaseId: string, tenantId: string) =>
    entityModal.open({ kind: 'room', roomId, leaseTermId: leaseId, tenantId })

  /** 그 달로 다시 조회해 착지한다 — 범위 밖이면 서버가 범위를 그쪽으로 넓힌다. */
  const jumpToMonth = (month: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('month', month)
    router.push(`?${params.toString()}`)
  }

  /** 오늘의 왼쪽 좌표(px). 오늘이 범위 밖이면 null. */
  const todayX = todayDay != null ? (todayDay - 1) * DAY_W : null

  // 착지 — 오늘을 뷰포트 왼쪽 1/4 에 둔다. 보고 있는 달이 오늘의 달이 아니면(딥링크·점프)
  // 그 달 1일을 호실 열 바로 오른쪽에 세운다. 애니메이션 없이 즉시 — 첫 페인트가 흐르면 위치를 착각한다.
  //
  // 첫 마운트뿐 아니라 **보고 있는 달이 바뀔 때마다** 다시 내려앉는다. 종전에는 마운트 한 번으로
  // 끝나서 월 셀렉터로 9월을 골라도 트랙이 그 자리에 서 있었다(운영자 신고 2026-08-18).
  //
  // 반응하는 것은 URL 이 아니라 **서버가 준 focusMonth** 다. 아래 syncPosition 이 스크롤을 따라
  // history.replaceState 로 적는 ?month= 는 라우터 상태만 바꾸고 서버 컴포넌트를 다시 돌리지 않아
  // 이 prop 을 못 건드린다(Next 문서: replaceState 는 usePathname·useSearchParams 와만 동기화).
  // 즉 스크롤이 만든 월 변경은 여기 안 닿는다 — 스크롤이 착지를 부르고 착지가 다시 스크롤을 부르는
  // 피드백 루프가 애초에 성립하지 않는다. 셀렉터 점프·홈 딥링크만 router.push 라 여기에 닿는다.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || landedRef.current === data.focusMonth) return
    landedRef.current = data.focusMonth
    const focus = data.months.find(m => m.month === data.focusMonth)
    const focusHasToday = !!focus && todayDay != null
      && todayDay >= focus.startDay && todayDay < focus.startDay + focus.days
    el.scrollLeft = focusHasToday && todayX != null
      ? Math.max(0, todayX - Math.max(0, el.clientWidth - ROOM_COL) / 4)
      : focus ? (focus.startDay - 1) * DAY_W : 0
  }, [data.months, data.focusMonth, todayDay, todayX])

  // 스크롤 추적 — ① '오늘로' 버튼을 띄울지 ② 보고 있는 달을 URL 에 적을지.
  //
  // URL 갱신은 반드시 history.replaceState 다. router.replace 는 서버 왕복을 다시 돌고,
  // push 였다면 스크롤 한 번에 히스토리가 수십 칸 쌓여 뒤로가기가 못 쓰게 된다. 네이티브
  // history API 는 Next 라우터에 연결돼 있어 useSearchParams 를 구독한 월 셀렉터가 따라온다.
  const syncPosition = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const view = Math.max(0, el.clientWidth - ROOM_COL)
    setTodayOff(todayX == null ? false : todayX < el.scrollLeft || todayX > el.scrollLeft + view)

    // 판정 지점은 왼쪽 끝이 아니라 뷰포트의 1/4 — 착지 규칙(오늘을 1/4 에)과 같은 자를 써야
    // 방금 내려앉은 자리에서 곧바로 옆 달로 적히지 않는다.
    const leftDay = Math.floor((el.scrollLeft + view / 4) / DAY_W) + 1
    const m = data.months.find(mm => leftDay >= mm.startDay && leftDay < mm.startDay + mm.days)
    if (!m) return
    // 착지 기준점을 손으로 끈 자리로 옮긴다 — 이 ref 는 '지금 트랙이 보고 있는 달'이어야
    // 셀렉터가 그 달에서 한 칸 물러설 때(9월까지 끌고 와서 ◀ → 8월) 착지가 다시 걸린다.
    landedRef.current = m.month
    const url = new URL(window.location.href)
    if (url.searchParams.get('month') === m.month) return
    url.searchParams.set('month', m.month)
    window.history.replaceState(window.history.state, '', url)
  }, [data.months, todayX])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const onScroll = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(syncPosition, 180)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => { el.removeEventListener('scroll', onScroll); if (timer) clearTimeout(timer) }
  }, [syncPosition])

  const scrollToToday = () => {
    const el = scrollRef.current
    if (!el || todayX == null) return
    el.scrollLeft = Math.max(0, todayX - Math.max(0, el.clientWidth - ROOM_COL) / 4)
    setTodayOff(false)
  }

  const cols = `${ROOM_COL}px repeat(${days}, ${DAY_W}px)`
  const trackW = ROOM_COL + days * DAY_W
  // 월 경계선을 그을 자리 — 첫 달은 트랙의 시작이라 선이 없다.
  const monthStarts = data.months.slice(1).map(m => m.startDay)
  const monthStartSet = new Set(monthStarts)
  // 눈금에 적을 '그 달 며칠' — 범위 첫날부터 하루씩 더해 UTC 게터로 뽑는다(실행 환경 시간대 무관).
  const dayNums = Array.from({ length: days }, (_, i) =>
    new Date(Date.parse(`${data.from}T00:00:00Z`) + i * 86400000).getUTCDate())
  const beyond = data.beyond

  return (
    <div className="space-y-3">
      {/* ── 다가오는 입퇴실 ── 스크롤 0 에서 '다음에 뭐가 있나'에 답하는 줄. 트랙은 넓고 이 질문은
          매일 있다 — 좁은 폭에서 리스트 편성을 걷어낸 자리를 이 줄이 받는다. */}
      <UpcomingRow items={data.upcoming} onOpen={openLease} />

      {/* 충돌 요약 — §18 Status Row(좌 3px 팁 + danger-bg). 충돌이 없으면 이 줄 자체가 없다. */}
      {data.conflicts.length > 0 && (
        <div className="space-y-1.5">
          {data.conflicts.map((c, i) => (
            <ConflictRow key={`${c.leaseId}-${c.kind}-${i}`} c={c} onOpen={openLease} onDone={() => router.refresh()} />
          ))}
        </div>
      )}

      {data.rows.length === 0 ? (
        <EmptyState
          title="이 기간에 입퇴실 변동이 없습니다"
          description="입주·퇴실·입실 예약이 잡히면 이 달력에 나타납니다."
        />
      ) : (
        /* 카드 셸은 §24(cream · border · r-xl · 그림자 없음). relative — '오늘로'가 이 안에 뜬다. */
        <div className="relative rounded-xl overflow-hidden" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <div ref={scrollRef} className="overflow-x-auto" style={{ overscrollBehaviorX: 'contain' }}>
            <div className="move-track" style={{ width: trackW }}>

              {/* 눈금 두 줄 — 위는 월 밴드, 아래는 날짜. 호실 열이 둘을 가로질러 sticky 로 선다. */}
              <div className="grid" style={{ gridTemplateColumns: cols, gridTemplateRows: 'auto auto', borderBottom: '1px solid var(--warm-border)' }}>
                <div className="sticky left-0 z-30 flex items-end px-2 pb-1.5 text-[0.65625rem] font-bold uppercase"
                  style={{ gridColumn: '1 / 2', gridRow: '1 / 3', background: 'var(--cream)', color: 'var(--ink-m)' }}>호실</div>

                {data.months.map(m => (
                  <MonthLabel key={m.month} m={m} />
                ))}

                {/* '오늘' — 월 라벨과 겹치는 자리에서는 오늘이 이긴다(z-20 · 불투명). */}
                {todayDay != null && (
                  <span className="z-20 self-center justify-self-start whitespace-nowrap rounded-full px-1.5 py-0.5 text-[0.625rem] font-bold leading-none"
                    style={{ gridColumn: `${todayDay + 1} / span 1`, gridRow: '1 / 2', background: 'var(--coral)', color: 'var(--on-solid)' }}>
                    오늘
                  </span>
                )}

                {/* 날짜 — 달이 바뀌는 칸에는 왼쪽 경계선이 선다. */}
                {dayNums.map((n, i) => (
                  <div key={i} className="py-1.5 flex justify-center"
                    style={{ gridColumn: `${i + 2} / span 1`, gridRow: '2 / 3', borderLeft: monthStartSet.has(i + 1) ? '1px solid var(--warm-border)' : undefined }}>
                    <span className="inline-flex items-center justify-center tnum text-[0.65625rem] leading-none"
                      style={i + 1 === todayDay
                        ? { width: 17, height: 17, borderRadius: 9999, background: 'var(--coral)', color: 'var(--on-solid)', fontWeight: 700 }
                        : { color: 'var(--ink-m)' }}>{n}</span>
                  </div>
                ))}
              </div>

              {data.rows.map((row, ri) => (
                <GanttRow key={row.roomId} row={row} days={days} cols={cols}
                  todayDay={todayDay} monthStarts={monthStarts} first={ri === 0} onOpen={openLease} />
              ))}
            </div>
          </div>

          {/* 오늘이 화면 밖일 때만 — 넓은 트랙에서 '지금'을 잃지 않게 하는 유일한 상시 손잡이. */}
          {todayOff && (
            <button type="button" onClick={scrollToToday}
              className="absolute bottom-2.5 right-2.5 z-40 min-h-[44px] inline-flex items-center rounded-full px-3.5 text-xs font-bold shadow-lift transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--coral)]"
              style={{ background: 'var(--persimmon)', color: 'var(--on-solid)' }}>
              오늘로
            </button>
          )}
        </div>
      )}

      {/* ── 트랙의 양 끝 ── 범위 밖의 사실과 그리로 가는 길. 트랙 끝에 붙이면 수천 px 을 끌어야
          닿으므로 카드 밖 한 줄로 세운다(320px 에서도 손이 닿는 자리다). */}
      {(data.canExtendPast || beyond) && (
        <div className="flex flex-wrap items-center gap-2">
          {data.canExtendPast && (
            <Btn variant="ghost" size="sm" onClick={() => jumpToMonth(shiftMonth(data.months[0].month, -1))}>
              이전 달 더 보기
            </Btn>
          )}
          {beyond && (
            <div className="ml-auto flex items-center gap-2">
              <p className="text-xs tnum" style={{ color: 'var(--ink-m)' }}>
                이후 예정 {beyond.count}건 · 최초 {fmtMD(beyond.firstDate)}
              </p>
              <Btn variant="ghost" size="sm" onClick={() => jumpToMonth(beyond.firstDate.slice(0, 7))}>
                그때로 이동
              </Btn>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 충돌 요약 한 줄 — §18 Status Row. 톤이 둘이다.
 *
 * 아직 답하지 않은 충돌은 종전대로 코랄 팁 + danger 다. **확인된 겹침**은 중립으로 내려간다
 * (팁 --ink-m · --neutral-bg · 글자 --ink-s) — 사실은 그대로인데 운영자가 이미 답한 자리라
 * 매일 같은 빨강으로 부르면 그 빨강이 아무것도 뜻하지 않게 된다.
 *
 * 줄 자체는 확인 뒤에도 지우지 않는다(설계 확정 2026-08-19). 사라지면 [확인 해제] 로 가는 길이
 * 없어지고, 한 방에 두 사람이 있다는 사실 표시도 함께 사라진다.
 */
function ConflictRow({ c, onOpen, onDone }: {
  c: MoveConflict
  onOpen: (roomId: string, leaseId: string, tenantId: string) => void
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const tone = c.acked
    ? { tip: 'var(--ink-m)', bg: 'var(--neutral-bg)', fg: 'var(--ink-s)' }
    : { tip: 'var(--coral)', bg: 'var(--danger-bg)', fg: 'var(--danger-fg)' }

  const ack = async () => {
    if (!c.pair) return
    const ok = await confirmDialog({
      title: `${fmtRoomNo(c.roomNo)} 겹침을 확인 처리할까요`,
      message: `${c.text} 의도된 겹침이면 확인 처리합니다. 확인된 겹침은 중립 표시되고 정합 검사에서 제외됩니다.`,
      level: 'caution',
      confirmLabel: '의도된 겹침으로 확인',
      cancelLabel: '취소',
    })
    if (!ok) return
    setBusy(true)
    try {
      const res = await withSave(() => acknowledgeOverlap(c.pair!.frontLeaseTermId, c.pair!.backLeaseTermId), { success: '겹침 확인됨' })
      if (res.ok) onDone()
    } finally { setBusy(false) }
  }

  const release = async () => {
    if (!c.ackId) return
    setBusy(true)
    try {
      const res = await withSave(() => releaseOverlapAck(c.ackId!), { success: '확인 해제됨' })
      if (res.ok) onDone()
    } finally { setBusy(false) }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border-l-[3px] px-3.5 py-2.5"
      style={{ borderLeftColor: tone.tip, background: tone.bg }}>
      <p className="min-w-0 flex-1 basis-40 text-xs font-medium" style={{ color: tone.fg }}>{c.text}</p>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {/* 확인은 겹침(overlap)에만 붙는다 — 무기한은 퇴실일을 넣으라는 처방이고 역전은 데이터 사고다. */}
        {c.kind === 'overlap' && !c.acked && c.pair && (
          <ConflictBtn onClick={ack} busy={busy} acked={false}>겹침 확인</ConflictBtn>
        )}
        {c.acked && c.ackId && (
          <ConflictBtn onClick={release} busy={busy} acked>확인 해제</ConflictBtn>
        )}
        <ConflictBtn onClick={() => onOpen(c.roomId, c.leaseId, c.tenantId)} busy={false} acked={c.acked}>계약 보기</ConflictBtn>
      </div>
    </div>
  )
}

/** 요약 줄의 보조 액션 — 줄 톤을 따라간다(확인된 줄에서 혼자 빨강으로 남으면 중립이 깨진다). */
function ConflictBtn({ onClick, busy, acked, children }: {
  onClick: () => void
  busy: boolean
  acked: boolean
  children: React.ReactNode
}) {
  return (
    <button type="button" onClick={onClick} disabled={busy}
      className={`min-h-[44px] inline-flex items-center whitespace-nowrap text-[0.6875rem] font-semibold px-2.5 rounded-md border transition-colors disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--coral)] ${acked ? 'hover:bg-[var(--cream-soft)]' : 'hover:bg-[var(--coral)]/10'}`}
      style={acked
        ? { borderColor: 'var(--warm-border)', color: 'var(--ink-2)' }
        : { borderColor: 'color-mix(in srgb, var(--coral) 45%, transparent)', color: 'var(--tc-text)' }}>
      {children}
    </button>
  )
}

/**
 * 월 밴드의 한 칸 — 라벨은 그 달 안에서 sticky 라, 달 중간을 보고 있어도 어느 달인지 안 잃는다.
 * sticky 요소는 자기 칸(그리드 셀) 안에 갇히므로 다음 달로 넘어가면 라벨도 함께 밀려 나간다.
 */
function MonthLabel({ m }: { m: MoveRangeMonth }) {
  return (
    <div className="min-w-0 py-1"
      style={{ gridColumn: `${m.startDay + 1} / ${m.startDay + m.days + 1}`, gridRow: '1 / 2', borderLeft: m.startDay === 1 ? undefined : '1px solid var(--warm-border)' }}>
      <span className="sticky z-10 inline-flex items-baseline gap-1.5 whitespace-nowrap px-2 text-[0.6875rem] leading-none"
        style={{ left: ROOM_COL, background: 'var(--cream)' }}>
        <span className="font-bold" style={{ color: 'var(--ink-2)' }}>{Number(m.month.slice(5, 7))}월</span>
        {/* 빈 달을 말없이 두면 고장으로 읽힌다 — 비어 있는 것이 사실이라고 옅게 적어 둔다. */}
        {m.eventCount === 0 && <span style={{ color: 'var(--ink-m)' }}>변동 없음</span>}
      </span>
    </div>
  )
}

/** 고정 요약 줄 — 오늘부터 UPCOMING_DAYS 일 안의 변동. 항목은 그대로 계약으로 들어간다. */
function UpcomingRow({ items, onOpen }: {
  items: MoveEvent[]
  onOpen: (roomId: string, leaseId: string, tenantId: string) => void
}) {
  const shown = items.slice(0, UPCOMING_MAX)
  const rest = items.length - shown.length
  return (
    <div className="rounded-xl px-3.5 py-2.5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <p className="shrink-0 text-[0.65625rem] font-bold uppercase" style={{ color: 'var(--ink-m)' }}>
          다가오는 {UPCOMING_DAYS}일
        </p>
        {items.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--ink-s)' }}>예정된 입퇴실이 없습니다.</p>
        ) : (
          <>
            {shown.map(e => {
              const { tone, label } = eventTone(e)
              return (
                <button key={`${e.leaseId}-${e.type}`} type="button"
                  onClick={() => onOpen(e.roomId, e.leaseId, e.tenantId)}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-1.5 text-xs transition-colors hover:bg-[var(--cream-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--coral)]">
                  <span className="tnum font-semibold" style={{ color: 'var(--ink-2)' }}>{fmtMD(e.date)}</span>
                  <span className="tnum" style={{ color: 'var(--ink-2)' }}>{fmtRoomNo(e.roomNo)}</span>
                  <StatusBadge tone={tone}>{label}</StatusBadge>
                  <span style={{ color: 'var(--ink-s)' }}>{e.tenantName}</span>
                </button>
              )
            })}
            {rest > 0 && <p className="text-xs tnum" style={{ color: 'var(--ink-m)' }}>외 {rest}건</p>}
          </>
        )}
      </div>
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

function place(bar: MoveBar, row: MoveCalendarRow, days: number): Placed {
  const full = `${bar.tenantName} · ${bar.label}`
  const px = (bar.endDay - bar.startDay + 1) * DAY_W
  const fits: Placed['mode'] = px >= estWidth(full) + 16 ? 'full'
    : px >= estWidth(bar.tenantName) + 16 ? 'name' : 'outside'
  const bare: Placed = { bar, full, mode: fits, side: null, ink: null }
  if (fits !== 'outside') return bare

  // 같은 층에서 다음 막대가 시작하는 날 — 바 밖 라벨이 그 위로 넘어가지 않게 끊는 자리.
  const next = row.bars.filter(b => b.lane === bar.lane && b.startDay > bar.endDay)
    .reduce((m, b) => Math.min(m, b.startDay), days + 1)
  const needDays = Math.max(1, Math.ceil((estWidth(full) + 8) / DAY_W))
  if (bar.endDay < days && next > bar.endDay + 1) {
    const limit = Math.min(next - 1, days)
    return { ...bare, side: 'right', ink: { startDay: bar.endDay + 1, endDay: Math.min(bar.endDay + needDays, limit) } }
  }
  if (bar.startDay > 1) {
    return { ...bare, side: 'left', ink: { startDay: Math.max(1, bar.startDay - needDays), endDay: bar.startDay - 1 } }
  }
  // 양옆이 다 막힌 자리 — 잘린 이름이라도 바 안에 둔다(아무것도 없는 것보다는 낫다).
  return { ...bare, mode: 'name' }
}

function GanttRow({ row, days, cols, todayDay, monthStarts, first, onOpen }: {
  row: MoveCalendarRow
  days: number
  cols: string
  todayDay: number | null
  monthStarts: number[]
  first: boolean
  onOpen: (roomId: string, leaseId: string, tenantId: string) => void
}) {
  // 좌측 코랄 팁은 **아직 답하지 않은** 충돌에만. 확인된 겹침만 남은 행은 팁을 끈다(중립).
  const attn = row.conflicts.some(c => !c.acked)
  const placed = row.bars.map(bar => place(bar, row, days))
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
    return (best.endDay - best.startDay + 1) * DAY_W >= GAP_CAPTION_MIN ? best : null
  }

  return (
    <div>
      <div className="mc-row grid" style={{
        gridTemplateColumns: cols,
        gridTemplateRows: `repeat(${row.laneCount}, var(--mc-lane))`,
        borderTop: first ? 'none' : '1px solid var(--warm-border)',
      }}>
        {/* 호실 열 — sticky(§23). 충돌 행은 좌 3px 코랄 팁(§18 .attn). */}
        <div className="mc-room sticky left-0 z-20 flex items-center px-2 tnum text-xs font-bold"
          style={{
            gridColumn: '1 / 2', gridRow: '1 / -1',
            background: 'var(--cream)', color: 'var(--ink-2)',
            borderLeft: `3px solid ${attn ? 'var(--coral)' : 'transparent'}`,
          }}>
          {fmtRoomNo(row.roomNo)}
        </div>

        {/* 월 경계 — 트랙을 가로지르는 옅은 세로선. 오늘 선(--tc-text)보다 약해야 둘이 안 헷갈린다. */}
        {monthStarts.map(d => (
          <div key={`mb-${d}`} aria-hidden className="pointer-events-none"
            style={{ gridColumn: `${d + 1} / span 1`, gridRow: '1 / -1', width: 1, justifySelf: 'start', background: 'var(--warm-border)' }} />
        ))}

        {/* 공백 캡션 — 바 밖 라벨을 피해 남은 자리에, 폭이 나올 때만. 색은 없다(트랙 그대로).
            글자는 그 구간 안에서 sticky 라 긴 공백을 반쯤 지나가도 캡션이 화면에 남는다. */}
        {row.gaps.map(g => {
          const span = captionSpan(g)
          return span && (
            <div key={`gap-${g.startDay}`} className="flex items-center justify-center pointer-events-none"
              style={{ gridColumn: `${span.startDay + 1} / ${span.endDay + 2}`, gridRow: '1 / 2' }}>
              <span className="sticky whitespace-nowrap text-[0.65625rem] tnum" style={{ left: ROOM_COL, color: 'var(--ink-m)' }}>
                {g.days}일 공실
              </span>
            </div>
          )
        })}

        {/* 막대 */}
        {placed.map(p => (
          <Bar key={p.bar.leaseId} p={p} onOpen={() => onOpen(row.roomId, p.bar.leaseId, p.bar.tenantId)} />
        ))}

        {/* 겹친 구간 — 막대 위에 얹는다. 반투명이라 아래 막대가 비치고, 그 위 글자는 --ink-2 다(§03).
            확인된 겹침은 중립 밴드다. 여기 쓸 수 있는 것은 **반투명** 토큰뿐이라(--band-vacant-bg 는
            불투명이라 아래 막대를 덮어 버린다) 중립 계열의 --neutral-ring 을 표면으로 쓴다. */}
        {row.overlaps.map(s => (
          <div key={`ov-${s.startDay}`} aria-hidden className="pointer-events-none"
            style={{
              gridColumn: `${s.startDay + 1} / ${s.endDay + 2}`, gridRow: '1 / -1',
              background: s.acked ? 'var(--neutral-ring)' : 'var(--band-overdue-bg)',
              borderRadius: 'var(--radius-xs)',
            }} />
        ))}

        {/* 오늘 — 트랙을 가로지르는 세로 1px. 오늘이 범위 밖이면 아예 없다. */}
        {todayDay != null && (
          <div aria-hidden className="pointer-events-none"
            style={{ gridColumn: `${todayDay + 1} / span 1`, gridRow: '1 / -1', width: 1, justifySelf: 'start', background: 'var(--tc-text)' }} />
        )}
      </div>

      {/* 꼬리 — 트랙 밖의 사실을 한 줄로. 그 예약이 범위 안에 들어오면 막대가 말하므로 이 줄은 없다. */}
      {row.tail && (
        <div className="grid" style={{ gridTemplateColumns: cols }}>
          <div className="mc-room sticky left-0 z-20" style={{ gridColumn: '1 / 2', background: 'var(--cream)' }} />
          <p className="min-w-0 pb-1.5 text-[0.65625rem]" style={{ gridColumn: `2 / -1`, color: 'var(--ink-m)' }}>
            <span className="sticky inline-block max-w-full truncate pl-1.5" style={{ left: ROOM_COL }}>{row.tail}</span>
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
      {/* 이 버튼에 overflow-hidden 을 걸면 안 된다 — 그 순간 버튼 자신이 스크롤 컨테이너가 되어
          안의 sticky 이름이 트랙이 아니라 버튼에 붙고, 트랙을 끌어도 따라오지 않는다(실측에서
          한 번 걸렸다). 넘침은 안쪽 span 의 truncate 가 자기 상자에서 막는다. */}
      <button type="button" onClick={onOpen} title={full}
        className="min-w-0 self-center flex items-center text-[0.6875rem] font-semibold transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--coral)]"
        style={{
          gridColumn: `${bar.startDay + 1} / ${bar.endDay + 2}`,
          gridRow: `${bar.lane + 1} / span 1`,
          height: 'calc(var(--mc-lane) - 12px)',
          background: tone.bg,
          // 겹친 구간의 짙은 밴드가 위에 얹히므로 충돌 막대의 글자는 중립 잉크로 둔다(§03).
          color: bar.conflicted ? 'var(--ink-2)' : tone.fg,
          borderRadius: barRadius(bar),
        }}>
        {/* 이름은 막대 안에서 sticky 다. 연속 트랙에서는 한 막대가 화면보다 넓은 일이 흔한데,
            글자를 막대 왼쪽 끝에 붙여 두면 그 막대가 화면을 가득 채운 순간 **이름 없는 색 띠**가
            된다(390px 에서 열일곱 행 중 열 행이 그랬다). 막대 안에 갇히므로 옆 막대는 안 침범한다. */}
        <span className="sticky min-w-0 max-w-full truncate px-2" style={{ left: ROOM_COL }}>
          {mode === 'full' ? full : mode === 'name' ? bar.tenantName : ''}
        </span>
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
