'use client'

// 수납 내역 — 표시 + 편집 + 삭제. 자체 fetch (getPaymentsByLease).
// scope='window' 면 최근 3개월(입금일·귀속월 합집합)을 그리고, 편집은 조회월 귀속 행에만 붙인다.
// 편집 가능 항목: 금액·납부일·납부방법·메모·귀속월. 보증금 record 는 귀속월 변경 불가.
// 양도인 record 는 양도인 색 표시.

import { useEffect, useState, useTransition } from 'react'
import { CARD_LIKE_METHODS, MANUAL_PAY_METHODS } from '@/lib/paymentMethods'
import { fmtDateDot as fmtDate, fmtMD } from '@/lib/fmtDate'
import { fmtWon } from '@/lib/fmtMoney'
import { SkeletonRows } from '@/components/ui/Skeleton'
import {
  getPaymentsByLease, getTargetMonthOptions, updatePayment, deletePayment, restorePayment, setCashReceiptIssued,
} from '@/app/(app)/rooms/actions'
import { DatePicker } from '@/components/ui/DatePicker'
import { Btn } from '@/components/ui/Btn'
import { RowActionBtn } from '@/components/ui/RowActionBtn'
import { kstYmdStr } from '@/lib/kstDate'
import { defaultCashReceiptIssuedYmd } from '@/lib/cashReceipt'
import { withSave, trackSave, pushToast } from '@/lib/saveStatus'
import { confirmDeletePayment } from '@/lib/paymentConfirm'

type Record = Awaited<ReturnType<typeof getPaymentsByLease>>['records'][number]

/**
 * 발행일이 입금일과 **다를 때만** 그 날짜를 덧붙인다(2026-08-24 축 재판정).
 *
 * 합계가 발행일의 달로 잡히므로 지연 발행이면 이 행이 어느 달 합계에 들어갔는지 화면에서
 * 읽혀야 한다. 같은 날이면 굳이 안 적는다 — 그 경우가 대부분이고, 매번 적으면 이미 줄 하나에
 * 배지가 넷인 자리에 뜻 없는 숫자가 하나 더 는다.
 * 원터치 토글이 오늘로 켠 값이 실제와 다르면 여기서 눈에 걸리고, 고치는 자리는 이 행의 수정 폼이다.
 */
function crIssuedLabel(p: Record): string {
  if (!p.cashReceiptIssuedAt) return ''
  const issued = kstYmdStr(new Date(p.cashReceiptIssuedAt))
  return issued === kstYmdStr(new Date(p.payDate)) ? '' : ` ${fmtMD(p.cashReceiptIssuedAt)} 발행`
}
type TmOption = Awaited<ReturnType<typeof getTargetMonthOptions>>[number]


