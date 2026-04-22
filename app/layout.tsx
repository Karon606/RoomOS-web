// app/layout.tsx
import type { Metadata } from 'next'
import './globals.css' // CSS 경로는 여기서 한 번만 정확히 불러옵니다.
import { AppProgressBar as ProgressBar } from 'next-nprogress-bar';

export const metadata: Metadata = {
  title: 'RoomOS',
  description: '고시원·원룸텔 스마트 관리 시스템',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* 모든 페이지의 내용이 이 자리에 들어옵니다 */}
        {children}
        
        {/* RoomOS 브랜드 컬러(#f4623a) 상단 프로그레스 바 */}
        <ProgressBar
          height="3px"
          color="#f4623a" 
          options={{ showSpinner: false }}
          shallowRouting
        />
      </body>
    </html>
  )
}