'use client'
// 목록 끝 '기타(직접 입력)'으로 즉석 입력 전환되는 select — 요청·컴플레인 카테고리, 지출 카테고리, 규격·수량 단위 공용.

import { useState } from 'react'

export default function CategorySelect({
  value, onChange, options, className, wrapperClassName,
  emptyLabel, placeholder = '카테고리를 직접 입력하세요',
  closeIconSize = 14, showAddHint = false, addHintText, savedValue, name,
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
  /** 각 지점의 기존 select 문법을 그대로 계승 — 사이즈·배경 클래스를 그대로 넘긴다. */
  className: string
  /** 부모 레이아웃(flex 자식 등)에 맞출 바깥 클래스. */
  wrapperClassName?: string
  /** 빈 값 옵션 라벨. 없으면 빈 옵션을 렌더하지 않는다(카테고리 필수 폼). */
  emptyLabel?: string
  placeholder?: string
  /** X 아이콘 크기 — 조밀한 폼은 12px. */
  closeIconSize?: number
  /** 입력창 활성 시 '저장하면 목록에 추가' 인라인 힌트 노출(단위 입력에는 해당 없음). */
  showAddHint?: boolean
  /** 힌트 문구. 목록이 카테고리가 아닌 자리(할인 사유·직업)는 그 낱말로 말한다. 없으면 카테고리 문구. */
  addHintText?: string
  /**
   * 이 폼이 고치는 기록에 이미 저장된 값. 그 값 그대로 저장하면 목록에 안 더해진다(이전 값과 같으면 안 더한다).
   * 새 기록을 만드는 폼은 '' 를 넘긴다(무엇을 적든 새 값이다). 안 넘기면 처음 받은 값으로 본다.
   */
  savedValue?: string
  /** FormData 로 제출되는 폼에서 필드명 유지용. */
  name?: string
}) {
  const [customMode, setCustomMode] = useState(false)
  const [initialValue] = useState(value)
  const baseline = savedValue ?? initialValue
  const isInOptions = value === '' || options.includes(value)
  // 외부 value가 옵션에 없으면 자동으로 custom 모드 (수동 입력값)
  const showCustom = customMode || (!isInOptions && value !== '')

  if (showCustom) {
    return (
      <div className={wrapperClassName}>
        <div className="flex items-center gap-1">
          <input
            type="text" name={name} value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            className={`${className} flex-1 min-w-0`}
            autoFocus
          />
          <button type="button" onClick={() => { setCustomMode(false); onChange('') }}
            aria-label="목록에서 선택"
            className="shrink-0 px-1.5 text-xs text-[var(--warm-muted)] hover:text-[var(--warm-dark)]"><svg className="inline-block align-middle" width={closeIconSize} height={closeIconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
        </div>
        {/* 힌트는 저장하면 실제로 목록에 더해질 때만 선다. 운영자가 '기타(직접 입력)' 를 직접 골랐거나, 기록에 저장된
            값(baseline)과 다른 새 값을 쳤을 때다. 기록에서 온 목록 밖 값 그대로면 저장해도 안 더해진다(이전 값과
            같으면 안 더한다). 새 기록 폼은 savedValue '' 라 기본값이 목록 밖이어도 힌트가 선다(3차 검수). */}
        {showAddHint && (customMode || (value !== '' && value !== baseline)) && (
          <p className="mt-1 text-[0.65625rem] text-[var(--warm-muted)]">{addHintText ?? '새로 입력한 카테고리는 저장할 때 목록에 저절로 추가됩니다. 목록 관리는 환경설정 > 분류 관리에서 합니다.'}</p>
        )}
      </div>
    )
  }

  return (
    <div className={wrapperClassName}>
      <select
        name={name}
        value={value}
        onChange={e => {
          const v = e.target.value
          if (v === '__custom__') { setCustomMode(true); onChange('') }
          else onChange(v)
        }}
        className={className}
      >
        {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
        {options.map(o => <option key={o} value={o}>{o}</option>)}
        <option value="__custom__">기타(직접 입력)</option>
      </select>
    </div>
  )
}