export function PaymentRecordList({ leaseTermId, targetMonth, canEdit, onChange, reloadSignal, scope = 'month', cashReceiptOnly = false }: {
  leaseTermId: string
  targetMonth: string
  canEdit: boolean
  /** 'month'=조회월 입금분(기존) · 'window'=최근 3개월(입금일·귀속월 합집합, 신고 2c6de978). */
  scope?: 'month' | 'window'
  /** 수정·삭제는 막되 현금영수증 원터치만 허용 — 요약 화면용(신고 c0936f89 기능 유지). */
  cashReceiptOnly?: boolean
  /** 편집·삭제 후 부모가 settlement 재조회. */
  onChange?: () => void
  /** 부모(PaymentBody)에서 수납 등록 등으로 값이 바뀌면 증가 → 리스트 재fetch 트리거. */
  reloadSignal?: number
}) {
  const [records, setRecords] = useState<Record[] | null>(null)
  const [acqDate, setAcqDate] = useState<Date | null>(null)
  const [tmOptions, setTmOptions] = useState<TmOption[]>([])
  const [pending, startTransition] = useTransition()

  // 편집 모드 state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editAmount, setEditAmount]       = useState<number>(0)
  const [editDate, setEditDate]           = useState<string>('')
  const [editPayMethod, setEditPayMethod] = useState<string>('')
  const [editMemo, setEditMemo]           = useState<string>('')
  const [editTargetMonth, setEditTargetMonth] = useState<string>('')
  const [editCashReceipt, setEditCashReceipt] = useState(false)   // 현금영수증 발행 표시(오류신고 2bd8befa)
  // 발행일 — **원터치 토글로 켠 뒤 고치는 자리가 여기다**(운영자 확정 2026-08-24, 신고 8b9b6c43).
  // 토글은 한 번 눌러 켜는 자리라 날짜를 물으면 편의가 죽는다. 그래서 토글은 오늘로 켜고,
  // 실제 발행일이 달랐으면 이 수정 폼에서 고친다 — 새 인터랙션을 만들지 않고 기존 문법을 쓴다.
  const [editCashReceiptDate, setEditCashReceiptDate] = useState<string>('')

  const reload = async () => {
    const { records, windowRecords, acquisitionDate } = await getPaymentsByLease(leaseTermId, targetMonth)
    // 청구 조정 전표(단기 연장·감액 마커)는 편집·삭제 대상이 아니다 — 목록에서 제외(회차 번호도 세지 않음).
    // 조회가 payDate 월 기준이라 전표는 입주월이 아닌 달에도 섞여 들어온다(마커 payDate=조작 시각).
    // window 는 서버가 전표·보증금을 이미 걸러 내려보낸다(보증금 정본은 DepositStatusPanel).
    setRecords(scope === 'window' ? windowRecords : records.filter(r => !r.isBillingAdjust))
    setAcqDate(acquisitionDate ? new Date(acquisitionDate) : null)
  }
  useEffect(() => { reload() /* eslint-disable-next-line */ }, [leaseTermId, targetMonth, reloadSignal, scope])

  const isPreAcq = (p: Record) => !!(acqDate && new Date(p.payDate) < acqDate)

  const startEdit = (p: Record) => {
    setEditingId(p.id)
    setEditAmount(p.actualAmount)
    setEditDate(kstYmdStr(new Date(p.payDate)))
    setEditPayMethod(p.payMethod ?? '')
    setEditMemo(p.memo ?? '')
    setEditTargetMonth(p.targetMonth)
    setEditCashReceipt(!!p.cashReceiptIssuedAt)
    // 저장된 발행 시각이 있으면 그것이 사실이다 — 기본값 규칙으로 덮지 않는다.
    // 없으면(여기서 처음 켜는 경우) 정본 기본값 — 카드는 이 건의 수납일, 그 외는 오늘.
    setEditCashReceiptDate(p.cashReceiptIssuedAt
      ? kstYmdStr(new Date(p.cashReceiptIssuedAt))
      : defaultCashReceiptIssuedYmd({ payMethod: p.payMethod, payYmd: kstYmdStr(new Date(p.payDate)) }))
    if (!p.isDeposit) {
      getTargetMonthOptions(leaseTermId, targetMonth).then(setTmOptions).catch(() => {})
    }
  }

  const handleSaveEdit = () => {
    if (!editingId) return
    startTransition(async () => {
      const res = await withSave(() => updatePayment(editingId, {
        actualAmount: editAmount,
        payDate:      editDate,
        payMethod:    editPayMethod,
        memo:         editMemo || undefined,
        targetMonth:  editTargetMonth || undefined,
        cashReceiptIssued: editCashReceipt,
        cashReceiptIssuedDate: editCashReceiptDate,
      }), { success: '수납 기록 수정됨' })
      if (!res.ok) return
      await reload()
      setEditingId(null)
      onChange?.()
    })
  }

  const handleDelete = async (p: Record) => {
    if (!(await confirmDeletePayment(p))) return
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await deletePayment(p.id)
        if (!res.ok) { pushToast('error', res.error); return }
        pushToast('success', '수납 기록 삭제됨', {
          action: { label: '적용취소', run: () => { void restorePayment(p.id).then(r => { if (r.ok) { reload(); onChange?.() } else pushToast('error', r.error) }) } },
        })
        await reload()
        onChange?.()
      } catch (err) {
        pushToast('error', (err as Error).message ?? '삭제 실패')
      } finally { release() }
    })
  }

  // 현금영수증 원터치 토글 — 수정 폼에 들어가지 않고 발행 표시(오류신고 c0936f89). 적용취소는 원래 시각 복원.
  const handleToggleCashReceipt = (p: Record) => {
    startTransition(async () => {
      const next = !p.cashReceiptIssuedAt
      const res = await setCashReceiptIssued(p.id, next)
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', next ? '현금영수증 발행으로 표시했습니다' : '현금영수증 발행 표시를 해제했습니다', {
        action: { label: '적용취소', run: () => { void setCashReceiptIssued(p.id, res.prevIssuedAt != null, res.prevIssuedAt).then(r => {
          if (r.ok) { reload(); onChange?.() } else pushToast('error', r.error)
        }).catch(() => pushToast('error', '되돌리기 중 통신 오류가 발생했습니다')) } },
      })
      await reload()
      onChange?.()
    })
  }

  if (records === null) return <SkeletonRows rows={2} className="py-1" />
  if (records.length === 0) return <p className="text-xs text-[var(--warm-muted)] py-2">{scope === 'window' ? '최근 3개월 수납 기록이 없습니다.' : '이 달 수납 기록이 없습니다.'}</p>

  return (
    <div className="space-y-1.5">
      {records.map((p, idx) => {
        const prevOwner = !p.isDeposit && (isPreAcq(p) || p.isPrevOwner)
        // 화면에 표시되는 "회차"는 viewMonth 안에서 payDate 시간 순. records가 이미 payDate asc 정렬돼 옴.
        // DB seqNo는 귀속월 별로 매겨져서 사용자가 보는 시간 순서와 안 맞을 수 있음 (사용자 피드백 2026-05-31).
        const displaySeq = idx + 1
        if (editingId === p.id) {
          return (
            <div key={p.id} className="rounded-xl border border-[var(--coral)] bg-[var(--cream-soft)] px-3 py-2.5 space-y-2">
              <div className="space-y-2">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-[var(--warm-mid)]">금액</p>
                  <input type="text" inputMode="numeric" value={editAmount.toLocaleString()}
                    onChange={e => setEditAmount(Number(e.target.value.replace(/[^0-9]/g, '')))}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-2 text-sm text-[var(--warm-dark)] min-h-[var(--input-h-touch)] sm:min-h-[var(--input-h)] outline-none focus-visible:border-[var(--tc-text)] focus-visible:shadow-[var(--input-ring-focus)] transition-colors" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-[var(--warm-mid)]">납부일</p>
                  <DatePicker value={editDate} onChange={setEditDate}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-2 text-sm text-[var(--warm-dark)] min-h-[var(--input-h-touch)] sm:min-h-[var(--input-h)] outline-none focus-visible:border-[var(--tc-text)] focus-visible:shadow-[var(--input-ring-focus)] transition-colors" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-[var(--warm-mid)]">납부방법</p>
                  <select value={editPayMethod} onChange={e => setEditPayMethod(e.target.value)}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-2 text-sm text-[var(--warm-dark)] min-h-[var(--input-h-touch)] sm:min-h-[var(--input-h)] outline-none focus-visible:border-[var(--tc-text)] focus-visible:shadow-[var(--input-ring-focus)] transition-colors">
                    {/* 옵션은 정본 하나에서 온다 — 손으로 적으면 자리마다 갈린다(lib/paymentMethods). */}
                    {editPayMethod && !MANUAL_PAY_METHODS.includes(editPayMethod) && (
                      <option value={editPayMethod}>{editPayMethod}</option>
                    )}
                    {MANUAL_PAY_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-[var(--warm-mid)]">메모</p>
                  <input type="text" value={editMemo} onChange={e => setEditMemo(e.target.value)}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-2 text-sm text-[var(--warm-dark)] min-h-[var(--input-h-touch)] sm:min-h-[var(--input-h)] outline-none focus-visible:border-[var(--tc-text)] focus-visible:shadow-[var(--input-ring-focus)] transition-colors" />
                </div>
              </div>
              {!p.isDeposit && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-[var(--warm-mid)]">귀속월 (이 수납이 잡히는 달)</p>
                  <select value={editTargetMonth} onChange={e => setEditTargetMonth(e.target.value)}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-2 text-sm text-[var(--warm-dark)] min-h-[var(--input-h-touch)] sm:min-h-[var(--input-h)] outline-none focus-visible:border-[var(--tc-text)] focus-visible:shadow-[var(--input-ring-focus)] transition-colors">
                    {!tmOptions.some(o => o.month === p.targetMonth) && (
                      <option value={p.targetMonth}>
                        {Number(p.targetMonth.split('-')[0])}년 {Number(p.targetMonth.split('-')[1])}월분 (현재)
                      </option>
                    )}
                    {tmOptions.map(o => {
                      const [y, m] = o.month.split('-')
                      const tag = o.status === 'paid' ? '완납'
                        : o.status === 'partial' ? `일부 ${o.paidAmount.toLocaleString()}/${fmtWon(o.expectedAmount)}`
                        : o.status === 'future' ? '향후' : '미수'
                      return <option key={o.month} value={o.month}>{Number(y)}년 {Number(m)}월분 · {tag}</option>
                    })}
                  </select>
                </div>
              )}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={editCashReceipt} onChange={e => setEditCashReceipt(e.target.checked)}
                  className="w-3.5 h-3.5 accent-[var(--coral)]" />
                <span className="text-[0.65625rem] text-[var(--warm-dark)]">현금영수증 발행함</span>
              </label>
              {/* 발행일 — 체크했을 때만 선다. 껍데기는 이 폼의 형제 칸('납부일')과 같은 것을 넘긴다
                  (§12 한 폼 안 입력 높이 혼용 금지). pl-6 은 체크박스의 하위 항목이라는 표시다.
                  미래는 maxDate 로 막고 과거는 안 막는다 — 누락분을 나중에 올리는 것이 정상 업무다. */}
              {editCashReceipt && (
                <div className="space-y-1 pl-6">
                  <p className="text-xs font-medium text-[var(--warm-mid)]">발행일</p>
                  <DatePicker value={editCashReceiptDate} onChange={setEditCashReceiptDate} maxDate={kstYmdStr()}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-2 text-sm text-[var(--warm-dark)] min-h-[var(--input-h-touch)] sm:min-h-[var(--input-h)] outline-none focus-visible:border-[var(--tc-text)] focus-visible:shadow-[var(--input-ring-focus)] transition-colors" />
                </div>
              )}
              <div className="flex gap-2 justify-end">
                <Btn variant="secondary" size="sm" onClick={() => setEditingId(null)}>취소</Btn>
                <Btn variant="primary" size="sm" onClick={handleSaveEdit} disabled={pending}>저장</Btn>
              </div>
            </div>
          )
        }
        return (
          <div key={p.id}
            className={`rounded-sm px-3 py-2.5 space-y-1.5 ${
              p.isDeposit ? 'bg-[var(--deposit-bg)] border border-[var(--deposit-ring)]' :
              prevOwner ? 'bg-[var(--info-bg)] border border-[var(--info-ring)]' : 'bg-[var(--canvas)]'
            }`}>
            {/* 줄1: 회차·날짜·방법 + 금액(우측, 안 줄임) */}
            <div className="flex items-baseline justify-between gap-2">
              <p className={`text-xs ${p.isDeposit ? 'text-[var(--deposit-fg)]' : prevOwner ? 'text-[var(--info-fg)]' : 'text-[var(--warm-mid)]'}`}>
                {scope === 'month' && `${displaySeq}회차 · `}{fmtDate(p.payDate)} · {p.payMethod ?? '—'}
              </p>
              <span className={`text-sm font-semibold whitespace-nowrap ${p.isDeposit ? 'text-[var(--deposit-fg)]' : prevOwner ? 'text-[var(--info-fg)]' : 'text-[var(--warm-dark)]'}`}>
                {fmtWon(p.actualAmount)}
              </span>
            </div>
            {/* 줄2: 뱃지들 + 메모 + 액션 버튼 */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1 flex-wrap">
                {p.isDeposit && <span className="text-[0.65625rem] font-semibold bg-[var(--deposit-bg)] text-[var(--deposit-fg)] rounded px-1.5 py-0.5">보증금</span>}
                {prevOwner && <span className="text-[0.65625rem] font-semibold bg-[var(--info-bg)] text-[var(--info-fg)] rounded px-1.5 py-0.5">양도인</span>}
                {!p.isDeposit && (() => {
                  // 배지 기준은 '낸 달과 귀속월이 다른가'다. '조회월과 다른가' 로 두면 3개월 창에서
                  // 108건 중 102건이 켜져 배지가 기본값이 된다(실측). 이 기준이면 16%만 켜진다.
                  // '(지난 미납분)·(선납)' 상대어는 버렸다 — 조회월 기준 표현이라 3개월 창에서 뜻이 흔들린다.
                  const paidMonth = new Date(p.payDate).toISOString().slice(0, 7)
                  const late = paidMonth > p.targetMonth
                  const prepay = paidMonth < p.targetMonth
                  const mon = Number(p.targetMonth.slice(5))
                  // 어휘·색은 홈 정산 목록 정본을 따른다(dashboard/page.tsx). 지연은 warning, 선납은 info.
                  // 정반대 두 사실에 같은 색을 주면 안 되고, 이미 받은 돈에 예정색(await)을 쓰면 §03 위반이다.
                  return (
                    <span className={`text-[0.65625rem] font-semibold rounded px-1.5 py-0.5 whitespace-nowrap ${
                      late ? 'bg-[var(--warning-bg)] text-[var(--warning-fg)]'
                      : prepay ? 'bg-[var(--info-bg)] text-[var(--info-fg)]'
                      : 'bg-[var(--cream-2)] text-[var(--warm-mid)]'
                    }`}>
                      {mon}월분{late ? ' 지연' : prepay ? ' 선납' : ''}
                    </span>
                  )
                })()}
                {/* 현금영수증 — 편집 가능하면 원터치 체크박스, 아니면 발행 시에만 배지.
                    배지 모양 버튼이라 눌리는 걸 몰랐던 문제(신고 241c02ea)로 수납 폼 체크박스 정본 문법으로 교체.
                    즉시 저장 + 적용취소 토스트 동작 유지, 히트영역 44px(-my-2 확장 문법). */}
                {/* 카드 계열은 매출전표가 증빙이라 현금영수증 대상이 아니다. 집계에서도 빠지는데
                    화면에만 칩이 뜨면 발행했다고 오인한다(수납 폼은 원래부터 감춘다). */}
                {p.payMethod && CARD_LIKE_METHODS.includes(p.payMethod) ? (
                  <span className="text-[0.65625rem] text-[var(--warm-muted)] whitespace-nowrap">카드 결제 · 매출전표</span>
                ) : canEdit ? (
                  <label className={`inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap -my-2 min-h-[44px] ${pending ? 'opacity-50 pointer-events-none' : ''}`}>
                    <input type="checkbox" checked={!!p.cashReceiptIssuedAt} disabled={pending} onChange={() => handleToggleCashReceipt(p)}
                      className="w-3.5 h-3.5 accent-[var(--coral)]" />
                    <span className={`text-[0.65625rem] font-semibold ${p.cashReceiptIssuedAt ? 'text-[var(--success-fg)]' : 'text-[var(--warm-muted)]'}`}>
                      {p.cashReceiptIssuedAt ? `현금영수증${crIssuedLabel(p)}` : '현금영수증 미발행'}
                    </span>
                  </label>
                ) : (
                  p.cashReceiptIssuedAt && <span className="text-[0.65625rem] font-semibold bg-[var(--success-bg)] text-[var(--success-fg)] rounded px-1.5 py-0.5 whitespace-nowrap">현금영수증{crIssuedLabel(p)}</span>
                )}
                {p.memo && !p.isDeposit && <span className="text-[0.6875rem] text-[var(--coral)]">· {p.memo}</span>}
              </div>
              {/* 보증금은 위 보증금 패널에서 관리한다. 여기에도 버튼을 두면 같은 record 에 편집 경로가 둘이 된다. */}
              {canEdit && p.isDeposit && (
                <span className="text-[0.65625rem] text-[var(--warm-muted)]">보증금은 맨 위 보증금 항목에서 수정합니다.</span>
              )}
              {/* 편집 접점은 그 record 의 귀속월 화면 하나다. 창을 넓혔다고 편집까지 넓히면
                  지난달 매출이 어디서든 바뀔 수 있게 된다(영향 월 고지가 아직 없다). */}
              {canEdit && !cashReceiptOnly && !p.isDeposit && p.targetMonth !== targetMonth && (
                <span className="text-[0.65625rem] text-[var(--warm-muted)]">위 조회 월을 {Number(p.targetMonth.slice(5))}월로 바꾸면 수정할 수 있습니다.</span>
              )}
              {canEdit && !cashReceiptOnly && !p.isDeposit && p.targetMonth === targetMonth && (
                <div className="flex gap-1.5">
                  <RowActionBtn tone="neutral" onClick={() => startEdit(p)}>수정</RowActionBtn>
                  <RowActionBtn tone="danger" onClick={() => handleDelete(p)}>삭제</RowActionBtn>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
