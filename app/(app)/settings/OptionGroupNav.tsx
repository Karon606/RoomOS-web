'use client'
// 설정 > 분류 관리의 묶음 머리와 그 묶음으로 데려가는 바로가기 줄. 둘이 묶음 목록 한 벌을 같이 쓴다.
//
// 2026-10-23 운영자 결정('추천대로 두는 쪽으로'). 탭이 320px 에서 약 20,400px 이고 묶음 하나가 6~7화면이라
// 머리를 지나치면 다음 묶음까지 손으로 한참 밀어야 했다(가이드 §22 분류 관리 묶음 머리). 탭 맨 위에 묶음마다
// 버튼 하나를 세워 누르면 그 묶음 머리로 데려간다. 이동뿐이라 적용취소 대상이 아니다(저장하는 것이 없다).
import { useEffect, useRef } from 'react'
import { Btn } from '@/components/ui/Btn'

// 묶음 차례 정본. 머리(h2)의 글자·id 와 바로가기 버튼 라벨이 모두 여기서 나온다. 묶음을 더하거나 이름을 바꾸면
// 이 한 줄만 고친다(머리에 없는 이름을 쓰면 타입이 막고, 차례는 감지망 check-option-group-jump 가 지킨다).
export const OPTION_GROUPS = [
  { title: '호실', id: 'option-group-room' },
  { title: '입주자', id: 'option-group-tenant' },
  { title: '돈', id: 'option-group-money' },
  { title: '청소·작업', id: 'option-group-work' },
  { title: '재고·비품', id: 'option-group-stock' },
] as const

export type OptionGroupTitle = (typeof OPTION_GROUPS)[number]['title']

// 바로가기 줄(nav)의 id. 묶음 머리 옆 '맨 위로' 가 이 줄로 돌아온다.
export const OPTION_GROUP_NAV_ID = 'option-group-jumps'

/**
 * 분류 관리 묶음 머리(2026-10-22 2차 등재, 가이드 §22). 카드 사이에 서는 h2 한 줄이고 카드 제목은 h3 다.
 * 담는 쪽 간격(space-y-4, 16px) 위에 위는 넓히고(pt-2, 앞 카드와 24px) 아래는 좁혀(줄의 mb-2 가 담는 쪽 아래 여백을 8px 로 바꾼다)
 * 머리가 제 묶음 첫 카드에 붙는다. 음수 여백은 카드가 머리 글자를 덮었다(2026-10-22 하네스 실측). 접기·카운트는 없다.
 * 바로가기의 도착점이라 id 와 tabIndex=-1 을 든다. 포커스를 받아야 키보드·화면 낭독기가 그 묶음에서 이어 간다.
 * scroll-mt-4 는 서류 변수 점프 앵커(dv-*)와 같은 16px 이다. 셸 헤더는 스크롤러(.app-main) 밖에 서서 머리를 덮지 않는다.
 * 같은 줄 오른쪽 끝에 '맨 위로' 글자 링크가 선다(2026-10-23 운영자 승인). 묶음 하나가 6~7화면이라 묶음 안 깊이에서
 * 바로가기 줄로 돌아가려면 한참 밀어 올려야 했다. 머리를 고정하지 않는다는 §22 를 지키면서 머리를 지날 때마다 돌아갈 길을 둔다.
 * 첫 머리(호실)에는 없다. 바로가기 줄 바로 밑이라 돌아갈 거리가 없다. 대신 탭 맨 끝에 OptionGroupTopLink 하나가 선다.
 */
export function OptionGroupHead({ title }: { title: OptionGroupTitle }) {
  const id = OPTION_GROUPS.find(g => g.title === title)?.id
  return (
    <div className="flex items-baseline justify-between gap-2 mb-2">
      <h2 id={id} tabIndex={-1}
        className="px-1 pt-2 scroll-mt-4 rounded-sm text-[0.8125rem] font-bold text-[var(--warm-dark)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tc-text)]">
        {title}
      </h2>
      {/* 히트 44px 를 머리 줄 안팎에 고르게 걸친다. 글자를 상자 아래쪽(items-end pb-1)에 두어 상자가 글자보다 위로 서고,
          앞 카드와 3.5px · 제 묶음 첫 카드와 4px 떨어진다(가운데 맞춤이면 아래로 5.8px 넘쳐 첫 카드 오른쪽 위를 덮었다, 2026-10-23 실측).
          음수 여백(-mt-3.5 -mb-1.5)은 상자를 줄 높이 27.5px 안에 접는다. */}
      {title !== OPTION_GROUPS[0].title && <TopLinkButton className="-mt-3.5 -mb-1.5 items-end pb-1" />}
    </div>
  )
}

