'use client'

import { useEffect, useState } from 'react'

function toCompact(amount: number): string {
  if (amount < 10000) return `${amount.toLocaleString()}원`
  const man = amount / 10000
  const str = Number.isInteger(man) ? `${man}` : `${parseFloat(man.toFixed(1))}`
  return `${str}만원`
}

export function MoneyDisplay({
  amount,
  className,
  prefix,
}: {
  amount: number
  className?: string
  prefix?: string
}) {
  const pre     = prefix ?? ''
  const full    = `${pre}${amount.toLocaleString()}원`
  const compact = `${pre}${toCompact(amount)}`

  const [text, setText] = useState(full)

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    setText(mq.matches ? full : compact)
    const handler = (e: MediaQueryListEvent) => setText(e.matches ? full : compact)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [full, compact])

  return <span className={`whitespace-nowrap ${className ?? ''}`}>{text}</span>
}
