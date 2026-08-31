'use client'
// 퇴실 이용료 정산 섹션 정본 — 퇴실 처리 세 화면이 같은 물음을 같은 문법으로 묻는다.
//
// 왜 한 벌인가. 퇴실 처리는 세 곳에서 된다(홈 알림·프리즘 입주자 정보·입주자 관리 수정).
// 그런데 이 물음은 수정 폼에만 있었다. 홈과 프리즘은 **미리 확정해 둔 정산이 있을 때만**
// 환불했고, 정산을 안 해 둔 중도퇴실은 아무것도 묻지 않고 만월 청구를 그대로 두었다.
//
// 납부일 1일인 사람이 15일에 나갈 때 정산 팝업을 건너뛰고 홈 알림에서 퇴실 처리하면 반 달치가
// 회사에 남는다. 게다가 퇴실 상태라 미납 집계에서 빠져 어느 화면에도 안 보인다. 이예준·변세진
// 건이 그 클래스였다(2026-08-31 패널 조사).
//
// 그래서 계산·표시·확정 문법을 여기 한 벌로 두고 세 화면이 그대로 쓴다. 화면마다 복제하면
// 방금 통합한 축이 다시 세 벌이 된다.

import { useState, useEffect } from 'react'
import { previewCheckoutRefund } from '@/app/(app)/tenants/actions'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { fmtWon } from '@/lib/fmtMoney'
import { LEGAL_PENALTY_PCT, type CheckoutRefundResult } from '@/lib/prorate'

type Preview = {
  prepaidAmount: number
  refund: CheckoutRefundResult
  defaultPenaltyPct: number
  /** 퇴실 정산 위젯이 먼저 확정해 둔 이달 청구액. 있으면 이 창에서 재계산하지 않는다. */
  appliedProration: number | null
}

/** 정산이 성립하지 않는 계약에 세우는 한 줄 — 자리를 설명 없이 비우지 않는다. */
function NotApplicable({ reason }: { reason: string }) {
  return (
    <div className="bg-[var(--canvas)] rounded-lg px-3 py-2.5 text-xs">
      <p className="font-semibold text-[var(--warm-mid)] mb-0.5">이용료 정산</p>
      <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed">{reason}</p>
    </div>
  )
}

/**
 * 부모가 쥐는 값. null 이면 정산할 것이 없다는 뜻이고 섹션 자체가 안 선다.
 *
 * `max`(그 기간 결제액)를 함께 올리는 이유는 부모가 **저장 버튼을 막아야 하기 때문**이다.
 * 초과 판정을 컴포넌트 안에만 두면 부모는 못 막고, 부모가 결제액을 따로 조회하면 두 벌이 된다.
 */
export type RentSettlementValue = { amount: number; max: number }

/**
 * 이 계약에 이용료 정산이 필요한지 묻고, 필요하면 금액을 확정받는다.
 *
 * 부모는 값이 null 인지와 amount 가 max 를 넘는지만 보면 된다 — 일할·위약금 계산 규칙을
 * 부모가 알 필요가 없다. 그 규칙이 화면마다 복제되던 것이 이 축의 문제였다.
 */
