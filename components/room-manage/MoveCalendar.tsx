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

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useEntityModal } from '@/components/entity-modal/EntityModal'
import { Btn } from '@/components/ui/Btn'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { StatusBadge, type BadgeTone } from '@/components/ui/StatusBadge'
import { acknowledgeOverlap, releaseOverlapAck } from '@/app/(app)/room-manage/actions'
import { withSave } from '@/lib/saveStatus'
import { fmtRoomNo, roomNoWithRo } from '@/lib/roomNo'
import { fmtDateDot, fmtDateKor, fmtMD } from '@/lib/fmtDate'
import { TRACK_MONTH_KEY } from '@/lib/monthParam'
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

/**
 * 막대 표면 — §03 밴드 티어 두 종. 표면 하나가 상태를 혼자 말하는 자리라 알파가 낮은
 * 배지·행 틴트가 아니라 이 티어를 쓴다(홈 방 현황 격자와 같은 이유).
 *
 * 거주가 올리브인 이유. 종전에는 카멜(--badge-exit-*)이었는데 그 토큰은 v2.0 미등재 v1.1 잔재이고,
 * 무엇보다 **거주를 '퇴실 예정' 색으로 칠하는 것**이었다. 거주를 색으로 말하는 형제 여덟 자리가
 * 전부 올리브다(호실 카드·입주자 카드·표 좌측 팁·홈 방 현황). 대비도 이쪽이 낫다 — 거주 대 예약의
 * 명도차 ΔL* 가 1.7 에서 8.7 로 벌어져 색상 축이 무너지는 색각에서도 두 막대가 갈린다.
 *
 * 글자는 둘 다 --ink-2 다(§03 "밴드 위 글자는 다섯 종 모두 --ink-2"). 라이트 8.00:1 · 다크 7.25:1.
 */
function barTone(bar: MoveBar): string {
  return bar.kind === 'reserved' ? 'var(--band-await-bg)' : 'var(--band-paid-bg)'
}

/**
 * 막대 하나를 소리로 읽는 문장 — 색이 지고 있던 정보(거주냐 예약이냐)를 말로 옮긴다.
 *
 * 날짜 뒤에 조사를 붙이지 않는다. fmtDateKor 은 요일을 괄호로 달아서, '…(수)부터' 로 이으면
 * 읽는 소리가 "일 괄호 수 부터" 가 된다. 짧은 문장 여럿으로 끊는 편이 낫다.
 * 이사 문구의 '로'는 정본(roomNoWithRo)이 고른다 — 여기서 조사를 다시 고르면 사본이 된다.
 */
function barAria(bar: MoveBar, roomNo: string): string {
  const what = bar.kind === 'reserved' ? '입실 예약' : '거주'
  const start = bar.stayFrom ? `시작 ${fmtDateKor(bar.stayFrom)}.` : '시작일 미상.'
  const end = bar.stayTo ? `종료 ${fmtDateKor(bar.stayTo)}.` : '퇴실일 미정.'
  const moved = bar.movedFromRoomNo ? ` ${fmtRoomNo(bar.movedFromRoomNo)}에서 이사.`
    : bar.movedToRoomNo ? ` ${roomNoWithRo(bar.movedToRoomNo)} 이사.` : ''
  return `${fmtRoomNo(roomNo)} ${bar.tenantName} ${what}. ${start} ${end}${moved}${bar.conflicted ? ' 다른 계약과 겹칩니다.' : ''}`
}

/** 막대 모서리 — 범위 밖으로 이어지는 쪽은 직각, 트랙 안에서 끝나는 쪽만 둥글다. */
function barRadius(bar: MoveBar): string {
  const l = bar.clippedStart ? '0' : 'var(--radius-xs)'
  const r = bar.clippedEnd ? '0' : 'var(--radius-xs)'
  return `${l} ${r} ${r} ${l}`
}

/**
 * 한 변동의 뱃지 톤·라벨 — 트랙의 막대 색과 같은 축이다.
 *
 * 이사가 맨 앞이다. 방을 옮긴 날을 '퇴실'이라 부르면 이 줄을 읽은 운영자가 그 방을 광고에
 * 올린다 — 오독의 대가가 실제 영업이다. 톤은 중립(info) 이다. 이사는 사고도 예정도 아닌
 * 사실이고, exit·movein 은 둘 다 카멜이라 눈으로도 안 갈린다.
 *
 * 판정은 조립이 끝냈다(MoveEvent.moved). 화면이 'leaseId 가 같고 날짜가 같은 out·in 쌍'을
 * 다시 세면 그 사본이 곧 두 번째 진실이 된다.
 */
