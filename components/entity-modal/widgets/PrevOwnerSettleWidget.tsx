'use client'

// 양도인 메뉴(auto/show/hide) + 양도인 정산 버튼. 양도인 정산은 한 번만 호출 가능 (중복 체크).
// 매출/미납 집계에서 그 달 임대료를 제외하는 영향이 있어 고위험. confirm 다이얼로그 필수.

import { useEffect, useState, useTransition } from 'react'
import {
  setPrevOwnerSettleMenu, getPrevOwnerSettleState, savePrevOwnerSettle,
} from '@/app/(app)/rooms/actions'
import { trackSave, pushToast, withSave } from '@/lib/saveStatus'
import { confirmDialog } from '@/components/ui/ConfirmDialog'

export function PrevOwnerSettleWidget({ leaseTermId, targetMonth, canEdit, onChange }: {
  leaseTermId: string
  targetMonth: string
  canEdit: boolean
  /** 정산 처리 후 부모가 settlement/records 재조회. */
  onChange?: () => void
}) {
  const [canSettle, setCanSettle] = useState(false)
  const [menuMode, setMenuMode] = useState<'auto' | 'show' | 'hide'>('auto')
  const [pending, startTransition] = useTransition()
  const [loaded, setLoaded] = useState(false)

  const reload = async () => {
    try {
      const s = await getPrevOwnerSettleState(leaseTermId, targetMonth)
      setCanSettle(s.canSettle)
      setMenuMode((['auto', 'show', 'hide'] as const).includes(s.menuMode as 'auto' | 'show' | 'hide') ? s.menuMode as 'auto' | 'show' | 'hide' : 'auto')
      setLoaded(true)
    } catch { setLoaded(true) }
  }
  useEffect(() => { reload() /* eslint-disable-next-line */ }, [leaseTermId, targetMonth])

  const handleMenuChange = (mode: 'auto' | 'show' | 'hide') => {
    const old = menuMode
    setMenuMode(mode)
    startTransition(async () => {
      const release = trackSave()
      try {
        await setPrevOwnerSettleMenu(leaseTermId, mode)
        const s = await getPrevOwnerSettleState(leaseTermId, targetMonth)
        setCanSettle(s.canSettle)
        pushToast('success', '양도인 정산 메뉴 설정 변경됨')
      } catch (e) {
        setMenuMode(old)
        pushToast('error', (e as Error).message ?? '설정 변경 실패')
      } finally { release() }
    })
  }

  const handleSettle = async () => {
    if (!(await confirmDialog({ title: `${Number(targetMonth.slice(5))}월 임대료를 양도인 정산으로 처리할까요?`, message: '이 달은 현 소유주 미납·매출 집계에서 제외됩니다.', level: 'caution', confirmLabel: '정산 처리' }))) return
    startTransition(async () => {
      const res = await withSave(() => savePrevOwnerSettle(leaseTermId, targetMonth), { success: '양도인 정산 처리됨' })
      if (res.ok) { await reload(); onChange?.() }
    })
  }

  if (!loaded || !canEdit) return null

  return (
    <div className="border-t border-[var(--warm-border)] pt-3 mt-1 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-[var(--warm-mid)]">양도인 메뉴</span>
          <select value={menuMode} onChange={e => handleMenuChange(e.target.value as 'auto' | 'show' | 'hide')}
            disabled={pending}
            className="text-[0.625rem] bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-1.5 py-1 text-[var(--warm-dark)] outline-none">
            <option value="auto">자동</option>
            <option value="show">항상 표시</option>
            <option value="hide">숨김</option>
          </select>
        </div>
        {canSettle && (
          <button type="button" onClick={handleSettle} disabled={pending}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--warning-bg)] border border-[var(--warning-ring)] text-[var(--warning-fg)] hover:bg-[var(--warning-bg)] transition-colors disabled:opacity-50">
            양도인 정산
          </button>
        )}
      </div>
      <p className="text-[0.625rem] text-[var(--warm-muted)] leading-relaxed">
        <span className="font-medium">메뉴 모드</span>: 자동(인수월·다음달만)·항상 표시·숨김 — 언제든 변경 가능.<br />
        <span className="font-medium">양도인 정산 버튼</span>을 누르면 이 달 임대료를 현 소유주 미납·매출 집계에서 제외 — 계약당 한 번만 처리 가능 (되돌리려면 해당 record 삭제).
      </p>
    </div>
  )
}
