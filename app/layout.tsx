import type { Metadata } from 'next'
import './globals.css'
// 1. 프로그레스 바 라이브러리 가져오기
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
        {children}
        
        {/* 2. 상단 프로그레스 바 설정 */}
        <ProgressBar
          height="3px"
          color="#f4623a" // RoomOS Coral 브랜드 컬러 적용
          options={{ showSpinner: false }} // 우측 하단 뱅글뱅글 도는 스피너는 숨김
          shallowRouting
        />
      </body>
    </html>
  )
}