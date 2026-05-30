'use client'

// 납부일 임시 조정 — 그 달만. 셸의 수납 full 모드와 RoomsClient 양쪽에서 재사용.
// 입력 변환 로직(같은 월 = 숫자/말일, 다른 월 = full date) 그대로 이주.

import { useState, useTransition } from 'react'
import { setDueDayOverride, clearDueDayOverride } from '@/app/(app)/rooms/actions'
import { DatePicker } from '@/components/ui/DatePicker'
import { kstYmdStr } from '@/lib/kstDate'
import { trackSave, pushToast } from '@/lib/saveStatus'

type Override = {
  overrideDueDay: string | null
  overrideDueDayMonth: string | null
  overrideDueDayReason: string | null
  dueDay: string | null
}

const fmtOvr = (v: string | null | undefined) => {
  if (!v) return ''
  if (v.includes('-')) { const d = new Date(v + 'T00:00:00'); return `${d.getMonth() + 1}월 ${d.getDate()}일` }
  return v.includes('말') ? '말일' : `${v}일`
}

export function DueDayTempAdjustWidget({ leaseTermId, targetMonth, room, canEdit, onChange }: {
  leaseTermId: string
  targetMonth: string
  room: Override
  canEdit: boolean
  /** 변경/해제 후 부모가 selectedRoom 을 재조회하도록. */
  onChange?: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [showForm, setShowForm] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [dateInput, setDateInput] = useState('')
  const [reason, setReason] = useState('')

  const isActive = room.overrideDueDayMonth === targetMonth && !!room.overrideDueDay
  const overrideLabel = fmtOvr(room.overrideDueDay)

  const handleOpenForm = () => {
    const opening = !showForm
    setShowForm(opening)
    setConfirmClear(false)
    if (opening) {
      const existing = isActive ? room.overrideDueDay : null
      let initDate = ''
      if (existing) {
        if (existing.includes('-')) initDate = existing
        else if (existing.includes('말')) {
          const [y, m] = targetMonth.split('-').map(Number)
          initDate = `${targetMonth}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
        } else {
          const n = parseInt(existing)
          if (!isNaN(n)) initDate = `${targetMonth}-${String(n).padStart(2, '0')}`
        }
      } else {
        const baseDay = room.dueDay
        if (baseDay?.includes('말')) {
          const [y, m] = targetMonth.split('-').map(Number)
          initDate = `${targetMonth}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
        } else if (baseDay) {
          const n = parseInt(baseDay)
          if (!isNaN(n)) initDate = `${targetMonth}-${String(n).padStart(2, '0')}`
        }
      }
      setDateInput(initDate || kstYmdStr())
      setReason(isActive ? (room.overrideDueDayReason ?? '') : '')
    }
  }

  const handleClear = () => {
    setConfirmClear(false)
    startTransition(async () => {
      const release = trackSave()
      try {
        await clearDueDayOverride(leaseTermId)
        pushToast('success', '이번 달 납부일 임시 변경 해제됨')
        onChange?.()
      } catch (e) {
        pushToast('error', (e as Error).message ?? '해제 실패')
      } finally { release() }
    })
  }

  const handleSave = () => {
    if (!dateInput) return
    const selectedMonth = dateInput.slice(0, 7)
    let val: string
    if (selectedMonth === targetMonth) {
      const d = new Date(dateInput + 'T00:00:00')
      const dayNum = d.getDate()
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
      val = dayNum >= lastDay ? '말일' : String(dayNum)
    } else {
      val = dateInput
    }
    setShowForm(false)
    startTransition(async () => {
      const release = trackSave()
      try {
        await setDueDayOverride(leaseTermId, targetMonth, val, reason.trim() || undefined)
        pushToast('success', '이번 달 납부일 임시 변경됨')
        onChange?.()
      } catch (e) {
        pushToast('error', (e as Error).message ?? '변경 실패')
      } finally { release() }
    })
  }

  return (
    <div className="border-t border-amber-200 px-6 py-3 shrink-0 bg-amber-50">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-amber-400">납부일 임시 조정</p>
          {isActive ? (
            <p className="text-xs text-amber-700 mt-0.5">
              이번 달 납부일: <span className="font-bold">{overrideLabel}</span>
              {room.overrideDueDayReason && ` (${room.overrideDueDayReason})`}
            </p>
          ) : (
            <p className="text-xs text-[var(--warm-muted)] mt-0.5">이번 달 임시 조정 없음</p>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {canEdit && isActive && !showForm && (
            confirmClear ? (
              <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-2 py-1">
                <span className="text-xs text-red-500">정말 삭제할까요?</span>
                <button type="button" onClick={() => setConfirmClear(false)}
                  className="text-xs text-gray-400 hover:text-gray-600">취소</button>
                <button type="button" onClick={handleClear}
                  className="text-xs bg-red-500 hover:bg-red-400 text-white font-semibold px-1.5 py-0.5 rounded">삭제</button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmClear(true)}
                className="text-xs text-red-500 hover:text-red-600 px-2 py-1 rounded-lg border border-red-200 hover:border-red-400 transition-colors">삭제</button>
            )
          )}
          {canEdit && (
            <button onClick={handleOpenForm}
              className="text-xs text-amber-600 hover:text-amber-700 px-2 py-1 rounded-lg border border-amber-200 hover:border-amber-400 transition-colors">
              {showForm ? '닫기' : (isActive ? '수정' : '조정하기')}
            </button>
          )}
        </div>
      </div>
      {showForm && (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2">
            <div className="flex-1 space-y-1">
              <label className="text-xs text-[var(--warm-muted)]">조정 납부일</label>
              <DatePicker value={dateInput} onChange={setDateInput} minDate={`${targetMonth}-01`}
                className="bg-[var(--canvas)] border border-amber-200 rounded-lg px-3 py-1.5 text-sm text-[var(--warm-dark)] focus:border-amber-500" />
            </div>
            <div className="flex-1 space-y-1">
              <label className="text-xs text-[var(--warm-muted)]">사유 (선택)</label>
              <input type="text" placeholder="사유" value={reason} onChange={e => setReason(e.target.value)}
                className="w-full bg-[var(--canvas)] border border-amber-200 rounded-lg px-3 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-amber-500" />
            </div>
          </div>
          <button disabled={!dateInput || pending} onClick={handleSave}
            className="w-full py-2 bg-amber-500 active:bg-amber-600 hover:bg-amber-400 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors">
            {pending ? '저장 중...' : (() => {
              if (!dateInput) return '날짜를 선택하세요'
              const selectedMonth = dateInput.slice(0, 7)
              if (selectedMonth !== targetMonth) {
                const d = new Date(dateInput + 'T00:00:00')
                return `${targetMonth} 납부일을 ${d.getMonth() + 1}월 ${d.getDate()}일로 조정`
              }
              const d = new Date(dateInput + 'T00:00:00')
              const dayNum = d.getDate()
              const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
              return `${targetMonth} 납부일을 ${dayNum >= lastDay ? '말일' : `${dayNum}일`}로 조정`
            })()}
          </button>
        </div>
      )}
    </div>
  )
}
