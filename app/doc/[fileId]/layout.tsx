// 서류 뷰어 전용 레이아웃 — AppShell 밖 단독 라우트.
//
// 서류 페이지는 검색엔진에 절대 노출 금지 — 성명·생년월일·금액·서명이 담긴다.
// 형제 서류 화면 셋이 E페이즈에 같은 이유로 넣었고, 루트 레이아웃에는 robots 가 없어 상속받을 것이 없다.
import type { Metadata, Viewport } from 'next'

// 서류는 작은 글씨를 확대해 읽어야 한다. 루트 layout 의 userScalable:false / maximumScale:1 을
// 이 라우트에서만 되돌린다. viewport 는 필드 단위 얕은 병합이라 여기서 안 적은 값은 루트가 그대로 남는다.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
}

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function DocLayout({ children }: { children: React.ReactNode }) {
  return children
}
