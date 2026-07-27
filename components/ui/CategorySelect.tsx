'use client'
// 목록 끝 '기타(직접 입력)'으로 즉석 입력 전환되는 select — 요청·컴플레인 카테고리, 지출 카테고리, 규격·수량 단위 공용.

import { useState } from 'react'

export default function CategorySelect({
  value, onChange, options, className, wrapperClassName,
  emptyLabel, placeholder = '카테고리를 직접 입력하세요',
  closeIconSize = 14, showAddHint = false, name,
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
  /** FormData 로 제출되는 폼에서 필드명 유지용. */
  name?: string
}) {
  const [customMode, setCustomMode] = useState(false)
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
        {showAddHint && (
          <p className="mt-1 text-[0.65625rem] text-[var(--warm-muted)]">새로 입력한 카테고리는 저장 시 자동으로 목록에 추가됩니다. 관리는 설정에서.</p>
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
