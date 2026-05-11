'use client'

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
  const formatted = `${prefix ?? ''}${fmtKorMoney(amount, { zero: '0원' })}`
  return <span className={`whitespace-nowrap mono tnum ${className ?? ''}`}>{formatted}</span>
}
