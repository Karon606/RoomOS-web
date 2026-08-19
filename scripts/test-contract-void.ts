// 계약서 버전 폐기 회귀 테스트 — 실행: npx tsx scripts/test-contract-void.ts
//
// 여기서 고정하는 것 넷(2026-08-19, 긴급 신고 63cd1049).
//   · **증거를 하나도 잃지 않는다** — 폐기 이력에 서명 이미지 2장·시각 2개·격리본·오버라이드가 담긴다.
//   · **되돌리면 폐기 직전 그대로** — 왕복(폐기 → 복원)이 항등이어야 적용취소가 손실을 안 만든다.
//   · **폐기 대상 판정** — 서명이 하나도 없고 격리본도 없으면 폐기할 버전 자체가 없다(멱등).
//   · **대조 기준 링크** — '지금 lease 에 남아 있는 서명을 만든 링크'만 서명 당시 값의 기준이다.
//     이것이 흔들리면 폐기 후 재작성이 드리프트 경고·감지망 위반으로 뜨고, 그 경고가 권하는
//     '재서명 받기' 가 방금 받은 서명을 다시 폐기한다.

import {
  buildVoidedVersion, hasVoidableVersion, isCurrentSignatureLink,
  parseContractVersionArchive, restoredFieldsFrom, voidedVersionHasEvidence,
  type VoidableLease,
} from '../lib/contractVersion'

let pass = 0
let fail = 0
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; return }
  fail++
  console.error(`FAIL ${name}\n  기대: ${e}\n  실제: ${a}`)
}

const SIGNED_AT = new Date('2026-08-19T06:10:44.527Z')
const DISPOSAL_AT = new Date('2026-08-19T06:01:07.396Z')
const VOID_AT = new Date('2026-08-19T09:00:00.000Z')

// 신고 63cd1049 의 실제 모양 — 원격 서명 + 동의서 서명 + 격리본 + 표시값 오버라이드 없음.
const signedLease: VoidableLease = {
  signatureImageUrl: 'data:image/png;base64,AAAA',
  signatureSignedAt: SIGNED_AT,
  disposalSignatureImageUrl: 'data:image/png;base64,BBBB',
  disposalSignatureSignedAt: DISPOSAL_AT,
  signedContractSnapshot: { origin: 'REMOTE_LINK', capturedAt: DISPOSAL_AT.toISOString(), template: { title: '입실계약서' } },
  contractFieldOverrides: null,
  contractOverride: null,
}

// ── 폐기 대상 판정 ──
{
  eq('판정 · 서명이 있으면 폐기 대상', hasVoidableVersion(signedLease), true)
  const clean: VoidableLease = {
    signatureImageUrl: null, signatureSignedAt: null,
    disposalSignatureImageUrl: null, disposalSignatureSignedAt: null,
    signedContractSnapshot: null,
  }
  eq('판정 · 서명도 격리본도 없으면 폐기할 것이 없다', hasVoidableVersion(clean), false)
  // 격리본만 남은 반쪽 상태(G2 위반 상태)도 풀 길이 있어야 한다 — 없으면 영구 잠김이다.
  eq('판정 · 격리본만 남아도 폐기 대상',
    hasVoidableVersion({ ...clean, signedContractSnapshot: { origin: 'SCAN' } }), true)
  // 동의서 서명만 있는 반쪽 상태도 잠금을 만든다(서명 네 칸 OR) — 폐기로 풀려야 한다.
  eq('판정 · 동의서 서명만 있어도 폐기 대상',
    hasVoidableVersion({ ...clean, disposalSignatureImageUrl: 'data:image/png;base64,BBBB' }), true)
}

// ── 증거 보존 ──
{
  const e = buildVoidedVersion({
    lease: signedLease, fileIds: ['file-014', 'file-015'], closedLinkIds: ['link-1'],
    voidedAt: VOID_AT, voidedBy: 'user-1', reason: '이 계약서 폐기',
  })
  eq('증거 · 계약서 서명 이미지', e.signature.contractImage, signedLease.signatureImageUrl)
  eq('증거 · 계약서 서명 시각', e.signature.contractSignedAt, SIGNED_AT.toISOString())
  eq('증거 · 동의서 서명 이미지', e.signature.disposalImage, signedLease.disposalSignatureImageUrl)
  eq('증거 · 동의서 서명 시각', e.signature.disposalSignedAt, DISPOSAL_AT.toISOString())
  eq('증거 · 서명 시점 본문 격리본', e.signedContractSnapshot, signedLease.signedContractSnapshot)
  eq('증거 · 발급본 목록', e.fileIds, ['file-014', 'file-015'])
  eq('증거 · 닫은 링크 목록', e.closedLinkIds, ['link-1'])
  eq('증거 · 감지망 G7 통과', voidedVersionHasEvidence(e), true)

  // G7 역주입 — 증거를 안 담은 항목은 위반으로 잡혀야 한다.
  const hollow = { ...e, signature: { contractImage: null, contractSignedAt: null, disposalImage: null, disposalSignedAt: null }, signedContractSnapshot: null }
  eq('증거 · G7 역주입(빈 항목은 위반)', voidedVersionHasEvidence(hollow), false)
}

