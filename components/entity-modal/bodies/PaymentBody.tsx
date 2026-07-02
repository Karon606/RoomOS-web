'use client'

// kind='payment' 의 body 조합. 두 모드 지원:
//   - summary: 카드 3개 + 월 이용료/납부일 + 이번 달 납부 내역 (읽기). "수납 관리에서 자세히" 버튼.
//   - full: 카드 + 위젯 (할인·납부일 임시조정·영구 변경) + "고급은 수납 관리에서" 딥링크.
// "수납 관리에서 열기" 클릭 = full 모드 전환 (in-place, 배경 안 바뀜).
// Phase 2.4a (2026-05-30): 저~중 위험 4개 위젯 추출. 고위험(수납 등록·기록 편집·양도인 정산·보증금 분리)
// 은 Phase 2.4b 에서.

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { getLeaseSettlementInfo, getPaymentsByLease } from '@/app/(app)/rooms/actions'
import { PaymentSummaryCards } from '../widgets/PaymentSummaryCards'
import { DiscountWidget } from '../widgets/DiscountWidget'
import { DueDayTempAdjustWidget } from '../widgets/DueDayTempAdjustWidget'
import { DueDayPermanentChangeWidget } from '../widgets/DueDayPermanentChangeWidget'
import { CheckoutProrationWidget } from '../widgets/CheckoutProrationWidget'
import { PaymentRecordList } from '../widgets/PaymentRecordList'
import { PaymentHistoryAll } from '../widgets/PaymentHistoryAll'
import { PaymentEntryForm } from '../widgets/PaymentEntryForm'
import { PrevOwnerSettleWidget } from '../widgets/PrevOwnerSettleWidget'

type Settlement = NonNullable<Awaited<ReturnType<typeof getLeaseSettlementInfo>>>
type Records = Awaited<ReturnType<typeof getPaymentsByLease>>['records']

const fmtWon = (n: number) => `${n.toLocaleString()}원`

