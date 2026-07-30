'use client'

// kind='payment' 의 body 조합. 두 모드 지원:
//   - summary: 카드 3개 + 월 이용료/납부일 + 이번 달 납부 내역 (읽기). "수납 관리에서 자세히" 버튼.
//   - full: 카드 + 위젯 (할인·납부일 임시조정·영구 변경) + "고급은 수납 관리에서" 딥링크.
// "수납 관리에서 열기" 클릭 = full 모드 전환 (in-place, 배경 안 바뀜).
// Phase 2.4a (2026-05-30): 저~중 위험 4개 위젯 추출. 고위험(수납 등록·기록 편집·양도인 정산·보증금 분리)
// 은 Phase 2.4b 에서.

import { useEffect, useState, useTransition } from 'react'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Btn } from '@/components/ui/Btn'
import { useRouter } from 'next/navigation'
import { getLeaseSettlementInfo, getPaymentsByLease, setCashReceiptIssued } from '@/app/(app)/rooms/actions'
import { pushToast } from '@/lib/saveStatus'
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

import { fmtWon } from '@/lib/fmtMoney'   // v2.0 §06 단일 경로

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
  // undefined=로딩, null=조회 결과 없음(호실 미지정 등 열 수 없는 상태), 값=정상 (오류신고 890bb698)
  const [settlement, setSettlement] = useState<Settlement | null | undefined>(undefined)
  const [records, setRecords] = useState<Records | null>(null)
  // lease 전체 보증금 실수납 합(조회월 무관) — 예약금 현황 줄·수납 폼 프리필 기준(신고 50a2a69b)
  const [depositPaidTotal, setDepositPaidTotal] = useState(0)
  const [mode, setMode] = useState<'summary' | 'full'>(openCheckoutProration ? 'full' : 'summary')
  const [showEntryForm, setShowEntryForm] = useState(false)
  const [adjOpen, setAdjOpen] = useState(false)   // 청구 조정 이력 펼침(접힘이 기본)
  const [reloadKey, setReloadKey] = useState(0)
  const [, startTransition] = useTransition()

  useEffect(() => {
    let active = true
    getLeaseSettlementInfo(leaseTermId, month).then(d => { if (active) setSettlement(d) })
    getPaymentsByLease(leaseTermId, month)
      .then(d => { if (active) { setRecords(d.records); setDepositPaidTotal(d.depositPaidTotal) } })
      .catch(() => { if (active) setRecords([]) })
    return () => { active = false }
  }, [leaseTermId, month, reloadKey])

  // 셸 내부 settlement/records 재fetch + 페이지(서버 렌더링된 카드 리스트) 무효화.
  // router.refresh() 가 없으면 셸 닫고 페이지로 돌아갔을 때 카드가 여전히 미납으로 보임.
  const refresh = () => startTransition(() => { setReloadKey(k => k + 1); router.refresh() })

  // 현금영수증 원터치 토글 — summary에서 바로, 수정 폼 진입 불필요(오류신고 c0936f89). PaymentRecordList와 동일 문법.
  const handleToggleCashReceipt = (r: NonNullable<Records>[number]) => {
    startTransition(async () => {
      const next = !r.cashReceiptIssuedAt
      const res = await setCashReceiptIssued(r.id, next)
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', next ? '현금영수증 발행으로 표시했습니다' : '현금영수증 발행 표시를 해제했습니다', {
        action: { label: '적용취소', run: () => { void setCashReceiptIssued(r.id, res.prevIssuedAt != null, res.prevIssuedAt).then(u => {
          if (u.ok) refresh(); else pushToast('error', u.error)
        }).catch(() => pushToast('error', '되돌리기 중 통신 오류가 발생했습니다')) } },
      })
      refresh()
    })
  }

  if (settlement === undefined) return <SkeletonRows rows={5} className="py-4" />
  if (settlement === null) return (
    <p className="text-xs text-[var(--warm-muted)] py-4">이 상태의 고객은 수납 정보를 열 수 없습니다. 계약 정보를 확인해 주세요.</p>
  )

  // 청구 조정 전표(단기 연장·감액 마커)는 수납이 아니라 청구 락 조정용 — 납부 내역에 행으로 그리지 않는다.
  // getPaymentsByLease 는 payDate 월 기준이라 전표가 입주월이 아닌 달에도 섞여 들어온다(마커 payDate=조작 시각).
  const payRecords = (records ?? []).filter(r => !r.isBillingAdjust)
  // 예약 단계 예약금 현황 (오류신고 63bf23bc) — 실수납 합은 조회월 무관 lease 전체 기준(신고 50a2a69b).
  // 보증금은 임대료 수식과 분리가 정본이라 잔액에 섞지 않고 이 줄로만 안내.
  // prepaid 모드 선납 실수납 합 — 서버 reservationPaid 우선, 없으면 이 달 record 합산으로 폴백.
  const prepaidReceived = settlement.reservationPaid?.prepaid
    ?? payRecords.filter(r => !r.isDeposit).reduce((s, r) => s + r.actualAmount, 0)
  const resvMode = settlement.reservationDepositMode ?? 'deposit'

  // 청구 조정 이력 — 단기는 입주월 1회 청구라 그 달에서만 보조 줄·배지를 보여준다.
  const adjusts = (settlement.moveInDate?.slice(0, 7) === month ? settlement.billingAdjusts : null) ?? []
  const adjFirst = adjusts[0], adjLast = adjusts[adjusts.length - 1]

  return (
    <div className="space-y-3">
      <PaymentSummaryCards settlement={settlement} month={month} />

      {settlement.status === 'RESERVED' && (
        resvMode === 'none' ? (
          <p className="text-xs text-[var(--warm-muted)] bg-[var(--canvas)] rounded-lg px-3 py-2">예약금 없음</p>
        ) : resvMode === 'prepaid' ? (
          <p className="text-xs bg-[var(--canvas)] rounded-lg px-3 py-2">
            <span className="text-[var(--coral)] font-semibold">이용료 선납</span>
            <span className="ml-1.5 font-semibold text-[var(--warm-dark)]">{fmtWon(prepaidReceived)}</span>
            <span className="text-[var(--warm-muted)]"> (입주월 이용료 충당 예정)</span>
          </p>
        ) : settlement.depositAmount > 0 ? (
          <p className="text-xs bg-[var(--canvas)] rounded-lg px-3 py-2">
            <span className="text-[var(--coral)] font-semibold">보증금 대체</span>
            <span className="ml-1.5 font-semibold text-[var(--warm-dark)]">{fmtWon(depositPaidTotal)}</span>
            <span className="text-[var(--warm-muted)]"> / 계약 보증금 {fmtWon(settlement.depositAmount)}</span>
          </p>
        ) : (
          <p className="text-xs text-[var(--warm-muted)] bg-[var(--canvas)] rounded-lg px-3 py-2">
            계약 보증금이 입력되지 않았습니다. 고객 정보 수정에서 보증금을 입력하면 예약금을 받을 수 있습니다.
          </p>
        )
      )}

      {/* 입주 시 낼 금액 — 할인 반영 이용료에서 선납분을 뺀 값(예약 단계 운영자 질문 1순위). */}
      {settlement.status === 'RESERVED' && settlement.expected > 0 && (
        <p className="text-xs bg-[var(--canvas)] rounded-lg px-3 py-2">
          <span className="text-[var(--coral)] font-semibold">입주 시 납부 예정</span>
          <span className="ml-1.5 font-semibold text-[var(--warm-dark)]">{fmtWon(Math.max(0, settlement.expected - prepaidReceived))}</span>
          {prepaidReceived > 0 && (
            <span className="text-[var(--warm-muted)]"> (이용료 {fmtWon(settlement.expected)} − 선납 {fmtWon(prepaidReceived)})</span>
          )}
        </p>
      )}

      {/* 잔액 근거 한 줄 — 3카드는 그대로 두고 '왜 그 잔액인지'만 덧붙인다(운영자 혼란 방지).
          예약(RESERVED)은 totalPaid 0 고정이라 이 줄이 위 카드(예약금 포함 수납)와 모순돼 보임 —
          '입주 시 납부 예정' 요약 줄이 근거를 대신하므로 숨긴다(신고 50a2a69b 잔여 정합). */}
      {settlement.expected > 0 && settlement.status !== 'RESERVED' && (
        <p className="text-[0.65625rem] text-[var(--warm-muted)] -mt-1">
          청구 {settlement.expected.toLocaleString()} − 납부 {settlement.totalPaid.toLocaleString()}
        </p>
      )}

      <div>
        <Row
          k="월 이용료"
          v={adjusts.length > 0 ? (
            <>
              {fmtWon(settlement.expected)}
              <span className="ml-1.5 text-[0.65625rem] font-semibold bg-[var(--cream-2)] text-[var(--warm-mid)] rounded px-1.5 py-0.5 align-middle whitespace-nowrap">
                {adjLast.kind === 'decrease' ? '감액 반영' : '연장 반영'}
              </span>
            </>
          ) : fmtWon(settlement.expected)}
          sub={adjusts.length > 0 ? (
            <div className="mt-0.5">
              {/* 보조 줄 — 최초값과 현재값만. 여러 번이면 눌러 펴서 최신순 전체(접힘이 기본). */}
              <button type="button" disabled={adjusts.length < 2} onClick={() => setAdjOpen(o => !o)}
                className="text-left text-[0.65625rem] text-[var(--warm-muted)] disabled:cursor-default">
                {fmtAdjDate(adjLast.at)} {adjLast.kind === 'decrease' ? '감액' : '연장'} 반영 · {adjFirst.prev.toLocaleString()} → <span className="text-[var(--warm-dark)]">{adjLast.next.toLocaleString()}</span>
                {adjusts.length > 1 && <> · {adjustCountLabel(adjusts)} {adjOpen ? '접기' : '보기'}</>}
              </button>
              {adjOpen && adjusts.length > 1 && (
                <ul className="mt-0.5 space-y-0.5">
                  {[...adjusts].reverse().map((a, i) => (
                    <li key={`${a.at}-${i}`} className="text-[0.65625rem] text-[var(--warm-muted)]">
                      {fmtAdjDate(a.at)} · {a.prev.toLocaleString()} → <span className="text-[var(--warm-dark)]">{a.next.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : undefined}
        />
        {settlement.dueDay && (() => {
          // 임시 조정 활성(이 달) — settlement.dueDay는 override 반영값이라 '매월'로 쓰면 오해(오류신고 7c8c5fcd).
          const ovrActive = !!settlement.overrideDueDay && settlement.overrideDueDayMonth === month
          const d = settlement.dueDay
          const dayLabel = d.includes('-') ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : d.includes('말') ? '말일' : `${d}일`
          return <Row k="납부일" v={ovrActive
            ? <>이달 {dayLabel} <span className="text-[var(--warning-fg)]">(임시)</span></>
            : d.includes('말') ? '매월 말일' : `매월 ${d}일`} />
        })()}
      </div>

      {mode === 'summary' && (
        <>
          {/* 이번 달 납부 내역 — 읽기. 편집은 full 모드. */}
          <div className="space-y-1">
            <p className="text-xs font-semibold text-[var(--warm-mid)]">이번 달 납부 내역</p>
            {records === null ? (
              <SkeletonRows rows={2} className="py-1" />
            ) : payRecords.length === 0 ? (
              <p className="text-xs text-[var(--warm-muted)] py-2">이 달 납부 기록이 없습니다.</p>
            ) : (
              <ul className="space-y-1">
                {payRecords.map(r => {
                  const t = new Date(r.payDate)
                  const payDateStr = `${t.getMonth() + 1}.${t.getDate()}`
                  return (
                    <li key={r.id} className="flex items-center justify-between gap-2 bg-[var(--canvas)] rounded-lg px-3 py-2 text-xs">
                      <span className="text-[var(--warm-mid)] min-w-0 flex items-center gap-1.5 flex-wrap">
                        <span>
                          {payDateStr}
                          {r.isDeposit && <span className="ml-1.5 text-[0.65625rem] text-[var(--coral)]">보증금</span>}
                          {r.payMethod && <span className="ml-1.5 text-[var(--warm-muted)]">· {r.payMethod}</span>}
                        </span>
                        {/* 현금영수증 원터치 — 수정 폼 없이 발행 표시(오류신고 c0936f89).
                            배지 옷을 입어 눌리는 걸 몰랐던 문제(신고 241c02ea)로 체크박스 정본(수납 폼과 동일 문법)으로 교체.
                            즉시 저장 + 적용취소 토스트 동작은 그대로, 히트영역만 44px(-my-2 확장 문법). */}
                        {canEdit ? (
                          <label className="inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap -my-2 min-h-[44px]">
                            <input type="checkbox" checked={!!r.cashReceiptIssuedAt} onChange={() => handleToggleCashReceipt(r)}
                              className="w-3.5 h-3.5 accent-[var(--coral)]" />
                            <span className={`text-[0.65625rem] font-semibold ${r.cashReceiptIssuedAt ? 'text-[var(--success-fg)]' : 'text-[var(--warm-muted)]'}`}>
                              {r.cashReceiptIssuedAt ? '현금영수증' : '현금영수증 미발행'}
                            </span>
                          </label>
                        ) : (
                          r.cashReceiptIssuedAt && <span className="text-[0.65625rem] font-semibold bg-[var(--success-bg)] text-[var(--success-fg)] rounded px-1.5 py-0.5 whitespace-nowrap">현금영수증</span>
                        )}
                      </span>
                      <span className="font-semibold text-[var(--warm-dark)] whitespace-nowrap">{fmtWon(r.actualAmount)}</span>
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
                  status: settlement.status,
                  reservationDepositMode: settlement.reservationDepositMode,
                }}
                depositPaidTotal={depositPaidTotal}
                targetMonth={month}
                onSaved={() => { setShowEntryForm(false); refresh() }}
                onCancel={() => setShowEntryForm(false)}
              />
            ) : (
              <div className="flex gap-2">
                <Btn variant="primary" size="md" onClick={() => setShowEntryForm(true)} className="flex-1 font-semibold">
                  + 수납 등록
                </Btn>
                <button type="button" onClick={() => setMode('full')}
                  className="px-3 py-2 text-xs font-medium rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-mid)] hover:bg-[var(--warm-border)] transition-colors">
                  더 보기 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="inline-block align-middle" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                </button>
              </div>
            )
          )}

          {/* 권한 없는 사용자엔 '더 보기'만 */}
          {!canEdit && (
            <button type="button" onClick={() => setMode('full')}
              className="w-full py-1.5 text-[0.6875rem] font-medium rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-mid)] hover:bg-[var(--warm-border)] transition-colors">
              더 보기 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="inline-block align-middle" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
            </button>
          )}
        </>
      )}

      {mode === 'full' && (
        <>
          <button type="button" onClick={() => setMode('summary')}
            className="w-full py-1.5 text-[0.6875rem] font-medium rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-mid)] hover:bg-[var(--warm-border)] transition-colors">
            요약으로 돌아가기 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="inline-block align-middle" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
          </button>

          {/* 납부 내역 — 편집·삭제 (이번 달 기준) */}
          <PaymentRecordList leaseTermId={leaseTermId} targetMonth={month} canEdit={canEdit} onChange={refresh} reloadSignal={reloadKey} />

          {/* 전체 수납 내역 — 모든 달(언제·얼마·귀속월·방식). 접기/펼치기. */}
          <PaymentHistoryAll leaseTermId={leaseTermId} reloadSignal={reloadKey} />

          {/* 새 수납 등록 (접힘/펼침) */}
          {canEdit && settlement.leaseTermId && settlement.tenantId && (
            !showEntryForm ? (
              <Btn variant="primary" size="md" onClick={() => setShowEntryForm(true)} fullWidth className="font-semibold">
                + 수납 등록
              </Btn>
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
                  status: settlement.status,
                  reservationDepositMode: settlement.reservationDepositMode,
                }}
                depositPaidTotal={depositPaidTotal}
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

function Row({ k, v, sub }: { k: string; v: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="py-1.5 border-b border-[var(--warm-border)]/50 last:border-0">
      <div className="flex justify-between">
        <span className="text-xs text-[var(--warm-muted)]">{k}</span>
        <span className="text-sm text-[var(--warm-dark)]">{v}</span>
      </div>
      {sub}
    </div>
  )
}

// 청구 조정 시각 '7.26'
function fmtAdjDate(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}.${d.getDate()}`
}

// '연장 2회' — 연장·감액이 섞이면 '조정 N회'
function adjustCountLabel(list: { kind: 'increase' | 'decrease' }[]): string {
  const kinds = new Set(list.map(a => a.kind))
  const word = kinds.size > 1 ? '조정' : list[0].kind === 'decrease' ? '감액' : '연장'
  return `${word} ${list.length}회`
}
