// 서명 서류 정본 회귀 — key 문법·병합 불멸·두 축의 갈림을 진리표로 못박는다.
import {
  isValidDocKey, parseSignDocuments, activeSignDocuments, parseDocumentSignatures, parseDocSignedAt,
  mergeSignDocuments, paperDocsOf, leaseSignSlots, linkSignSlots,
} from '../lib/signDocuments'
import { signStageSlots, missingSlots, signProgressLabelSlots } from '../lib/disposalSignGate'

let pass = 0
const fails: string[] = []
const eq = (name: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) pass++
  else fails.push(`${name}: 기대 ${w} / 실제 ${g}`)
}
// 배열을 인덱스로 짚는 자리는 전부 옵셔널이다. 역주입으로 배열이 비면 종전에는
// `added[1].key` 가 TypeError 로 **크래시**했다. exit 1 이라 게이트는 막혔지만 화면에는
// 스택만 남고 어느 진리표가 깨졌는지가 안 보였다. 실패는 읽히는 문장으로 나와야 고칠 수 있다.

// ── key 문법 ────────────────────────────────────────────────
eq('정상 key', isValidDocKey('d7fk2p'), true)
eq('예약어 contract 금지', isValidDocKey('contract'), false)
eq('예약어 disposal 금지', isValidDocKey('disposal'), false)
eq('대문자 금지', isValidDocKey('Abcd'), false)
eq('3자 이하 금지', isValidDocKey('abc'), false)
eq('점 금지', isValidDocKey('a.bcd'), false)
eq('빈 값 금지', isValidDocKey(''), false)
eq('문자열 아니면 금지', isValidDocKey(123), false)

// ── 리졸버 방어 ─────────────────────────────────────────────
eq('null 은 빈 배열', parseSignDocuments(null), [])
eq('배열 아니면 빈 배열', parseSignDocuments({ a: 1 }), [])
eq('모양 아닌 항목은 버린다', parseSignDocuments([{ key: 'ok12', title: 'T' }]), [])
eq('예약 key 항목은 버린다', parseSignDocuments([{ key: 'contract', title: 'T', body: 'B' }]), [])
eq('중복 key 는 첫 것만',
  parseSignDocuments([{ key: 'ab12', title: 'A', body: 'x' }, { key: 'ab12', title: 'B', body: 'y' }]).length, 1)
eq('createdAt 없으면 빈 문자열',
  parseSignDocuments([{ key: 'ab12', title: 'A', body: 'x' }])[0]?.createdAt, '')

{
  const raw = [
    { key: 'aa11', title: '차량 등록 동의서', body: 'b1', createdAt: '2026-09-01' },
    { key: 'bb22', title: '옛 서류', body: 'b2', createdAt: '2026-08-01', retiredAt: '2026-09-05' },
  ]
  eq('중지된 것은 active 에서 빠진다', activeSignDocuments(raw).map(d => d.key), ['aa11'])
  eq('중지돼도 정의는 남는다', parseSignDocuments(raw).map(d => d.key), ['aa11', 'bb22'])
}

eq('서명 맵 방어 - 이미지 없으면 버린다', parseDocumentSignatures({ aa11: { signedAt: 'x' } }), {})
eq('서명 맵 방어 - 예약 key 버린다', parseDocumentSignatures({ contract: { image: 'd' } }), {})
eq('링크 맵 방어 - 빈 문자열 버린다', parseDocSignedAt({ aa11: '' }), {})

// ── 병합. 삭제 경로가 없다는 것이 이 블록의 전부다 ───────────
{
  const stored = [{ key: 'aa11', title: 'A', body: 'x', createdAt: '2026-09-01' }]
  let n = 0
  const key = () => `zz${(++n).toString().padStart(2, '0')}`

  eq('payload 가 비어도 저장본은 안 지워진다',
    mergeSignDocuments(stored, [], key, '2026-09-06').map(d => d.key), ['aa11'])

  eq('아는 칸만 덮는다',
    mergeSignDocuments(stored, [{ key: 'aa11', title: 'A2', body: 'y' }], key, '2026-09-06')[0] ?? null,
    { key: 'aa11', title: 'A2', body: 'y', createdAt: '2026-09-01' })

  eq('key 는 편집으로 안 바뀐다',
    mergeSignDocuments(stored, [{ key: 'aa11', title: '완전히 다른 제목', body: 'z' }], key, '2026-09-06')[0]?.key,
    'aa11')

  const added = mergeSignDocuments(stored, [{ title: '새 서류', body: 'n' }], key, '2026-09-06')
  eq('새 항목은 서버가 key 를 발급한다', added.length, 2)
  eq('발급된 key 가 문법에 맞다', isValidDocKey(added[1]?.key), true)
  eq('발급 시각이 박힌다', added[1]?.createdAt, '2026-09-06')

  // 클라이언트가 남의 key 를 주장해도 저장본에 없으면 새 항목이다(위조 차단).
  const forged = mergeSignDocuments(stored, [{ key: 'ffff', title: '위조', body: 'w' }], key, '2026-09-06')
  eq('모르는 key 는 승계 안 되고 새로 발급된다', forged.some(d => d.key === 'ffff'), false)
  eq('그래도 항목 자체는 들어온다', forged.length, 2)

  const retired = mergeSignDocuments(stored, [{ key: 'aa11', title: 'A', body: 'x', retiredAt: '2026-09-06' }], key, '2026-09-06')
  eq('중지 도장이 찍힌다', retired[0]?.retiredAt, '2026-09-06')
  eq('다시 사용하면 도장이 지워진다',
    mergeSignDocuments(retired, [{ key: 'aa11', title: 'A', body: 'x' }], key, '2026-09-06')[0]?.retiredAt, undefined)
}

