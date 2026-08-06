'use client'

// 고객 상태 전환 버튼 + 미니폼. lease.status 기반 다음 단계 전환(투어/예약/입실/퇴실/비거주 등).
// applyStatusTransition·recordDepositReturn 서버액션 그대로 호출. 추출은 UI/state 만 이동.
// transitionsFor() 정의 그대로 이주.

import { useState, useTransition } from 'react'
import { fmtWon } from '@/lib/fmtMoney'
import { fmtDateDot as fmtDate } from '@/lib/fmtDate'
import { applyStatusTransition, recordDepositReturn, getReceivedDepositTotal, getDepositBasisForLease, getCleaningFeeReceivedForLease,
  getReservedPrepaidTotal, recordReservationPrepaidCancel, undoReservationPrepaidCancel } from '@/app/(app)/tenants/actions'
import { DatePicker } from '@/components/ui/DatePicker'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { Btn } from '@/components/ui/Btn'
import { confirmDialog, alertDialog } from '@/components/ui/ConfirmDialog'
import { Modal } from '@/components/ui/Modal'
import { kstYmdStr } from '@/lib/kstDate'
import { buildReason, reasonsForStatus, reasonLabel } from '@/lib/statusReasons'
import { WITHHOLD_REASONS, buildWithholdReason, cleaningFeeDeductible } from '@/lib/depositWithholdReasons'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { trackSave, pushToast } from '@/lib/saveStatus'
import { useEntityModal } from '@/components/entity-modal/EntityModal'
import { shouldOfferCheckoutProration } from '@/lib/prorate'
import { ShortStayExtensionModal } from './ShortStayExtensionModal'

