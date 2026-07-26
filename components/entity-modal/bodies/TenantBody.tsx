'use client'

// kind='tenant' 의 body 조합 — 위젯들을 한 화면 스크롤로 배치.
// Phase 2.3b: 표시 위주 (기본·연락처·계약·추가·메모·계약서 파일 + 수납 요약 + AI 분석).
// 상태 전환 / 납입일 변경 / 편집 / 요청·컴플레인 CRUD 는 /tenants?tenantId=X 로 딥링크.

import { useEffect, useState, useTransition } from 'react'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { getTenantDetail } from '@/app/(app)/rooms/actions'
import { analyzeTenantWithGemini, undoRentRefund } from '@/app/(app)/tenants/actions'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { pushToast } from '@/lib/saveStatus'
import { fmtWon } from '@/lib/fmtMoney'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Btn } from '@/components/ui/Btn'
import { STATUS_LABEL, statusException } from '@/lib/statusColors'
import { TenantBasicInfo } from '../widgets/TenantBasicInfo'
import { ShortStayInfoWidget } from '../widgets/ShortStayInfoWidget'
import { TenantContactInfo } from '../widgets/TenantContactInfo'
import { TenantContractInfo } from '../widgets/TenantContractInfo'
import { TenantAdditionalInfo } from '../widgets/TenantAdditionalInfo'
import { ContractFilesPanel } from '../widgets/ContractFilesPanel'
import { TenantStatusTransitions } from '../widgets/TenantStatusTransitions'
import { TenantRequestsTab } from '../widgets/TenantRequestsTab'
import { Section } from '../widgets/Section'
import { resolveReservationDepositMode } from '@/lib/reservationDeposit'

type TenantDetail = NonNullable<Awaited<ReturnType<typeof getTenantDetail>>>

export function TenantBody({ tenantId }: { tenantId: string }) {
  const [tenant, setTenant] = useState<TenantDetail | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  useEffect(() => {
    let active = true
    getTenantDetail(tenantId).then(d => { if (active && d) setTenant(d as TenantDetail) })
    return () => { active = false }
  }, [tenantId, reloadKey])
  const refresh = () => setReloadKey(k => k + 1)

  if (!tenant) return <SkeletonRows rows={5} className="py-4" />

  const lease = tenant.leaseTerms[0]
  const status = lease?.status ?? ''

  return (
    <div className="space-y-5">
      {/* 상태 칩 — 헤더 제목 옆에 두지 않고 본문 최상단에 (셸 제목은 호실·이름) */}
      {status && <StatusInline status={status} confirmed={!!lease?.reservationConfirmedAt} hasTourDate={!!lease?.tourDate} />}

      {/* 상태 전환 (다음 단계 버튼) — 가능한 전환이 없으면 자동 숨김 */}
      {lease && (
        <TenantStatusTransitions
          lease={{
            id: lease.id, status: lease.status, depositAmount: lease.depositAmount, cleaningFee: lease.cleaningFee,
            moveInDate: lease.moveInDate, expectedMoveOut: lease.expectedMoveOut, rentAmount: lease.rentAmount,
            dueDay: lease.dueDay, isShortTerm: lease.isShortTerm,
            reservationConfirmedAt: lease.reservationConfirmedAt, roomId: lease.room?.id ?? null,
            reservationDepositMode: resolveReservationDepositMode(
              lease.reservationDepositMode, lease.property?.reservationDepositMode, lease.isShortTerm,
            ),
          }}
          tenantId={tenant.id}
          tenantName={tenant.name}
          onChange={refresh}
        />
      )}

      <TenantBasicInfo tenant={tenant} />
      <TenantContactInfo tenantId={tenant.id} contacts={tenant.contacts} email={tenant.email} />
      {lease && <TenantContractInfo lease={lease} />}
      {/* 중도퇴실 환불 확정 — 상시 적용취소 진입점(§16, 토스트가 사라져도 여기서 항상 가능) */}
      {lease && (() => {
        const undoObj = lease.checkoutProrationUndo as { refund?: { refunded: number; month: string } } | null
        const snap = undoObj?.refund
        if (!snap) return null
        return <RentRefundUndoRow leaseTermId={lease.id} refunded={snap.refunded} month={snap.month} onDone={refresh} />
      })()}
      {/* 단기 희망 고객 — 기간·방 컨디션별 요금 박스(운영자 확정 2026-07-10 a안) */}
      {lease && lease.isShortTerm && <ShortStayInfoWidget lease={lease} tenantId={tenant.id} tenantName={tenant.name} onChange={refresh} />}
      {lease && <TenantAdditionalInfo lease={lease} />}

      {tenant.memo && (
        <Section title="메모">
          <p className="text-sm text-[var(--warm-dark)] leading-relaxed whitespace-pre-wrap">{tenant.memo}</p>
        </Section>
      )}

      <Section title="계약서 파일">
        <ContractFilesPanel tenantId={tenant.id} tenantName={tenant.name} />
      </Section>

      <TenantRequestsTab tenantId={tenant.id} />

      {lease && lease.paymentRecords.length > 0 && (
        <PaymentSummaryWithAI tenantId={tenant.id} lease={lease} />
      )}
    </div>
  )
}

