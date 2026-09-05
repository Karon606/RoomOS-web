// 서명을 받는 서류 목록의 정본 — 계약서·동의서·영업장이 만든 추가 서류를 한 문법으로 눕힌다.
//
// 왜 이 파일이 있나(2026-09-06). 서명 서류가 '계약서와 동의서 둘'로 코드 곳곳에 박혀 있었다.
// 영업장마다 쓰는 서류가 달라 제3의 서류를 만들 수 있어야 한다는 운영자 요구가 왔고, 그때
// 저장 자리가 셋으로 갈린다 — 계약서는 LeaseTerm 전용 칸, 동의서도 전용 칸, 추가 서류는 Json
// 맵이다. **그 갈림을 아는 곳은 이 파일 하나여야 한다.** 화면과 알림은 슬롯 배열만 본다.
//
// 그리고 서명 증거에 축이 둘 있다(knowledge/sign-evidence-axes.md). 둘은 다른 물음의 답이라
// 합치지 않고 함수를 나눠 이름에 축을 박았다. 화면이 어느 축을 부르는지가 곧 무엇을 묻는지다.
//
//   leaseSignSlots  계약 축. "지금 발급하면 이 종이에 서명이 다 찍히는가"
//   linkSignSlots   링크 축. "이 링크에서 무슨 일이 벌어졌는가"
//
// 실측에서 이 둘이 링크 37건 중 15건 갈렸다. 서명을 두 링크에 나눠 받으면 계약에는 쌓이는데
// 링크 행은 제 링크의 사건만 적기 때문이다. 홈 알림과 패널 배지가 '계약에 대한 주장'을 하면서
// 링크를 읽고 있었다.

import type { SignSlot } from '@/lib/disposalSignGate'

/** 영업장이 만든 추가 서류 한 장. Property.signDocuments 의 항목. */
export type SignDocument = {
  key: string        // 서버가 발급하는 무의미 난수. **생성 시 한 번, 이후 불변.**
  title: string
  body: string       // 줄바꿈으로 문단을 나눈다(동의서 body 와 같은 문법)
  createdAt: string  // ISO
  retiredAt?: string // 사용 중지 도장. 배열에서 빼지 않는다 — 뺀 순간 발급본의 근거가 사라진다
}

/** 한 계약에 쌓인 추가 서류 서명. LeaseTerm.documentSignatures. */
export type DocumentSignatureMap = Record<string, { image: string; signedAt: string }>

/** 한 링크에서 받은 추가 서류 서명 시각. ContractShareLink.docSignedAt. */
export type DocSignedAtMap = Record<string, string>

/** 계약서·동의서가 쓰는 예약 key. 추가 서류가 이 이름을 가질 수 없다. */
export const RESERVED_DOC_KEYS = ['contract', 'disposal'] as const

const KEY_RE = /^[a-z0-9_-]{4,40}$/

/**
 * key 문법. 서버가 발급한 것만 통과한다.
 *
 * 제목에서 slug 를 만들지 않는 이유. 제목을 고치면 key 를 다시 만들고 싶어지고, 그 한 번이
 * 이미 받아 둔 서명 전부를 고아로 만든다. 제목이 바뀌어도 서명이 안 끊긴다는 요구는
 * "key 는 생성 시 한 번, 이후 불변" 한 줄이 진다.
 */
export function isValidDocKey(k: unknown): k is string {
  return typeof k === 'string' && KEY_RE.test(k) && !RESERVED_DOC_KEYS.includes(k as 'contract')
}

/** 저장된 Json 을 안전하게 읽는다. 모양이 아닌 항목은 버린다(부분·구버전·오염 안전). */
export function parseSignDocuments(raw: unknown): SignDocument[] {
  if (!Array.isArray(raw)) return []
  const out: SignDocument[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const d = item as Partial<SignDocument>
    if (!isValidDocKey(d.key) || seen.has(d.key)) continue
    if (typeof d.title !== 'string' || typeof d.body !== 'string') continue
    seen.add(d.key)
    out.push({
      key: d.key, title: d.title, body: d.body,
      createdAt: typeof d.createdAt === 'string' ? d.createdAt : '',
      ...(typeof d.retiredAt === 'string' ? { retiredAt: d.retiredAt } : {}),
    })
  }
  return out
}

/** 지금 새 계약서에 붙는 서류만. 중지된 것은 정의가 남아 있어도 새 종이에는 안 실린다. */
export function activeSignDocuments(raw: unknown): SignDocument[] {
  return parseSignDocuments(raw).filter(d => !d.retiredAt)
}

/** 계약에 쌓인 추가 서류 서명. */
export function parseDocumentSignatures(raw: unknown): DocumentSignatureMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: DocumentSignatureMap = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isValidDocKey(k) || !v || typeof v !== 'object') continue
    const s = v as { image?: unknown; signedAt?: unknown }
    if (typeof s.image !== 'string' || !s.image) continue
    out[k] = { image: s.image, signedAt: typeof s.signedAt === 'string' ? s.signedAt : '' }
  }
  return out
}

/** 링크에서 받은 추가 서류 서명 시각. */
export function parseDocSignedAt(raw: unknown): DocSignedAtMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: DocSignedAtMap = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isValidDocKey(k) && typeof v === 'string' && v) out[k] = v
  }
  return out
}

