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
//   · 목적은 **발급 시점 증거**라 발급 트랜잭션에서 한 번만 쓴다. 고쳐야 하면 그 판본을
//     폐기하고 다시 발급한다 — 사후 수정을 열면 '실계약' 을 나중에 '제출용' 으로 바꿔
//     책임을 옮기는 길이 생긴다.
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