export function RentSettlementSection({
  leaseTermId, moveOutYmd, value, onChange, onDirty,
}: {
  leaseTermId: string | null
  moveOutYmd: string
  value: RentSettlementValue | null
  onChange: (v: RentSettlementValue | null) => void
  /** 사람이 금액을 만졌을 때 — 부모의 입력 보호(§12) 판정에 쓴다. */
  onDirty?: () => void
}) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [pctInput, setPctInput] = useState('')
  // 정산이 성립하지 않는 계약(단기)은 금액 대신 이유를 보여 준다 — 조용히 사라지면 왜 없는지 모른다.
  const [notApplicable, setNotApplicable] = useState<string | null>(null)

  // 퇴실일이 바뀌면 다시 계산한다 — 날짜가 곧 사용분이라 하루만 달라져도 환불액이 달라진다.
  useEffect(() => {
    if (!leaseTermId || !moveOutYmd) { setPreview(null); setNotApplicable(null); onChange(null); return }
    let live = true
    setPctInput('')
    void previewCheckoutRefund(leaseTermId, moveOutYmd, 'legal', null).then(r => {
      if (!live) return
      setNotApplicable(r.ok && !r.settlementApplies ? (r.notApplicableReason ?? null) : null)
      // 정산이 성립하지 않는 계약(단기)은 금액을 만들지 않는다. 서버도 거부하므로 여기서 값을
      // 실어 보내면 화면이 못 할 일을 권하는 셈이 된다(2026-08-31 실기 지적).
      if (r.ok && !r.settlementApplies) { setPreview(null); onChange(null); return }
      // 그 기간 선납이 없으면 돌려줄 것이 없다 — 섹션을 세우지 않는다.
      if (!r.ok || r.prepaidAmount <= 0) { setPreview(null); onChange(null); return }
      setPreview({ prepaidAmount: r.prepaidAmount, refund: r.refund, defaultPenaltyPct: r.defaultPenaltyPct, appliedProration: r.appliedProration })
      // 퇴실 정산이 먼저 적용돼 있으면 그 확정값을 이어받는다(이중 수정 방지) —
      // 환불 기본값은 결제액에서 확정 청구를 뺀 나머지다.
      onChange({
        amount: r.appliedProration != null
          ? Math.max(0, r.prepaidAmount - r.appliedProration)
          : r.refund.refund,
        max: r.prepaidAmount,
      })
    }).catch(() => { if (live) { setPreview(null); setNotApplicable(null); onChange(null) } })
    return () => { live = false }
    // onChange 는 부모가 매 렌더 새로 만들 수 있어 의존성에서 뺀다 — 넣으면 무한 루프가 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaseTermId, moveOutYmd])

  // 위약금율 입력(0~10, 빈 값이면 영업장 기본) — 서버가 다시 계산하고 캡도 서버가 건다.
  const handlePct = (raw: string) => {
    const clean = raw.replace(/[^0-9]/g, '').slice(0, 2)
    setPctInput(clean); onDirty?.()
    if (!leaseTermId || !moveOutYmd) return
    const pctNum = clean === '' ? null : Math.min(LEGAL_PENALTY_PCT, Math.max(0, parseInt(clean, 10) || 0))
    void previewCheckoutRefund(leaseTermId, moveOutYmd, 'legal', pctNum).then(r => {
      if (!r.ok || !r.settlementApplies || r.prepaidAmount <= 0) return
      setPreview({ prepaidAmount: r.prepaidAmount, refund: r.refund, defaultPenaltyPct: r.defaultPenaltyPct, appliedProration: r.appliedProration })
      if (r.appliedProration == null) onChange({ amount: r.refund.refund, max: r.prepaidAmount })
    }).catch(() => {})
  }

  if (notApplicable) return <NotApplicable reason={notApplicable} />
  if (!preview || value == null) return null
  const amount = value.amount

  const locked = preview.appliedProration != null
  const calcDefault = locked
    ? Math.max(0, preview.prepaidAmount - (preview.appliedProration ?? 0))
    : preview.refund.refund
  const diff = amount - calcDefault
  const exceeds = amount > preview.prepaidAmount

  return (
    // 차감 행은 라벨 앞 −(U+2212) 세로 수식 문법 — 퇴실 정산 위젯 환불 미리보기와 같다.
    <div className="bg-[var(--canvas)] rounded-lg px-3 py-2.5 space-y-1.5 text-xs">
      <div className="flex justify-between">
        <span className="font-semibold text-[var(--warm-mid)]">이용료 정산</span>
        <span className="tabular-nums text-[var(--warm-dark)]">결제액 {fmtWon(preview.prepaidAmount)}</span>
      </div>
      {locked ? (
        <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed">
          퇴실 정산 적용됨 · 이달 청구 {fmtWon(preview.appliedProration ?? 0)} · 변경은 상세의 퇴실 정산에서.
        </p>
      ) : (
        <>
          <div className="flex justify-between">
            <span className="text-[var(--warm-muted)]">− 사용분 ({preview.refund.daysUsed}일 × {fmtWon(preview.refund.dailyRate)})</span>
            <span className="tabular-nums text-[var(--warm-dark)]">{fmtWon(preview.refund.usedAmount)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--warm-muted)] flex items-center gap-1">
              − 위약금 (잔여액의
              <input type="text" inputMode="numeric" value={pctInput} placeholder={String(preview.defaultPenaltyPct)}
                onChange={e => handlePct(e.target.value)}
                className="w-11 bg-[var(--surface)] border border-[var(--warm-border)] rounded-sm px-1.5 py-1 text-right tabular-nums text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
              %)
            </span>
            <span className="tabular-nums text-[var(--warm-dark)]">{fmtWon(preview.refund.penalty)}</span>
          </div>
          <p className="text-[0.65625rem] text-[var(--warm-muted)]">위약금율 기본 {preview.defaultPenaltyPct}% · 최대 {LEGAL_PENALTY_PCT}% (공정위 기준)</p>
        </>
      )}
      <div className="border-t border-[var(--warm-border)] pt-1.5 space-y-1">
        <label className="text-xs font-medium text-[var(--warm-mid)]">이용료 환불액</label>
        <MoneyInput value={amount} onChange={v => { onChange({ amount: v, max: preview.prepaidAmount }); onDirty?.() }} placeholder="0원" />
        <p className="text-[0.65625rem] text-[var(--warm-muted)]">계산값 {fmtWon(calcDefault)} · 필요시 수정</p>
        {exceeds && (
          <p className="text-[0.6875rem] text-[var(--danger-fg)]">결제액 {fmtWon(preview.prepaidAmount)}을 초과할 수 없습니다.</p>
        )}
        {!exceeds && diff > 0 && (
          <p className="text-[0.6875rem] text-[var(--warning-fg)]">계산값보다 {fmtWon(diff)} 많습니다.</p>
        )}
        {!exceeds && diff < 0 && (
          <p className="text-[0.6875rem] text-[var(--warm-muted)]">계산값보다 {fmtWon(-diff)} 적습니다. 차액은 회사 귀속으로 기록됩니다.</p>
        )}
      </div>
    </div>
  )
}
