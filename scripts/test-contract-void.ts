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
  archiveOwnsEachFileOnce, buildVoidedVersion, hasVoidableVersion, isCurrentSignatureLink,
  pickCurrentSignatureLink, parseContractVersionArchive, restoreTargetsFrom, restoredFieldsFrom,
  versionKind, voidedVersionHasEvidence,
  type VoidableLease,
} from '../lib/contractVersion'
import {
  currentIssueFor, currentIssueIds, hasLiveRealContract, issueGroupKey, type IssueCopy,
} from '../lib/contractCurrentIssue'
import { contractPurposeLabel, normalizeIssuePurpose } from '../lib/contractPurpose'

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

  // ── 발급이 계약일을 어느 링크에서 읽나 — 종이에 찍히는 날짜의 출처 ──
  // 최신 하나를 집으면 폐기 후 대면 재서명한 계약서에 옛 날짜가 인쇄된다.
  const OLD = { id: 'old', signedAt: SIGNED_AT, disposalSignedAt: DISPOSAL_AT }
  const RESIGN_AT = new Date('2026-08-20T01:00:00.000Z')
  const NEW = { id: 'new', signedAt: RESIGN_AT, disposalSignedAt: null }
  eq('발급 출처 · 원격 재서명이면 새 링크를 고른다',
    pickCurrentSignatureLink([NEW, OLD], { signatureSignedAt: RESIGN_AT, disposalSignatureSignedAt: null })?.id, 'new')
  eq('발급 출처 · 대면 재서명이면 어떤 링크도 안 고른다(lease 시각으로 떨어진다)',
    pickCurrentSignatureLink([OLD], { signatureSignedAt: RESIGN_AT, disposalSignatureSignedAt: null }), null)
  eq('발급 출처 · 폐기 직후 서명 0 이면 없음',
    pickCurrentSignatureLink([OLD], { signatureSignedAt: null, disposalSignatureSignedAt: null }), null)
  eq('발급 출처 · 평시에는 그 링크 그대로',
    pickCurrentSignatureLink([OLD], { signatureSignedAt: SIGNED_AT, disposalSignatureSignedAt: DISPOSAL_AT })?.id, 'old')
  eq('발급 출처 · 링크가 없어도 터지지 않는다', pickCurrentSignatureLink([], { signatureSignedAt: SIGNED_AT }), null)
}

// ── 이동 종류(kind) 정규화 ──
// 폐기와 '새 버전 작성'이 한 배열에 쌓인다. kind 없는 구항목이 폐기로 읽히는 것이 이 묶음의 몸통이다.
{
  const base = buildVoidedVersion({
    lease: signedLease, fileIds: ['file-015'], closedLinkIds: [],
    voidedAt: VOID_AT, voidedBy: null, reason: null,
  })
  eq('종류 · kind 없는 구항목은 폐기', versionKind(base), 'void')
  eq('종류 · kind 를 안 넘기면 칸 자체가 안 생긴다', 'kind' in base, false)
  const sup = buildVoidedVersion({
    lease: signedLease, fileIds: ['file-016'], closedLinkIds: [],
    voidedAt: VOID_AT, voidedBy: null, reason: '새 버전 작성', kind: 'supersede',
  })
  eq('종류 · supersede 항목', versionKind(sup), 'supersede')
  eq('종류 · void 를 명시해도 폐기', versionKind({ ...base, kind: 'void' }), 'void')
  // 모르는 값은 폐기로 떨어진다 — supersede 로 읽으면 되돌리기가 엉뚱한 도장을 지운다.
  eq('종류 · 모르는 값은 폐기로 떨어진다',
    versionKind({ ...base, kind: 'archive' as unknown as 'void' }), 'void')
  // v 를 올리면 새 항목이 파서에서 통째로 사라진다 — 그 사실을 못으로 박는다.
  eq('종류 · v 를 올린 항목은 파서가 버린다',
    parseContractVersionArchive([{ ...base, v: 2 }]).length, 0)
  eq('종류 · 섞인 배열의 순서와 개수가 보존된다',
    parseContractVersionArchive([base, sup]).map(versionKind), ['void', 'supersede'])

  // supersede 항목도 폐기와 똑같이 증거를 담는다(G7 통과).
  eq('종류 · supersede 도 서명 이미지를 담는다', sup.signature.contractImage, signedLease.signatureImageUrl)
  eq('종류 · supersede 도 G7 통과', voidedVersionHasEvidence(sup), true)
  // fileIds 를 비우지 않는다 — 어느 종이가 이 이동으로 구버전이 됐는지가 증거다.
  eq('종류 · supersede 도 발급본 목록을 담는다', sup.fileIds, ['file-016'])
  // 서명이 없는 lease 로 만든 항목은 빈 껍데기다 — 진입로에 hasVoidableVersion 게이트가 필요한 근거.
  const emptySup = buildVoidedVersion({
    lease: { signatureImageUrl: null, signatureSignedAt: null, disposalSignatureImageUrl: null, disposalSignatureSignedAt: null, signedContractSnapshot: null },
    fileIds: [], closedLinkIds: [], voidedAt: VOID_AT, voidedBy: null, reason: null, kind: 'supersede',
  })
  eq('종류 · 서명 없는 supersede 는 G7 위반', voidedVersionHasEvidence(emptySup), false)
}

