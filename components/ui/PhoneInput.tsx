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
  onValueChange,
}: {
  name: string
  defaultValue?: string
  placeholder?: string
  className?: string
  /**
   * 지금 값을 밖에서도 알아야 할 때만 준다(칸은 그대로 uncontrolled 다).
   * 폼 안 안내가 "방금 적은 번호"로 판정하려면 저장값이 아니라 이 값을 봐야 한다.
   */
  onValueChange?: (v: string) => void
}) {
  const [value, setValue] = useState(defaultValue ? formatPhone(defaultValue) : '')

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = formatPhone(e.target.value)
    setValue(next)
    onValueChange?.(next)
  }

  return (
    <input
      type="tel"
      name={name}
      value={value}
      onChange={handleChange}
      placeholder={placeholder}
      className={className ?? 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus:border-[var(--persimmon)] focus:shadow-[0_0_0_3px_rgba(160,60,46,0.12)] transition-colors'}
    />
  )
}
