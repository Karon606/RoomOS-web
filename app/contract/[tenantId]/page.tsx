import { notFound } from 'next/navigation'
import { getContractData } from './actions'
import { getSignedSnapshot } from '@/app/(app)/tenants/contractShare'
import ContractView from './ContractView'

// ?share=<linkId> 로 열면 **입주자가 서명한 시점의 스냅샷**으로 렌더한다.
// 서명은 A 에 했는데 B 짜리 계약서가 나가는 것을 막는다(운영자 확인 2026-08-03 — 각각 남는 구조).
//
// ?leaseTermId=<id> 는 계약 지목이다(2026-08-13, 1인 다호실). 한 사람이 계약을 둘 가지면
// 종전 추론은 늘 거주 계약을 골라 창고 계약서를 뽑을 길이 없었다. 없으면 종전 추론 그대로라
// 기존 링크는 불변이고, ?share= 와 함께 오면 스냅샷이 이긴다 — 서명본은 이미 계약이 박제돼 있다.
export default async function ContractPage({
  params, searchParams,
}: {
  params: Promise<{ tenantId: string }>
  searchParams: Promise<{ share?: string; leaseTermId?: string }>
}) {
  const { tenantId } = await params
  const { share, leaseTermId } = await searchParams
  if (share) {
    // 서명이 지워진 뒤에도 이 URL 은 열린다(링크 기록은 남으므로). 그 사실을 화면에 넘겨
    // 배너 문구와 본문 잠금이 '기록 보기'로 갈리게 한다(502호 2026-08-10).
    const snap = await getSignedSnapshot(tenantId, share)
    if (!snap) notFound()
    return <ContractView data={snap.data} signedSnapshot signatureErased={!snap.signatureLive} />
  }
  const data = await getContractData(tenantId, leaseTermId ?? null)
  if (!data) notFound()
  return <ContractView data={data} />
}
