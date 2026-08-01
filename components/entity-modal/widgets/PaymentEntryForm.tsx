'use client'

// 수납 등록 — 일반 (FIFO 자동 충당) + 보증금/청소비 분리 모드.
// 셸의 수납 full 모드와 RoomsClient 양쪽 재사용. RoomsClient 의 handleSavePayment·UI 그대로 이주.
// FIFO 알고리즘은 savePayment 서버액션 내부 (변경 X). 위젯은 입력+호출+토스트.

import { useEffect, useMemo, useState, useTransition } from 'react'
import {
  savePayment, saveDepositPayment, saveCleaningFeePayment, saveReservationDeposit, getTargetMonthOptions, getTenantLastPayMethod, type SavePaymentResult,
} from '@/app/(app)/rooms/actions'
import { addExtraIncome } from '@/app/(app)/finance/actions'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { DatePicker } from '@/components/ui/DatePicker'
import { Btn } from '@/components/ui/Btn'
import { kstYmdStr } from '@/lib/kstDate'
import { fmtKorMoney, fmtWon } from '@/lib/fmtMoney'
import { trackSave, pushToast } from '@/lib/saveStatus'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { PAYMENT_METHODS } from '@/lib/paymentMethods'
import { CARD_LIKE_METHODS } from '@/lib/paymentMethods'

type Room = {
  leaseTermId: string
  tenantId: string | null
  expected: number
  balance: number       // 음수면 미수, 양수면 선납 — 미수 보충 자동 프리필용
  depositAmount: number
  cleaningFee: number
  moveInDate: string | null
  roomNo?: string | null   // 과납분 기타수익 기록 시 내역 표기용
  status?: string | null   // RESERVED면 예약금(모드 3택) 폼으로 분기
  reservationDepositMode?: string | null   // 예약금 처리 모드 기본값('deposit'|'prepaid'|'none')
}

