// 계약서 원격 서명 페이지 — 토큰 검증 후 생년월일 게이트 또는 발급 시점 스냅샷 렌더 (공용, 운영자 인증 없음).
// 비활성(없음·만료·닫힘·잠김)은 사유를 구분하지 않고 동일한 일반 안내만 보여준다.

import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import type { ContractData } from '@/lib/contractData'
import { shareCookieName } from '@/lib/contractShareCookie'
import ContractView from '@/app/contract/[tenantId]/ContractView'
import BirthdateGate from './BirthdateGate'
import DocumentScroll from '@/components/layout/DocumentScroll'

export const dynamic = 'force-dynamic'

function InactiveNotice() {
  return (
    <div style={{ minHeight: '100dvh', background: '#E8DDD0', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <DocumentScroll />
      <div style={{ width: '100%', maxWidth: 380, background: '#fff', borderRadius: 16, padding: '28px 24px', boxShadow: '0 4px 24px -6px rgba(61,36,24,.28)', boxSizing: 'border-box' }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#1F1A17', marginBottom: 6 }}>사용할 수 없는 링크</div>
        <p style={{ fontSize: 13, color: '#6B5D4F', lineHeight: 1.6, margin: 0 }}>
          링크가 만료되었거나 사용할 수 없습니다. 관리자에게 다시 요청해 주세요.
        </p>
      </div>
    </div>
  )
}

// 제출 완료(서명 후 링크 닫힘) — 재접속 시 계약서 대신 이 안내만 보인다.
function SubmittedNotice() {
  return (
    <div style={{ minHeight: '100dvh', background: '#E8DDD0', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <DocumentScroll />
      <div style={{ width: '100%', maxWidth: 380, background: '#fff', borderRadius: 16, padding: '32px 24px', boxShadow: '0 4px 24px -6px rgba(61,36,24,.28)', boxSizing: 'border-box', textAlign: 'center' }}>
        <div style={{ width: 48, height: 48, margin: '0 auto 16px', borderRadius: '50%', background: '#F1E6DA', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#A03C2E" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
        </div>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#1F1A17', marginBottom: 8 }}>계약서가 제출되었습니다</div>
        <p style={{ fontSize: 13, color: '#6B5D4F', lineHeight: 1.6, margin: 0 }}>
          이미 제출이 완료되어 더 이상 열 수 없습니다. 이 창은 닫으셔도 됩니다.
        </p>
      </div>
    </div>
  )
}

export default async function SignPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const link = await prisma.contractShareLink.findUnique({ where: { token } })
  if (!link) return <InactiveNotice />
  // 제출 확정으로 닫힌 링크(서명 완료 후) — 일반 만료 안내 대신 '제출 완료' 안내
  if (link.signedAt && (link.submittedAt || link.closedAt)) return <SubmittedNotice />
  if (link.closedAt || link.submittedAt || link.lockedAt || link.expiresAt <= new Date()) return <InactiveNotice />

  const cookieStore = await cookies()
  if (!cookieStore.get(shareCookieName(link.id))) return <BirthdateGate token={token} />

  const data = link.templateSnapshot as unknown as ContractData
  // 계약 내용은 발급 시점 스냅샷 고정. 단 서명은 이 링크로 들어온 최신 값을 보여준다(서명 후 재확인용).
  if (data.lease && (link.signedAt || link.disposalSignedAt)) {
    const lease = await prisma.leaseTerm.findUnique({
      where: { id: link.leaseTermId },
      select: { signatureImageUrl: true, disposalSignatureImageUrl: true },
    })
    if (lease) {
      if (link.signedAt) data.lease.signatureImageUrl = lease.signatureImageUrl
      if (link.disposalSignedAt) data.lease.disposalSignatureImageUrl = lease.disposalSignatureImageUrl
    }
  }
  return <ContractView data={data} mode="remote" shareToken={token} />
}
