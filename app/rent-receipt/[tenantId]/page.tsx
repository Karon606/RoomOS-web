import { notFound } from 'next/navigation'
import { getRentReceiptData } from './actions'
import RentReceiptView from './RentReceiptView'
import { resolveDocBack } from '@/lib/docNav'

// ?leaseTermId=<id> 는 계약 지목이다(2026-08-13, 다호실 마무리 — /contract/[tenantId] 와 같은 문법).
// 한 사람이 방을 둘 쓰면 종전 추론은 늘 거주 계약을 골라 601호 창고 몫 확인서를 뽑을 길이 없었다.
// 없으면 종전 추론 그대로라 기존 재발급 링크·발급 이력의 '다시 작성'은 불변이다.
export default async function RentReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>
  // from·tenantId 는 **돌아갈 곳**이다(lib/docNav). 안 읽으면 발급 뒤 목록으로 튕겨,
  // 입주자 상세의 서류 시트에서 들어온 사람이 제자리로 못 돌아온다(신고 2026-09-03).
  searchParams: Promise<{ month?: string; kind?: string; leaseTermId?: string; from?: string; tenantId?: string }>
}) {
  const { tenantId } = await params
  const { month, kind, leaseTermId, from, tenantId: backTenantId } = await searchParams
  // kind='deposit' 이면 보증금 영수증. 미지정·오타는 기존 입실료 확인서로 폴백(무회귀).
  const receiptKind = kind === 'deposit' ? 'deposit' : 'rent'
  const data = await getRentReceiptData(tenantId, month, receiptKind, leaseTermId ?? null)
  if (!data) notFound()
  // key — 월·종류·계약을 바꾸면 폼 useState 초기값이 새 자동값으로 다시 잡히도록 리마운트.
  return <RentReceiptView key={`${receiptKind}-${data.anchorMonth}-${data.leaseTermId ?? ''}`} data={data} back={resolveDocBack(from, backTenantId)} />
}
