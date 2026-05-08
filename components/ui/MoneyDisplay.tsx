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

  // M7 가이드: 숫자는 항상 DM Mono + tabular-nums (가지런한 자릿수)
  return <span className={`whitespace-nowrap mono tnum ${className ?? ''}`}>{text}</span>
}
