'use client'

// iOS 가상 키보드 대응 가드 — 셋을 한 구독처에서 처리한다.
//
// ① 키보드가 열려 있는 동안 셸 본문에 겹침만큼 아래 여백을 준다(--kbd-inset).
//    iOS 는 키보드가 떠도 layout viewport(dvh)를 줄이지 않는다. 셸은 h-dvh 고정이라
//    스크롤 여유가 1px 도 안 늘고, 하단 입력칸이 키보드 뒤에 깔린 채 손가락으로 꺼낼 수 없다
//    (신고 e1df22e9·395652b3 — 재고 실사 위치별 점검).
//    높이를 줄이지 않고 패딩을 더하는 이유는 --shell-content-h 를 쓰는 편집기류(도면)까지
//    파급되기 때문이다. 안드로이드는 키보드가 layout viewport 를 함께 줄이므로 겹침이 0 으로
//    나와 이중 차감이 없다.
//
// ② 가려진 입력칸을 보이는 곳으로 데려온다(신고 4555b1fd).
//    ①만으로는 여유만 생기고 아무도 그 자리로 데려다주지 않는다. 아이폰만 그렇다 —
//    **iOS 의 포커스 자동 스크롤은 문서·visual viewport 레벨까지만 닿고 중첩 스크롤 컨테이너에는
//    안 닿는다.** 안드로이드는 키보드가 레이아웃을 실제로 줄여 Blink 가 재노출을 다시 돌린다.
//    그래서 UA 로 가르지 않고 **측정된 겹침**으로 건다. 안드로이드는 겹침이 0 이라 진입 자체가 없고,
//    설령 진입해도 이미 노출돼 있어 델타가 0 이다. 두 겹이 서로 독립이라 이중 스크롤이 안 난다.
//
// ③ 키보드가 닫힌 시점 잔존 오프셋 복원.
//    밀어 올린 채 복원하지 않으면 보이는 위치와 터치 히트 판정이 세션 내내 어긋난다
//    (신고 6c196aeb: 생년월일 탭이 국적을 염). 레이아웃 무접점 — 모달 body 고정 방식은
//    상·하단 바가 밀리는 회귀를 냈다(신고 d4cf82d5).
//
// 키보드 열림 판정을 여기 한 곳에 둔다. 두 곳에 생기면 한쪽만 참인 구간에서 어긋난다.
//
// 제약(knowledge/mobile-scroll-viewport.md) — 이 컴포넌트를 루트 layout 으로 승격하지 말 것.
// B 패턴(문서 스크롤) 페이지들이 맨 위로 튄다. app/(app)/layout.tsx 에만 둔다.
import { useEffect, useRef } from 'react'

const KBD_INSET = '--kbd-inset'
const KBD_OPEN_PX = 60      // 이만큼 가려지면 키보드가 올라온 것으로 본다
const REVEAL_GAP = 16       // 재노출 시 칸 아래로 남길 여백
const PENDING_TTL_MS = 600  // 키보드 리사이즈가 액세서리 바·본체로 나뉘어 오므로 첫 이벤트만 보면 놓친다

// 포커스 요소를 실제로 감싸는 스크롤러 — 모달 안이면 모달 본문이, 그 밖이면 .app-main 이 자연히 잡힌다.
// 그래서 모달 특례 코드가 필요 없다. window 는 절대 건드리지 않는다(B 패턴 페이지가 맨 위로 튄다).
function scrollParent(el: Element): HTMLElement | null {
  for (let n = el.parentElement; n; n = n.parentElement) {
    const cs = getComputedStyle(n)
    // fixed 조상을 만나면 멈춘다. 그 위 스크롤러는 이 요소를 애초에 못 움직인다 —
    // 모달 안에서 본문이 안 넘치면 배경(.app-main)을 잡아 배경만 스크롤되고 델타가 수렴하지 않았다.
    // sticky 는 멈추지 않는다. 흐름 안에 있어 자기 스크롤러가 실제로 움직인다.
    if (cs.position === 'fixed') return null
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && n.scrollHeight > n.clientHeight) return n
  }
  return null
}

