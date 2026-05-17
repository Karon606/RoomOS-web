import type { Metadata, Viewport } from 'next'
import { DM_Mono, Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'
import { ThemeProvider, themeBootstrapScript } from '@/components/theme/ThemeProvider'
import { FontSizeProvider, fontSizeBootstrapScript } from '@/components/theme/FontSizeProvider'
import NavProgress from '@/components/layout/NavProgress'

// 가이드 명시: Numbers·Mono·Meta는 DM Mono
const dmMono = DM_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-dm-mono',
})

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
  themeColor: '#e84a1a',
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
    <html lang="ko" className={`${dmMono.variable} ${plusJakarta.variable}`} suppressHydrationWarning>
      <head>
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
        <NavProgress />
        <FontSizeProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </FontSizeProvider>
      </body>
    </html>
  )
}
