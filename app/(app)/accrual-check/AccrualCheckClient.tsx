'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { pushToast } from '@/lib/saveStatus'
import { fmtWon } from '@/lib/fmtMoney'
import { moveRecordTargetMonth, bulkApplyLatePayments, undoTargetMonthMoves, type SuspectRecord, type SuspectCategory, type TargetMonthUndo } from './actions'
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

// 월 표기 — 'YYYY-MM' 은 모바일에서 읽기 나쁘다. 확인창은 'N월분'으로 말한다.
const monLabel = (m: string) => `${Number(m.split('-')[1])}월분`
const monShort = (m: string) => `${Number(m.split('-')[1])}월`

// 금액 표기는 정본 fmtWon 사용(감사 B4 — 로컬 재정의 금지)
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
      // 종전 문구는 '입금일·금액은 그대로'만 말해 안심시켰다 — 정작 두 달의 매출·미납이 함께 바뀐다는
      // 사실이 빠져 있었다(A페이즈, UX 라이터·웹디자이너 검토). 화살표는 가이드 금지라 문장으로 푼다.
      title: `${record.roomNo ?? '?'}호 ${record.tenantName}님 수납을 ${monLabel(record.targetMonth)}에서 ${monLabel(newMonth)}으로 옮길까요?`,
      message: `${record.payDate} 입금 ${fmtWon(record.actualAmount)}. 입금일과 금액은 그대로입니다.\n홈·리포트의 ${monShort(record.targetMonth)} 매출이 ${fmtWon(record.actualAmount)} 줄고 ${monShort(newMonth)} 매출이 그만큼 늘어납니다. 두 달의 미납도 함께 바뀝니다.\n실행 직후 뜨는 적용취소로 되돌릴 수 있습니다.`,
      level: 'caution', confirmLabel: '옮기기',
    }))) return

    startTransition(async () => {
      const res = await moveRecordTargetMonth(record.id, newMonth)
      if (!res.ok) { setError(res.error); return }
      setResult(prev => ({
        ...prev,
        suspects: prev.suspects.filter(s => s.id !== record.id),
      }))
      // 확인창에서 적용취소를 약속했으므로 성공 토스트는 항상 띄운다 — 종전에는 undo 가 비면
      // 토스트 자체가 안 떠 '저장됐는데 화면이 안 변하는' 상태가 됐다(디자이너 패스).
      const undo = res.undo
      pushToast('success', '귀속 월을 이동했습니다', (undo && undo.length > 0)
        ? { action: { label: '적용취소', run: () => { void undoTargetMonthMoves(undo).then(r => { if (r.ok) { pushToast('info', '귀속 월 이동을 적용취소했습니다'); router.refresh() } else pushToast('error', r.error) }) } } }
        : undefined)
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
      message: '각 기록이 입금일 직전 달의 매출로 다시 분류됩니다. 입금일·금액은 그대로지만 홈·리포트의 월별 숫자가 바뀝니다. 실행 직후 뜨는 적용취소로 되돌릴 수 있습니다.',
      level: 'caution', confirmLabel: '일괄 이동',
    }))) return
    startTransition(async () => {
      const res = await bulkApplyLatePayments()
      if (!res.ok) { setError(res.error); return }
      setResult(prev => ({
        ...prev,
        suspects: prev.suspects.filter(s => s.category !== 'late-payment'),
      }))
      const undo: TargetMonthUndo = res.undo
      if (undo.length > 0) {
        pushToast('success', `지연 입금 ${res.moved}건을 이동했습니다`, {
          action: { label: '적용취소', run: () => { void undoTargetMonthMoves(undo).then(r => { if (r.ok) { pushToast('info', `${r.restored}건을 원래 월로 복원했습니다`); router.refresh() } else pushToast('error', r.error) }) } },
        })
      }
      router.refresh()
    })
  }

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-5 space-y-2">
        <h1 className="text-base font-bold text-[var(--warm-dark)]">발생주의 데이터 진단</h1>
        <p className="text-xs text-[var(--warm-mid)] leading-relaxed">
          각 수납 기록의 <span className="font-semibold">실제 입금일</span>과 <span className="font-semibold">귀속 월(어느 달 이용료로 잡혔는지)</span>을 비교합니다.
          양도인 record(인수일 이전 입금)는 정상으로 분류되어 제외됩니다. 귀속 월만 바뀌고 입금일과 금액, 납부방식은 그대로입니다. 대신 옮기기 전후 <span className="font-semibold">두 달의 매출과 미납</span> 숫자가 함께 바뀝니다.
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
              filter === k ? 'bg-[var(--coral)] text-[var(--on-solid)]' : 'bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-mid)]'
            }`}
          >
            {label}
          </button>
        ))}
        {counts['late-payment'] > 0 && (
          <button
            onClick={handleBulkLate}
            disabled={isPending}
            className="ml-auto px-3 py-1.5 rounded-full text-xs font-semibold bg-[var(--warning-solid)] text-[var(--on-solid)] hover:opacity-90 disabled:opacity-60 transition-opacity"
            title="지연 입금 record 전체를 직전 월로 한 번에 이동"
          >
            {isPending ? '적용 중…' : `지연 입금 ${counts['late-payment']}건 일괄 적용`}
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
                  <span className="font-semibold text-[var(--warm-dark)]">{fmtWon(s.actualAmount)}</span>
                  {s.payMethod && (
                    <>
                      <span className="text-[var(--warm-muted)]">·</span>
                      <span className="text-[var(--warm-mid)] text-xs">{PAY_METHOD_LABEL[s.payMethod] ?? s.payMethod}</span>
                    </>
                  )}
                </div>
                <span className={`text-[0.65625rem] px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLOR[s.category]}`}>
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
