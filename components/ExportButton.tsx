'use client'

import { useSearchParams } from 'next/navigation'
import { Btn } from '@/components/ui/Btn'

export default function ExportButton() {
  const searchParams = useSearchParams()
  const month = searchParams.get('month') ??
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`

  const handleExport = () => {
    window.location.href = `/api/export?month=${month}`
  }

  return (
    <Btn variant="success" size="md" onClick={handleExport}>
      Excel 내보내기
    </Btn>
  )
}