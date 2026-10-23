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

/**
 * 분류 관리 묶음 머리(2026-10-22 2차 등재, 가이드 §22). 카드 사이에 서는 h2 한 줄이고 카드 제목은 h3 다.
 * 담는 쪽 간격(space-y-4, 16px) 위에 위는 넓히고(pt-2, 앞 카드와 24px) 아래는 좁혀(mb-2 가 담는 쪽 아래 여백을 8px 로 바꾼다)
 * 머리가 제 묶음 첫 카드에 붙는다. 음수 여백은 카드가 머리 글자를 덮었다(2026-10-22 하네스 실측). 접기·카운트는 없다.
 * 바로가기의 도착점이라 id 와 tabIndex=-1 을 든다. 포커스를 받아야 키보드·화면 낭독기가 그 묶음에서 이어 간다.
 * scroll-mt-4 는 서류 변수 점프 앵커(dv-*)와 같은 16px 이다. 셸 헤더는 스크롤러(.app-main) 밖에 서서 머리를 덮지 않는다.
 */
export function OptionGroupHead({ title }: { title: OptionGroupTitle }) {
  const id = OPTION_GROUPS.find(g => g.title === title)?.id
  return (
    <h2 id={id} tabIndex={-1}
      className="px-1 pt-2 mb-2 scroll-mt-4 rounded-sm text-[0.8125rem] font-bold text-[var(--warm-dark)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tc-text)]">
      {title}
    </h2>
  )
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
    <nav aria-label="분류 묶음 바로가기">
      {/* 이동 단서 캡션(2026-10-23 디자이너 검토). 상자 버튼 다섯이 ViewTabs 바로 밑에 서면 2차 탭·필터로 읽혀 누르면 그 묶음만
          남을 거라 기대하게 된다. 버튼마다 › 를 붙이는 §29 이동 표기보다 줄 앞 한 마디가 덜 시끄럽고 320px 넘침도 늘리지 않는다.
          크기는 설정 화면 캡션 정본 11px 이고, 색은 --warm-muted 가 아니라 --warm-dark 다. 이 줄은 --canvas 꽉 찬 면 위라
          --warm-muted 는 4.11:1 로 본문 하한 미달이다(§27.8 WhyCaption 면 규칙, ViewTabs 비활성 글자와 같은 판단).
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