// ── 도장 소유권 — 되돌리기가 무엇을 지우는가 ──
// 한 발급본은 이력 항목 하나에만 속해야 한다. 두 항목이 같은 파일을 소유하면 나중 항목을
// 되돌릴 때 앞 항목이 찍은 도장까지 지워져, 폐기된 종이가 이력만 남긴 채 되살아난다.
{
  const v = buildVoidedVersion({
    lease: signedLease, fileIds: ['file-A'], closedLinkIds: [],
    voidedAt: VOID_AT, voidedBy: null, reason: null,
  })
  const s = buildVoidedVersion({
    lease: signedLease, fileIds: ['file-B'], closedLinkIds: [],
    voidedAt: VOID_AT, voidedBy: null, reason: null, kind: 'supersede',
  })
  eq('도장 · 폐기를 되돌리면 voidedAt 을 지운다', restoreTargetsFrom(v), { ids: ['file-A'], clear: 'voidedAt' })
  eq('도장 · 새 버전을 되돌리면 supersededAt 을 지운다', restoreTargetsFrom(s), { ids: ['file-B'], clear: 'supersededAt' })
  eq('도장 · kind 없는 구항목은 voidedAt 을 지운다',
    restoreTargetsFrom({ ...v, kind: undefined }).clear, 'voidedAt')
  eq('도장 · 소유가 겹치지 않으면 통과', archiveOwnsEachFileOnce([v, s]), true)
  // 이동 쿼리가 이미 도장 찍힌 파일을 다시 집은 모양 — 이것이 거짓이어야 한다.
  const greedy = { ...s, fileIds: ['file-A', 'file-B'] }
  eq('도장 · 한 파일을 두 항목이 소유하면 위반', archiveOwnsEachFileOnce([v, greedy]), false)
  eq('도장 · 빈 이력은 통과', archiveOwnsEachFileOnce([]), true)

  // LIFO — 마지막 항목이 무엇인지가 적용취소의 대상이다.
  const archive = parseContractVersionArchive([v, s])
  eq('도장 · 마지막 항목은 새 버전', versionKind(archive[archive.length - 1]), 'supersede')
}

