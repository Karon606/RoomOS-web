// 목록 화면이 큰 JSON 을 통째로 안 끌어오게 하는 좁은 투영 한 벌.
//
// 왜 생겼나. 2026-09-28 Supabase 가 egress 할당량(5.5GB)을 넘겨 요청을 버리기 시작했다.
// 실측해 보니 표는 작은데 **작은 표를 무겁게 읽고** 있었다.
//
//   · contract_share_links."templateSnapshot" 은 행당 150KB 인데, 목록이 거기서 읽는 것은
//     paperDocsOf 가 보는 키 **두 개**(disposalConsent·signDocuments)뿐이다. 열린 링크 24건이면
//     한 번 조회에 3.5MB 가 오가고 그중 149KB/행이 버려진다.
//   · contract_files."issuedSnapshot" 은 66건 합쳐 2.11MB 인데, 목록이 읽는 것은
//     facts['tenant.name'] 문자열 하나다. 그 파일 주석에 "여기서 읽지 않는다" 고 적혀 있는데
//     정작 select 에 들어 있었다(주석과 코드가 반대였던 자리).
//
// 그 두 쿼리를 **홈 화면(dashboard/alerts)** 과 **계약서 목록**이 탄다. 앱에서 제일 자주 열리는
// 화면이 매번 수 MB 를 끌어왔다. 6.47GB ÷ 3.5MB 가 약 1,850회고, 소진 기간(18일)으로 나누면
// 하루 100회다 — 9월 22일에 끈 네비 프리페치가 페이지 한 번에 서버 렌더를 8번 돌리던 것과 맞물린다.
//
// **판정 규칙은 한 글자도 안 바꾼다.** paperDocsOf·leaseSignSlots 는 그대로 두고, 그들이 받는
// 모양만 좁게 만들어 넘긴다. 서명 이미지도 마찬가지다 — leaseSignSlots 는 그것을 있는지 없는지로만
// 쓰므로(`!!(url || signedAt)`) 목록은 시각만 읽으면 된다. 둘이 어긋난 행이 없다는 것은
// 2026-09-28 에 129건 전수로 확인했고, scripts/check-signature-pairing.ts 가 계속 지킨다.
//
// 스냅샷 **전체**가 필요한 자리(원격 서명 화면 /sign/[token], 발급 상세)는 이 파일을 안 쓴다.
// 거기는 한 건씩 읽으므로 무겁지 않다.

import prisma from '@/lib/prisma'

/** paperDocsOf 가 보는 만큼만. 그 함수의 인자 모양과 같아야 한다(lib/signDocuments). */
export type PaperDocsSnapshot = {
  disposalConsent?: { enabled?: boolean; title?: string }
  signDocuments?: unknown
}

/**
 * 공유링크 id 로 **paperDocsOf 가 쓰는 키 두 개만** 뽑는다.
 *
 * Prisma 의 select 는 JSON 안쪽으로 못 들어가므로 여기만 raw 로 간다. 대신 본 쿼리는 Prisma 로
 * 남겨 관계 select 와 타입을 지킨다 — 통째로 raw 로 옮기면 그 쪽이 더 위험하다.
 */
export async function paperDocsSnapshots(linkIds: string[]): Promise<Map<string, PaperDocsSnapshot>> {
  const out = new Map<string, PaperDocsSnapshot>()
  if (linkIds.length === 0) return out
  const rows = await prisma.$queryRaw<Array<{ id: string; dc: unknown; sd: unknown }>>`
    SELECT id,
           "templateSnapshot" -> 'disposalConsent' AS dc,
           "templateSnapshot" -> 'signDocuments'   AS sd
    FROM contract_share_links
    WHERE id = ANY(${linkIds}::uuid[])
  `
  for (const r of rows) {
    out.set(r.id, {
      disposalConsent: (r.dc ?? undefined) as PaperDocsSnapshot['disposalConsent'],
      signDocuments: r.sd ?? undefined,
    })
  }
  return out
}

/**
 * 계약서 파일 id 로 **발급 당시 인쇄된 이름만** 뽑는다.
 *
 * issuedPrintedName 이 읽는 자리(facts['tenant.name'])를 그대로 짚는다. 그 함수를 안 바꾸려고
 * 같은 모양(`{ facts: { 'tenant.name': ... } }`)으로 돌려준다.
 */
export async function issuedPrintedNameSnapshots(
  fileIds: string[],
): Promise<Map<string, { facts: Record<string, unknown> }>> {
  const out = new Map<string, { facts: Record<string, unknown> }>()
  if (fileIds.length === 0) return out
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string | null }>>`
    SELECT id, "issuedSnapshot" -> 'facts' ->> 'tenant.name' AS name
    FROM contract_files
    WHERE id = ANY(${fileIds}::uuid[])
  `
  for (const r of rows) {
    if (r.name != null) out.set(r.id, { facts: { 'tenant.name': r.name } })
  }
  return out
}