// ── 종이의 서류 목록 ────────────────────────────────────────
eq('스냅샷이 비면 계약서 한 장', paperDocsOf(null).map(d => d.key), ['contract'])
eq('동의서 켜지면 두 장', paperDocsOf({ disposalConsent: { enabled: true } }).map(d => d.key), ['contract', 'disposal'])
eq('추가 서류가 뒤에 붙는다',
  paperDocsOf({ disposalConsent: { enabled: true }, signDocuments: [{ key: 'aa11', title: '차량', body: 'b' }] }).map(d => d.key),
  ['contract', 'disposal', 'aa11'])
eq('중지된 추가 서류는 새 종이에 안 붙는다',
  paperDocsOf({ signDocuments: [{ key: 'aa11', title: '차량', body: 'b', retiredAt: '2026-09-05' }] }).map(d => d.key),
  ['contract'])
// 옛 박제에는 이 칸이 아예 없다. 소급으로 끼워 넣지 않는다.
eq('옛 스냅샷은 종전 그대로', paperDocsOf({ disposalConsent: { enabled: false } }).map(d => d.key), ['contract'])

// ── 두 축. 여기가 이 파일의 핵심이다 ─────────────────────────
{
  const docs = paperDocsOf({ disposalConsent: { enabled: true } })

  // 팜 까오 끄엉 실측 모양. 9/3 링크에 동의서만, 9/4 링크에 계약서만, 계약에는 둘 다.
  const lease = { signatureImageUrl: 'd1', disposalSignatureImageUrl: 'd2' }
  const link0903 = { signedAt: null, disposalSignedAt: new Date() }
  const link0904 = { signedAt: new Date(), disposalSignedAt: null }

  eq('계약 축은 종이에 둘 다 찍힌다고 말한다', signStageSlots({ slots: leaseSignSlots(docs, lease) }), 'complete')
  eq('링크 축은 9/3 링크에서 동의서만 받았다고 말한다', signStageSlots({ slots: linkSignSlots(docs, link0903) }), 'partial')
  eq('링크 축은 9/4 링크에서 계약서만 받았다고 말한다', signStageSlots({ slots: linkSignSlots(docs, link0904) }), 'partial')

  // 이것이 실측 15건의 정체다. 두 축이 갈리는 것 자체는 버그가 아니다 — 물음이 다르다.
  eq('두 축이 갈리는 것은 정상이다',
    signStageSlots({ slots: leaseSignSlots(docs, lease) }) !== signStageSlots({ slots: linkSignSlots(docs, link0904) }), true)

  // 반대 방향(링크는 완료, 계약은 비어 있음). 발급하면 서명란이 빈 종이가 나간다.
  eq('링크만 완료면 계약 축은 침묵한다',
    signStageSlots({ slots: leaseSignSlots(docs, {}) }), 'none')
  eq('그때 링크 축은 완료라고 말한다',
    signStageSlots({ slots: linkSignSlots(docs, { signedAt: new Date(), disposalSignedAt: new Date() }) }), 'complete')
}

// ── 추가 서류가 붙은 진행 판정 ───────────────────────────────
{
  const snap = { disposalConsent: { enabled: true }, signDocuments: [{ key: 'aa11', title: '차량 등록 동의서', body: 'b' }] }
  const docs = paperDocsOf(snap)
  eq('서류 셋', docs.length, 3)

  const s1 = leaseSignSlots(docs, { signatureImageUrl: 'd' })
  eq('계약서만이면 partial', signStageSlots({ slots: s1 }), 'partial')
  eq('남은 것 둘', missingSlots({ slots: s1 }).map(x => x.key), ['disposal', 'aa11'])
  eq('셋이면 건수로 말한다', signProgressLabelSlots({ slots: s1 }), '1건 서명됨 · 남은 서명 2건')

  const s2 = leaseSignSlots(docs, { signatureImageUrl: 'd', disposalSignatureImageUrl: 'd',
    documentSignatures: { aa11: { image: 'd', signedAt: '2026-09-06' } } })
  eq('셋 다 서명이면 complete', signStageSlots({ slots: s2 }), 'complete')

  // 서류 이름은 코드가 아니라 정의에서 온다.
  const s3 = leaseSignSlots(docs, { signatureImageUrl: 'd', disposalSignatureImageUrl: 'd' })
  eq('남은 서류를 제목으로 부른다', signProgressLabelSlots({ slots: s3 }), '2건 서명됨 · 남은 서명 1건')
  eq('그 제목이 정의에서 온 것이다', missingSlots({ slots: s3 })[0]?.title, '차량 등록 동의서')
}

// ── 고아 서명. 중지한 뒤에도 받아 둔 서명은 안 사라진다 ──────
{
  const docs = paperDocsOf({ signDocuments: [{ key: 'aa11', title: '차량', body: 'b', retiredAt: '2026-09-05' }] })
  eq('중지됐으니 새 종이에는 계약서뿐', docs.map(d => d.key), ['contract'])
  const slots = leaseSignSlots(docs, { documentSignatures: { aa11: { image: 'd', signedAt: 'x' } } })
  eq('그래도 받아 둔 서명은 슬롯으로 남는다', slots.length, 2)
  eq('그 상태는 none 이 아니라 partial', signStageSlots({ slots }), 'partial')
}

console.log(`\n서명 서류 정본 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.error(`  - ${f}`)
process.exit(fails.length > 0 ? 1 : 0)
