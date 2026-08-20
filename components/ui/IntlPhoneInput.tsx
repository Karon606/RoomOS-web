'use client'

import { useState, useEffect, useRef } from 'react'
import { AsYouType, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js'
import { COUNTRIES, flag } from './CountrySelect'
import { shouldSyncPhoneCountry } from '@/lib/homeCountrySync'

// 국가별 국제 전화번호 입력 — libphonenumber-js로 자동 포맷팅
// 저장값: hidden input 'name' = e.164 형식 ('+79111234567'), 'name + Country' = ISO code
// 화면 입력: 국가별 끊어쓰기 (한국 010-1234-5678 / 러시아 911 23-45-67 등)
export function IntlPhoneInput({
  name,
  countryName,
  defaultValue,
  defaultCountry = 'KR',
  syncCountry,
  placeholder = '전화번호',
  className,
}: {
  name: string                 // 전화번호 hidden input name
  countryName: string          // ISO code hidden input name
  defaultValue?: string        // e.164 형식 또는 raw
  defaultCountry?: string      // ISO code (KR, RU 등)
  // 밖에서 따라오게 하고 싶은 국가(국적 셀렉트 등). 값이 **바뀔 때만** 국가를 옮긴다.
  // 마운트 시점 값은 defaultCountry 가 이미 반영하고 있으므로 여기서 다시 밀지 않는다.
  syncCountry?: string
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

  // 국적을 고르면 국가도 따라온다(신고 aed91367). 판정은 lib/homeCountrySync 정본이 하고
  // 여기는 결과를 반영만 한다 — 규칙이 화면 안에 있으면 회귀 케이스가 그 규칙을 잠글 수 없다.
  //
  // 손으로 고른 국가는 덮지 않는다. 종전 가드는 '번호가 비었는가'만 봐서, 번호를 적기 전에
  // 국가부터 고르는 순서를 놓쳤다 — 국적 미국·거주 일본을 그렇게 입력하면 국적을 다시 만지는
  // 순간 일본이 미국으로 되돌아갔다. 신고 6f264a8f 와 같은 클래스다.
  const syncedRef = useRef(syncCountry)
  const userPickedRef = useRef(false)
  useEffect(() => {
    const ok = shouldSyncPhoneCountry({
      next: syncCountry,
      prev: syncedRef.current,
      hasNumber: !!display.trim(),
      userPicked: userPickedRef.current,
    })
    // 반영 여부와 무관하게 '이 국적은 이미 본 값'으로 접어 둔다. 안 그러면 국적을 왕복시킬 때
    // 같은 값이 새 변경으로 다시 잡힌다.
    if (syncCountry) syncedRef.current = syncCountry
    if (ok) setCountry(syncCountry as string)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncCountry])

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
          // 손으로 고른 순간부터 이 칸은 운영자의 것이다 — 국적이 바뀌어도 자동이 덮지 않는다.
          onChange={e => { userPickedRef.current = true; setCountry(e.target.value) }}
          className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--persimmon)] focus:shadow-[0_0_0_3px_rgba(160,60,46,0.12)] shrink-0 max-w-[44%]"
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
          className={className ?? 'flex-1 min-w-0 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus:border-[var(--persimmon)] focus:shadow-[0_0_0_3px_rgba(160,60,46,0.12)] transition-colors'}
        />
      </div>
      {callingCode && (
        <p className="text-[0.65625rem] text-[var(--warm-muted)] pl-1">국가 번호 {callingCode} · 저장 시 국제 형식(E.164)으로 변환됩니다.</p>
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
