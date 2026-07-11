'use client'

// 부가수익 — 수납관리 탭 (2026-07-02, /finance '부가 수익' 탭에서 이동).
// 과납분·보증금 미반환분 등 수납 파생 수익이 대부분이라 수납 흐름 옆에 둔다(운영자 결정).
// 손익 합산(대시보드·리포트)은 기존 그대로 — 데이터·액션(finance/actions)은 이동하지 않고 화면만 이곳에.
import { useState, useTransition } from 'react'
import { fmtDateKor as fmtDate } from '@/lib/fmtDate'
import { useRouter } from 'next/navigation'
import { addExtraIncome, updateExtraIncome, deleteExtraIncome, type getExtraIncomes } from '@/app/(app)/finance/actions'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { DatePicker } from '@/components/ui/DatePicker'
import { Btn } from '@/components/ui/Btn'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { Modal } from '@/components/ui/Modal'
import { trackSave, pushToast } from '@/lib/saveStatus'
import { kstYmdStr } from '@/lib/kstDate'

const fmtRoomNo = (no: string | null | undefined) => (no ? (/^\d+$/.test(no) ? `${no}호` : no) : '')

export type Income = Awaited<ReturnType<typeof getExtraIncomes>>[number]
export type LeaseOption = { leaseTermId: string; tenantName: string; roomNo: string | null }

const PAY_METHODS_INC = ['계좌이체', '현금', '보유 보증금', '기타']

function toDateInput(d: Date | string | null | undefined) {
  if (!d) return ''
  const dt = new Date(d)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
function accName(a: { brand: string; alias: string | null } | null) {
  if (!a) return ''
  return a.alias ? `${a.brand} (${a.alias})` : a.brand
}
function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-xs text-[var(--warm-muted)] shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-[var(--warm-dark)] text-right">{value}</span>
    </div>
  )
}

// 입주자 연결 뱃지 — '412호 김명화'. 연결 없으면 미표시.
function tenantLabel(i: Income): string | null {
  if (!i.tenant) return null
  const roomNo = i.leaseTerm?.room?.roomNo
  return `${roomNo ? fmtRoomNo(roomNo) + ' ' : ''}${i.tenant.name}`
}

