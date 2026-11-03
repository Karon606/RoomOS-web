import { notFound, redirect } from 'next/navigation'
import { getContractData, getContractTranslationLangs } from './actions'
import { getSignedSnapshot } from '@/app/(app)/tenants/contractShare'
import ContractView from './ContractView'
import { getMyRole, canEdit } from '@/lib/role'
import { canReadScope } from '@/lib/auth/routeScope'

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
  // 역할을 데이터보다 먼저 읽는다(2026-11-04 운영자 승인 '추천대로'). 열람 직원(STAFF)은 이 화면을 읽기 전용으로 연다.
  // 금액을 못 읽는 제한 스태프는 404 다. 종전에는 getContractData 가 던져 Next 기본 오류 화면이 떴다(입구는 계약서 칸이 숨긴다).
  const role = await getMyRole()
  if (!canReadScope(role, 'money')) notFound()
  if (share) {
    // 서명본 박제 화면은 발급용 문이라 편집 역할 전용이다. 열람 역할은 같은 계약을 읽는 일반 화면으로 보낸다(갈림길 G2).
    // 종전에는 getSignedSnapshot 의 requireEdit 가 던져 오류 화면이었다. share 만 빼고 계약 지목(leaseTermId)·번역본(lang)은 유지한다
    // (부계약 서명본 URL 이 주계약 화면으로 가지 않게). 도착 URL 에 share 가 없어 이 분기를 다시 타지 않는다.
    if (!canEdit(role)) {
      const keep = new URLSearchParams()
      if (leaseTermId) keep.set('leaseTermId', leaseTermId)
      if (lang) keep.set('lang', lang)
      const q = keep.toString()
      redirect(`/contract/${encodeURIComponent(tenantId)}${q ? `?${q}` : ''}`)
    }
    // 서명이 지워진 뒤에도 이 URL 은 열린다(링크 기록은 남으므로). 그 사실을 화면에 넘겨
    // 배너 문구와 본문 잠금이 '기록 보기'로 갈리게 한다(502호 2026-08-10).
    const snap = await getSignedSnapshot(tenantId, share)
    if (!snap) notFound()
    // 서명본 화면도 같은 역할 판정이다 — 종전에는 이 분기가 두 값을 안 넘겨 기본값(true)으로 열람 직원에게
    // 문자 갈래·본문 편집·폐기·발급이 섰다(독립 검수 B1, 2026-11-03). 두 prop 은 필수다.
    return <ContractView data={snap.data} signedSnapshot signatureErased={!snap.signatureLive} canSendSms={canEdit(role)} canEdit={canEdit(role)} />
  }
  // 셀렉트가 세울 언어 목록은 ContractData 에 안 싣는다 — 그 값은 링크 발급 스냅샷으로 그대로
  // 흘러가므로, 번역본과 무관한 링크의 박제 바이트가 달라진다(조건부 담기 규칙과 같은 자리).
  const [data, translationLangs] = await Promise.all([
    getContractData(tenantId, leaseTermId ?? null, lang ?? null),
    getContractTranslationLangs(),
  ])
  if (!data) notFound()
  // 서명 요청은 문자앱을 연다 — 열람 직원(STAFF·제한 스태프)에게는 세우지 않는다(2026-11-03 운영자 지시).
  // canEdit 이 거짓이면 화면 전체가 읽기 전용이다(쓰기 입구를 세우지 않는다).
  return <ContractView data={data} translationLangs={translationLangs} canSendSms={canEdit(role)} canEdit={canEdit(role)} />
}