export function PaymentBody({ leaseTermId, month, canEdit, roomNo, openCheckoutProration }: {
  leaseTermId: string
  month: string
  canEdit: boolean
  /** 'XX호' — full 모드에서 "수납 관리에서 열기" 딥링크용. */
  roomNo?: string | null
  /** 고객관리 '퇴실 정산?' 팝업에서 '예' 진입 시 — full 모드로 열고 퇴실 정산 위젯 자동 펼침. */
  openCheckoutProration?: boolean
}) {
  const router = useRouter()
  const [settlement, setSettlement] = useState<Settlement | null>(null)
  const [records, setRecords] = useState<Records | null>(null)
  const [mode, setMode] = useState<'summary' | 'full'>(openCheckoutProration ? 'full' : 'summary')
  const [showEntryForm, setShowEntryForm] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [, startTransition] = useTransition()

  useEffect(() => {
    let active = true
    getLeaseSettlementInfo(leaseTermId, month).then(d => { if (active) setSettlement(d) })
    getPaymentsByLease(leaseTermId, month).then(d => { if (active) setRecords(d.records) }).catch(() => { if (active) setRecords([]) })
    return () => { active = false }
  }, [leaseTermId, month, reloadKey])

  // 셸 내부 settlement/records 재fetch + 페이지(서버 렌더링된 카드 리스트) 무효화.
  // router.refresh() 가 없으면 셸 닫고 페이지로 돌아갔을 때 카드가 여전히 미납으로 보임.
  const refresh = () => startTransition(() => { setReloadKey(k => k + 1); router.refresh() })

  if (!settlement) return <p className="text-sm text-[var(--warm-muted)] text-center py-8">불러오는 중…</p>

  return (
    <div className="space-y-3">
      <PaymentSummaryCards settlement={settlement} month={month} />

      <div>
        <Row k="월 이용료" v={fmtWon(settlement.expected)} />
        {settlement.dueDay && (() => {
          // 임시 조정 활성(이 달) — settlement.dueDay는 override 반영값이라 '매월'로 쓰면 오해(오류신고 7c8c5fcd).
          const ovrActive = !!settlement.overrideDueDay && settlement.overrideDueDayMonth === month
          const d = settlement.dueDay
          const dayLabel = d.includes('-') ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : d.includes('말') ? '말일' : `${d}일`
          return <Row k="납부일" v={ovrActive
            ? <>이번 달만 {dayLabel} <span className="text-[var(--warning-fg)]">(임시 조정)</span></>
            : d.includes('말') ? '매월 말일' : `매월 ${d}일`} />
        })()}
      </div>

      {mode === 'summary' && (
        <>
          {/* 이번 달 납부 내역 — 읽기. 편집은 full 모드. */}
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

          {/* 수납 등록은 summary 에서도 직접 — 가장 잦은 작업이라 1탭으로. */}
          {canEdit && settlement.leaseTermId && settlement.tenantId && (
            showEntryForm ? (
              <PaymentEntryForm
                room={{
                  leaseTermId: settlement.leaseTermId,
                  tenantId: settlement.tenantId,
                  expected: settlement.expected,
                  balance: settlement.balance,
                  depositAmount: settlement.depositAmount,
                  cleaningFee: settlement.cleaningFee,
                  moveInDate: settlement.moveInDate,
                  roomNo: roomNo,
                }}
                targetMonth={month}
                onSaved={() => { setShowEntryForm(false); refresh() }}
                onCancel={() => setShowEntryForm(false)}
              />
            ) : (
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowEntryForm(true)}
                  className="flex-1 py-2 text-sm font-semibold rounded-lg bg-[var(--coral)] text-white hover:opacity-90 transition-opacity">
                  + 수납 등록
                </button>
                <button type="button" onClick={() => setMode('full')}
                  className="px-3 py-2 text-xs font-medium rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-mid)] hover:bg-[var(--warm-border)] transition-colors">
                  더 보기 ▾
                </button>
              </div>
            )
          )}

          {/* 권한 없는 사용자엔 '더 보기'만 */}
          {!canEdit && (
            <button type="button" onClick={() => setMode('full')}
              className="w-full py-1.5 text-[0.6875rem] font-medium rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-mid)] hover:bg-[var(--warm-border)] transition-colors">
              더 보기 ▾
            </button>
          )}
        </>
      )}

      {mode === 'full' && (
        <>
          <button type="button" onClick={() => setMode('summary')}
            className="w-full py-1.5 text-[0.6875rem] font-medium rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-mid)] hover:bg-[var(--warm-border)] transition-colors">
            요약으로 돌아가기 ▲
          </button>

          {/* 납부 내역 — 편집·삭제 (이번 달 기준) */}
          <PaymentRecordList leaseTermId={leaseTermId} targetMonth={month} canEdit={canEdit} onChange={refresh} reloadSignal={reloadKey} />

          {/* 전체 수납 내역 — 모든 달(언제·얼마·귀속월·방식). 접기/펼치기. */}
          <PaymentHistoryAll leaseTermId={leaseTermId} reloadSignal={reloadKey} />

          {/* 새 수납 등록 (접힘/펼침) */}
          {canEdit && settlement.leaseTermId && settlement.tenantId && (
            !showEntryForm ? (
              <button type="button" onClick={() => setShowEntryForm(true)}
                className="w-full py-2 text-sm font-semibold rounded-lg bg-[var(--coral)] text-white hover:opacity-90 transition-opacity">
                + 수납 등록
              </button>
            ) : (
              <PaymentEntryForm
                room={{
                  leaseTermId: settlement.leaseTermId,
                  tenantId: settlement.tenantId,
                  expected: settlement.expected,
                  balance: settlement.balance,
                  depositAmount: settlement.depositAmount,
                  cleaningFee: settlement.cleaningFee,
                  moveInDate: settlement.moveInDate,
                  roomNo: roomNo,
                }}
                targetMonth={month}
                onSaved={() => { setShowEntryForm(false); refresh() }}
                onCancel={() => setShowEntryForm(false)}
              />
            )
          )}

          <DiscountWidget leaseTermId={leaseTermId} onChange={refresh} />

          <DueDayTempAdjustWidget
            leaseTermId={leaseTermId}
            targetMonth={month}
            firstUnpaidMonth={settlement.firstUnpaidMonth}
            room={{
              overrideDueDay: settlement.overrideDueDay,
              overrideDueDayMonth: settlement.overrideDueDayMonth,
              overrideDueDayReason: settlement.overrideDueDayReason,
              dueDay: settlement.dueDay,
            }}
            canEdit={canEdit}
            onChange={refresh}
          />

          <DueDayPermanentChangeWidget
            leaseTermId={leaseTermId}
            targetMonth={month}
            expected={settlement.expected}
            currentDueDay={settlement.dueDay}
            onChange={refresh}
          />

          {/* 퇴실 정산(일할) — 거주중·퇴실예정 계약에서만 */}
          {canEdit && (settlement.status === 'ACTIVE' || settlement.status === 'CHECKOUT_PENDING') && (
            <CheckoutProrationWidget
              leaseTermId={leaseTermId}
              currentDueDay={settlement.dueDay}
              expectedMoveOut={settlement.expectedMoveOut}
              checkoutProratedAmount={settlement.checkoutProratedAmount}
              checkoutProratedMonth={settlement.checkoutProratedMonth}
              autoOpen={openCheckoutProration}
              onChange={refresh}
            />
          )}

          <PrevOwnerSettleWidget
            leaseTermId={leaseTermId}
            targetMonth={month}
            canEdit={canEdit}
            onChange={refresh}
          />
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
