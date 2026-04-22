// app/(app)/layout.tsx
'use client';

import { AppProgressBar as ProgressBar } from 'next-nprogress-bar';

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      {/* 실제 페이지 내용들 */}
      {children}
      
      {/* RoomOS 브랜드 컬러(#f4623a) 상단 바 */}
      <ProgressBar
        height="3px"
        color="#f4623a" 
        options={{ showSpinner: false }}
        shallowRouting
      />
    </>
  );
}