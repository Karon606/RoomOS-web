'use client'

// 보관 서류 뷰어 — 앱 안에서 서류를 여는 화면.
//
// 왜 필요한가(신고 f12c265b·083239c3)
//   종전에는 '보기'가 /api/doc-file 을 target="_blank" 로 열었다. 목적지가 순수 PDF 응답이라
//   우리 마크업이 0바이트고, 돌아가기 버튼을 넣을 자리 자체가 없었다. 복귀를 브라우저 크롬에
//   맡긴 설계인데 홈화면 앱(manifest display: standalone)에는 주소창도 뒤로가기도 없다.
//
// 왜 iframe 이 아니라 직접 그리는가(신고 56a0657b 실기)
//   iframe 으로 물렸더니 아이폰에서 **확대되어 잘리고, 2페이지가 아예 안 보이고, 인쇄 진입도 없었다.**
//   우리가 지정할 수 있는 것은 크기·테두리뿐이라 렌더러 내부에 개입할 표면이 없다.
//   pdfjs-dist 는 이미 이 앱의 의존성이고(저장 및 보내기가 쓴다) 전 페이지 순회 렌더도
//   lib/pdfToPng 에 이미 있다. 새 의존성 0, 새 개념 0으로 배율·페이지 수가 우리 손에 들어온다.
//   그리고 페이지가 우리 DOM 이 되므로 데스크톱에서는 브라우저 인쇄가 그대로 걸린다.
//
// **왜 확대를 우리가 만드는가(실기 확정 2026-08-04)**
//   같은 URL·HTML·viewport meta 인데 아이폰 사파리는 확대되고 홈화면 앱은 안 된다. 갤럭시는 둘 다 된다.
//   Android Chrome 과 iOS Safari 는 접근성 이유로 user-scalable=no 를 무시하고, **선언을 실제로
//   존중하는 유일한 환경이 홈화면 앱**이다. 운영자는 홈화면 앱으로 쓴다. 즉 이 사용자에게
//   브라우저 확대는 존재하지 않으므로 라우트 viewport 선언으로는 절대 풀리지 않는다.
//   이력을 봐도 홈화면 앱에서 확대가 열려 있던 기간은 없다 — manifest 의 standalone 과
//   루트의 userScalable:false 가 같은 커밋(7522e4e, 4/23)에서 함께 들어왔다.
//
// 확대는 종이 폭을 직접 키운다. transform 을 쓰지 않는 이유는 종이가 이미지 한 장이라
// 폭을 늘리는 것과 결과가 같으면서, 레이아웃이 실제로 넓어져 스크롤 범위가 저절로 따라오기 때문이다.
// transform 은 레이아웃을 안 바꿔서 스크롤 범위를 손으로 맞춰야 하고 그 동기화가 곧 결함이 된다.
//
// 스크롤 계약은 A(자체 스크롤러)다. 페이지를 세로로 쌓으므로 높이가 콘텐츠에서 나온다 —
// iframe 때처럼 flex:1 로 뷰포트 잔여를 채우면 1장짜리는 늘어나고 2장짜리는 잘린다.
//
// 액션 정본 — [저장 및 보내기] [인쇄]. 둘 다 문서를 앱 밖으로 내보내는 동사이고 **상단 크롬에 둔다**
// (운영자 규칙 6). 하단으로 내렸더니 2장짜리 계약서에서 종이를 다 지나쳐야 나왔다.
// 사진 저장은 '저장 및 보내기'가 흡수했다(§30.4) — 서류 종류로 버튼 수가 갈리던 마지막 자리였다.
// 확대는 문서에 아무 일도 하지 않고 시야만 바꾸는 뷰 상태라 여기 섞지 않는다. 확대해서 가운데를
// 읽는 동안에도 닿아야 하므로 우하단 부유다. 우리 확대는 종이만 키우므로 fixed 크롬이 안 끌려간다
// (신고 d9f93bdd 의 'sticky 가 시야 밖으로 밀린다'는 브라우저 확대 이야기라 여기엔 적용되지 않는다).
//
// 인쇄는 운영자 승인으로 동사 6번째가 됐다(2026-08-04). 종전 사전은 "인쇄는 보내기의 공유 시트 안에
// 있다"고 정했는데, **실기에서 iOS 가 웹이 넘긴 파일에 프린트를 안 열어주는 것이 확인됐다.**
// 페이지가 우리 DOM 이라 window.print() 가 공유 시트를 안 거치고 바로 걸린다.
// 발급·작성처럼 서류 상태를 바꾸는 동사는 여기 두지 않는다 — '보기'의 정의를 직접 깬다.

