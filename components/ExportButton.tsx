'use client'

import { useSearchParams } from 'next/navigation'
import { Btn } from '@/components/ui/Btn'
import { resolveMonthParam } from '@/lib/monthParam'

export default function ExportButton() {
  const searchParams = useSearchParams()
  // 기본 달은 KST — new Date() 로 뽑으면 매월 1일 KST 00~09시에 지난달이 내려받아진다.
  // 내보내는 달은 화면이 보고 있는 달과 같아야 한다 — 잠긴 화면이라 미래는 이번 달로(lib/monthParam).
  const month = resolveMonthParam(searchParams.get('month'))

  const handleExport = () => {
    window.location.href = `/api/export?month=${month}`
  }

  return (
    <Btn variant="success" size="md" onClick={handleExport}>
      Excel 내보내기
    </Btn>
  )
}