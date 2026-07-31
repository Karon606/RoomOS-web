'use client'

// AppShell 밖 단독 페이지가 '문서 스크롤'을 켜는 정본 스위치 — 마운트 동안만 html.doc-scroll 부착.
// globals.css 가 html·body 를 overflow:hidden 으로 잠그기 때문에(iOS 헤더 보호), 셸 밖 라우트는
// 자체 스크롤러(A: h-dvh + overflow-y-auto)를 갖거나 이 컴포넌트(B)를 얹어야 스크롤이 산다.
// 선언이 없으면 콘텐츠가 뷰포트를 넘는 순간 하단이 잘려 버튼에 닿을 수 없다(신고 000a22ed, 그 전 344001b).
// 배경색은 절대 건드리지 않는다 — 페이지가 각자의 토큰(다크모드 반응)을 쓰기 때문.

import { useEffect } from 'react'

export default function DocumentScroll() {
  useEffect(() => {
    const html = document.documentElement
    html.classList.add('doc-scroll')
    // 언마운트(다른 라우트로 이동) 시 해제 — 셸 페이지로 복귀했을 때 이중 스크롤 방지
    return () => { html.classList.remove('doc-scroll') }
  }, [])
  return null
}
