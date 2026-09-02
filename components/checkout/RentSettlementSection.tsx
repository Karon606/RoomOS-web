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
//
// 갈래(위약금 / 면제 / 단기 요금 / 환불 안 함)는 lib/checkoutSettlement 정본을 따른다. 종전에는
// 이 섹션이 '위약금' 고정이라 단기 견적을 버렸고, 위젯과 다른 답을 냈다. 1개월을 못 채운 중도
// 퇴실이 환불 0 이어야 하는데 79,800원이 환불로 확정됐다(2026-09-02 신고, 506호).

import { useState, useEffect } from 'react'
import { previewCheckoutRefund } from '@/app/(app)/tenants/actions'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { fmtWon } from '@/lib/fmtMoney'
import { LEGAL_PENALTY_PCT, type CheckoutRefundResult, type RefundMode } from '@/lib/prorate'
import {
  settlementAmounts, settlementPickOptions, settlementPickCaption, settlementPremise, serverModeFor,
  type SettlementPick, type ShortStayQuoteLite,
} from '@/lib/checkoutSettlement'

type Preview = {
  prepaidAmount: number
  refund: CheckoutRefundResult
  defaultPenaltyPct: number
  /** 퇴실 정산 위젯이 먼저 확정해 둔 이달 청구액. 있으면 이 창에서 재계산하지 않는다. */
  appliedProration: number | null
  /** 1개월을 못 채운 중도 퇴실의 단기 요금 견적 — 없으면 그 갈래가 안 선다. */
  shortStay: ShortStayQuoteLite | null
  /** 아직 시작 안 한 기간의 선납분 — 0 이면 갈래를 안 세운다. */
  futurePrepaid: number
  /** 귀속월 이상 달별 결제액 — '8월분 + 9월분 선납' 구성 줄의 근거. */
  prepaidMonths: { month: string; amount: number }[]
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
 *
 * `pick`·`suggested` 는 확인창(confirmRentSettlement)의 근거다 — 계산값과 다른 금액이나 환불 0 을
 * 확정할 때 세 화면이 같은 문장으로 한 번 더 묻는다.
 */
export type RentSettlementValue = { amount: number; max: number; pick: SettlementPick; suggested: number }

type PreviewResponse = Awaited<ReturnType<typeof previewCheckoutRefund>>
type OkResponse = Extract<PreviewResponse, { ok: true }>

function toPreview(r: OkResponse): Preview {
  return {
    prepaidAmount: r.prepaidAmount, refund: r.refund, defaultPenaltyPct: r.defaultPenaltyPct,
    appliedProration: r.appliedProration, shortStay: r.shortStay, futurePrepaid: r.futurePrepaid, prepaidMonths: r.prepaidMonths,
  }
}

type Basis = Pick<Preview, 'prepaidAmount' | 'refund' | 'shortStay' | 'appliedProration'>

/** 갈래별 기본 환불액. 퇴실 정산이 먼저 적용돼 있으면 그 확정값을 이어받는다(이중 수정 방지). */
function suggestedFor(p: Basis, pick: SettlementPick): number {
  if (p.appliedProration != null) return Math.max(0, p.prepaidAmount - p.appliedProration)
  return settlementAmounts(pick, p).refund
}

function valueFor(p: Basis, pick: SettlementPick): RentSettlementValue {
  const suggested = suggestedFor(p, pick)
  return { amount: suggested, max: p.prepaidAmount, pick, suggested }
}

const parsePct = (s: string): number | null =>
  s === '' ? null : Math.min(LEGAL_PENALTY_PCT, Math.max(0, parseInt(s, 10) || 0))

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
  /** 정산 갈래. 퇴실일이 바뀌면 서버가 준 기본값으로 돌아간다 — 날짜가 바뀌면 단기 자격도 바뀐다. */
  const [pick, setPick] = useState<SettlementPick>('legal')
  /**
   * 아직 시작 안 한 기간의 선납분에 위약금을 물릴 것인가 — 기본은 안 문다.
   *
   * 공정위 기준과 계약서 문언대로면 문다. 그런데 운영자 판단은 다르다 — "아직 살지도 않은
   * 기간이고 원래 납부해야 할 기간 전에 납부한 거니까 위약금을 안 무는 게 도의상 맞다".
   * 상황에 따라 다를 수 있어 여기서 고른다(운영자 확정 2026-08-31).
   */
  const [penalizeFuture, setPenalizeFuture] = useState(false)
  // 정산이 성립하지 않는 계약(단기)은 금액 대신 이유를 보여 준다 — 조용히 사라지면 왜 없는지 모른다.
  const [notApplicable, setNotApplicable] = useState<string | null>(null)

  // 퇴실일이 바뀌면 다시 계산한다 — 날짜가 곧 사용분이라 하루만 달라져도 환불액이 달라진다.
  // 갈래도 서버 기본값으로 돌아간다. 단기 자격(달력 한 달·중도)이 날짜에 달려 있어서다.
  useEffect(() => {
    if (!leaseTermId || !moveOutYmd) { setPreview(null); setNotApplicable(null); onChange(null); return }
    let live = true
    setPctInput('')
    void previewCheckoutRefund(leaseTermId, moveOutYmd, 'legal', null, penalizeFuture).then(r => {
      if (!live) return
      setNotApplicable(r.ok && !r.settlementApplies ? (r.notApplicableReason ?? null) : null)
      // 정산이 성립하지 않는 계약(단기)은 금액을 만들지 않는다. 서버도 거부하므로 여기서 값을
      // 실어 보내면 화면이 못 할 일을 권하는 셈이 된다(2026-08-31 실기 지적).
      if (r.ok && !r.settlementApplies) { setPreview(null); onChange(null); return }
      // 그 기간 선납이 없으면 돌려줄 것이 없다 — 섹션을 세우지 않는다.
      if (!r.ok || r.prepaidAmount <= 0) { setPreview(null); onChange(null); return }
      setPreview(toPreview(r))
      setPick(r.defaultPick)
      onChange(valueFor(r, r.defaultPick))
    }).catch(() => { if (live) { setPreview(null); setNotApplicable(null); onChange(null) } })
    return () => { live = false }
    // onChange 는 부모가 매 렌더 새로 만들 수 있어 의존성에서 뺀다 — 넣으면 무한 루프가 된다.
    // penalizeFuture 는 제 핸들러가 다시 묻는다 — 여기 넣으면 체크 한 번에 갈래가 기본값으로 돌아간다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaseTermId, moveOutYmd])

  // 위약금 갈래 안의 조건(위약금율·선납 위약금)이 바뀌거나 서버 모드가 갈릴 때 같은 퇴실일로 다시 묻는다.
  // 단기 요금·환불 안 함은 서버 산식을 안 쓰므로 왕복이 없다.
  const refetch = (mode: RefundMode, pctNum: number | null, pf: boolean, nextPick: SettlementPick) => {
    if (!leaseTermId || !moveOutYmd) return
    void previewCheckoutRefund(leaseTermId, moveOutYmd, mode, pctNum, pf).then(r => {
      if (!r.ok || !r.settlementApplies || r.prepaidAmount <= 0) return
      setPreview(toPreview(r))
      onChange(valueFor(r, nextPick))
    }).catch(() => {})
  }

  const handlePick = (next: SettlementPick) => {
    setPick(next); onDirty?.()
    if (next === 'legal' || next === 'goodwill') { refetch(serverModeFor(next), parsePct(pctInput), penalizeFuture, next); return }
    if (preview) onChange(valueFor(preview, next))
  }

  // 위약금율 입력(0~10, 빈 값이면 영업장 기본) — 서버가 다시 계산하고 캡도 서버가 건다.
  const handlePct = (raw: string) => {
    const clean = raw.replace(/[^0-9]/g, '').slice(0, 2)
    setPctInput(clean); onDirty?.()
    refetch('legal', parsePct(clean), penalizeFuture, 'legal')
  }

  const handlePenalizeFuture = (checked: boolean) => {
    setPenalizeFuture(checked); onDirty?.()
    refetch('legal', parsePct(pctInput), checked, 'legal')
  }

  if (notApplicable) return <NotApplicable reason={notApplicable} />
  if (!preview || value == null) return null
  const amount = value.amount

  const locked = preview.appliedProration != null
  const calcDefault = suggestedFor(preview, pick)
  const diff = amount - calcDefault
  const exceeds = amount > preview.prepaidAmount
  const short = preview.shortStay

  return (
    // 차감 행은 라벨 앞 −(U+2212) 세로 수식 문법 — 퇴실 정산 위젯 환불 미리보기와 같다.
    <div className="bg-[var(--canvas)] rounded-lg px-3 py-2.5 space-y-1.5 text-xs">
      <div className="flex justify-between">
        <span className="font-semibold text-[var(--warm-mid)]">이용료 정산</span>
        <span className="tabular-nums text-[var(--warm-dark)]">결제액 {fmtWon(preview.prepaidAmount)}</span>
      </div>
      {/* 여러 달이 걸릴 때만 구성을 편다 — 한 달짜리 정산은 종전과 한 글자도 다르지 않다.
          '선납'은 귀속월보다 뒤, 곧 아직 시작도 안 한 기간의 결제에만 붙인다. */}
      {preview.prepaidMonths.length > 1 && (
        <p className="text-[0.65625rem] text-[var(--warm-muted)] tabular-nums break-keep">
          {preview.prepaidMonths.map((m, i) =>
            `${i > 0 ? ' + ' : ''}${Number(m.month.slice(5, 7))}월분${i > 0 ? ' 선납' : ''} ${fmtWon(m.amount)}`).join('')}
        </p>
      )}
      {locked ? (
        <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed">
          퇴실 정산 적용됨 · 이달 청구 {fmtWon(preview.appliedProration ?? 0)} · 변경은 상세의 퇴실 정산에서.
        </p>
      ) : (
        <>
          {/* 갈래 라벨·전제문·캡션·순서는 퇴실 정산 위젯과 같은 정본(lib/checkoutSettlement)이다.
              '환불 없음'만 여기에 더 선다 — 위젯은 청구액을 확정하는 자리라 '없음'이 성립하지 않는다.
              라벨 · 전제문 · 세그먼트 · 캡션 순서도 위젯과 같다(웹디자이너 패스 2026-09-02). */}
          <div className="space-y-1 pt-0.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">정산 방식</label>
            <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed break-keep">{settlementPremise(true)}</p>
            <SegmentedControl<SettlementPick>
              ariaLabel="이용료 정산 방식"
              size="sm"
              value={pick}
              onChange={handlePick}
              options={settlementPickOptions(!!short, true)}
            />
            <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed break-keep">{settlementPickCaption(pick, short, { prepaidAmount: preview.prepaidAmount })}</p>
          </div>
          {(pick === 'legal' || pick === 'goodwill') && (
            <div className="flex justify-between">
              <span className="text-[var(--warm-muted)]">− 사용분 ({preview.refund.daysUsed}일 × {fmtWon(preview.refund.dailyRate)})</span>
              <span className="tabular-nums text-[var(--warm-dark)]">{fmtWon(preview.refund.usedAmount)}</span>
            </div>
          )}
          {pick === 'legal' && (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--warm-muted)] flex items-center gap-1">
                  − 위약금 (잔여액의
                  <input type="text" inputMode="numeric" value={pctInput} placeholder={String(preview.defaultPenaltyPct)}
                    onChange={e => handlePct(e.target.value)}
                    className="w-11 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-1.5 py-1 text-right tabular-nums text-[var(--warm-dark)] outline-none focus:border-[var(--persimmon)] focus:shadow-[0_0_0_3px_rgba(160,60,46,0.12)] transition-colors" />
                  %)
                </span>
                <span className="tabular-nums text-[var(--warm-dark)]">{fmtWon(preview.refund.penalty)}</span>
              </div>
              <p className="text-[0.65625rem] text-[var(--warm-muted)]">위약금율 기본 {preview.defaultPenaltyPct}% · 최대 {LEGAL_PENALTY_PCT}% (공정위 기준)</p>
              {/* 아직 시작 안 한 기간의 선납분에 위약금을 물릴지 — 그런 달이 있을 때만 묻는다.
                  공정위 기준으로는 물리는 것이 맞지만, 살지도 않은 기간이라 안 무는 것이 도의에
                  맞다는 것이 운영자 판단이라 기본이 '안 문다'다(2026-08-31 확정). */}
              {preview.futurePrepaid > 0 && (
                <label className="flex items-start gap-2 pt-1 cursor-pointer">
                  <input type="checkbox" checked={penalizeFuture}
                    onChange={e => handlePenalizeFuture(e.target.checked)}
                    className="w-4 h-4 accent-[var(--coral)] mt-0.5 shrink-0" />
                  <span className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed break-keep">
                    아직 지내지 않은 기간의 선납 {fmtWon(preview.futurePrepaid)}에도 위약금을 뗍니다.
                    <span className="block">공정위 기준으로는 떼는 것이 맞지만, 살지도 않은 기간이라 기본은 전액 돌려드립니다.</span>
                  </span>
                </label>
              )}
            </>
          )}
          {pick === 'shortStay' && short && (
            <div className="flex justify-between">
              <span className="text-[var(--warm-muted)]">− 단기 요금 ({short.units}주 계약{short.roundedUp ? ` · 거주 ${short.stayDays}일` : ''})</span>
              <span className="tabular-nums text-[var(--warm-dark)]">{fmtWon(short.baseAmount)}</span>
            </div>
          )}
        </>
      )}
      <div className="border-t border-[var(--warm-border)] pt-1.5 space-y-1">
        {pick === 'none' && !locked ? (
          <>
            <label className="text-xs font-medium text-[var(--warm-mid)]">이용료 환불액</label>
            {/* §12 자동 합산 읽기전용 — MoneyInput 과 같은 박스 높이라 갈래를 오가도 카드가 안 출렁인다. */}
            <div className="bg-[var(--sand-s)] border border-transparent rounded-sm px-3 py-2.5 text-sm text-right tabular-nums text-[var(--warm-dark)]">0원</div>
            <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed break-keep">결제액 {fmtWon(preview.prepaidAmount)}은 그대로 회사 귀속으로 남습니다. 수납 기록은 바뀌지 않습니다.</p>
          </>
        ) : (
          <>
            <label className="text-xs font-medium text-[var(--warm-mid)]">이용료 환불액</label>
            <MoneyInput value={amount} onChange={v => { onChange({ ...value, amount: v }); onDirty?.() }} placeholder="0원" />
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
          </>
        )}
      </div>
    </div>
  )
}
