'use client'

// 수납 등록 — 일반 (FIFO 자동 충당) + 보증금/청소비 분리 모드.
// 셸의 수납 full 모드와 RoomsClient 양쪽 재사용. RoomsClient 의 handleSavePayment·UI 그대로 이주.
// FIFO 알고리즘은 savePayment 서버액션 내부 (변경 X). 위젯은 입력+호출+토스트.

import { useEffect, useMemo, useState, useTransition } from 'react'
import {
  savePayment, saveDepositPayment, saveCleaningFeePayment, saveReservationDeposit, getTargetMonthOptions, getTenantLastPayMethod, undoOverpayExtraIncome, type SavePaymentResult,
} from '@/app/(app)/rooms/actions'
import { addExtraIncome } from '@/app/(app)/finance/actions'
import { getDepositCompositionForLease } from '@/app/(app)/tenants/actions'
import { proposeDepositEntrySplit } from '@/lib/depositComposition'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { DatePicker } from '@/components/ui/DatePicker'
import { Btn } from '@/components/ui/Btn'
import { kstYmdStr } from '@/lib/kstDate'
import { fmtKorMoney, fmtWon } from '@/lib/fmtMoney'
import { trackSave, pushToast } from '@/lib/saveStatus'
import { choiceDialog } from '@/components/ui/ConfirmDialog'
import { confirmDepositCleaningOverlap } from '@/lib/depositEntryGuard'
import { PAYMENT_METHODS } from '@/lib/paymentMethods'
import { CARD_LIKE_METHODS } from '@/lib/paymentMethods'
import { reservationFeeSplit, reservationFeeSplitApplies, reservationCompositionLabel } from '@/lib/reservationDeposit'
import type { ShortStayReservationMode } from '@/lib/shortStay'

type Room = {
  leaseTermId: string
  tenantId: string | null
  expected: number
  balance: number       // 음수면 미수, 양수면 선납 — 미수 보충 자동 프리필용
  depositAmount: number
  cleaningFee: number
  moveInDate: string | null
  roomNo?: string | null   // 과납분 부가수익 기록 시 내역 표기용
  status?: string | null   // RESERVED면 예약금(모드 3택) 폼으로 분기
  reservationDepositMode?: string | null   // 예약금 처리 모드 기본값('deposit'|'prepaid'|'none')
  // 예약금 분해(청소비 + 이용료 충당) 판정·프리필 입력 — 서버와 같은 정본(reservationFeeSplitApplies)을 쓴다.
  isShortTerm?: boolean
  shortStayReservationMode?: string | null
  shortStayDeposit?: number
}

// 초과 납부분을 '부가수익'으로 처리할 때의 카테고리(설정 후 finance 에서 이름 변경 가능)
const EXTRA_INCOME_CATEGORY = '기타 임대수입'

// 분해 블록의 몫 입력 — MoneyInput(px-3 py-2.5, 약 42px)과 같은 스케일을 유지한다.
// 한 폼 안에 입력 높이를 섞지 않는다(§12). 보더 색은 검증 상태에 따라 호출부가 붙인다.
const SPLIT_INPUT_CLS = 'flex-1 min-w-0 text-right num bg-[var(--canvas)] border rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] min-h-[var(--input-h-touch)] sm:min-h-[var(--input-h)] outline-none focus-visible:border-[var(--tc-text)] focus-visible:shadow-[var(--input-ring-focus)] transition-colors'

// 자릿수 오입력(0 하나 더) 방지 — 추천액의 이 배수 이상이면 제출 전 확인. 저장 로직은 불변.
const SUSPICIOUS_MULTIPLIER = 5

type TmOption = Awaited<ReturnType<typeof getTargetMonthOptions>>[number]

export function PaymentEntryForm({ room, targetMonth, depositPaidTotal, onSaved, onCancel }: {
  room: Room
  targetMonth: string
  /** lease 전체 보증금 실수납 합(조회월 무관) — 예약금 폼의 잔여 프리필·기수납 안내용. */
  depositPaidTotal?: number
  /** 저장 성공 후 호출 — 부모가 settlement/records 재조회. */
  onSaved?: () => void
  onCancel?: () => void
}) {
  // 예약(RESERVED) 단계는 예약금 모드(보증금 대체·이용료 선납·안 받음) 전용 폼으로 분기.
  if (room.status === 'RESERVED') {
    return <ReservationDepositForm room={room} targetMonth={targetMonth} depositPaidTotal={depositPaidTotal ?? 0} onSaved={onSaved} onCancel={onCancel} />
  }
  return <PaymentEntryFormInner room={room} targetMonth={targetMonth} onSaved={onSaved} onCancel={onCancel} />
}

