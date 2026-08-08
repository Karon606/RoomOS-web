'use client'

import { useSearchParams } from 'next/navigation'
import { Btn } from '@/components/ui/Btn'
import { kstMonthStr } from '@/lib/kstDate'

export default function ExportButton() {
  const searchParams = useSearchParams()
  // 기본 달은 KST — new Date() 로 뽑으면 매월 1일 KST 00~09시에 지난달이 내려받아진다.
  const month = searchParams.get('month') ?? kstMonthStr()

  const handleExport = () => {
    window.location.href = `/api/export?month=${month}`
  }

  return (
    <Btn variant="success" size="md" onClick={handleExport}>
      Excel 내보내기
    </Btn>
  )
}