type TransitionDef = {
  key: string
  label: string
  toStatus: string
  field?: 'moveInDate' | 'expectedMoveOut' | 'moveOutDate' | 'rentAmount'
  fieldLabel?: string
  withDeposit?: boolean
  tone?: 'primary' | 'secondary' | 'danger'
  confirm?: string
  // 신고 9b974be0: 예약 확정/해제 — 상태는 그대로(RESERVED) 두고 reservationConfirmedAt만 토글
  kind?: 'confirm' | 'unconfirm'
}
// isShortTerm: 단기는 '퇴실일 변경'이 아니라 연장 모달로 라우팅되므로 라벨도 그 창 이름('단기 연장')으로 맞춘다.
function transitionsFor(status: string, confirmed = false, isShortTerm = false): TransitionDef[] {
  switch (status) {
    case 'WAITING_TOUR': return [
      { key: 'tourDone', label: '투어 완료', toStatus: 'TOUR_DONE', tone: 'secondary', confirm: '투어 완료로 변경할까요?' },
      { key: 'reserve',  label: '입실 예약 전환', toStatus: 'RESERVED', field: 'moveInDate', fieldLabel: '입주 희망일', tone: 'primary' },
      { key: 'cancel',   label: '입실 취소', toStatus: 'CANCELLED', tone: 'danger', confirm: '입실 취소로 변경할까요?' },
    ]
    case 'TOUR_DONE': return [
      { key: 'reserve',  label: '입실 예약 전환', toStatus: 'RESERVED', field: 'moveInDate', fieldLabel: '입주 희망일', tone: 'primary' },
      { key: 'cancel',   label: '입실 취소', toStatus: 'CANCELLED', tone: 'danger', confirm: '입실 취소로 변경할까요?' },
    ]
    case 'RESERVED': return [
      confirmed
        ? { key: 'unconfirm', label: '확정 해제', toStatus: 'RESERVED', tone: 'secondary', kind: 'unconfirm' }
        : { key: 'confirm',   label: '예약 확정', toStatus: 'RESERVED', tone: 'primary',   kind: 'confirm' },
      { key: 'moveIn',   label: '입실 처리', toStatus: 'ACTIVE', field: 'moveInDate', fieldLabel: '입주일', tone: 'primary' },
      { key: 'cancel',   label: '입실 취소', toStatus: 'CANCELLED', tone: 'danger', confirm: '입실 취소로 변경할까요?' },
    ]
    case 'ACTIVE': return [
      { key: 'checkoutPending', label: '퇴실 예정 처리', toStatus: 'CHECKOUT_PENDING', field: 'expectedMoveOut', fieldLabel: '퇴실 예정일', tone: 'primary' },
      { key: 'nonResident',     label: '비거주 전환',    toStatus: 'NON_RESIDENT', field: 'rentAmount', fieldLabel: '비거주 월 이용료', tone: 'secondary' },
    ]
    case 'CHECKOUT_PENDING': return [
      { key: 'checkout',       label: '퇴실 처리',    toStatus: 'CHECKED_OUT', field: 'moveOutDate', fieldLabel: '퇴실일', withDeposit: true, tone: 'primary' },
      { key: 'changeMoveOut',  label: isShortTerm ? '단기 연장' : '퇴실일 변경',  toStatus: 'CHECKOUT_PENDING', field: 'expectedMoveOut', fieldLabel: '퇴실 예정일', tone: 'secondary' },
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
  cleaningFee: number
  moveInDate: Date | string | null
  expectedMoveOut: Date | string | null
  rentAmount: number
  dueDay: string | null
  isShortTerm: boolean
  reservationConfirmedAt: Date | string | null
  roomId: string | null
  // 예약금 처리 모드 해석값 — 예약 취소 반환/몰취 경로 분기('deposit'|'prepaid'|'none')
  reservationDepositMode: string
}

// resvCancel: 예약 취소 시 실수납 예약금 반환·몰취 미니폼(depositAmount=실수납 합).
// resvCancelPrepaid: prepaid 모드 예약 취소 — 이용료 선납 반환/몰취(depositAmount=선납 실수납 합).
type ActiveTransition = { def: TransitionDef; tenantId: string; tenantName: string; leaseTermId: string; depositAmount: number; cleaningFee: number; resvCancel?: boolean; resvCancelPrepaid?: boolean; depoFromReceived?: boolean; carriedOver?: boolean; cleaningPaid?: number } | null

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
  // 미환불 사유 — 돈이 움직이는 결정이라 필수다(입실 취소 사유가 선택인 것과 다르다).
  const [withholdReason, setWithholdReason] = useState('')
  const [withholdEtc, setWithholdEtc] = useState('')
  const [transReason, setTransReason] = useState('')   // 취소 사유(선택) — TenantStatusLog.reason 적재(e1b81629)
  const [transReasonEtc, setTransReasonEtc] = useState('')   // '기타' 선택 시 자유 입력 — '기타 · <내용>' 으로 저장(2026-07-27)
  // 퇴실 예정일이 납입일과 가까울 때 '퇴실 정산?' 묻는 팝업 (날짜는 이미 저장된 상태)
  const [prorateAsk, setProrateAsk] = useState<{ date: string } | null>(null)
  const [shortExtOpen, setShortExtOpen] = useState(false)   // 단기 '퇴실일 변경'은 요금 재계산 모달로 라우팅(뒷문 차단)

  const transitions = transitionsFor(lease.status, !!lease.reservationConfirmedAt, lease.isShortTerm)
  if (transitions.length === 0) return null

  const handleClick = async (def: TransitionDef) => {
    // 단기 lease의 퇴실일 변경 — 날짜만 바꾸는 우회를 막고 누적 요금을 재계산하는 연장 모달로 보낸다. 장기는 기존 미니폼.
    if (def.key === 'changeMoveOut' && lease.isShortTerm) { setShortExtOpen(true); return }
    // 신고 9b974be0: 예약 확정 — 이용료·입주 희망일 필수(클라 선검증), 호실 미지정은 허용하되 확인 단계에 문구 표시.
    if (def.kind === 'confirm') {
      const missing: string[] = []
      if (!lease.rentAmount)  missing.push('월 이용료')
      if (!lease.moveInDate)  missing.push('입주 희망일')
      if (missing.length > 0) {
        await alertDialog(
          `${tenantName}님 · 예약 확정 불가`,
          `예약 확정에는 ${missing.join('·')}이 필요합니다. 고객 정보 수정에서 입력한 뒤 다시 확정해 주세요.`,
        )
        return
      }
      const ok = await confirmDialog({
        title: `${tenantName}님 · 예약을 확정할까요?`,
        message: lease.roomId ? undefined : '호실 미지정 상태로 확정합니다. 이후 호실을 지정할 수 있습니다.',
        confirmLabel: '예약 확정',
      })
      if (!ok) return
      runTransition(def, { reservationConfirmedAt: kstYmdStr() })
      return
    }
    // 신고 9b974be0: 확정 해제(적용취소 원칙)
    if (def.kind === 'unconfirm') {
      const ok = await confirmDialog({
        title: `${tenantName}님 · 예약 확정을 해제할까요?`,
        confirmLabel: '확정 해제',
      })
      if (!ok) return
      runTransition(def, { reservationConfirmedAt: null })
      return
    }
    // 신고 9b974be0: 예약 취소 시 실수납 예약금이 있으면 반환·몰취 미니폼(퇴실 미니폼 패턴 재사용).
    // 예약금 모드별 분기 — deposit: 보증금 반환/몰취, prepaid: 이용료 선납 반환/몰취, none: 대상 없음.
    if (def.key === 'cancel' && lease.status === 'RESERVED') {
      if (lease.reservationDepositMode === 'prepaid') {
        const received = await getReservedPrepaidTotal(lease.id)
        if (received > 0) {
          setTransRefund(received)   // 기본 전액 반환. '전액 몰취'가 위약금 처리.
          setTransReason(''); setTransReasonEtc(''); setWithholdReason(''); setWithholdEtc('')
          setActive({ def, tenantId, tenantName, leaseTermId: lease.id, depositAmount: received, cleaningFee: 0, resvCancelPrepaid: true })
          return
        }
        // 선납 실수납 없음 — 아래 기존 확인 흐름으로.
      } else if (lease.reservationDepositMode !== 'none') {
        const received = await getReceivedDepositTotal(lease.id)
        if (received > 0) {
          setTransRefund(received)   // 기본 전액 반환. '환불 안 함'이 전액 몰취.
          setTransReason(''); setTransReasonEtc(''); setWithholdReason(''); setWithholdEtc('')
          setActive({ def, tenantId, tenantName, leaseTermId: lease.id, depositAmount: received, cleaningFee: 0, resvCancel: true })
          return
        }
        // 실수납 예약금 없음 — 아래 기존 확인 흐름으로.
      }
      // none 모드 또는 받은 금액 없음 — 아래 기존 확인 흐름으로.
    }
    // e1b81629: 입실 취소는 확인창 대신 미니폼 — 취소 사유(선택)를 함께 수집해 이력에 남긴다.
    if (def.key === 'cancel') {
      setTransRefund(undefined)
      setTransReason(''); setTransReasonEtc(''); setWithholdReason(''); setWithholdEtc('')
      setActive({ def, tenantId, tenantName, leaseTermId: lease.id, depositAmount: 0, cleaningFee: 0 })
      return
    }
    if (!def.field) {
      if (def.confirm) {
        const ok = await confirmDialog({
          title: `${tenantName}님 · ${def.confirm}`,
          confirmLabel: def.label,
          ...(def.tone === 'danger' ? { level: 'caution' as const } : {}),
        })
        if (!ok) return
      }
      runTransition(def, undefined)
      return
    }
    // 사유 상태 초기화 — 앞서 연 미니폼의 선택이 남으면 다음 전이에 엉뚱한 사유가 붙는다.
    // 종전에는 취소 분기에서만 비웠는데, 퇴실도 사유를 받게 되면서 이 경로에도 필요해졌다.
    setTransReason(''); setTransReasonEtc('')
    setTransDate(
      def.field === 'expectedMoveOut' ? toDateInput(lease.expectedMoveOut)
      : def.field === 'moveOutDate'   ? kstYmdStr()
      : def.field === 'moveInDate'    ? (toDateInput(lease.moveInDate) || kstYmdStr())
      : '',
    )
    setTransRent(def.field === 'rentAmount' ? (lease.rentAmount || undefined) : undefined)
    // 정산 기준액 — 계약 보증금이 0이어도 실제로 받은 보증금이 있으면 그 금액으로 연다.
    // 종전에는 lease.depositAmount 만 봐서, 계약상 0인데 실수납이 있는 계약(520호 김민정 청소비 20,000)은
    // 반환·몰취 화면이 어느 경로로도 뜨지 않았다(B페이즈). 예약 취소 경로는 이미 실수납 기준이었다.
    let depoBaseForForm = lease.depositAmount || 0
    let depoFromReceived = false
    if (def.withDeposit && depoBaseForForm === 0) {
      depoBaseForForm = await getReceivedDepositTotal(lease.id)
      depoFromReceived = depoBaseForForm > 0
    }
    // 인수 전 입주자는 이전 원장 운영 원칙대로 키값 명목으로 돌려주지 않는다(운영자 확정 2026-08-02).
    // 케이스가 아니라 클래스라 기본 선택으로 제안한다. 세그먼트라 한 번 눌러 되돌릴 수 있다.
    const basis = def.withDeposit ? await getDepositBasisForLease(lease.id) : null
    const carriedOver = basis?.source === 'carriedOver'
    // 입실 때 청소비를 이미 받았으면 퇴실에서 또 떼지 않는다(계약서 §2-4 either/or, 2026-08-03)
    const cleaningPaid = def.withDeposit ? await getCleaningFeeReceivedForLease(lease.id) : 0
    const deductible = cleaningFeeDeductible(lease.cleaningFee || 0, cleaningPaid)
    setTransRefund(def.withDeposit
      ? (carriedOver ? 0 : Math.max(0, depoBaseForForm - deductible))
      : undefined)
    // 답이 정해진 경우는 미리 골라 둔다. 앱이 아는 값을 매번 묻지 않는다(모두 변경 가능).
    if (def.withDeposit) {
      if (carriedOver) setWithholdReason('키값')
      else if (deductible > 0) setWithholdReason('청소비')
    }
    setActive({ def, tenantId, tenantName, leaseTermId: lease.id, depositAmount: depoBaseForForm, cleaningFee: deductible, depoFromReceived, carriedOver, cleaningPaid })
  }

  const runTransition = (
    def: TransitionDef,
    fields: { moveInDate?: string; expectedMoveOut?: string; moveOutDate?: string; rentAmount?: number; reservationConfirmedAt?: string | null } | undefined,
  ) => {
    startTransition(async () => {
      const release = trackSave()
      try {
        // prepaid 예약 취소 — 이용료 선납 반환(record 소프트삭제)·몰취(위약금). undo 대칭.
        if (active?.resvCancelPrepaid && transRefund != null) {
          const r = await recordReservationPrepaidCancel({
            leaseTermId: lease.id, tenantId, refundAmount: transRefund,
            date: kstYmdStr(), tenantName,
          })
          if (!r.ok) { pushToast('error', r.error); return }
          const res = await applyStatusTransition({
            leaseTermId: lease.id, tenantId, toStatus: def.toStatus, ...(fields ?? {}),
            ...(buildReason(transReason, transReasonEtc) ? { reason: buildReason(transReason, transReasonEtc) } : {}),
          })
          if (!res.ok) { pushToast('error', res.error); return }
          const { recordIds, extraIncomeId } = r
          pushToast('success', `${tenantName}님 · ${def.label} 완료`, {
            action: { label: '취소 되돌리기', run: () => { void undoReservationPrepaidCancel(recordIds, extraIncomeId).then(u => {
              if (u.ok) { pushToast('info', '예약 선납 반환/몰취를 되돌렸습니다 (상태는 유지 — 필요 시 상태 변경으로 복구)'); onChange?.() }
              else pushToast('error', u.error)
            }).catch(() => pushToast('error', '되돌리기 중 통신 오류가 발생했습니다')) } },
          })
          setActive(null)
          onChange?.()
          return
        }
        // 보증금이 있으면 환불 0(=환불 안 함)이어도 기록 — 미반환분이 보증금 수익으로 잡히도록.
        // 신고 9b974be0: 예약 취소(resvCancel)는 기준 금액이 계약 보증금이 아니라 실수납 예약금 합.
        // active.depositAmount 는 진입 시 산정한 기준액(계약 0이면 실수납 폴백) — 화면과 저장이 같은 값을 쓴다
        const depoBase = active?.depositAmount ?? lease.depositAmount
        const withDeposit = def.withDeposit === true || active?.resvCancel === true
        if (withDeposit && depoBase > 0 && transRefund != null) {
          const withheldNow = Math.max(0, depoBase - transRefund)
          const needReason = def.withDeposit === true   // 퇴실 경로만. 예약 취소 몰취는 라벨에 사유가 들어 있다
          const reason = buildWithholdReason(withholdReason, withholdEtc)
          if (needReason && withheldNow > 0 && !reason) { pushToast('error', '미환불 사유를 선택해 주세요.'); return }
          // 전액을 돌려주지 않는 결정만 되묻는다. 청소비만 떼는 정상 퇴실에는 마찰을 만들지 않는다.
          // 이용료 전액 환불에는 이미 확인창이 있는데 몰취에는 없었다 — 방향이 반대였다.
          if (needReason && transRefund === 0 && depoBase > 0) {
            const mon = (fields?.moveOutDate || kstYmdStr()).slice(0, 7)
            if (!(await confirmDialog({
              title: '보증금을 전액 돌려주지 않고 퇴실 처리할까요?',
              message: `${depoBase.toLocaleString()}원이 ${Number(mon.slice(0, 4))}년 ${Number(mon.slice(5))}월 부가수익(보증금)으로 기록됩니다.\n사유: ${reason}.`,
              level: 'caution', confirmLabel: '전액 미환불로 처리',
            }))) return
          }
          const r = await recordDepositReturn({
            leaseTermId: lease.id, tenantId, depositAmount: depoBase,
            returnedAmount: transRefund,
            date: fields?.moveOutDate || kstYmdStr(),
            tenantName,
            ...(reason ? { reason } : {}),
            ...(active?.resvCancel ? { context: 'reservationCancel' as const } : {}),
          })
          if (!r.ok) { pushToast('error', r.error); return }
        }
        const res = await applyStatusTransition({
          leaseTermId: lease.id, tenantId, toStatus: def.toStatus, ...(fields ?? {}),
          // 사유를 받는 전이인지는 statusReasons 가 정한다 — 종전에는 여기서 def.key==='cancel' 로 따로 판정해
          // 폼과 저장이 각자 조건을 들고 있었다. 퇴실 사유를 받기 시작하면 그대로 갈린다.
          ...(reasonsForStatus(def.toStatus) && buildReason(transReason, transReasonEtc)
            ? { reason: buildReason(transReason, transReasonEtc) } : {}),
        })
        if (!res.ok) { pushToast('error', res.error); return }
        pushToast('success', `${tenantName}님 · ${def.label} 완료`)
        if (res.notice) pushToast('info', res.notice)
        setActive(null)
        onChange?.()
        // 퇴실 예정일 입력/변경이고 납입일과 가까우면(일할 의미 有) '퇴실 정산?' 팝업.
        // 정산 자체는 자동 적용 안 함 — 예 선택 시에만 수납 모달의 퇴실 정산 위젯으로 이동.
        const mo = fields?.expectedMoveOut
        if (def.field === 'expectedMoveOut' && mo
            && shouldOfferCheckoutProration(lease.rentAmount, lease.dueDay, mo, kstYmdStr(), lease.moveInDate ? new Date(lease.moveInDate).toISOString().slice(0, 10) : null)) {
          setProrateAsk({ date: mo })
        }
      } finally { release() }
    })
  }

  const submit = () => {
    if (!active) return
    const fields: { moveInDate?: string; expectedMoveOut?: string; moveOutDate?: string; rentAmount?: number; reservationConfirmedAt?: string | null } = {}
    if (active.def.field === 'moveInDate')      fields.moveInDate = transDate
    if (active.def.field === 'expectedMoveOut') fields.expectedMoveOut = transDate
    if (active.def.field === 'moveOutDate')     fields.moveOutDate = transDate
    if (active.def.field === 'rentAmount')      fields.rentAmount = transRent ?? 0
    runTransition(active.def, fields)
  }

  return (
    <>
      <div className="flex flex-wrap gap-2 py-2">
        {transitions.map(def => (
          <Btn key={def.key} type="button" variant={def.tone ?? 'secondary'} size="sm"
            disabled={pending} onClick={() => handleClick(def)} className="font-semibold">
            {def.label}
          </Btn>
        ))}
      </div>

      {/* 신고 9b974be0: 확정된 예약은 확정일 표시 */}
      {lease.status === 'RESERVED' && lease.reservationConfirmedAt && (
        <p className="-mt-1 pb-1 text-[0.6875rem] text-[var(--warm-muted)]">예약 확정일 {fmtDate(lease.reservationConfirmedAt)}</p>
      )}

      {/* 미니폼 모달 — 엔티티 모달 위에 겹침 (v2.0 §08: z 토큰 260=modal-2, 구 z-confirm 오용 교정) */}
      {active && (
        <Modal open z={260} width="sm" dirty={transRent != null || transRefund != null || transReason !== '' || transReasonEtc !== '' || withholdReason !== '' || withholdEtc !== ''}
          onClose={() => { if (!pending) setActive(null) }}
          title={`${active.tenantName}님 · ${active.def.label}`}
          footer={
            <div className="flex gap-2">
              <Btn variant="secondary" size="md" onClick={() => setActive(null)} disabled={pending} className="flex-1">취소</Btn>
              <Btn variant="primary" size="md" onClick={submit} disabled={pending} className="flex-1">{pending ? '처리 중…' : '확인'}</Btn>
            </div>
          }>
            <div className="space-y-3">
              {/* e1b81629: 입실 취소 미니폼 — 반환·몰취 대상 없으면 확인 문구, 사유는 선택 입력 */}
              {active.def.key === 'cancel' && active.depositAmount === 0 && (
                <p className="text-sm text-[var(--warm-dark)] leading-relaxed">입실 취소로 변경할까요? 문의·투어·예약 기록은 보존됩니다.</p>
              )}
              {/* 사유 — 어떤 전이에서 받을지는 statusReasons 가 정한다(입실 취소·퇴실 계열).
                  받는 곳과 나중에 고칠 수 있는 곳이 어긋나지 않게 판정을 한 곳에 뒀다. */}
              {(() => {
                const opts = reasonsForStatus(active.def.toStatus)
                if (!opts) return null
                return (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">{reasonLabel(active.def.toStatus)} <span className="font-normal opacity-60">(선택)</span></label>
                    <select value={transReason} onChange={e => setTransReason(e.target.value)}
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                      <option value="">기록 안 함</option>
                      {opts.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                    {transReason === '기타' && (
                      <input type="text" value={transReasonEtc} onChange={e => setTransReasonEtc(e.target.value)}
                        placeholder="사유를 직접 입력하세요"
                        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
                    )}
                  </div>
                )
              })()}
              {['moveInDate', 'expectedMoveOut', 'moveOutDate'].includes(active.def.field ?? '') && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">{active.def.fieldLabel}</label>
                  <DatePicker value={transDate} onChange={setTransDate}
                    className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
                </div>
              )}
              {active.def.field === 'rentAmount' && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">{active.def.fieldLabel}</label>
                  <MoneyInput value={transRent} onChange={setTransRent} placeholder="0원" />
                </div>
              )}
              {(active.def.withDeposit || active.resvCancel || active.resvCancelPrepaid) && active.depositAmount > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)] block">
                    {active.resvCancelPrepaid ? '선납 환불' : active.resvCancel ? '예약금 환불' : '보증금 환불'} <span className="text-[var(--warm-muted)] font-normal">({active.resvCancelPrepaid ? '받은 선납금' : active.resvCancel ? '받은 예약금' : active.depoFromReceived ? '받은 보증금' : '보증금'} {fmtWon(active.depositAmount)})</span>
                  </label>
                  {/* 종전에는 '환불 안 함'이 단방향 버튼이라 한 번 누르면 되돌아올 길이 금액 재입력뿐이었다.
                      상호배타 선택은 SegmentedControl 정본을 쓴다(§10 raw button 금지·§12). */}
                  <SegmentedControl size="sm" ariaLabel="보증금 환불 여부"
                    value={transRefund === 0 ? 'none' : 'refund'}
                    onChange={v => { if ((v === 'none') !== (transRefund === 0)) setTransRefund(v === 'none' ? 0 : Math.max(0, active.depositAmount - active.cleaningFee)) }}
                    options={[
                      { value: 'refund', label: (active.resvCancel || active.resvCancelPrepaid) ? '반환함' : '환불함' },
                      { value: 'none', label: (active.resvCancel || active.resvCancelPrepaid) ? '전액 몰취' : '환불 안 함' },
                    ]} />
                  <MoneyInput value={transRefund} onChange={setTransRefund} placeholder="0원" />
                  {/* 미환불이 있으면 사유를 받는다. 전액 환불이면 물을 것이 없다. */}
                  {active.def.withDeposit === true && transRefund != null && active.depositAmount - transRefund > 0 && (
                    <div className="space-y-1.5 pt-0.5">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">미환불 사유 <span className="font-normal opacity-60">(필수)</span></label>
                      <select value={withholdReason} onChange={e => setWithholdReason(e.target.value)}
                        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                        <option value="">선택하세요</option>
                        {WITHHOLD_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                      {withholdReason === '기타' && (
                        <input type="text" value={withholdEtc} onChange={e => setWithholdEtc(e.target.value)}
                          placeholder="사유를 직접 입력하세요"
                          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
                      )}
                    </div>
                  )}
                  <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed">
                    {(active.cleaningPaid ?? 0) > 0
                      ? <>청소비 {fmtWon(active.cleaningPaid ?? 0)}은 입실 때 이미 받아 공제하지 않습니다. </>
                      : active.cleaningFee > 0 ? <>청소비 {fmtWon(active.cleaningFee)}을 뺀 금액이 기본값입니다. </> : null}
                    {active.resvCancelPrepaid
                      ? <>반환하지 않은 금액은 위약금으로 기록됩니다.</>
                      : active.resvCancel
                      ? <>반환하지 않은 금액은 예약금 몰취로 기록됩니다.</>
                      : active.carriedOver
                      ? <>인수 전 입주자라 이전 원장 원칙대로 키값 명목 미환불이 기본입니다. 돌려주려면 위에서 &lsquo;환불함&rsquo;을 고르세요. 환불하지 않은 금액은 보증금 수익으로 기록됩니다.</>
                      : <>환불하지 않은 금액은 보증금 수익으로 기록됩니다.</>}
                  </p>
                </div>
              )}
            </div>
      </Modal>
      )}

      {/* 퇴실 정산 여부 팝업 — 퇴실일이 납입일과 가까울 때만. 날짜는 이미 저장됨. (v2.0 §08: 구 z-[310] raw 교정) */}
      {prorateAsk && (
        <Modal open z={260} width="sm"
          onClose={() => setProrateAsk(null)}
          title={`${tenantName}님 · 퇴실 정산`}
          footer={
            <div className="flex gap-2">
              <Btn variant="secondary" size="md" onClick={() => setProrateAsk(null)} className="flex-1">아니오</Btn>
              <Btn variant="primary" size="md" className="flex-1"
                onClick={() => {
                  setProrateAsk(null)
                  entityModal.open({ kind: 'payment', leaseTermId: lease.id, tenantId, openCheckoutProration: true })
                }}>
                예, 정산하기
              </Btn>
            </div>
          }>
            <div className="space-y-2">
              <p className="text-sm text-[var(--warm-dark)] leading-relaxed">
                퇴실 예정일이 납입일과 가깝습니다. 선납 기준 <b>일할로 퇴실 정산</b>을 하시겠어요?
              </p>
              <p className="text-[0.6875rem] text-[var(--warm-muted)] leading-relaxed">
                · <b>예</b> · 수납 화면의 퇴실 정산으로 이동해 일수만큼 계산(미납 시 정산 후 입금 / 완납 시 환불).<br />
                · <b>아니오</b> · 퇴실 예정일만 저장(이번 달 풀 청구 유지).
              </p>
            </div>
      </Modal>
      )}

      {/* 단기 연장 모달 — 퇴실일 변경 진입을 재계산 흐름으로 대체(뒷문 차단) */}
      {shortExtOpen && (
        <ShortStayExtensionModal open onClose={() => setShortExtOpen(false)}
          leaseTermId={lease.id} tenantId={tenantId} tenantName={tenantName}
          currentOut={toDateInput(lease.expectedMoveOut) || null} onDone={onChange} />
      )}
    </>
  )
}
