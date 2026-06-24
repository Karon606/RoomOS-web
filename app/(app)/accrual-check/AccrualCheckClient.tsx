'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { moveRecordTargetMonth, bulkApplyLatePayments, type SuspectRecord, type SuspectCategory } from './actions'
import { EmptyState } from '@/components/ui/EmptyState'
import { Btn } from '@/components/ui/Btn'
import { confirmDialog } from '@/components/ui/ConfirmDialog'

type Result = {
  total: number
  matched: number
  prevOwnerCount: number
  suspects: SuspectRecord[]
}

const PAY_METHOD_LABEL: Record<string, string> = {
  CASH: '현금', BANK: '계좌이체', CARD: '카드', OTHER: '기타',
}

const CATEGORY_LABEL: Record<SuspectCategory, string> = {
  'late-payment':   '지연 입금 (확인 필요)',
  'pre-payment':    '선납 (정상)',
  'mismatch-other': '월 불일치 (수동 검토)',
}

const CATEGORY_COLOR: Record<SuspectCategory, string> = {
  'late-payment':   'bg-[var(--warning-bg)] text-[var(--warning-fg)] ring-1 ring-[var(--warning-ring)]',
  'pre-payment':    'bg-[var(--success-bg)] text-[var(--success-fg)] ring-1 ring-[var(--success-ring)]',
  'mismatch-other': 'bg-[var(--danger-bg)] text-[var(--danger-fg)] ring-1 ring-[var(--danger-ring)]',
}

function fmtMoney(n: number) { return n.toLocaleString('ko-KR') + '원' }
function fmtDueDay(d: string | null): string {
  if (!d) return '—'
  if (d.includes('말')) return '말일'
  return `${d}일`
}

