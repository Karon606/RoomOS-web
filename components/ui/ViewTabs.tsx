'use client'

// v2.0 §25 뷰 전환 탭 (View Tabs) — 밑줄 탭 정본 (2026-08-25 개정).
//
// 종전에는 코랄 채움 조인트 탭(상자 + 세그 구분선)이었다. 운영자 지적 셋이 전부 그 형태
// 하나에서 나왔다 — 자연폭이라 칸 폭이 들쭉날쭉해 보였고, 세그 구분선이 채움보다 위에
// 그려져 전환 중 채움 한가운데를 1px 선이 가로질렀고, 그래서 구분선을 없애 달라고 했다.
// 상자를 걷어내면 셋이 함께 사라진다 — 비교할 칸이 없으면 자연폭은 글줄 위 단어들처럼
// 읽히고, 구분선은 존재하지 않고, 채움이 선 밑을 지나는 메커니즘도 없다.
//
// 활성 표시는 라벨 밑 2px 코랄 바다. 사이드바 활성(좌측 2.5px 바)·하단 내비 활성(상단
// 2px 바)과 같은 문법 — 세 내비 표면이 한 규칙을 쓴다. 탭만 혼자 채움 상자였다.
//
// SegmentedControl(v2.0 §23)은 필터(라디오, 해제 가능) 전용 — 이 컴포넌트는 "항상 정확히
// 1개 활성"인 뷰 전환에만 쓴다(판별은 v2.0 §25). 링크 탭(href)은 <Link>, 아니면 <button>.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'

// 링크 탭(href)은 페이지 전환 시 컴포넌트가 리마운트돼 슬라이드가 사라진다(수납만 움직인다는 지적 2026-07-06).
// 같은 탭 구성(id 목록)끼리 직전 바 위치를 모듈 레벨에 기억해, 클릭 즉시 낙관 이동 + 새 페이지 마운트 시
// 기억 위치에서 실측 위치로 이어 붙인다 — 버튼 탭과 링크 탭의 체감을 통일.
const thumbMemory = new Map<string, { left: number; width: number }>()

export interface ViewTab {
  id: string              // 탭 식별자 (패널 aria-labelledby와 매칭)
  label: string
  suffix?: string         // 합계 접미: "+16만" | "12만" — 괄호는 컴포넌트가 붙임(24.3)
  /**
   * 접미가 차지할 자리를 이 문자열의 폭으로 **미리** 잡는다.
   *
   * 값이 화면 안에서 바뀌는 탭에만 넘긴다(입퇴실 캘린더의 '보고 있는 달' 건수처럼). 접미 폭이
   * 달라지면 탭 트랙의 자연폭이 달라지고, flex 줄바꿈은 shrink 이전에 그 자연폭으로 판정되므로
   * 헤더가 접혔다 펴진다 — 가로로 끌고 있는데 아래 카드가 세로로 뛴다.
   * 자리를 미리 잡으면 접미가 없는 회차(0건)에도 폭이 안 흔들린다. 밑 바도 유령 포함 폭을 재므로
   * 접미 자릿수가 변해도 바 폭이 안 흔들린다. 안 넘기면 종전과 바이트 단위로 같다.
   */
  suffixWidest?: string
  href?: string           // 지정 시 링크 탭(24.5). 없으면 <button>
  disabled?: boolean
}

