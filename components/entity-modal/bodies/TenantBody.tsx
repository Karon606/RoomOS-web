'use client'

// kind='tenant' 의 body 조합 — 위젯들을 한 화면 스크롤로 배치.
// Phase 2.3b: 표시 위주 (기본·연락처·계약·추가·메모·계약서 파일 + 수납 요약 + AI 분석).
// 상태 전환 / 납입일 변경 / 편집 / 요청·컴플레인 CRUD 는 /tenants?tenantId=X 로 딥링크.

import { useEffect, useState, useTransition } from 'react'
import { getTenantDetail } from '@/app/(app)/rooms/actions'
import { analyzeTenantWithGemini } from '@/app/(app)/tenants/actions'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { STATUS_LABEL, statusException } from '@/lib/statusColors'
import { TenantBasicInfo } from '../widgets/TenantBasicInfo'
import { TenantContactInfo } from '../widgets/TenantContactInfo'
import { TenantContractInfo } from '../widgets/TenantContractInfo'
import { TenantAdditionalInfo } from '../widgets/TenantAdditionalInfo'
import { ContractFilesPanel } from '../widgets/ContractFilesPanel'
import { Section } from '../widgets/Section'

type TenantDetail = NonNullable<Awaited<ReturnType<typeof getTenantDetail>>>

export function TenantBody({ tenantId }: { tenantId: string }) {
  const [tenant, setTenant] = useState<TenantDetail | null>(null)
  useEffect(() => {
    let active = true
    getTenantDetail(tenantId).then(d => { if (active && d) setTenant(d as TenantDetail) })
    return () => { active = false }
  }, [tenantId])

  if (!tenant) return <p className="text-sm text-[var(--warm-muted)] text-center py-8">불러오는 중…</p>

  const lease = tenant.leaseTerms[0]
  const status = lease?.status ?? ''

  return (
    <div className="space-y-5">
      {/* 상태 칩 — 헤더 제목 옆에 두지 않고 본문 최상단에 (셸 제목은 호실·이름) */}
      {status && <StatusInline status={status} />}

      <TenantBasicInfo tenant={tenant} />
      <TenantContactInfo contacts={tenant.contacts} />
      {lease && <TenantContractInfo lease={lease} />}
      {lease && <TenantAdditionalInfo lease={lease} />}

      {tenant.memo && (
        <Section title="메모">
          <p className="text-sm text-[var(--warm-dark)] leading-relaxed whitespace-pre-wrap">{tenant.memo}</p>
        </Section>
      )}

      <Section title="계약서 파일">
        <ContractFilesPanel tenantId={tenant.id} tenantName={tenant.name} />
      </Section>

      {lease && lease.paymentRecords.length > 0 && (
        <PaymentSummaryWithAI tenantId={tenant.id} lease={lease} />
      )}

      {/* 상태 전환·납입일 변경·요청 등 페이지 기능 진입 */}
      <a href={`/tenants?tenantId=${tenant.id}`}
        className="block text-center text-xs font-medium text-[var(--coral)] hover:underline py-2">
        고객 관리에서 더 보기 (상태 전환·요청·편집) →
      </a>
    </div>
  )
}

function StatusInline({ status }: { status: string }) {
  const ex = statusException(status)
  return ex
    ? <div><StatusBadge tone={ex.tone}>{ex.label}</StatusBadge></div>
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
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-[var(--canvas)] rounded-xl p-3 text-center">
          <p className="text-xs text-[var(--warm-muted)] mb-1">납부월</p>
          <p className="text-lg font-bold text-green-400">{paidMonths}개월</p>
        </div>
        <div className="bg-[var(--canvas)] rounded-xl p-3 text-center">
          <p className="text-xs text-[var(--warm-muted)] mb-1">총 납부액</p>
          <p className="text-lg font-bold text-[var(--warm-dark)]"><MoneyDisplay amount={totalPaid} /></p>
        </div>
        <div className="bg-[var(--canvas)] rounded-xl p-3 text-center">
          <p className="text-xs text-[var(--warm-muted)] mb-1">미납액</p>
          <p className={`text-lg font-bold ${unpaid > 0 ? 'text-red-400' : 'text-[var(--warm-dark)]'}`}>
            <MoneyDisplay amount={unpaid} />
          </p>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        <button type="button" onClick={handleAnalyze} disabled={pending}
          className="w-full py-2 text-xs font-semibold rounded-lg bg-[var(--coral)] text-white hover:opacity-90 transition-opacity disabled:opacity-60">
          {pending ? 'AI 분석 중...' : aiText ? '다시 분석' : 'AI로 수납 패턴 분석'}
        </button>
        {pending && (
          <div className="flex items-center gap-2 text-xs text-[var(--coral)] animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--coral)] animate-bounce" />
            AI가 수납 패턴을 분석하고 있습니다...
          </div>
        )}
        {aiText && !pending && (
          <p className="text-sm text-[var(--warm-dark)] leading-relaxed whitespace-pre-wrap bg-[var(--canvas)] rounded-xl p-3">{aiText}</p>
        )}
      </div>
    </Section>
  )
}
