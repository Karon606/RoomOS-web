'use client'

// 퇴실 정산(일할) — 선납 모델에서 퇴실 예정일이 기간 중간이면 마지막 달 청구를 사용 일수만큼만.
// 퇴실일 입력 → 서버 미리보기(previewCheckoutProration)로 19일치 등 일할 금액 확인 → '적용'으로 확정·기록.
// 확정 시 status=CHECKOUT_PENDING + expectedMoveOut + 일할액 저장. 청구 엔진이 그 달 청구를 이 값으로 덮어씀.

import { useState, useTransition, useEffect, useRef } from 'react'
import {
  previewCheckoutProration,
  previewCheckoutRefund,
  setCheckoutProration,
  clearCheckoutProration,
} from '@/app/(app)/tenants/actions'
import type { CheckoutProrationResult, CheckoutRefundResult, RefundMode } from '@/lib/prorate'
import { PRORATE_BASE_DAYS, LEGAL_PENALTY_PCT } from '@/lib/prorate'
import { DatePicker } from '@/components/ui/DatePicker'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { Btn } from '@/components/ui/Btn'
import { trackSave, pushToast } from '@/lib/saveStatus'

import { fmtWon } from '@/lib/fmtMoney'   // v2.0 §06 단일 경로
const fmtMonth = (m: string) => { const [y, mm] = m.split('-'); return `${y}년 ${Number(mm)}월` }

/** 화면의 정산 갈래 — 서버 모드 둘 + 단기 요금(적용 금액 기본값만 바꾸는 화면 전용). */
type PickMode = RefundMode | 'shortStay'