// 중도퇴실 환불 확정 표시 + 상시 적용취소 — 스냅샷은 서버(checkoutProrationUndo.refund)에 영속
function RentRefundUndoRow({ leaseTermId, refunded, month, onDone }: {
  leaseTermId: string; refunded: number; month: string; onDone: () => void
}) {
  const [pending, startTransition] = useTransition()
  const handleUndo = async () => {
    const ok = await confirmDialog({
      title: '이용료 환불을 적용취소할까요?',
      message: '원래 수납 기록을 복원하고 청구를 환불 전 상태로 되돌립니다.',
      confirmLabel: '적용취소',
    })
    if (!ok) return
    startTransition(async () => {
      const r = await undoRentRefund(leaseTermId)
      if (r.ok) { pushToast('info', '이용료 환불을 적용취소했습니다.'); onDone() }
      else pushToast('error', r.error)
    })
  }
  return (
    <div className="flex items-center justify-between gap-2 bg-[var(--canvas)] rounded-lg px-3 py-2 text-xs">
      <p className="text-[var(--warm-mid)]">
        중도퇴실 환불 확정 · {Number(month.slice(5, 7))}월 이용료 <span className="tabular-nums text-[var(--warm-dark)]">{fmtWon(refunded)}</span> 환불
      </p>
      <button type="button" onClick={handleUndo} disabled={pending}
        className="shrink-0 text-[0.65625rem] px-2 py-1 rounded-md border border-[var(--warm-border)] text-[var(--warm-mid)] hover:bg-[var(--warm-border)]/40 transition-colors disabled:opacity-50">
        {pending ? '취소 중…' : '적용취소'}
      </button>
    </div>
  )
}

// 파생 라벨(문의/입실 예약/예약 확정)은 목록 StatusChip과 동일 규칙 — e1b81629 용어 재정의
function StatusInline({ status, confirmed, hasTourDate }: { status: string; confirmed?: boolean; hasTourDate?: boolean }) {
  const ex = statusException(status, { hasTourDate })
  return ex
    ? <div><StatusBadge tone={ex.tone}>{status === 'RESERVED' && confirmed ? '예약 확정' : ex.label}</StatusBadge></div>
    : <div className="text-xs font-medium text-[var(--warm-mid)]">{STATUS_LABEL[status] ?? status}</div>
}

function PaymentSummaryWithAI({ tenantId, lease }: {
  tenantId: string
  lease: { paymentRecords: { expectedAmount: number; actualAmount: number; isPaid: boolean }[] }
}) {
  const payments = lease.paymentRecords
  const totalExpected = payments.reduce((s, p) => s + p.expectedAmount, 0)
  const totalPaid     = payments.reduce((s, p) => s + p.actualAmount, 0)
  const unpaid        = totalExpected - totalPaid
  const paidMonths    = payments.filter(p => p.isPaid).length

  const [aiText, setAiText] = useState('')
  const [pending, startTransition] = useTransition()

  const handleAnalyze = () => {
    startTransition(async () => {
      setAiText('')
      try {
        const result = await analyzeTenantWithGemini(tenantId)
        setAiText(result)
      } catch {
        setAiText('분석 중 오류가 발생했습니다.')
      }
    })
  }

  return (
    <Section title="수납 분석">
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-[var(--canvas)] rounded-xl p-3 text-center min-w-0">
          <p className="text-xs text-[var(--warm-muted)] mb-1">납부월</p>
          <p className="text-base font-bold text-[var(--success-fg)] whitespace-nowrap">{paidMonths}개월</p>
        </div>
        <div className="bg-[var(--canvas)] rounded-xl p-3 text-center min-w-0">
          <p className="text-xs text-[var(--warm-muted)] mb-1">총 납부액</p>
          <p className="text-base font-bold text-[var(--warm-dark)] whitespace-nowrap"><MoneyDisplay amount={totalPaid} /></p>
        </div>
        <div className="bg-[var(--canvas)] rounded-xl p-3 text-center min-w-0">
          <p className="text-xs text-[var(--warm-muted)] mb-1">미납액</p>
          <p className={`text-base font-bold whitespace-nowrap ${unpaid > 0 ? 'text-[var(--danger-fg)]' : 'text-[var(--warm-dark)]'}`}>
            <MoneyDisplay amount={unpaid} />
          </p>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        <Btn variant="primary" size="sm" onClick={handleAnalyze} disabled={pending} fullWidth className="font-semibold">
          {pending ? 'AI 분석 중…' : aiText ? '다시 분석' : 'AI로 수납 패턴 분석'}
        </Btn>
        {pending && (
          <div className="flex items-center gap-2 text-xs text-[var(--coral)] animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--coral)] animate-bounce" />
            AI가 수납 패턴을 분석하고 있습니다…
          </div>
        )}
        {aiText && !pending && (
          <p className="text-sm text-[var(--warm-dark)] leading-relaxed whitespace-pre-wrap bg-[var(--canvas)] rounded-xl p-3">{aiText}</p>
        )}
      </div>
    </Section>
  )
}
