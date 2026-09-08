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

import { useEffect, type RefObject } from 'react'

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
    return () => {
      ov?.removeEventListener('animationend', onOverlayEnd)
      pa?.removeEventListener('animationend', onPanelEnd)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active, overlayRef, panelRef, overlayClass, panelClass])
}
