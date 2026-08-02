import { notFound } from 'next/navigation'
import { getContractData } from './actions'
import { getSignedSnapshot } from '@/app/(app)/tenants/contractShare'
import ContractView from './ContractView'

// ?share=<linkId> 로 열면 **입주자가 서명한 시점의 스냅샷**으로 렌더한다.
// 서명은 A 에 했는데 B 짜리 계약서가 나가는 것을 막는다(운영자 확인 2026-08-03 — 각각 남는 구조).
export default async function ContractPage({
  params, searchParams,
}: {
  params: Promise<{ tenantId: string }>
  searchParams: Promise<{ share?: string }>
}) {
  const { tenantId } = await params
  const { share } = await searchParams
  const data = share ? await getSignedSnapshot(tenantId, share) : await getContractData(tenantId)
  if (!data) notFound()
  return <ContractView data={data} signedSnapshot={!!share} />
}
