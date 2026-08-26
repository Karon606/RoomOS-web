// 계약서 발급 목적 정본 — 무엇이 실계약이고 무엇이 대표본인가를 한 곳에서 정한다.
//
// 왜 있나 (운영자 결정 2026-08-20)
//   한 계약에 판본이 여럿 설 수 있게 되면 "그래서 진짜는 어느 것이냐" 를 화면이 답해야 한다.
//   종전 [현재] 배지는 '폐기 안 된 것 중 createdAt 최신' 이었는데(ContractFilesPanel),
//   그 규칙이면 나중에 뽑은 제출용·번역본이 대표 자리에 앉는다. 운영자 결정은 반대다 —
//   **대표본은 발급 시각·생성 시각과 무관하게 실계약이 고정 대표다.**
//
// 규약 둘.
//   · 저장값 null 이 곧 '실계약' 이다. 기존 발급본은 전부 실계약이라 백필이 없고, 문자열
//     기본값을 박아 두면 '아직 안 고름' 과 '실계약을 골랐음' 이 구분되지 않는다.
//   · 목적은 **발급 시점 증거**라 발급 트랜잭션에서 한 번만 쓴다(issuePurpose 는 불변이다).
//
// 규약 개정 (운영자 승인 2026-08-26, 긴급 신고 419호)
//   발급 때 고른 목적을 번복할 길이 아예 없어, 실수로 '제출용' 을 고른 계약서가 대표 자리에
//   서지 못한 채 보낼 수도 고칠 수도 없는 상태가 됐다(폐기 후 재발급은 서명을 다시 받는 일이다).
//   그래서 **증거와 지위를 가른다** — issuePurpose 는 "그때 무엇으로 발급했나" 로 불변이고,
//   purposeOverride 가 "지금 무엇으로 취급하나" 를 든다. 판정은 override ?? issuePurpose 다.
//   원 규약이 막으려던 것(실계약을 나중에 제출용으로 바꿔 책임을 옮기는 길)은 그대로 막힌다 —
//   증거가 남고 이력(purposeLog)이 쌓이며, 마지막 실계약의 강등은 서버가 거부한다.
//
// 순수 함수만 담는다. 화면·발급 API·감지망이 같은 판정을 쓰게 하려는 것이고, 각자 짜면
// '패널은 실계약이라는데 목록은 아니라고 하는' 상태가 된다(지금 [현재] 배지가 정확히 그 모양이다).

/**
 * 고를 수 있는 목적 — 고정 선택지다. 자유 입력을 열지 않는다.
 *
 * 이 값은 표시용 문자열이 아니라 판정 입력이다. 대표본 결정·파생 판본 숨김·토글 게이트가
 * 전부 여기 걸리므로, 임의 문자열이 들어오면 앱이 판정을 못 하고 운영자는 '진짜계약서2' 같은
 * 값을 넣어 이력을 무의미하게 만든다(계약 실무 검토 2026-08-20).
 * 순서가 곧 화면의 선택지 순서다 — 실계약이 맨 앞이고 기본값이다.
 */
export const CONTRACT_PURPOSES = ['실계약', '제출용', '번역본', '보관용'] as const

export type ContractPurpose = (typeof CONTRACT_PURPOSES)[number]

/**
 * 새 계약서를 만들 때 고를 수 있는 목적 — '보관용'이 빠진다.
 *
 * 보관용은 **발급하는 것이 아니라 밀려나는 것**이다. 새 실계약이 생기면 이전 실계약이 그리로
 * 간다(운영자 원문 "새 계약서가 작성되면 기존 계약서는 보관용으로 바뀐다"). 처음부터 보관용
 * 계약서를 뽑는 일은 없고, 그 길을 열면 아무 계약도 대표하지 않는 종이가 발급 즉시 생긴다.
 */
export const ISSUABLE_CONTRACT_PURPOSES = ['실계약', '제출용', '번역본'] as const

/** 밀려난 판본의 목적 — 지위만 옮기고 종이는 그대로 남는다. */
export const ARCHIVED_CONTRACT_PURPOSE: ContractPurpose = '보관용'

