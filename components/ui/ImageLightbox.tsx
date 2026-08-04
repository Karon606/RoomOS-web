'use client'

// 이미지 확대 보기 — 앱 안에서 연다.
//
// 종전에는 영수증을 target="_blank" 로 던졌다. 목적지가 순수 이미지 응답이라 우리 마크업이 0바이트고,
// 홈화면 앱(manifest display: standalone)에는 주소창도 뒤로가기도 없어 **편도가 된다**.
// 운영자 신고 그대로다 — "영수증이 확대되는데 원래 사이즈 또는 뒤로 돌아가기가 안돼"(9cf510fe).
// 계약서 '보기'가 같은 사고를 냈고(f12c265b·083239c3) 앱 안 뷰어로 고쳤다. 이건 그 클래스의 나머지다.
//
// 확대를 우리가 만드는 이유 — 아이폰 홈화면 앱은 viewport 선언과 무관하게 사용자 확대를 안 준다.
// 선언을 실제로 존중하는 유일한 환경이 그 표시 모드다(knowledge/mobile-scroll-viewport.md 표시 모드 절).
// 그래서 브라우저 확대에 기댈 수 없다. 서류 뷰어(app/doc/[fileId]/DocViewer.tsx)와 같은 방식이다 —
// transform 이 아니라 **폭을 직접 늘린다.** 레이아웃이 실제로 넓어져 스크롤 범위가 저절로 따라온다.

import { useCallback, useEffect, useRef, useState } from 'react'

const Z_MIN = 1
const Z_MAX = 5
const Z_STEPS = [1, 1.5, 2, 3, 5]
const clampZ = (z: number) => Math.min(Z_MAX, Math.max(Z_MIN, z))

