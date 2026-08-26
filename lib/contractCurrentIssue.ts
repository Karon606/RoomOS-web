// 한 계약의 발급본 중 '지금 유효한 대표 한 부'를 고르는 정본.
//
// 왜 있나. 같은 판정을 세 자리가 각자 짜고 있었고 이미 갈려 있었다.
//   · 입주자 정보 계약서 칸(ContractFilesPanel) — 폐기 아닌 것 중 createdAt 최대
//   · 계약서함(ContractsClient)               — 같은 규칙을 손으로 다시 씀
//   · 서류 보내기(lib/docBundle)              — createdAt 내림차순 첫 행. **폐기 여부를 아예 안 본다**
// 앞의 둘은 우연히 같고 세 번째는 이미 갈렸다. 판본이 여럿 서는 순간 셋이 서로 다른 종이를
// '그 사람의 계약서' 라고 부르게 된다.
//
// 판정 규칙(운영자 결정 2026-08-20).
//   **대표본은 발급 시각·생성 시각과 무관하게 실계약이 고정 대표다.**
//   종전 '최신 1부' 는 어제 뽑은 번역본을 대표로 만든다. 목적이 먼저 거르고, 시각은 실계약이
//   여럿일 때(정정으로 다시 쓴 경우) 동률을 가르는 자리에만 쓴다.
//   **대표본 없음은 정당한 상태다** — 실계약을 폐기했다고 파생 판본이 승격되면 안 된다.
//   근거가 폐기된 표시본이 대표 계약서 자리에 앉는 것이기 때문이다.
//
// 순수 함수만 담는다. 'use server' 파일에는 못 둔다(비-async export 금지, 2026-08-05 사고).

import { isDerivedPurpose } from './contractPurpose'

/** 판정이 읽는 최소 모양. issuePurpose 가 null 이면 이 칸이 생기기 전 발급본이고 곧 실계약이다. */
export type IssueCopy = {
  id: string
  leaseTermId: string | null
  createdAt: Date | string
  voidedAt: Date | string | null
  supersededAt?: Date | string | null
  issuePurpose?: string | null
}

/**
 * 같은 계약의 발급본을 묶는 키.
 *
 * leaseTermId 가 없는 파일(연결이 끊긴 구본·스캔본)은 자기 자신이 한 그룹이다 — 무엇의 다른
 * 버전인지 앱이 말할 수 없는데 묶으면 거짓말이 된다. 사람이 아니라 계약이 기준인 이유는
 * 한 사람이 계약을 둘 가질 수 있고, 그 둘은 서로의 버전이 아니기 때문이다.
 */
export function issueGroupKey(f: Pick<IssueCopy, 'id' | 'leaseTermId'>): string {
  return f.leaseTermId ?? `single:${f.id}`
}

/**
 * 이 부가 대표 후보인가 — 폐기 아님 + 실계약 목적.
 *
 * 구버전 도장(supersededAt)은 보지 않는다. 그것은 '지금 서명의 주인이 아니다' 는 사실이지
 * '실계약이 아니다' 가 아니다. 그것까지 빼면 새 판본을 하나 만든 순간 대표본이 사라진다.
 */
export function isRepresentativeCandidate(f: IssueCopy): boolean {
  return !f.voidedAt && !isDerivedPurpose(f.issuePurpose ?? null)
}

const at = (v: Date | string) => new Date(v).getTime()

/**
 * 그룹별 대표 한 부 — Map<그룹키, 발급본 id>.
 *
 * Set 이 아니라 Map 인 이유: '무엇의 대표인가' 를 잃지 않는다. 종전 두 화면은 Set 을 만들고
 * 그 정보를 버려서, 목록 정렬이 사람 섞임일 때 배지를 통째로 끄는 우회를 하고 있다.
 * **부수 조건(2부 이상일 때만)을 여기 넣지 않는다.** 그것은 배지를 띄울지 말지의 표시 정책이고,
 * 판정은 언제나 답해야 한다 — 서류 보내기가 1부짜리 계약의 대표를 물어보기 때문이다.
 */
export function currentIssueIds(files: readonly IssueCopy[]): Map<string, string> {
  const best = new Map<string, IssueCopy>()
  for (const f of files) {
    if (!isRepresentativeCandidate(f)) continue
    const key = issueGroupKey(f)
    const cur = best.get(key)
    if (!cur || at(f.createdAt) > at(cur.createdAt)) best.set(key, f)
  }
  return new Map([...best].map(([k, f]) => [k, f.id]))
}

/** 이 계약의 대표 한 부. 없으면 null — 서류 보내기가 이 한 줄을 쓴다. */
export function currentIssueFor<T extends IssueCopy>(
  files: readonly T[],
  leaseTermId: string,
): T | null {
  let picked: T | null = null
  for (const f of files) {
    if (f.leaseTermId !== leaseTermId || !isRepresentativeCandidate(f)) continue
    if (!picked || at(f.createdAt) > at(picked.createdAt)) picked = f
  }
  return picked
}

/**
 * 이 계약에 실계약본이 이미 있는가 — 파생 판본 발급의 전제다.
 *
 * 운영자 결정: 실계약서가 무조건 먼저 만들어지고 그 뒤에 다른 판본을 만들 수 있다.
 * 실계약 없이 파생만 있는 상태는 '근거 없는 표시본' 이라 만들어지면 안 된다.
 * 폐기본은 세지 않는다 — 폐기된 실계약은 근거가 되지 못한다.
 */
export function hasLiveRealContract(files: readonly IssueCopy[], leaseTermId: string): boolean {
  return liveRealContracts(files, leaseTermId).length > 0
}

/**
 * 이 계약의 살아 있는 실계약본 전부 — 새 실계약이 밀어낼 대상이 곧 이 목록이다.
 *
 * 셈이 필요한 자리와 있는지만 묻는 자리가 갈리면 두 답이 어긋난다(확인창은 "기존 N부"라고
 * 적고 게이트는 다른 수를 세는 식). 판정을 여기 하나로 두고 hasLiveRealContract 가 이것을 쓴다.
 */
export function liveRealContracts<T extends IssueCopy>(
  files: readonly T[],
  leaseTermId: string,
): T[] {
  return files.filter(f => f.leaseTermId === leaseTermId && isRepresentativeCandidate(f))
}
