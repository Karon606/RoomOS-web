'use client'

// 입주자 상태 전환 버튼 + 미니폼. lease.status 기반 다음 단계 전환(투어/예약/입실/퇴실/비거주 등).
// applyStatusTransition·recordDepositReturn 서버액션 그대로 호출. 추출은 UI/state 만 이동.
// transitionsFor() 정의 그대로 이주.

import { useState, useTransition } from 'react'
import { fmtWon } from '@/lib/fmtMoney'
import { fmtDateDot as fmtDate } from '@/lib/fmtDate'
import { applyStatusTransition, recordDepositReturn, getReceivedDepositTotal, getDepositCompositionForLease,
  getReservedPrepaidComposition, recordReservationPrepaidCancel, undoReservationPrepaidCancel } from '@/app/(app)/tenants/actions'
import { DatePicker } from '@/components/ui/DatePicker'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { Btn } from '@/components/ui/Btn'
import { confirmDialog, alertDialog } from '@/components/ui/ConfirmDialog'
import { Modal } from '@/components/ui/Modal'
import { kstYmdStr } from '@/lib/kstDate'
import { buildReason, reasonsForStatus, reasonLabel } from '@/lib/statusReasons'
import { WITHHOLD_REASONS, buildWithholdReason, cleaningFeeDeductible,
  CARRIED_OVER_WITHHOLD_REASON, CLEANING_WITHHOLD_REASON } from '@/lib/depositWithholdReasons'
import { depositCompositionLabel, withheldDestinationLabel } from '@/lib/depositComposition'
import { reservationCompositionLabel } from '@/lib/reservationDeposit'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { CheckoutCleaningDateField, useCheckoutCleaningDate } from '@/components/cleaning/CheckoutCleaningDateField'
import { trackSave, pushToast } from '@/lib/saveStatus'
import { useEntityModal } from '@/components/entity-modal/EntityModal'
import { shouldOfferCheckoutProration } from '@/lib/prorate'
import { CLOSED_STATUSES } from '@/lib/leaseStatus'
import { fmtRoomList } from '@/lib/roomNo'
import { ShortStayExtensionModal } from './ShortStayExtensionModal'
import { RoomScheduleSheet } from '@/components/tenant/RoomScheduleSheet'

// 이 전이가 계약을 끝내는가 — 퇴실 완료·입실 취소. 명단은 lib/leaseStatus 정본을 그대로 넓혀 쓴다.
// 딸린 계약이 '끊긴 부모'가 되는 지점이 정확히 이 둘이다(lib/roomAssignment PARENT_LEASE_STATUSES 의 여집합).
// 퇴실 예정은 아직 부모 자격이 살아 있어 경고하지 않는다.
const CLOSING_STATUSES: string[] = CLOSED_STATUSES

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
type ActiveTransition = { def: TransitionDef; tenantId: string; tenantName: string; leaseTermId: string; depositAmount: number; cleaningFee: number; resvCancel?: boolean; resvCancelPrepaid?: boolean; depoFromReceived?: boolean; carriedOver?: boolean; cleaningPaid?: number; compositionLabel?: string | null; noBasisContract?: number } | null

// 전이와 함께 보내는 값들. 종전에는 이 모양이 runTransition·submit 두 자리에 그대로 베껴져
// 있었는데, 칸을 하나 늘릴 때마다 두 곳을 같이 고쳐야 하고 한쪽만 고치면 조용히 안 실린다.
type TransitionFields = {
  moveInDate?: string
  expectedMoveOut?: string
  moveOutDate?: string
  rentAmount?: number
  reservationConfirmedAt?: string | null
  /** 퇴실 청소 예정일. '' 대신 null 이 '미정'이고, 필드 자체가 없으면 '안 보냄'이다. */
  cleaningDate?: string | null
}

const toDateInput = (d: Date | string | null | undefined) => d ? kstYmdStr(new Date(d)) : ''