function isEditable(t: EventTarget | null): t is HTMLElement {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement
    // select 도 포함한다 — iOS 피커 휠도 visual viewport 를 줄인다
    || t instanceof HTMLSelectElement
    || (t instanceof HTMLElement && t.isContentEditable)
}

export default function ViewportOffsetGuard() {
  const pending = useRef<{ el: HTMLElement; at: number } | null>(null)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const root = document.documentElement

    // **열림 판정과 겹침 크기는 서로 다른 숫자다.** 하나로 합치면 안 된다(신고 716e7b0c).
    // 판정은 팬 불변이어야 한다 — offsetTop 을 빼면 iOS 가 밀수록 값이 줄어 0까지 떨어지고,
    // 키보드가 떠 있는데도 '닫혔다'로 오판해 아래 복원이 팬을 되감는다. 화면이 툭 떨어진다.
    const keyboardOpenNow = () => window.innerHeight - vv.height > KBD_OPEN_PX
    // 겹침 크기는 반대다 — 팬한 만큼 실제로 덜 가리므로 offsetTop 을 뺀다.
    const overlapNow = () => Math.max(0, Math.round(window.innerHeight - (vv.height + vv.offsetTop)))

    const reveal = () => {
      const p = pending.current
      pending.current = null   // 원샷 — vv.scroll 이 매 프레임 도는 동안 되돌려 스크롤하면 스크롤 전쟁이 난다
      if (!p || Date.now() - p.at > PENDING_TTL_MS) return
      if (!p.el.isConnected || document.activeElement !== p.el) return
      const box = scrollParent(p.el)
      if (!box) return
      // getBoundingClientRect 는 layout viewport 기준이라 보이는 하단선도 같은 프레임으로 환산한다.
      // vv.height 만 쓰면 팬된 만큼 틀린다.
      const delta = p.el.getBoundingClientRect().bottom + REVEAL_GAP - (vv.offsetTop + vv.height)
      // 가려졌을 때만, 최소 델타만. 가운데 정렬로 과대 스크롤하면 칸 위의 라벨이 밀려 올라가
      // 무슨 칸인지 사라진다(위치별 점검은 라벨이 입력칸 위에 있는 2열 그리드다).
      if (delta > 0) box.scrollTop += delta
    }

    // 패딩이 실제로 반영된 다음 프레임에 잰다 — 그 전에는 스크롤 범위가 부족해 클램프된다
    const scheduleReveal = () => { if (pending.current) requestAnimationFrame(reveal) }

    const restore = () => {
      if (window.scrollY !== 0 || vv.offsetTop > 0) window.scrollTo(0, 0)
    }
    // 크기 갱신은 resize 에서만. 팬 프레임마다 다시 쓰면 scrollHeight 가 오르내리며
    // scrollTop 이 계속 클램프돼 스크롤이 되감긴다. 팬 중 여유가 조금 넉넉한 것은 무해하다.
    const onResize = () => {
      const open = keyboardOpenNow()
      root.style.setProperty(KBD_INSET, open ? `${overlapNow()}px` : '0px')
      if (open) { scheduleReveal(); return }
      restore()
    }
    const onScroll = () => { if (!keyboardOpenNow()) restore() }

    const onFocusIn = (e: FocusEvent) => {
      if (!isEditable(e.target)) return
      // 기억만 한다. 이 시점엔 키보드가 아직 안 올라와 겹침이 0 이라 지금 재면 엉뚱한 데로 간다.
      pending.current = { el: e.target, at: Date.now() }
      // 다만 키보드가 이미 열려 있으면(칸에서 칸으로 이동) resize 가 안 와서 영영 안 불린다
      if (overlapNow() > KBD_OPEN_PX) scheduleReveal()
    }
    const onFocusOut = () => { pending.current = null }

    vv.addEventListener('resize', onResize)
    vv.addEventListener('scroll', onScroll)
    document.addEventListener('focusin', onFocusIn, true)
    document.addEventListener('focusout', onFocusOut, true)
    return () => {
      vv.removeEventListener('resize', onResize)
      vv.removeEventListener('scroll', onScroll)
      document.removeEventListener('focusin', onFocusIn, true)
      document.removeEventListener('focusout', onFocusOut, true)
      root.style.removeProperty(KBD_INSET)
    }
  }, [])
  return null
}