/** 기본값. 아무것도 고르지 않으면 이것이고, 저장값으로는 null 로 내려간다. */
export const DEFAULT_CONTRACT_PURPOSE: ContractPurpose = '실계약'

/**
 * 저장값을 목적으로 읽는다. null·빈 값·모르는 값은 전부 실계약이다.
 *
 * 모르는 값을 실계약으로 떨어뜨리는 이유: 이 칸이 생기기 전 발급본이 전부 실계약이고,
 * 판정 불능일 때 '파생' 쪽으로 기울면 토글을 껐을 때 진짜 계약서가 화면에서 사라진다.
 */
export function contractPurposeOf(v: unknown): ContractPurpose {
  if (typeof v !== 'string') return DEFAULT_CONTRACT_PURPOSE
  const s = v.trim()
  return (CONTRACT_PURPOSES as readonly string[]).includes(s) ? (s as ContractPurpose) : DEFAULT_CONTRACT_PURPOSE
}

/** 파생 판본인가 — 실계약이 아니면 전부 파생이다. */
export function isDerivedPurpose(v: unknown): boolean {
  return contractPurposeOf(v) !== DEFAULT_CONTRACT_PURPOSE
}

/**
 * 발급 요청이 실어 온 목적을 저장값으로 정규화한다.
 *
 * 화이트리스트 밖 값은 거부한다(ok:false) — 조용히 실계약으로 떨어뜨리면 API 를 직접 부른
 * 요청이 아무 라벨이나 붙인 뒤 앱에서는 실계약처럼 보이는 판본을 만든다.
 * 실계약은 저장값 null 이다.
 */
export function normalizeIssuePurpose(raw: unknown): { ok: true; value: string | null } | { ok: false } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null }
  if (typeof raw !== 'string') return { ok: false }
  const s = raw.trim()
  if (!s || s === DEFAULT_CONTRACT_PURPOSE) return { ok: true, value: null }
  // 발급 화이트리스트는 CONTRACT_PURPOSES 가 아니라 ISSUABLE 이다 — 보관용은 발급이 아니라
  // 밀려나는 자리라, 여기서 받아 주면 대표가 없는 계약이 발급 한 번으로 만들어진다.
  if (!(ISSUABLE_CONTRACT_PURPOSES as readonly string[]).includes(s)) return { ok: false }
  return { ok: true, value: s }
}

/** 화면에 목적을 적을 것인가 — 실계약은 안 적는다. 기본값이 대다수 행에 붙으면 소음이다. */
export function contractPurposeLabel(v: unknown): string | null {
  const p = contractPurposeOf(v)
  return p === DEFAULT_CONTRACT_PURPOSE ? null : p
}

// ── 번복 (2026-08-26 규약 개정) ─────────────────────────────────────────

/** 번복 이력 한 줄 — purposeLog 배열의 항목. append 전용이고 지우지 않는다. */
export type PurposeLogEntry = {
  /** 바꾸기 직전의 유효 목적(표시값 '실계약'·'제출용'·'번역본'·'보관용'). */
  from: ContractPurpose
  to: ContractPurpose
  at: string       // ISO
  by: string | null   // 바꾼 사람의 로그인 주소
  /**
   * 누가 이 번복을 일으켰나 — 'manual'(사람이 용도 모달에서) · 'auto'(새 실계약이 밀어냄).
   * 없으면 'manual' 로 읽는다(이 칸이 생기기 전 이력이 전부 사람 손이다).
   */
  cause?: 'manual' | 'auto'
  /** auto 일 때 밀어낸 새 계약서의 id — 그것을 지울 때 되돌릴 대상을 찾는 실이다. */
  sourceFileId?: string
}

/**
 * 지금 이 판본의 유효 목적 — **번복이 있으면 그것, 없으면 발급 시점 값**이다.
 *
 * 대표본 판정·파생 숨김·발급 게이트가 전부 이 값을 입력으로 받아야 한다. 한쪽만 issuePurpose 를
 * 직접 읽으면 '패널은 실계약이라는데 목록은 아니라고 하는' 상태가 되돌아온다.
 */
export function effectiveIssuePurpose(
  row: { issuePurpose?: string | null; purposeOverride?: string | null },
): string | null {
  const p = contractPurposeOf(row.purposeOverride ?? row.issuePurpose)
  return p === DEFAULT_CONTRACT_PURPOSE ? null : p
}