// ── 대표본 판정 — 실계약 고정 ──
// 종전 '폐기 아닌 것 중 최신' 은 어제 뽑은 번역본을 대표로 만든다. 목적이 먼저 거른다.
{
  const f = (over: Partial<IssueCopy> & { id: string }): IssueCopy => ({
    leaseTermId: 'lease-1', createdAt: new Date('2026-08-01T00:00:00.000Z'),
    voidedAt: null, supersededAt: null, issuePurpose: null, ...over,
  })
  eq('묶음 · leaseTermId 가 있으면 그 값', issueGroupKey({ id: 'x', leaseTermId: 'lease-1' }), 'lease-1')
  eq('묶음 · 연결이 끊긴 파일은 자기 자신이 한 그룹', issueGroupKey({ id: 'x', leaseTermId: null }), 'single:x')

  const real = f({ id: 'real', createdAt: new Date('2026-08-01T00:00:00.000Z') })
  const trans = f({ id: 'trans', createdAt: new Date('2026-08-20T00:00:00.000Z'), issuePurpose: '번역본' })
  eq('대표 · 나중에 뽑은 번역본이 아니라 실계약이 대표',
    currentIssueIds([real, trans]).get('lease-1'), 'real')
  eq('대표 · 파생 판본은 후보가 아니다', currentIssueIds([trans]).size, 0)
  eq('대표 · 폐기본은 후보가 아니다',
    currentIssueIds([{ ...real, voidedAt: new Date() }]).size, 0)
  // 구버전 도장은 '실계약이 아니다' 가 아니다 — 그것까지 빼면 새 판본을 만든 순간 대표가 사라진다.
  eq('대표 · 구버전 도장이 찍혀도 실계약이면 대표',
    currentIssueIds([{ ...real, supersededAt: new Date() }]).get('lease-1'), 'real')
  eq('대표 · 목적 칸이 없던 구본은 실계약으로 읽는다',
    currentIssueIds([{ ...real, issuePurpose: undefined }]).get('lease-1'), 'real')
  // 실계약이 둘이면(정정으로 다시 쓴 경우) 그때만 시각이 동률을 가른다.
  const fixed = f({ id: 'fixed', createdAt: new Date('2026-08-10T00:00:00.000Z') })
  eq('대표 · 실계약이 여럿이면 나중 것', currentIssueIds([real, fixed]).get('lease-1'), 'fixed')
  // 1부뿐인 그룹도 대표를 돌려준다 — 서류 보내기가 이 답에 기댄다.
  eq('대표 · 1부뿐이어도 답한다', currentIssueIds([real]).get('lease-1'), 'real')
  eq('대표 · 전부 폐기면 그 그룹의 대표가 없다',
    currentIssueIds([{ ...real, voidedAt: new Date() }, trans]).has('lease-1'), false)

  eq('대표 · 계약 지목 조회', currentIssueFor([real, trans], 'lease-1')?.id, 'real')
  eq('대표 · 대표가 없으면 null(폐기본으로 폴백하지 않는다)',
    currentIssueFor([{ ...real, voidedAt: new Date() }], 'lease-1'), null)
  eq('대표 · 남의 계약은 안 고른다', currentIssueFor([real], 'lease-2'), null)

  eq('선행 · 실계약이 있으면 파생을 만들 수 있다', hasLiveRealContract([real], 'lease-1'), true)
  eq('선행 · 번역본만 있으면 파생을 못 만든다', hasLiveRealContract([trans], 'lease-1'), false)
  eq('선행 · 실계약이 폐기됐으면 파생을 못 만든다',
    hasLiveRealContract([{ ...real, voidedAt: new Date() }], 'lease-1'), false)

  // 목적 정규화 — 화이트리스트 밖은 거부하고, 실계약은 저장값 null 이다.
  eq('목적 · 안 실으면 실계약(null)', normalizeIssuePurpose(undefined), { ok: true, value: null })
  eq('목적 · 실계약을 고르면 null 로 저장', normalizeIssuePurpose('실계약'), { ok: true, value: null })
  eq('목적 · 제출용', normalizeIssuePurpose('제출용'), { ok: true, value: '제출용' })
  eq('목적 · 화이트리스트 밖은 거부', normalizeIssuePurpose('진짜계약서2'), { ok: false })
  eq('목적 · 문자열이 아니면 거부', normalizeIssuePurpose(42), { ok: false })
  eq('목적 · 실계약은 화면에 안 적는다', contractPurposeLabel(null), null)
  eq('목적 · 모르는 저장값은 실계약으로 읽는다', contractPurposeLabel('알수없음'), null)
  eq('목적 · 파생은 그대로 적는다', contractPurposeLabel('번역본'), '번역본')
}

console.log(`\n계약서 버전 폐기 회귀: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