// 맨 위로 글자 링크. 상자 Btn 이 아니라 글자라 머리와 겨루지 않는다. 크기·색은 바로가기 캡션과 같은 11px · --seg-ink-off 다
// (--ink-3 별칭, --canvas 위 5.18:1, §03). 점선 밑줄은 설정 형제 링크(서류 변수 '편집으로 이동')와 같은 문법이다.
// 꺾쇠(›)는 붙이지 않는다. 오른쪽을 가리키는 표시가 위로 가는 동작과 어긋나고, 점선 밑줄이 링크임을 이미 말한다(2026-10-23 독립 검수).
function TopLinkButton({ className }: { className: string }) {
  return (
    <button type="button" onClick={toGroupNav}
      className={`${className} min-h-[44px] min-w-[44px] px-1 shrink-0 inline-flex justify-end rounded-sm text-[0.6875rem] font-medium text-[var(--seg-ink-off)] underline decoration-dotted underline-offset-2 hover:text-[var(--warm-dark)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tc-text)]`}>
      맨 위로
    </button>
  )
}

/**
 * 탭 맨 끝(마지막 묶음 마지막 카드 뒤)의 맨 위로. 가장 깊은 자리에서는 지날 머리가 없어 길이 끊겼다(2026-10-23 독립 검수).
 * 머리 줄 링크와 같은 글자 링크를 오른쪽 끝에 하나 세운다. 위 카드와는 담는 쪽 16px 에서 -mt-2 만큼 당겨 8px 떨어진다.
 */
export function OptionGroupTopLink() {
  return (
    <div className="-mt-2 flex justify-end">
      <TopLinkButton className="items-center" />
    </div>
  )
}

// 맨 위로. 스크롤러(.app-main)를 맨 위로 올려 설정 제목·탭·바로가기 줄이 함께 보이게 하고, 바로가기 줄(nav)에 포커스를 준다.
// 키보드는 다음 Tab 이 첫 묶음 버튼이다. 모션 축소 설정이면 미끄러지지 않고 바로 선다.
function toGroupNav() {
  const nav = document.getElementById(OPTION_GROUP_NAV_ID)
  if (!nav) return
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  nav.closest('.app-main')?.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
  nav.focus({ preventScroll: true })
}

/**
 * 묶음 바로가기 줄. 버튼은 정본 Btn secondary sm(44px)이고 라벨은 머리 글자 그대로다('돈' 은 한 글자라 폭만 44px 로 받친다).
 * 320px 에서 다섯이 한 줄에 안 들어가 가로로 민다. 넘치면 잘리는 쪽 끝을 흐리는 것은 ViewTabs·SegmentedControl 과 같은
 * data-fade 마스크다(globals.css). 트랙의 안쪽 4px 은 버튼 포커스 링(ring-2 + offset 2)이 스크롤러에 잘리지 않게 하는 자리이고,
 * 같은 만큼 음수 여백으로 물려 첫 버튼이 아래 카드 좌변과 맞는다.
 * 도착은 머리를 스크롤러 맨 위로 데려온 뒤 머리에 포커스를 준다. 모션 축소 설정이면 미끄러지지 않고 바로 선다.
 */
export function OptionGroupJumps() {
  const trackRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const update = () => {
      if (track.scrollWidth <= track.clientWidth + 1) { delete track.dataset.fade; return }
      const atStart = track.scrollLeft <= 1
      const atEnd = track.scrollLeft >= track.scrollWidth - track.clientWidth - 1
      track.dataset.fade = atStart ? 'right' : atEnd ? 'left' : 'both'
    }
    update()
    track.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(track)
    return () => { track.removeEventListener('scroll', update); ro.disconnect() }
  }, [])

  const go = (id: string) => {
    const head = document.getElementById(id)
    if (!head) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    head.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    head.focus({ preventScroll: true })
  }

  return (
    <nav id={OPTION_GROUP_NAV_ID} tabIndex={-1} aria-label="분류 묶음 바로가기"
      className="rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tc-text)]">
      {/* 이동 단서 캡션(2026-10-23 디자이너 검토). 상자 버튼 다섯이 ViewTabs 바로 밑에 서면 2차 탭·필터로 읽혀 누르면 그 묶음만
          남을 거라 기대하게 된다. 버튼마다 › 를 붙이는 §29 이동 표기보다 줄 앞 한 마디가 덜 시끄럽고 320px 넘침도 늘리지 않는다.
          크기는 설정 화면 캡션 정본 11px 이고, 색은 --seg-ink-off 다(--canvas 위 5.18:1, §03). --warm-dark 는 버튼 글자와 같아
          캡션이 줄의 여섯째 항목처럼 읽혀 쓰지 않는다(디자이너 재검토). 처음엔 --warm-muted 가 이 면에서 4.11:1 이라 갈랐다(2026-10-26 전 #7A6553).
          낭독기는 nav 이름이 같은 말을 하므로 캡션을 건너뛴다. */}
      <p aria-hidden className="mb-0.5 text-[0.6875rem] font-medium text-[var(--seg-ink-off)]">바로가기</p>
      <div ref={trackRef} data-fade-track
        className="-m-1 p-1 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {OPTION_GROUPS.map(g => (
          <Btn key={g.id} variant="secondary" size="sm"
            className="shrink-0 min-w-[44px] whitespace-nowrap" onClick={() => go(g.id)}>
            {g.title}
          </Btn>
        ))}
      </div>
    </nav>
  )
}