export function CheckoutProrationWidget({
  leaseTermId, currentDueDay, expectedMoveOut, checkoutProratedAmount, checkoutProratedMonth, autoOpen, onChange,
}: {
  leaseTermId: string
  currentDueDay: string | null
  /** 현재 저장된 퇴실 예정일 'YYYY-MM-DD' | null */
  expectedMoveOut: string | null
  /** 이미 확정된 일할 청구액 (없으면 null) */
  checkoutProratedAmount?: number | null
  checkoutProratedMonth?: string | null
  /** 고객관리 '퇴실 정산?' 팝업의 '예'로 진입 — 폼 자동 펼침 + 날짜 프리필 + 미리보기. */
  autoOpen?: boolean
  /** 적용/해제 후 부모가 재조회. */
  onChange?: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [showForm, setShowForm] = useState(false)
  const [date, setDate] = useState(expectedMoveOut ?? '')
  const [calc, setCalc] = useState<CheckoutProrationResult | null>(null)
  const [calcErr, setCalcErr] = useState<string | null>(null)
  const [amountInput, setAmountInput] = useState('')   // 적용 금액(퇴실월 회사 귀속) — 모드별 기본, 운영자가 수정 가능
  const [refund, setRefund] = useState<{ refund: CheckoutRefundResult; prepaidAmount: number } | null>(null)
  /**
   * 1개월을 못 채우고 나가는 계약의 단기 요금 견적 — 서버가 함께 내려준다(해당 없으면 null).
   *
   * 종전에는 이 자리에 없어서, 운영자가 상담 도구를 따로 열어 방 월세와 날짜를 손으로 다시 넣고
   * 두 숫자를 머릿속에서 비교했다. 그러다 청소비를 한쪽에만 세는 실수가 났다(2026-08-29).
   */
  const [shortQuote, setShortQuote] = useState<{ stayDays: number; units: number; contractDays: number; baseAmount: number; roundedUp: boolean } | null>(null)
  /**
   * 화면의 정산 갈래 — 서버 모드(RefundMode) 둘에 **화면 전용 갈래 하나**를 얹는다.
   *
   * 'shortStay' 를 서버 모드로 안 만든 이유. 그것은 새 산식이 아니라 **적용 금액의 기본값을
   * 단기 요금으로 채우는 것**이다. 금액 칸은 그대로 열려 있어 운영자가 언제든 고친다
   * (운영자 2026-08-29 — "상황에 따라 환불 금액이 언제든 다르게 가져갈 수 있으니").
   * 산식을 서버에 박으면 그 재량이 닫히고, 계약서에 조항이 서기 전에 금액이 자동으로 바뀐다.
   */
  // 환불 모드: 법정(공정위: 위약금 + 잔여 환불) / 선의(일할만, 위약금 없음). 기본=법정.
  const [refundMode, setRefundMode] = useState<RefundMode>('legal')
  const [pick, setPick] = useState<PickMode>('legal')
  // 사람별 위약금율(%) — 빈 값이면 영업장 기본값. 공정위 10% 캡(운영자 결정 2026-07-20), 서버가 재클램프.
  const [penaltyPctInput, setPenaltyPctInput] = useState('')
  const [defaultPenaltyPct, setDefaultPenaltyPct] = useState(LEGAL_PENALTY_PCT)

  const isApplied = checkoutProratedAmount != null && !!checkoutProratedMonth

  // 퇴실일 선택 → 서버 미리보기 (할인까지 반영한 정확한 일할액 + 모드·위약금율별 환불)
  //
  // useShortStay 를 안 주면 **날짜를 새로 고른 것**이다. 그때는 서버 견적이 있는지 보고 정한다 —
  // 1개월을 못 채우고 중도 퇴실하는 계약은 단기 요금이 기본이어야 한다(운영자 2026-08-29 —
  // "퇴실 예정일을 입력하면 거기에 맞춰 금액이 나오고 환불금액도 나오면 되는거야").
  // 갈래를 손으로 바꾼 경우에는 그 선택이 인자로 실려 오므로 이 자동 판정이 덮지 않는다.
  const handleDate = (v: string, mode: RefundMode = refundMode, pctStr: string = penaltyPctInput, useShortStay?: boolean) => {
    setDate(v); setCalc(null); setCalcErr(null); setAmountInput(''); setRefund(null); setShortQuote(null)
    if (!v || v.length < 10) return
    const pctNum = pctStr.trim() === '' ? null : Math.min(LEGAL_PENALTY_PCT, Math.max(0, parseInt(pctStr, 10) || 0))
    startTransition(async () => {
      const [res, refRes] = await Promise.all([
        previewCheckoutProration(leaseTermId, v),
        previewCheckoutRefund(leaseTermId, v, mode, pctNum),
      ])
      if (res.ok) { setCalc(res.calc); setCalcErr(null) }
      else { setCalc(null); setCalcErr(res.error) }
      if (refRes.ok) {
        setRefund({ refund: refRes.refund, prepaidAmount: refRes.prepaidAmount })
        setShortQuote(refRes.shortStay)
        setDefaultPenaltyPct(refRes.defaultPenaltyPct)
        const short = (useShortStay ?? true) && !!refRes.shortStay
        // 갈래 표시도 함께 맞춘다. 여기서 refundMode 를 goodwill 로 내리는 것은 다음 서버 왕복을
        // 위한 것이고, 지금 화면은 pick 으로 갈리므로 위약금 칸도 미리보기도 단기 쪽을 그린다.
        if (short) { setPick('shortStay'); setRefundMode('goodwill') }
        // 적용 금액 = 회사 귀속(사용분 + 위약금). 선납 없으면 일할 청구액.
        // 단기 갈래는 그 자리를 단기 요금으로 덮는다 — 견적이 없으면(1개월을 채웠거나 만기 퇴실) 종전대로.
        setAmountInput(String(short && refRes.shortStay
          ? refRes.shortStay.baseAmount
          : refRes.prepaidAmount > 0 ? refRes.refund.companyKeeps : (res.ok ? res.calc.amount : refRes.refund.usedAmount)))
      } else if (res.ok) {
        setAmountInput(String(res.calc.amount))
      }
    })
  }

  // 갈래 전환 → 같은 퇴실일로 환불 미리보기·적용 금액 재계산.
  //
  // 단기 요금은 위약금이 없으므로 서버에는 'goodwill' 로 묻고, 돌아온 뒤 적용 금액만
  // 단기 요금으로 덮는다. 미리보기의 '총 결제금액'과 '환불액'은 그대로 이 값을 따라간다.
  const handlePick = (next: PickMode) => {
    setPick(next)
    const serverMode: RefundMode = next === 'shortStay' ? 'goodwill' : next
    setRefundMode(serverMode)
    if (date && date.length >= 10) handleDate(date, serverMode, penaltyPctInput, next === 'shortStay')
  }

  // 위약금율 입력 — 숫자만, 두 자리까지. 값이 바뀌면 같은 퇴실일로 재계산.
  const handlePct = (raw: string) => {
    const clean = raw.replace(/[^0-9]/g, '').slice(0, 2)
    setPenaltyPctInput(clean)
    if (date && date.length >= 10) handleDate(date, refundMode, clean, pick === 'shortStay')
  }

  // autoOpen — 진입 직후 1회: 폼 펼치고 저장된 퇴실일로 미리보기 자동 실행
  const autoOpenedRef = useRef(false)
  useEffect(() => {
    if (!autoOpen || autoOpenedRef.current) return
    autoOpenedRef.current = true
    setShowForm(true)
    if (expectedMoveOut) handleDate(expectedMoveOut)
  }, [autoOpen])  // eslint-disable-line react-hooks/exhaustive-deps

  const handleApply = () => {
    if (!date || !calc) return
    const digits = amountInput.replace(/[^0-9]/g, '')
    const manualAmount = digits ? parseInt(digits, 10) : calc.amount
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await setCheckoutProration(leaseTermId, date, manualAmount)
        if (!res.ok) { pushToast('error', res.error); return }
        const adjusted = manualAmount !== res.calc.amount
        pushToast('success', `퇴실 정산 적용 · ${fmtWon(manualAmount)}${adjusted ? ' (수동 조정)' : ` (${res.calc.daysUsed}일치)`}`)
        setShowForm(false); setCalc(null); setAmountInput(''); onChange?.()
      } finally { release() }
    })
  }

  const handleClear = async () => {
    if (!(await confirmDialog({ title: '퇴실 정산을 적용취소할까요?', message: '적용 직전 상태(거주중·퇴실예정일·청구)로 되돌립니다.', confirmLabel: '적용취소' }))) return
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await clearCheckoutProration(leaseTermId)
        if (!res.ok) { pushToast('error', res.error); return }
        pushToast('success', '퇴실 정산 적용취소됨 · 직전 상태로 복원')
        setShowForm(false); onChange?.()
      } finally { release() }
    })
  }

  // 접힘 상태 — 적용 여부에 따라 요약 표시
  if (!showForm) {
    return (
      <div className="border-t border-[var(--warm-border)] px-6 py-3 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-medium text-[var(--warm-mid)]">퇴실 정산 (일할)</p>
            {isApplied ? (
              <p className="text-[0.65625rem] mt-0.5" style={{ color: 'var(--success-fg)' }}>
                {fmtMonth(checkoutProratedMonth!)} 청구 {fmtWon(checkoutProratedAmount!)} 로 일할 적용됨
                {expectedMoveOut ? ` · 퇴실 ${expectedMoveOut.slice(5).replace('-', '/')}` : ''}
              </p>
            ) : (
              <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5">퇴실일 기준 마지막 달을 사용 일수만큼만 청구</p>
            )}
          </div>
          <div className="flex gap-1.5 shrink-0">
            {isApplied && (
              <button type="button" onClick={handleClear} disabled={pending}
                className="text-[0.6875rem] px-2 py-1 rounded transition-colors text-[var(--warm-muted)] hover:bg-[var(--warm-border)] disabled:opacity-40">
                적용취소
              </button>
            )}
            <button type="button" onClick={() => { setShowForm(true); setDate(expectedMoveOut ?? ''); setCalc(null); setCalcErr(null) }}
              className="text-[0.6875rem] px-2 py-1 rounded transition-colors"
              style={{ color: 'var(--coral)', border: '1px solid color-mix(in srgb, var(--coral) 35%, transparent)' }}>
              {isApplied ? '다시 정산' : '정산'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="border-t border-[var(--warm-border)] px-6 py-3 shrink-0">
      <div className="space-y-2.5">
        <p className="text-xs font-semibold" style={{ color: 'var(--coral)' }}>
          퇴실 정산 · 일할 청구
        </p>
        <div className="space-y-1.5">
          <label className="text-xs text-[var(--warm-muted)]">퇴실 예정일</label>
          <DatePicker value={date} onChange={handleDate}
            className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-1.5 text-sm text-[var(--warm-dark)]" />
          <p className="text-[0.65625rem] text-[var(--warm-muted)]">
            납부일 {currentDueDay ? (currentDueDay.includes('말') ? '말일' : `${currentDueDay}일`) : '—'} 부터 퇴실일까지(양끝 포함) 일수만큼 청구합니다.
          </p>
        </div>

        {calc && (
          <div className="rounded-lg px-3 py-2 text-xs font-medium"
            style={{ background: 'var(--success-bg)', color: 'var(--success-fg)', border: '1px solid var(--success-ring)' }}>
            {fmtMonth(calc.moveOutMonth)} 청구 → <b>{fmtWon(calc.amount)}</b> ({calc.daysUsed}일치)
            <span className="block mt-0.5 font-normal" style={{ color: 'var(--warm-muted)' }}>
              한 달 {fmtWon(calc.fullAmount)} ÷ {PRORATE_BASE_DAYS}일 × {calc.daysUsed}일 · 감액 {fmtWon(calc.reduction)}
            </span>
          </div>
        )}
        {calc && (
          <div className="space-y-1.5">
            {/* 정산 방식 — 법정(공정위: 위약금 10% + 잔여 환불) / 선의(일할만) */}
            <div className="space-y-1">
              <label className="text-xs text-[var(--warm-muted)]">정산 방식</label>
              <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed">법정(공정위) = 위약금을 공제하는 공식 기준 · 선의(일할) = 지낸 날짜만큼만 받고 위약금 없음</p>
              <SegmentedControl<PickMode>
                ariaLabel="정산 방식"
                size="sm"
                value={pick}
                onChange={handlePick}
                options={[
                  { value: 'legal', label: '법정(공정위)' },
                  { value: 'goodwill', label: '선의(일할)' },
                  // 1개월을 못 채운 계약에만 선다. 채운 계약에는 단기 요금이라는 것이 없다.
                  ...(shortQuote ? [{ value: 'shortStay' as const, label: '단기 요금' }] : []),
                ]}
              />
              <p className="text-[0.65625rem] text-[var(--warm-muted)]">
                {pick === 'legal'
                  ? '원칙(공정위). 위약금을 제하고 남은 일수를 환불합니다.'
                  : pick === 'goodwill'
                  ? '선의. 위약금 없이 사용한 일수만 청구하고 나머지를 환불합니다.'
                  : shortQuote
                  ? `거주 ${shortQuote.stayDays}일${shortQuote.roundedUp ? ` (주 단위라 ${shortQuote.contractDays}일로 올림)` : ''} · ${shortQuote.units}주 계약 요금 ${fmtWon(shortQuote.baseAmount)}. 처음부터 단기로 계약했을 때와 같은 금액입니다.`
                  : ''}
              </p>
              {/* 사람별 위약금율 — 영업장 기본값 이하가 아니라 공정위 캡(10%) 이하에서 자유 조정(운영자 결정 2026-07-20) */}
              {pick === 'legal' && (
                <div className="flex items-center gap-2 pt-0.5">
                  <label className="text-[0.6875rem] text-[var(--warm-mid)] shrink-0">위약금율</label>
                  <div className="relative w-20">
                    <input type="text" inputMode="numeric" value={penaltyPctInput} placeholder={String(defaultPenaltyPct)}
                      onChange={e => handlePct(e.target.value)}
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-1.5 pr-7 text-sm text-right tabular-nums text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--warm-muted)] pointer-events-none">%</span>
                  </div>
                  <span className="text-[0.65625rem] text-[var(--warm-muted)]">기본 {defaultPenaltyPct}% · 최대 {LEGAL_PENALTY_PCT}%</span>
                </div>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-xs text-[var(--warm-muted)]">적용 금액 <span className="text-[0.65625rem]">(퇴실월 청구 = 사용분{pick === 'legal' ? ' + 위약금' : ''} · 필요시 수정)</span></label>
              <div className="flex items-center gap-1.5">
                <input type="text" inputMode="numeric" value={amountInput ? Number(amountInput.replace(/[^0-9]/g, '')).toLocaleString() : ''}
                  onChange={e => setAmountInput(e.target.value.replace(/[^0-9]/g, ''))}
                  className="flex-1 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-1.5 text-sm text-right tabular-nums text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
                <span className="text-xs text-[var(--warm-muted)]">원</span>
              </div>
              <p className="text-[0.65625rem] text-[var(--warm-muted)]">하루 더 봐주기 등 예외는 이 금액을 직접 조정하세요. (환불액 = 총 결제금액 − 이 금액)</p>
            </div>
          </div>
        )}
        {calcErr && (
          <p className="text-xs" style={{ color: 'var(--coral)' }}>{calcErr}</p>
        )}

        {refund && refund.prepaidAmount > 0 && (() => {
          const applied = amountInput ? (parseInt(amountInput.replace(/[^0-9]/g, ''), 10) || 0) : refund.refund.companyKeeps
          const penalty = refund.refund.penalty   // 서버 계산값(적용 위약금율 반영)
          const refundAmt = Math.max(0, refund.prepaidAmount - applied)
          // **식과 답이 갈리지 않게 한다.** 종전에는 위 세 줄이 서버 원값이고 환불액만 입력값을
          // 따라가서, 금액을 고치면 420,000 − 168,000 = 126,000 같은 틀린 식이 화면에 남았다
          // (운영자 실측 2026-08-29). 고친 순간부터 근거는 그 금액 하나이므로 내역을 한 줄로 접는다.
          // 비교 대상은 **그 갈래가 채워 준 기본값**이다. 사용분과 비교하면 단기 갈래가 늘
          // '직접 지정'으로 읽힌다 — 단기 요금은 사용분보다 크게 마련이라서다.
          const base = pick === 'shortStay' && shortQuote ? shortQuote.baseAmount : refund.refund.companyKeeps
          const edited = applied !== base
          const label = pick === 'legal' ? '법정·공정위' : pick === 'goodwill' ? '선의·일할' : '단기 요금'
          return (
            <div className="rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)' }}>
              <p className="font-semibold text-[var(--warm-mid)] mb-1">환불 미리보기 <span className="font-normal text-[0.65625rem] text-[var(--warm-muted)]">({label}{edited ? ' · 직접 지정' : ''})</span></p>
              <div className="space-y-0.5 text-[var(--warm-muted)]">
                <div className="flex justify-between"><span>총 결제금액</span><span className="tabular-nums">{fmtWon(refund.prepaidAmount)}</span></div>
                {edited ? (
                  <div className="flex justify-between"><span>− 적용 금액</span><span className="tabular-nums">{fmtWon(applied)}</span></div>
                ) : pick === 'shortStay' && shortQuote ? (
                  <div className="flex justify-between"><span>− 단기 요금 ({shortQuote.units}주 계약{shortQuote.roundedUp ? ` · 거주 ${shortQuote.stayDays}일` : ''})</span><span className="tabular-nums">{fmtWon(applied)}</span></div>
                ) : (<>
                  <div className="flex justify-between"><span>− 사용분 ({refund.refund.daysUsed}일 × {fmtWon(refund.refund.dailyRate)})</span><span className="tabular-nums">{fmtWon(refund.refund.usedAmount)}</span></div>
                  {penalty > 0 && <div className="flex justify-between"><span>− 위약금 (잔여 이용금액의 {refund.refund.penaltyPct}%)</span><span className="tabular-nums">{fmtWon(penalty)}</span></div>}
                </>)}
              </div>
              <div className="flex justify-between font-bold mt-1 pt-1 border-t" style={{ borderColor: 'var(--warm-border)', color: 'var(--success-fg)' }}>
                <span>환불액</span><span className="tabular-nums">{fmtWon(refundAmt)}</span>
              </div>
              <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-1">참고용. 퇴실 처리 때 뜨는 환불 창이 이 확정값을 이어받습니다.</p>
            </div>
          )
        })()}
        <div className="flex gap-2">
          <Btn type="button" variant="secondary" size="sm" onClick={() => { setShowForm(false); setCalc(null); setCalcErr(null); setRefund(null); setShortQuote(null) }} className="flex-1">취소</Btn>
          <Btn type="button" variant="primary" size="sm" disabled={pending || !calc} onClick={handleApply} className="flex-1 font-semibold">
            {pending ? '처리 중…' : '정산 적용'}
          </Btn>
        </div>
      </div>
    </div>
  )
}
