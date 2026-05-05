'use client'

import { useState, useEffect } from 'react'
import { AsYouType, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js'
import { COUNTRIES, flag } from './CountrySelect'

// 국가별 국제 전화번호 입력 — libphonenumber-js로 자동 포맷팅
// 저장값: hidden input 'name' = e.164 형식 ('+79111234567'), 'name + Country' = ISO code
// 화면 입력: 국가별 끊어쓰기 (한국 010-1234-5678 / 러시아 911 23-45-67 등)
export function IntlPhoneInput({
  name,
  countryName,
  defaultValue,
  defaultCountry = 'KR',
  placeholder = '전화번호',
  className,
}: {
  name: string                 // 전화번호 hidden input name
  countryName: string          // ISO code hidden input name
  defaultValue?: string        // e.164 형식 또는 raw
  defaultCountry?: string      // ISO code (KR, RU 등)
  placeholder?: string
  className?: string
}) {
  // defaultValue가 e.164면 country 추론, 아니면 defaultCountry 사용
  const initial = (() => {
    if (defaultValue) {
      const parsed = parsePhoneNumberFromString(defaultValue)
      if (parsed && parsed.country) {
        return { country: parsed.country, display: parsed.formatNational() }
      }
    }
    return { country: defaultCountry, display: defaultValue ?? '' }
  })()

  const [country, setCountry] = useState<string>(initial.country)
  const [display, setDisplay] = useState<string>(initial.display)

  // 국가 변경 시 기존 입력을 새 국가 포맷으로 재포맷
  useEffect(() => {
    if (!display) return
    const digits = display.replace(/\D/g, '')
    if (!digits) return
    const formatter = new AsYouType(country as CountryCode)
    setDisplay(formatter.input(digits))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country])

  const callingCode = (() => {
    try { return '+' + getCountryCallingCode(country as CountryCode) } catch { return '' }
  })()

  // hidden inputs용 — e.164 형식 시도
  const e164 = (() => {
    if (!display.trim()) return ''
    const parsed = parsePhoneNumberFromString(display, country as CountryCode)
    if (parsed && parsed.isValid()) return parsed.number
    // 유효하지 않아도 일단 입력 그대로 저장 (사용자가 부분 입력 중일 수도)
    return display.trim()
  })()

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatter = new AsYouType(country as CountryCode)
    setDisplay(formatter.input(e.target.value))
  }

  return (
    <div className="space-y-1.5">
      {/* 국가 선택 */}
      <div className="flex gap-2">
        <select
          value={country}
          onChange={e => setCountry(e.target.value)}
          className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-2 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] shrink-0 max-w-[44%]"
        >
          {COUNTRIES.map(c => (
            <option key={c.code} value={c.code}>
              {flag(c.code)} {c.name} {(() => {
                try { return `(+${getCountryCallingCode(c.code as CountryCode)})` } catch { return '' }
              })()}
            </option>
          ))}
        </select>
        <input
          type="hidden" name={name} value={e164}
        />
        <input
          type="hidden" name={countryName} value={country}
        />
        <input
          type="tel"
          value={display}
          onChange={handleChange}
          placeholder={placeholder}
          className={className ?? 'flex-1 min-w-0 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus:border-[var(--coral)] transition-colors'}
        />
      </div>
      {callingCode && (
        <p className="text-[10px] text-[var(--warm-muted)] pl-1">국가 번호 {callingCode} · 저장 시 국제 형식(E.164)으로 변환됩니다.</p>
      )}
    </div>
  )
}

// 국제 번호 표시 — '+82 10-1234-5678' 식으로 포맷
export function fmtIntlPhone(value: string | null | undefined, fallbackCountry?: string): string {
  if (!value) return ''
  const parsed = parsePhoneNumberFromString(value, fallbackCountry as CountryCode | undefined)
  if (!parsed) return value
  return parsed.formatInternational()
}
