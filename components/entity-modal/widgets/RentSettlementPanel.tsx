'use client'

// 이용료 정산 계약 단위 카드 — 수납 정보(엔티티 모달)의 보증금 패널 바로 아래. 퇴실 예정·퇴실 완료 계약에만 선다.
//
// 왜 여기인가. 운영자 요청(2026-09-02)은 "퇴실 예정·완료면 환불 예상액이 자동으로 뜨고, 다르면 여기서
// 바로 고치기". 보증금은 DepositStatusPanel 이 그 자리인데 이용료 환불은 확정 뒤 볼 곳이 입주자 정보
// 탭의 적용취소 한 줄뿐이었고, 그 조회가 퇴실 완료 계약을 안 실어 정작 퇴실자에게는 안 그려졌다.
//
// 상태는 넷이다. 예상(퇴실 예정) / 환불 완료(스냅샷) / 환불 미처리(청구 확정만 있고 돈이 남음) / 없음.
// 예상 단계의 조정은 퇴실 정산 위젯이 정본이라 여기는 금액만 보이고 '정산 조정'으로 위젯을 연다.
// 확정 뒤 금액 수정은 적용취소 + 재확정 두 호출이다(원자적 재확정 함수를 따로 세우면 스냅샷·홈택스
// 안내 문법이 두 벌이 된다). 둘째가 실패하면 카드가 '환불 미처리'로 서서 다시 확정할 입구가 남는다.
// 계산값과 다른 금액에는 사유 한 줄을 받는다 — 413호처럼 임의 산식으로 돌려준 건은 그 이유가 남아야 한다.

import { useEffect, useId, useState, useTransition } from 'react'
import { fmtWon } from '@/lib/fmtMoney'
import { kstYmdStr } from '@/lib/kstDate'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Btn } from '@/components/ui/Btn'
import { Badge } from '@/components/ui/Badge'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { withSave, pushToast } from '@/lib/saveStatus'
import {
  previewCheckoutRefund, getRentRefundForLease, getPendingRentRefundNotice, finalizeRentRefund, undoRentRefund,
} from '@/app/(app)/tenants/actions'
import { settlementAmounts, settlementPickCaption } from '@/lib/checkoutSettlement'
import { refundTaxNoticeLines, undoRefundTaxNoticeLines } from '@/lib/refundTaxNotice'
import { checkSettlementMonth } from '@/lib/accountingGuard'
import { inputCls, inputErrCls, labelCls, formBoxCls } from './panelFormStyles'

type Refund = Awaited<ReturnType<typeof getRentRefundForLease>>
type Pending = Awaited<ReturnType<typeof getPendingRentRefundNotice>>
type Preview = Awaited<ReturnType<typeof previewCheckoutRefund>>

const monthLabel = (month: string) => `${Number(month.slice(5, 7))}월`

type PanelData = { refund: Refund; pending: Pending; preview: Preview | null }

// 스냅샷을 먼저 묻는다 — 있으면 나머지 둘은 물을 것이 없다(예상·미처리는 확정 전 상태다).
async function fetchPanelData(leaseTermId: string, status: string | null, expectedMoveOut: string | null): Promise<PanelData> {
  const refund = await getRentRefundForLease(leaseTermId)
  const [pending, preview] = await Promise.all([
    !refund && status === 'CHECKED_OUT' ? getPendingRentRefundNotice(leaseTermId) : Promise.resolve(null),
    !refund && status === 'CHECKOUT_PENDING' && expectedMoveOut
      ? previewCheckoutRefund(leaseTermId, expectedMoveOut, 'legal', null, false)
      : Promise.resolve(null),
  ])
  return { refund, pending, preview }
}

