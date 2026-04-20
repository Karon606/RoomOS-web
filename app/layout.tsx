import type { Metadata } from 'next'
import './globals.css'

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
      <body>{children}</body>
    </html>
  )
}