'use client'

// 생년월일 숫자 연속 입력 — 8자리 숫자를 타이핑 중 "YYYY.MM.DD" 로 자동 포맷.
// name 이 붙은 단일 input 하나로 동작해 폼 제출·OCR 자동채움(setInputByName 의 input 이벤트)을 함께 받는다.
// 제출값은 점 포맷 문자열이고 서버(addTenant/updateTenant)가 digitsToIso 로 ISO 정규화해 저장한다.

import { useState } from 'react'
import { formatBirthdateDigits } from '@/lib/birthdate'

export default function BirthdateInput({
  name,
  defaultValue,
  placeholder = '예: 19700928',
  className,
  required,
}: {
  name: string
  defaultValue?: string
  placeholder?: string
  className?: string
  required?: boolean
}) {
  const [value, setValue] = useState(() => formatBirthdateDigits(defaultValue ?? ''))
  return (
    <input
      type="text"
      name={name}
      value={value}
      onChange={e => setValue(formatBirthdateDigits(e.target.value))}
      inputMode="numeric"
      autoComplete="off"
      placeholder={placeholder}
      required={required}
      className={className}
    />
  )
}
