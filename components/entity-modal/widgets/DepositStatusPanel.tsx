'use client'

// 보증금 계약 단위 패널 — 수납 정보(엔티티 모달)와 고객정보 두 화면의 정본.
//
// 왜 계약 단위인가. 보증금은 입주할 때 한 번 받고 끝이라 월별 수납이 아니라 계약 단위 사실이다.
// 퇴실 정산 때 "돌려줘야 하나 / 얼마 돌려주나 / 청소비 얼마인가"를 판단할 수 있어야 한다(운영자 요건 2026-08-02).
// 종전에는 조회월이 결제일의 달과 다르면 보증금이 화면에서 통째로 사라졌다.
//
// 두 화면이 이 파일 하나를 쓴다. 지금까지 갈렸던 이유가 각자 손으로 그렸기 때문이라, 그게 재발 방지다.
import { useCallback, useEffect, useState, useTransition } from 'react'
import { fmtWon } from '@/lib/fmtMoney'
import { fmtDateDot } from '@/lib/fmtDate'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { DatePicker } from '@/components/ui/DatePicker'
import { Btn } from '@/components/ui/Btn'
import { RowActionBtn } from '@/components/ui/RowActionBtn'
import { Badge } from '@/components/ui/Badge'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { withSave, pushToast } from '@/lib/saveStatus'
import { getDepositPaymentsByLease, updatePayment, deletePayment, restorePayment } from '@/app/(app)/rooms/actions'
import { getDepositRefundForLease, undoDepositReturn, getCleaningFeeReceivedForLease } from '@/app/(app)/tenants/actions'
import { cleaningFeeDeductible } from '@/lib/depositWithholdReasons'

type Rec = Awaited<ReturnType<typeof getDepositPaymentsByLease>>['records'][number]
type Refund = Awaited<ReturnType<typeof getDepositRefundForLease>>

const PAY_METHODS = ['계좌이체', '현금', '신용카드', '결제선생', '기타']
const ymd = (d: Date | string) => new Date(d).toISOString().slice(0, 10)

