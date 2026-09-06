// 계약서 원격 서명 페이지 — 토큰 검증 후 생년월일 게이트 또는 발급 시점 스냅샷 렌더 (공용, 운영자 인증 없음).
// 비활성(없음·만료·닫힘·잠김)은 사유를 구분하지 않고 동일한 일반 안내만 보여준다.

import { parseDocSignedAt, parseDocumentSignatures } from '@/lib/signDocuments'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import type { ContractData } from '@/lib/contractData'
import { shareCookieName } from '@/lib/contractShareCookie'
import { formatForeignRegNo } from '@/lib/foreignRegNo'
import { readStoredForeignRegNo } from '@/lib/pii'
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
  // 제출 확정으로 닫힌 링크 — '제출 완료' 안내.
  // 종전에는 `signedAt && (submittedAt || closedAt)` 이라, 서명만 하고 제출은 안 한 채 운영자가 닫은
  // 링크에도 "제출이 완료되어"라고 말했다(실데이터 07-20 건이 그 상태였다). 제출 여부로만 가른다.
  if (link.submittedAt) return <SubmittedNotice />
  if (link.closedAt || link.submittedAt || link.lockedAt || link.expiresAt <= new Date()) return <InactiveNotice />

  const cookieStore = await cookies()
  if (!cookieStore.get(shareCookieName(link.id))) return <BirthdateGate token={token} />

  const data = link.templateSnapshot as unknown as ContractData
  // 외국인등록번호는 스냅샷에 없다. 24시간짜리 공개 링크가 여는 JSON 이라 평문을 담아 두지 않고
  // (contractShare withoutPlainPii), 생년월일 게이트를 통과한 이 자리에서만 서버가 복호해 끼운다.
  // 게이트 위쪽에 두면 안 된다 — 본인 확인 전에 번호가 페이로드에 실린다.
  if (data.tenant?.hasForeignRegNo) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: link.tenantId },
      select: { id: true, foreignRegNoEnc: true },
    })
    const plain = tenant ? readStoredForeignRegNo(tenant.foreignRegNoEnc, tenant.id) : null
    data.tenant.foreignRegNo = plain ? formatForeignRegNo(plain) : null
  }
  // 계약 내용은 발급 시점 스냅샷 고정. 단 서명은 이 링크로 들어온 최신 값을 보여준다(서명 후 재확인용).
  // 추가 서류 서명도 같은 규칙이다 — **이 링크에 자국(docSignedAt)이 있는 key 만** 얹는다.
  // 다른 링크에서 받은 서명을 얹으면 이 종이가 안 받은 서명을 보여주게 된다(링크 축).
  const docMarks = parseDocSignedAt(link.docSignedAt)
  if (data.lease && (link.signedAt || link.disposalSignedAt || Object.keys(docMarks).length > 0)) {
    const lease = await prisma.leaseTerm.findUnique({
      where: { id: link.leaseTermId },
      select: { signatureImageUrl: true, disposalSignatureImageUrl: true, documentSignatures: true },
    })
    if (lease) {
      if (link.signedAt) data.lease.signatureImageUrl = lease.signatureImageUrl
      if (link.disposalSignedAt) data.lease.disposalSignatureImageUrl = lease.disposalSignatureImageUrl
      const sigs = parseDocumentSignatures(lease.documentSignatures)
      data.lease.documentSignatures = Object.fromEntries(
        Object.keys(docMarks).flatMap(k => sigs[k] ? [[k, sigs[k]]] : []))
    }
  }
  return <ContractView data={data} mode="remote" shareToken={token} />
}
