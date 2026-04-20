'use client'

import { useRouter } from 'next/navigation'

export default function MonthSelector({ currentMonth }: { currentMonth: string }) {
  const router = useRouter()

  const months: string[] = []
  const now = new Date()
  for (let i = -12; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  months.reverse()

  return (
    <select
      value={currentMonth}
      onChange={e => router.push(`?month=${e.target.value}`)}
      className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-indigo-500 cursor-pointer"
    >
      {months.map(m => {
        const [y, mo] = m.split('-')
        return (
          <option key={m} value={m}>
            {y}년 {parseInt(mo)}월
          </option>
        )
      })}
    </select>
  )
}
