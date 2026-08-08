'use client'

import React from 'react'
import { confirmDialog } from './ConfirmDialog'
import { PeekSheet } from './PeekSheet'
import { lockBackgroundScroll, unlockBackgroundScroll } from '@/lib/scrollLock'

type Width = 'xs' | 'sm' | 'md' | 'lg' | '2xl'

const WIDTH_CLS: Record<Width, string> = {
  xs: 'max-w-xs',
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  '2xl': 'max-w-2xl',   // 넓은 표 모달(전체 재고 보정 등)
}

// Esc 처리용 전역 스택 — 모달이 겹쳐 있을 때(z 260/280) Esc 는 최상단(마지막 마운트)만 닫는다.
let modalSeq = 0
const escStack: number[] = []

// 배경 스크롤 잠금은 lib/scrollLock 이 담당한다. 셸 페이지는 html·body 가 이미 overflow:hidden 이라
// 무동작이고, DocumentScroll 로 문서 스크롤을 켠 셸 밖 페이지에서만 실제로 잠긴다.
// body position:fixed 잠금은 iOS 상·하단 바가 밀리는 회귀 전례가 있어 쓰지 않는다(신고 d4cf82d5).
// 키보드 잔존 오프셋(신고 6c196aeb)은 전역 ViewportOffsetGuard 가 담당한다.

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  width = 'sm',
  onBack,
  headerExtra,
  footer,
  children,
  // 기본 = 헤더 정합 패딩(px-5 sm:px-6 py-4). 풀블리드가 필요하면 bodyClassName='' 을 명시하고 사유 주석을 남긴다.
  bodyClassName = 'px-5 sm:px-6 py-4',
  z = 200,
  dirty = false,
}: {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  subtitle?: React.ReactNode
  width?: Width
  onBack?: () => void
  headerExtra?: React.ReactNode      // 제목 옆 배지·태그용
  footer?: React.ReactNode
  children: React.ReactNode
  bodyClassName?: string
  z?: 200 | 260 | 280 | 380          // 다른 모달 위에 겹쳐 띄울 때 (통합 상세 모달 등). 380=시스템 오버레이(오류신고) — 모든 모달·컨펌 위
  /** v2.0 §12 입력 유실 방지 — true 면 배경클릭 무시, Esc·X 는 닫기 확인 1회 */
  dirty?: boolean
}) {
  // dirty 닫기 정책 — Esc/X 는 "작성 중인 내용이 있습니다" 확인을 거친다.
  // ref 로 들고 있어 Esc 핸들러 재등록 없이 최신값 사용. asking 플래그는
  // 확인 다이얼로그가 떠 있는 동안 Esc 연타로 다이얼로그가 중첩되는 것을 막는다.
  // 살짝 보기 — 입력을 잃지 않고 다른 페이지를 작은 창으로 참조(전 모달 공통, 운영자 아이디어 2026-07-09)
  const [peek, setPeek] = React.useState(false)
  const [framed, setFramed] = React.useState(false)
  React.useEffect(() => {
    try { setFramed(window.self !== window.top) } catch { setFramed(true) }
  }, [])
  // 가상 키보드 대응. 키보드가 열리면 실제 보이는 높이(visualViewport)는 줄지만 100dvh 는 그대로라
  // 본문 하단(메모 등)이 키보드에 가리고 스크롤이 튕긴다. 실제 높이를 CSS 변수로만 반영하고
  // maxHeight 계산식에 끼워 넣는다(height 로 고정하지 않음. 작은 모달이 늘어난다).
  // body 고정은 하지 않는다(위 주석의 신고 d4cf82d5 회귀). visualViewport 미지원이면 100dvh 폴백 그대로.
  //
  // 값을 setState 가 아니라 패널 style 에 명령형으로 기록한다(신고 d0833496). setState 로 반영하면
  // 패널 축소가 resize 핸들러보다 늦은 별도 태스크에 떨어지는데, ViewportOffsetGuard 의 재노출 rAF 는
  // 같은 rendering update 안에서 돌아 React flush 를 못 본다. 그러면 가드가 축소 전 기하를 읽어
  // 스크롤러가 아직 안 넘친다고 판단해 무동작이거나 최대 scrollTop 에 클램프돼 과소 스크롤이 되고,
  // 패딩(동기)과 축소(비동기)가 두 프레임으로 갈려 상단이 왕복하며 튄다. 명령형 기록은 resize
  // 핸들러 안에서 끝나므로 같은 프레임에 축소된 기하가 확정되고 가드가 그것을 읽는다.
  //
  // **보이는 띠는 높이만이 아니라 위치도 갖는다(신고 8e6bbac0 후속, 2026-08-09).**
  // iOS 는 문서를 스크롤할 수 없으면 포커스 칸을 드러내려고 visual viewport 자체를 위로 민다
  // (`vv.offsetTop` > 0). `position:fixed` 오버레이는 layout viewport 에 붙어 있어 그만큼 따라가지
  // 않는다. 종전에는 아래쪽만 `--kbd-inset` 으로 보정하고 위쪽에는 팬 항이 없어서, `items-center`
  // 의 정렬 프레임이 보이는 띠보다 위에 남았다. 실측(아이폰 16 Pro, 402x874, vv.height 547,
  // 팬 327)으로 패널 상단이 화면 위로 88.5pt 잘리고 하단은 키보드에서 213.5pt 떠 그 사이로 배경이
  // 드러났다. 상·하 어긋남의 차가 항상 safe-area+2rem(=125pt)인 것이 이 클래스의 지문이다.
  //
  // 그래서 오버레이의 위·아래 인셋을 **같은 vv 스냅샷 한 벌**로 적는다.
  //   --modal-vv-top    = vv.offsetTop                          (띠의 위가 layout 어디인가)
  //   --modal-vv-bottom = innerHeight - (offsetTop + vv.height) (띠의 아래에서 얼마가 남는가)
  // 셋을 합치면 오버레이의 content box 가 보이는 띠와 정확히 같아진다.
  //
  // **팬은 `resize` 가 아니라 `scroll` 로 온다.** 그래서 이 sync 는 두 이벤트를 다 듣는다.
  // 716e7b0c 의 "크기 갱신은 resize 에서만" 규칙과 충돌하지 않는다 — 그 규칙의 대상은 스크롤러의
  // 패딩(`.app-main` 의 `--kbd-inset`)이고, 그것을 팬마다 다시 쓰면 scrollHeight 가 오르내려
  // scrollTop 이 되감긴다. 여기서 팬마다 바뀌는 값은 오버레이 패딩뿐이라 패널을 **옮기기만** 하고
  // 높이는 안 건드린다(`--modal-vvh` 는 팬 불변). 본문 스크롤러의 clientHeight·scrollTop 이
  // 그대로임을 헤드리스 실측으로 확인했다. `--kbd-inset` 은 손대지 않는다.
  const panelRef = React.useRef<HTMLDivElement>(null)
  const overlayRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!open) return
    const vv = window.visualViewport
    if (!vv) return
    let lastTop = '', lastBottom = ''
    const sync = () => {
      panelRef.current?.style.setProperty('--modal-vvh', `${vv.height}px`)
      const ov = overlayRef.current
      if (!ov) return
      const top = `${Math.max(0, Math.round(vv.offsetTop))}px`
      const bottom = `${Math.max(0, Math.round(window.innerHeight - (vv.offsetTop + vv.height)))}px`
      if (top !== lastTop) { ov.style.setProperty('--modal-vv-top', top); lastTop = top }
      if (bottom !== lastBottom) { ov.style.setProperty('--modal-vv-bottom', bottom); lastBottom = bottom }
    }
    sync()
    vv.addEventListener('resize', sync)
    vv.addEventListener('scroll', sync)
    return () => {
      vv.removeEventListener('resize', sync)
      vv.removeEventListener('scroll', sync)
      panelRef.current?.style.removeProperty('--modal-vvh')
      overlayRef.current?.style.removeProperty('--modal-vv-top')
      overlayRef.current?.style.removeProperty('--modal-vv-bottom')
    }
  }, [open])
  const dirtyRef = React.useRef(dirty)
  dirtyRef.current = dirty
  const askingRef = React.useRef(false)
  const requestClose = React.useCallback(async () => {
    if (askingRef.current) return
    if (dirtyRef.current) {
      askingRef.current = true
      try {
        const ok = await confirmDialog({
          title: '작성 중인 내용이 있습니다. 닫을까요?',
          confirmLabel: '닫기', cancelLabel: '계속 작성',
        })
        if (!ok) return
      } finally { askingRef.current = false }
    }
    onClose()
  }, [onClose])
  // 배경 스크롤 잠금 — 문서 스크롤이 켜진 셸 밖 페이지에서만 실제 효과(셸 페이지는 무동작)
  React.useEffect(() => {
    if (!open) return
    lockBackgroundScroll()
    return () => unlockBackgroundScroll()
  }, [open])

  // Esc 로 닫기 — 배경 클릭과 동일하게 동작(키보드 기대 일관성).
  // 겹친 모달에서는 최상단 것만 닫히도록 전역 스택으로 판별.
  React.useEffect(() => {
    if (!open) return
    const id = ++modalSeq
    escStack.push(id)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (escStack[escStack.length - 1] !== id) return
      void requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      const idx = escStack.indexOf(id)
      if (idx >= 0) escStack.splice(idx, 1)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, requestClose])

  if (!open) return null
  // v2.0 §12 — dirty 면 배경클릭(아래 onClick)은 조용히 무시(대부분 오조작), 닫기는 Esc·X 확인 경로로만
  // v2.0 §08 레이어 토큰 매핑 — 호출부 API(200/260/280)는 유지, 실제 z는 토큰
  const zClass = z === 380 ? 'z-[var(--z-report)]' : z === 280 ? 'z-[var(--z-modal-3)]' : z === 260 ? 'z-[var(--z-modal-2)]' : 'z-[var(--z-modal)]'
  return (
    <div
      ref={overlayRef}
      className={`fixed inset-0 bg-black/70 ${zClass} flex items-center justify-center anim-overlay-in`}
      // 안전 영역(상태바·다이내믹 아일랜드·홈 인디케이터)을 피해 패딩 —
      // 모달 헤더의 닫기 버튼이 상태바에 가려지지 않도록.
      //
      // 위·아래에 보이는 띠의 위치를 더한다(신고 e8a2c73e·8e6bbac0). items-center 는 layout viewport
      // 전체의 세로 중앙이라, 키보드가 열려 패널이 --modal-vvh 로 줄면 줄어든 패널이 '키보드 뒤까지
      // 포함한' 한가운데로 재정렬되며 통째로 내려앉았고(e8a2c73e), 아래만 보정하면 iOS 가 팬한 만큼
      // 정렬 프레임이 위에 남아 상단이 화면 밖으로 잘렸다(8e6bbac0). 두 항을 다 더해야 content box 가
      // 보이는 띠와 같아진다. --modal-vvh(maxHeight)와 짝이다. 하나는 "얼마나 클 수 있나", 하나는
      // "어디에 놓이나". 세 값 모두 위 이펙트가 같은 vv 스냅샷으로 적는다.
      // --kbd-inset 폴백은 이펙트가 돌기 전(첫 페인트)·visualViewport 미지원 환경용이다.
      style={{
        paddingTop:    'calc(max(1rem, env(safe-area-inset-top)) + var(--modal-vv-top, 0px))',
        paddingBottom: 'calc(max(1rem, env(safe-area-inset-bottom)) + var(--modal-vv-bottom, var(--kbd-inset, 0px)))',
        paddingLeft:   'max(1rem, env(safe-area-inset-left))',
        paddingRight:  'max(1rem, env(safe-area-inset-right))',
      }}
      onClick={dirty ? undefined : onClose}
    >
      <div
        ref={panelRef}
        className={`bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl shadow-lift w-full ${WIDTH_CLS[width]} flex flex-col anim-panel-in`}
        // 뷰포트 기준 calc — 안전영역 안쪽으로 최대 높이 한정 (% 만으로는 2rem 여유가 안 생긴다)
        // --modal-vvh 는 키보드가 열렸을 때의 실제 보이는 높이. 위 이펙트가 명령형으로 기록한다.
        // 미설정이면(visualViewport 없음·닫힘) 100dvh 폴백.
        //
        // 100% 는 안전망이다. 오버레이 content box(= 보이는 띠) 를 절대 못 넘게 한다. 평시에는
        // calc 쪽이 2rem 작아 늘 이기므로 픽셀이 안 바뀌고, --modal-vvh 갱신이 어떤 이유로든
        // 늦거나 빠진 프레임에서만 발동해 패널이 띠 밖으로 넘쳐 상·하가 잘리는 것을 막는다.
        style={{
          maxHeight: 'min(calc(var(--modal-vvh, 100dvh) - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 2rem), 100%)',
        } as React.CSSProperties}
        onClick={e => e.stopPropagation()}
      >
        {(title || onBack) && (
          <div className="flex items-center justify-between gap-2 px-5 sm:px-6 py-4 border-b border-[var(--warm-border)] shrink-0">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {onBack && (
                <button
                  type="button"
                  onClick={onBack}
                  className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] w-11 h-11 flex items-center justify-center rounded-lg hover:bg-[var(--canvas)] transition-colors shrink-0"
                  title="뒤로"
                ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></button>
              )}
              <div className="min-w-0">
                {typeof title === 'string'
                  ? <h2 className="text-base font-bold text-[var(--warm-dark)] truncate">{title}</h2>
                  : title}
                {subtitle && <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5 line-clamp-2">{subtitle}</p>}   {/* truncate는 긴 안내가 잘림(신고 e32c60ab) — 2줄까지 표시 */}
              </div>
              {headerExtra}
            </div>
            {!framed && (
              <button
                type="button"
                onClick={() => setPeek(true)}
                className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] w-11 h-11 flex items-center justify-center rounded-lg hover:bg-[var(--canvas)] transition-colors shrink-0"
                title="살짝 보기 · 입력 유지한 채 다른 페이지 확인"
              ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.6"/></svg></button>
            )}
            <button
              type="button"
              onClick={() => void requestClose()}
              className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] w-11 h-11 flex items-center justify-center rounded-lg hover:bg-[var(--canvas)] transition-colors shrink-0"
              title="닫기"
            ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
          </div>
        )}
        <div className={`flex-1 overflow-y-auto overscroll-contain ${bodyClassName}`}>
          {children}
        </div>
        {footer && (
          <div className="border-t border-[var(--warm-border)] px-5 sm:px-6 py-3 shrink-0">
            {footer}
          </div>
        )}
      </div>
      <PeekSheet open={peek} onClose={() => setPeek(false)} />
    </div>
  )
}

// 모달 푸터의 표준 버튼 영역 — 취소(좌) + 주 액션(우)
export function ModalFooterActions({
  onCancel,
  cancelLabel = '취소',
  children,
  align = 'end',
}: {
  onCancel?: () => void
  cancelLabel?: string
  children?: React.ReactNode    // 주 액션 버튼들 (우측)
  align?: 'split' | 'end'        // split: 양쪽 끝, end: 우측 정렬
}) {
  return (
    <div className={`flex items-center gap-2 flex-wrap ${align === 'split' ? 'justify-between' : 'justify-end'}`}>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2.5 min-h-[40px] text-sm rounded-lg bg-[var(--canvas)] hover:bg-[var(--warm-border)] text-[var(--warm-dark)] border border-[var(--warm-border)] transition-colors"
        >
          {cancelLabel}
        </button>
      )}
      <div className="flex items-center gap-2 flex-wrap">{children}</div>
    </div>
  )
}
