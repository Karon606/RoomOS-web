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
//   pdfjs-dist 는 이미 이 앱의 의존성이고(사진 저장·보내기가 쓴다) 전 페이지 순회 렌더도
//   lib/pdfToPng 에 이미 있다. 새 의존성 0, 새 개념 0으로 배율·페이지 수가 우리 손에 들어온다.
//   그리고 페이지가 우리 DOM 이 되므로 데스크톱에서는 브라우저 인쇄가 그대로 걸린다.
//
// 스크롤 계약은 A(자체 스크롤러)다. 페이지를 세로로 쌓으므로 높이가 콘텐츠에서 나온다 —
// iframe 때처럼 flex:1 로 뷰포트 잔여를 채우면 1장짜리는 늘어나고 2장짜리는 잘린다.
//
// 툴바에 액션을 얹지 않는다. 목록 행이 이미 보내기·삭제를 갖고 있고, '보기'는 서류 정본 동사 중
// "아무것도 만들지 않는" 동사다(knowledge/doc-vocabulary.md).

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { pdfToPngBlobs } from '@/lib/pdfToPng'

// 어디서 왔는지는 **열거 키**로만 받는다. 경로를 받으면 오픈 리디렉트가 되고,
// 라벨을 받으면 우리 크롬 안에 임의 문자열이 그려진다. 라벨은 각 목적지 h1 을 그대로 옮겼다.
const BACK: Record<string, { label: string; href: string }> = {
  contracts:         { label: '계약서',              href: '/contracts' },
  'rent-receipts':   { label: '납부 확인서 · 영수증', href: '/rent-receipts' },
  'residence-certs': { label: '실거주 확인서',        href: '/residence-certs' },
}
const HOME = { label: '홈', href: '/dashboard' }

// 표시용 배율 — 사진 저장(2.5)보다 한 단계 낮춘다. 화면은 저장본만큼 클 필요가 없고
// 다페이지 계약서에서 변환 시간과 메모리가 줄어든다.
const VIEW_SCALE = 2
const RAIL = 'min(210mm, 100% - 24px)'

export default function DocViewer({ fileId, from, tenantId }: {
  fileId: string
  from?: string
  tenantId?: string
}) {
  const back = from === 'tenant' && tenantId
    ? { label: '입실자 정보', href: `/tenants?tenantId=${encodeURIComponent(tenantId)}` }
    : (from ? BACK[from] : undefined) ?? HOME

  const [pages, setPages] = useState<string[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    const urls: string[] = []
    void (async () => {
      try {
        const res = await fetch(`/api/doc-file?id=${encodeURIComponent(fileId)}`)
        if (!res.ok) throw new Error('서류를 불러오지 못했습니다.')
        const blobs = await pdfToPngBlobs(await res.arrayBuffer(), VIEW_SCALE)
        if (!alive) return
        for (const b of blobs) urls.push(URL.createObjectURL(b))
        setPages(urls)
      } catch (e) {
        if (alive) setError((e as Error).message || '서류를 여는 중 오류가 발생했습니다.')
      }
    })()
    return () => {
      alive = false
      for (const u of urls) URL.revokeObjectURL(u)
    }
  }, [fileId])

  return (
    <div className="h-dvh overflow-y-auto" style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      background: 'var(--canvas)',
      padding: '16px 0 calc(16px + env(safe-area-inset-bottom, 0px))',
    }}>
      <div data-peek-hide className="no-print" style={{
        width: RAIL, flex: 'none', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '10px 14px', background: 'var(--cream)',
        border: '1px solid var(--cream-3)', borderRadius: 10, marginBottom: 10,
        boxShadow: '0 4px 12px rgba(0,0,0,.06)',
      }}>
        {/* 히트 영역 44px — 형제 서류 화면의 복귀 링크는 패딩 없는 13px 라 히트가 약 18px 이다(§09 위반).
            새 화면에 그 위반을 복사하지 않는다. 보이는 크기는 13px 그대로 둔다. */}
        <Link href={back.href} style={{
          color: 'var(--tc-text)', fontSize: 13, textDecoration: 'none',
          display: 'inline-flex', alignItems: 'center', minHeight: 44,
        }}>{'‹'} {back.label}</Link>
      </div>

      {/* 인쇄는 새 동사가 아니다 — 폰은 목록의 보내기가 여는 공유 시트 안에 프린터가 있고,
          데스크톱은 이 화면을 그대로 인쇄하면 된다(툴바·안내는 no-print 로 빠진다). */}
      <p className="no-print" style={{ width: RAIL, fontSize: 12, color: 'var(--ink-s)', margin: '0 0 12px' }}>
        {pages && pages.length > 1 ? `${pages.length}장짜리 서류입니다. ` : ''}
        인쇄하거나 파일로 저장하려면 목록에서 보내기를 누르세요.
      </p>

      {error ? (
        // 실패를 흰 사각형으로 두지 않는다 — 이번 신고가 다른 얼굴로 돌아온다(§27.2)
        <p style={{ width: RAIL, fontSize: 13, color: 'var(--danger-fg)' }}>{error}</p>
      ) : !pages ? (
        <div className="animate-pulse" style={{
          width: RAIL, aspectRatio: '210 / 297', flex: 'none', borderRadius: 10, background: 'var(--cream)',
        }} />
      ) : (
        pages.map((src, i) => (
          // 종이는 항상 흰색 — 인쇄 문서는 모드 불변이다(§28). 셸 배경만 토큰으로 뒤집힌다.
          // eslint-disable-next-line @next/next/no-img-element
          <img key={src} src={src} alt={`${i + 1}쪽`} style={{
            width: RAIL, height: 'auto', display: 'block', flex: 'none',
            borderRadius: 10, background: '#FFFFFF',
            boxShadow: '0 6px 24px rgba(0,0,0,.14)',
            marginBottom: i === pages.length - 1 ? 0 : 12,
          }} />
        ))
      )}
    </div>
  )
}