/** 판정 입력 모양으로 바꾼다 — currentIssueIds 계열에 그대로 먹인다(판정 정본은 무변경). */
export function withEffectivePurpose<T extends { issuePurpose?: string | null; purposeOverride?: string | null }>(
  row: T,
): T & { issuePurpose: string | null } {
  return { ...row, issuePurpose: effectiveIssuePurpose(row) }
}

/**
 * DB Json 을 이력 배열로 읽는다 — 깨진 값은 빈 배열(이력을 못 읽는다고 번복을 막지 않는다).
 *
 * **원본 키를 먼저 펴고 아는 칸만 덮는다.** 이 함수는 읽기 전용이 아니라 되쓰기 경로의 일부다 —
 * 번복은 parse 한 배열에 한 줄을 밀어 넣고 통째로 다시 저장한다. 그래서 아는 칸만 골라 담으면
 * **모르는 칸이 그 저장에서 조용히 사라진다.** 실제로 cause·sourceFileId 를 뒤에 더했을 때,
 * 그 파일에 수동 번복이 한 번만 일어나도 자동 전환의 근거가 통째로 날아가는 길이 열려 있었다.
 * 다음에 칸을 또 더할 때 같은 사고를 되풀이하지 않으려고 케이스가 아니라 클래스를 막는다.
 * 쓰기 경로가 서버뿐이라 임의 키가 흘러들 자리는 없다.
 */
export function parsePurposeLog(raw: unknown): PurposeLogEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap(v => {
    if (!v || typeof v !== 'object') return []
    const o = v as Record<string, unknown>
    if (typeof o.at !== 'string') return []
    return [{
      ...o,
      from: contractPurposeOf(o.from), to: contractPurposeOf(o.to),
      at: o.at, by: typeof o.by === 'string' ? o.by : null,
      // 모르는 값은 사람 손으로 읽는다 — 근거 없는 auto 는 감지망이 잡아야 하므로 지어내지 않는다.
      cause: o.cause === 'auto' ? 'auto' as const : 'manual' as const,
      ...(typeof o.sourceFileId === 'string' ? { sourceFileId: o.sourceFileId } : {}),
    }]
  })
}

/**
 * 이 판본이 '새 계약서에 밀려나 보관용이 된' 상태인가 — 그 새 계약서를 지울 때 되돌릴 대상이다.
 *
 * **마지막 항목만 본다.** auto 항목 뒤에 무엇이든 쌓였다면 사람이 이미 그 부를 손댔다는 뜻이라
 * 되돌릴 자리가 아니다(발급 X 로 강등 → 수동 승격 → 발급 Y 로 재강등된 부에서 X 를 지우며
 * 되돌리면 틀린다). 깊이 훑지 않는 것이 규칙이다.
 */
export function archivedBy(
  row: { purposeOverride?: string | null; issuePurpose?: string | null; purposeLog?: unknown },
  sourceFileId: string,
): boolean {
  if (contractPurposeOf(row.purposeOverride ?? row.issuePurpose) !== ARCHIVED_CONTRACT_PURPOSE) return false
  const log = parsePurposeLog(row.purposeLog)
  const last = log[log.length - 1]
  return !!last && last.cause === 'auto' && last.sourceFileId === sourceFileId
}


/**
 * 자동 보관 전환 한 줄 — 새 실계약이 이전 실계약을 밀어낼 때 남긴다.
 *
 * 이력 모양을 여기서만 만드는 이유는 발급 경로가 둘이라서다(생성·스캔 업로드). 두 곳이 각자
 * 객체를 지으면 한쪽만 sourceFileId 를 빠뜨리고, 그러면 새 계약서를 지울 때 되돌릴 대상을 못 찾는다.
 */
export function archivePurposeLogEntry(input: {
  from: ContractPurpose
  by: string | null
  at: Date
  sourceFileId: string
}): PurposeLogEntry {
  return {
    from: input.from,
    to: ARCHIVED_CONTRACT_PURPOSE,
    at: input.at.toISOString(),
    by: input.by,
    cause: 'auto',
    sourceFileId: input.sourceFileId,
  }
}
