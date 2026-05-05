'use client'

import { useEffect, useState } from 'react'
import { fmtKorMoney } from '@/lib/fmtMoney'

export function MoneyDisplay({
  amount,
  className,
  prefix,
  alwaysFull,
}: {
  amount: number
  className?: string
  prefix?: string
  alwaysFull?: boolean
}) {
  const pre     = prefix ?? ''
  const full    = `${pre}${amount.toLocaleString()}원`
  // 모바일 compact — 한국식 천/백/십/원까지 표기 (51.6만원 X → 51만6천원 ✓)
  const compact = `${pre}${fmtKorMoney(amount, { zero: '0원' })}`

  const [text, setText] = useState(full)

  useEffect(() => {
    if (alwaysFull) { setText(full); return }
    const mq = window.matchMedia('(min-width: 768px)')
    setText(mq.matches ? full : compact)
    const handler = (e: MediaQueryListEvent) => setText(e.matches ? full : compact)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [full, compact, alwaysFull])

  return <span className={`whitespace-nowrap ${className ?? ''}`}>{text}</span>
}
