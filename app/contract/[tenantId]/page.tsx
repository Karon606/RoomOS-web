import { notFound } from 'next/navigation'
import { getContractData, getContractTranslationLangs } from './actions'
import { getSignedSnapshot } from '@/app/(app)/tenants/contractShare'
import ContractView from './ContractView'

// ?share=<linkId> 로 열면 **입주자가 서명한 시점의 스냅샷**으로 렌더한다.
// 서명은 A 에 했는데 B 짜리 계약서가 나가는 것을 막는다(운영자 확인 2026-08-03 — 각각 남는 구조).
//
// ?leaseTermId=<id> 는 계약 지목이다(2026-08-13, 1인 다호실). 한 사람이 계약을 둘 가지면
// 종전 추론은 늘 거주 계약을 골라 창고 계약서를 뽑을 길이 없었다. 없으면 종전 추론 그대로라
// 기존 링크는 불변이고, ?share= 와 함께 오면 스냅샷이 이긴다 — 서명본은 이미 계약이 박제돼 있다.
//
// ?lang=<코드> 는 이 화면에 세울 참고용 번역본이다(2026-09-08, 대면 서명). 운영자가 제 기기를
// 그대로 건네 서명받는 운용이 있어서, 이 화면이 곧 입주자가 읽는 화면이 된다. 없으면 국적
// 기본값이라 **건네기 전에 이미 맞아 있고**, 한국어면 카드도 우선 조항도 안 선다.
// ?share= 와 함께 오면 동결본이 이긴다 — 이미 서명한 종이의 문안은 바뀌지 않는다.
export default async function ContractPage({
  params, searchParams,
}: {
  params: Promise<{ tenantId: string }>
  searchParams: Promise<{ share?: string; leaseTermId?: string; lang?: string }>
}) {
  const { tenantId } = await params
  const { share, leaseTermId, lang } = await searchParams
  if (share) {
    // 서명이 지워진 뒤에도 이 URL 은 열린다(링크 기록은 남으므로). 그 사실을 화면에 넘겨
    // 배너 문구와 본문 잠금이 '기록 보기'로 갈리게 한다(502호 2026-08-10).
    const snap = await getSignedSnapshot(tenantId, share)
    if (!snap) notFound()
    return <ContractView data={snap.data} signedSnapshot signatureErased={!snap.signatureLive} />
  }
  // 셀렉트가 세울 언어 목록은 ContractData 에 안 싣는다 — 그 값은 링크 발급 스냅샷으로 그대로
  // 흘러가므로, 번역본과 무관한 링크의 박제 바이트가 달라진다(조건부 담기 규칙과 같은 자리).
  const [data, translationLangs] = await Promise.all([
    getContractData(tenantId, leaseTermId ?? null, lang ?? null),
    getContractTranslationLangs(),
  ])
  if (!data) notFound()
  return <ContractView data={data} translationLangs={translationLangs} />
}
