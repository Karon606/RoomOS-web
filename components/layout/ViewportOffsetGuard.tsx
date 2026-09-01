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
// ② 포커스한 입력칸을 보기 편한 목표선까지 데려온다(신고 4555b1fd·c12af2ba).
//    ①만으로는 여유만 생기고 아무도 그 자리로 데려다주지 않는다. 아이폰만 그렇다 —
//    **iOS 의 포커스 자동 스크롤은 문서·visual viewport 레벨까지만 닿고 중첩 스크롤 컨테이너에는
//    안 닿는다.** 안드로이드는 키보드가 레이아웃을 실제로 줄여 Blink 가 재노출을 다시 돌린다.
//    그래서 UA 로 가르지 않고 **측정된 겹침**으로 건다. 정책은 "보이는 띠의 TARGET_RATIO
//    지점까지 올린다"(신고 c12af2ba)이고, 방향 비대칭·래치의 이유는 lib/keyboardViewport
//    revealDelta 주석에 있다.
//
// ③ 키보드가 닫힌 시점 잔존 오프셋 복원.
//    밀어 올린 채 복원하지 않으면 보이는 위치와 터치 히트 판정이 세션 내내 어긋난다
//    (신고 6c196aeb: 생년월일 탭이 국적을 염). 레이아웃 무접점 — 모달 body 고정 방식은
//    상·하단 바가 밀리는 회귀를 냈다(신고 d4cf82d5).
//
// **판정·기하는 lib/keyboardViewport 순수 정본이 한다**(키보드 패널 2026-09-02). 이 파일은
// DOM 배선만 남는다 — 8월의 회귀들을 어느 것도 헤드리스로 못 잡았던 원인이 판정이 여기
// 갇혀 있어서다. 이번에 함께 들어온 세 보강도 정본 쪽에 있다.
//   · 줌 게이트 — 핀치 줌(vv.scale)을 키보드로 오판해 유령 패딩·스크롤 되감기가 나던 것.
//   · 복원 엡실론 — 외장 키보드 단축바(문턱 미만)의 OS 팬을 복원이 되감던 스크롤 전쟁.
//   · 상한 클램프 — 정당한 큰 겹침(가로·소형 창)을 기각해 인셋 0 으로 방치하던 것.
//
// 키보드 열림 판정을 여기 한 곳에 둔다. 두 곳에 생기면 한쪽만 참인 구간에서 어긋난다.
//
// 제약(knowledge/mobile-scroll-viewport.md) — 이 컴포넌트를 루트 layout 으로 승격하지 말 것.
// B 패턴(문서 스크롤) 페이지들이 맨 위로 튄다. app/(app)/layout.tsx 와 app/admin/layout.tsx
// (같은 A 패턴 셸)에만 둔다.
import { useEffect, useRef } from 'react'
import { keyboardOpen, overlapInset, shouldRestore, revealDelta, type KbdSnapshot } from '@/lib/keyboardViewport'

const KBD_INSET = '--kbd-inset'
// 키보드가 올라와 있는 동안 루트에 찍는 표식. **판정은 여기 한 곳에서만 한다**(§12) — 화면마다
// 제 판정을 만들면 한쪽만 참인 구간에서 어긋난다. 읽는 쪽은 CSS 로만 읽는다(globals.css).
const KBD_OPEN_ATTR = 'data-kbd-open'

