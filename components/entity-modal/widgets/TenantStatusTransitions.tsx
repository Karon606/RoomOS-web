'use client'

// 고객 상태 전환 버튼 + 미니폼. lease.status 기반 다음 단계 전환(투어/예약/입실/퇴실/비거주 등).
// applyStatusTransition·recordDepositReturn 서버액션 그대로 호출. 추출은 UI/state 만 이동.
// transitionsFor() 정의 그대로 이주.

import { useState, useTransition } from 'react'
import { applyStatusTransition, recordDepositReturn } from '@/app/(app)/tenants/actions'
import { DatePicker } from '@/components/ui/DatePicker'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { Btn } from '@/components/ui/Btn'
import { kstYmdStr } from '@/lib/kstDate'
import { trackSave, pushToast } from '@/lib/saveStatus'
import { useEntityModal } from '@/components/entity-modal/EntityModal'
import { shouldOfferCheckoutProration } from '@/lib/prorate'

type TransitionDef = {
  key: string
  label: string
  toStatus: string
  field?: 'moveInDate' | 'expectedMoveOut' | 'moveOutDate' | 'rentAmount'
  fieldLabel?: string
  withDeposit?: boolean
  tone?: 'primary' | 'secondary' | 'danger'
  confirm?: string
}
function transitionsFor(status: string): TransitionDef[] {
  switch (status) {
    case 'WAITING_TOUR': return [
      { key: 'tourDone', label: '투어 완료', toStatus: 'TOUR_DONE', tone: 'secondary', confirm: '투어 완료로 변경할까요?' },
      { key: 'reserve',  label: '예약 전환', toStatus: 'RESERVED', field: 'moveInDate', fieldLabel: '입주 희망일', tone: 'primary' },
      { key: 'cancel',   label: '입실 취소', toStatus: 'CANCELLED', tone: 'danger', confirm: '입실 취소로 변경할까요?' },
    ]
    case 'TOUR_DONE': return [
      { key: 'reserve',  label: '예약 전환', toStatus: 'RESERVED', field: 'moveInDate', fieldLabel: '입주 희망일', tone: 'primary' },
      { key: 'cancel',   label: '입실 취소', toStatus: 'CANCELLED', tone: 'danger', confirm: '입실 취소로 변경할까요?' },
    ]
    case 'RESERVED': return [
      { key: 'moveIn',   label: '입실 처리', toStatus: 'ACTIVE', field: 'moveInDate', fieldLabel: '입주일', tone: 'primary' },
      { key: 'cancel',   label: '입실 취소', toStatus: 'CANCELLED', tone: 'danger', confirm: '입실 취소로 변경할까요?' },
    ]
    case 'ACTIVE': return [
      { key: 'checkoutPending', label: '퇴실 예정 처리', toStatus: 'CHECKOUT_PENDING', field: 'expectedMoveOut', fieldLabel: '퇴실 예정일', tone: 'primary' },
      { key: 'nonResident',     label: '비거주 전환',    toStatus: 'NON_RESIDENT', field: 'rentAmount', fieldLabel: '비거주 월 이용료', tone: 'secondary' },
    ]
    case 'CHECKOUT_PENDING': return [
      { key: 'checkout',       label: '퇴실 처리',    toStatus: 'CHECKED_OUT', field: 'moveOutDate', fieldLabel: '퇴실일', withDeposit: true, tone: 'primary' },
      { key: 'changeMoveOut',  label: '퇴실일 변경',  toStatus: 'CHECKOUT_PENDING', field: 'expectedMoveOut', fieldLabel: '퇴실 예정일', tone: 'secondary' },
      { key: 'cancelCheckout', label: '퇴실예정 취소', toStatus: 'ACTIVE', tone: 'secondary', confirm: '거주중으로 되돌릴까요?' },
    ]
    case 'NON_RESIDENT': return [
      { key: 'reside', label: '거주 전환', toStatus: 'ACTIVE', field: 'moveInDate', fieldLabel: '입주일', tone: 'primary' },
    ]
    default: return []
  }
}

type Lease = {
  id: string
  status: string
  depositAmount: number
  moveInDate: Date | string | null
  expectedMoveOut: Date | string | null
  rentAmount: number
  dueDay: string | null
}

