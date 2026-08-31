'use client'

// 월세 할인 — 추가/삭제 위젯. 셸의 수납 full 모드와 RoomsClient 양쪽에서 재사용.
// 자체 fetch (getRentDiscounts) + 내부 state. 추가/삭제 후 부모에 onChange 콜백.

import { useEffect, useState, useTransition } from 'react'
import { getRentDiscounts, addRentDiscount, deleteRentDiscount, previewDiscountEnd, endRentDiscount, undoEndRentDiscount, type RentDiscountRow } from '@/app/(app)/rooms/actions'
import { getDiscountReasons, addDiscountReason } from '@/app/(app)/settings/actions'
import CategorySelect from '@/components/ui/CategorySelect'
import { discountLabel } from '@/lib/rentDiscount'
import { kstMonthStr } from '@/lib/kstDate'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { DatePicker } from '@/components/ui/DatePicker'
import { Btn } from '@/components/ui/Btn'
import { withSave, pushToast } from '@/lib/saveStatus'
import { confirmDialog, choiceDialog } from '@/components/ui/ConfirmDialog'

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
  // 할인 사유 — 왜 깎아 주는지가 남아야 한다(운영자 요구 2026-08-31). 목록은 영업장 설정에 있고
  // 직접 적은 사유는 저장할 때 그 목록에 쌓인다(직업 목록과 같은 문법).
  const [reason, setReason] = useState('')
  const [reasonOptions, setReasonOptions] = useState<string[]>([])

  const reload = async () => { setDiscs(await getRentDiscounts(leaseTermId)) }
  useEffect(() => { reload() /* eslint-disable-next-line */ }, [leaseTermId])
  useEffect(() => {
    let live = true
    void getDiscountReasons().then(r => { if (live) setReasonOptions(r) }).catch(() => {})
    return () => { live = false }
  }, [])

  const handleAdd = () => {
    if (!(value > 0)) return
    startTransition(async () => {
      const res = await withSave(() => addRentDiscount({
        leaseTermId,
        discountType: type,
        value,
        scope,
        startMonth: start || null,
        endMonth:   scope === 'temporary' && end   ? end   : null,
        ...(reason.trim() ? { memo: reason.trim() } : {}),
      }), { success: '할인 적용됨' })
      if (!res.ok) return
      // 목록에 없는 사유를 적었으면 영업장 목록에 더한다 — 다음에도 고를 수 있게.
      if (reason.trim() && !reasonOptions.includes(reason.trim())) {
        await addDiscountReason(reason.trim()).catch(() => {})
        setReasonOptions(await getDiscountReasons().catch(() => reasonOptions))
      }
      await reload()
      setShowForm(false); setValue(0); setStart(''); setEnd(''); setReason('')
      onChange?.()
    })
  }

  /**
   * 할인을 정리한다 — 뜻이 둘이라 먼저 묻는다 (2026-08-31 운영자 승인).
   *
   * 종전에는 삭제 하나뿐이었고 그것이 늘 전 기간 소급이었다. 그래서 이미 할인가로 받고 끝난
   * 지난 달까지 정가로 되쓰여 없던 미수가 생겼다("과거는 과거지" 운영자 지적).
   *
   * 이제 기본은 중단이다. 아직 안 걷은 첫 달부터 정가가 되고 그 앞은 그대로 둔다. 잘못 넣은
   * 할인을 정말 없애야 할 때만 소급 삭제를 고른다.
   */
  const handleDelete = async (d: { id: string; scope: string; startMonth: string | null; endMonth: string | null }) => {
    const prev = await previewDiscountEnd(d.id)
    // 경계를 못 구하면 중단을 제안할 수 없다 — 소급 삭제만 묻는다(옛 동선 그대로).
    const canEnd = prev.ok && (!d.endMonth || d.endMonth > prev.endMonth)
    const fromLabel = prev.ok ? `${Number(prev.effectiveFrom.split('-')[1])}월` : ''

    if (canEnd && prev.ok) {
      const pick = await choiceDialog({
        title: '이 할인을 어떻게 정리할까요?',
        message: `중단하면 지난 달까지는 그대로 두고 ${fromLabel}부터 정가로 청구합니다. 소급 삭제는 이 할인이 적용된 모든 달을 정가로 되돌립니다.`,
        confirmLabel: `${fromLabel}부터 중단`,
        altLabel: '소급 삭제',
        cancelLabel: '취소',
      })
      if (pick === 'confirm') {
        startTransition(async () => {
          const res = await withSave(() => endRentDiscount(d.id, prev.endMonth), { success: `할인 중단됨 · ${fromLabel}부터 정가` })
          if (!res.ok) return
          // 적용취소 — 끝월을 도로 비우고 락도 역방향으로 되쓴다.
          pushToast('success', `할인 중단됨 · ${fromLabel}부터 정가로 청구합니다`, {
            action: {
              label: '적용취소',
              run: () => { void undoEndRentDiscount(res.undo).then(async u => {
                if (!u.ok) { pushToast('error', u.error); return }
                pushToast('info', '중단을 되돌렸습니다'); await reload(); onChange?.()
              }) },
            },
          })
          await reload()
          onChange?.()
        })
        return
      }
      if (pick !== 'alt') return
    }

    // 소급 삭제 — 파괴적이라 한 번 더 묻는다.
    const isPermanent = d.scope === 'permanent'
    const range = d.startMonth
      ? (d.endMonth
          ? `${Number(d.startMonth.split('-')[1])}월부터 ${Number(d.endMonth.split('-')[1])}월까지의`
          : `${Number(d.startMonth.split('-')[1])}월분부터 모든 달의`)
      : '적용된'
    if (!(await confirmDialog({
      level: 'danger', title: '할인을 소급 삭제할까요?',
      message: isPermanent && !d.startMonth
        ? '이 할인이 적용된 모든 달의 청구액이 정가로 다시 계산됩니다. 이미 수납이 기록된 지난 달도 포함되어 그 달의 미수가 늘어날 수 있습니다.'
        : `${range} 청구액이 정가로 다시 계산됩니다. 그 기간에 이미 수납이 기록돼 있으면 미수가 늘어날 수 있습니다.`,
      irreversibleNote: '삭제한 할인은 다시 등록해야 되돌아갑니다.',
      confirmLabel: '소급 삭제',
    }))) return
    const id = d.id
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
        <p className="text-xs font-medium text-[var(--success-fg)]">월 이용료 할인</p>
        {!showForm && (
          <button onClick={() => { setStart(kstMonthStr()); setShowForm(true) }}
            className="text-xs px-2.5 py-1 rounded-lg border border-[var(--success-ring)] text-[var(--success-fg)] hover:bg-[var(--success-bg)] transition-colors">+ 할인 추가</button>
        )}
      </div>
      {discs.length === 0 && !showForm && (
        <p className="text-[0.6875rem] text-[var(--warm-muted)]">적용된 할인이 없습니다.</p>
      )}
      {discs.map(d => (
        <div key={d.id} className="flex items-center gap-2 text-xs">
          <span className="flex-1 text-[var(--warm-dark)]">{discountLabel(d)}</span>
          <button onClick={() => handleDelete(d)} disabled={pending}
            className="text-[0.6875rem] px-2 py-1 rounded-lg border border-[var(--danger-ring)] text-[var(--danger-fg)] hover:text-[var(--danger-fg)] transition-colors disabled:opacity-40">삭제</button>
        </div>
      ))}
      {showForm && (
        <div className="rounded-xl border border-[var(--success-ring)] bg-[var(--success-bg)] p-3 space-y-2">
          <div className="flex gap-2">
            <select value={type} onChange={e => setType(e.target.value as 'amount' | 'percent')}
              className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none">
              <option value="amount">금액(원)</option>
              <option value="percent">퍼센트(%)</option>
            </select>
            <div className="flex-1">
              {type === 'percent' ? (
                <div className="relative">
                  <input type="text" inputMode="numeric" value={value ? String(value) : ''}
                    onChange={e => setValue(Number(e.target.value.replace(/[^0-9]/g, '')) || 0)}
                    placeholder="예: 10"
                    className="mono tnum w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 pr-8 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus:border-[var(--persimmon)] focus:shadow-[0_0_0_3px_rgba(160,60,46,0.12)] transition-colors" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--warm-muted)] pointer-events-none">%</span>
                </div>
              ) : (
                <MoneyInput value={value} onChange={setValue} placeholder="예: 50000" />
              )}
            </div>
          </div>
          <select value={scope} onChange={e => setScope(e.target.value as 'permanent' | 'temporary')}
            className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none">
            <option value="permanent">영구(매월)</option>
            <option value="temporary">일시(기간)</option>
          </select>
          {/* 영구 할인의 시작월 — 기본은 이번 달이다(2026-08-31 운영자 승인). 종전에는 시작이
              없어 무조건 전 기간 소급이었다. 과거에 약속한 할인을 늦게 등록할 때만 시작월을
              지난 달로 내린다(403호 같은 경우). */}
          {scope === 'permanent' && (
            <div className="space-y-1">
              <DatePicker monthOnly placeholder="시작 월"
                value={start ? start + '-01' : ''}
                onChange={v => setStart(v ? v.slice(0, 7) : '')}
                className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-xs text-[var(--warm-dark)]" />
              <p className="text-[0.65625rem] text-[var(--warm-muted)]">
                이 달 청구부터 할인이 붙습니다. 지난 달로 내리면 그 달 청구도 다시 계산됩니다.
              </p>
            </div>
          )}
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
          {/* 사유 — 목록 끝 '기타(직접 입력)'로 전환되는 정본 문법(입주자 직업과 같다). */}
          <CategorySelect
            value={reason}
            onChange={setReason}
            options={reasonOptions}
            emptyLabel="사유 선택 (선택)"
            placeholder="할인 사유를 직접 입력하세요"
            closeIconSize={12}
            showAddHint
            className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none" />
          <div className="flex gap-2">
            <Btn variant="secondary" size="sm" className="flex-1" onClick={() => setShowForm(false)}>취소</Btn>
            <Btn variant="success" size="sm" className="flex-1" onClick={handleAdd} disabled={pending || !(value > 0)}>적용</Btn>
          </div>
          <p className="text-[0.65625rem] text-[var(--warm-muted)]">
            할인은 해당 월 청구액(이용료)에서 차감돼 미수 계산에 반영됩니다.
            {scope === 'permanent' && ' 시작 월부터 매월 적용됩니다.'}
          </p>
        </div>
      )}
    </div>
  )
}
