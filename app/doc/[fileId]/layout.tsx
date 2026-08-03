// 서류 뷰어 전용 레이아웃 — AppShell 밖 단독 라우트.
//
// 서류 페이지는 검색엔진에 절대 노출 금지 — 성명·생년월일·금액·서명이 담긴다.
// 형제 서류 화면 셋이 E페이즈에 같은 이유로 넣었고, 루트 레이아웃에는 robots 가 없어 상속받을 것이 없다.
import type { Metadata } from 'next'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function DocLayout({ children }: { children: React.ReactNode }) {
  return children
}
