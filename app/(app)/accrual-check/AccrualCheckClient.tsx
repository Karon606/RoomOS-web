'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { moveRecordTargetMonth, type SuspectRecord } from './actions'

type Result = {
  total: number
  matched: number
  suspects: SuspectRecord[]
}

const PAY_METHOD_LABEL: Record<string, string> = {
  CASH: '현금', BANK: '계좌이체', CARD: '카드', OTHER: '기타',
}

function fmtMoney(n: number) { return n.toLocaleString('ko-KR') + '원' }

export default function AccrualCheckClient({ initialResult }: { initialResult: Result }) {
  const router = useRouter()
  const [result, setResult] = useState(initialResult)
  const [filter, setFilter] = useState<'all' | 'next-month-early' | 'mismatch-other'>('all')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  // 중복 제거 (같은 record가 두 분류에 들어올 수 있어서 id 기준 dedupe — 첫 항목 유지)
  const dedupedSuspects = (() => {
    const seen = new Set<string>()
    const out: SuspectRecord[] = []
    for (const s of result.suspects) {
      if (seen.has(s.id)) continue
      seen.add(s.id)
      out.push(s)
    }
    return out
  })()

  const filtered = filter === 'all'
    ? dedupedSuspects
    : dedupedSuspects.filter(s => s.category === filter)

  const handleMove = (record: SuspectRecord, newMonth: string) => {
    if (!newMonth) return
    if (!confirm(
      `${record.roomNo ?? '?'}호 ${record.tenantName}님 ${record.payDate} 입금 ${fmtMoney(record.actualAmount)}\n\n귀속 월: ${record.targetMonth} → ${newMonth}\n\n이 기록의 targetMonth를 변경합니다. 진행할까요?`
    )) return

    startTransition(async () => {
      const res = await moveRecordTargetMonth(record.id, newMonth)
      if (!res.ok) { setError(res.error); return }
      // 업데이트된 기록을 결과에서 제거
      setResult(prev => ({
        ...prev,
        suspects: prev.suspects.filter(s => s.id !== record.id),
      }))
      router.refresh()
    })
  }

  return (
    <div className="space-y-4 p-4 max-w-5xl mx-auto">
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-5 space-y-2">
        <h1 className="text-base font-bold text-[var(--warm-dark)]">발생주의 전환 — 데이터 진단</h1>
        <p className="text-xs text-[var(--warm-mid)] leading-relaxed">
          각 수납 기록의 <span className="font-semibold">실제 입금일(payDate)</span>과 <span className="font-semibold">귀속 월(targetMonth)</span>을 비교해 발생주의 관점에서 재검토가 필요한 기록을 보여줍니다.
          이 페이지에서 변경하는 것은 해당 기록의 <span className="font-semibold">귀속 월</span>뿐입니다. 입금일·금액·납부 방식은 그대로 유지됩니다.
        </p>
        <div className="flex gap-4 text-xs text-[var(--warm-mid)] pt-2">
          <span>전체 기록: <span className="font-semibold text-[var(--warm-dark)]">{result.total}건</span></span>
          <span>일치(payMonth = targetMonth & 11일~말일): <span className="font-semibold text-[var(--warm-dark)]">{result.matched}건</span></span>
          <span>재검토 후보: <span className="font-semibold text-amber-600">{dedupedSuspects.length}건</span></span>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      <div className="flex gap-1.5">
        {[
          { k: 'all', label: '전체' },
          { k: 'next-month-early', label: '월초 입금 (직전월 의심)' },
          { k: 'mismatch-other', label: '월 불일치' },
        ].map(({ k, label }) => (
          <button
            key={k}
            onClick={() => setFilter(k as typeof filter)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              filter === k ? 'bg-[var(--coral)] text-white' : 'bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-mid)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-12 text-center text-sm text-[var(--warm-muted)]">
            재검토 대상 기록이 없습니다.
          </div>
        ) : (
          filtered.map(s => (
            <div key={s.id} className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-4 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 text-sm">
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
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  s.category === 'next-month-early'
                    ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                    : 'bg-[var(--canvas)] text-[var(--warm-muted)] ring-1 ring-[var(--warm-border)]'
                }`}>
                  {s.category === 'next-month-early' ? '월초 입금' : '월 불일치'}
                </span>
              </div>

              <div className="flex items-center gap-2 text-xs text-[var(--warm-mid)] flex-wrap">
                <span>현재 귀속:</span>
                <span className="font-semibold text-[var(--warm-dark)]">{s.targetMonth}</span>
                {s.inferredAccrualMonth && (
                  <>
                    <span className="text-[var(--warm-muted)]">→ 추정:</span>
                    <span className="font-semibold text-amber-600">{s.inferredAccrualMonth}</span>
                  </>
                )}
              </div>
              {s.memo && (
                <div className="text-xs text-[var(--warm-muted)] italic">메모: {s.memo}</div>
              )}

              <div className="flex gap-2 pt-1">
                {s.inferredAccrualMonth && s.inferredAccrualMonth !== s.targetMonth && (
                  <button
                    type="button"
                    onClick={() => handleMove(s, s.inferredAccrualMonth!)}
                    disabled={isPending}
                    className="text-xs px-3 py-1.5 rounded-lg bg-[var(--coral)] text-white font-medium hover:opacity-90 disabled:opacity-60 transition-opacity"
                  >
                    {s.inferredAccrualMonth}로 이동
                  </button>
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
        className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg px-2 py-1 text-xs text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]"
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
