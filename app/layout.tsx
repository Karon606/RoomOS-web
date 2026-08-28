import type { Metadata, Viewport } from 'next'
import { Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'
import { ThemeProvider, themeBootstrapScript } from '@/components/theme/ThemeProvider'
import { FontSizeProvider, fontSizeBootstrapScript } from '@/components/theme/FontSizeProvider'
import NavProgress from '@/components/layout/NavProgress'
import { AuthBackTrap } from '@/components/auth/AuthBackTrap'
import { SplashHost } from '@/components/brand/SplashController'
import { StagingBanner } from '@/components/layout/StagingBanner'
import { isStagingEnv } from '@/lib/env'
import { Analytics } from '@vercel/analytics/next'

// 가이드 명시: Numbers·Mono·Meta는 DM Mono
// v2.0 §06 — DM Mono 웹폰트 제거(제품 UI 사선 0 금지, 번들 절감). 숫자는 Pretendard + tnum(.num).

// 가이드 명시: 로고 워드마크는 Plus Jakarta Sans 300/700
const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['300', '700'],
  display: 'swap',
  variable: '--font-plus-jakarta',
})

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // v2.0 §21 — 첫 페인트 배경과 동일한 theme-color (라이트/다크 분기)
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#E8DDD0' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  title: '스테이음',
  description: '고시원·원룸텔 스마트 관리 시스템',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: '스테이음',
  },
  icons: {
    icon: '/icon.svg',
    apple: '/apple-touch-icon.png',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    // data-env 는 CSS 가 띠 높이(--sysbar-h)를 예약하는 근거다. 운영에서는 속성 자체가 없다.
    <html lang="ko" className={plusJakarta.variable} data-env={isStagingEnv() ? 'staging' : undefined} suppressHydrationWarning>
      <head>
        {/* v2.0 §21 FOUC 방어 — 외부 CSS 로드 전 html 배경을 브랜드 톤으로 (흰 화면 0ms).
            다크는 CSS 미디어쿼리로 — JS 테마 감지 전 깜박임 원천 차단. */}
        <style dangerouslySetInnerHTML={{ __html:
          // 판정 주체는 html.dark 하나 — OS 외관을 같이 보면 라이트 앱이 검은 바탕 위에 그려진다.
          // 이 CSS 는 themeBootstrapScript 보다 먼저 파싱되지만, 그 스크립트도 <head> 안에서
          // 동기로 돌아 body 페인트 전에 .dark 를 확정하므로 되돌릴 규칙이 필요 없다.
          'html{background:#E8DDD0}html.dark{background:#000000}',
        }} />
        {/* 가이드 명시: 한글 본문·디스플레이는 Pretendard. Pretendard는 Google Fonts에 없어 jsdelivr CDN.
            Variable 버전 — 100~900 모든 weight를 한 파일로 안정 로딩. */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.css"
        />
        {/* FOUC 방지 — hydration 전에 .dark 클래스 미리 토글. localStorage 읽어 즉시 적용. */}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
        <script dangerouslySetInnerHTML={{ __html: fontSizeBootstrapScript }} />
      </head>
      <body>
        <StagingBanner />
        <NavProgress />
        <AuthBackTrap />
        <SplashHost />
        <FontSizeProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </FontSizeProvider>
        <Analytics />
      </body>
    </html>
  )
}