export function TenantStatusTransitions({ lease, tenantId, tenantName, subLeases = [], onChange }: {
  lease: Lease
  tenantId: string
  tenantName: string
  /**
   * 이 계약에 딸린 진행 중 계약 — 퇴실·취소 확인창이 '함께 정리되지 않는다'고 말할 때만 쓴다.
   * 부모가 골라 넘긴다(같은 사람의 계약을 이미 손에 쥔 곳이 거기다). 비어 있으면 아무것도 안 그린다.
   */
  subLeases?: { id: string; roomNo: string | null }[]
  /** 전환 성공 후 부모가 settlement/tenant 재조회. */
  onChange?: () => void
}) {
  const entityModal = useEntityModal()
  const [pending, startTransition] = useTransition()
  const [active, setActive] = useState<ActiveTransition>(null)
  // 호실 일정 시트 — 입실 처리가 계약 호실 점유로 거절당했을 때만 연다.
  const [earlyOpen, setEarlyOpen] = useState(false)
  // 같은 시트의 '미리 잡기' 모드 — 예약 상태에서 일정만 적어 둔다(상태는 안 바뀐다).
  const [planOpen, setPlanOpen] = useState(false)
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
  // 퇴실 청소 예정일 — 아직 안 건드렸으면 퇴실일(transDate)을 따라 움직인다(정본 훅).
  const cleaning = useCheckoutCleaningDate()
  const [shortExtOpen, setShortExtOpen] = useState(false)   // 단기 '퇴실일 변경'은 요금 재계산 모달로 라우팅(뒷문 차단)

  const transitions = transitionsFor(lease.status, !!lease.reservationConfirmedAt, lease.isShortTerm)
  if (transitions.length === 0) return null

  const handleClick = async (def: TransitionDef) => {
    // 입실 일정은 상태를 안 바꾼다 — 창만 열고 계획을 계약에 적어 둔다.
    if (def.key === 'plan') { setPlanOpen(true); return }
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
          `예약 확정에는 ${missing.join('·')}이 필요합니다. 입주자 정보 수정에서 입력한 뒤 다시 확정해 주세요.`,
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
        // 기준액은 예약 단계에서 받은 돈 전부 — 분해 수납이면 청소비 몫도 포함된다(산식 1).
        // 구성은 같은 서버 헬퍼가 돌려주므로 화면 숫자가 기준액과 갈릴 수 없다.
        const comp = await getReservedPrepaidComposition(lease.id)
        const received = comp.cleaning + comp.prepaid
        if (received > 0) {
          setTransRefund(received)   // 기본 전액 반환. '전액 몰취'가 위약금 처리.
          setTransReason(''); setTransReasonEtc(''); setWithholdReason(''); setWithholdEtc('')
          setActive({
            def, tenantId, tenantName, leaseTermId: lease.id, depositAmount: received, cleaningFee: 0,
            resvCancelPrepaid: true,
            compositionLabel: reservationCompositionLabel(comp.cleaning, comp.prepaid, fmtWon),
          })
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
    // 청소 예정일도 함께 비운다 — 앞서 연 퇴실 건에서 고른 날짜가 남으면 다음 사람에게 붙는다.
    cleaning.reset()
    setTransDate(
      def.field === 'expectedMoveOut' ? toDateInput(lease.expectedMoveOut)
      : def.field === 'moveOutDate'   ? kstYmdStr()
      : def.field === 'moveInDate'    ? (toDateInput(lease.moveInDate) || kstYmdStr())
      : '',
    )
    setTransRent(def.field === 'rentAmount' ? (lease.rentAmount || undefined) : undefined)
    // 정산 기준액은 서버 정본(getDepositBasisForLease().basis)을 그대로 쓴다 — 환불 저장이 되계산하는 그 값이다.
    // 종전에는 계약 보증금을 먼저 믿고 0일 때만 실수납으로 폴백해서, 계약 50,000 인데 현금 30,000 만 받은
    // 계약(520호 김민정 — 나머지 20,000 은 청소비로 받았다)에 화면이 50,000 을 제시하고 저장은 서버가
    // 30,000 기준으로 거절했다. 화면이 여는 최대치와 서버 기준이 갈리면 안 된다.
    // 인수 전 입주자는 이전 원장 운영 원칙대로 승계받은 보증금을 돌려주지 않는다(운영자 확정 2026-08-02).
    // 케이스가 아니라 클래스라 기본 선택으로 제안한다. 세그먼트라 한 번 눌러 되돌릴 수 있다.
    // 두 기본 사유는 목록 정본의 상수를 그대로 쓴다. 문자열을 여기 베끼면 목록만 개명될 때
    // 셀렉트에 없는 값이 골라진 것처럼 되어 칸이 빈 채로 뜬다(어휘 중립화 2026-08-17).
    const comp = def.withDeposit ? await getDepositCompositionForLease(lease.id) : null
    const depoBaseForForm = comp ? comp.basis : (lease.depositAmount || 0)
    // 기준액이 계약 보증금과 다를 때만 '받은 보증금'으로 못박는다(같으면 같은 말을 두 번 하는 셈).
    const depoFromReceived = !!comp && comp.basisSource === 'received' && comp.basis !== comp.contract
    const carriedOver = comp?.carriedOver === true
    // 입실 때 청소비를 이미 받았으면 퇴실에서 또 떼지 않는다(계약서 §2-4 either/or, 2026-08-03)
    const cleaningPaid = comp?.cleaningPaid ?? 0
    const deductible = cleaningFeeDeductible(lease.cleaningFee || 0, cleaningPaid)
    setTransRefund(def.withDeposit
      ? (carriedOver ? 0 : Math.max(0, depoBaseForForm - deductible))
      : undefined)
    // 답이 정해진 경우는 미리 골라 둔다. 앱이 아는 값을 매번 묻지 않는다(모두 변경 가능).
    if (def.withDeposit) {
      if (carriedOver) setWithholdReason(CARRIED_OVER_WITHHOLD_REASON)
      else if (deductible > 0) setWithholdReason(CLEANING_WITHHOLD_REASON)
    }
    setActive({
      def, tenantId, tenantName, leaseTermId: lease.id, depositAmount: depoBaseForForm,
      cleaningFee: deductible, depoFromReceived, carriedOver, cleaningPaid,
      compositionLabel: comp ? depositCompositionLabel(comp) : null,
      // 계약에는 보증금이 적혀 있는데 받은 기록이 없는 상태 — 서버가 환불·몰취 기록을 거절하는 자리다.
      // 기준액이 0 이라 환불 칸이 아예 안 뜨므로, 왜 없는지는 말해 줘야 한다(조용히 넘어가면 정산 누락).
      noBasisContract: !!comp && comp.basisSource === 'none' && comp.contract > 0 ? comp.contract : 0,
    })
  }

  const runTransition = (
    def: TransitionDef,
    fields: TransitionFields | undefined,
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
          const { recordIds, cleaningIncomeIds, extraIncomeId } = r
          pushToast('success', `${tenantName}님 · ${def.label} 완료`, {
            action: { label: '취소 되돌리기', run: () => { void undoReservationPrepaidCancel(recordIds, extraIncomeId, cleaningIncomeIds).then(u => {
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
              // 카테고리는 성격대로 갈린다 — 보증금 안의 청소비 몫은 청소비, 그 몫을 넘는 차감만 몰취다.
              message: `${fmtWon(depoBase)}이 ${Number(mon.slice(0, 4))}년 ${Number(mon.slice(5))}월 ${withheldDestinationLabel(depoBase, active?.cleaningFee ?? 0, fmtWon)} 기록됩니다.\n사유: ${reason}.`,
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
        if (!res.ok) {
          // 본 방이 아직 안 비어 막힌 것이라면 그냥 막지 않는다 — 개강처럼 미룰 수 없는 사정으로
          // 하루 일찍 오는 일이 있다(운영자 실무 2026-08-26). 홈 알림 경로와 같은 문법으로 잇는다.
          if (res.code === 'ROOM_OCCUPIED') {
            const go = await confirmDialog({
              title: res.error,
              message: '계약 호실이 빌 때까지 다른 방에서 지내게 할 수 있습니다. 그날이 오면 앱이 알아서 옮깁니다.',
              confirmLabel: '일정 짜기',
            })
            if (go) { setActive(null); setEarlyOpen(true) }
            return
          }
          pushToast('error', res.error); return
        }
        pushToast('success', `${tenantName}님 · ${def.label} 완료`)
        if (res.notice) pushToast('info', res.notice)
        setActive(null)
        onChange?.()
        // 퇴실 예정일 입력/변경이고 납입일과 가까우면(일할 의미 有) '퇴실 정산?' 팝업.
        // 정산 자체는 자동 적용 안 함 — 예 선택 시에만 수납 모달의 퇴실 정산 위젯으로 이동.
        const mo = fields?.expectedMoveOut
        if (def.field === 'expectedMoveOut' && mo
            && shouldOfferCheckoutProration(lease.rentAmount, lease.dueDay, mo, kstYmdStr(), lease.moveInDate ? new Date(lease.moveInDate).toISOString().slice(0, 10) : null, lease.isShortTerm)) {
          setProrateAsk({ date: mo })
        }
      } finally { release() }
    })
  }

  const submit = () => {
    if (!active) return
    const fields: TransitionFields = {}
    if (active.def.field === 'moveInDate')      fields.moveInDate = transDate
    if (active.def.field === 'expectedMoveOut') fields.expectedMoveOut = transDate
    if (active.def.field === 'moveOutDate')     fields.moveOutDate = transDate
    if (active.def.field === 'rentAmount')      fields.rentAmount = transRent ?? 0
    // 청소 예정일은 칸을 실제로 그린 전이에서만 보낸다. 안 보내면 서버가 퇴실일에서 기본값을
    // 뽑는데, 칸이 없던 전이에 빈 값을 실어 보내면 그것이 '미정'으로 읽힌다.
    if (active.def.key === 'checkout' && lease.roomId) fields.cleaningDate = cleaning.value || null
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
              {/* 딸린 계약 경고 — 메인 계약을 끝내도 추가 계약은 따라 정리되지 않는다(다호실 마무리 2026-08-17).
                  막지 않고 알린다. 창고만 남기고 방을 빼는 것도 정당한 처리라 서버는 그대로 받고,
                  끊긴 부모는 감지망 축 ①(check-lease-subordination)이 사후에 센다.
                  수정 폼의 같은 경고와 문장 한 벌이다. 맨 위에 두는 것은 날짜·금액을 정하기 전에
                  '이 처리가 무엇을 남기는가'를 먼저 읽어야 하기 때문이다. */}
              {subLeases.length > 0 && CLOSING_STATUSES.includes(active.def.toStatus) && (
                <p className="text-[0.6875rem] text-[var(--warning-fg)] leading-relaxed break-keep">
                  이 계약에 딸린 추가 계약 {subLeases.length}건({fmtRoomList(subLeases.map(s => s.roomNo))})은 자동으로 정리되지 않습니다. 각 계약에서 따로 처리해 주세요.
                </p>
              )}
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
                  {/* focus-visible 링은 §09 필수인데 이 칸에는 없었다. 바로 아래 청소 예정일이
                      같은 생김새로 서므로 둘이 다르게 반응하면 그 자체가 이질감이다. */}
                  <DatePicker value={transDate} onChange={setTransDate}
                    className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus-visible:border-[var(--persimmon)] focus-visible:shadow-[0_0_0_3px_rgba(160,60,46,0.12)] transition-colors" />
                </div>
              )}
              {/* 청소 예정일 — 퇴실 확정에서만, 그리고 호실이 있을 때만 선다. 호실이 없으면
                  서버가 청소를 아예 안 만들므로(ensureCheckoutCleaning 의 첫 줄) 묻고 버리는
                  칸이 된다. 자리는 퇴실일 바로 아래다 — 기본값이 퇴실일에서 파생되므로 원인
                  칸과 같은 시야에 있어야 따라 움직인 것이 보인다. 돈 블록 뒤에 두면 좁은 폭에서
                  접힌 선 아래로 내려가고, 바로 위 환불 안내문에 붙어 환불 기록일로 읽힌다. */}
              {active.def.key === 'checkout' && lease.roomId && (
                <CheckoutCleaningDateField value={cleaning.value} onChange={cleaning.setValue} />
              )}
              {active.def.field === 'rentAmount' && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">{active.def.fieldLabel}</label>
                  <MoneyInput value={transRent} onChange={setTransRent} placeholder="0원" />
                </div>
              )}
              {/* 계약 보증금은 있는데 받은 기록이 없으면 환불 칸을 열 근거가 없다 — 서버도 같은 이유로 거절한다.
                  종전에는 계약액으로 칸을 열고 저장에서야 거절해, 화면과 서버가 다른 말을 했다. */}
              {active.def.withDeposit && (active.noBasisContract ?? 0) > 0 && (
                <p className="text-[0.65625rem] text-[var(--warm-mid)] break-keep">
                  계약 보증금 {fmtWon(active.noBasisContract ?? 0)}이 있으나 받은 기록이 없어 환불·몰취를 기록할 수 없습니다. 수납 화면에서 보증금 수납을 먼저 등록해 주세요.
                </p>
              )}
              {(active.def.withDeposit || active.resvCancel || active.resvCancelPrepaid) && active.depositAmount > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)] block">
                    {active.resvCancelPrepaid ? '선납 환불' : active.resvCancel ? '예약금 환불' : '보증금 환불'} <span className="text-[var(--warm-muted)] font-normal">({/* 분해 수납이면 이 금액은 선납만이 아니라 받은 예약금 전부다(청소비 몫 포함) — 아래 구성 줄이 내역을 편다 */}
                      {active.resvCancelPrepaid ? (active.compositionLabel ? '받은 예약금' : '받은 선납금') : active.resvCancel ? '받은 예약금' : active.depoFromReceived ? '받은 보증금' : '보증금'} {fmtWon(active.depositAmount)})</span>
                  </label>
                  {/* 청소비가 보증금 몫을 채운 계약은 구성을 병기한다 — 현금만 보이면 '계약 5만인데 왜 3만인가'로 읽힌다.
                      문법은 DepositStatusPanel 정본과 같은 한 줄(두 화면이 갈리지 않게). */}
                  {active.compositionLabel && (
                    <p className="text-[0.65625rem] text-[var(--warm-mid)] break-keep">{active.compositionLabel}</p>
                  )}
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
                      ? <>인수 전 입주자라 이전 원장 원칙대로 승계받은 보증금을 돌려주지 않는 것이 기본입니다. 돌려주려면 위에서 &lsquo;환불함&rsquo;을 고르세요. 환불하지 않은 금액은 {withheldDestinationLabel(Math.max(0, active.depositAmount - (transRefund ?? 0)), active.cleaningFee, fmtWon)} 기록됩니다.</>
                      : <>환불하지 않은 금액은 {withheldDestinationLabel(Math.max(0, active.depositAmount - (transRefund ?? 0)), active.cleaningFee, fmtWon)} 기록됩니다.</>}
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

      {/* 호실 일정 — 입실 처리가 계약 호실 점유로 막힌 자리에서만 열린다(거절이 곧 진입점). */}
      {earlyOpen && (
        <RoomScheduleSheet leaseTermId={lease.id} tenantName={tenantName}
          onClose={() => setEarlyOpen(false)}
          onDone={() => { setEarlyOpen(false); onChange?.() }} />
      )}
      {planOpen && (
        <RoomScheduleSheet leaseTermId={lease.id} tenantName={tenantName} mode="plan"
          onClose={() => setPlanOpen(false)}
          onDone={() => { setPlanOpen(false); onChange?.() }} />
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
