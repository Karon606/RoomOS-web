'use client'

// 납부일 임시 조정 — 특정 청구 월의 납부일을 일시적으로 바꾼다.
// 기본 대상 = 가장 오래된 미납월(firstUnpaidMonth) → "밀린 N월분을 며칠 뒤로 미루기".
//   (미납분을 미루는 게 대부분의 의도. override 가 미납월에 정확히 붙어야 경과일이 맞게 계산됨.)
// 별도 옵션 = 다른(보통 미래) 달의 납부일 변경 — 이전이 완납된 상태에서 일시 조정용.
// 셸의 수납 full 모드(PaymentBody)에서 재사용.

import { useState, useTransition } from 'react'
import { setDueDayOverride, clearDueDayOverride } from '@/app/(app)/rooms/actions'
import { DatePicker } from '@/components/ui/DatePicker'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { kstYmdStr } from '@/lib/kstDate'
import { trackSave, pushToast, humanError } from '@/lib/saveStatus'
import { withParticle } from '@/lib/koParticle'
import CategorySelect from '@/components/ui/CategorySelect'
import { useReasonOptions } from '@/components/ui/useReasonOptions'

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
const monthLabel = (m: string) => `${Number(m.split('-')[1])}월`
const addMonth = (m: string, n: number) => {
  const [y, mm] = m.split('-').map(Number)
  const d = new Date(y, mm - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function DueDayTempAdjustWidget({ leaseTermId, targetMonth, firstUnpaidMonth, room, canEdit, onChange }: {
  leaseTermId: string
  targetMonth: string
  /** 가장 오래된 미납월 — 기본 조정 대상. 없으면 보고 있는 달(targetMonth). */
  firstUnpaidMonth?: string | null
  room: Override
  canEdit: boolean
  /** 변경/해제 후 부모가 selectedRoom 을 재조회하도록. */
  onChange?: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [showForm, setShowForm] = useState(false)
  const [dateInput, setDateInput] = useState('')
  // 사유는 영업장 목록에서 고른다(2026-10-22 2차, CategorySelect addMode 'ask'). reason 은 저장 글자다(lib/reasonLists).
  const [reason, setReason] = useState('')
  const [reasonToList, setReasonToList] = useState(false)
  const reasonOptions = useReasonOptions(showForm ? 'dueDayReasons' : null)
  // 조정 대상 청구 월 (기본 = 미납월 ?? 보는 달). 별도 옵션에서 변경 가능.
  const defaultMonth = firstUnpaidMonth ?? targetMonth
  const [overrideMonth, setOverrideMonth] = useState(defaultMonth)
  const [showMonthOpt, setShowMonthOpt] = useState(false)

  // #4 임시조정은 '대상 월 납부가 완료되면' 화면에서 숨긴다(데이터·계산은 보존).
  //   - 과거 달이면서 납부 완료(미납목록에서 빠짐)된 조정만 숨김.
  //   - 현재·미래 달 조정(사전 조정) 또는 과거라도 아직 미납(연체)인 조정은 계속 표시.
  const nowMonth = kstYmdStr().slice(0, 7)
  const ovrMonth = room.overrideDueDayMonth
  const overrideSettled = !!ovrMonth && ovrMonth < nowMonth && (!firstUnpaidMonth || ovrMonth < firstUnpaidMonth)
  const isActive = !!room.overrideDueDay && !!ovrMonth && !overrideSettled
  const overrideLabel = fmtOvr(room.overrideDueDay)

  // 대상 월 선택지 — 미납월·보는 달·향후 2개월 (중복 제거·정렬)
  const monthOptions = Array.from(new Set([
    firstUnpaidMonth ?? undefined,
    targetMonth,
    addMonth(targetMonth, 1),
    addMonth(targetMonth, 2),
  ].filter(Boolean) as string[])).sort()

  const handleOpenForm = () => {
    const opening = !showForm
    setShowForm(opening)
    if (opening) {
      const startMonth = isActive && room.overrideDueDayMonth ? room.overrideDueDayMonth : defaultMonth
      setOverrideMonth(startMonth)
      setShowMonthOpt(false)
      const existing = isActive ? room.overrideDueDay : null
      let initDate = ''
      if (existing) {
        if (existing.includes('-')) initDate = existing
        else if (existing.includes('말')) {
          const [y, m] = startMonth.split('-').map(Number)
          initDate = `${startMonth}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
        } else {
          const n = parseInt(existing)
          if (!isNaN(n)) initDate = `${startMonth}-${String(n).padStart(2, '0')}`
        }
      } else {
        const baseDay = room.dueDay
        if (baseDay?.includes('말')) {
          const [y, m] = startMonth.split('-').map(Number)
          initDate = `${startMonth}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
        } else if (baseDay) {
          const n = parseInt(baseDay)
          if (!isNaN(n)) initDate = `${startMonth}-${String(n).padStart(2, '0')}`
        }
      }
      setDateInput(initDate || kstYmdStr())
      setReason(isActive ? (room.overrideDueDayReason ?? '') : '')
      setReasonToList(false)
    }
  }

  const handleClear = async () => {
    const ok = await confirmDialog({
      title: room.overrideDueDayMonth
        ? `${monthLabel(room.overrideDueDayMonth)}분 납부일 임시 조정을 삭제할까요?`
        : '납부일 임시 조정을 삭제할까요?',
      message: room.overrideDueDayMonth && room.dueDay
        ? `${monthLabel(room.overrideDueDayMonth)}분 납부일이 원래 ${withParticle(fmtOvr(room.dueDay), '으로/로')} 돌아갑니다. 그 달 연체 경과일도 다시 계산됩니다.`
        : '납부일이 원래대로 돌아갑니다. 그 달 연체 경과일도 다시 계산됩니다.',
      // caution — 원래 납부일로 되돌아가는 동작이라 danger 의 '되돌릴 수 없습니다'와 모순된다.
      // 같은 위젯의 덮어쓰기(기존 조정 소멸)도 caution 이라 위계도 이쪽이 맞다(디자이너 패스).
      level: 'caution',
      confirmLabel: '삭제',
    })
    if (!ok) return
    startTransition(async () => {
      const release = trackSave()
      try {
        await clearDueDayOverride(leaseTermId)
        pushToast('success', '납부일 임시 변경 해제됨')
        onChange?.()
      } catch (e) {
        pushToast('error', humanError(e, '해제 실패'))
      } finally { release() }
    })
  }

  const handleSave = async () => {
    if (!dateInput) return
    // 납부일 임시 조정은 계약당 1쌍만 저장된다(스키마) — 다른 달 조정을 새로 걸면 기존 조정이
    // 경고 없이 사라졌다(A페이즈). 대상 월이 바뀔 때만 물어본다(같은 달 재조정은 과잉).
    if (isActive && room.overrideDueDayMonth && room.overrideDueDayMonth !== overrideMonth) {
      const prevMon = monthLabel(room.overrideDueDayMonth)
      const backTo = room.dueDay ? `원래 ${fmtOvr(room.dueDay)}로` : '원래대로'
      const ok = await confirmDialog({
        title: `${prevMon}분 조정을 지우고 ${monthLabel(overrideMonth)}분으로 바꿀까요?`,
        message: `납부일 임시 조정은 계약당 하나만 저장됩니다. 새로 저장하면 ${prevMon}분 조정(${fmtOvr(room.overrideDueDay)})이 사라지고 ${prevMon} 납부일은 ${backTo} 돌아갑니다.`,
        level: 'caution', confirmLabel: `${monthLabel(overrideMonth)}분으로 바꾸기`,
      })
      if (!ok) return
    }
    const selectedMonth = dateInput.slice(0, 7)
    // 선택 날짜가 대상 월과 같으면 일/말일, 다른 달이면 완전한 날짜로 저장.
    let val: string
    if (selectedMonth === overrideMonth) {
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
        // 저장 글자는 다듬지 않고 보낸다(끝 공백을 걷으면 글 없는 '기타 · ' 가 직접 입력으로 안 읽힌다, 다듬기는 서버).
        await setDueDayOverride(leaseTermId, overrideMonth, val, reason || undefined, { addToList: reasonToList })
        pushToast('success', `${monthLabel(overrideMonth)}분 납부일 임시 변경됨`)
        onChange?.()
      } catch (e) {
        pushToast('error', humanError(e, '변경 실패'))
      } finally { release() }
    })
  }

  const deferToUnpaid = !!firstUnpaidMonth && overrideMonth === firstUnpaidMonth

  return (
    <div className="border-t border-[var(--warning-ring)] px-6 py-3 shrink-0 bg-[var(--warning-bg)]">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-[var(--warning-fg)]">납부일 임시 조정</p>
          {isActive ? (
            <p className="text-xs text-[var(--warning-fg)] mt-0.5">
              {room.overrideDueDayMonth && `${monthLabel(room.overrideDueDayMonth)}분 `}납부일: <span className="font-bold">{overrideLabel}</span>
              {room.overrideDueDayReason && ` (${room.overrideDueDayReason})`}
            </p>
          ) : (
            <p className="text-xs text-[var(--warm-muted)] mt-0.5">임시 조정 없음</p>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {canEdit && isActive && !showForm && (
            <button type="button" onClick={handleClear} disabled={pending}
              className="text-xs text-[var(--danger-fg)] hover:text-[var(--danger-fg)] px-2 py-1 rounded-lg border border-[var(--danger-ring)] hover:border-[var(--danger-ring)] transition-colors disabled:opacity-40">삭제</button>
          )}
          {canEdit && (
            <button onClick={handleOpenForm}
              className="text-xs text-[var(--warning-fg)] hover:text-[var(--warning-fg)] px-2 py-1 rounded-lg border border-[var(--warning-ring)] hover:border-[var(--warning-ring)] transition-colors">
              {showForm ? '닫기' : (isActive ? '수정' : '조정하기')}
            </button>
          )}
        </div>
      </div>
      {showForm && (
        <div className="mt-3 space-y-2">
          {/* 대상 청구 월 — 기본은 미납월. '다른 달' 옵션으로 변경 */}
          <div className="text-xs text-[var(--warning-fg)]">
            {deferToUnpaid
              ? <>밀린 <span className="font-bold">{monthLabel(overrideMonth)}분</span>을 미루는 중</>
              : <><span className="font-bold">{monthLabel(overrideMonth)}분</span> 납부일 조정 중</>}
            {monthOptions.length > 1 && (
              <button type="button" onClick={() => setShowMonthOpt(v => !v)}
                className="ml-2 text-[var(--warning-fg)] underline hover:text-[var(--warning-fg)]">{showMonthOpt ? '닫기' : '다른 달'}</button>
            )}
          </div>
          {showMonthOpt && (
            <div className="flex flex-wrap gap-1.5">
              {monthOptions.map(m => (
                <button key={m} type="button" onClick={() => setOverrideMonth(m)}
                  className={`text-xs px-2 py-1 rounded-lg border transition-colors ${overrideMonth === m
                    ? 'bg-[var(--warning-solid)] text-[var(--on-solid)] border-[var(--warning-ring)]'
                    : 'bg-[var(--canvas)] text-[var(--warning-fg)] border-[var(--warning-ring)] hover:border-[var(--warning-ring)]'}`}>
                  {monthLabel(m)}{firstUnpaidMonth === m ? ' (미납)' : ''}
                </button>
              ))}
            </div>
          )}
          {/* 날짜와 사유가 한 줄이다. 칸마다 최소 9rem 을 쥐고 모자라면 사유가 다음 줄로 내려간다(320·360px x 글자 125%,
              2026-10-22 2차 실측, 입주자 상세의 같은 폼과 같은 꼴). */}
          <div className="flex flex-wrap gap-2">
            <div className="flex-1 min-w-[9rem] space-y-1">
              {/* 라벨도 힌트와 같은 --warm-mid. 이 바탕에서 --warm-muted 는 다크 3.84:1 이다(2차 독립 검수, 같은 클래스 봉합). */}
              <label className="text-xs text-[var(--warm-mid)]">조정 납부일</label>
              <DatePicker value={dateInput} onChange={setDateInput} minDate={`${overrideMonth}-01`}
                className="bg-[var(--canvas)] border border-[var(--warning-ring)] rounded-sm px-3 py-1.5 text-sm text-[var(--warm-dark)] focus:border-[var(--warning-ring)]" />
            </div>
            <div className="flex-1 min-w-[9rem] space-y-1">
              <label className="text-xs text-[var(--warm-mid)]">사유 (선택)</label>
              {/* 힌트는 --warm-mid. 이 위젯 바탕(--warning-bg)에서 --warm-muted 는 다크 3.84:1 이다(2026-10-22 2차 실측).
                  높이는 옆 날짜 칸·직접 입력 칸과 같은 줄 높이 + 위아래 여백 + 테두리로 박는다. select 는 줄 높이를 안 따라
                  2px 낮았고 '기타' 를 고르면 글자칸으로 바뀌며 튀었다(2차 독립 검수, §12 한 폼 안 높이 혼용 금지). */}
              <CategorySelect addMode="ask" value={reason} onChange={setReason} options={reasonOptions}
                ariaLabel="납부일 조정 사유"
                emptyLabel="기록 안 함" placeholder="사유를 직접 입력하세요" hintTone="mid"
                addToList={reasonToList} onAddToListChange={setReasonToList}
                className="w-full h-[calc(2rem+2px)] bg-[var(--canvas)] border border-[var(--warning-ring)] rounded-sm px-3 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--warning-ring)]" />
            </div>
          </div>
          <button disabled={!dateInput || pending} onClick={handleSave}
            className="w-full py-2 bg-[var(--warning-solid)] hover:opacity-90 disabled:opacity-50 text-[var(--on-solid)] text-sm font-semibold rounded-lg transition-colors">
            {pending ? '저장 중…' : (() => {
              if (!dateInput) return '날짜를 선택하세요'
              const d = new Date(dateInput + 'T00:00:00')
              const dateStr = `${d.getMonth() + 1}월 ${d.getDate()}일`
              return `${monthLabel(overrideMonth)}분 납부일을 ${withParticle(dateStr, '으로/로')} ${deferToUnpaid ? '미루기' : '조정'}`
            })()}
          </button>
        </div>
      )}
    </div>
  )
}