export function ViewTabs({
  tabs,
  activeId,
  onChange,
  fill = false,
  ariaLabel,
}: {
  tabs: ViewTab[]          // 2~4 권장, 5 max
  activeId: string         // 항상 정확히 1개 — 필수(해제 없음)
  onChange?: (id: string) => void   // button 모드에서만
  fill?: boolean           // true = flex-1 균등 탭(컨테이너 풀폭)
  ariaLabel: string
}) {
  const refs = useRef<(HTMLElement | null)[]>([])
  // 라벨+접미를 감싼 내부 span — 바는 셀이 아니라 **글자 폭**에 붙는다. fill 모드에서 셀이
  // 넓어져도 바가 글자를 따라가고, 자연폭에서도 좌우 히트 확장(before)과 바가 섞이지 않는다.
  const spanRefs = useRef<(HTMLElement | null)[]>([])
  const trackRef = useRef<HTMLDivElement | null>(null)

  // 슬라이딩 코랄 바(v2.0 §29) — 활성 탭의 글자 위치를 실측해 2px 바가 라벨 사이를 미끄러진다.
  // reduced-motion이면 즉시 점프.
  const memKey = tabs.map(t => t.id).join('|')
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(() => thumbMemory.get(memKey) ?? null)
  // 링크 탭 낙관 활성 — 클릭 즉시 텍스트 색까지 새 탭으로.
  const [optimisticIdx, setOptimisticIdx] = useState<number | null>(null)
  const activeIdx = optimisticIdx ?? tabs.findIndex(t => t.id === activeId)

  /** 탭 i 의 바 좌표 — 탭이 relative 라 span.offsetLeft 는 탭 기준이다. */
  const barRectOf = (i: number): { left: number; width: number } | null => {
    const el = refs.current[i]
    if (!el) return null
    const span = spanRefs.current[i]
    return span
      ? { left: el.offsetLeft + span.offsetLeft, width: span.offsetWidth }
      : { left: el.offsetLeft, width: el.offsetWidth }
  }

  useLayoutEffect(() => {
    const el = refs.current[activeIdx]
    if (!el) { setThumb(null); return }
    const measure = () => {
      const rect = barRectOf(activeIdx)
      if (!rect) return
      setThumb(rect)
      thumbMemory.set(memKey, rect)
    }
    // 기억 위치(직전 페이지)에서 실측 위치로 트랜지션되도록 한 프레임 뒤에 측정
    if (thumbMemory.has(memKey)) requestAnimationFrame(measure)
    else measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (el.parentElement) ro.observe(el.parentElement)
    return () => ro.disconnect()
  }, [activeIdx, tabs.length, fill, memKey])

  // 넘침 페이드 — 트랙이 가로로 넘칠 때 잘리는 쪽 끝을 흐린다(v2.0 §25 스펙, 종전 미시공분).
  // mask 는 콘텐츠 자체를 투명화하므로 배경색(캔버스·모달 크림·다크)과 무관하게 동작한다.
  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const update = () => {
      const overflow = track.scrollWidth > track.clientWidth + 1
      if (!overflow) { delete track.dataset.fade; return }
      const atStart = track.scrollLeft <= 1
      const atEnd = track.scrollLeft >= track.scrollWidth - track.clientWidth - 1
      track.dataset.fade = atStart ? 'right' : atEnd ? 'left' : 'both'
    }
    update()
    track.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(track)
    return () => { track.removeEventListener('scroll', update); ro.disconnect() }
  }, [tabs.length])

  // 활성 탭을 트랙 안으로 — 트랙이 가로로 넘칠 때만(환경설정 8탭). 딥링크로 뒤쪽 탭에 착지하면
  // 고른 탭이 스크롤 밖에 있어 '아무 탭도 안 골라진' 화면으로 보인다. 넘치지 않는 트랙(대부분의
  // 3~4탭 페이지)에서는 첫 줄에서 빠져나가 무동작이다. 움직이는 것은 트랙의 가로 스크롤뿐이라
  // 페이지 세로 위치는 건드리지 않는다(scrollIntoView 를 안 쓰는 이유).
  const scrolledOnce = useRef(false)
  useEffect(() => {
    const el = refs.current[activeIdx]
    const track = el?.parentElement
    if (!el || !track || track.scrollWidth <= track.clientWidth) return
    const max = track.scrollWidth - track.clientWidth
    const left = Math.max(0, Math.min(max, el.offsetLeft - (track.clientWidth - el.offsetWidth) / 2))
    if (Math.abs(track.scrollLeft - left) < 1) return
    // 첫 착지는 즉시(딥링크로 들어오자마자 트랙이 미끄러지면 화면이 흔들린다), 이후 전환만 부드럽게.
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    track.scrollTo({ left, behavior: scrolledOnce.current && !reduce ? 'smooth' : 'auto' })
    scrolledOnce.current = true
  }, [activeIdx])

  // 키보드 roving(v2.0 §25) — ←/→ 이동, Home/End 처음/끝. 활성만 tabindex=0.
  const onKeyDown = (e: React.KeyboardEvent, idx: number) => {
    const enabled = tabs.map((t, i) => (t.disabled ? -1 : i)).filter(i => i >= 0)
    if (enabled.length === 0) return
    let next: number | null = null
    if (e.key === 'ArrowRight') next = enabled[(enabled.indexOf(idx) + 1) % enabled.length]
    else if (e.key === 'ArrowLeft') next = enabled[(enabled.indexOf(idx) - 1 + enabled.length) % enabled.length]
    else if (e.key === 'Home') next = enabled[0]
    else if (e.key === 'End') next = enabled[enabled.length - 1]
    if (next == null) return
    e.preventDefault()
    refs.current[next]?.focus()
  }

  // 좌우 패딩 대신 트랙 gap(24px)으로 간격을 잡는다 — 첫 라벨이 컨테이너 좌변에 플러시 정렬돼
  // 아래 카드·검색바와 좌변이 맞는다(상자가 사라진 뒤의 정렬 조건). 터치 타겟은 before 유사요소로
  // 좌우 12px씩 확장한다 — 최단 라벨 '수납'도 히트폭 약 48px로 44px을 넘고, gap 24px이라 이웃
  // 히트박스와 겹치지 않는다. 포커스 링은 스크롤러 클리핑을 피해 인셋으로, 색은 --coral 이 아니라
  // --tc-text 다(다크 페이지 위 --coral 은 3:1 미달 — 라이트는 같은 값이라 픽셀 무변경).
  const segBase = `relative z-[1] px-0 ${fill ? 'flex-1 justify-center text-center' : ''} py-2.5 min-h-[44px] md:min-h-[40px] md:py-2 inline-flex items-center whitespace-nowrap shrink-0
    before:absolute before:-inset-x-3 before:inset-y-0 before:content-['']
    focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--tc-text)]
    motion-safe:transition-colors motion-safe:duration-150`
  // 바 실측 전(첫 프레임·JS 비활성)엔 활성 탭이 자체 인셋 밑바로 폴백.
  // 비활성은 --warm-mid 가 아니라 --warm-dark — 상자(크림 트랙)가 사라져 페이지 배경(--canvas)
  // 위에 서므로 --warm-mid 는 4.12:1 로 AA 미달이다(--ink-mute 상향과 같은 판단).
  // hover 는 배경칠 대신 중립색 밑바 힌트 — 배경을 칠하면 상자가 되돌아온다.
  const segActive   = thumb ? 'text-[var(--tc-text)]' : 'text-[var(--tc-text)] shadow-[inset_0_-2px_0_0_var(--tc-text)]'
  const segInactive = 'text-[var(--warm-dark)] hover:shadow-[inset_0_-2px_0_0_var(--warm-border)]'
  const segDisabled = 'text-[var(--warm-muted)] cursor-not-allowed'

  return (
    <div
      ref={trackRef}
      role="tablist"
      aria-label={ariaLabel}
      className={`relative ${fill ? 'flex w-full' : 'inline-flex'} gap-6 border-b border-[var(--warm-border)] text-sm font-semibold max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}
    >
      {thumb && (
        <div aria-hidden className="absolute bottom-0 h-[2px] rounded-full bg-[var(--tc-text)] motion-safe:transition-[left,width] motion-safe:duration-200 motion-safe:ease-out"
          style={{ left: thumb.left, width: thumb.width }} />
      )}
      {tabs.map((t, i) => {
        const active = i === activeIdx
        const cls = `${segBase} ${t.disabled ? segDisabled : active ? segActive : segInactive}`
        const content = (
          <span ref={el => { spanRefs.current[i] = el }} className="inline-flex items-center whitespace-nowrap">
            {t.label}
            {(t.suffix || t.suffixWidest) && (
              // 유령과 실물을 한 격자 칸에 겹친다 — 폭은 유령이 정하고 실물은 그 안 왼쪽에 선다.
              // ch·px 를 안 쓰므로 폰트가 바뀌어도 산다(매직넘버 없음).
              <span className="tabular-nums inline-grid align-baseline">
                <span aria-hidden className="invisible col-start-1 row-start-1 whitespace-nowrap">
                  &nbsp;({t.suffixWidest ?? t.suffix})
                </span>
                {t.suffix && (
                  <span className="col-start-1 row-start-1 whitespace-nowrap">&nbsp;({t.suffix})</span>
                )}
              </span>
            )}
          </span>
        )
        return t.href && !t.disabled ? (
          <Link
            key={t.id}
            href={t.href}
            role="tab"
            aria-selected={active}
            aria-current={active ? 'page' : undefined}
            tabIndex={active ? 0 : -1}
            ref={el => { refs.current[i] = el }}
            onKeyDown={e => onKeyDown(e, i)}
            onClick={() => {
              setOptimisticIdx(i)
              const rect = barRectOf(i)
              if (!rect) return
              setThumb(rect)
              thumbMemory.set(memKey, rect)
            }}
            className={cls}
          >
            {content}
          </Link>
        ) : (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-disabled={t.disabled || undefined}
            disabled={t.disabled}
            tabIndex={active ? 0 : -1}
            ref={el => { refs.current[i] = el }}
            onKeyDown={e => onKeyDown(e, i)}
            onClick={() => !t.disabled && onChange?.(t.id)}
            className={cls}
          >
            {content}
          </button>
        )
      })}
    </div>
  )
}