// ── 왕복 항등(폐기 → 되돌리기) ──
{
  const overridden: VoidableLease = {
    ...signedLease,
    contractFieldOverrides: { nameStyle: 'en', rentAmount: 440000 },
    contractOverride: { title: '개별 수정본', sections: [], oathText: '' },
  }
  const e = buildVoidedVersion({
    lease: overridden, fileIds: ['file-015'], closedLinkIds: [],
    voidedAt: VOID_AT, voidedBy: null, reason: '재서명 받기',
  })
  const back = restoredFieldsFrom(e)
  eq('왕복 · 계약서 서명 이미지', back.signatureImageUrl, overridden.signatureImageUrl)
  eq('왕복 · 계약서 서명 시각', back.signatureSignedAt, overridden.signatureSignedAt)
  eq('왕복 · 동의서 서명 이미지', back.disposalSignatureImageUrl, overridden.disposalSignatureImageUrl)
  eq('왕복 · 동의서 서명 시각', back.disposalSignatureSignedAt, overridden.disposalSignatureSignedAt)
  eq('왕복 · 격리본', back.signedContractSnapshot, overridden.signedContractSnapshot)
  eq('왕복 · 표시값 오버라이드', back.contractFieldOverrides, overridden.contractFieldOverrides)
  eq('왕복 · 본문 오버라이드', back.contractOverride, overridden.contractOverride)
  // 되돌린 값으로 다시 폐기 대상 판정이 서야 한다(잠금이 그대로 돌아온다).
  eq('왕복 · 복원 후 다시 잠긴 상태', hasVoidableVersion({
    signatureImageUrl: back.signatureImageUrl, signatureSignedAt: back.signatureSignedAt,
    disposalSignatureImageUrl: back.disposalSignatureImageUrl,
    disposalSignatureSignedAt: back.disposalSignatureSignedAt,
    signedContractSnapshot: back.signedContractSnapshot,
  }), true)
}

// ── 이력 파싱 ──
{
  eq('이력 · 칸이 비었으면 빈 배열', parseContractVersionArchive(null), [])
  eq('이력 · 배열이 아니면 빈 배열', parseContractVersionArchive({ v: 1 }), [])
  const e = buildVoidedVersion({
    lease: signedLease, fileIds: [], closedLinkIds: [],
    voidedAt: VOID_AT, voidedBy: null, reason: null,
  })
  eq('이력 · 항목 수', parseContractVersionArchive([e, e]).length, 2)
  eq('이력 · 모양이 아닌 항목은 버린다', parseContractVersionArchive([e, { v: 99 }, null]).length, 1)
}

// ── 대조 기준 링크 ──
{
  const lease = { signatureSignedAt: SIGNED_AT, disposalSignatureSignedAt: DISPOSAL_AT }
  eq('기준 · 지금 서명을 만든 링크',
    isCurrentSignatureLink({ signedAt: SIGNED_AT, disposalSignedAt: DISPOSAL_AT }, lease), true)
  // 폐기 후 — lease 서명이 비면 어떤 옛 링크도 기준이 아니다.
  eq('기준 · 폐기 후에는 옛 링크가 기준이 아니다',
    isCurrentSignatureLink({ signedAt: SIGNED_AT, disposalSignedAt: DISPOSAL_AT },
      { signatureSignedAt: null, disposalSignatureSignedAt: null }), false)
  // 폐기 후 대면 재서명 — 새 시각이라 옛 링크와 안 맞는다(허위 드리프트 경고의 근원).
  eq('기준 · 대면 재서명은 옛 링크와 무관',
    isCurrentSignatureLink({ signedAt: SIGNED_AT, disposalSignedAt: DISPOSAL_AT },
      { signatureSignedAt: new Date('2026-08-20T01:00:00.000Z'), disposalSignatureSignedAt: null }), false)
  // 동의서 쪽만 일치해도 그 링크가 지금 서명의 출처다(반쪽 서명 상태 방어).
  eq('기준 · 동의서 시각만 일치해도 출처',
    isCurrentSignatureLink({ signedAt: null, disposalSignedAt: DISPOSAL_AT },
      { signatureSignedAt: null, disposalSignatureSignedAt: DISPOSAL_AT }), true)
  eq('기준 · 양쪽 다 없으면 거짓',
    isCurrentSignatureLink({ signedAt: null, disposalSignedAt: null },
      { signatureSignedAt: null, disposalSignatureSignedAt: null }), false)
  eq('기준 · lease 가 없으면 거짓', isCurrentSignatureLink({ signedAt: SIGNED_AT }, null), false)
}

console.log(`\n계약서 버전 폐기 회귀: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