export function ImageLightbox({ src, alt = '이미지', onClose }: {
  src: string
  alt?: string
  onClose: () => void
}) {
  const [z, setZ] = useState(1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  // 배율의 정본은 ref 다. 제스처 중에는 리렌더를 기다릴 수 없고, 스크롤 보정이 같은 프레임에서
  // 끝나야 보던 자리가 안 튄다. state 는 표시용이다.
  const zRef = useRef(1)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // 고정점은 손가락 사이·탭 지점·화면 중앙이다. 좌상단을 고정하면 확대할수록 보던 곳이 달아난다.
  const applyZoom = useCallback((next: number, anchorX: number, anchorY: number) => {
    const sc = scrollRef.current, img = imgRef.current
    if (!sc || !img) return
    const nz = clampZ(next)
    const cur = zRef.current
    if (nz === cur) return
    const rect = sc.getBoundingClientRect()
    const ax = anchorX - rect.left, ay = anchorY - rect.top
    const cx = sc.scrollLeft + ax - img.offsetLeft
    const cy = sc.scrollTop + ay - img.offsetTop
    zRef.current = nz
    sc.style.setProperty('--z', String(nz))
    const k = nz / cur
    sc.scrollLeft = img.offsetLeft + cx * k - ax
    sc.scrollTop = img.offsetTop + cy * k - ay
    setZ(nz)
  }, [])

  const zoomAtCenter = useCallback((next: number) => {
    const sc = scrollRef.current
    if (!sc) return
    const r = sc.getBoundingClientRect()
    applyZoom(next, r.left + r.width / 2, r.top + r.height / 2)
  }, [applyZoom])

  // 핀치 — 두 손가락 거리비를 직접 잰다. gesturestart 는 WebKit 전용이라 안 쓴다.
  useEffect(() => {
    const sc = scrollRef.current
    if (!sc) return
    let base = 0, baseZ = 1
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) { base = 0; return }
      base = dist(e.touches); baseZ = zRef.current
    }
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !base) return
      e.preventDefault()   // 손가락이 둘일 때만 막는다. 통째로 막으면 한 손가락 스크롤을 직접 만들어야 한다
      const t = e.touches
      applyZoom(baseZ * (dist(t) / base), (t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2)
    }
    const onEnd = (e: TouchEvent) => { if (e.touches.length < 2) base = 0 }
    sc.addEventListener('touchstart', onStart, { passive: true })
    sc.addEventListener('touchmove', onMove, { passive: false })   // passive 면 preventDefault 가 무시된다
    sc.addEventListener('touchend', onEnd, { passive: true })
    sc.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      sc.removeEventListener('touchstart', onStart)
      sc.removeEventListener('touchmove', onMove)
      sc.removeEventListener('touchend', onEnd)
      sc.removeEventListener('touchcancel', onEnd)
    }
  }, [applyZoom])

  const lastTap = useRef(0)
  const onImgClick = (e: React.MouseEvent) => {
    const now = e.timeStamp
    if (now - lastTap.current < 320) {
      lastTap.current = 0
      applyZoom(zRef.current > 1 ? 1 : 2.5, e.clientX, e.clientY)
      return
    }
    lastTap.current = now
  }

  const step = (dir: 1 | -1) => {
    const cur = zRef.current
    zoomAtCenter(dir === 1
      ? Z_STEPS.find(s => s > cur + 0.001) ?? Z_MAX
      : [...Z_STEPS].reverse().find(s => s < cur - 0.001) ?? Z_MIN)
  }

  return (
    <div className="fixed inset-0 anim-overlay-in" style={{ zIndex: 'var(--z-modal)' as unknown as number, background: 'rgba(0,0,0,.88)' }}>
      {/* 닫기는 항상 같은 자리에 있다. 확대해도 안 밀린다 — 우리 확대는 이미지 폭만 키운다. */}
      <button type="button" onClick={onClose} aria-label="닫기"
        style={{
          position: 'fixed', top: 'calc(12px + env(safe-area-inset-top, 0px))', right: 12,
          width: 44, height: 44, borderRadius: 999, border: 0,
          background: 'rgba(0,0,0,.55)', color: '#fff', fontSize: 20, lineHeight: 1, cursor: 'pointer',
          zIndex: 1,
        }}>×</button>

      <div ref={scrollRef} className="h-dvh overflow-y-auto"
        style={{ overflowX: 'auto', touchAction: 'pan-x pan-y', ['--z' as string]: '1' } as React.CSSProperties}>
        {/* 확대하면 이미지가 뷰포트보다 넓어진다. 트랙이 fit-content 여야 스크롤 범위가 실제로 늘어난다.
            가운데 맞춤은 flex 정렬이 아니라 좌우 auto 여백으로 한다 — flex 의 가운데 정렬은 남는 공간이
            음수일 때 왼쪽으로도 넘겨 그 부분에 영영 못 닿게 한다(scrollLeft 가 음수가 못 된다). */}
        <div style={{ minWidth: '100%', width: 'fit-content', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '64px 0' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={imgRef} src={src} alt={alt} draggable={false} onClick={onImgClick}
            style={{ width: 'calc((100vw - 24px) * var(--z))', height: 'auto', display: 'block', marginInline: 'auto' }} />
        </div>
      </div>

      {/* 배율 숫자를 누르면 원래 크기로 돌아온다. 확대에도 되돌리기가 있어야 한다. */}
      <div style={{
        position: 'fixed', right: 16, bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
        display: 'flex', alignItems: 'center', gap: 2,
        background: 'rgba(0,0,0,.55)', borderRadius: 999, padding: 4,
      }}>
        <button type="button" onClick={() => step(-1)} disabled={z <= Z_MIN} aria-label="축소" style={pillBtn(z <= Z_MIN)}>−</button>
        <button type="button" onClick={() => zoomAtCenter(1)} disabled={z === 1} aria-label={`현재 배율 ${z}배, 눌러서 원래 크기로`}
          style={{
            minWidth: 52, height: 44, border: 0, background: 'transparent',
            color: z === 1 ? 'rgba(255,255,255,.5)' : '#fff', fontSize: 13, fontWeight: 600,
            fontVariantNumeric: 'tabular-nums', cursor: z === 1 ? 'default' : 'pointer',
          }}>{z % 1 === 0 ? z : z.toFixed(1)}배</button>
        <button type="button" onClick={() => step(1)} disabled={z >= Z_MAX} aria-label="확대" style={pillBtn(z >= Z_MAX)}>+</button>
      </div>
    </div>
  )
}

// §09 44px. 확대 컨트롤은 크롬이라 배율에 안 눌린다.
function pillBtn(off: boolean): React.CSSProperties {
  return {
    width: 44, height: 44, border: 0, borderRadius: 999, background: 'transparent',
    color: off ? 'rgba(255,255,255,.4)' : '#fff', fontSize: 20, lineHeight: 1,
    cursor: off ? 'default' : 'pointer',
  }
}