// 포커스 요소를 실제로 감싸는 스크롤러 — 모달 안이면 모달 본문이, 그 밖이면 .app-main 이 자연히 잡힌다.
// 그래서 모달 특례 코드가 필요 없다. window 는 절대 건드리지 않는다(B 패턴 페이지가 맨 위로 튄다).
function scrollParent(el: Element): HTMLElement | null {
  for (let n = el.parentElement; n; n = n.parentElement) {
    const cs = getComputedStyle(n)
    // fixed 조상을 만나면 멈춘다. 그 위 스크롤러는 이 요소를 애초에 못 움직인다 —
    // 모달 안에서 본문이 안 넘치면 배경(.app-main)을 잡아 배경만 스크롤되고 델타가 수렴하지 않았다.
    // sticky 는 멈추지 않는다. 흐름 안에 있어 자기 스크롤러가 실제로 움직인다.
    if (cs.position === 'fixed') return null
    // +1 여유 — 죽은 스크롤러(부모가 높이 무제약이라 늘 콘텐츠 높이인 overflow-y-auto, 지출 폼 본문이
    // 그 예)가 서브픽셀 반올림으로 scrollHeight 가 clientHeight+1 이 되어 잡히면, 스크롤이 거기서
    // 클램프돼 진짜 스크롤러(모달 본문)에 영영 안 닿는다(신고 8c8ec183 — 필드가 모달 하단에 잘린 채 방치).
    // 진짜 스크롤러가 1px 만 넘치는 경우를 건너뛰는 부작용은 무해하다. 1px 안에는 드러낼 것이 없다.
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && n.scrollHeight > n.clientHeight + 1) return n
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
  // aligned 는 음수(아래로 내리는) 정렬을 포커스당 1회로 제한하는 래치다. revealDelta 주석 참조.
  const pending = useRef<{ el: HTMLElement; aligned: boolean } | null>(null)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const root = document.documentElement

    // 스냅샷 한 장으로 정본 함수들을 부른다 — 판정(팬 불변)과 크기(팬 차감)가 다른 숫자인 이유,
    // 줌 게이트·엡실론·클램프의 근거는 전부 lib/keyboardViewport 에 있다.
    const snapNow = (): KbdSnapshot => ({
      innerHeight: window.innerHeight, vvHeight: vv.height, offsetTop: vv.offsetTop, scale: vv.scale,
    })

    // 원샷·TTL 을 걷고 **focusout 까지 유지, resize 마다 재시도**한다(신고 d0833496).
    // iOS 키보드 리사이즈는 액세서리 바·본체로 나뉘어 오고, 모달의 자체 축소(--modal-vvh 반영)는
    // React flush 라 첫 resize 뒤에 온다. 원샷은 마지막 기하를 못 보고 소진돼 버렸다.
    // 스크롤 전쟁은 안 난다 — 재시도는 resize 에서만 하고(vv.scroll 에서는 안 한다),
    // 재시도 구간은 양수 델타만 스크롤하므로 수렴형이다(음수 정렬은 포커스당 1회 래치라 첫 회뿐이다).
    const reveal = () => {
      const p = pending.current
      if (!p) return
      if (!p.el.isConnected || document.activeElement !== p.el) { pending.current = null; return }
      const box = scrollParent(p.el)
      if (!box) return
      // getBoundingClientRect 는 layout viewport 기준이라 보이는 띠도 같은 프레임으로 환산한다.
      // vv.height 만 쓰면 팬된 만큼 틀린다.
      //
      // **하단선은 키보드 선과 스크롤러 자신의 잘린 하단 중 낮은 쪽이다(신고 d0833496).**
      // 모달은 키보드가 열리면 스스로 줄어든다(--modal-vvh). 그러면 필드가 키보드 선보다 위인데도
      // 줄어든 모달 하단 아래로 잘려 사각 띠에 숨는다. 키보드 선만 보면 '이미 보인다'로 오판해
      // 스크롤을 안 했고, 운영자는 품명 칸을 탭했는데 폼 상단만 보게 됐다.
      // 상단선도 같은 방식으로 스크롤러 상단과 visual viewport 상단 중 낮은 쪽을 쓴다.
      const boxRect = box.getBoundingClientRect()
      const kbLine = vv.offsetTop + vv.height
      const r = p.el.getBoundingClientRect()
      const delta = revealDelta({
        bandTop: Math.max(boxRect.top, vv.offsetTop),
        bandBottom: Math.min(kbLine, boxRect.bottom),
        fieldTop: r.top, fieldBottom: r.bottom,
        aligned: p.aligned,
      })
      if (delta !== 0) box.scrollTop += delta
      p.aligned = true
    }

    // 패딩이 실제로 반영된 다음 프레임에 잰다 — 그 전에는 스크롤 범위가 부족해 클램프된다
    const scheduleReveal = () => { if (pending.current) requestAnimationFrame(reveal) }

    // 복원은 정본 판정을 지난다 — 진짜 닫힘(엡실론)일 때만. 외장 바·줌 팬은 되감지 않는다.
    const restore = () => {
      const scrolled = window.scrollY !== 0 || vv.offsetTop > 0
      if (shouldRestore(snapNow(), scrolled)) window.scrollTo(0, 0)
    }
    // 크기 갱신은 resize 에서만. 팬 프레임마다 다시 쓰면 scrollHeight 가 오르내리며
    // scrollTop 이 계속 클램프돼 스크롤이 되감긴다. 팬 중 여유가 조금 넉넉한 것은 무해하다.
    // 불가능값 처리(상한)는 정본의 클램프가 맡는다 — 종전의 '기각 후 직전 값 유지'가 가로·소형
    // 창의 정당한 큰 겹침까지 버리던 것을 바로잡았다(오류신고 734ea211·e97f4b2b 경위는 정본 주석).
    const onResize = () => {
      const s = snapNow()
      if (!keyboardOpen(s)) {
        root.style.setProperty(KBD_INSET, '0px')
        root.removeAttribute(KBD_OPEN_ATTR)
        restore()
        return
      }
      root.style.setProperty(KBD_INSET, `${overlapInset(s)}px`)
      // 여백과 **같은 판정·같은 프레임**에 찍는다. 아래 scheduleReveal 은 rAF 라 이미 접힌
      // 기하를 읽는다 — setState 로 접으면 그 순서가 깨져 과소 스크롤이 난다(신고 d0833496).
      root.setAttribute(KBD_OPEN_ATTR, '')
      scheduleReveal()
    }
    const onScroll = () => { if (!keyboardOpen(snapNow())) restore() }

    // **복귀 재동기.** vv 의 resize·scroll 만 듣던 것이 오염을 영구화했다. 앱 전환·복귀,
    // bfcache 복귀, 회전처럼 그 두 이벤트가 안 오는 경로에서 값이 잘못 찍히면 씻을 기회가 없다.
    // 여기서 같은 판정을 한 번 더 돌려 스냅샷을 다시 적는다 — 스케일도 스냅샷에 실려 함께
    // 재평가된다(줌 중 앱 전환 복귀가 낡은 배율로 남지 않게, 패널 조건부).
    // rAF 로 한 박자 더 도는 이유 — 복귀·회전 직후 프레임의 visualViewport 는 아직 옛 값을 낼 수
    // 있다. 그 자리에서 한 번만 읽고 끝내면 오염된 값을 그대로 다시 쓰게 된다.
    const resync = () => { onResize(); requestAnimationFrame(onResize) }
    const onVisibility = () => { if (document.visibilityState === 'visible') resync() }

    const onFocusIn = (e: FocusEvent) => {
      if (!isEditable(e.target)) return
      // 기억만 한다. 이 시점엔 키보드가 아직 안 올라와 겹침이 0 이라 지금 재면 엉뚱한 데로 간다.
      pending.current = { el: e.target, aligned: false }
      // 다만 키보드가 이미 열려 있으면(칸에서 칸으로 이동) resize 가 안 와서 영영 안 불린다.
      // **여기 물음은 "열렸나"라 판정 함수를 쓴다(신고 716e7b0c).** 크기 함수를 쓰면 iOS 가
      // 팬한 만큼 값이 줄어 0까지 떨어지므로, 팬이 끝난 뒤의 칸-대-칸 이동에서 조용히
      // 아무 일도 안 하게 된다.
      if (keyboardOpen(snapNow())) scheduleReveal()
    }
    const onFocusOut = () => { pending.current = null }

    vv.addEventListener('resize', onResize)
    vv.addEventListener('scroll', onScroll)
    document.addEventListener('focusin', onFocusIn, true)
    document.addEventListener('focusout', onFocusOut, true)
    window.addEventListener('pageshow', resync)
    window.addEventListener('resize', resync)
    window.addEventListener('orientationchange', resync)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      vv.removeEventListener('resize', onResize)
      vv.removeEventListener('scroll', onScroll)
      document.removeEventListener('focusin', onFocusIn, true)
      document.removeEventListener('focusout', onFocusOut, true)
      window.removeEventListener('pageshow', resync)
      window.removeEventListener('resize', resync)
      window.removeEventListener('orientationchange', resync)
      document.removeEventListener('visibilitychange', onVisibility)
      root.style.removeProperty(KBD_INSET)
      root.removeAttribute(KBD_OPEN_ATTR)
    }
  }, [])
  return null
}