import { useCallback, useEffect, useRef, useState } from 'react'
import { pdfToPngBlobs } from '@/lib/pdfToPng'
import { Btn, btnClass } from '@/components/ui/Btn'
import { SendDocButton } from '@/components/ui/SendDocButton'
import { fetchDocBytes } from '@/lib/docBytes'
import {
  DocBackLink, docChromeStyle, docHintStyle, docRailStyle, docShellVars,
} from '@/components/doc/DocChrome'

// 첫 화면용 배율 — 저장 및 보내기의 사진(2.5)보다 한 단계 낮춘다. 다페이지 계약서에서 변환 시간이 줄어든다.
const VIEW_SCALE = 2
// 확대해서 읽기 시작하면 그때 다시 굽는다. 아이폰은 CSS 픽셀당 기기 픽셀이 3이라
// 배율 2(약 144dpi)로는 2배만 키워도 글자가 뭉갠다. 3.5 는 약 252dpi 다.
// 처음부터 3.5 로 구우면 픽셀이 3배라 첫 화면이 그만큼 늦어진다 — 확대할 때만 그 값을 치른다.
const HI_SCALE = 3.5
const HI_AT = 1.5
const Z_MIN = 1
const Z_MAX = 4
const Z_STEPS = [1, 1.5, 2, 3, 4]

const clampZ = (z: number) => Math.min(Z_MAX, Math.max(Z_MIN, z))

