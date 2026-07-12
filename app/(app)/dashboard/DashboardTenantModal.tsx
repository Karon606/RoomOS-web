'use client'
// 홈 대시보드 입주자 수납 모달 — 미수납·납입완료 리스트·알림에서 여는 결제 입력/편집 UI

import { useState, useEffect, useTransition, type FormEvent } from 'react'
import Link from 'next/link'
import { Modal } from '@/components/ui/Modal'
import { Btn } from '@/components/ui/Btn'
import { DatePicker } from '@/components/ui/DatePicker'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { fmtWon } from '@/lib/fmtMoney'
import { kstYmdStr } from '@/lib/kstDate'
import { trackSave, pushToast } from '@/lib/saveStatus'
import {
  getTenantLastPayMethod, getTenantLeaseForDashboard, getPaymentsByLease,
  savePayment, saveDepositPayment, updatePayment, deletePayment,
} from '@/app/(app)/rooms/actions'
import { fmtRoomNo } from './dashUtils'

type DashLease = Awaited<ReturnType<typeof getTenantLeaseForDashboard>>
type DashPayRecord = { id: string; seqNo: number; actualAmount: number; payDate: Date; payMethod: string | null; memo: string | null; isDeposit: boolean }

export function DashboardTenantModal({ tenantId, targetMonth, paymentMethods, onClose, onPaymentDone }: {
  tenantId: string
  targetMonth: string
  paymentMethods: string[]
  onClose: () => void
  onPaymentDone?: () => void
}) {
  const [lease, setLease] = useState<DashLease>(null)
  const [payHistory, setPayHistory] = useState<DashPayRecord[]>([])
  const [acquisitionDate, setAcquisitionDate] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [payAmount, setPayAmount] = useState(0)
  const [payDate, setPayDate] = useState(kstYmdStr())
  const [isDepositMode, setIsDepositMode] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  // 납부방법 prefill — 이 고객의 직전 방식 우선, 기록 없으면 기기 최근(운영자 요청 2026-07-06)
  const [lastPayMethod, setLastPayMethod] = useState(() =>
    typeof window !== 'undefined' ? (localStorage.getItem('stayeum-last-pay-method') ?? '') : ''
  )
  useEffect(() => {
    let active = true
    getTenantLastPayMethod(tenantId).then(m => { if (active && m) setLastPayMethod(m) }).catch(() => {})
    return () => { active = false }
  }, [tenantId])
  const [editAmount, setEditAmount] = useState(0)
  const [editDate, setEditDate] = useState('')
  const [editPayMethod, setEditPayMethod] = useState('')
  const [editMemo, setEditMemo] = useState('')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const [editingAutoPay, setEditingAutoPay] = useState(false)
  const [autoPayDate, setAutoPayDate] = useState('')

  const reload = async (l: DashLease) => {
    if (!l) return
    const { records, acquisitionDate: acq } = await getPaymentsByLease(l.id, targetMonth)
    setPayHistory(records as DashPayRecord[])
    setAcquisitionDate(acq ? new Date(acq) : null)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const l = await getTenantLeaseForDashboard(tenantId, targetMonth)
      if (cancelled) return
      setLease(l)
      if (l) {
        setPayAmount(l.rentAmount)
        const { records, acquisitionDate: acq, lastPayMethod: leaseLast } = await getPaymentsByLease(l.id, targetMonth)
        if (cancelled) return
        setPayHistory(records as DashPayRecord[])
        setAcquisitionDate(acq ? new Date(acq) : null)
        // #5: 이 입주자(lease)의 최근 납부방법을 기본값으로 (전역 localStorage 대신 입주자별)
        setLastPayMethod(leaseLast ?? '')
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [tenantId, targetMonth])

  if (!lease && !loading) {
    return (
      <Modal open onClose={onClose} width="xs">
        <div className="p-6 text-center">
          <p className="text-sm text-[var(--warm-muted)]">활성 계약을 찾을 수 없습니다.</p>
          <button onClick={onClose} className="mt-3 text-sm font-medium" style={{ color: 'var(--coral)' }}>닫기</button>
        </div>
      </Modal>
    )
  }

  const isPreAcq = (p: DashPayRecord) => !!(acquisitionDate && new Date(p.payDate) < acquisitionDate)
  const depositRecords = payHistory.filter(p => p.isDeposit)
  const regularRecords = payHistory.filter(p => !p.isDeposit && !p.memo?.startsWith('[납입일변경]'))
  const adjRecords = payHistory.filter(p => p.memo?.startsWith('[납입일변경]'))
  const prevOwnerPaid = regularRecords.filter(isPreAcq).reduce((s, p) => s + p.actualAmount, 0)
  const regularPaid = regularRecords.reduce((s, p) => s + p.actualAmount, 0) - prevOwnerPaid
  const adjNet = adjRecords.reduce((s, p) => s + p.actualAmount, 0)
  // viewMonth(targetMonth) 단일 정산 — 5월 입금 - 5월 청구
  const viewBalance = lease ? regularPaid + adjNet - lease.rentAmount : 0
  // 누적 잔액 = 이월(carryOver) + viewMonth 정산
  // carryOver < 0 = 이월 미수, viewBalance < 0 = 이번 달 잔액 부족
  const carryOver = lease?.carryOver ?? 0
  const balance = viewBalance + carryOver

  // 양도인 자동 완납 여부 계산
  const cutoffDate2 = lease?.property.prevOwnerCutoffDate ?? lease?.property.acquisitionDate ?? null
  const cutoffMonthStr2 = cutoffDate2
    ? `${new Date(cutoffDate2).getFullYear()}-${String(new Date(cutoffDate2).getMonth() + 1).padStart(2, '0')}`
    : null
  const cutoffDay2 = cutoffDate2 ? new Date(cutoffDate2).getDate() : 0
  const dueDayNum = lease?.dueDay ? parseInt(lease.dueDay, 10) : 0
  const isAutoPaidNoBilling = !!(
    cutoffMonthStr2 && targetMonth === cutoffMonthStr2 &&
    !isNaN(dueDayNum) && dueDayNum < cutoffDay2 &&
    regularRecords.length === 0
  )
  const getDueDateStr = () => {
    if (!lease?.dueDay) return ''
    const [y, m] = targetMonth.split('-').map(Number)
    if (lease.dueDay === '말') return `${y}년 ${m}월 ${new Date(y, m, 0).getDate()}일`
    const d = parseInt(lease.dueDay, 10)
    return isNaN(d) ? '' : `${y}년 ${m}월 ${d}일`
  }
  const DAYS = ['일', '월', '화', '수', '목', '금', '토']
  const fmtDate = (d: Date | string) => {
    const dt = new Date(d)
    return `${dt.getMonth() + 1}월 ${dt.getDate()}일 (${DAYS[dt.getDay()]})`
  }

  const handleSave = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!lease) return
    const fd = new FormData(e.currentTarget)
    const payMethod = fd.get('payMethod') as string
    const memo = fd.get('memo') as string
    startTransition(async () => {
      const release = trackSave()
      try {
        if (isDepositMode) {
          await saveDepositPayment({
            leaseTermId: lease.id,
            tenantId,
            targetMonth,
            depositAmount: lease.depositAmount,
            rentAmount: lease.rentAmount,
            totalPaid: payAmount,
            payDate,
            payMethod,
            memo: memo || undefined,
          })
        } else {
          await savePayment({
            leaseTermId: lease.id,
            tenantId,
            targetMonth,
            expectedAmount: lease.rentAmount,
            actualAmount: payAmount,
            payDate,
            payMethod,
            memo,
          })
        }
        if (payMethod) {
          localStorage.setItem('stayeum-last-pay-method', payMethod)
          setLastPayMethod(payMethod)
        }
        setShowForm(false)
        setIsDepositMode(false)
        await reload(lease)
        onPaymentDone?.()
        pushToast('success', isDepositMode ? '보증금 수납됨' : '월 이용료 수납됨')
      } catch (err: unknown) {
        const msg = (err as Error).message
        setError(msg); pushToast('error', msg)
      } finally { release() }
    })
  }

  const handleDelete = async (id: string) => {
    if (!(await confirmDialog({ title: '이 수납 기록을 삭제할까요?', level: 'danger', confirmLabel: '삭제' }))) return
    startTransition(async () => {
      const release = trackSave()
      try {
        await deletePayment(id)
        await reload(lease)
        pushToast('success', '수납 기록 삭제됨')
      } finally { release() }
    })
  }

  const startEdit = (p: DashPayRecord) => {
    setEditingId(p.id)
    setEditAmount(p.actualAmount)
    setEditDate(kstYmdStr(new Date(p.payDate)))
    setEditPayMethod(p.payMethod ?? '')
    setEditMemo(p.memo ?? '')
  }

  const handleSaveEdit = () => {
    if (!editingId) return
    startTransition(async () => {
      const res = await updatePayment(editingId, { actualAmount: editAmount, payDate: editDate, payMethod: editPayMethod, memo: editMemo || undefined })
      if (!res.ok) { setError(res.error); return }
      setEditingId(null)
      await reload(lease)
    })
  }

  // v2.0 §12 dirty — 수납/수정 입력이 진행 중이면 닫기 확인 (금융 입력 유실 방지)
  const formDirty = !loading && (editingId !== null || editingAutoPay)

  return (
    <Modal open onClose={onClose} width="md" dirty={formDirty}
      title={loading
        ? <div className="h-5 w-32 bg-[var(--cream-3)] rounded animate-pulse" />
        : <h2 className="text-base font-bold text-[var(--warm-dark)] truncate">
            {lease?.room?.roomNo ? `${fmtRoomNo(lease.room.roomNo)} · ` : ''}{lease?.tenant.name}
          </h2>}
      subtitle={loading ? undefined : `${targetMonth} · 예정 ${fmtWon(lease?.rentAmount ?? 0)}`}
      footer={!loading && lease ? (
        <div className="flex gap-2">
          <Link href={`/rooms?month=${targetMonth}`}
            onClick={onClose}
            className="flex-1 text-center text-xs font-medium py-2 rounded-lg border transition-colors"
            style={{ borderColor: 'var(--warm-border)', color: 'var(--warm-mid)' }}>
            수납 관리 ›
          </Link>
          <Link href={`/tenants?tenantId=${lease.tenant.id}&tab=info`}
            onClick={onClose}
            className="flex-1 text-center text-xs font-medium py-2 rounded-lg border transition-colors"
            style={{ borderColor: 'var(--warm-border)', color: 'var(--warm-mid)' }}>
            입주자 관리 ›
          </Link>
        </div>
      ) : undefined}>
        <div>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-[var(--coral)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="p-6 space-y-5">
              {error && <p className="text-xs text-[var(--danger-fg)] bg-[var(--danger-bg)] rounded-xl px-3 py-2">{error}</p>}

              {/* 수납 현황 — 누적 미수(이월 + viewMonth 도래 후 미회수) 정확히 반영 */}
              {(() => {
                // viewMonth 도래 여부: 같은 월이면 dueDay 비교, 과거면 자동 도래, 미래면 미도래
                const dueDay = lease?.dueDay ? parseInt(lease.dueDay, 10) : 0
                const [tY, tM] = targetMonth.split('-').map(Number)
                const today = new Date()
                const todayY = today.getFullYear(), todayM = today.getMonth() + 1
                let viewDuePassed: boolean
                if (tY > todayY || (tY === todayY && tM > todayM)) viewDuePassed = false
                else if (tY < todayY || (tY === todayY && tM < todayM)) viewDuePassed = true
                else {
                  if (dueDay >= 1 && dueDay <= 31) {
                    const td = new Date(tY, tM - 1, Math.min(dueDay, new Date(tY, tM, 0).getDate()))
                    td.setHours(23, 59, 59, 999)
                    viewDuePassed = today >= td
                  } else viewDuePassed = true
                }
                // 진짜 미수 = 이월 미수 + (도래 후 viewMonth 미회수만)
                const trueUnpaid = (carryOver < 0 ? -carryOver : 0)
                                 + (viewDuePassed && viewBalance < 0 ? -viewBalance : 0)
                const truePrepaid = (carryOver > 0 ? carryOver : 0)
                                  + (viewBalance > 0 ? viewBalance : 0)
                const thirdLabel = trueUnpaid > 0 ? '미수' : truePrepaid > 0 ? '선납' : '정상'
                const thirdValue = trueUnpaid > 0
                  ? `−${fmtWon(trueUnpaid)}`
                  : truePrepaid > 0 ? `+${fmtWon(truePrepaid)}` : '0원'
                const thirdColor = trueUnpaid > 0 ? 'var(--tc)' : truePrepaid > 0 ? 'var(--success)' : 'var(--warm-mid)'
                return (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: '이달 청구', value: `${fmtWon(lease!.rentAmount)}`, color: 'var(--warm-dark)' },
                        { label: '이달 납부', value: `${fmtWon(regularPaid)}`, color: regularPaid >= lease!.rentAmount ? 'var(--success)' : 'var(--warm-dark)' },
                        { label: thirdLabel, value: thirdValue, color: thirdColor },
                      ].map(item => (
                        <div key={item.label} className="rounded-xl p-3 text-center" style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)' }}>
                          <p className="text-[0.65625rem] text-[var(--warm-muted)] mb-1">{item.label}</p>
                          <p className="text-xs font-bold mono tnum" style={{ color: item.color }}>{item.value}</p>
                        </div>
                      ))}
                    </div>
                    {/* carryOver(이월) 별도 보조 표시 — 0이 아닐 때만 */}
                    {carryOver !== 0 && (
                      <p className="text-[0.6875rem] text-[var(--warm-muted)] mt-1.5 text-center">
                        {carryOver < 0 ? (
                          <>이월 미수 <span className="text-[var(--danger-fg)] font-medium mono tnum">{fmtWon(Math.abs(carryOver))}</span> 포함</>
                        ) : (
                          <>이월 선납 <span className="text-[var(--success-fg)] font-medium mono tnum">{fmtWon(carryOver)}</span> 포함</>
                        )}
                        {!viewDuePassed && viewBalance < 0 && (
                          <span className="ml-1.5 text-[var(--warm-muted)]">(이달 청구 {fmtWon(Math.abs(viewBalance))}은 도래 전)</span>
                        )}
                      </p>
                    )}
                  </>
                )
              })()}

              {/* 납부 내역 */}
              {(payHistory.length > 0 || isAutoPaidNoBilling) && (
                <div className="space-y-2">
                  {isAutoPaidNoBilling && (() => {
                    const getAutoDefault = () => {
                      const [y, m] = targetMonth.split('-').map(Number)
                      const dd = lease!.dueDay
                      if (!dd) return `${targetMonth}-01`
                      if (dd === '말') return `${y}-${String(m).padStart(2,'0')}-${String(new Date(y,m,0).getDate()).padStart(2,'0')}`
                      const d = parseInt(dd, 10)
                      return isNaN(d) ? `${targetMonth}-01` : `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
                    }
                    const handleSaveAutoPay = () => {
                      if (!lease || !autoPayDate) return
                      startTransition(async () => {
                        try {
                          await savePayment({
                            leaseTermId: lease.id,
                            tenantId: lease.tenant.id,
                            targetMonth,
                            expectedAmount: lease.rentAmount,
                            actualAmount: lease.rentAmount,
                            payDate: autoPayDate,
                            payMethod: '양도인 수납',
                            memo: '양도인 귀속 수납',
                          })
                          setEditingAutoPay(false)
                          await reload(lease)
                        } catch (e) {
                          setError(e instanceof Error ? e.message : '저장 실패')
                        }
                      })
                    }
                    return editingAutoPay ? (
                      <div className="bg-[var(--info-bg)] border border-[var(--info-ring)] rounded-sm px-3 py-2.5 space-y-2">
                        <p className="text-xs font-semibold text-[var(--info-fg)]">양도인 수납 · 납부일 직접 입력</p>
                        <div className="flex gap-2 items-center">
                          <div className="flex-1">
                            <DatePicker value={autoPayDate} onChange={setAutoPayDate}
                              className="bg-[var(--canvas)] border border-[var(--info-ring)] rounded-lg px-2 py-1.5 text-sm text-[var(--warm-dark)]" />
                          </div>
                          <button onClick={handleSaveAutoPay} disabled={isPending || !autoPayDate}
                            className="px-3 py-1.5 text-xs font-semibold text-[var(--on-solid)] bg-[var(--info-solid)] hover:bg-[var(--info-solid)] rounded-lg transition-colors disabled:opacity-50">저장</button>
                          <button onClick={() => setEditingAutoPay(false)}
                            className="px-3 py-1.5 text-xs text-[var(--info-fg)] rounded-lg border border-[var(--info-ring)] hover:bg-[var(--info-bg)] transition-colors">취소</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between bg-[var(--info-bg)] border border-[var(--info-ring)] rounded-sm px-3 py-2.5">
                        <div>
                          <p className="text-xs font-semibold text-[var(--info-fg)]">양도인 수납</p>
                          <button onClick={() => { setAutoPayDate(getAutoDefault()); setEditingAutoPay(true) }}
                            className="text-[0.65625rem] text-[var(--info-fg)] mt-0.5 hover:underline text-left">
                            {getDueDateStr()} 납부 (자동) · <span className="underline">날짜 수정</span>
                          </button>
                        </div>
                        <p className="text-xs font-semibold text-[var(--info-fg)]">{fmtWon(lease!.rentAmount)}</p>
                      </div>
                    )
                  })()}
                  {depositRecords.length > 0 && (
                    <>
                      <p className="text-xs font-medium text-[var(--warm-mid)]">보증금 수납 내역</p>
                      {depositRecords.map(p => (
                        editingId === p.id ? (
                          <DashEditRow key={p.id} editAmount={editAmount} editDate={editDate} editPayMethod={editPayMethod} editMemo={editMemo}
                            setEditAmount={setEditAmount} setEditDate={setEditDate} setEditPayMethod={setEditPayMethod} setEditMemo={setEditMemo}
                            onSave={handleSaveEdit} onCancel={() => setEditingId(null)} isPending={isPending} color="purple" />
                        ) : (
                          <DashPayRow key={p.id} p={p} isPreAcq={false} onEdit={startEdit} onDelete={handleDelete} color="purple" />
                        )
                      ))}
                    </>
                  )}
                  {prevOwnerPaid > 0 && (
                    <div className="flex items-center justify-between bg-[var(--info-bg)] border border-[var(--info-ring)] rounded-xl px-3 py-2">
                      <p className="text-xs text-[var(--info-fg)]">양도인 귀속</p>
                      <p className="text-xs font-semibold text-[var(--info-fg)]">{fmtWon(prevOwnerPaid)}</p>
                    </div>
                  )}
                  {regularRecords.length > 0 && (
                    <>
                      <p className="text-xs font-medium text-[var(--warm-mid)]">납부 내역</p>
                      {regularRecords.map(p => (
                        editingId === p.id ? (
                          <DashEditRow key={p.id} editAmount={editAmount} editDate={editDate} editPayMethod={editPayMethod} editMemo={editMemo}
                            setEditAmount={setEditAmount} setEditDate={setEditDate} setEditPayMethod={setEditPayMethod} setEditMemo={setEditMemo}
                            onSave={handleSaveEdit} onCancel={() => setEditingId(null)} isPending={isPending} color={isPreAcq(p) ? 'amber' : 'default'} />
                        ) : (
                          <DashPayRow key={p.id} p={p} isPreAcq={isPreAcq(p)} onEdit={startEdit} onDelete={handleDelete} color={isPreAcq(p) ? 'amber' : 'default'} />
                        )
                      ))}
                    </>
                  )}
                </div>
              )}

              {/* 수납 입력 폼 */}
              {showForm ? (
                <form onSubmit={handleSave} className="space-y-3 rounded-xl border border-[var(--warm-border)] p-4" style={{ background: 'var(--canvas)' }}>
                  {lease!.depositAmount > 0 && (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={isDepositMode} onChange={e => {
                        setIsDepositMode(e.target.checked)
                        if (e.target.checked) setPayAmount(lease!.depositAmount)
                        else setPayAmount(lease!.rentAmount)
                      }} className="accent-[var(--coral)]" />
                      <span className="text-xs font-medium text-[var(--warm-dark)]">보증금 수납 ({fmtWon(lease!.depositAmount)})</span>
                    </label>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <p className="text-[0.65625rem] text-[var(--warm-muted)]">금액</p>
                      <input type="text" inputMode="numeric"
                        value={payAmount.toLocaleString()}
                        onChange={e => setPayAmount(Number(e.target.value.replace(/[^0-9]/g, '')))}
                        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-[0.65625rem] text-[var(--warm-muted)]">납부일</p>
                      <DatePicker value={payDate} onChange={setPayDate}
                        className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)]" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <p className="text-[0.65625rem] text-[var(--warm-muted)]">납부방법</p>
                      {/* #5: key에 lastPayMethod 포함 — lease 최근 방법 도착 시 remount되어 기본값 반영 */}
                      <select key={`pm-${tenantId}-${lastPayMethod}`} name="payMethod" defaultValue={lastPayMethod}
                        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors">
                        <option value="">선택 안 함</option>
                        {paymentMethods.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[0.65625rem] text-[var(--warm-muted)]">메모</p>
                      <input name="memo" type="text"
                        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                    </div>
                  </div>
                  {isDepositMode && payAmount > lease!.depositAmount && (
                    <p className="text-[0.65625rem] text-[var(--coral)]">
                      초과금 {fmtWon((payAmount - lease!.depositAmount))}은 {targetMonth} 이용료로 처리
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Btn type="button" variant="secondary" size="md" className="flex-1" onClick={() => { setShowForm(false); setIsDepositMode(false) }}>취소</Btn>
                    <Btn type="submit" variant="primary" size="md" className="flex-1" disabled={isPending}>
                      {isPending ? '저장 중…' : '저장'}
                    </Btn>
                  </div>
                </form>
              ) : (
                <Btn onClick={() => setShowForm(true)} variant="primary" size="md" fullWidth>
                  + 수납 입력
                </Btn>
              )}
            </div>
          )}
        </div>
    </Modal>
  )
}

function DashPayRow({ p, isPreAcq, onEdit, onDelete, color }: {
  p: DashPayRecord; isPreAcq: boolean
  onEdit: (p: DashPayRecord) => void; onDelete: (id: string) => void
  color: 'purple' | 'amber' | 'default'
}) {
  const bg = color === 'purple' ? 'bg-[var(--deposit-bg)] border border-[var(--deposit-ring)]' : color === 'amber' ? 'bg-[var(--info-bg)] border border-[var(--info-ring)]' : 'bg-[var(--canvas)]'
  const textColor = color === 'purple' ? 'text-[var(--deposit-fg)]' : color === 'amber' ? 'text-[var(--info-fg)]' : 'text-[var(--warm-mid)]'
  const amountColor = color === 'purple' ? 'text-[var(--deposit-fg)]' : color === 'amber' ? 'text-[var(--info-fg)]' : 'text-[var(--warm-dark)]'
  const DAYS = ['일', '월', '화', '수', '목', '금', '토']
  const fmtD = (d: Date | string) => { const dt = new Date(d); return `${dt.getMonth()+1}월 ${dt.getDate()}일 (${DAYS[dt.getDay()]})` }
  return (
    <div className={`flex items-center justify-between rounded-sm px-3 py-2.5 ${bg}`}>
      <div>
        <p className={`text-xs ${textColor}`}>
          {p.seqNo}회차 · {fmtD(p.payDate)} · {p.payMethod ?? '—'}
          {color === 'purple' && <span className="ml-1.5 text-[0.65625rem] font-semibold bg-[var(--deposit-bg)] text-[var(--deposit-fg)] rounded px-1 py-0.5">보증금</span>}
          {isPreAcq && <span className="ml-1.5 text-[0.65625rem] font-semibold bg-[var(--info-bg)] text-[var(--info-fg)] rounded px-1 py-0.5">양도인</span>}
        </p>
        {p.memo && !p.isDeposit && <p className="text-xs text-[var(--coral)] mt-0.5">{p.memo}</p>}
      </div>
      <div className="flex items-center gap-2">
        <span className={`text-sm font-semibold ${amountColor}`}>{fmtWon(p.actualAmount)}</span>
        <div className="flex gap-2 ml-1">
          <button onClick={() => onEdit(p)} className="inline-flex items-center text-xs font-medium px-2.5 min-h-[44px] rounded-lg border transition-colors" style={{ borderColor: 'var(--warm-border)', color: 'var(--warm-mid)' }}>수정</button>
          <button onClick={() => onDelete(p.id)} className="inline-flex items-center text-xs font-medium px-2.5 min-h-[44px] rounded-lg border border-[var(--danger-ring)] text-[var(--danger-fg)] transition-colors">삭제</button>
        </div>
      </div>
    </div>
  )
}

function DashEditRow({ editAmount, editDate, editPayMethod, editMemo, setEditAmount, setEditDate, setEditPayMethod, setEditMemo, onSave, onCancel, isPending, color }: {
  editAmount: number; editDate: string; editPayMethod: string; editMemo: string
  setEditAmount: (v: number) => void; setEditDate: (v: string) => void; setEditPayMethod: (v: string) => void; setEditMemo: (v: string) => void
  onSave: () => void; onCancel: () => void; isPending: boolean; color: 'purple' | 'amber' | 'default'
}) {
  const borderColor = color === 'purple' ? 'border-[var(--deposit-ring)]' : color === 'amber' ? 'border-[var(--info-ring)]' : 'border-[var(--coral)]'
  const bg = color === 'purple' ? 'bg-[var(--deposit-bg)]' : color === 'amber' ? 'bg-[var(--info-bg)]' : 'bg-[var(--canvas)]'
  return (
    <div className={`rounded-xl border ${borderColor} ${bg} px-3 py-2.5 space-y-2`}>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <p className="text-[0.65625rem] text-[var(--warm-muted)]">금액</p>
          <input type="text" inputMode="numeric" value={editAmount.toLocaleString()} onChange={e => setEditAmount(Number(e.target.value.replace(/[^0-9]/g, '')))}
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
        </div>
        <div className="space-y-1">
          <p className="text-[0.65625rem] text-[var(--warm-muted)]">납부일</p>
          <DatePicker value={editDate} onChange={setEditDate}
            className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg px-2 py-1.5 text-sm text-[var(--warm-dark)]" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <p className="text-[0.65625rem] text-[var(--warm-muted)]">납부방법</p>
          <input type="text" value={editPayMethod} onChange={e => setEditPayMethod(e.target.value)} placeholder="계좌이체, 현금…"
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
        </div>
        <div className="space-y-1">
          <p className="text-[0.65625rem] text-[var(--warm-muted)]">메모</p>
          <input type="text" value={editMemo} onChange={e => setEditMemo(e.target.value)}
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="text-xs px-3 py-1.5 min-h-[36px] rounded-lg border transition-colors" style={{ borderColor: 'var(--warm-border)', color: 'var(--warm-mid)' }}>취소</button>
        <button onClick={onSave} disabled={isPending} className="text-xs text-[var(--on-solid)] px-3 py-1.5 min-h-[36px] rounded-lg transition-colors disabled:opacity-50" style={{ background: 'var(--coral)' }}>저장</button>
      </div>
    </div>
  )
}