export function DepositStatusPanel({
  leaseTermId, status, depositAmount, cleaningFee, reservationDepositMode, reloadSignal, onChanged,
}: {
  leaseTermId: string
  status: string | null
  depositAmount: number
  cleaningFee: number
  reservationDepositMode?: string | null
  reloadSignal?: number
  onChanged?: () => void
}) {
  const [data, setData] = useState<{ records: Rec[]; paidTotal: number; preAcquisition: boolean } | null>(null)
  const [refund, setRefund] = useState<Refund>(null)
  const [cleaningPaid, setCleaningPaid] = useState(0)
  const [open, setOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editAmount, setEditAmount] = useState(0)
  const [editDate, setEditDate] = useState('')
  const [editMethod, setEditMethod] = useState('')
  const [pending, startTransition] = useTransition()

  const load = useCallback(async () => {
    // 두 값을 한 틱에 커밋한다. 순차로 넣으면 첫 페인트에 공제 전 숫자가 스쳤다가 바뀐다(로딩 점프).
    const [d, paidCleaning] = await Promise.all([
      getDepositPaymentsByLease(leaseTermId),
      cleaningFee > 0 ? getCleaningFeeReceivedForLease(leaseTermId) : Promise.resolve(0),
    ])
    setData(d)
    setCleaningPaid(paidCleaning)
    // 퇴실·취소 계약만 환불 기록을 묻는다(그 외에는 있을 수 없어 왕복이 낭비다)
    if (status === 'CHECKED_OUT' || status === 'CANCELLED') setRefund(await getDepositRefundForLease(leaseTermId))
  }, [leaseTermId, status, cleaningFee])

  useEffect(() => { void load() }, [load, reloadSignal])

  if (!data) return <SkeletonRows rows={2} className="py-1" />

  const paid = data.paidTotal
  // 예약금을 '이용료 선납'이나 '없음'으로 받는 계약은 보증금 개념이 없다. 단 record 가 있으면 숨기지 않는다 —
  // PaymentRecordList 가 보증금 행의 편집을 이 패널로 넘겼기 때문에, 여기서 숨기면 어디서도 못 고치게 된다.
  if (status === 'RESERVED' && (reservationDepositMode === 'prepaid' || reservationDepositMode === 'none') && paid === 0) return null
  // 받은 것도 없고 계약도 없고 환불 기록도 없으면 보여줄 사실이 없다
  if (paid === 0 && depositAmount === 0 && !refund) return null

  const settled = !!refund
  const exited = status === 'CHECKED_OUT' || status === 'CANCELLED'
  // 아직 받을 단계가 아닌 계약 — 투어 대기·투어 완료. 받은 게 없는 게 정상이라 '미수납' 경고는 거짓이다.
  const notYet = status === 'WAITING_TOUR' || status === 'TOUR_DONE'
  // 인수 전 입주자는 이 앱에 영수 기록이 없는 게 정상이다(실측 10건 중 9건). 책임 금액은 계약 보증금(승계분)이다.
  const carriedOver = data.preAcquisition && paid === 0 && depositAmount > 0
  const refundBase = carriedOver ? depositAmount : paid
  // 환불 예상은 표시 전용이며 어떤 저장·집계에도 흘러가지 않는다. 확정은 퇴실 처리 폼이 한다.
  // 다만 판정은 돈이 움직이는 3경로와 같아야 한다 — 입실 때 청소비를 따로 받았으면 공제 0(계약서 §2-4).
  const effectiveFee = cleaningFeeDeductible(cleaningFee, cleaningPaid)
  const expectedRefund = Math.max(0, refundBase - effectiveFee)
  const shortfall = depositAmount > 0 ? depositAmount - paid : 0
  // 청소비가 보증금 안의 몫인 계약(운영자 확정 2026-08-10): 입실 때 받은 청소비가 계약 보증금의
  // 일부를 채운다. 현금만 세면 그 몫이 '부족'으로 보인다(520호 — 현금 3만 정정이 부족 2만으로 표시,
  // 청소비 2만이 화면 어디에도 연결되지 않았다). 별도 수령 영업장도 있으므로 조용히 흡수하지 않는다 —
  // 배지는 채워진 만큼만 완납으로 판정하되 아래 표시줄이 현금·청소비 구성을 병기한다.
  const coveredByCleaning = Math.min(Math.max(0, shortfall), cleaningPaid)
  const effectiveShortfall = shortfall - coveredByCleaning
  // 계약 보증금이 비어 있으면 환불 여부 판정 자체가 불가능하다. 환불 경고보다 이게 먼저다.
  const noContractAmount = depositAmount === 0 && paid > 0 && !settled
  // 퇴실했는데 환불 기록이 없는 상태 — 운영자 요건 "돌려줘야 하는지"의 정답 자리라 초록으로 덮으면 안 된다
  const unsettledExit = exited && !settled && !noContractAmount && refundBase > 0

  // 순서가 곧 우선순위다. 위에서 걸리면 아래는 안 본다.
  //   판정 불가(계약액 미입력)  >  받을 단계 아님  >  환불 미처리  >  인수 승계  >  수납 상태
  // 종전에는 '환불 미처리'가 '계약액 미입력'과 '인수 승계'를 덮어, 한 패널이 세 가지 말을 동시에 했다.
  const badge: { tone: 'pale-green' | 'pale-amber' | 'pale-blue' | 'pale-neutral'; label: string } =
    settled && refund ? (
      refund.returned > 0 && refund.withheld > 0 ? { tone: 'pale-green' as const, label: '일부 환불' }
      : refund.returned === 0 && refund.withheld > 0 ? { tone: 'pale-green' as const, label: '환불 안 함' }
      : refund.returned === 0 && refund.withheld === 0 ? { tone: 'pale-neutral' as const, label: '정산 없음' }
      : { tone: 'pale-green' as const, label: '환불 완료' }
    )
    : noContractAmount ? { tone: 'pale-neutral', label: '계약액 미입력' }
    : paid === 0 && notYet ? { tone: 'pale-neutral', label: '수납 전' }
    : paid === 0 && status === 'CANCELLED' ? { tone: 'pale-neutral', label: '수납 없음' }
    : unsettledExit ? { tone: 'pale-amber', label: carriedOver ? '인수 승계 · 환불 미처리' : '환불 미처리' }
    : carriedOver ? { tone: 'pale-blue', label: '인수 승계' }
    : effectiveShortfall <= 0 ? { tone: 'pale-green', label: '수납 완료' }
    : paid === 0 && coveredByCleaning === 0 ? { tone: 'pale-amber', label: '미수납' }
    : { tone: 'pale-amber', label: `부족 ${fmtWon(effectiveShortfall)}` }

  const startEdit = (r: Rec) => {
    setEditId(r.id); setEditAmount(r.actualAmount); setEditDate(ymd(r.payDate)); setEditMethod(r.payMethod ?? '')
  }
  const saveEdit = () => {
    if (!editId) return
    startTransition(async () => {
      const res = await withSave(
        () => updatePayment(editId, { actualAmount: editAmount, payDate: editDate, payMethod: editMethod }),
        { success: '보증금 수납 수정됨' },
      )
      if (!res.ok) return   // withSave 가 이미 error 토스트를 쏜다(이중 통지 금지)
      setEditId(null); await load(); onChanged?.()
    })
  }
  const remove = async (r: Rec) => {
    if (!(await confirmDialog({
      title: `보증금 수납 ${r.actualAmount.toLocaleString()}원을 삭제할까요?`,
      message: '보증금 잔액이 그만큼 줄어듭니다. 환불 정산에도 그대로 반영됩니다.\n삭제 직후 뜨는 적용취소로 되살릴 수 있습니다.',
      level: 'caution', confirmLabel: '삭제',
    }))) return
    startTransition(async () => {
      const res = await withSave(() => deletePayment(r.id), { success: '' })
      if (!res.ok) return
      pushToast('success', '보증금 수납 삭제됨', {
        action: { label: '적용취소', run: () => { void restorePayment(r.id).then(x => { if (x.ok) { void load(); onChanged?.() } else pushToast('error', x.error) }) } },
      })
      await load(); onChanged?.()
    })
  }

  const undoRefund = async (r: NonNullable<Refund>) => {
    const mon = `${Number(r.date.slice(0, 4))}년 ${Number(r.date.slice(5, 7))}월`
    if (!(await confirmDialog({
      title: '환불 기록을 적용취소할까요?',
      message: r.withheld > 0
        ? `미환불 ${fmtWon(r.withheld)}으로 잡힌 부가수익도 함께 사라집니다.\n${mon} 매출이 그만큼 줄어듭니다. 퇴실 상태는 그대로 유지됩니다.`
        : '환불 기록만 지웁니다. 퇴실 상태는 그대로 유지됩니다.',
      level: 'caution', confirmLabel: '적용취소',
    }))) return
    startTransition(async () => {
      const res = await withSave(() => undoDepositReturn(r.refundId, r.extraIncomeId), { success: '환불 기록을 지웠습니다' })
      if (!res.ok) return
      setRefund(null); await load(); onChanged?.()
    })
  }

  const inputCls = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]'

  return (
    <div className="rounded-xl border border-[var(--warm-border)] bg-[var(--cream)] px-3 py-2.5 space-y-1.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <p className="text-xs font-semibold text-[var(--deposit-fg)]">보증금</p>
        <Badge tone={badge.tone} size="sm">{badge.label}</Badge>
        {/* 예약 단계라는 맥락은 라벨을 바꾸지 말고 메타 칩으로. 받은 돈은 그대로 보증금이지 '대체'가 아니다. */}
        {status === 'RESERVED' && (
          <span className="text-[0.65625rem] rounded-full px-1.5 py-0.5 bg-[var(--canvas)] text-[var(--warm-muted)] ring-1 ring-[var(--warm-border)]">예약금으로 수납</span>
        )}
      </div>

      <p className="text-sm text-[var(--warm-dark)]">
        <span className="text-[var(--warm-muted)] text-xs">받은 보증금 </span>
        <span className="font-semibold num">{fmtWon(paid)}</span>
        {/* 청소비가 보증금 몫을 채운 계약은 구성을 병기한다 — 현금만 보이면 '어디에도 기록이 없다'로 읽힌다. */}
        {coveredByCleaning > 0 && <span className="text-xs text-[var(--warm-mid)]"> + 청소비 {fmtWon(coveredByCleaning)}</span>}
        {depositAmount > 0 && <span className="text-[var(--warm-muted)] text-xs"> / 계약 {fmtWon(depositAmount)}</span>}
      </p>

      {/* 이 블록만 스코프가 다르다. 못박지 않으면 이번 달 수납으로 읽힌다.
          문구는 rent-receipts 의 정본과 같은 한 문장 — 두 문장은 반폭에서 접힌다(디자이너 패스). */}
      <p className="text-[0.65625rem] text-[var(--warm-muted)] break-keep">보증금은 월과 무관합니다.</p>

      {carriedOver && !settled && (
        <p className="text-[0.65625rem] text-[var(--warm-mid)] break-keep">
          인수 전 입주라 이 앱에 영수 기록이 없습니다. 계약 보증금은 인수 시 승계된 금액입니다.
        </p>
      )}

      {noContractAmount && (
        <p className="text-[0.65625rem] text-[var(--warm-mid)] break-keep">
          {exited
            ? '계약 보증금을 입력해야 환불 여부를 판정할 수 있습니다. 고객 정보 수정에서 입력해 주세요.'
            : '계약 보증금이 입력되지 않아 완납 여부를 판정하지 못합니다. 고객 정보 수정에서 입력해 주세요.'}
        </p>
      )}

      {settled && refund && (
        <p className="text-xs text-[var(--warm-dark)] break-keep">
          환불 <span className="font-semibold num">{fmtWon(refund.returned)}</span>
          {refund.withheld > 0 && <span className="text-[var(--warm-muted)]"> · 미환불 {fmtWon(refund.withheld)}{refund.reason ? ` (${refund.reason})` : ''}</span>}
          <span className="text-[0.65625rem] text-[var(--warm-muted)]"> · {refund.date.replaceAll('-', '.')} 처리</span>
        </p>
      )}
      {/* §16 상시 적용취소 진입점 — 토스트는 사라지고, 이 패널이 정본이 되었으니 여기가 '원위치'다. */}
      {settled && refund && (
        <Btn variant="subtle" size="sm" disabled={pending} onClick={() => { void undoRefund(refund) }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
          적용취소
        </Btn>
      )}
      {unsettledExit && (
        <p className="text-xs text-[var(--warning-fg)] break-keep">퇴실했으나 환불 처리가 기록되지 않았습니다.</p>
      )}

      {/* 퇴실 시 환불 예상 — 굵기를 올리지 않는다. 확정액이 아니라 예상이고, 실제 환불은 이용료 정산까지 얽힌다.
          근거는 항상 병기한다. 청소비가 0이면 괄호가 사라져 "받은 0원인데 30만원 환불"로 읽히던 구멍이 있었다. */}
      {!settled && refundBase > 0 && (
        <p className="text-xs text-[var(--warm-dark)] break-keep">
          {exited ? '환불 예정액 ' : '퇴실 시 환불 예상 '}<span className="num">{fmtWon(expectedRefund)}</span>
          {/* 근거는 값이 달라질 때만 병기한다. 무조건 붙이면 바로 위 '받은 보증금'과 같은 숫자를 두 번 말한다. */}
          {(carriedOver || effectiveFee > 0) && (
            <span className="text-[0.65625rem] text-[var(--warm-muted)]">
              {' ('}{carriedOver ? '계약 보증금' : '받은 보증금'} {fmtWon(refundBase)}
              {effectiveFee > 0 && <> − 청소비 {fmtWon(effectiveFee)}</>}
              {carriedOver && ' 기준, 인수 승계'}{')'}
            </span>
          )}
          {status === 'CHECKOUT_PENDING' && <span className="block text-[0.65625rem] text-[var(--warm-muted)]">퇴실 처리에서 최종 확정합니다.</span>}
        </p>
      )}
      {/* 왜 청소비를 안 뺐는지 — 계약에 청소비가 적혀 있는데 예상액에서 사라지면 누락으로 읽힌다.
          기본 문구는 퇴실 처리 폼의 정본과 같은 한 문장. 청소비가 보증금 몫을 채운 계약(coveredByCleaning)만
          구성 설명으로 분기한다 — 같은 문장으로는 '보증금 어디에도 청소비가 없다'는 혼란을 못 푼다(2026-08-10). */}
      {!settled && refundBase > 0 && cleaningFee > 0 && cleaningPaid > 0 && (
        <p className="text-[0.65625rem] text-[var(--warm-muted)] break-keep">
          {coveredByCleaning > 0
            ? `입실 때 받은 청소비 ${fmtWon(cleaningPaid)}이 계약 보증금의 일부를 채웁니다. 환불 예상은 현금으로 받은 몫 기준이며 청소비는 다시 공제하지 않습니다.`
            : `청소비 ${fmtWon(cleaningPaid)}은 입실 때 이미 받아 공제하지 않습니다.`}
        </p>
      )}

      {data.records.length > 0 && (
        <div className="pt-0.5">
          <button type="button" onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            className="flex items-center gap-1 text-[0.65625rem] font-medium text-[var(--deposit-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--coral)] rounded-sm">
            받은 내역 {data.records.length}건
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          {open && (
            <ul className="mt-1.5 space-y-1.5">
              {data.records.map(r => editId === r.id ? (
                <li key={r.id} className="rounded-lg bg-[var(--canvas)] border border-[var(--coral)] px-2.5 py-2 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <p className="text-[0.65625rem] text-[var(--warm-muted)]">금액</p>
                      <input type="text" inputMode="numeric" value={editAmount.toLocaleString()}
                        onChange={e => setEditAmount(Number(e.target.value.replace(/[^0-9]/g, '')))} className={inputCls} />
                    </div>
                    <div className="space-y-1">
                      <p className="text-[0.65625rem] text-[var(--warm-muted)]">납부일</p>
                      <DatePicker value={editDate} onChange={setEditDate}
                        className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)]" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    {/* 자유 입력 금지 — '카드' 등 변형 표기가 카드 수납 합계에서 누락된다(형제와 동일 select) */}
                    <p className="text-[0.65625rem] text-[var(--warm-muted)]">납부방법</p>
                    <select value={editMethod} onChange={e => setEditMethod(e.target.value)} className={inputCls}>
                      {editMethod && !PAY_METHODS.includes(editMethod) && <option value={editMethod}>{editMethod}</option>}
                      {PAY_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Btn variant="secondary" size="sm" onClick={() => setEditId(null)}>취소</Btn>
                    <Btn variant="primary" size="sm" onClick={saveEdit} disabled={pending}>저장</Btn>
                  </div>
                </li>
              ) : (
                <li key={r.id} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--deposit-bg)] border border-[var(--deposit-ring)] px-2.5 py-1.5">
                  <p className="text-[0.65625rem] text-[var(--warm-mid)] min-w-0">
                    <span className="num">{fmtDateDot(r.payDate)}</span>
                    {r.payMethod && <span className="text-[var(--warm-muted)]"> · {r.payMethod}</span>}
                    {r.cashReceiptIssuedAt && <span className="ml-1 font-semibold bg-[var(--success-bg)] text-[var(--success-fg)] rounded px-1 py-0.5 whitespace-nowrap">현금영수증</span>}
                  </p>
                  <span className="flex items-center gap-1.5 shrink-0">
                    <span className="text-xs font-semibold num text-[var(--warm-dark)]">{fmtWon(r.actualAmount)}</span>
                    <RowActionBtn tone="deposit" onClick={() => startEdit(r)}>수정</RowActionBtn>
                    <RowActionBtn tone="danger" onClick={() => { void remove(r) }} disabled={pending}>삭제</RowActionBtn>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
