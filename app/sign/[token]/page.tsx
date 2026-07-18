// 계약서 원격 서명 페이지 — 토큰 검증 후 생년월일 게이트 또는 발급 시점 스냅샷 렌더 (공용, 운영자 인증 없음).
// 비활성(없음·만료·닫힘·잠김)은 사유를 구분하지 않고 동일한 일반 안내만 보여준다.

import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import type { ContractData } from '@/lib/contractData'
import { shareCookieName } from '@/lib/contractShareCookie'
import ContractView from '@/app/contract/[tenantId]/ContractView'
import BirthdateGate from './BirthdateGate'

export const dynamic = 'force-dynamic'

function InactiveNotice() {
  return (
    <div style={{ minHeight: '100vh', background: '#E8DDD0', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 380, background: '#fff', borderRadius: 16, padding: '28px 24px', boxShadow: '0 4px 24px -6px rgba(61,36,24,.28)', boxSizing: 'border-box' }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#1F1A17', marginBottom: 6 }}>사용할 수 없는 링크</div>
        <p style={{ fontSize: 13, color: '#6B5D4F', lineHeight: 1.6, margin: 0 }}>
          링크가 만료되었거나 사용할 수 없습니다. 관리자에게 다시 요청해 주세요.
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
  if (!link || link.closedAt || link.lockedAt || link.expiresAt <= new Date()) return <InactiveNotice />

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
