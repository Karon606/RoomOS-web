'use client'

import { useState, useEffect } from 'react'

export function MoneyInput({
  name, defaultValue, value, onChange, placeholder
}: {
  name?: string
  defaultValue?: number
  value?: number        // controlled: 외부에서 값 주입 시 (호실 선택 자동 입력 등)
  onChange?: (v: number) => void
  placeholder?: string
}) {
  const init = value ?? defaultValue
  const [display, setDisplay] = useState(init ? init.toLocaleString() : '')
  const [focused, setFocused] = useState(false)

  // controlled 모드(onChange 있음): value가 변경되면 undefined → '' 까지 동기화
  // uncontrolled 모드(defaultValue만): 첫 마운트 외엔 동기화 안 함
  const isControlled = onChange !== undefined
  useEffect(() => {
    if (!isControlled) return
    setDisplay(value ? value.toLocaleString() : '')
  }, [value, isControlled])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9]/g, '')
    setDisplay(raw ? Number(raw).toLocaleString() : '')
    onChange?.(raw ? Number(raw) : 0)
  }

  const rawValue = display.replace(/[^0-9]/g, '')

  return (
    <div className="relative">
      {name && <input type="hidden" name={name} value={rawValue} />}
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
