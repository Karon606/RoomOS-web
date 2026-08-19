// 계약서 버전 폐기 정본 — 무엇을 이력으로 남기고 무엇을 비우는지 한 곳에서 정한다.
//
// 왜 있나 (긴급 신고 63cd1049, 2026-08-19)
//   운영자가 한 일은 '발급본 한 부 삭제'인데 하려던 일은 '이 버전을 폐기'였다. 앱에는 후자라는
//   개념이 없었고, 있는 것은 파일 삭제(잠금과 무접점)와 서명 지우기(증거 파괴) 둘뿐이었다.
//   그래서 이름이 잘못 찍힌 계약서를 폐기하고 다시 작성할 길이 아예 닫혀 있었다.
//
// 원칙은 하나다. **증거는 하나도 지우지 않는다. 라이브 잠금만 푼다.**
//   서명 이미지·서명 시각·서명 시점 본문 격리본·표시값 오버라이드를 이력으로 옮겨 담고,
//   lease 의 그 칸들만 비워 현재 값으로 다시 작성할 수 있게 한다. 발급본(ContractFile)과
//   그 박제(issuedSnapshot)는 손대지 않고 폐기 도장(voidedAt)만 찍는다.
//
// 이 파일은 순수 함수만 담는다 — 서버 액션·감지망·테스트가 같은 규칙을 쓰게 하려는 것이고,
// 규칙을 각자 짜면 '화면은 폐기했다는데 검사는 서명이 남았다고 보는' 상태가 된다.

/** 폐기된 계약서 버전 한 건 — append-only. 이 모양은 절대 파괴적으로 바뀌지 않는다(v 로 판별). */
export type VoidedContractVersion = {
  v: 1
  /** 폐기 시각(ISO) */
  voidedAt: string
  /** 폐기한 사용자 id. 알 수 없으면 null */
  voidedBy: string | null
  /** 폐기 사유. 지금은 진입로 이름이 들어간다(운영자 입력 칸은 두지 않았다) */
  reason: string | null
  /** 그때 lease 에 붙어 있던 서명 원본 — 이미지 두 장과 시각 두 개 */
  signature: {
    contractImage: string | null
    contractSignedAt: string | null
    disposalImage: string | null
    disposalSignedAt: string | null
  }
  /** 서명 시점 본문 격리본(lib/contract SignedContractSnapshot) 그대로 */
  signedContractSnapshot: unknown
  /** 그때의 표시값 오버라이드·본문 오버라이드 사본 — 되돌리기가 폐기 직전 상태를 정확히 복원한다 */
  contractFieldOverrides: unknown
  contractOverride: unknown
  /** 이 폐기가 도장을 찍은 발급본 id 들 */
  fileIds: string[]
  /** 이 폐기가 닫은 서명 링크 id 들 */
  closedLinkIds: string[]
}

/** 폐기 대상 lease 에서 읽어야 하는 최소 모양. */
export type VoidableLease = {
  signatureImageUrl: string | null
  signatureSignedAt: Date | null
  disposalSignatureImageUrl: string | null
  disposalSignatureSignedAt: Date | null
  signedContractSnapshot?: unknown
  contractFieldOverrides?: unknown
  contractOverride?: unknown
}

/**
 * 폐기할 것이 있는가.
 *
 * 서명 네 칸 중 하나라도 있거나 격리본이 있으면 '서명이 붙은 버전'이다. 넷 다 비고 격리본도
 * 없으면 폐기할 대상 자체가 없다 — 그 계약서는 지금 그냥 작성 중이다.
 * 격리본까지 보는 이유: 서명 이미지 없이 격리본만 남은 반쪽 상태도 잠금을 만들고(G2 위반 상태),
 * 그 상태를 풀 길이 없으면 같은 신고가 다른 모양으로 되돌아온다.
 */
export function hasVoidableVersion(lease: VoidableLease): boolean {
  return !!(lease.signatureImageUrl || lease.signatureSignedAt
    || lease.disposalSignatureImageUrl || lease.disposalSignatureSignedAt
    || lease.signedContractSnapshot)
}

/** 저장된 JSON 을 폐기 이력 배열로 읽는다. 모양이 아니면 빈 배열이다(칸이 없던 계약이 그렇다). */
export function parseContractVersionArchive(json: unknown): VoidedContractVersion[] {
  if (!Array.isArray(json)) return []
  return json.filter((e): e is VoidedContractVersion =>
    !!e && typeof e === 'object' && (e as { v?: unknown }).v === 1)
}

