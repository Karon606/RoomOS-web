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
      className="rounded-xl px-3 py-2 text-sm outline-none cursor-pointer"
      style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)', color: 'var(--warm-dark)' }}
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