export default function AccrualCheckClient({ initialResult }: { initialResult: Result }) {
  const router = useRouter()
  const [result, setResult] = useState(initialResult)
  const [filter, setFilter] = useState<'all' | SuspectCategory>('all')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  const filtered = filter === 'all'
    ? result.suspects
    : result.suspects.filter(s => s.category === filter)

  const handleMove = async (record: SuspectRecord, newMonth: string) => {
    if (!newMonth) return
    if (!(await confirmDialog({
      title: `귀속 월을 ${record.targetMonth} → ${newMonth} 로 변경할까요?`,
      message: `${record.roomNo ?? '?'}호 ${record.tenantName}님 ${record.payDate} 입금 ${fmtMoney(record.actualAmount)} — 입금일·금액은 그대로 두고 매출 귀속 월만 바뀝니다.`,
      level: 'caution', confirmLabel: '변경',
    }))) return

    startTransition(async () => {
      const res = await moveRecordTargetMonth(record.id, newMonth)
      if (!res.ok) { setError(res.error); return }
      setResult(prev => ({
        ...prev,
        suspects: prev.suspects.filter(s => s.id !== record.id),
      }))
      router.refresh()
    })
  }

  const counts: Record<SuspectCategory, number> = {
    'late-payment':   result.suspects.filter(s => s.category === 'late-payment').length,
    'pre-payment':    result.suspects.filter(s => s.category === 'pre-payment').length,
    'mismatch-other': result.suspects.filter(s => s.category === 'mismatch-other').length,
  }

  const handleBulkLate = async () => {
    if (counts['late-payment'] === 0) return
    if (!(await confirmDialog({
      title: `지연 입금 ${counts['late-payment']}건을 모두 직전 월로 이동할까요?`,
      message: '각 기록은 입금일이 속한 월의 직전 월 매출로 재분류됩니다. 입금일·금액은 그대로 유지됩니다.',
      level: 'caution', confirmLabel: '일괄 이동',
    }))) return
    startTransition(async () => {
      const res = await bulkApplyLatePayments()
      if (!res.ok) { setError(res.error); return }
      setResult(prev => ({
        ...prev,
        suspects: prev.suspects.filter(s => s.category !== 'late-payment'),
      }))
      router.refresh()
    })
  }

  return (
    <div className="space-y-4 p-4 max-w-5xl mx-auto">
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-5 space-y-2">
        <h1 className="text-base font-bold text-[var(--warm-dark)]">발생주의 데이터 진단</h1>
        <p className="text-xs text-[var(--warm-mid)] leading-relaxed">
          각 수납 기록의 <span className="font-semibold">실제 입금일(payDate)</span>과 <span className="font-semibold">귀속 월(targetMonth)</span>을 비교합니다.
          양도인 record(인수일 이전 입금)는 정상으로 분류되어 제외됩니다. 변경되는 것은 해당 기록의 <span className="font-semibold">귀속 월</span>뿐 — 입금일·금액·납부방식은 그대로 유지됩니다.
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--warm-mid)] pt-2">
          <span>전체: <span className="font-semibold text-[var(--warm-dark)]">{result.total}건</span></span>
          <span>일치: <span className="font-semibold text-[var(--warm-dark)]">{result.matched}건</span></span>
          <span>양도인: <span className="font-semibold text-[var(--warm-muted)]">{result.prevOwnerCount}건</span></span>
          <span>지연 입금: <span className="font-semibold text-[var(--warning-fg)]">{counts['late-payment']}건</span></span>
          <span>선납: <span className="font-semibold text-[var(--success-fg)]">{counts['pre-payment']}건</span></span>
          <span>월 불일치: <span className="font-semibold text-[var(--danger-fg)]">{counts['mismatch-other']}건</span></span>
        </div>
      </div>

      {error && (
        <div className="bg-[var(--danger-bg)] border border-[var(--danger-ring)] rounded-xl p-3">
          <p className="text-[var(--danger-fg)] text-sm">{error}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {([
          { k: 'all',             label: '전체' },
          { k: 'late-payment',    label: '지연 입금' },
          { k: 'pre-payment',     label: '선납' },
          { k: 'mismatch-other',  label: '월 불일치' },
        ] as const).map(({ k, label }) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              filter === k ? 'bg-[var(--coral)] text-white' : 'bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-mid)]'
            }`}
          >
            {label}
          </button>
        ))}
        {counts['late-payment'] > 0 && (
          <button
            onClick={handleBulkLate}
            disabled={isPending}
            className="ml-auto px-3 py-1.5 rounded-full text-xs font-semibold bg-[var(--warning-solid)] text-[var(--cream)] hover:opacity-90 disabled:opacity-60 transition-opacity"
            title="지연 입금 record 전체를 직전 월로 한 번에 이동"
          >
            {isPending ? '적용 중...' : `지연 입금 ${counts['late-payment']}건 일괄 적용`}
          </button>
        )}
      </div>

      <div className="space-y-2">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--warm-muted)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>}
            title="재검토 대상 기록이 없습니다"
            description="조건에 맞는 재검토 대상이 없습니다."
          />
        ) : (
          filtered.map(s => (
            <div key={s.id} className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 text-sm flex-wrap">
                  <span className="font-bold text-[var(--coral)]">{s.roomNo ?? '?'}호</span>
                  <span className="font-semibold text-[var(--warm-dark)]">{s.tenantName}</span>
                  <span className="text-[var(--warm-muted)]">·</span>
                  <span className="text-[var(--warm-mid)]">{s.payDate} 입금</span>
                  <span className="text-[var(--warm-muted)]">·</span>
                  <span className="font-semibold text-[var(--warm-dark)]">{fmtMoney(s.actualAmount)}</span>
                  {s.payMethod && (
                    <>
                      <span className="text-[var(--warm-muted)]">·</span>
                      <span className="text-[var(--warm-mid)] text-xs">{PAY_METHOD_LABEL[s.payMethod] ?? s.payMethod}</span>
                    </>
                  )}
                </div>
                <span className={`text-[0.625rem] px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLOR[s.category]}`}>
                  {CATEGORY_LABEL[s.category]}
                </span>
              </div>

              <div className="flex items-center gap-2 text-xs text-[var(--warm-mid)] flex-wrap">
                <span>현재 귀속:</span>
                <span className="font-semibold text-[var(--warm-dark)]">{s.targetMonth}</span>
                {s.inferredAccrualMonth && s.inferredAccrualMonth !== s.targetMonth && (
                  <>
                    <span className="text-[var(--warm-muted)]">→ 추정:</span>
                    <span className="font-semibold text-[var(--warning-fg)]">{s.inferredAccrualMonth}</span>
                  </>
                )}
                <span className="text-[var(--warm-muted)]">·</span>
                <span>납부일: {fmtDueDay(s.dueDay)}</span>
              </div>
              {s.memo && (
                <div className="text-xs text-[var(--warm-muted)] italic">메모: {s.memo}</div>
              )}

              <div className="flex gap-2 pt-1 flex-wrap">
                {s.inferredAccrualMonth && s.inferredAccrualMonth !== s.targetMonth && (
                  <Btn
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={() => handleMove(s, s.inferredAccrualMonth!)}
                    disabled={isPending}
                  >
                    {s.inferredAccrualMonth}로 이동
                  </Btn>
                )}
                <ManualMonthInput record={s} onMove={handleMove} disabled={isPending} />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function ManualMonthInput({
  record, onMove, disabled,
}: {
  record: SuspectRecord
  onMove: (r: SuspectRecord, m: string) => void
  disabled: boolean
}) {
  const [val, setVal] = useState(record.targetMonth)
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="month"
        value={val}
        onChange={e => setVal(e.target.value)}
        className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-xs text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]"
      />
      <button
        type="button"
        onClick={() => onMove(record, val)}
        disabled={disabled || val === record.targetMonth}
        className="text-xs px-2.5 py-1 rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] disabled:opacity-40 transition-colors"
      >
        직접 지정
      </button>
    </div>
  )
}