type ActiveTransition = { def: TransitionDef; tenantId: string; tenantName: string; leaseTermId: string; depositAmount: number } | null

const toDateInput = (d: Date | string | null | undefined) => d ? kstYmdStr(new Date(d)) : ''

export function TenantStatusTransitions({ lease, tenantId, tenantName, onChange }: {
  lease: Lease
  tenantId: string
  tenantName: string
  /** 전환 성공 후 부모가 settlement/tenant 재조회. */
  onChange?: () => void
}) {
  const entityModal = useEntityModal()
  const [pending, startTransition] = useTransition()
  const [active, setActive] = useState<ActiveTransition>(null)
  const [transDate, setTransDate] = useState('')
  const [transRent, setTransRent] = useState<number | undefined>()
  const [transRefund, setTransRefund] = useState<number | undefined>()
  // 퇴실 예정일이 납입일과 가까울 때 '퇴실 정산?' 묻는 팝업 (날짜는 이미 저장된 상태)
  const [prorateAsk, setProrateAsk] = useState<{ date: string } | null>(null)

  const transitions = transitionsFor(lease.status)
  if (transitions.length === 0) return null

  const handleClick = (def: TransitionDef) => {
    if (!def.field) {
      if (def.confirm && !confirm(`${tenantName}님 — ${def.confirm}`)) return
      runTransition(def, undefined)
      return
    }
    setTransDate(
      def.field === 'expectedMoveOut' ? toDateInput(lease.expectedMoveOut)
      : def.field === 'moveOutDate'   ? kstYmdStr()
      : def.field === 'moveInDate'    ? (toDateInput(lease.moveInDate) || kstYmdStr())
      : '',
    )
    setTransRent(def.field === 'rentAmount' ? (lease.rentAmount || undefined) : undefined)
    setTransRefund(def.withDeposit ? (lease.depositAmount || 0) : undefined)
    setActive({ def, tenantId, tenantName, leaseTermId: lease.id, depositAmount: lease.depositAmount })
  }

  const runTransition = (
    def: TransitionDef,
    fields: { moveInDate?: string; expectedMoveOut?: string; moveOutDate?: string; rentAmount?: number } | undefined,
  ) => {
    startTransition(async () => {
      const release = trackSave()
      try {
        if (def.withDeposit && transRefund != null && transRefund > 0) {
          const r = await recordDepositReturn({
            leaseTermId: lease.id, tenantId, depositAmount: lease.depositAmount,
            returnedAmount: transRefund,
            date: fields?.moveOutDate || kstYmdStr(),
            tenantName,
          })
          if (!r.ok) { pushToast('error', r.error); return }
        }
        const res = await applyStatusTransition({
          leaseTermId: lease.id, tenantId, toStatus: def.toStatus, ...(fields ?? {}),
        })
        if (!res.ok) { pushToast('error', res.error); return }
        pushToast('success', `${tenantName}님 — ${def.label} 완료`)
        setActive(null)
        onChange?.()
        // 퇴실 예정일 입력/변경이고 납입일과 가까우면(일할 의미 有) '퇴실 정산?' 팝업.
        // 정산 자체는 자동 적용 안 함 — 예 선택 시에만 수납 모달의 퇴실 정산 위젯으로 이동.
        const mo = fields?.expectedMoveOut
        if (def.field === 'expectedMoveOut' && mo
            && shouldOfferCheckoutProration(lease.rentAmount, lease.dueDay, mo, kstYmdStr())) {
          setProrateAsk({ date: mo })
        }
      } finally { release() }
    })
  }

  const submit = () => {
    if (!active) return
    const fields: { moveInDate?: string; expectedMoveOut?: string; moveOutDate?: string; rentAmount?: number } = {}
    if (active.def.field === 'moveInDate')      fields.moveInDate = transDate
    if (active.def.field === 'expectedMoveOut') fields.expectedMoveOut = transDate
    if (active.def.field === 'moveOutDate')     fields.moveOutDate = transDate
    if (active.def.field === 'rentAmount')      fields.rentAmount = transRent ?? 0
    runTransition(active.def, fields)
  }

  return (
    <>
      <div className="flex flex-wrap gap-2 py-2">
        {transitions.map(def => {
          const cls = def.tone === 'primary'
            ? 'bg-[var(--coral)] text-white hover:opacity-90'
            : def.tone === 'danger'
            ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20'
            : 'bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)]'
          return (
            <button key={def.key} type="button" disabled={pending}
              onClick={() => handleClick(def)}
              className={`px-3 py-2 text-xs font-semibold rounded-lg transition-colors disabled:opacity-40 ${cls}`}>
              {def.label}
            </button>
          )
        })}
      </div>

      {/* 미니폼 모달 — z=300 (셸 위) */}
      {active && (
        <div className="fixed inset-0 bg-black/70 z-[300] flex items-center justify-center p-4"
          onClick={() => { if (!pending) setActive(null) }}>
          <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-sm flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--warm-border)]">
              <h2 className="text-sm font-bold text-[var(--warm-dark)]">{active.tenantName}님 — {active.def.label}</h2>
            </div>
            <div className="px-5 py-4 space-y-3">
              {['moveInDate', 'expectedMoveOut', 'moveOutDate'].includes(active.def.field ?? '') && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">{active.def.fieldLabel}</label>
                  <DatePicker value={transDate} onChange={setTransDate}
                    className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
                </div>
              )}
              {active.def.field === 'rentAmount' && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">{active.def.fieldLabel}</label>
                  <MoneyInput value={transRent} onChange={setTransRent} placeholder="0원" />
                </div>
              )}
              {active.def.withDeposit && active.depositAmount > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">
                    보증금 환불액 <span className="text-[var(--warm-muted)] font-normal">(보증금 {active.depositAmount.toLocaleString()}원)</span>
                  </label>
                  <MoneyInput value={transRefund} onChange={setTransRefund} placeholder="0원" />
                  <p className="text-[0.625rem] text-[var(--warm-muted)] leading-relaxed">환불하지 않은 금액은 보증금 수익으로 기록됩니다.</p>
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-[var(--warm-border)] flex gap-2">
              <Btn variant="secondary" size="md" onClick={() => setActive(null)} disabled={pending} className="flex-1">취소</Btn>
              <Btn variant="primary" size="md" onClick={submit} disabled={pending} className="flex-1">{pending ? '처리 중…' : '확인'}</Btn>
            </div>
          </div>
        </div>
      )}

      {/* 퇴실 정산 여부 팝업 — 퇴실일이 납입일과 가까울 때만. 날짜는 이미 저장됨. */}
      {prorateAsk && (
        <div className="fixed inset-0 bg-black/70 z-[310] flex items-center justify-center p-4"
          onClick={() => setProrateAsk(null)}>
          <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-sm flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--warm-border)]">
              <h2 className="text-sm font-bold text-[var(--warm-dark)]">{tenantName}님 — 퇴실 정산</h2>
            </div>
            <div className="px-5 py-4 space-y-2">
              <p className="text-sm text-[var(--warm-dark)] leading-relaxed">
                퇴실 예정일이 납입일과 가깝습니다. 선납 기준 <b>일할로 퇴실 정산</b>을 하시겠어요?
              </p>
              <p className="text-[0.6875rem] text-[var(--warm-muted)] leading-relaxed">
                · <b>예</b> — 수납 화면의 퇴실 정산으로 이동해 일수만큼 계산(미납 시 정산 후 입금 / 완납 시 환불).<br />
                · <b>아니오</b> — 퇴실 예정일만 저장(이번 달 풀 청구 유지).
              </p>
            </div>
            <div className="px-5 py-3 border-t border-[var(--warm-border)] flex gap-2">
              <Btn variant="secondary" size="md" onClick={() => setProrateAsk(null)} className="flex-1">아니오</Btn>
              <Btn variant="primary" size="md" className="flex-1"
                onClick={() => {
                  setProrateAsk(null)
                  entityModal.open({ kind: 'payment', leaseTermId: lease.id, tenantId, openCheckoutProration: true })
                }}>
                예, 정산하기
              </Btn>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