export function RentSettlementPanel({
  leaseTermId, status, isShortTerm, expectedMoveOut, canEdit, reloadSignal, onChanged, onAdjust,
}: {
  leaseTermId: string
  status: string | null
  // 단기 계약은 정산이 성립하지 않는다(체류 전체 사용료라 일할이 없다) — 카드를 아예 세우지 않는다.
  isShortTerm: boolean
  // 퇴실 예정일(예정) 또는 퇴실일(완료). 재확정의 귀속월 산출과 예상액 조회가 이 날짜를 쓴다.
  expectedMoveOut: string | null
  canEdit: boolean
  reloadSignal?: number
  onChanged?: () => void
  // '정산 조정' — 퇴실 정산 위젯을 여는 일은 이 카드 밖(PaymentBody)의 몫이다(full 모드 전환).
  onAdjust?: () => void
}) {
  const relevant = !isShortTerm && (status === 'CHECKOUT_PENDING' || status === 'CHECKED_OUT')
  const [data, setData] = useState<PanelData | null>(null)
  // 금액 폼 — 확정 뒤 수정(revise)과 미처리 기록(record)이 같은 폼을 쓴다. 입구가 둘이면 문법이 갈린다.
  const [formMode, setFormMode] = useState<'revise' | 'record' | null>(null)
  const [amount, setAmount] = useState(0)
  const [reason, setReason] = useState('')
  const [pending, startTransition] = useTransition()
  // 재확정의 둘째 호출(확정)이 막혔을 때 카드 안에 남기는 경고 — 토스트는 사라지고, 이 상태는 사람이 고칠 때까지 보여야 한다.
  const [reviseWarn, setReviseWarn] = useState<string | null>(null)
  const uid = useId()
  // 액션 뒤 재조회 — 바깥 reloadSignal 과 같은 효과를 안에서 낸다.
  const [tick, setTick] = useState(0)
  const reload = () => setTick(t => t + 1)

  useEffect(() => {
    if (!relevant) return
    let active = true
    fetchPanelData(leaseTermId, status, expectedMoveOut).then(d => { if (active) setData(d) })
    return () => { active = false }
  }, [leaseTermId, status, expectedMoveOut, relevant, reloadSignal, tick])

  if (!relevant) return null
  // 퇴실 완료는 대개 카드가 안 선다(스냅샷도 미처리도 없는 옛 계약) — 뼈대를 그렸다 지우면 그게 로딩 점프다.
  if (!data) return status === 'CHECKOUT_PENDING' ? <SkeletonRows rows={3} className="py-1" /> : null

  const { refund, pending: pend, preview } = data
  if (!refund && status === 'CHECKED_OUT' && !pend && !reviseWarn) return null

  // 폼의 상한(원 수납)과 청구 확정 파생값 — 수정이면 스냅샷, 기록이면 그 달 받은 돈.
  const max = formMode === 'revise' ? (refund?.prepaid ?? 0) : (pend?.paid ?? 0)
  const over = amount > max
  const keeps = Math.max(0, max - amount)
  // 상한의 이름 — 수정은 스냅샷의 '원 수납', 기록은 그 달 '받은 돈'(화면 위 줄과 같은 말).
  const maxLabel = formMode === 'revise' ? '원 수납' : '받은 돈'

  const openRevise = () => {
    if (!refund) return
    setAmount(refund.refunded); setReason(refund.reason ?? ''); setReviseWarn(null); setFormMode('revise')
  }
  const openRecord = () => {
    if (!pend) return
    // 기본값은 화면이 이미 보여주는 미처리액 그대로 — 다른 숫자로 시작하면 표시와 폼이 갈린다.
    setAmount(pend.amount); setReason(''); setReviseWarn(null); setFormMode('record')
  }
  const closeForm = () => setFormMode(null)

  const undo = async (r: NonNullable<Refund>) => {
    if (!(await confirmDialog({
      title: '이용료 환불을 적용취소할까요?',
      message: `원래 수납 기록을 복원하고 청구를 환불 전 상태로 되돌립니다. ${monthLabel(r.month)} 매출이 ${fmtWon(r.refunded)} 늘어납니다. 퇴실 상태는 그대로 유지됩니다.`,
      level: 'caution', confirmLabel: '적용취소',
    }))) return
    startTransition(async () => {
      const res = await withSave(() => undoRentRefund(leaseTermId), { success: '이용료 환불을 적용취소했습니다' })
      if (!res.ok) return
      // 홈택스는 따로 되돌려야 한다 — 환불 안내의 반대 방향(문구 정본 lib/refundTaxNotice).
      for (const line of undoRefundTaxNoticeLines(res.taxNotice)) pushToast('info', line)
      setReviseWarn(null); setFormMode(null); reload(); onChanged?.()
    })
  }

  const submit = async () => {
    if (!formMode || !expectedMoveOut || amount <= 0 || over) return
    const trimmed = reason.trim()
    if (formMode === 'revise' && refund) {
      // 재확정은 적용취소 뒤 서버 확정을 다시 지나는데, 확정만 과거 회계월 보호에 걸린다(적용취소는 안 걸린다).
      // 먼저 되돌려 놓고 확정이 막히면 환불 기록만 사라진 채 남는다 — 같은 판정을 미리 물어 그 길을 막는다.
      const verdict = checkSettlementMonth(refund.month, kstYmdStr())
      if (!verdict.ok) { pushToast('error', verdict.reason); return }
      const delta = refund.refunded - amount   // 환불이 줄면 그만큼 매출이 는다
      if (!(await confirmDialog({
        title: `이용료 환불액을 ${fmtWon(amount)}으로 다시 확정할까요?`,
        message: `기존 확정 ${fmtWon(refund.refunded)}을 적용취소하고 새 금액으로 다시 확정합니다. ${monthLabel(refund.month)} 매출이 ${fmtWon(Math.abs(delta))} ${delta > 0 ? '늘어납니다' : '줄어듭니다'}. 청구 확정 ${fmtWon(refund.companyKeeps)}이 ${fmtWon(keeps)}이 됩니다.`,
        level: 'caution', confirmLabel: '다시 확정',
      }))) return
    } else if (formMode === 'record' && pend) {
      if (!(await confirmDialog({
        title: `이용료 ${fmtWon(amount)}을 환불로 기록할까요?`,
        message: `${monthLabel(pend.month)} 받은 돈 ${fmtWon(pend.paid)} 중 ${fmtWon(amount)}을 환불로 확정합니다. 청구 확정은 ${fmtWon(keeps)}이 됩니다.`,
        level: 'caution', confirmLabel: '환불 기록',
      }))) return
    }
    startTransition(async () => {
      // 재확정은 두 호출이다. 첫째가 실패하면 아무것도 안 바뀐다. 둘째가 실패하면 적용취소만 선 채 남는데,
      // 퇴실 정산 위젯이 청구를 먼저 확정해 둔 계약이면 카드가 '환불 미처리'로 서서 '환불 기록'으로 다시
      // 확정할 수 있다 — 사람이 복구할 수 있는 중간 상태. 홈택스 안내는 확정 쪽 것만 띄운다(적용취소의
      // '재발행' 안내와 확정의 '취소·재발행' 안내를 잇달아 보이면 서로 어긋나 보인다). 확정이 막혔을 때만
      // 적용취소 쪽 안내를 대신 띄운다.
      let undoNotice: string[] = []
      if (formMode === 'revise') {
        const un = await withSave(() => undoRentRefund(leaseTermId), { success: '' })
        if (!un.ok) return
        undoNotice = undoRefundTaxNoticeLines(un.taxNotice)
      }
      const res = await withSave(
        () => finalizeRentRefund({ leaseTermId, moveOutYmd: expectedMoveOut, rentRefundAmount: amount, ...(trimmed ? { reason: trimmed } : {}) }),
        { success: formMode === 'revise' ? `이용료 환불액을 ${fmtWon(amount)}으로 다시 확정했습니다` : `이용료 환불 ${fmtWon(amount)}을 기록했습니다`, silentError: formMode === 'revise' },
      )
      if (!res.ok) {
        if (formMode === 'revise') {
          setReviseWarn(res.error)
          for (const line of undoNotice) pushToast('info', line)
        }
        setFormMode(null); reload(); onChanged?.()
        return
      }
      for (const line of refundTaxNoticeLines(res.taxNotice)) pushToast('info', line)
      setReviseWarn(null); setFormMode(null); reload(); onChanged?.()
    })
  }

  // 예상(퇴실 예정) — 퇴실 정산 위젯이 먼저 확정해 둔 청구가 있으면 그 값을 이어받는다(정본 섹션과 같은 산식).
  const expected = preview && preview.ok && preview.settlementApplies
    ? (preview.appliedProration != null
      ? Math.max(0, preview.prepaidAmount - preview.appliedProration)
      : settlementAmounts(preview.defaultPick, preview).refund)
    : null

  const badge: { tone: 'pale-green' | 'pale-amber' | 'pale-neutral'; label: string } =
    refund ? { tone: 'pale-green', label: '환불 완료' }
    : pend || status === 'CHECKED_OUT' ? { tone: 'pale-amber', label: '환불 미처리' }
    : !expectedMoveOut ? { tone: 'pale-neutral', label: '예정일 없음' }
    : { tone: 'pale-neutral', label: '예상' }

  return (
    <div className="rounded-xl border border-[var(--warm-border)] bg-[var(--cream)] px-3 py-2.5 space-y-1.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <p className="text-xs font-semibold text-[var(--coral)]">이용료 정산</p>
        <Badge tone={badge.tone} size="sm">{badge.label}</Badge>
      </div>

      {reviseWarn && (
        <p className="text-xs text-[var(--warning-fg)] break-keep">
          환불이 적용취소된 상태로 남았습니다. {reviseWarn}{pend ? " 아래 '환불 기록'으로 다시 확정해 주세요." : ''}
        </p>
      )}

      {refund && (
        <>
          <p className="text-sm text-[var(--warm-dark)] break-keep">
            <span className="text-[var(--warm-muted)] text-xs">환불 </span>
            <span className="font-semibold num">{fmtWon(refund.refunded)}</span>
            <span className="text-[var(--warm-muted)] text-xs"> / 원 수납 {fmtWon(refund.prepaid)} · 청구 확정 {fmtWon(refund.companyKeeps)}</span>
          </p>
          <p className="text-[0.65625rem] text-[var(--warm-muted)] break-keep">
            {monthLabel(refund.month)}분{refund.at ? ` · ${kstYmdStr(new Date(refund.at)).replaceAll('-', '.')} 처리` : ''}{refund.reason ? ` · 사유: ${refund.reason}` : ''}
          </p>
          {/* §16 상시 적용취소 진입점 — 이 카드가 정본이라 여기가 '원위치'다. 금액 수정은 그 옆. */}
          {canEdit && formMode === null && (
            <div className="flex gap-1.5 flex-wrap">
              <Btn variant="subtle" size="sm" disabled={pending} onClick={() => { void undo(refund) }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
                적용취소
              </Btn>
              {expectedMoveOut && <Btn variant="subtle" size="sm" disabled={pending} onClick={openRevise}>금액 수정</Btn>}
            </div>
          )}
          {canEdit && formMode === null && !expectedMoveOut && (
            <p className="text-[0.65625rem] text-[var(--warm-mid)] break-keep">퇴실일이 없어 금액을 수정할 수 없습니다. 입주자 정보 수정에서 퇴실일을 넣어 주세요.</p>
          )}
        </>
      )}

      {!refund && pend && (
        <>
          <p className="text-sm text-[var(--warm-dark)] break-keep">
            <span className="text-[var(--warm-muted)] text-xs">안 돌려준 이용료 </span>
            <span className="font-semibold num">{fmtWon(pend.amount)}</span>
            <span className="text-[var(--warm-muted)] text-xs"> / 받은 돈 {fmtWon(pend.paid)} · 청구 확정 {fmtWon(pend.keeps)}</span>
          </p>
          <p className="text-[0.65625rem] text-[var(--warm-muted)] break-keep">
            {monthLabel(pend.month)} 받은 돈이 확정 청구보다 많습니다. 돌려줬다면 환불로 기록해 주세요.
          </p>
          {canEdit && formMode === null && (
            expectedMoveOut
              ? <Btn variant="subtle" size="sm" disabled={pending} onClick={openRecord}>환불 기록</Btn>
              : <p className="text-[0.65625rem] text-[var(--warm-mid)] break-keep">퇴실일이 없어 기록할 수 없습니다. 입주자 정보 수정에서 퇴실일을 넣어 주세요.</p>
          )}
        </>
      )}

      {!refund && !pend && status === 'CHECKOUT_PENDING' && (
        <>
          {!expectedMoveOut ? (
            <p className="text-[0.65625rem] text-[var(--warm-muted)] break-keep">퇴실 예정일을 넣으면 환불 예상액이 섭니다.</p>
          ) : preview && preview.ok && expected != null ? (
            <>
              <p className="text-sm text-[var(--warm-dark)] break-keep">
                <span className="text-[var(--warm-muted)] text-xs">환불 예상 </span>
                <span className="font-semibold num">{fmtWon(expected)}</span>
                <span className="text-[var(--warm-muted)] text-xs"> / 결제액 {fmtWon(preview.prepaidAmount)}</span>
              </p>
              <p className="text-[0.65625rem] text-[var(--warm-muted)] break-keep">
                {preview.appliedProration != null
                  ? `퇴실 정산에서 확정한 ${monthLabel(preview.prepaidMonths[0]?.month ?? expectedMoveOut)} 청구 ${fmtWon(preview.appliedProration)} 기준입니다.`
                  : settlementPickCaption(preview.defaultPick, preview.shortStay, { prepaidAmount: preview.prepaidAmount })}
                {' '}퇴실 처리할 때 최종 확정합니다.
              </p>
            </>
          ) : (
            <p className="text-[0.65625rem] text-[var(--warm-muted)] break-keep">
              {preview && !preview.ok ? preview.error
                : preview?.ok && !preview.settlementApplies ? (preview.notApplicableReason ?? '이 계약에는 이용료 정산이 성립하지 않습니다.')
                : '환불 예상액을 계산할 수 없습니다.'}
            </p>
          )}
          {/* 예정 단계의 조정은 퇴실 정산 위젯이 정본 — 여기 편집 칸을 두면 같은 값을 두 자리가 다르게 저장한다. */}
          {canEdit && onAdjust && (
            <Btn variant="subtle" size="sm" onClick={onAdjust}>{expectedMoveOut ? '정산 조정' : '퇴실 정산 열기'}</Btn>
          )}
        </>
      )}

      {formMode && (
        <div className={formBoxCls}>
          <div className="space-y-1.5">
            <label className={labelCls} htmlFor={`${uid}-amount`}>환불액</label>
            <input id={`${uid}-amount`} type="text" inputMode="numeric" value={amount.toLocaleString()}
              onChange={e => setAmount(Number(e.target.value.replace(/[^0-9]/g, '')))}
              aria-invalid={over || undefined} aria-describedby={over ? `${uid}-amount-err` : undefined}
              className={`${over ? inputErrCls : inputCls} num`} />
          </div>
          {/* 청구 확정은 파생값이다(§12 자동 합산 읽기전용, 퇴실 정산 위젯과 같은 문법) — 두 칸을 다 열면 합이 상한과 어긋날 수 있다. */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-[var(--warm-muted)] shrink-0">청구 확정</span>
            <span className="flex-1 text-right text-sm tabular-nums text-[var(--warm-dark)] bg-[var(--sand-s)] border border-transparent rounded-sm px-2.5 py-1.5">
              {keeps.toLocaleString()}
            </span>
          </div>
          <p className="text-[0.65625rem] text-[var(--warm-muted)] text-right">자동 계산 · {maxLabel} {fmtWon(max)}</p>
          <div className="space-y-1.5">
            <label className={labelCls} htmlFor={`${uid}-reason`}>사유 <span className="font-normal text-[var(--warm-muted)]">(계산값과 다른 이유)</span></label>
            <input id={`${uid}-reason`} value={reason} onChange={e => setReason(e.target.value)} maxLength={200}
              placeholder="예: 실제 입실일 기준으로 계산" className={inputCls} />
          </div>
          {over ? (
            <p id={`${uid}-amount-err`} className="text-[0.6875rem] text-[var(--danger-fg)] break-keep">
              {maxLabel} {fmtWon(max)}보다 {fmtWon(amount - max)} 많습니다. 환불은 {maxLabel}을 넘을 수 없습니다.
            </p>
          ) : (
            <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed break-keep">
              {formMode === 'revise'
                ? '기존 확정을 적용취소하고 새 금액으로 다시 확정합니다. 홈택스 발행분은 따로 정정해야 합니다.'
                : '그 달 수납 기록을 환불 뒤 금액으로 다시 적습니다. 홈택스 발행분은 따로 정정해야 합니다.'}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <Btn variant="secondary" size="sm" disabled={pending} onClick={closeForm}>취소</Btn>
            <Btn variant="primary" size="sm" disabled={pending || amount <= 0 || over || (formMode === 'revise' && amount === refund?.refunded && reason.trim() === (refund?.reason ?? ''))}
              onClick={() => { void submit() }}>
              {formMode === 'revise' ? '다시 확정' : '환불 기록'}
            </Btn>
          </div>
        </div>
      )}
    </div>
  )
}