function PaymentEntryFormInner({ room, targetMonth, onSaved, onCancel }: {
  room: Room
  targetMonth: string
  onSaved?: () => void
  onCancel?: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [tmOptions, setTmOptions] = useState<TmOption[]>([])
  const [forcedTm, setForcedTm] = useState<'auto' | string>('auto')
  // 추천 납입액:
  //  - 귀속월을 특정 월로 고르면 그 달의 남은 청구액(인상 반영).
  //  - 자동(FIFO)일 때 미수가 있으면(balance<0) 그 절댓값(누적 미수 보충),
  //    미수가 없으면 '앞으로 낼 가장 이른 안 낸 달'의 청구액 → 인상 전 달이 완납되면 자동으로 인상가가 추천됨.
  //  - 사용자가 직접 바꾸면 그대로 유지(추천값 변할 때만 갱신).
  const suggestedAmount = useMemo(() => {
    if (forcedTm !== 'auto') {
      const o = tmOptions.find(t => t.month === forcedTm)
      if (o) { const rem = o.expectedAmount - o.paidAmount; return rem > 0 ? rem : o.expectedAmount }
      return room.expected
    }
    if (room.balance < 0) return -room.balance
    const next = tmOptions.find(o => o.paidAmount < o.expectedAmount)   // FIFO: 가장 이른 미완납 달(인상 반영)
    return next ? (next.expectedAmount - next.paidAmount) : room.expected
  }, [forcedTm, tmOptions, room.balance, room.expected])
  const [payAmount, setPayAmount] = useState<number>(suggestedAmount)
  useEffect(() => { setPayAmount(suggestedAmount) }, [suggestedAmount])
  // 추천(이번에 낼 금액)보다 더 낸 초과분 — '이월' 또는 '부가수익' 처리 대상
  const excess = Math.max(0, payAmount - suggestedAmount)
  const [payDateVal, setPayDateVal] = useState<string>(kstYmdStr())
  const [payMethod, setPayMethod] = useState<string>('계좌이체')
  const [cashReceiptIssued, setCashReceiptIssued] = useState(false)   // 현금영수증 발행 표시(메타데이터, 오류신고 2bd8befa)
  const [memo, setMemo] = useState<string>('')
  const [isDepositMode, setIsDepositMode] = useState(false)
  const [isCleaningFeeMode, setIsCleaningFeeMode] = useState(false)
  const [showSpecialModes, setShowSpecialModes] = useState(false) // 보증금/청소비 분리 모드 토글 (기본 숨김)
  const [error, setError] = useState<string>('')

  // 보증금 구성 — 잔여 판정의 정본은 서버다(depositComposition). 화면이 계약 보증금으로 대신 세면
  // 부분수납·청소비 포함형 계약에서 서버와 다른 말을 한다. 실제로 그랬다(아래 분해 블록 주석).
  const [comp, setComp] = useState<Awaited<ReturnType<typeof getDepositCompositionForLease>> | null>(null)
  useEffect(() => {
    let active = true
    getDepositCompositionForLease(room.leaseTermId)
      .then(c => { if (active) setComp(c) })
      .catch(() => { /* 조회 실패가 수납을 막으면 안 된다 — 분해 블록만 안 선다 */ })
    return () => { active = false }
  }, [room.leaseTermId])

  // 결제수단 프리필 — 이 고객의 직전 방식 우선(고객마다 계좌/카드/현금이 고정적, 운영자 요청 2026-07-06).
  // 첫 수납(기록 없음)만 기기 최근 방식으로 폴백.
  useEffect(() => {
    let active = true
    const deviceLast = typeof window !== 'undefined' ? localStorage.getItem('stayeum-last-pay-method') : null
    if (deviceLast) setPayMethod(deviceLast)
    if (!room.tenantId) return
    getTenantLastPayMethod(room.tenantId).then(m => { if (active && m) setPayMethod(m) }).catch(() => {})
    return () => { active = false }
  }, [room.tenantId])

  // 귀속월 옵션 fetch
  useEffect(() => {
    let active = true
    getTargetMonthOptions(room.leaseTermId, targetMonth).then(opts => { if (active) setTmOptions(opts) })
    return () => { active = false }
  }, [room.leaseTermId, targetMonth])

  // ── 3단 분해(제안·확인형, 운영자 확정 2026-08-24 · 신고 9e6c7cb3) ──────────────────────
  //
  // 운영자 원문. "입금 내역이 없으면 보증금 처리가 우선이지만 확인하는 단계가 있으면 되니까."
  // 그래서 앱은 **제안만** 한다. 화면이 몫을 채워 두고 사람이 고칠 수 있고, 사람이 확정한 값이
  // 그대로 기존 저장 정본으로 간다. 새 배분 산식은 만들지 않는다.
  //
  // 고칠 수 있어야 하는 이유가 둘이다. 인수 승계 계약은 앞선 원장이 보증금을 이미 받았고
  // (record 0건이 정상), 보증금이 미수납인데 이용료만 받는 달이 실재한다. 자동 배분이면
  // 두 경우 모두 없는 사실을 적는다.
  const depositRemaining = comp?.shortfall ?? 0
  // 청소비 잔여 — 보증금 안의 몫으로 받는 영업장에서는 0 이다. 그 몫은 이미 보증금 잔여에
  // 반영돼 있어서(depositComposition), 따로 칸을 세우면 같은 2만원을 두 번 받는 길이 열린다(신고 a5edc93e).
  // 계약 보증금이 0 이면 담을 보증금이 없으므로 포함형이어도 청소비는 별개다(단기 계약).
  const cleaningRemaining = comp
    ? ((comp.cleaningFeeInDeposit && room.depositAmount > 0) ? 0 : Math.max(0, (room.cleaningFee || 0) - comp.cleaningPaid))
    : 0
  const splitMode = !!comp && depositRemaining > 0
  // 인수 전 입주는 보증금 몫 기본값이 0 이다. 위험한 쪽을 기본값으로 두지 않는다 —
  // 자동 우선으로 두면 승계 계약마다 매번 내려야 하고 한 번 놓치면 없는 입금이 생긴다.
  const preAcq = !!comp?.preAcquisition
  const proposed = proposeDepositEntrySplit({
    amount: payAmount,
    depositRemaining: preAcq ? 0 : depositRemaining,
    cleaningRemaining,
  })
  const [splitDeposit, setSplitDeposit] = useState(0)
  const [splitCleaning, setSplitCleaning] = useState(0)
  const [depositTouched, setDepositTouched] = useState(false)
  const [cleaningTouched, setCleaningTouched] = useState(false)
  // 손댄 칸은 총액이 바뀌어도 그대로 두고, 안 댄 칸만 새 제안으로 따라간다. 파생으로 계산하므로
  // effect 가 없다 — effect 로 되쓰면 사람이 친 숫자를 앱이 한 틱 뒤에 덮는 순간이 생긴다.
  const dVal = depositTouched ? splitDeposit : proposed.deposit
  const cVal = cleaningTouched ? splitCleaning : proposed.cleaning
  const rVal = payAmount - dVal - cVal
  const splitTouched = depositTouched || cleaningTouched
  // 합이 안 맞으면 앱이 말없이 보정하지 않는다. 인라인으로 말하고 저장을 막는다(§27.2).
  const splitOver = splitMode && rVal < 0
  const depositOver = splitMode && dVal > depositRemaining
  const splitBlocked = splitOver || depositOver
  const resetSplit = () => { setDepositTouched(false); setCleaningTouched(false); setSplitDeposit(0); setSplitCleaning(0) }
  // 사람이 제안을 그대로 두면 오늘과 **완전히 같은 한 번의 호출**로 저장한다(초과분을 그 달에
  // 못박는 동작까지 그대로). 판정은 UI 상태(고쳤는가)가 아니라 값으로 한다 — 고쳤다 되돌린
  // 사람과 안 건드린 사람이 같은 숫자로 다른 저장을 하면 그게 곧 다음 사고다.
  const splitIsCanonical = cVal === 0 && dVal === Math.min(payAmount, depositRemaining)
  // 옛 2단 옵트인이 서는 자리는 이제 둘뿐이다.
  //   ① 구성 조회가 실패했을 때의 폴백(그때는 잔여를 몰라 계약액으로 안내할 수밖에 없다)
  //   ② 보증금이 없는 계약의 청소비 수납(단기)
  // 보증금 잔여가 0 인 계약에는 아무것도 세우지 않는다 — 종전에는 '보증금 수납하기'가 떠 있고
  // 눌러 저장하면 서버가 "더 받을 몫이 없습니다"로 거절하는 막다른 길이었다.
  const legacyOptIn = !comp || (room.depositAmount === 0 && room.cleaningFee > 0)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!room.tenantId) { setError('입주자 정보가 없습니다.'); return }
    if (splitBlocked) return
    setError('')
    // 자릿수 오입력 확인 — 보증금/청소비 합산은 정상적으로 커지므로 제외. 기준값(추천액) 없으면 생략.
    // 초과분 처리 — 놓치기 쉬운 폼 안 체크박스를 확인창으로 올렸다(운영자 오더 2026-08-03).
    // 금액만 치고 저장을 누르면 초과 블록을 못 보고 지나가는데, 그러면 부가수익으로 잡혔어야 할 돈이
    // 조용히 다음 달로 넘어간다. 결정을 한 자리로 모아 반드시 거치게 한다.
    // 기본(주 버튼)은 이월이다 — 선납 처리가 우선이라는 운영 원칙.
    //
    // 자릿수 확인창을 여기 합쳤다. 종전에는 따로 떠서 **큰 금액이면 확인창 두 개가 연속**으로 뜨는데,
    // 다이얼로그가 DOM 을 유지한 채 내용만 바꿔서 전환 표시가 전혀 없었다. 연타 한 번이
    // 초과분 처리 방식을 대신 결정한다(디자이너 패스). 그 결정은 아래 성공 토스트의
    // 적용취소로 되돌린다 — undoOverpayExtraIncome 이 수납과 부가수익을 함께 지운다.
    // 자릿수 의심 조건은 초과분 조건에 완전히 포섭되므로(5배 이상이면 초과분은 반드시 양수)
    // 합쳐도 커버리지가 줄지 않는다.
    let excessAsIncome = false
    if (!isDepositMode && !isCleaningFeeMode && !splitMode && suggestedAmount > 0 && excess > 0) {
      const suspicious = payAmount >= suggestedAmount * SUSPICIOUS_MULTIPLIER
      const choice = await choiceDialog({
        title: `${room.roomNo ? room.roomNo + ' ' : ''}초과분 ${fmtWon(excess)}을 어떻게 할까요?`,
        // suggestedAmount 는 미수가 있으면 누적 미수 총액이라 '이용료'가 아니다. '청구액'으로 부른다.
        message: (suspicious ? `${fmtWon(payAmount)}이 맞나요? 0을 하나 더 누르지 않았는지 확인하세요.\n\n` : '')
          + `청구액 ${fmtWon(suggestedAmount)}보다 ${fmtWon(excess)} 더 받았습니다.\n이월하면 다음 달 이용료에 먼저 충당됩니다.`,
        ...(suspicious ? { level: 'caution' as const } : {}),
        confirmLabel: '이월',
        altLabel: '부가수익',
        cancelLabel: '취소',
      })
      if (choice === null) return   // 취소는 무변경 — 저장 자체를 하지 않는다
      excessAsIncome = choice === 'alt'
    }
    // 보증금 수납 전 청소비 중복 확인 — 청소비를 이미 받았으면 현금 몫을 알려준다(신고 a5edc93e 후속, 정본 lib/depositEntryGuard).
    // 분해 모드에서는 총액이 아니라 **보증금으로 갈 몫**을 넘긴다. 총액을 넘기면 이용료가 섞인
    // 입금마다 확인창이 떠서, 진짜 경고여야 할 자리가 매번 누르고 지나가는 관문이 된다.
    if ((isDepositMode || splitMode) && !(await confirmDepositCleaningOverlap({
      leaseTermId: room.leaseTermId, depositAmount: room.depositAmount,
      payAmount: splitMode ? dVal : payAmount, cleaningFee: room.cleaningFee,
    }))) return
    // 부가수익으로 돌린 경우의 적용취소 대상 — 수납 record 들과 부가수익 한 건을 함께 되돌린다.
    let undo: { recordIds: string[]; extraIncomeId: string } | null = null
    let splitDone = false   // 분해 경로는 몫을 실은 자기 토스트를 띄운다(아래 공용 토스트를 건너뛴다)
    startTransition(async () => {
      const release = trackSave()
      try {
        if (splitMode) {
          const recordIds: string[] = []
          let cleaningIncomeId: string | undefined
          if (splitIsCanonical) {
            // 사람이 제안을 그대로 뒀다. 오늘과 글자 그대로 같은 한 번의 호출이다 —
            // 서버가 min(총액, 잔여)로 쪼개고 초과분을 이 달에 못박는 동작까지 종전과 동일하다.
            const depRes = await saveDepositPayment({
              leaseTermId:   room.leaseTermId,
              tenantId:      room.tenantId!,
              targetMonth,
              depositAmount: room.depositAmount,
              rentAmount:    room.expected,
              totalPaid:     payAmount,
              payDate:       payDateVal,
              payMethod,
              memo:          memo || undefined,
              cashReceiptIssued,
            })
            if (!depRes.ok) { pushToast('error', depRes.error); return }
            recordIds.push(...depRes.createdIds)
          } else {
            // 사람이 몫을 고쳤다. 각 몫을 **그 몫의 정본 저장부**로 보낸다 — 따로 받아 따로 적었다면
            // 갔을 바로 그 자리다. 새 배분 로직은 없다. 순서는 보증금·청소비·이용료이고,
            // 중간에 실패하면 거기서 멈추고 무엇까지 저장됐는지 말한다(형제 정본과 같은 문법).
            if (dVal > 0) {
              const depRes = await saveDepositPayment({
                leaseTermId:   room.leaseTermId,
                tenantId:      room.tenantId!,
                targetMonth,
                depositAmount: room.depositAmount,
                rentAmount:    room.expected,
                totalPaid:     dVal,
                payDate:       payDateVal,
                payMethod,
                memo:          memo || undefined,
                cashReceiptIssued,
              })
              if (!depRes.ok) { pushToast('error', depRes.error); return }
              recordIds.push(...depRes.createdIds)
            }
            if (cVal > 0) {
              const cleanRes = await saveCleaningFeePayment({
                leaseTermId: room.leaseTermId,
                tenantId:    room.tenantId!,
                targetMonth,
                cleaningFee: room.cleaningFee,
                rentAmount:  room.expected,
                totalPaid:   cVal,
                payDate:     payDateVal,
                payMethod,
                memo:        memo || undefined,
                cashReceiptIssued,
              })
              if (!cleanRes.ok) {
                pushToast('error', '청소비 기록에 실패했습니다', {
                  detail: `보증금 ${fmtWon(dVal)}은 저장됨 · ${cleanRes.error}`,
                })
                onSaved?.(); return
              }
              recordIds.push(...cleanRes.createdIds); cleaningIncomeId = cleanRes.extraIncomeId
            }
            if (rVal > 0) {
              try {
                const rentRes = await savePayment({
                  leaseTermId:    room.leaseTermId,
                  tenantId:       room.tenantId!,
                  targetMonth,
                  expectedAmount: room.expected,
                  actualAmount:   rVal,
                  payDate:        payDateVal,
                  payMethod,
                  memo:           memo || undefined,
                  // 정본 분기가 썼을 그 달로 못박는다. 다른 달을 넘기면 그 자체가 갈림이다.
                  forcedTargetMonth: targetMonth,
                  cashReceiptIssued,
                })
                recordIds.push(...rentRes.createdIds)
              } catch (rentErr) {
                pushToast('error', '이용료 기록에 실패했습니다', {
                  detail: `보증금 ${fmtWon(dVal)}은 저장됨 · ${(rentErr as Error).message ?? ''}`,
                })
                onSaved?.(); return
              }
            }
          }
          const parts = [
            dVal > 0 ? `보증금 ${fmtWon(dVal)}` : '',
            cVal > 0 ? `청소비 ${fmtWon(cVal)}` : '',
            rVal > 0 ? `이용료 ${fmtWon(rVal)}` : '',
          ].filter(Boolean)
          let undone = false   // 연타 방지 — 두 번째 요청은 이미 지워진 걸 못 찾아 실패로 떨어진다
          pushToast('success', `${room.roomNo ? room.roomNo + ' ' : ''}${fmtWon(payAmount)} 수납됨 · 수납일 ${payDateLabel(payDateVal)}`, {
            ...(parts.length > 1 ? { detail: parts.join(' · ') } : {}),
            action: {
              label: '적용취소',
              run: () => {
                if (undone) return
                undone = true
                void undoOverpayExtraIncome(recordIds, cleaningIncomeId).then(r => {
                  if (r.ok) pushToast('info', '수납 기록을 취소했습니다')
                  else pushToast('error', r.error, {
                    detail: r.intact ? '수납 기록은 그대로 남아 있습니다' : '수납 내역에서 상태를 확인하세요',
                  })
                  onSaved?.()
                }).catch(() => pushToast('error', '되돌리기 중 통신 오류가 발생했습니다'))
              },
            },
          })
          if (payDateVal.slice(0, 7) !== targetMonth) {
            pushToast('info', `지금 보는 ${Number(targetMonth.slice(5, 7))}월 내역에는 표시되지 않습니다`)
          }
          splitDone = true
        } else if (isCleaningFeeMode) {
          // 청소비는 보증금이 아니다 — 돌려줄 의무가 없는 확정 대가라 받은 달 수익이다.
          // 종전에는 saveDepositPayment 로 넘겨 isDeposit=true record 가 됐고, 그러면 매출에서
          // 통째로 빠지면서 동시에 있지도 않은 보유 보증금으로 잡혔다(회계 패널 2026-08-02).
          const res = await saveCleaningFeePayment({
            leaseTermId: room.leaseTermId,
            tenantId:    room.tenantId!,
            targetMonth,
            cleaningFee: room.cleaningFee,
            rentAmount:  room.expected,
            totalPaid:   payAmount,
            payDate:     payDateVal,
            payMethod,
            memo:        memo || undefined,
            cashReceiptIssued,
          })
          if (!res.ok) { pushToast('error', res.error); return }
        } else if (isDepositMode) {
          const depRes = await saveDepositPayment({
            leaseTermId:   room.leaseTermId,
            tenantId:      room.tenantId!,
            targetMonth,
            depositAmount: room.depositAmount,
            rentAmount:    room.expected,
            totalPaid:     payAmount,
            payDate:       payDateVal,
            payMethod,
            memo:          memo || undefined,
            cashReceiptIssued,
          })
          // 중복 입력 가드 — 이미 받은 돈을 못 보고 총액을 다시 넣는 경우를 막는다
          if (!depRes.ok) { pushToast('error', depRes.error); return }
        } else {
          // 초과분을 '부가수익'으로 처리하면: 이용료는 추천액(=완납)만 저장(이월 안 함) + 초과분은 ExtraIncome.
          const useIncome = excessAsIncome
          const rentPart = useIncome ? payAmount - excess : payAmount
          // 납부 내역에서도 보이도록 그 달 기록 메모에 초과분 표시(이용료 금액 자체는 정상가 유지 — 중복 매출 방지)
          const rentMemo = useIncome
            ? `${memo ? memo + ' · ' : ''}초과 ${fmtWon(excess)} 부가수익 처리`
            : memo
          const result: SavePaymentResult = await savePayment({
            leaseTermId:    room.leaseTermId,
            tenantId:       room.tenantId!,
            targetMonth,
            expectedAmount: room.expected,
            actualAmount:   rentPart,
            payDate:        payDateVal,
            payMethod,
            memo:           rentMemo,
            forcedTargetMonth: forcedTm === 'auto' ? undefined : forcedTm,
            cashReceiptIssued,
          })
          if (useIncome) {
            const fd = new FormData()
            fd.set('date', payDateVal)
            fd.set('amount', String(excess))
            fd.set('category', EXTRA_INCOME_CATEGORY)
            fd.set('detail', room.roomNo ? `${room.roomNo} 임대료 과납분` : '임대료 과납분')
            // 입주자 연결 — 수납관리 부가수익에서 누구 과납분인지 바로 확인
            fd.set('leaseTermId', room.leaseTermId)
            if (room.tenantId) fd.set('tenantId', room.tenantId)
            if (payMethod) fd.set('payMethod', payMethod)
            if (memo) fd.set('memo', memo)
            const incRes = await addExtraIncome(fd)
            // 실패하면 여기서 끊는다. 종전에는 이 토스트를 띄우고도 아래 성공 토스트로 흘러가서,
            // 기록되지 않은 부가수익을 '기록됨'이라고 말했다(전문가 패널 2026-08-03).
            if (!incRes.ok) {
              pushToast('error', '부가수익 기록에 실패했습니다', {
                detail: `이용료 ${fmtWon(rentPart)}은 저장됨 · ${incRes.error}`,
              })
              onSaved?.()
              return
            }
            undo = { recordIds: result.createdIds, extraIncomeId: incRes.id }
          } else if (result.allocations.length > 0) {
            const otherMonths = result.allocations.filter(a => a.targetMonth !== result.inputMonth)
            if (otherMonths.length > 0) {
              const summary = otherMonths.map(a => `${Number(a.targetMonth.slice(5))}월분 ${fmtWon(a.amount)}`).join(', ')
              pushToast('success', `자동 분배: ${summary} (미수가 가장 오래된 월부터 충당)`)
            }
          }
        }
        if (payMethod) localStorage.setItem('stayeum-last-pay-method', payMethod)
        if (undo) {
          // 결과 1행 + 부가 사실 2행 — 형제 정본(RoomsClient 일괄 수납)과 같은 슬롯 문법.
          // 한 줄에 금액 둘을 몰면 액션 버튼 폭(약 76px) 때문에 좁은 화면에서 접힌다.
          const u: { recordIds: string[]; extraIncomeId: string } = undo
          let undone = false   // 연타 방지 — 두 번째 요청은 이미 지워진 걸 못 찾아 실패로 떨어진다
          pushToast('success', `${room.roomNo ? room.roomNo + ' ' : ''}이용료 ${fmtWon(payAmount - excess)} 수납됨`, {
            detail: `초과분 ${fmtWon(excess)}은 부가수익으로 기록`,
            action: {
              label: '적용취소',
              run: () => {
                if (undone) return
                undone = true
                void undoOverpayExtraIncome(u.recordIds, u.extraIncomeId).then(r => {
                  if (r.ok) pushToast('info', '수납과 부가수익 기록을 취소했습니다')
                  else pushToast('error', r.error, {
                    detail: r.intact ? '수납과 부가수익 모두 그대로 남아 있습니다' : '수납 내역에서 상태를 확인하세요',
                  })
                  onSaved?.()
                }).catch(() => pushToast('error', '되돌리기 중 통신 오류가 발생했습니다'))
              },
            },
          })
        } else if (!splitDone) {
          pushToast('success', isDepositMode ? '보증금 수납됨' : isCleaningFeeMode ? '청소비 수납됨' : '월 이용료 수납됨')
        }
        // 폼 리셋
        setPayAmount(0); setForcedTm('auto'); setIsDepositMode(false); setIsCleaningFeeMode(false); setMemo('')
        resetSplit()
        setPayDateVal(kstYmdStr())
        onSaved?.()
      } catch (err) {
        const msg = (err as Error).message ?? '저장 실패'
        setError(msg); pushToast('error', msg)
      } finally { release() }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 border-t border-[var(--warm-border)] pt-3 mt-1">
      <p className="text-xs font-semibold text-[var(--coral)]">수납 등록</p>
      {/* 보증금 미수납 사실은 금액을 치기 **전에** 보여야 한다. 금액부터 채우는 동선에서 아래쪽
          진입점은 안 보이고, 그래서 보증금이 일반 수납으로 들어가 이용료 record 가 됐다(신고 00c39371).
          경고색을 쓰지 않는다 — 신규 입주 첫 달의 보증금 미수납은 정상 상태라 노랗게 칠하면 상시 오탐이다. */}
      {splitMode && (
        <p className="text-[0.65625rem] text-[var(--warm-dark)] bg-[var(--canvas)] rounded-lg px-2.5 py-1.5 leading-relaxed break-keep">
          {preAcq
            ? '인수 전 입주라 보증금은 앞선 원장이 받았습니다. 보증금 몫을 0으로 두었습니다. 이번에 실제로 받았다면 아래에서 금액을 올려 주세요.'
            : <>보증금 미수납 <span className="font-semibold num">{fmtWon(depositRemaining)}</span>. 받은 금액을 보증금부터 채워 나눕니다. 몫은 아래에서 고칠 수 있습니다.</>}
        </p>
      )}
      {/* 잔여 조회 전 자리 예약 — 값이 온 뒤 블록이 솟으면 그게 로딩 점프다(§17·§21). */}
      {!comp && room.depositAmount > 0 && <SkeletonRows rows={1} className="py-0" />}
      {!isDepositMode && !isCleaningFeeMode && !splitMode && (
        <>
          <p className="text-[0.65625rem] text-[var(--warm-muted)] bg-[var(--canvas)] rounded-lg px-2.5 py-1.5 leading-relaxed">
            받은 돈은 가장 오래 밀린 달부터 자동으로 채웁니다. 특정 달 이용료로 넣고 싶으면 아래에서 직접 선택하세요.
          </p>
          <div className="space-y-1">
            <label className="text-xs text-[var(--warm-muted)]">귀속월</label>
            <select value={forcedTm} onChange={e => setForcedTm(e.target.value as 'auto' | string)}
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
              <option value="auto">자동 · 오래 밀린 달부터 채움</option>
              {tmOptions.map(o => {
                const [y, m] = o.month.split('-')
                const tag = o.status === 'paid' ? '완납'
                  : o.status === 'partial' ? `일부 ${o.paidAmount.toLocaleString()}/${fmtWon(o.expectedAmount)}`
                  : o.status === 'future' ? '향후' : '미수'
                return <option key={o.month} value={o.month}>{Number(y)}년 {Number(m)}월분 · {tag}</option>
              })}
            </select>
            {forcedTm !== 'auto' && (
              <p className="text-[0.65625rem] text-[var(--warning-fg)] leading-relaxed">
                직접 선택 · 입력 금액이 그 달 이용료보다 많으면 남는 금액은 다음 달로 넘어갑니다.
              </p>
            )}
          </div>
        </>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-[var(--warm-muted)]">날짜</label>
          <DatePicker value={payDateVal} onChange={setPayDateVal}
            className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)]" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-[var(--warm-muted)]">금액</label>
          <MoneyInput value={payAmount} onChange={setPayAmount} placeholder="0원" />
        </div>
      </div>

      {/* 분해 블록 — 앱이 제안하고 사람이 확정한다. 세로 스택인 이유는 320px 에서 3열이 성립하지
          않기 때문이다(칸당 글자 자리 54px, '350,000'이 약 60px). 이용료 몫은 §12 '자동 합산
          읽기전용' 정본이다 — 총액이 위에서 확정된 이상 자유도는 둘뿐이라, 셋을 다 열면 존재하지
          않는 자유도 하나를 사람이 다루게 되고 그 결과가 곧 합 불일치다. */}
      {splitMode && (
        <div className="space-y-2 rounded-lg border border-[var(--warm-border)] bg-[var(--cream-soft)] px-2.5 py-2">
          <p className="text-[0.65625rem] text-[var(--warm-muted)]">보증금·이용료 나누기</p>
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-medium text-[var(--warm-mid)] shrink-0" htmlFor="split-deposit">보증금</label>
            <input id="split-deposit" type="text" inputMode="numeric" value={dVal.toLocaleString()}
              onChange={e => { setDepositTouched(true); setSplitDeposit(Number(e.target.value.replace(/[^0-9]/g, ''))) }}
              className={`${SPLIT_INPUT_CLS} ${depositOver ? 'border-[var(--tc)]' : 'border-[var(--warm-border)]'}`} />
          </div>
          {cleaningRemaining > 0 && (
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-[var(--warm-mid)] shrink-0" htmlFor="split-cleaning">청소비</label>
              <input id="split-cleaning" type="text" inputMode="numeric" value={cVal.toLocaleString()}
                onChange={e => { setCleaningTouched(true); setSplitCleaning(Number(e.target.value.replace(/[^0-9]/g, ''))) }}
                className={`${SPLIT_INPUT_CLS} border-[var(--warm-border)]`} />
            </div>
          )}
          <div className="flex items-center justify-between gap-2 border-t border-[var(--warm-border)] pt-2">
            <span className="text-xs font-medium text-[var(--warm-mid)] shrink-0">이용료</span>
            <span className="flex-1 text-right num text-sm text-[var(--warm-dark)] bg-[var(--sand-s)] rounded-sm px-3 py-2.5 min-h-[var(--input-h-touch)] sm:min-h-[var(--input-h)] flex items-center justify-end">
              {fmtWon(Math.max(0, rVal))}
            </span>
          </div>
          <p className="text-[0.65625rem] text-[var(--warm-muted)] text-right">자동 계산</p>
          {depositOver ? (
            <p className="text-[0.6875rem] text-[var(--danger-fg)] break-keep">
              보증금 몫이 잔여 {fmtWon(depositRemaining)}보다 {fmtWon(dVal - depositRemaining)} 많습니다. 몫을 줄여 주세요.
            </p>
          ) : splitOver ? (
            <p className="text-[0.6875rem] text-[var(--danger-fg)] break-keep">
              몫의 합 {fmtWon(dVal + cVal)}이 받은 금액 {fmtWon(payAmount)}을 넘습니다. 금액을 늘리거나 몫을 줄여 주세요.
            </p>
          ) : (
            <div className="flex items-center justify-between gap-2">
              {splitTouched ? (
                <button type="button" onClick={resetSplit}
                  className="text-[0.65625rem] text-[var(--warm-muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--coral)] shrink-0">
                  제안값으로 되돌리기
                </button>
              ) : <span />}
              <span className="text-[0.65625rem] text-[var(--warm-muted)] text-right break-keep">
                {splitTouched ? '직접 배분' : '자동 제안'} · 배분 {fmtWon(dVal + cVal + Math.max(0, rVal))} / 받은 금액 {fmtWon(payAmount)}
              </span>
            </div>
          )}
          {/* 승계 계약에 새 입금을 적는 것은 되돌리기 어려운 전환이다 — 퇴실 환불 기준액이
              계약 보증금에서 실수납액으로 넘어간다(getDepositBasisForLease). 차단이 아니라 고지다. */}
          {preAcq && dVal > 0 && (
            <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed break-keep">
              인수 승계 계약에 새 보증금 입금이 기록됩니다. 퇴실 정산 기준액이 계약 보증금에서 실수납액으로 바뀝니다.
            </p>
          )}
          {/* 조정 분기의 이용료 몫은 일반 수납과 똑같이 굴린다 — 그 달을 채우고 남으면 다음 달로 넘어간다.
              문장은 귀속월 직접 선택 안내와 같은 정본을 쓴다. */}
          {!splitIsCanonical && rVal > 0 && (
            <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed break-keep">
              이용료 몫이 그 달 청구액보다 많으면 남는 금액은 다음 달로 넘어갑니다.
            </p>
          )}
        </div>
      )}
      {/* 초과 납부 안내 — 결정은 저장할 때 확인창에서 한 번만 묻는다.
          종전에는 여기 체크박스가 결정 지점이었는데 금액만 치고 저장하면 그냥 지나쳤다. */}
      {!isDepositMode && !isCleaningFeeMode && !splitMode && excess > 0 && (
        <div className="rounded-xl border border-[var(--warm-border)] bg-[var(--canvas)] p-2.5">
          <p className="text-[0.6875rem] text-[var(--warm-mid)]">초과분 <span className="font-bold text-[var(--warm-dark)]">{fmtWon(excess)}</span>
            <span className="text-[var(--warm-muted)]"> · 저장할 때 이월(기본)과 부가수익 중 고릅니다.</span></p>
        </div>
      )}
      {/* 보증금/청소비 수납 — 발견성 위해 또렷한 버튼으로. (입주 첫 달 주로 사용) */}
      {legacyOptIn && (room.depositAmount > 0 || room.cleaningFee > 0) && !splitMode && !showSpecialModes && !isDepositMode && !isCleaningFeeMode && (
        <button type="button" onClick={() => setShowSpecialModes(true)}
          className="w-full text-xs font-medium text-[var(--coral)] border border-[var(--coral)]/35 bg-[var(--coral)]/5 rounded-lg px-3 py-2 hover:bg-[var(--coral)]/10 transition-colors">
          + {room.depositAmount > 0 ? '보증금' : ''}{room.depositAmount > 0 && room.cleaningFee > 0 ? '·' : ''}{room.cleaningFee > 0 ? '청소비' : ''} 수납하기
          {room.depositAmount > 0 && <span className="text-[var(--warm-muted)] font-normal"> · 보증금 {fmtKorMoney(room.depositAmount)}</span>}
        </button>
      )}
      {/* 폴백 전용 — 구성 조회가 실패해 잔여를 모를 때만. 그때는 계약액 기준 안내가 최선이다. */}
      {room.depositAmount > 0 && !comp && (showSpecialModes || isDepositMode) && (
        <div className="space-y-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={isDepositMode}
              onChange={e => {
                const checked = e.target.checked
                setIsDepositMode(checked)
                if (checked) {
                  setIsCleaningFeeMode(false)
                  setPayAmount(room.depositAmount + room.expected)
                }
                // 수납일은 언제나 오늘(받은 날)이다. 종전에는 입주일을 프리필했는데, 입주일이
                // 미래면 그 record 가 조회월 밖으로 밀려 화면에서 사라져 보인다(정본 money-display-feedback §3).
                setPayDateVal(kstYmdStr())
              }}
              className="w-4 h-4 accent-[var(--coral)]" />
            <span className="text-xs text-[var(--warm-mid)]">보증금 수납 ({fmtKorMoney(room.depositAmount)})</span>
          </label>
          {isDepositMode && (
            payAmount > room.depositAmount ? (
              <p className="text-xs text-[var(--success-fg)]">
                보증금 {fmtKorMoney(room.depositAmount)} + 이용료 {fmtKorMoney(payAmount - room.depositAmount)} = {fmtKorMoney(payAmount)}
              </p>
            ) : (
              <p className="text-xs text-[var(--warm-muted)]">
                보증금만 수납 (이용료 포함하려면 금액을 늘리세요 · 초과분은 {`${Number(targetMonth.slice(0, 4))}년 ${Number(targetMonth.slice(5, 7))}월`} 이용료로 처리)
              </p>
            )
          )}
        </div>
      )}
      {room.depositAmount === 0 && room.cleaningFee > 0 && (showSpecialModes || isCleaningFeeMode) && (
        <div className="space-y-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={isCleaningFeeMode}
              onChange={e => {
                const checked = e.target.checked
                setIsCleaningFeeMode(checked)
                if (checked) setPayAmount(room.cleaningFee + room.expected)
                setPayDateVal(kstYmdStr())
              }}
              className="w-4 h-4 accent-[var(--coral)]" />
            <span className="text-xs text-[var(--warm-mid)]">청소비 포함 수납 (청소비 {fmtKorMoney(room.cleaningFee)})</span>
          </label>
          {isCleaningFeeMode && (
            <p className="text-xs text-[var(--success-fg)]">
              청소비 {fmtKorMoney(room.cleaningFee)} + 이용료 {fmtKorMoney(room.expected)} = {fmtKorMoney(room.cleaningFee + room.expected)}
            </p>
          )}
        </div>
      )}
      <div className="space-y-1">
        <label className="text-xs text-[var(--warm-muted)]">결제 수단</label>
        <select value={payMethod} onChange={e => setPayMethod(e.target.value)}
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
          {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      {/* 카드 계열은 매출전표가 증빙을 대신하므로 현금영수증 대상이 아니다(운영자 확인 2026-08-01).
          체크를 막지는 않되(예외 상황 여지) 사실을 알려 오입력을 줄인다. 집계에서는 카드가 우선한다. */}
      {CARD_LIKE_METHODS.includes(payMethod) ? (
        <p className="text-[0.65625rem] text-[var(--warm-muted)]">
          카드 결제는 매출전표가 증빙을 대신해 현금영수증 집계에 넣지 않습니다.
        </p>
      ) : (
        <>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={cashReceiptIssued} onChange={e => setCashReceiptIssued(e.target.checked)}
              className="w-3.5 h-3.5 accent-[var(--coral)]" />
            <span className="text-xs text-[var(--warm-dark)]">현금영수증 발행함</span>
          </label>
          {/* 지금 서버가 하는 일을 그대로 말한다. 발행 표시는 이 결제가 만든 record 전부에 찍히고,
              현금영수증 합계는 보증금 record 도 함께 센다(getMonthPaymentAggregates). 보증금은
              매출이 아니므로 그만큼 국세청 발행액이 신고 매출을 앞선다 — 규칙 변경은 운영자 결정 사항이라
              여기서는 사실만 적는다. */}
          {cashReceiptIssued && splitMode && dVal > 0 && (
            <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed break-keep">
              보증금 몫 {fmtWon(dVal)}은 돌려줄 돈이라 매출이 아닙니다. 함께 발행하면 국세청 발행액이 신고 매출보다 그만큼 커집니다.
            </p>
          )}
          {cashReceiptIssued && splitMode && cVal > 0 && (
            <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed break-keep">
              청소비 몫 {fmtWon(cVal)}의 발행 표시는 앱이 기록하지 못합니다. 홈택스에서 발행했다면 따로 관리해 주세요.
            </p>
          )}
        </>
      )}
      <div className="space-y-1">
        <label className="text-xs text-[var(--warm-muted)]">메모</label>
        <input type="text" value={memo} onChange={e => setMemo(e.target.value)} placeholder="메모 (선택)"
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] placeholder:text-[var(--ink-m)] outline-none focus:border-[var(--coral)]" />
      </div>
      {error && <p className="text-[var(--danger-fg)] text-sm">{error}</p>}
      <div className="flex gap-2">
        {onCancel && <Btn type="button" variant="secondary" onClick={onCancel} fullWidth>취소</Btn>}
        <Btn type="submit" variant="primary" disabled={pending || !(payAmount > 0) || splitBlocked} fullWidth>
          {pending ? '저장 중…' : '저장'}
        </Btn>
      </div>
    </form>
  )
}

// 예약금 수납 폼 — 모드 3택(보증금 대체·이용료 선납·안 받음) + 금액 자유 입력.
// 저장은 saveReservationDeposit 진입점으로 위임(모드 인지 분기·모드 영속). 신규 결제 수식 없음.
type ResvMode = 'deposit' | 'prepaid' | 'none'
const RESV_MODE_LABEL: Record<ResvMode, string> = {
  deposit: '보증금 대체',
  prepaid: '이용료 선납',
  none:    '안 받음',
}

// 'YYYY-MM-DD' → '8/17' (토스트 수납일 표기)
const payDateLabel = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`

function ReservationDepositForm({ room, targetMonth, depositPaidTotal, onSaved, onCancel }: {
  room: Room
  targetMonth: string
  depositPaidTotal: number
  onSaved?: () => void
  onCancel?: () => void
}) {
  const [pending, startTransition] = useTransition()
  const initial = (['deposit', 'prepaid', 'none'] as const).includes(room.reservationDepositMode as ResvMode)
    ? (room.reservationDepositMode as ResvMode) : 'deposit'
  const [mode, setMode] = useState<ResvMode>(initial)
  // 분해 여부 판정은 서버 저장부와 같은 정본을 쓴다 — 화면이 나눠 보여주고 서버가 안 나누면 그게 사고다.
  const splits = (m: ResvMode) => reservationFeeSplitApplies({
    mode: m,
    isShortTerm: !!room.isShortTerm,
    shortStayMode: room.shortStayReservationMode as ShortStayReservationMode | null | undefined,
    cleaningFee: room.cleaningFee || 0,
  })
  // 보증금 대체 프리필은 '남은 금액' — 전액 프리필이 기수납분을 못 보고 중복 수납을 유발했다(신고 50a2a69b).
  const depositRemain = Math.max(0, (room.depositAmount || 0) - depositPaidTotal)
  // 분해 수납의 프리필은 단기 정책의 예약금 시드다(운영자 확정 2026-08-19). 이 자리에서 받는 돈은
  // 한 달 이용료가 아니라 '예약금'이라, 종전처럼 월 이용료를 채워 두면 매번 지우고 다시 쳐야 한다.
  // 시드가 0(미설정)이면 종전 기본값으로 떨어진다 — 빈 칸을 만들지 않는다.
  const defaultAmount = (m: ResvMode) =>
    m === 'prepaid' ? (splits(m) && (room.shortStayDeposit ?? 0) > 0 ? room.shortStayDeposit! : (room.expected || 0))
    : m === 'deposit' ? depositRemain : 0
  const [amount, setAmount] = useState<number>(defaultAmount(initial))
  // 수납일 정본은 '받은 날'(오늘) — 입주 희망일 프리필은 조회월 밖으로 기록을 밀어 0원으로 보이게 했다.
  const [payDateVal, setPayDateVal] = useState<string>(kstYmdStr())
  const [payMethod, setPayMethod] = useState<string>('계좌이체')
  const [cashReceiptIssued, setCashReceiptIssued] = useState(false)
  const [memo, setMemo] = useState<string>('')
  const [error, setError] = useState<string>('')

  const changeMode = (m: ResvMode) => { setMode(m); setAmount(defaultAmount(m)) }

  // 지금 입력된 금액이 어떻게 갈리는지 — 분해 대상이 아니면 null 이라 줄이 서지 않는다(순수 산술이라 메모 불필요).
  const splitPreview = splits(mode)
    ? (() => { const s = reservationFeeSplit(amount, room.cleaningFee || 0); return reservationCompositionLabel(s.cleaning, s.prepaid, fmtWon) })()
    : null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!room.tenantId) { setError('입주자 정보가 없습니다.'); return }
    setError('')
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await saveReservationDeposit({
          leaseTermId: room.leaseTermId,
          tenantId:    room.tenantId!,
          mode,
          amount:      mode === 'none' ? 0 : amount,
          payDate:     payDateVal,
          payMethod,
          memo:        memo || undefined,
          cashReceiptIssued,
        })
        if (!res.ok) { setError(res.error); pushToast('error', res.error); return }
        if (mode === 'none') {
          pushToast('success', '예약금 없이 예약으로 저장했습니다')
        } else {
          // 금액·수납일 항상 명시 — '반응 없음'으로 오인한 재시도가 중복 수납을 만들었다(신고 50a2a69b).
          pushToast('success', `예약금 ${fmtWon(amount)} 수납 기록됨 · 수납일 ${payDateLabel(payDateVal)}`)
          if (payDateVal.slice(0, 7) !== targetMonth) {
            pushToast('info', `지금 보는 ${Number(targetMonth.slice(5, 7))}월 내역에는 표시되지 않습니다`)
          }
        }
        onSaved?.()
      } catch (err) {
        const msg = (err as Error).message ?? '저장 실패'
        setError(msg); pushToast('error', msg)
      } finally { release() }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 border-t border-[var(--warm-border)] pt-3 mt-1">
      <p className="text-xs font-semibold text-[var(--coral)]">예약금 수납</p>
      <div className="space-y-1">
        <label className="text-xs text-[var(--warm-muted)]">처리 방식</label>
        <div className="grid grid-cols-3 gap-1.5">
          {(['deposit', 'prepaid', 'none'] as const).map(m => (
            <button key={m} type="button" onClick={() => changeMode(m)}
              className={`text-xs font-medium rounded-lg px-2 py-2 border transition-colors ${
                mode === m
                  ? 'border-[var(--coral)] text-[var(--coral)] bg-[var(--coral)]/10'
                  : 'border-[var(--warm-border)] text-[var(--warm-mid)] hover:bg-[var(--warm-border)]/40'
              }`}>
              {RESV_MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed">
          {mode === 'deposit' ? '받은 예약금을 보증금으로 기록합니다.'
            : mode === 'prepaid' ? (splits(mode)
              ? `청소비 ${fmtWon(room.cleaningFee)}을 먼저 떼고 남은 금액을 입주월 이용료로 충당합니다. 보증금은 남기지 않습니다.`
              : '받은 금액을 입주월 이용료로 충당합니다(선납).')
            : '예약금 없이 예약만 저장합니다.'}
        </p>
      </div>

      {mode !== 'none' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-[var(--warm-muted)]">날짜</label>
              <DatePicker value={payDateVal} onChange={setPayDateVal}
                className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)]" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-[var(--warm-muted)]">금액</label>
              <MoneyInput value={amount} onChange={setAmount} placeholder="0원" />
            </div>
          </div>
          {mode === 'deposit' && depositPaidTotal > 0 && (
            <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed">
              이미 받은 {fmtWon(depositPaidTotal)} / 계약 보증금 {fmtWon(room.depositAmount)}
            </p>
          )}
          {/* 분해 미리보기 — 저장 전에 이 돈이 어떻게 쪼개져 적히는지 보여준다. 금액을 고치면 같이 움직인다.
              문장은 정본 하나(reservationCompositionLabel)라 예약 취소 미니폼과 갈리지 않는다.
              몫이 하나뿐이면(예약금 ≤ 청소비) null 이라 줄이 서지 않는다 — 옆 숫자를 두 번 말하지 않는다. */}
          {splitPreview && (
            <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed break-keep">{splitPreview}</p>
          )}
          {splits(mode) && amount > 0 && !splitPreview && (
            <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed break-keep">
              전액 청소비로 기록됩니다 (계약 청소비 {fmtWon(room.cleaningFee)}).
            </p>
          )}
          <div className="space-y-1">
            <label className="text-xs text-[var(--warm-muted)]">결제 수단</label>
            <select value={payMethod} onChange={e => setPayMethod(e.target.value)}
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
              {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={cashReceiptIssued} onChange={e => setCashReceiptIssued(e.target.checked)}
              className="w-3.5 h-3.5 accent-[var(--coral)]" />
            <span className="text-xs text-[var(--warm-dark)]">현금영수증 발행함</span>
          </label>
          <div className="space-y-1">
            <label className="text-xs text-[var(--warm-muted)]">메모</label>
            <input type="text" value={memo} onChange={e => setMemo(e.target.value)} placeholder="메모 (선택)"
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] placeholder:text-[var(--ink-m)] outline-none focus:border-[var(--coral)]" />
          </div>
        </>
      )}
      {error && <p className="text-[var(--danger-fg)] text-sm">{error}</p>}
      <div className="flex gap-2">
        {onCancel && <Btn type="button" variant="secondary" onClick={onCancel} fullWidth>취소</Btn>}
        <Btn type="submit" variant="primary" disabled={pending || (mode !== 'none' && !(amount > 0))} fullWidth>
          {pending ? '저장 중…' : mode === 'none' ? '예약금 없이 저장' : '저장'}
        </Btn>
      </div>
    </form>
  )
}