/** 폐기 이력 한 건을 조립한다. 값은 lease 에서 읽은 그대로다 — 여기서 가공하면 증거가 아니다. */
export function buildVoidedVersion(input: {
  lease: VoidableLease
  fileIds: string[]
  closedLinkIds: string[]
  voidedAt: Date
  voidedBy: string | null
  reason: string | null
}): VoidedContractVersion {
  const l = input.lease
  return {
    v: 1,
    voidedAt: input.voidedAt.toISOString(),
    voidedBy: input.voidedBy,
    reason: input.reason,
    signature: {
      contractImage: l.signatureImageUrl,
      contractSignedAt: l.signatureSignedAt ? l.signatureSignedAt.toISOString() : null,
      disposalImage: l.disposalSignatureImageUrl,
      disposalSignedAt: l.disposalSignatureSignedAt ? l.disposalSignatureSignedAt.toISOString() : null,
    },
    signedContractSnapshot: l.signedContractSnapshot ?? null,
    contractFieldOverrides: l.contractFieldOverrides ?? null,
    contractOverride: l.contractOverride ?? null,
    fileIds: input.fileIds,
    closedLinkIds: input.closedLinkIds,
  }
}

/**
 * 이 폐기 이력에 서명 증거가 담겼는가 — 감지망 G7 이 보는 축.
 *
 * 이미지든 시각이든 격리본이든 하나라도 있으면 참이다. 셋 다 없는 항목은 '폐기'라는 이름을 달고
 * 아무것도 안 남긴 것이고, 그건 폐기가 조용한 삭제로 퇴화했다는 뜻이다.
 * 서명 없이 격리본만 있던 반쪽 버전도 정당하게 참이 된다.
 */
export function voidedVersionHasEvidence(e: VoidedContractVersion): boolean {
  const s = e.signature
  return !!(s?.contractImage || s?.contractSignedAt || s?.disposalImage || s?.disposalSignedAt
    || e.signedContractSnapshot)
}

/** 되돌리기가 lease 에 다시 써 넣을 값. Date 로 되돌려 놓는다(컬럼 타입). */
export type RestoredVersionFields = {
  signatureImageUrl: string | null
  signatureSignedAt: Date | null
  disposalSignatureImageUrl: string | null
  disposalSignatureSignedAt: Date | null
  signedContractSnapshot: unknown
  contractFieldOverrides: unknown
  contractOverride: unknown
}

/** 폐기 이력 한 건을 lease 칸 값으로 되돌린다. 문자열 시각이 깨져 있으면 null 로 떨어뜨린다. */
export function restoredFieldsFrom(e: VoidedContractVersion): RestoredVersionFields {
  const at = (v: string | null) => {
    if (!v) return null
    const t = Date.parse(v)
    return Number.isFinite(t) ? new Date(t) : null
  }
  return {
    signatureImageUrl: e.signature?.contractImage ?? null,
    signatureSignedAt: at(e.signature?.contractSignedAt ?? null),
    disposalSignatureImageUrl: e.signature?.disposalImage ?? null,
    disposalSignatureSignedAt: at(e.signature?.disposalSignedAt ?? null),
    signedContractSnapshot: e.signedContractSnapshot ?? null,
    contractFieldOverrides: e.contractFieldOverrides ?? null,
    contractOverride: e.contractOverride ?? null,
  }
}

/**
 * 이 링크가 **지금 lease 에 남아 있는 서명을 만든 링크**인가.
 *
 * 링크의 signedAt 은 '그때 서명이 들어왔다'는 과거 사실이라 서명을 지워도, 버전을 폐기해도
 * 영원히 남는다. 그것만 보고 '서명 당시 값'의 기준으로 삼으면
 *   - 폐기 후 이름을 바꾸는 순간 이미 무효인 링크와 대조해 위반·경고가 뜨고
 *   - 그 경고가 권하는 '재서명 받기'를 누르면 방금 받은 서명이 폐기된다
 * 는 자기모순이 생긴다. 기준은 시각 일치다 — 서명 저장과 링크 갱신이 같은 트랜잭션에서 같은
 * 값을 쓰므로(app/sign/[token]/actions.ts), 지금 서명을 만든 링크만 정확히 걸린다.
 *
 * 같은 규칙을 scripts/check-sign-date-integrity.ts 축 3 이 2026-08-11(502호 이름 정정 재서명)에
 * 이미 채택했다. 여기서 정본으로 올려 드리프트 비교·본문 잠금 검사가 같은 판정을 쓰게 한다.
 */
export function isCurrentSignatureLink(
  link: { signedAt?: Date | null; disposalSignedAt?: Date | null },
  lease: { signatureSignedAt?: Date | null; disposalSignatureSignedAt?: Date | null } | null | undefined,
): boolean {
  if (!lease) return false
  const same = (a?: Date | null, b?: Date | null) =>
    !!a && !!b && new Date(a).getTime() === new Date(b).getTime()
  return same(link.signedAt, lease.signatureSignedAt)
    || same(link.disposalSignedAt, lease.disposalSignatureSignedAt)
}