function eventTone(e: MoveEvent): { tone: BadgeTone; label: string } {
  return e.moved ? { tone: 'info', label: '이사' }
    : e.type === 'out' ? { tone: 'exit', label: '퇴실' }
      : e.kind === 'reserved' ? { tone: 'await', label: '입실 예약' }
        : { tone: 'movein', label: '입실' }
}

function MoveCalendarView({ data, onViewMonthChange }: {
  data: MoveCalendarRange
  /** 트랙이 내려앉은·멎은 달을 위로 알린다. 탭 접미 N 이 이 값을 딛는다(서버 왕복 없음). */
  onViewMonthChange?: (month: string) => void
}) {
  const entityModal = useEntityModal()
  const router = useRouter()
  const scrollRef = useRef<HTMLDivElement>(null)
  /** '오늘로' 버튼 — 표시를 DOM 에 직접 쓴다(아래 paintToday 주석). */
  const todayBtnRef = useRef<HTMLButtonElement>(null)
  /** 마지막으로 내려앉은 달. null 이면 아직 첫 착지 전이다. */
  const landedRef = useRef<string | null>(null)
  /** 마지막으로 내려앉은 창의 첫날. 창이 미끄러지면 좌표계가 통째로 바뀌므로 다시 앉아야 한다. */
  const landedFromRef = useRef<string | null>(null)
  /** 착지가 만든 스크롤 위치. 여기서 한 픽셀도 안 움직였으면 URL 에 적지 않는다. */
  const landedLeftRef = useRef<number | null>(null)
  const days = data.days
  const todayDay = data.todayDay

  const openLease = (roomId: string, leaseId: string, tenantId: string) =>
    entityModal.open({ kind: 'room', roomId, leaseTermId: leaseId, tenantId })

  /**
   * 그 달로 다시 조회해 착지한다 — 범위 밖이면 서버가 창을 그쪽으로 미끄러뜨린다.
   *
   * 파라미터는 **발화 시점의 실제 URL** 에서 다시 읽는다. useSearchParams 스냅샷을 쓰면
   * 스크롤이 방금 적어 둔 트랙 위치를 지운다. 훅을 안 부르는 덕에 이 컴포넌트가 memo 로 살아나
   * 다른 곳의 URL 변경이 트랙 수천 칸을 다시 그리지 않는다.
   */
  const jumpToMonth = (month: string) => {
    const params = new URLSearchParams(window.location.search)
    params.set(TRACK_MONTH_KEY, month)
    router.push(`?${params.toString()}`)
  }

  /** 오늘의 왼쪽 좌표(px). 오늘이 범위 밖이면 null. */
  const todayX = todayDay != null ? (todayDay - 1) * DAY_W : null

  /**
   * '오늘로' 버튼의 표시 — **React state 로 들지 않는다.**
   *
   * state 로 들면 스크롤이 멎을 때마다 트랙 전체(열일곱 행 × 수백 칸)가 다시 그려진다.
   * 이 값은 렌더 결과를 만들지 않고 노드 하나의 보임/숨김만 정하므로 DOM 에 직접 쓴다
   * (knowledge/mobile-scroll-viewport 의 '렌더에 안 쓰이는 뷰포트 값은 state 로 들지 않는다').
   *
   * 오늘이 범위 밖이면 스크롤로는 영영 닿을 수 없다 — 그때는 항상 세워 둔다. 종전에는 이 경우
   * 버튼이 아예 안 떠서 먼 달로 간 뒤 돌아올 길이 트랙 안에 없었다.
   */
  const paintToday = useCallback(() => {
    const btn = todayBtnRef.current
    if (!btn) return
    // display 를 직접 쓴다. hidden 속성은 UA 의 [hidden]{display:none} 이 작성자 스타일(inline-flex)에
    // 지므로 이 버튼에서는 안 먹는다. React 의 style 에도 display 를 같은 초깃값으로 두어,
    // 이후 리렌더에서 값이 안 바뀌면 React 가 이 자리를 건드리지 않는다.
    //
    // 오늘이 창 밖이면 트랙이 아예 없을 수도 있다(변동 없는 창은 카드 대신 빈 상태가 선다).
    // 그때가 바로 돌아올 길이 가장 필요한 자리라 스크롤러 존재와 무관하게 세운다.
    if (todayX == null) { btn.style.display = ''; return }
    const el = scrollRef.current
    if (!el) return
    const view = Math.max(0, el.clientWidth - ROOM_COL)
    btn.style.display = todayX < el.scrollLeft || todayX > el.scrollLeft + view ? '' : 'none'
  }, [todayX])

  // 착지 — 오늘을 뷰포트 왼쪽 1/4 에 둔다. 보고 있는 달이 오늘의 달이 아니면(딥링크·점프)
  // 그 달 1일을 호실 열 바로 오른쪽에 세운다. 애니메이션 없이 즉시 — 첫 페인트가 흐르면 위치를 착각한다.
  //
  // 첫 마운트뿐 아니라 **보고 있는 달이 바뀔 때마다** 다시 내려앉는다. 종전에는 마운트 한 번으로
  // 끝나서 월 셀렉터로 9월을 골라도 트랙이 그 자리에 서 있었다(운영자 신고 2026-08-18).
  // 창의 첫날(data.from)이 바뀔 때도 다시 앉는다 — 창이 미끄러지면 같은 달이라도 좌표가 달라진다.
  //
  // 반응하는 것은 URL 이 아니라 **서버가 준 focusMonth** 다. 아래 commitPosition 이 스크롤을 따라
  // 적는 것은 history.replaceState 라 라우터 상태만 바꾸고 서버 컴포넌트를 다시 돌리지 않는다
  // (restore-reducer 가 ACTION_RESTORE 로 기존 CacheNode 를 재사용하고 canonicalUrl 만 바꾼다 —
  // 네트워크 요청 0). 즉 스크롤이 만든 월 변경은 여기 안 닿는다 — 스크롤이 착지를 부르고 착지가
  // 다시 스크롤을 부르는 피드백 루프가 애초에 성립하지 않는다. 셀렉터 점프·홈 딥링크만 router.push 라
  // 여기에 닿고, 그때는 landedRef 가 이미 그 달이라 두 번 앉지 않는다.
  useLayoutEffect(() => {
    if (landedRef.current !== data.focusMonth || landedFromRef.current !== data.from) {
      landedRef.current = data.focusMonth
      landedFromRef.current = data.from
      onViewMonthChange?.(data.focusMonth)
      const el = scrollRef.current
      // 변동이 없는 창에서는 트랙 자체가 없다(카드 대신 빈 상태). 그래도 위의 '보고 있는 달'은
      // 알려야 탭 접미가 그 달을 말한다.
      if (el) {
        const focus = data.months.find(m => m.month === data.focusMonth)
        const focusHasToday = !!focus && todayDay != null
          && todayDay >= focus.startDay && todayDay < focus.startDay + focus.days
        el.scrollLeft = focusHasToday && todayX != null
          ? Math.max(0, todayX - Math.max(0, el.clientWidth - ROOM_COL) / 4)
          : focus ? (focus.startDay - 1) * DAY_W : 0
        // 브라우저가 clamp 한 **실제** 값을 되읽는다. 이 자리에서 한 픽셀도 안 움직였으면
        // 아래 commitPosition 이 URL 을 안 적는다 — 착지가 낸 스크롤 이벤트로 옆 달이 적히던 자리다.
        landedLeftRef.current = el.scrollLeft
      }
    }
    paintToday()
  }, [data.months, data.focusMonth, data.from, todayDay, todayX, paintToday, onViewMonthChange])

  /**
   * 스크롤이 멎었을 때 — 보고 있는 달을 URL 과 위(탭 접미)로 알린다.
   *
   * **첫 인자는 반드시 null 이다.** Next 는 window.history.replaceState 를 패치해 두는데
   * (app-router.js) 그 패치 첫 줄이 `if (data?.__NA || data?._N) return originalReplaceState(...)`
   * 이고, window.history.state 에는 라우터가 심어 둔 __NA 가 **항상** 들어 있다. 종전처럼
   * window.history.state 를 되먹이면 이 가드에 걸려 라우터 동기화를 통째로 건너뛰고 주소창만
   * 바뀐다 — 그래서 useSearchParams 를 구독한 월 셀렉터가 영영 못 들었다(운영자 신고 2026-08-20).
   * null 을 넘기면 copyNextJsInternalHistoryState 가 __NA 와 내부 트리를 알아서 복사하므로
   * 상태 손실이 없다(Next 공식 문서 Native History API 절의 예제도 전부 null 이다).
   *
   * router.replace 는 서버 왕복을 다시 돌고, push 였다면 스크롤 한 번에 히스토리가 수십 칸 쌓여
   * 뒤로가기가 못 쓰게 된다. 그래서 여전히 네이티브 replaceState 다.
   */
  const commitPosition = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    paintToday()
    // 착지 자리 그대로면 아직 아무도 손대지 않은 것이다.
    if (landedLeftRef.current != null && el.scrollLeft === landedLeftRef.current) return
    const view = Math.max(0, el.clientWidth - ROOM_COL)
    // 판정 지점은 왼쪽 끝이 아니라 뷰포트의 1/4 — 착지 규칙(오늘을 1/4 에)과 같은 자를 써야
    // 방금 내려앉은 자리에서 곧바로 옆 달로 적히지 않는다.
    // 단 트랙 오른쪽 끝에서는 스크롤이 clamp 돼 1/4 판정점이 마지막 달에 못 닿는다(넓은 화면에서
    // 산술로 확인: 245일 창·뷰포트 1130px 이면 마지막 달 착지가 직전 달로 판정된다). 끝에 닿았으면
    // 마지막 달로 확정한다.
    const atRightEnd = el.scrollLeft >= el.scrollWidth - el.clientWidth - 1
    const leftDay = Math.floor((el.scrollLeft + view / 4) / DAY_W) + 1
    const m = atRightEnd
      ? data.months[data.months.length - 1]
      : data.months.find(mm => leftDay >= mm.startDay && leftDay < mm.startDay + mm.days)
    if (!m) return
    // 착지 기준점을 손으로 끈 자리로 옮긴다 — 이 ref 는 '지금 트랙이 보고 있는 달'이어야
    // 셀렉터가 그 달에서 한 칸 물러설 때(9월까지 끌고 와서 ◀ → 8월) 착지가 다시 걸린다.
    landedRef.current = m.month
    onViewMonthChange?.(m.month)
    const url = new URL(window.location.href)
    if (url.searchParams.get(TRACK_MONTH_KEY) === m.month) return
    // 트랙 위치는 전용 키다. ?month= 는 홈에서 정당하게 실려 온 조회 장부 월이라 손대지 않는다
    // (lib/monthParam TRACK_MONTH_KEY). 어느 탭을 보고 있는지는 이 컴포넌트의 일이 아니다 —
    // 상위(RoomManageClient)가 ?tab= 을 소유한다.
    url.searchParams.set(TRACK_MONTH_KEY, m.month)
    window.history.replaceState(null, '', url)
  }, [data.months, paintToday, onViewMonthChange])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let raf: number | null = null
    let lastLeft = -1
    // 표시(‘오늘로’)는 rAF 로 즉시 따라간다 — 디바운스에 묶어 두면 관성으로 흐르는 내내
    // 버튼이 틀린 상태로 남는다. 스스로 재예약하는 루프라 scroll 발화에 공백이 있어도 이어진다.
    const tick = () => {
      const cur = scrollRef.current
      if (!cur) { raf = null; return }
      if (cur.scrollLeft !== lastLeft) { lastLeft = cur.scrollLeft; paintToday() }
      raf = requestAnimationFrame(tick)
    }
    const stopRaf = () => { if (raf != null) { cancelAnimationFrame(raf); raf = null } }
    const onScroll = () => {
      if (raf == null) { lastLeft = -1; raf = requestAnimationFrame(tick) }
      if (timer) clearTimeout(timer)
      // URL 쓰기는 종전대로 180ms 디바운스다. rAF 가 죽는 환경(일부 모바일 관성 구간)에서도
      // 이 타이머는 살아 있어 표시만 늦을 뿐 상태가 어긋나지 않는다.
      timer = setTimeout(() => { stopRaf(); commitPosition() }, 180)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => { el.removeEventListener('scroll', onScroll); if (timer) clearTimeout(timer); stopRaf() }
  }, [commitPosition, paintToday])

  /**
   * '오늘로' — 오늘이 트랙 안이면 그 자리로 스크롤하고, 창 밖이면 이번 달로 다시 조회한다.
   * 라벨을 가르지 않는 이유는 사용자의 뜻이 하나이기 때문이다("오늘로 데려다 줘"). 창 경계는
   * 보이지 않는 구현 사실이고, 두 경로의 종착지는 착지 규칙이 같아 문자 그대로 같은 자리다.
   */
  const goToday = () => {
    // 창 밖이면 스크롤로는 못 닿는다 — 다시 조회한다. 트랙이 아예 없는 창(변동 0)에서도 이 길이다.
    if (todayX == null) { jumpToMonth(data.today.slice(0, 7)); return }
    const el = scrollRef.current
    if (!el) return
    el.scrollLeft = Math.max(0, todayX - Math.max(0, el.clientWidth - ROOM_COL) / 4)
    paintToday()
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
      <UpcomingRow items={data.upcoming} todayInRange={todayDay != null} onOpen={openLease} />

      {/* 충돌 요약 — §18 Status Row(좌 3px 팁 + danger-bg). 충돌이 없으면 이 줄 자체가 없다. */}
      {data.conflicts.length > 0 && (
        <div className="space-y-1.5">
          {data.conflicts.map((c, i) => (
            <ConflictRow key={`${c.leaseId}-${c.kind}-${i}`} c={c} onOpen={openLease} onDone={() => router.refresh()} />
          ))}
        </div>
      )}

      {/* relative — '오늘로'가 이 안에 뜬다. 카드 **밖**에 두는 이유는, 변동이 없는 창(먼 달로
          점프하면 흔하다)에서는 카드 자체가 안 서서 버튼이 함께 사라지고 돌아올 길이 없어지기
          때문이다. 자리는 종전과 같다(카드 오른쪽 아래). */}
      <div className="relative">
      {data.rows.length === 0 ? (
        <EmptyState
          title="이 기간에 입퇴실 변동이 없습니다"
          description="입주·퇴실·입실 예약이 잡히면 이 달력에 나타납니다."
          // 트랙이 없는 창에서는 아래 부유 알약이 설명문 위에 앉는다(빈 상태 안쪽 여백 32px 대
          // 알약 윗변 54px = 세로 22px 겹침). 빈 상태의 CTA 자리가 곧 '여기서 나가는 길'이다(§17).
          action={todayX == null ? <Btn variant="primary" size="md" onClick={goToday}>오늘로</Btn> : undefined}
        />
      ) : (
        /* 카드 셸은 §24(cream · border · r-xl · 그림자 없음). */
        <div className="rounded-xl overflow-hidden" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          {/* 범례 — 거주와 예약이 색으로만 갈리고 있었다. 스크롤러 **밖**이라야 트랙과 함께 흘러가지
              않고, 카드 아래는 '오늘로' 버튼이 덮으므로 자리는 카드 머리다(§24 위젯 셸 헤더).
              공실은 넣지 않는다 — 공백은 색이 없고 'N일 공실' 캡션이 이미 글자로 말한다.
              막대마다 aria-label 이 종류를 말하므로 스와치를 소리로 읽히면 같은 말이 두 번이다. */}
          {/* 좌측 인셋은 바로 아래 호실 열(px-2)에 맞춘다 — 한 카드 안에서 세로로 겹쳐 서는 두 글자의
              레일이 어긋나면 그 자체가 이질감이다. 스와치는 가로로 눕힌다(정사각 10px 은 트랙 위
              막대와 달리 글자를 안 이고 있어 표면만으로 읽혀야 한다). */}
          <div aria-hidden className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-2"
            style={{ borderBottom: '1px solid var(--warm-border)' }}>
            {([['var(--band-paid-bg)', '거주'], ['var(--band-await-bg)', '입실 예약']] as const).map(([bg, label]) => (
              <span key={label} className="inline-flex items-center gap-1.5 text-[0.65625rem]" style={{ color: 'var(--ink-m)' }}>
                <span className="inline-block" style={{ width: 18, height: 9, borderRadius: 'var(--radius-xs)', background: bg }} />
                {label}
              </span>
            ))}
          </div>
          {/* 가로 스크롤러는 포커스를 받아야 키보드로 오른쪽 날짜에 닿는다(WCAG 2.1.1). */}
          <div ref={scrollRef} role="region" aria-label="입퇴실 캘린더 트랙" tabIndex={0}
            className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--coral)]"
            style={{ overscrollBehaviorX: 'contain' }}>
            <div className="move-track" style={{ width: trackW }}>

              {/* 눈금 두 줄 — 위는 월 밴드, 아래는 날짜. 호실 열이 둘을 가로질러 sticky 로 선다. */}
              <div className="grid" style={{ gridTemplateColumns: cols, gridTemplateRows: 'auto auto', borderBottom: '1px solid var(--warm-border)' }}>
                <div className="sticky left-0 z-30 flex items-end px-2 pb-1.5 text-[0.65625rem] font-bold uppercase"
                  style={{ gridColumn: '1 / 2', gridRow: '1 / 3', background: 'var(--cream)', color: 'var(--ink-m)' }}>호실</div>

                {data.months.map((m, i) => (
                  <MonthLabel key={m.month} m={m}
                    showYear={i === 0 || m.month.slice(0, 4) !== data.months[i - 1].month.slice(0, 4)} />
                ))}

                {/* '오늘' — 월 라벨과 겹치는 자리에서는 오늘이 이긴다(z-20 · 불투명). */}
                {todayDay != null && (
                  // 10.5px 이 §05 하한이다. 같은 파일의 다른 작은 글자가 전부 그 값이다.
                  <span className="z-20 self-center justify-self-start whitespace-nowrap rounded-full px-1.5 py-0.5 text-[0.65625rem] font-bold leading-none"
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
        </div>
      )}

      {/* 오늘이 화면 밖일 때 — 넓은 트랙에서 '지금'을 잃지 않게 하는 유일한 상시 손잡이.
          보임/숨김은 paintToday 가 DOM 에 직접 쓴다(스크롤마다 트랙을 다시 그리지 않으려고).
          첫 페인트는 숨김에서 시작하고 착지 직후 paintToday 가 정한다 — 오늘이 창 밖이면 곧 켜지고,
          그때 누르면 스크롤이 아니라 이번 달로 다시 조회한다(goToday).
          **트랙이 있을 때만 부유시킨다** — 빈 상태에서는 위 EmptyState 의 CTA 자리가 그 길이다. */}
      {data.rows.length > 0 && (
      <button ref={todayBtnRef} type="button" onClick={goToday}
        className="absolute bottom-2.5 right-2.5 z-40 min-h-[44px] inline-flex items-center rounded-full px-3.5 text-xs font-bold shadow-lift transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--coral)]"
        style={{ display: 'none', background: 'var(--persimmon)', color: 'var(--on-solid)' }}>
        오늘로
      </button>
      )}
      </div>

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
              {/* 날짜는 fmtDateDot 이다 — 이 줄이 가리키는 날은 트랙 **밖**이라 몇 월인지만으로는
                  어느 해인지 알 수 없다(창이 해를 넘는 자리에 서면 흔하다). fmtMD 자체를 연도
                  포함으로 바꾸지 않는다: 그 함수는 '짧은 인라인' 정본이고 소비처가 9파일 14곳이라
                  확인 다이얼로그 본문까지 한꺼번에 길어진다. */}
              <p className="text-xs tnum" style={{ color: 'var(--ink-m)' }}>
                이후 예정 {beyond.count}건 · 최초 {fmtDateDot(beyond.firstDate)}
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
 * memo 인 이유. 이 화면에는 useSearchParams 구독자가 여럿이라(하단 내비·사이드바·MonthSync·
 * 월 셀렉터·RoomManageClient) URL 이 한 번 바뀔 때마다 부모가 다시 그려진다. 트랙은 열일곱 행 ×
 * 수백 칸이라 그때마다 함께 그리면 스크롤이 멎는 순간 프레임이 떨어진다. 이 컴포넌트가 훅으로
 * URL 을 구독하지 않게 만든 덕에(jumpToMonth 가 window.location 을 그 자리에서 읽는다) memo 가
 * 실제로 산다 — data 는 서버 prop 이라 참조가 안정적이다.
 */
export const MoveCalendar = memo(MoveCalendarView)

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
 *
 * 연도는 **범위의 첫 달과 해가 바뀌는 달에만** 붙인다. 종전에는 어디에도 없어서 해를 넘는
 * 범위에서 "1월"이 몇 년인지 알 수 없었다(회귀가 2026-12 → 2027-01 케이스를 이미 고정하고 있다).
 * 매 달 적으면 여덟 번 반복되는 "2026년"이 실제 정보인 월과 시각적으로 동급이 되므로,
 * 무게와 색으로 눌러 평소엔 안 읽히고 필요할 때만 읽히게 둔다. 문법은 형제인 월 셀렉터
 * 라벨('2026년 8월')과 같다 — 한 화면에서 두 자리가 같은 문자열을 쓴다.
 *
 * tnum — 네 자리 연도가 들어오면서 옆 달 라벨과 자폭이 갈린다(§05 '모든 데이터 숫자 tnum').
 */
function MonthLabel({ m, showYear }: { m: MoveRangeMonth; showYear: boolean }) {
  return (
    <div className="min-w-0 py-1"
      style={{ gridColumn: `${m.startDay + 1} / ${m.startDay + m.days + 1}`, gridRow: '1 / 2', borderLeft: m.startDay === 1 ? undefined : '1px solid var(--warm-border)' }}>
      <span className="sticky z-10 inline-flex items-baseline gap-1.5 whitespace-nowrap px-2 text-[0.6875rem] leading-none tnum"
        style={{ left: ROOM_COL, background: 'var(--cream)' }}>
        {/* 연도와 월은 **한 덩어리로 읽혀야 한다** — gap-1.5(6px)를 사이에 두면 형제인 월 셀렉터
            라벨('2026년 8월', 보통 공백 약 4px)과 자간이 갈린다. 여기서는 보통 공백으로 잇고
            gap 은 '변동 없음' 과의 간격으로만 남긴다. */}
        <span className="font-bold" style={{ color: 'var(--ink-2)' }}>
          {showYear && <span className="font-normal" style={{ color: 'var(--ink-m)' }}>{`${m.month.slice(0, 4)}년 `}</span>}
          {Number(m.month.slice(5, 7))}월
        </span>
        {/* 빈 달을 말없이 두면 고장으로 읽힌다 — 비어 있는 것이 사실이라고 옅게 적어 둔다. */}
        {m.eventCount === 0 && <span style={{ color: 'var(--ink-m)' }}>변동 없음</span>}
      </span>
    </div>
  )
}

/**
 * 고정 요약 줄 — 오늘부터 UPCOMING_DAYS 일 안의 변동. 항목은 그대로 계약으로 들어간다.
 *
 * todayInRange 가 필요한 이유. upcoming 은 **창 안의** 변동에서만 걸러진다. 먼 달로 점프해
 * 창이 오늘을 안 물면 그 목록은 반드시 비고, 내일 퇴실이 있어도 이 줄이 "예정된 입퇴실이
 * 없습니다"라고 적는다. 없는 것과 여기서 셀 수 없는 것은 다른 말이다.
 */
function UpcomingRow({ items, todayInRange, onOpen }: {
  items: MoveEvent[]
  todayInRange: boolean
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
        {!todayInRange ? (
          <p className="text-xs" style={{ color: 'var(--ink-s)' }}>오늘이 이 기간 밖입니다. 아래 [오늘로]를 누르면 돌아옵니다.</p>
        ) : items.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--ink-s)' }}>예정된 입퇴실이 없습니다.</p>
        ) : (
          <>
            {shown.map(e => {
              const { tone, label } = eventTone(e)
              return (
                // 키는 막대 id 다 — 이사는 한 계약이 같은 날 두 방에서 변동을 내므로 계약 id 로는 겹친다.
                <button key={`${e.barId}-${e.type}`} type="button"
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
        {/* 막대 — 키는 구간 id 다. 계약 id 로 쓰면 나갔다 같은 방으로 돌아온 계약에서 키가 겹쳐
            React 가 stale DOM 을 남긴다(같은 사고 전례: RoomsClient 정렬 고착, 신고 7007d2c1). */}
        {placed.map(p => (
          <Bar key={p.bar.id} p={p} roomNo={row.roomNo} onOpen={() => onOpen(row.roomId, p.bar.leaseId, p.bar.tenantId)} />
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

function Bar({ p, roomNo, onOpen }: { p: Placed; roomNo: string; onOpen: () => void }) {
  const { bar, full, mode, side, ink } = p

  return (
    <>
      {/* 이 버튼에 overflow-hidden 을 걸면 안 된다 — 그 순간 버튼 자신이 스크롤 컨테이너가 되어
          안의 sticky 이름이 트랙이 아니라 버튼에 붙고, 트랙을 끌어도 따라오지 않는다(실측에서
          한 번 걸렸다). 넘침은 안쪽 span 의 truncate 가 자기 상자에서 막는다.

          aria-label 이 필수인 이유. 라벨이 바 밖으로 나가는 mode 에서는 버튼 안 글자가 빈
          문자열이라 이름 없는 버튼이 되고, title 은 접근명의 최후 폴백이라 모바일에서 안 읽힌다.
          게다가 title 이 담는 문장에는 거주냐 예약이냐가 없다 — 그건 색만 아는 정보였다. */}
      <button type="button" onClick={onOpen} title={full} aria-label={barAria(bar, roomNo)}
        className="mc-bar min-w-0 self-center flex items-center text-[0.6875rem] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--coral)]"
        style={{
          gridColumn: `${bar.startDay + 1} / ${bar.endDay + 2}`,
          gridRow: `${bar.lane + 1} / span 1`,
          height: 'calc(var(--mc-lane) - 12px)',
          background: barTone(bar),
          color: 'var(--ink-2)',
          borderRadius: barRadius(bar),
        }}>
        {/* ── 사건 문구는 막대 **시작 지점**에 못 박는다 ──
            종전에는 이름과 사건 문구가 한 덩어리로 sticky 라, 508호 김태란 행에서 트랙을 오른쪽
            끝까지 끌어도 "7/1 506호에서 이사"가 화면 왼쪽에 계속 따라왔다(운영자 신고 2026-08-20).
            사건은 날짜에 일어나므로 문구도 그 날짜 칸에 있어야 하고, 스크롤과 함께 흘러 나가야 한다.
            조각은 조립(lib/moveCalendar barLabels)이 낸다 — 화면이 ' · ' 로 다시 쪼개면 사본이 된다. */}
        {mode === 'full' && bar.startLabel && (
          <span className="shrink-0 whitespace-nowrap px-2 tnum">{bar.startLabel}</span>
        )}
        {/* 이름은 막대 안에서 sticky 다. 연속 트랙에서는 한 막대가 화면보다 넓은 일이 흔한데,
            글자를 막대 왼쪽 끝에 붙여 두면 그 막대가 화면을 가득 채운 순간 **이름 없는 색 띠**가
            된다(390px 에서 열일곱 행 중 열 행이 그랬다). 이 껍데기가 sticky 의 컨테이닝 블록이라
            이름이 양옆 사건 문구를 침범하지 않고 그 사이에서만 미끄러진다. */}
        {/* tnum — 이 라벨에는 날짜뿐 아니라 호실번호도 들어온다(이사 문구). 옆 열의 같은 숫자와 자폭이 갈리면 안 된다. */}
        <span className="min-w-0 flex-1 flex">
          <span className="sticky min-w-0 max-w-full truncate px-2 tnum" style={{ left: ROOM_COL }}>
            {mode === 'outside' ? '' : mode === 'full' && bar.stateLabel
              ? `${bar.tenantName} · ${bar.stateLabel}`
              : bar.tenantName}
          </span>
        </span>
        {/* 끝 문구는 막대 **끝 지점**에. 9/30 퇴실은 9/30 칸에 있어야 하고, 7월을 보고 있을 때
            화면에 있으면 안 된다(513호 민경진·522호 이경호가 같은 증상이었다). */}
        {mode === 'full' && bar.endLabel && (
          <span className="shrink-0 whitespace-nowrap px-2 tnum">{bar.endLabel}</span>
        )}
      </button>
      {side && ink && (
        <span className="self-center px-1 text-[0.6875rem] font-medium truncate pointer-events-none tnum"
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
