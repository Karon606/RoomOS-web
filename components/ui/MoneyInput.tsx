'use client'

import { useState } from 'react'

export function MoneyInput({
  name, defaultValue, placeholder
}: {
  name: string
  defaultValue?: number
  placeholder?: string
}) {
  const [display, setDisplay] = useState(
    defaultValue ? defaultValue.toLocaleString() : ''
  )
  const [focused, setFocused] = useState(false)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9]/g, '')
    setDisplay(raw ? Number(raw).toLocaleString() : '')
  }

  const rawValue = display.replace(/[^0-9]/g, '')

  return (
    <div className="relative">
      <input type="hidden" name={name} value={rawValue} />
      <input
        type="text"
        value={focused ? display : (display ? `${display}원` : '')}
        onChange={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder ?? '0원'}
        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus:border-[var(--coral)] transition-colors"
      />
    </div>
  )
}