export default function DocViewer({ fileId, from, tenantId, fileName }: {
  fileId: string
  from?: string
  tenantId?: string
  fileName: string
}) {
  const [pages, setPages] = useState<string[] | null>(null)
  const [error, setError] = useState('')
  const [hiRes, setHiRes] = useState(false)
  const [z, setZ] = useState(1)

  const scrollRef = useRef<HTMLDivElement>(null)
  const paperRef = useRef<HTMLDivElement>(null)
  // 배율의 정본은 ref 다. 제스처 중에는 리렌더를 기다릴 수 없고, 스크롤 보정이
  // 배율 변경과 같은 프레임에서 끝나야 보던 줄이 안 튄다. state 는 표시용이다.
  const zRef = useRef(1)
  // 이전 회차 URL 은 새 회차가 뜬 뒤에 버린다. 먼저 버리면 다시 굽는 동안 이미지가 깨진다.
  const liveUrls = useRef<string[]>([])

  useEffect(() => () => { for (const u of liveUrls.current) URL.revokeObjectURL(u) }, [])

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await fetch(`/api/doc-file?id=${encodeURIComponent(fileId)}`)
        if (!res.ok) throw new Error('서류를 불러오지 못했습니다.')
        const blobs = await pdfToPngBlobs(await res.arrayBuffer(), hiRes ? HI_SCALE : VIEW_SCALE)
        if (!alive) return
        const urls = blobs.map(b => URL.createObjectURL(b))
        setPages(urls)
        for (const u of liveUrls.current) URL.revokeObjectURL(u)
        liveUrls.current = urls
      } catch (e) {
        if (alive) setError((e as Error).message || '서류를 여는 중 오류가 발생했습니다.')
      }
    })()
    return () => { alive = false }
  }, [fileId, hiRes])

  // 확대의 고정점은 손가락 사이(핀치)·탭 지점(더블탭)·화면 중앙(버튼)이다.
  // 종이 좌상단을 고정하면 확대할수록 보던 줄이 오른쪽 아래로 달아난다 —
  // 운영자가 "글의 위치를 지속적으로 트래킹하면서 읽는 것도 중요하다"고 한 것이 이 지점이다.
  const applyZoom = useCallback((next: number, anchorX: number, anchorY: number) => {
    const sc = scrollRef.current, paper = paperRef.current
    if (!sc || !paper) return
    const nz = clampZ(next)
    const cur = zRef.current
    if (nz === cur) return

    // 종이 안에서 고정점이 어디였는지를 먼저 잡는다. offset 을 함께 재는 이유는
    // 배율이 1을 넘는 순간 가운데 맞춤 여백이 0으로 접혀 종이의 시작 위치가 바뀌기 때문이다.
    const rect = sc.getBoundingClientRect()
    const ax = anchorX - rect.left, ay = anchorY - rect.top
    const cx = sc.scrollLeft + ax - paper.offsetLeft
    const cy = sc.scrollTop + ay - paper.offsetTop

    zRef.current = nz
    sc.style.setProperty('--z', String(nz))

    // 여기서 offset 을 다시 읽으면 위 대입이 반영된 값이 나온다(강제 리플로).
    const k = nz / cur
    sc.scrollLeft = paper.offsetLeft + cx * k - ax
    sc.scrollTop = paper.offsetTop + cy * k - ay

    setZ(nz)
    if (nz > HI_AT) setHiRes(true)
  }, [])

  const zoomAtCenter = useCallback((next: number) => {
    const sc = scrollRef.current
    if (!sc) return
    const r = sc.getBoundingClientRect()
    applyZoom(next, r.left + r.width / 2, r.top + r.height / 2)
  }, [applyZoom])

  // 핀치 — 두 손가락 거리비를 직접 잰다. gesturestart 는 WebKit 전용이고,
  // 브라우저가 확대를 거부하는 모드에서 뜨는지 확신할 수 없어 쓰지 않는다.
  // 표준 터치 이벤트는 표시 모드와 무관하게 뜬다.
  useEffect(() => {
    const sc = scrollRef.current
    if (!sc) return
    let base = 0, baseZ = 1

    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) { base = 0; return }
      base = dist(e.touches)
      baseZ = zRef.current
    }
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !base) return
      // 손가락이 둘일 때만 막는다. 통째로 막으면 한 손가락 스크롤까지 우리가 다시 만들어야 한다.
      e.preventDefault()
      const t = e.touches
      applyZoom(baseZ * (dist(t) / base), (t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2)
    }
    const onEnd = (e: TouchEvent) => { if (e.touches.length < 2) base = 0 }

    // passive: false 가 아니면 preventDefault 가 무시된다
    sc.addEventListener('touchstart', onStart, { passive: true })
    sc.addEventListener('touchmove', onMove, { passive: false })
    sc.addEventListener('touchend', onEnd, { passive: true })
    sc.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      sc.removeEventListener('touchstart', onStart)
      sc.removeEventListener('touchmove', onMove)
      sc.removeEventListener('touchend', onEnd)
      sc.removeEventListener('touchcancel', onEnd)
    }
  }, [applyZoom])

  // 더블탭 — 한 손으로 쓰는 대체 경로. 탭한 자리를 고정점으로 삼는다.
  const lastTap = useRef(0)
  const onPaperClick = (e: React.MouseEvent) => {
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
    const next = dir === 1
      ? Z_STEPS.find(s => s > cur + 0.001) ?? Z_MAX
      : [...Z_STEPS].reverse().find(s => s < cur - 0.001) ?? Z_MIN
    zoomAtCenter(next)
  }

  return (
    <div
      ref={scrollRef}
      className="doc-viewer h-dvh overflow-y-auto"
      style={{
        overflowX: 'auto',
        // 핀치만 우리가 가져가고 한 손가락 이동은 브라우저에 남긴다. none 으로 잠그면
        // 스크롤까지 직접 만들어야 하고 관성·바운스를 못 흉내낸다.
        touchAction: 'pan-x pan-y',
        background: 'var(--canvas)',
        padding: '16px 0 calc(16px + env(safe-area-inset-bottom, 0px))',
        ['--z' as string]: '1',
        ...docShellVars,
      } as React.CSSProperties}
    >
      {/* 확대하면 종이가 뷰포트보다 넓어진다. 트랙이 fit-content 여야 스크롤 범위가 실제로 늘어난다.
          가운데 맞춤을 align-items 가 아니라 좌우 auto 여백으로 하는 이유 — flex 의 가운데 정렬은
          남는 공간이 음수일 때 **왼쪽으로도 넘겨** 그 부분에 영영 못 닿게 한다(scrollLeft 가 음수가 못 된다).
          auto 여백은 넘칠 때 0으로 접혀 왼쪽에 붙고, 안 넘칠 때만 가운데로 간다. 한 처방이 두 상태를 다 맞춘다. */}
      <div style={{ minWidth: '100%', width: 'fit-content', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
        {/* 실행 동사는 상단이다(운영자 규칙 6 '미리보기 화면 상단 액션').
            흐름 안 하단바로 내렸더니 2장짜리 계약서에서는 종이를 다 지나쳐야 버튼이 나왔다 —
            읽는 화면일수록 문서가 길어서 하단은 사실상 닿지 않는 자리다(운영자 지적 2026-08-04). */}
        <div data-peek-hide className="no-print" style={docChromeStyle}>
          <DocBackLink from={from} tenantId={tenantId} />
          <div style={{ flex: 1 }} />
          {pages && (
            <>
              <SendDocButton getPdfBytes={fetchDocBytes(fileId)} fileName={fileName}
                label="저장 및 보내기" className={btnClass('secondary', 'md')} />
              <Btn variant="primary" size="md" onClick={() => window.print()}>인쇄</Btn>
            </>
          )}
        </div>

        {/* 장수만 알린다. 인쇄는 버튼이 실물로 서 있으니 경로 안내가 필요 없다. */}
        {pages && pages.length > 1 && (
          <p className="no-print" style={docHintStyle}>
            {pages.length}장짜리 서류입니다. 아래로 넘기면 다음 장이 있습니다.
          </p>
        )}

        {error ? (
          // 실패를 흰 사각형으로 두지 않는다 — 이번 신고가 다른 얼굴로 돌아온다(§27.2)
          <p style={{ ...docRailStyle, fontSize: 13, color: 'var(--danger-fg)' }}>{error}</p>
        ) : !pages ? (
          <div className="animate-pulse" style={{
            ...docRailStyle, aspectRatio: '210 / 297', borderRadius: 10, background: 'var(--cream)',
          }} />
        ) : (
          <div ref={paperRef} onClick={onPaperClick} style={{
            ...docRailStyle, width: 'calc(var(--rail) * var(--z))',
            display: 'flex', flexDirection: 'column',
          }}>
            {pages.map((src, i) => (
              // 종이는 항상 흰색 — 인쇄 문서는 모드 불변이다(§28). 셸 배경만 토큰으로 뒤집힌다.
              // eslint-disable-next-line @next/next/no-img-element
              <img key={src} src={src} alt={`${i + 1}쪽`} draggable={false} style={{
                width: '100%', height: 'auto', display: 'block', flex: 'none',
                borderRadius: 10, background: '#FFFFFF',
                boxShadow: '0 6px 24px rgba(0,0,0,.14)',
                marginBottom: i === pages.length - 1 ? 0 : 12,
              }} />
            ))}
          </div>
        )}

      </div>

      {/* 확대 컨트롤 — 확대해도 같이 커지면 안 되므로 변환 밖 부유다.
          배율 숫자를 누르면 원래 크기로 돌아온다. 확대에도 되돌리기가 있어야 한다. */}
      {pages && (
        <div data-peek-hide className="no-print" style={{
          position: 'fixed', right: 16, bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
          zIndex: 'var(--z-pill)' as unknown as number,
          display: 'flex', alignItems: 'center', gap: 2,
          background: 'var(--cream)', border: '1px solid var(--warm-border)',
          borderRadius: 999, padding: 4,
          boxShadow: '0 16px 48px -16px rgba(61,36,24,.22)',
        }}>
          <button type="button" onClick={() => step(-1)} disabled={z <= Z_MIN} aria-label="축소"
            style={zBtn(z <= Z_MIN)}>−</button>
          <button type="button" onClick={() => zoomAtCenter(1)} disabled={z === 1}
            aria-label={`현재 배율 ${z}배, 눌러서 원래 크기로`}
            style={{
              minWidth: 52, height: 44, border: 0, background: 'transparent',
              color: z === 1 ? 'var(--ink-s)' : 'var(--tc-text)',
              fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
              cursor: z === 1 ? 'default' : 'pointer',
            }}>{z % 1 === 0 ? z : z.toFixed(1)}배</button>
          <button type="button" onClick={() => step(1)} disabled={z >= Z_MAX} aria-label="확대"
            style={zBtn(z >= Z_MAX)}>+</button>
        </div>
      )}
    </div>
  )
}

// §09 44px. 확대 컨트롤은 크롬이라 배율에 안 눌린다 — 종이 위 컨트롤과 달리 액면 그대로 적용된다.
function zBtn(off: boolean): React.CSSProperties {
  return {
    width: 44, height: 44, border: 0, borderRadius: 999, background: 'transparent',
    color: off ? 'var(--ink-s)' : 'var(--tc-text)', fontSize: 20, lineHeight: 1,
    cursor: off ? 'default' : 'pointer',
  }
}
