'use client'
// 목록 끝 '기타(직접 입력)'으로 즉석 입력 전환되는 select — 요청·컴플레인 카테고리, 지출 카테고리, 규격·수량 단위, 사유 목록 공용.

import { useId, useState } from 'react'
import { reasonPickOf, otherReason } from '@/lib/reasonLists'

// '목록에 추가' 체크박스 아래 힌트. 사유(ask)와 저절로 쌓던 목록(auto)이 같은 문장을 쓴다(문법 하나, 운영자 결정 2026-10-22).
const ADD_HINT = '체크하면 다음부터 목록에서 고를 수 있습니다. 목록 관리는 환경설정 > 분류 관리에서 합니다.'

export default function CategorySelect({
  value, onChange, options, className, wrapperClassName,
  emptyLabel, placeholder = '카테고리를 직접 입력하세요',
  closeIconSize = 14, showAddHint = false, addHintText, savedValue, name,
  addMode, addToList, onAddToListChange, addLabel = '이 사유를 목록에 추가',
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
  /** FormData 로 제출되는 폼에서 필드명 유지용. 체크박스가 서면 `${name}AddToList`('1'·'0')도 함께 실린다. */
  name?: string
  /**
   * 사유 목록 문법(2026-10-22 운영자 승인). 'ask' 면 value 는 **저장 글자**다(lib/reasonLists 규약).
   * 목록 항목이면 그 이름, '기타(직접 입력)' 로 적은 글은 '기타 · 글'(글이 없으면 '기타')이고, 둘 다 아닌 글자(목록에서
   * 뺀 항목·옛 이름)는 칸에 그 글자 그대로 한 줄 서서 손대지 않으면 그대로 저장된다. 직접 입력 아래에 '목록에 추가'
   * 체크박스가 서고 기본은 꺼짐이다. 체크하면 저장할 때 서버가 그 글을 목록에 넣고 기록은 맨 글자로 남긴다.
   */
  addMode?: 'ask'
  /** '목록에 추가' 체크 상태. 넘기지 않으면 칸이 스스로 쥔다(기본 꺼짐). */
  addToList?: boolean
  onAddToListChange?: (v: boolean) => void
  /** 체크박스 라벨. 목록이 사유가 아닌 자리는 그 낱말로 말한다. */
  addLabel?: string
}) {
  const [customMode, setCustomMode] = useState(false)
  const [initialValue] = useState(value)
  const [ownAdd, setOwnAdd] = useState(false)
  // 'ask' 칸에서 방금 '기타(직접 입력)' 을 골랐을 때만 입력칸에 커서를 둔다. 저장된 '기타 · 글' 을 연 수정 화면이나
  // 이어받은 사유로 연 폼까지 커서를 끌어오면 위 칸을 채우던 손이 끊긴다.
  const [pickedOther, setPickedOther] = useState(false)
  const hintId = useId()
  const baseline = savedValue ?? initialValue
  const checked = addToList ?? ownAdd
  const setChecked = (v: boolean) => { if (addToList === undefined) setOwnAdd(v); onAddToListChange?.(v) }

  const closeBtn = (onClose: () => void) => (
    <button type="button" onClick={onClose}
      aria-label="목록에서 선택"
      className="shrink-0 px-1.5 text-xs text-[var(--warm-muted)] hover:text-[var(--warm-dark)]"><svg className="inline-block align-middle" width={closeIconSize} height={closeIconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
  )
  const addBox = (
    <>
      <label className="mt-1 flex items-center gap-2 cursor-pointer min-h-[var(--input-h-touch)] sm:min-h-0 sm:py-1">
        <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)}
          aria-describedby={hintId}
          className="w-4 h-4 shrink-0 accent-[var(--coral)]" />
        <span className="text-xs text-[var(--warm-dark)] break-keep">{addLabel}</span>
      </label>
      <p id={hintId} className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed break-keep">{ADD_HINT}</p>
      {name && <input type="hidden" name={`${name}AddToList`} value={checked ? '1' : '0'} />}
    </>
  )

  if (addMode === 'ask') {
    const pick = reasonPickOf(value, options)
    if (pick.kind === 'other') {
      return (
        <div className={wrapperClassName}>
          {name && <input type="hidden" name={name} value={value} />}
          <div className="flex items-center gap-1">
            <input
              type="text" value={pick.text}
              onChange={e => onChange(otherReason(e.target.value))}
              placeholder={placeholder}
              className={`${className} flex-1 min-w-0`}
              autoFocus={pickedOther}
            />
            {closeBtn(() => { setPickedOther(false); onChange('') })}
          </div>
          {addBox}
        </div>
      )
    }
    return (
      <div className={wrapperClassName}>
        {name && <input type="hidden" name={name} value={value} />}
        <select
          value={value}
          onChange={e => {
            const v = e.target.value
            if (v === '__custom__') { setPickedOther(true); onChange(otherReason('')) }
            else onChange(v)
          }}
          className={className}
        >
          {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
          {/* 목록에 없는 저장 글자(뺀 항목·옛 이름)는 그 글자 그대로 한 줄 세운다. 손대지 않으면 그대로 저장된다. */}
          {pick.kind === 'legacy' && <option value={pick.value}>{pick.value}</option>}
          {options.map(o => <option key={o} value={o}>{o}</option>)}
          <option value="__custom__">기타(직접 입력)</option>
        </select>
      </div>
    )
  }

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
          {closeBtn(() => { setCustomMode(false); onChange('') })}
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