// 초과 납부분을 '기타 수익'으로 처리할 때의 카테고리(설정 후 finance 에서 이름 변경 가능)
const EXTRA_INCOME_CATEGORY = '기타 임대수입'

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
  // 추천(이번에 낼 금액)보다 더 낸 초과분 — '이월' 또는 '기타 수익' 처리 대상
  const excess = Math.max(0, payAmount - suggestedAmount)
  const [excessAsIncome, setExcessAsIncome] = useState(false)
  const [payDateVal, setPayDateVal] = useState<string>(kstYmdStr())
  const [payMethod, setPayMethod] = useState<string>('계좌이체')
  const [cashReceiptIssued, setCashReceiptIssued] = useState(false)   // 현금영수증 발행 표시(메타데이터, 오류신고 2bd8befa)
  const [memo, setMemo] = useState<string>('')
  const [isDepositMode, setIsDepositMode] = useState(false)
  const [isCleaningFeeMode, setIsCleaningFeeMode] = useState(false)
  const [showSpecialModes, setShowSpecialModes] = useState(false) // 보증금/청소비 분리 모드 토글 (기본 숨김)
  const [error, setError] = useState<string>('')

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!room.tenantId) { setError('입주자 정보가 없습니다.'); return }
    setError('')
    // 자릿수 오입력 확인 — 보증금/청소비 합산은 정상적으로 커지므로 제외. 기준값(추천액) 없으면 생략.
    if (!isDepositMode && !isCleaningFeeMode && suggestedAmount > 0 && payAmount >= suggestedAmount * SUSPICIOUS_MULTIPLIER) {
      const ok = await confirmDialog({
        title: '입력하신 금액이 예상보다 큽니다.',
        message: `${fmtWon(payAmount)}이 맞나요? 0을 하나 더 누르지 않았는지 확인하세요.`,
        level: 'caution',
        confirmLabel: '이대로 수납',
      })
      if (!ok) return
    }
    startTransition(async () => {
      const release = trackSave()
      try {
        if (isCleaningFeeMode) {
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
          await saveDepositPayment({
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
        } else {
          // 초과분을 '기타 수익'으로 처리하면: 이용료는 추천액(=완납)만 저장(이월 안 함) + 초과분은 ExtraIncome.
          const useIncome = excessAsIncome && excess > 0
          const rentPart = useIncome ? payAmount - excess : payAmount
          // 납부 내역에서도 보이도록 그 달 기록 메모에 초과분 표시(이용료 금액 자체는 정상가 유지 — 중복 매출 방지)
          const rentMemo = useIncome
            ? `${memo ? memo + ' · ' : ''}초과 ${fmtWon(excess)} 기타수익 처리`
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
            if (!incRes.ok) pushToast('error', `기타수익 기록 실패: ${incRes.error} (이용료는 저장됨)`)
          } else if (result.allocations.length > 0) {
            const otherMonths = result.allocations.filter(a => a.targetMonth !== result.inputMonth)
            if (otherMonths.length > 0) {
              const summary = otherMonths.map(a => `${Number(a.targetMonth.slice(5))}월분 ${fmtWon(a.amount)}`).join(', ')
              pushToast('success', `자동 분배: ${summary} (미수가 가장 오래된 월부터 충당)`)
            }
          }
        }
        if (payMethod) localStorage.setItem('stayeum-last-pay-method', payMethod)
        pushToast('success', isDepositMode ? '보증금 수납됨' : isCleaningFeeMode ? '청소비 수납됨'
          : (excessAsIncome && excess > 0) ? `이용료 ${fmtWon((payAmount - excess))} + 기타수익 ${fmtWon(excess)} 기록됨`
          : '월 이용료 수납됨')
        // 폼 리셋
        setPayAmount(0); setForcedTm('auto'); setIsDepositMode(false); setIsCleaningFeeMode(false); setMemo(''); setExcessAsIncome(false)
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
      {!isDepositMode && !isCleaningFeeMode && (
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

      {/* 초과 납부 처리 — 추천액보다 더 내면 '이월'(기본) 또는 '기타 수익'으로 확정 */}
      {!isDepositMode && !isCleaningFeeMode && excess > 0 && (
        <div className="rounded-xl border border-[var(--warm-border)] bg-[var(--canvas)] p-2.5 space-y-1.5">
          <p className="text-[0.6875rem] text-[var(--warm-mid)]">초과분 <span className="font-bold text-[var(--warm-dark)]">{fmtWon(excess)}</span></p>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={excessAsIncome} onChange={e => setExcessAsIncome(e.target.checked)} className="rounded" />
            <span className="text-xs text-[var(--warm-dark)]">기타 수익으로 처리 <span className="text-[var(--warm-muted)]">(체크 안 하면 다음 달로 이월)</span></span>
          </label>
        </div>
      )}
      {/* 보증금/청소비 수납 — 발견성 위해 또렷한 버튼으로. (입주 첫 달 주로 사용) */}
      {(room.depositAmount > 0 || room.cleaningFee > 0) && !showSpecialModes && !isDepositMode && !isCleaningFeeMode && (
        <button type="button" onClick={() => setShowSpecialModes(true)}
          className="w-full text-xs font-medium text-[var(--coral)] border border-[var(--coral)]/35 bg-[var(--coral)]/5 rounded-lg px-3 py-2 hover:bg-[var(--coral)]/10 transition-colors">
          + {room.depositAmount > 0 ? '보증금' : ''}{room.depositAmount > 0 && room.cleaningFee > 0 ? '·' : ''}{room.cleaningFee > 0 ? '청소비' : ''} 수납하기
          {room.depositAmount > 0 && <span className="text-[var(--warm-muted)] font-normal"> · 보증금 {fmtKorMoney(room.depositAmount)}</span>}
        </button>
      )}
      {room.depositAmount > 0 && (showSpecialModes || isDepositMode) && (
        <div className="space-y-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={isDepositMode}
              onChange={e => {
                const checked = e.target.checked
                setIsDepositMode(checked)
                if (checked) {
                  setIsCleaningFeeMode(false)
                  setPayAmount(room.depositAmount + room.expected)
                  setPayDateVal(room.moveInDate ?? kstYmdStr())
                } else {
                  setPayDateVal(kstYmdStr())
                }
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
                if (checked) {
                  setPayAmount(room.cleaningFee + room.expected)
                  setPayDateVal(room.moveInDate ?? kstYmdStr())
                } else {
                  setPayDateVal(kstYmdStr())
                }
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
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={cashReceiptIssued} onChange={e => setCashReceiptIssued(e.target.checked)}
            className="w-3.5 h-3.5 accent-[var(--coral)]" />
          <span className="text-xs text-[var(--warm-dark)]">현금영수증 발행함</span>
        </label>
      )}
      <div className="space-y-1">
        <label className="text-xs text-[var(--warm-muted)]">메모</label>
        <input type="text" value={memo} onChange={e => setMemo(e.target.value)} placeholder="메모 (선택)"
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] placeholder:text-[var(--ink-m)] outline-none focus:border-[var(--coral)]" />
      </div>
      {error && <p className="text-[var(--danger-fg)] text-sm">{error}</p>}
      <div className="flex gap-2">
        {onCancel && <Btn type="button" variant="secondary" onClick={onCancel} fullWidth>취소</Btn>}
        <Btn type="submit" variant="primary" disabled={pending || !(payAmount > 0)} fullWidth>
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
  // 보증금 대체 프리필은 '남은 금액' — 전액 프리필이 기수납분을 못 보고 중복 수납을 유발했다(신고 50a2a69b).
  const depositRemain = Math.max(0, (room.depositAmount || 0) - depositPaidTotal)
  const defaultAmount = (m: ResvMode) => m === 'prepaid' ? (room.expected || 0) : m === 'deposit' ? depositRemain : 0
  const [amount, setAmount] = useState<number>(defaultAmount(initial))
  // 수납일 정본은 '받은 날'(오늘) — 입주 희망일 프리필은 조회월 밖으로 기록을 밀어 0원으로 보이게 했다.
  const [payDateVal, setPayDateVal] = useState<string>(kstYmdStr())
  const [payMethod, setPayMethod] = useState<string>('계좌이체')
  const [cashReceiptIssued, setCashReceiptIssued] = useState(false)
  const [memo, setMemo] = useState<string>('')
  const [error, setError] = useState<string>('')

  const changeMode = (m: ResvMode) => { setMode(m); setAmount(defaultAmount(m)) }

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
            : mode === 'prepaid' ? '받은 금액을 입주월 이용료로 충당합니다(선납).'
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
