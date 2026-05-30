'use client'

// 월세 할인 — 추가/삭제 위젯. 셸의 수납 full 모드와 RoomsClient 양쪽에서 재사용.
// 자체 fetch (getRentDiscounts) + 내부 state. 추가/삭제 후 부모에 onChange 콜백.

import { useEffect, useState, useTransition } from 'react'
import { getRentDiscounts, addRentDiscount, deleteRentDiscount, type RentDiscountRow } from '@/app/(app)/rooms/actions'
import { discountLabel } from '@/lib/rentDiscount'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { DatePicker } from '@/components/ui/DatePicker'
import { withSave } from '@/lib/saveStatus'

export function DiscountWidget({ leaseTermId, onChange }: {
  leaseTermId: string
  /** 추가·삭제 후 호출 — 부모가 settlement/balance 를 재조회하도록. */
  onChange?: () => void
}) {
  const [discs, setDiscs] = useState<RentDiscountRow[]>([])
  const [pending, startTransition] = useTransition()

  const [showForm, setShowForm] = useState(false)
  const [type, setType]   = useState<'amount' | 'percent'>('amount')
  const [value, setValue] = useState<number>(0)
  const [scope, setScope] = useState<'permanent' | 'temporary'>('permanent')
  const [start, setStart] = useState('')
  const [end, setEnd]     = useState('')

  const reload = async () => { setDiscs(await getRentDiscounts(leaseTermId)) }
  useEffect(() => { reload() /* eslint-disable-next-line */ }, [leaseTermId])

  const handleAdd = () => {
    if (!(value > 0)) return
    startTransition(async () => {
      const res = await withSave(() => addRentDiscount({
        leaseTermId,
        discountType: type,
        value,
        scope,
        startMonth: scope === 'temporary' && start ? start : null,
        endMonth:   scope === 'temporary' && end   ? end   : null,
      }), { success: '할인 적용됨' })
      if (!res.ok) return
      await reload()
      setShowForm(false); setValue(0); setStart(''); setEnd('')
      onChange?.()
    })
  }

  const handleDelete = (id: string) => {
    startTransition(async () => {
      const res = await withSave(() => deleteRentDiscount(id), { success: '할인 삭제됨' })
      if (!res.ok) return
      await reload()
      onChange?.()
    })
  }

  return (
    <div className="border-t border-[var(--warm-border)] pt-3 mt-1 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-emerald-600">월세 할인</p>
        {!showForm && (
          <button onClick={() => setShowForm(true)}
            className="text-xs px-2.5 py-1 rounded-lg border border-emerald-300 text-emerald-600 hover:bg-emerald-50 transition-colors">+ 할인 추가</button>
        )}
      </div>
      {discs.length === 0 && !showForm && (
        <p className="text-[0.6875rem] text-[var(--warm-muted)]">적용된 할인이 없습니다.</p>
      )}
      {discs.map(d => (
        <div key={d.id} className="flex items-center gap-2 text-xs">
          <span className="flex-1 text-[var(--warm-dark)]">{discountLabel(d)}</span>
          <button onClick={() => handleDelete(d.id)} disabled={pending}
            className="text-[0.6875rem] px-2 py-1 rounded-lg border border-red-200 text-red-400 hover:text-red-600 transition-colors disabled:opacity-40">삭제</button>
        </div>
      ))}
      {showForm && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 space-y-2">
          <div className="flex gap-2">
            <select value={type} onChange={e => setType(e.target.value as 'amount' | 'percent')}
              className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none">
              <option value="amount">금액(원)</option>
              <option value="percent">퍼센트(%)</option>
            </select>
            <div className="flex-1">
              <MoneyInput value={value} onChange={setValue} placeholder={type === 'percent' ? '예: 10' : '예: 50000'} />
            </div>
          </div>
          <select value={scope} onChange={e => setScope(e.target.value as 'permanent' | 'temporary')}
            className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none">
            <option value="permanent">영구(매월)</option>
            <option value="temporary">일시(기간)</option>
          </select>
          {scope === 'temporary' && (
            <div className="flex items-center gap-1.5">
              <div className="flex-1">
                <DatePicker monthOnly placeholder="시작 월"
                  value={start ? start + '-01' : ''}
                  onChange={v => setStart(v ? v.slice(0, 7) : '')}
                  className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-xs text-[var(--warm-dark)]" />
              </div>
              <span className="text-xs text-[var(--warm-muted)]">~</span>
              <div className="flex-1">
                <DatePicker monthOnly placeholder="끝(무기한)"
                  value={end ? end + '-01' : ''}
                  onChange={v => setEnd(v ? v.slice(0, 7) : '')}
                  className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-xs text-[var(--warm-dark)]" />
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => setShowForm(false)}
              className="flex-1 py-1.5 text-sm rounded-lg border border-[var(--warm-border)] text-[var(--warm-mid)]">취소</button>
            <button onClick={handleAdd} disabled={pending || !(value > 0)}
              className="flex-1 py-1.5 text-sm font-medium rounded-lg text-white disabled:opacity-50" style={{ background: '#16a34a' }}>적용</button>
          </div>
          <p className="text-[0.625rem] text-[var(--warm-muted)]">할인은 해당 월 청구액(이용료)에서 차감돼 미수 계산에 반영됩니다.</p>
        </div>
      )}
    </div>
  )
}