/**
 * 저장 병합 정본. **삭제 경로가 없다.**
 *
 * 운영자 요구는 "기존에 발행했던 서류는 당연히 삭제가 되면 안 된다"였다. 그것을 화면 규칙이
 * 아니라 구조로 만든다. 저장본에 있는데 들어온 payload 에 없는 항목은 그대로 남는다 — 화면이
 * 무엇을 보내든 서버가 지우지 않는다.
 *
 * key 는 짝을 맞추는 데만 쓰고 절대 다시 만들지 않는다. 새 항목(key 없이 온 것)만 발급받는다.
 */
export function mergeSignDocuments(
  stored: unknown,
  incoming: Array<Partial<SignDocument>>,
  newKey: () => string,
  nowIso: string,
): SignDocument[] {
  const base = parseSignDocuments(stored)
  const byKey = new Map(base.map(d => [d.key, { ...d }]))
  const taken = new Set(byKey.keys())
  for (const item of incoming) {
    if (!item || typeof item.title !== 'string' || typeof item.body !== 'string') continue
    const found = isValidDocKey(item.key) ? byKey.get(item.key) : undefined
    if (found) {
      // 아는 칸만 덮는다. 모르는 칸은 건드리지 않는다.
      found.title = item.title
      found.body = item.body
      if (typeof item.retiredAt === 'string') found.retiredAt = item.retiredAt
      else delete found.retiredAt
      continue
    }
    // 새 항목. key 는 여기서만 태어난다.
    let k = newKey()
    while (taken.has(k) || !isValidDocKey(k)) k = newKey()
    taken.add(k)
    byKey.set(k, {
      key: k, title: item.title, body: item.body, createdAt: nowIso,
      ...(typeof item.retiredAt === 'string' ? { retiredAt: item.retiredAt } : {}),
    })
  }
  return [...byKey.values()]
}

/**
 * 그 종이에 붙는 서류 목록. **스냅샷에서 읽는다.**
 *
 * 라이브 영업장 설정을 보면 서류를 새로 켜는 순간 과거 계약 전부가 소급으로 반쪽이 되어
 * 알림이 도배된다. 기준은 "그 사람이 무엇을 보고 서명했나"이고 그것은 스냅샷에 있다.
 */
export function paperDocsOf(snapshot: unknown): Array<{ key: string; title: string }> {
  const s = snapshot as { disposalConsent?: { enabled?: boolean; title?: string }; signDocuments?: unknown } | null
  const out: Array<{ key: string; title: string }> = [{ key: 'contract', title: '입실계약서' }]
  if (s?.disposalConsent?.enabled === true) out.push({ key: 'disposal', title: '동의서' })
  for (const d of activeSignDocuments(s?.signDocuments)) out.push({ key: d.key, title: d.title })
  return out
}

/**
 * 계약 축. "지금 발급하면 이 종이에 서명이 다 찍히는가."
 *
 * 서명은 링크를 넘어 계약에 쌓인다. 링크를 두 번 발급해 한 장씩 나눠 받아도 종이에는 둘 다
 * 찍히고, 이 함수만이 그 사실을 안다.
 *
 * 목록에 없는데 서명이 있는 key 는 슬롯을 세운다. 받아 둔 서명이 판정에서 사라져 partial 이
 * none 으로 내려앉는 길을 막는다(disposalSignGate.toSlots 와 같은 규칙).
 */
export function leaseSignSlots(
  docs: Array<{ key: string; title: string }>,
  lease: {
    signatureImageUrl?: string | null; signatureSignedAt?: Date | string | null
    disposalSignatureImageUrl?: string | null; disposalSignatureSignedAt?: Date | string | null
    documentSignatures?: unknown
  },
): SignSlot[] {
  const custom = parseDocumentSignatures(lease.documentSignatures)
  const signedOf = (key: string): boolean => {
    if (key === 'contract') return !!(lease.signatureImageUrl || lease.signatureSignedAt)
    if (key === 'disposal') return !!(lease.disposalSignatureImageUrl || lease.disposalSignatureSignedAt)
    return !!custom[key]
  }
  return withOrphans(docs, signedOf, Object.keys(custom))
}

/**
 * 링크 축. "이 링크에서 무슨 일이 벌어졌는가."
 *
 * 입주자 앞의 종이는 그 링크의 스냅샷이고 그 위의 서명은 그 링크의 자국이다. 이어받기가
 * 자국을 승계하므로 이 축이 곧 그 종이의 축이다. 여기서 계약 축을 쓰면 **다른 종이에서 받은
 * 서명이 이 종이의 진행으로 셈된다.**
 */
export function linkSignSlots(
  docs: Array<{ key: string; title: string }>,
  link: { signedAt?: Date | string | null; disposalSignedAt?: Date | string | null; docSignedAt?: unknown },
): SignSlot[] {
  const custom = parseDocSignedAt(link.docSignedAt)
  const signedOf = (key: string): boolean => {
    if (key === 'contract') return !!link.signedAt
    if (key === 'disposal') return !!link.disposalSignedAt
    return !!custom[key]
  }
  return withOrphans(docs, signedOf, Object.keys(custom))
}

/** 목록 + 목록 밖 고아 서명. 두 축이 같은 규칙을 쓴다. */
function withOrphans(
  docs: Array<{ key: string; title: string }>,
  signedOf: (key: string) => boolean,
  signedKeys: string[],
): SignSlot[] {
  const slots: SignSlot[] = docs.map(d => ({ key: d.key, title: d.title, signed: signedOf(d.key) }))
  const known = new Set(docs.map(d => d.key))
  for (const k of signedKeys) {
    if (!known.has(k)) slots.push({ key: k, title: '서류', signed: true })
  }
  return slots
}
