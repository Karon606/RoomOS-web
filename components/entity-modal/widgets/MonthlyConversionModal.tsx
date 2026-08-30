'use client'

// 월 계약 전환 모달 — 주단위로 들어왔다가 눌러앉은 사람의 계약 조건을 월액으로 바꾼다.
//
// 종전에는 수정 폼의 단기 체크박스를 끄는 것이 전부였고, 그 한 번이 다섯 칸을 말없이 움직였다.
// 여기서는 **바뀌는 것을 전부 미리 보여주고 사람이 확정한다.** 특히 보증금·청소비는 손대지
// 않는다 — 이미 받은 계약에 기본값을 다시 박으면 없던 부족이 생긴다(운영자 확정 2026-08-30).

import { useState, useEffect } from 'react'
import { previewMonthlyConversion, convertToMonthly, undoMonthlyConversion, type MonthlyConversionPreview } from '@/app/(app)/tenants/actions'
import { Modal } from '@/components/ui/Modal'
import { Btn } from '@/components/ui/Btn'
import { trackSave, pushToast } from '@/lib/saveStatus'
import { fmtWon } from '@/lib/fmtMoney'
import { fmtRoomNo } from '@/lib/roomNo'

/** 값 한 줄 — 컴포넌트 밖에 둔다. 안에서 만들면 렌더마다 새 타입이 되어 그 아래가 통째로 다시 마운트된다. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-xs">
      <span className="text-[var(--warm-muted)] shrink-0">{label}</span>
      <span className="text-[var(--warm-dark)] text-right tabular-nums">{children}</span>
    </div>
  )
}

export function MonthlyConversionModal({ open, onClose, leaseTermId, onDone }: {
  open: boolean
  onClose: () => void
  leaseTermId: string
  onDone?: () => void
}) {
  const [data, setData] = useState<MonthlyConversionPreview | null>(null)
  const [rent, setRent] = useState('')
  const [clearOut, setClearOut] = useState(true)
  const [dueDay, setDueDay] = useState('')
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!open) return
    let live = true
    void previewMonthlyConversion(leaseTermId).then(r => {
      if (!live) return
      setData(r)
      if (r.ok) {
        // 방 표준가를 프리필하되 사람이 고친다. 없으면 빈 칸 — 단기 누적액을 월세로 승격시키지 않는다.
        setRent(r.suggestedRent ? String(r.suggestedRent) : '')
        setDueDay(r.currentDueDay ?? r.suggestedDueDay)
      }
    })
    return () => { live = false }
  }, [open, leaseTermId])

  const rentNum = parseInt(rent.replace(/[^0-9]/g, ''), 10) || 0
  const ok = data?.ok === true

  const handleApply = () => {
    if (!ok || rentNum <= 0) return
    setPending(true)
    const release = trackSave()
    void convertToMonthly({ leaseTermId, rentAmount: rentNum, clearExpectedMoveOut: clearOut, dueDay })
      .then(r => {
        if (!r.ok) { pushToast('error', r.error); return }
        pushToast('success', `월 계약으로 전환됨 · ${fmtWon(rentNum)}`, {
          ...(r.rewrote > 0 ? { detail: `입주월 청구 ${r.rewrote}건을 새 이용료로 맞췄습니다` } : {}),
          action: {
            label: '적용취소',
            run: () => { void undoMonthlyConversion(leaseTermId).then(u => {
              if (!u.ok) { pushToast('error', u.error); return }
              pushToast('info', '전환을 되돌렸습니다'); onDone?.()
            }) },
          },
        })
        onClose(); onDone?.()
      })
      .finally(() => { setPending(false); release() })
  }

  return (
    <Modal open={open} onClose={onClose} width="sm" title="월 계약으로 전환" z={380}>
      {!data ? (
        <p className="text-xs py-6 text-center" style={{ color: 'var(--warm-muted)' }}>불러오는 중…</p>
      ) : !data.ok ? (
        <p className="text-xs py-6 text-center" style={{ color: 'var(--coral)' }}>{data.error}</p>
      ) : (
        <div className="space-y-4">
          <p className="text-xs leading-relaxed" style={{ color: 'var(--warm-mid)' }}>
            {data.roomNo ? `${fmtRoomNo(data.roomNo)} ` : ''}{data.tenantName} 님을 월 계약으로 바꿉니다. 이미 받은 수납은 그대로 두고 계약 조건만 바뀝니다.
          </p>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">월 이용료</label>
            <div className="flex items-center gap-1.5">
              <input type="text" inputMode="numeric" value={rent ? rentNum.toLocaleString() : ''}
                onChange={e => setRent(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder={data.suggestedRent ? data.suggestedRent.toLocaleString() : '월 이용료'}
                className="flex-1 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-2 text-sm text-right tabular-nums text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
              <span className="text-xs text-[var(--warm-muted)]">원</span>
            </div>
            <p className="text-[0.65625rem] text-[var(--warm-muted)]">
              지금 값 {fmtWon(data.currentRent)} 은 단기 체류 전체 사용료입니다. 월세가 아니라 그대로 두면 안 됩니다.
              {data.suggestedRent ? ` 방 표준가는 ${fmtWon(data.suggestedRent)} 입니다.` : ''}
            </p>
          </div>

          <div className="rounded-lg px-3 py-2.5 space-y-1" style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)' }}>
            <p className="text-xs font-semibold text-[var(--warm-mid)] mb-1">입주월 {data.inMonth}</p>
            <Row label="지금 청구(락)">{fmtWon(data.lockedExpected)}</Row>
            <Row label="받은 금액">{fmtWon(data.paidInMonth)}</Row>
            {rentNum > 0 && data.lockedExpected > rentNum && (
              <Row label="전환 후 청구">{fmtWon(rentNum)}</Row>
            )}
            <p className="text-[0.65625rem] pt-1" style={{ color: 'var(--warm-muted)' }}>
              {rentNum > 0 && data.lockedExpected > rentNum
                ? '입주월 청구를 새 이용료로 내립니다. 안 내리면 옛 금액이 남아 허수 미납이 됩니다.'
                : '입주월 청구는 그대로 둡니다.'}
            </p>
          </div>

          <div className="rounded-lg px-3 py-2.5 space-y-1" style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)' }}>
            <p className="text-xs font-semibold text-[var(--warm-mid)] mb-1">보증금 (안 바꿉니다)</p>
            <Row label="계약">{fmtWon(data.deposit.contract)}</Row>
            <Row label="받은 보증금">{fmtWon(data.deposit.received)}</Row>
            {data.deposit.coveredByCleaning > 0 && <Row label="청소비 몫">{fmtWon(data.deposit.coveredByCleaning)}</Row>}
            {data.deposit.shortfall > 0 && <Row label="부족">{fmtWon(data.deposit.shortfall)}</Row>}
            <p className="text-[0.65625rem] pt-1" style={{ color: 'var(--warm-muted)' }}>
              이미 받은 구성이라 전환이 건드리지 않습니다. 바꾸시려면 입주자 정보 수정에서 따로 하세요.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">납부일</label>
            <div className="flex items-center gap-1.5">
              <input type="text" inputMode="numeric" value={dueDay}
                onChange={e => setDueDay(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
                className="w-20 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-2 text-sm text-right tabular-nums text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
              <span className="text-xs text-[var(--warm-muted)]">일</span>
            </div>
            <p className="text-[0.65625rem] text-[var(--warm-muted)]">
              {data.currentDueDay ? `지금 ${data.currentDueDay}일입니다.` : `비어 있어 입주일에서 ${data.suggestedDueDay}일을 제안합니다.`}
            </p>
          </div>

          {data.currentOut && (
            <label className="flex items-start gap-2 text-xs cursor-pointer text-[var(--warm-dark)]">
              <input type="checkbox" checked={clearOut} onChange={e => setClearOut(e.target.checked)}
                className="w-4 h-4 accent-[var(--coral)] mt-0.5 shrink-0" />
              <span className="break-keep">퇴실 예정일({data.currentOut})을 지웁니다
                <span className="block text-[0.65625rem] text-[var(--warm-muted)]">계속 사실 예정이면 지우고, 날짜가 정해져 있으면 체크를 풀어 두세요.</span>
              </span>
            </label>
          )}

          <div className="flex gap-2 pt-1">
            <Btn variant="secondary" size="md" onClick={onClose} className="flex-1">취소</Btn>
            <Btn variant="primary" size="md" onClick={handleApply} disabled={pending || rentNum <= 0} className="flex-1 font-semibold">
              {pending ? '전환 중…' : '전환'}
            </Btn>
          </div>
          <p className="text-[0.65625rem] text-center" style={{ color: 'var(--warm-muted)' }}>
            전환 후 새 월 계약서를 발급하시면 조기 퇴실 조항이 함께 들어갑니다. 기존 계약서는 보관용으로 남습니다.
          </p>
        </div>
      )}
    </Modal>
  )
}
