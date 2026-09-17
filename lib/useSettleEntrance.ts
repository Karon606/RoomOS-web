'use client'
// 등장 모션을 **끝났음을 확인하고** 걷어내는 훅 — 오버레이가 첫 프레임에 굳는 것을 막는다.
//
// 왜 필요한가. .anim-overlay-in / .anim-panel-in 의 첫 프레임은 막 opacity 0, 패널
// translateY(10px) scale(.97) 이다(app/globals.css §25.3). 문서가 숨은 채(document.hidden)
// 마운트되면 애니메이션이 안 돌아 그 프레임에 멈추고, 돌아왔을 때 70% 막이 없는 반투명 모달이
// 뒤 목록을 비추고 제목이 앱 헤더 위로 겹쳐 보인다(신고 2026-09-08 "일부가 깨져보이는 현상").
//
// 이 저장소의 복귀 그물(scripts/check-overlay-resume-resync.mjs)은 여태 **퇴장만** 봤다. 거기에
// "등장이 멎으면 오버레이가 안 뜨고 말지 화면에 막이 남지 않는다"고 적었는데, 굳은 첫 프레임은
// 막이 거의 투명한 채로 남는 경로라 그 전제가 참이 아니었다. 그 짝을 여기 세운다.
//
// 시간 추정으로 지우지 않는다 — 벽시계로 마감하는 것이 바로 그 그물이 막는 함정이다.
// animationend 를 듣고, 숨어 있으면 아예 생략하며(모션 축소 설정이 도달하는 끝 상태와 같다),
// 숨은 사이 멎었을 수 있으니 돌아올 때 남은 것을 한 번 더 걷는다.
//
// **그런데 그것만으로는 네 번째 재현을 못 막았다**(신고 bf0a6fff, 2026-09-16). 이 이펙트는
// 페인트 뒤에 돈다. 모션이 시작된 뒤 리스너가 붙기 전에 화면이 잠깐 죽었다 살아나면
// visibilitychange 는 이미 지나갔고 animationend 는 영영 안 온다. 그 사이에 모션이 중간값에
// 굳으면(합성 레이어가 옛 프레임에 남는 자리) 막이 25~30% 로만 칠해진 채 남는다 — 등장 클래스가
// 계속 붙어 있으니 스타일 재계산도 안 일어난다.
//
// 그래서 **붙는 그 시점에 "지금 돌고 있는가"를 묻는다.** 안 돌고 있으면 기다릴 것이 없으므로 그
// 자리에서 걷고(클래스를 떼면 재계산이 일어나 굳은 프레임이 풀린다), 돌고 있으면 그 모션이
// 끝나기를 기다린다. 벽시계는 여전히 한 글자도 안 쓴다 — "얼마나 지났나"가 아니라 "무엇이
// 일어났나"만 본다. 수법은 계측(lib/viewportProbe)과 같은 정본 한 벌을 쓴다(lib/animationSettled).

import { useEffect, type RefObject } from 'react'
import { runningAnimations, whenAnimationsSettled } from '@/lib/animationSettled'

export function useSettleEntrance(opts: {
  /** 오버레이가 떠 있는 동안만 건다. */
  active: boolean
  overlayRef?: RefObject<HTMLElement | null>
  panelRef?: RefObject<HTMLElement | null>
  overlayClass?: string
  panelClass?: string
}): void {
  const { active, overlayRef, panelRef } = opts
  const overlayClass = opts.overlayClass ?? 'anim-overlay-in'
  const panelClass = opts.panelClass ?? 'anim-panel-in'
  useEffect(() => {
    if (!active) return
    const ov = overlayRef?.current ?? null
    const pa = panelRef?.current ?? null
    const settle = () => {
      ov?.classList.remove(overlayClass)
      pa?.classList.remove(panelClass)
    }
    // 숨은 채 마운트되면 애니메이션이 안 돌아 첫 프레임에 굳는다 — 모션을 생략한다.
    // 화면에 아무것도 안 그려지는 동안이라 생략이 보이지 않는다.
    if (document.hidden) { settle(); return }
    // animationend 는 거품이 올라온다. 대상을 확인하지 않으면 본문 안 짧은 애니메이션 하나가
    // 오버레이의 막을 먼저 떼어 낸다.
    const onOverlayEnd = (e: Event) => { if (e.target === ov) ov?.classList.remove(overlayClass) }
    const onPanelEnd = (e: Event) => { if (e.target === pa) pa?.classList.remove(panelClass) }
    const onVisible = () => { if (!document.hidden) settle() }
    ov?.addEventListener('animationend', onOverlayEnd)
    pa?.addEventListener('animationend', onPanelEnd)
    document.addEventListener('visibilitychange', onVisible)
    // **붙는 시점의 확인.** 이벤트는 앞으로 올 것만 말해 준다. 이미 끝났거나 굳어 있는 것은
    // 지금 물어야 안다 — 그 자리가 이 신고의 경로다. 엘리먼트마다 따로 본다(오버레이 160ms,
    // 패널 200ms 라 한쪽이 먼저 끝난다. 묶어서 기다리면 먼저 끝난 쪽이 괜히 늦게 걷힌다).
    let cancelled = false
    const settleWhenIdle = (el: HTMLElement | null, cls: string) => {
      if (!el) return
      const running = runningAnimations(el)
      if (running.length === 0) { el.classList.remove(cls); return }   // 안 돌고 있다 — 그 자리에서 걷는다
      void whenAnimationsSettled(running).then(() => { if (!cancelled) el.classList.remove(cls) })
    }
    settleWhenIdle(ov, overlayClass)
    settleWhenIdle(pa, panelClass)
    return () => {
      cancelled = true
      ov?.removeEventListener('animationend', onOverlayEnd)
      pa?.removeEventListener('animationend', onPanelEnd)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active, overlayRef, panelRef, overlayClass, panelClass])
}
