'use client'
// 지출 귀속월 행 정본 — 재무 등록·수정 폼과 영수증 승인(찍어 올리기 재고 등록)이 같은 문법을 쓴다.

import { useState } from 'react'
import { shiftMonthKey, targetMonthLabel } from '@/lib/expenseTargetMonth'

/**
 * 지출 폼 귀속월 행(2026-10-03 운영자 승인 2안). 날짜 행 아래 전폭 한 행이다(반폭 칸이면 320px 에서 캡션이 세 줄로 접힌다).
 * 기본은 접힘이다 — 대부분의 지출은 날짜의 달이 곧 귀속월이다.
 *  · 날짜의 달이 조회 달과 다르면 "10월분으로 기록됩니다 · 9월분으로 바꾸기" 캡션(기록 모달의 캡션+밑줄 액션 문법).
 *  · 같으면 캡션 없이 '귀속월 바꾸기' 밑줄 액션만 — 10월을 보며 10/1 에 낸 9월분을 적는 입구다.
 * 누르면 기록 모달과 같은 귀속월 select(날짜 달 ±1, 해가 같으면 'N월분')가 펼쳐진다. 사람이 고른 적 없으면 값은
 * 날짜의 달을 따라간다(picked=null). 고른 달이 창 밖이면 '(현재)' 옵션으로 남긴다. 수정 폼은 저장된 귀속월이 있으면
 * 처음부터 펼친다. 버튼은 input 이벤트를 안 내므로 폼 dirty 는 onDirty 로 직접 세운다. 서버는 날짜 달과 같으면 NULL 로 접는다.
 *
 * 값은 두 갈래로 나간다. form 안이면 name="targetMonth" 칸(hidden·select)이 실리고, form 이 없는 화면(영수증 승인 카드)은
 * onPick 으로 고른 값(null = 날짜를 따라감)을 받는다. dense 는 그 카드의 작은 입력 문법(text-xs·--cream)에 맞춘다.
 */
export function ExpenseTargetMonthField({ date, viewMonth, initial = null, onDirty, onPick, dense = false }: {
  date: string
  viewMonth: string
  initial?: string | null
  onDirty?: () => void
  onPick?: (month: string | null) => void
  dense?: boolean
}) {
  const [picked, setPickedState] = useState<string | null>(initial)
  const [open, setOpen] = useState(initial != null)
  const setPicked = (m: string | null) => { setPickedState(m); onPick?.(m) }
  const dateMonth = /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : null
  if (!dateMonth) return initial ? <input type="hidden" name="targetMonth" value={initial} /> : null
  const value = picked ?? dateMonth
  if (!open) {
    const action = (label: string, next: string | null) => (
      <button type="button" onClick={() => { setPicked(next); setOpen(true); onDirty?.() }}
        // 승인 카드(dense)는 그 카드의 인라인 액션 문법('단계별')을 따른다 — 한 카드 두 문법 금지(웹디자이너 패스).
        className={dense ? 'font-semibold underline decoration-dotted underline-offset-2 text-[var(--coral)]' : 'underline text-[var(--coral)]'}>{label}</button>
    )
    return (
      <div className={dense ? '-mt-0.5' : '-mt-2'}>
        <input type="hidden" name="targetMonth" value={value} />
        <p className="text-[0.65625rem] text-[var(--warm-muted)]">
          {dateMonth !== viewMonth
            ? <>{targetMonthLabel(dateMonth, viewMonth)}으로 기록됩니다{dense ? <br /> : ' · '}{action(`${targetMonthLabel(viewMonth, dateMonth)}으로 바꾸기`, viewMonth)}</>
            : action('귀속월 바꾸기', null)}
        </p>
      </div>
    )
  }
  const opts = [-1, 0, 1].map(n => shiftMonthKey(dateMonth, n))
  return (
    <div className={dense ? '' : 'space-y-1.5'}>
      <label className={dense ? 'text-[0.65625rem] text-[var(--warm-muted)]' : 'text-xs font-medium text-[var(--warm-mid)]'}>귀속월</label>
      <select name="targetMonth" value={value} onChange={e => setPicked(e.target.value)}
        className={dense
          ? 'w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-xs text-[var(--warm-dark)] outline-none'
          : 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]'}>
        {!opts.includes(value) && <option value={value}>{targetMonthLabel(value, dateMonth)} (현재)</option>}
        {opts.map(m => <option key={m} value={m}>{targetMonthLabel(m, dateMonth)}</option>)}
      </select>
    </div>
  )
}
