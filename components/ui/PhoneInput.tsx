'use client'

import { useState } from 'react'
import { formatPhone } from '@/lib/formatPhone'

/**
 * 한국 전화번호 자동 포맷 입력 컴포넌트
 * 숫자만 입력하면 자동으로 XXX-XXXX-XXXX 형식으로 변환
 */
export function PhoneInput({
  name,
  defaultValue,
  placeholder = '010-0000-0000',
  className,
}: {
  name: string
  defaultValue?: string
  placeholder?: string
  className?: string
}) {
  const [value, setValue] = useState(defaultValue ? formatPhone(defaultValue) : '')

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(formatPhone(e.target.value))
  }

  return (
    <input
      type="tel"
      name={name}
      value={value}
      onChange={handleChange}
      placeholder={placeholder}
      className={className ?? 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus:border-[var(--coral)] transition-colors'}
    />
  )
}