export function IncomeSection({ incomes, incomeCategories, leaseOptions }: {
  incomes: Income[]
  incomeCategories: string[]
  leaseOptions: LeaseOption[]   // 입주자 연결 선택지 — 수납 화면의 현재 계약들
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  const [incFilter, setIncFilter]         = useState({ method: 'all', category: 'all' })
  const [showAddInc, setShowAddInc]       = useState(false)
  const [addIncDate, setAddIncDate]       = useState(() => kstYmdStr())
  const [addIncMethod, setAddIncMethod]   = useState('계좌이체')
  const [detailInc, setDetailInc]         = useState<Income | null>(null)
  const [detailIncEdit, setDetailIncEdit] = useState(false)
  const [editIncMethod, setEditIncMethod] = useState('계좌이체')
  const [editIncDate, setEditIncDate]     = useState('')
  // v2.0 §12 dirty — 수정/등록 폼 입력 시작 후 배경클릭 무시, Esc/X는 닫기 확인(Modal 내장 정책)
  const [editDirty, setEditDirty] = useState(false)
  const [addDirty, setAddDirty]   = useState(false)

  const filteredIncomes = incomes.filter(i => {
    if (incFilter.method   !== 'all' && i.payMethod !== incFilter.method) return false
    if (incFilter.category !== 'all' && i.category  !== incFilter.category) return false
    return true
  })
  const totalInc = filteredIncomes.reduce((s, i) => s + i.amount, 0)

  const handleAddInc = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('')
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await addExtraIncome(fd)
        if (!res.ok) { pushToast('error', res.error); return }
        setShowAddInc(false); setAddIncDate(kstYmdStr()); router.refresh()
        pushToast('success', '수익 등록됨')
      } finally { release() }
    })
  }
  const handleUpdateInc = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('')
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await updateExtraIncome(fd)
        if (!res.ok) { pushToast('error', res.error); return }
        setDetailInc(null); setDetailIncEdit(false); router.refresh()
        pushToast('success', '수익 수정됨')
      } finally { release() }
    })
  }
  const handleDeleteInc = async (id: string) => {
    if (!(await confirmDialog({ title: '이 수익 기록을 삭제할까요?', level: 'danger', confirmLabel: '삭제' }))) return
    startTransition(async () => {
      await deleteExtraIncome(id); setDetailInc(null); router.refresh()
    })
  }

  // 입주자 선택 셀렉트 — 등록·수정 폼 공용. 값=leaseTermId(서버가 tenantId 보충), 빈 값=연결 없음.
  const LeaseSelect = ({ name, defaultValue }: { name: string; defaultValue?: string }) => (
    <select name={name} defaultValue={defaultValue ?? ''}
      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
      <option value="">연결 안 함 (자판기 등 일반 수입)</option>
      {leaseOptions.map(o => (
        <option key={o.leaseTermId} value={o.leaseTermId}>{o.roomNo ? `${fmtRoomNo(o.roomNo)} ` : ''}{o.tenantName}</option>
      ))}
    </select>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={incFilter.method} onChange={e => setIncFilter(f => ({ ...f, method: e.target.value }))}
          className="bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] text-xs rounded-sm px-3 py-1.5 outline-none">
          <option value="all">입금수단 (전체)</option>
          {PAY_METHODS_INC.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={incFilter.category} onChange={e => setIncFilter(f => ({ ...f, category: e.target.value }))}
          className="bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] text-xs rounded-sm px-3 py-1.5 outline-none">
          <option value="all">카테고리 (전체)</option>
          {incomeCategories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button onClick={() => setIncFilter({ method: 'all', category: 'all' })}
          className="text-xs text-[var(--warm-muted)] hover:text-[var(--warm-dark)] px-2">초기화</button>
        <span className="ml-auto text-sm font-bold text-[var(--success-fg)] num">
          합계: <MoneyDisplay amount={totalInc} />
        </span>
        <Btn variant="primary" size="md" onClick={() => { setShowAddInc(true); setAddDirty(false); setAddIncMethod('계좌이체'); setError('') }}>
          + 수익 등록
        </Btn>
      </div>

      {/* 부가 수익 목록 — 모바일 카드 */}
      {filteredIncomes.length === 0 ? (
        <div className="sm:hidden bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-10 text-center">
          <EmptyState title="부가 수익 내역이 없습니다" />
        </div>
      ) : (
        <div className="sm:hidden space-y-2">
          {filteredIncomes.map(i => (
            <div key={i.id}
              onClick={() => { setDetailInc(i); setDetailIncEdit(false); setError('') }}
              className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-4 cursor-pointer active:opacity-70 transition-opacity">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-[var(--warm-muted)]">{fmtDate(i.date)}</span>
                <span className="text-sm font-bold text-[var(--success-fg)]"><MoneyDisplay amount={i.amount} prefix="+" alwaysFull /></span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                <Badge tone="pale-green">{i.category}</Badge>
                {tenantLabel(i) && (
                  <span className="text-[0.625rem] px-2 py-0.5 rounded-full bg-[var(--canvas)] text-[var(--warm-dark)] font-medium">{tenantLabel(i)}</span>
                )}
                {i.payMethod && (
                  <span className="text-[0.625rem] px-2 py-0.5 rounded-full bg-[var(--canvas)] text-[var(--warm-mid)]">{i.payMethod}</span>
                )}
                {i.financialAccount && (
                  <span className="text-[0.625rem] text-[var(--warm-muted)]">{accName(i.financialAccount)}</span>
                )}
              </div>
              {(i.detail || i.memo) && (
                <p className="text-xs text-[var(--warm-dark)] truncate">
                  {[i.detail, i.memo].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 부가 수익 목록 — 데스크탑 테이블 */}
      <div className="hidden sm:block bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl overflow-auto max-h-[calc(100vh-340px)]">
        {filteredIncomes.length === 0 ? (
          <EmptyState title="부가 수익 내역이 없습니다" />
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 z-10 bg-[var(--cream)]">
              <tr className="border-b border-[var(--warm-border)]">
                {['날짜', '입주자', '입금수단', '카테고리', '세부 항목', '금액'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[var(--warm-muted)]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredIncomes.map(i => (
                <tr key={i.id}
                  onClick={() => { setDetailInc(i); setDetailIncEdit(false); setError('') }}
                  className="border-b border-[var(--warm-border)]/50 hover:bg-[var(--canvas)]/40 transition-colors cursor-pointer">
                  <td className="px-4 py-3 text-xs text-[var(--warm-mid)] whitespace-nowrap">{fmtDate(i.date)}</td>
                  <td className="px-4 py-3 text-xs text-[var(--warm-dark)] whitespace-nowrap">{tenantLabel(i) ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center text-xs px-2 py-1 rounded-full bg-[var(--canvas)] text-[var(--warm-dark)] whitespace-nowrap">{i.payMethod ?? '—'}</span>
                    {i.financialAccount && (
                      <div className="text-xs text-[var(--warm-muted)] mt-0.5 truncate">{accName(i.financialAccount)}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone="pale-green" className="whitespace-nowrap">{i.category}</Badge>
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--warm-dark)]">
                    <span className="truncate block">{i.detail ?? '—'}</span>
                  </td>
                  <td className="px-4 py-3 text-sm font-semibold text-[var(--success-fg)] whitespace-nowrap">
                    <MoneyDisplay amount={i.amount} prefix="+" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 상세/수정 모달 — v2.0 §23 공용 Modal. dirty 시 v2.0 §12 정책은 Modal 내장. */}
      {detailInc && (
        <Modal open onClose={() => { setDetailInc(null); setDetailIncEdit(false); setEditDirty(false) }}
          title={detailIncEdit ? '수익 수정' : '수익 상세'} width="sm" dirty={detailIncEdit && editDirty}>

            {!detailIncEdit ? (
              <>
                <div className="flex-1 overflow-y-auto p-6 space-y-3">
                  <DetailRow label="날짜"      value={fmtDate(detailInc.date)} />
                  <DetailRow label="카테고리"  value={detailInc.category} />
                  {tenantLabel(detailInc) && <DetailRow label="입주자" value={tenantLabel(detailInc)} />}
                  <DetailRow label="세부 항목" value={detailInc.detail ?? '—'} />
                  <DetailRow label="금액"      value={<span className="text-[var(--success-fg)] font-semibold"><MoneyDisplay amount={detailInc.amount} prefix="+" /></span>} />
                  <DetailRow label="입금수단"  value={detailInc.payMethod ?? '—'} />
                  {detailInc.financialAccount && <DetailRow label="금융사" value={accName(detailInc.financialAccount)} />}
                  {detailInc.memo && <DetailRow label="메모" value={detailInc.memo} />}
                </div>
                <div className="border-t border-[var(--warm-border)] px-6 py-4 flex gap-2 shrink-0">
                  <button onClick={() => handleDeleteInc(detailInc.id)} disabled={isPending}
                    className="px-4 py-2.5 bg-[var(--danger-bg)] hover:bg-[var(--danger-bg)] text-[var(--danger-fg)] text-sm rounded-xl transition-colors disabled:opacity-40">삭제</button>
                  <div className="flex-1" />
                  <Btn variant="primary" size="md" onClick={() => {
                    setDetailIncEdit(true)
                    setEditDirty(false)
                    setEditIncDate(toDateInput(detailInc.date))
                    setEditIncMethod(detailInc.payMethod ?? '계좌이체')
                    setError('')
                  }}>수정</Btn>
                </div>
              </>
            ) : (
              <form key={detailInc.id + '-edit'} onSubmit={handleUpdateInc} className="flex flex-col flex-1 overflow-hidden"
                onInput={() => setEditDirty(true)} onChange={() => setEditDirty(true)}>
                <input type="hidden" name="id" value={detailInc.id} />
                <input type="hidden" name="financialAccountId" value={detailInc.financialAccountId ?? ''} />
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">날짜 *</label>
                      <DatePicker name="date" value={editIncDate} onChange={setEditIncDate}
                        className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">금액 *</label>
                      <MoneyInput name="amount" defaultValue={detailInc.amount} placeholder="0원" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">카테고리 *</label>
                    <select name="category" defaultValue={detailInc.category}
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                      {incomeCategories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">입주자 연결 <span className="text-[var(--warm-muted)] font-normal">(선택)</span></label>
                    <LeaseSelect name="leaseTermId" defaultValue={detailInc.leaseTermId ?? ''} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">세부 항목</label>
                    <input type="text" name="detail" defaultValue={detailInc.detail ?? ''}
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">입금수단</label>
                    <select name="payMethod" value={editIncMethod}
                      onChange={e => setEditIncMethod(e.target.value)}
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                      {PAY_METHODS_INC.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">메모</label>
                    <input type="text" name="memo" defaultValue={detailInc.memo ?? ''}
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
                  </div>
                  {error && <p className="text-[var(--danger-fg)] text-sm">{error}</p>}
                </div>
                <div className="border-t border-[var(--warm-border)] px-6 py-4 flex gap-2 shrink-0">
                  <Btn type="button" variant="secondary" size="md" className="flex-1" onClick={() => { setDetailIncEdit(false); setError('') }}>취소</Btn>
                  <Btn type="submit" variant="primary" size="md" className="flex-1" disabled={isPending}>
                    {isPending ? '저장 중…' : '저장'}
                  </Btn>
                </div>
              </form>
            )}
        </Modal>
      )}

      {/* 등록 모달 — v2.0 §23 공용 Modal */}
      {showAddInc && (
        <Modal open onClose={() => { setShowAddInc(false); setAddDirty(false) }} title="부가 수익 등록" width="sm" dirty={addDirty}>
            <form onSubmit={handleAddInc} className="flex flex-col flex-1 overflow-hidden"
              onInput={() => setAddDirty(true)} onChange={() => setAddDirty(true)}>
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">날짜 *</label>
                    <DatePicker name="date" value={addIncDate} onChange={setAddIncDate}
                      className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">금액 *</label>
                    <MoneyInput name="amount" placeholder="0원" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">카테고리 *</label>
                  <select name="category"
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                    {incomeCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">입주자 연결 <span className="text-[var(--warm-muted)] font-normal">(선택)</span></label>
                  <LeaseSelect name="leaseTermId" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">세부 항목</label>
                  <input type="text" name="detail" placeholder="세부 내용"
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">입금수단</label>
                  <select name="payMethod" value={addIncMethod}
                    onChange={e => setAddIncMethod(e.target.value)}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                    {PAY_METHODS_INC.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">메모</label>
                  <input type="text" name="memo" placeholder="메모 (선택)"
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
                </div>
                {error && <p className="text-[var(--danger-fg)] text-sm">{error}</p>}
              </div>
              <div className="border-t border-[var(--warm-border)] px-6 py-4 flex gap-2 shrink-0">
                <button type="button" onClick={() => setShowAddInc(false)}
                  className="flex-1 inline-flex items-center justify-center py-2.5 min-h-[40px] bg-[var(--canvas)] hover:bg-[var(--warm-border)] text-[var(--warm-dark)] text-sm font-medium rounded-xl border border-[var(--warm-border)] transition-colors">취소</button>
                <button type="submit" disabled={isPending}
                  className="flex-1 py-2.5 bg-[var(--success-solid)] hover:opacity-90 text-[var(--cream)] text-sm font-medium rounded-xl transition-colors disabled:opacity-60">
                  {isPending ? '저장 중…' : '저장'}
                </button>
              </div>
            </form>
        </Modal>
      )}
    </div>
  )
}
