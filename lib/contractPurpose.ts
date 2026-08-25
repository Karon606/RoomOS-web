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
export const CONTRACT_PURPOSES = ['실계약', '제출용', '번역본'] as const

export type ContractPurpose = (typeof CONTRACT_PURPOSES)[number]

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
  if (!(CONTRACT_PURPOSES as readonly string[]).includes(s)) return { ok: false }
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
  /** 바꾸기 직전의 유효 목적(표시값 '실계약'·'제출용'·'번역본'). */
  from: ContractPurpose
  to: ContractPurpose
  at: string       // ISO
  by: string | null   // 바꾼 사람의 로그인 주소
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

/** DB Json 을 이력 배열로 읽는다 — 깨진 값은 빈 배열(이력을 못 읽는다고 번복을 막지 않는다). */
export function parsePurposeLog(raw: unknown): PurposeLogEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap(v => {
    if (!v || typeof v !== 'object') return []
    const o = v as Record<string, unknown>
    if (typeof o.at !== 'string') return []
    return [{
      from: contractPurposeOf(o.from), to: contractPurposeOf(o.to),
      at: o.at, by: typeof o.by === 'string' ? o.by : null,
    }]
  })
}

