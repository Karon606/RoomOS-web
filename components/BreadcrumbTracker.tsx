'use client'

// 화면 이동 자취 기록 + 전역 JS 에러 캡처 설치. 앱 셸에 1회 마운트.
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { recordCrumb, installErrorCapture } from '@/lib/errorBreadcrumbs'

export default function BreadcrumbTracker() {
  const pathname = usePathname()
  useEffect(() => { installErrorCapture() }, [])
  useEffect(() => { recordCrumb('nav', pathname) }, [pathname])
  return null
}
