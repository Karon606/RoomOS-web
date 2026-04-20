'use client'

import { useSearchParams } from 'next/navigation'

export default function ExportButton() {
  const searchParams = useSearchParams()
  const month = searchParams.get('month') ??
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`

  const handleExport = () => {
    window.location.href = `/api/export?month=${month}`
  }

  return (
    <button
      onClick={handleExport}
      className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm font-medium rounded-xl transition-colors"
    >
      📥 Excel 내보내기
    </button>
  )
}