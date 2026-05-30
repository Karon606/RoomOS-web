'use client'

// kind='payment' 의 body 조합. 두 모드 지원:
//   - summary: 카드 3개 + 월 이용료/납부일 + 이번 달 납부 내역 (읽기). "수납 관리에서 자세히" 버튼.
//   - full: 카드 + 위젯 (할인·납부일 임시조정·영구 변경) + "고급은 수납 관리에서" 딥링크.
// "수납 관리에서 열기" 클릭 = full 모드 전환 (in-place, 배경 안 바뀜).
// Phase 2.4a (2026-05-30): 저~중 위험 4개 위젯 추출. 고위험(수납 등록·기록 편집·양도인 정산·보증금 분리)
// 은 Phase 2.4b 에서.

import { useEffect, useState, useTransition } from 'react'
import { getLeaseSettlementInfo, getPaymentsByLease } from '@/app/(app)/rooms/actions'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { PaymentSummaryCards } from '../widgets/PaymentSummaryCards'
import { DiscountWidget } from '../widgets/DiscountWidget'
import { DueDayTempAdjustWidget } from '../widgets/DueDayTempAdjustWidget'
import { DueDayPermanentChangeWidget } from '../widgets/DueDayPermanentChangeWidget'

type Settlement = NonNullable<Awaited<ReturnType<typeof getLeaseSettlementInfo>>>
type Records = Awaited<ReturnType<typeof getPaymentsByLease>>['records']

const fmtWon = (n: number) => `${n.toLocaleString()}원`

export function PaymentBody({ leaseTermId, month, canEdit, roomNo }: {
  leaseTermId: string
  month: string
  canEdit: boolean
  /** 'XX호' — full 모드에서 "수납 관리에서 열기" 딥링크용. */
  roomNo?: string | null
}) {
  const [settlement, setSettlement] = useState<Settlement | null>(null)
  const [records, setRecords] = useState<Records | null>(null)
  const [mode, setMode] = useState<'summary' | 'full'>('summary')
  const [reloadKey, setReloadKey] = useState(0)
  const [, startTransition] = useTransition()

  useEffect(() => {
    let active = true
    getLeaseSettlementInfo(leaseTermId, month).then(d => { if (active) setSettlement(d) })
    getPaymentsByLease(leaseTermId, month).then(d => { if (active) setRecords(d.records) }).catch(() => { if (active) setRecords([]) })
    return () => { active = false }
  }, [leaseTermId, month, reloadKey])

  const refresh = () => startTransition(() => setReloadKey(k => k + 1))

  if (!settlement) return <p className="text-sm text-[var(--warm-muted)] text-center py-8">불러오는 중…</p>

  return (
    <div className="space-y-3">
      <PaymentSummaryCards settlement={settlement} month={month} />

      <div>
        <Row k="월 이용료" v={fmtWon(settlement.expected)} />
        {settlement.dueDay && <Row k="납부일" v={settlement.dueDay.includes('말') ? '매월 말일' : `매월 ${settlement.dueDay}일`} />}
      </div>

      {mode === 'summary' && (
        <>
          {/* 이번 달 납부 내역 — 읽기. 편집은 full 모드 또는 수납 관리에서. */}
          <div className="space-y-1">
            <p className="text-xs font-semibold text-[var(--warm-mid)]">이번 달 납부 내역</p>
            {records === null ? (
              <p className="text-xs text-[var(--warm-muted)] py-2">불러오는 중…</p>
            ) : records.length === 0 ? (
              <p className="text-xs text-[var(--warm-muted)] py-2">이 달 납부 기록이 없습니다.</p>
            ) : (
              <ul className="space-y-1">
                {records.map(r => {
                  const t = new Date(r.payDate)
                  const payDateStr = `${t.getMonth() + 1}.${t.getDate()}`
                  return (
                    <li key={r.id} className="flex items-center justify-between bg-[var(--canvas)] rounded-lg px-3 py-2 text-xs">
                      <span className="text-[var(--warm-mid)]">
                        {payDateStr}
                        {r.isDeposit && <span className="ml-1.5 text-[0.5625rem] text-[var(--coral)]">보증금</span>}
                        {r.payMethod && <span className="ml-1.5 text-[var(--warm-muted)]">· {r.payMethod}</span>}
                      </span>
                      <span className="font-semibold text-[var(--warm-dark)]">{fmtWon(r.actualAmount)}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <button type="button" onClick={() => setMode('full')}
            className="w-full py-2 text-xs font-semibold rounded-lg bg-[var(--coral)] text-white hover:opacity-90 transition-opacity">
            수납 관리에서 자세히 ▼ (할인·납부일 조정 등)
          </button>
        </>
      )}

      {mode === 'full' && (
        <>
          <button type="button" onClick={() => setMode('summary')}
            className="w-full py-1.5 text-[0.6875rem] font-medium rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-mid)] hover:bg-[var(--warm-border)] transition-colors">
            요약으로 돌아가기 ▲
          </button>

          <DiscountWidget leaseTermId={leaseTermId} onChange={refresh} />

          {/* 임시 조정 + 영구 변경은 selectedRoom 의 override/dueDay/expected 가 필요한데,
              shell 에선 getLeaseSettlementInfo 가 dueDay·expected 만 제공.
              override 정보는 별도 server fetch 필요 — 단순화를 위해 임시 조정은
              레거시 수납 관리 페이지로 위임(아래 딥링크). 영구 변경은 expected+dueDay 충분. */}
          <DueDayPermanentChangeWidget
            leaseTermId={leaseTermId}
            targetMonth={month}
            expected={settlement.expected}
            currentDueDay={settlement.dueDay}
            onChange={refresh}
          />

          {/* 고위험·미추출 기능(수납 등록·내역 편집·양도인 정산·보증금 분리·임시 조정)은 수납 관리 페이지로 */}
          {roomNo && (
            <a href={`/rooms?month=${month}&roomNo=${roomNo}`}
              className="block text-center text-xs font-medium text-[var(--coral)] hover:underline py-2">
              수납 등록·내역 편집·양도인 정산·임시 조정 → 수납 관리에서
            </a>
          )}
        </>
      )}
    </div>
  )
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-[var(--warm-border)]/50 last:border-0">
      <span className="text-xs text-[var(--warm-muted)]">{k}</span>
      <span className="text-sm text-[var(--warm-dark)]">{v}</span>
    </div>
  )
}
