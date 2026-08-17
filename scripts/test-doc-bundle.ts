// 서류 보내기 행 규칙 회귀 테스트 — 실행: npx tsx scripts/test-doc-bundle.ts
//
// 여기서 고정하는 것 다섯(2026-08-17, 서류 묶음 발송 1단계, 신고 44501308).
//   · **계약 1건 무회귀** — 방 하나짜리 입주자는 그룹이 하나이고 행 넷이다(화면이 머리를 안 세운다).
//   · 계약서는 딸린 계약에 없다 — 합본이 추가 호실을 이미 싣는다. 한 사람에 계약서 한 줄.
//   · 납부 확인서는 계약마다 한 행. 미발급이어도 행은 선다(작성 왕복으로 보내려면 자리가 있어야 한다).
//   · 실거주 확인서는 거주 계약만. 비거주 계약에는 후보 자체가 없다(발급본이 이미 있을 때만 예외).
//   · 계약을 말할 수 없는 파일은 중립 그룹 — 없는 계약에 갖다 붙이지 않는다.

import { buildDocBundle, type DocBundleFile, type DocBundleLease, type TenantDocBundle } from '../lib/docBundle'

let pass = 0
let fail = 0
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; return }
  fail++
  console.error(`FAIL ${name}\n  기대: ${e}\n  실제: ${a}`)
}

const NOW = new Date('2026-08-17T03:00:00.000Z')   // KST 2026-08-17 정오
const D = (s: string) => new Date(`${s}T00:00:00.000Z`)
const file = (leaseTermId: string | null, at: string, note: string | null = null): DocBundleFile =>
  ({ driveFileId: `drive-${leaseTermId ?? 'none'}-${at}`, leaseTermId, at: D(at), note })

const lease = (p: Partial<DocBundleLease> & { id: string }): DocBundleLease => ({
  status: 'ACTIVE', moveInDate: D('2026-08-15'), depositAmount: 300000,
  parentLeaseTermId: null, roomNo: p.id, ...p,
})

const empty = { contracts: [], rents: [], deposits: [], certs: [] }
const build = (leases: DocBundleLease[], files: Partial<typeof empty> = {}): TenantDocBundle =>
  buildDocBundle({ tenantName: '테스트', leases, ...empty, ...files, now: NOW })

/** 그룹별 행 종류 — 규칙 대조는 이 모양 하나로 충분하다(파일 유무는 따로 본다). */
const shape = (b: TenantDocBundle) => b.groups.map(g => ({ room: g.roomNo, kind: g.kind, rows: g.rows.map(r => r.docType) }))

// ── 무회귀 축 ── 계약 하나짜리 입주자(전건의 모양).
{
  const b = build([lease({ id: '402' })])
  eq('무회귀 · 계약 1건이면 그룹도 1개', b.groups.length, 1)
  eq('무회귀 · 행은 계약서·납부·보증금·실거주 넷',
    b.groups[0].rows.map(r => r.docType), ['contract', 'rent', 'deposit', 'residence'])
  eq('무회귀 · 발급본이 없으면 전부 미발급', b.groups[0].rows.every(r => r.driveFileId === null), true)
  eq('무회귀 · 모든 행이 계약을 명시', b.groups[0].rows.every(r => r.leaseTermId === '402'), true)
}
{
  // 보증금 0원 계약(비거주 창고 등 단독)에는 보증금 영수증 칸이 없다.
  const b = build([lease({ id: '402', depositAmount: 0 })])
  eq('보증금 0원이면 영수증 칸 없음', b.groups[0].rows.map(r => r.docType), ['contract', 'rent', 'residence'])
}

// ── 다호실 축 ── 509 메인 + 601 비거주 종속(실기 기준 형태).
{
  const leases = [
    lease({ id: '509', status: 'ACTIVE', roomNo: '509' }),
    lease({ id: '601', status: 'NON_RESIDENT', roomNo: '601', depositAmount: 0, parentLeaseTermId: '509' }),
  ]
  const b = build(leases)
  eq('다호실 · 그룹은 계약 수만큼', b.groups.length, 2)
  eq('다호실 · 거주 계약이 먼저', b.groups.map(g => g.roomNo), ['509', '601'])
  eq('다호실 · 행 구성', shape(b), [
    { room: '509', kind: 'lease', rows: ['contract', 'rent', 'deposit', 'residence'] },
    { room: '601', kind: 'lease', rows: ['rent'] },
  ])
  const all = b.groups.flatMap(g => g.rows)
  eq('다호실 · 계약서는 한 줄', all.filter(r => r.docType === 'contract').length, 1)
  eq('다호실 · 계약서는 메인 계약의 것', all.find(r => r.docType === 'contract')?.leaseTermId, '509')
  eq('다호실 · 납부 확인서는 계약마다 두 행', all.filter(r => r.docType === 'rent').map(r => r.leaseTermId), ['509', '601'])
  eq('다호실 · 실거주 확인서는 509 만', all.filter(r => r.docType === 'residence').map(r => r.leaseTermId), ['509'])
  eq('다호실 · 601 비거주에는 실거주 후보 없음',
    b.groups[1].rows.some(r => r.docType === 'residence'), false)
}
{
  // 비거주 계약에 실거주 확인서가 이미 발급돼 있으면 그것은 사실이라 감추지 않는다.
  const leases = [
    lease({ id: '509', status: 'ACTIVE', roomNo: '509' }),
    lease({ id: '601', status: 'NON_RESIDENT', roomNo: '601', depositAmount: 0, parentLeaseTermId: '509' }),
  ]
  const b = build(leases, { certs: [file('601', '2026-05-02')] })
  eq('비거주 · 이미 발급된 실거주 확인서는 남는다',
    b.groups[1].rows.map(r => r.docType), ['rent', 'residence'])
  eq('비거주 · 그 행은 발급본을 들고 있다',
    b.groups[1].rows.find(r => r.docType === 'residence')?.driveFileId, 'drive-601-2026-05-02')
}
{
  // 딸리지 않은 두 번째 계약은 제 계약서를 갖는다(합본이 안 싣는 계약이라 종이가 따로다).
  const b = build([
    lease({ id: '509', roomNo: '509' }),
    lease({ id: '302', roomNo: '302', parentLeaseTermId: null }),
  ])
  eq('단독 두 계약 · 계약서는 각각',
    b.groups.flatMap(g => g.rows).filter(r => r.docType === 'contract').map(r => r.leaseTermId), ['509', '302'])
}

// ── 최신본·보조 문구 ──
{
  const b = build([lease({ id: '509', roomNo: '509' })], {
    rents: [file('509', '2026-08-03'), file('509', '2026-07-03')],
  })
  const rent = b.groups[0].rows.find(r => r.docType === 'rent')
  eq('최신본 · 계약별 최신 한 건', rent?.driveFileId, 'drive-509-2026-08-03')
  eq('최신본 · 이번 달이면 보조 문구 없음', rent?.note, null)
}
{
  const b = build([lease({ id: '509', roomNo: '509' })], { rents: [file('509', '2026-06-03')] })
  eq('오래된 발급본 · 막지 않고 회색 문구만',
    b.groups[0].rows.find(r => r.docType === 'rent')?.note, '이번 달 발급본이 아닙니다')
  eq('오래된 발급본 · 그래도 보낼 수 있다',
    !!b.groups[0].rows.find(r => r.docType === 'rent')?.driveFileId, true)
}
{
  const b = build([lease({ id: '509', roomNo: '509' })], { contracts: [file('509', '2026-08-01', '스캔본')] })
  eq('스캔본 · 표기로 후보에 실린다', b.groups[0].rows[0].note, '스캔본')
  eq('스캔본 · 보낼 수 있다', !!b.groups[0].rows[0].driveFileId, true)
}

// ── 중립 그룹 ──
{
  const b = build([lease({ id: '509', roomNo: '509' })], { rents: [file(null, '2026-02-03')] })
  eq('중립 · 계약 없는 옛 파일은 중립 그룹', b.groups[1].kind, 'other')
  eq('중립 · 표기', b.groups[1].rows[0].note, '계약 표시 없음')
  eq('중립 · 계약을 지어내지 않는다', b.groups[1].rows[0].leaseTermId, null)
  eq('중립 · 509 납부 행은 여전히 미발급',
    b.groups[0].rows.find(r => r.docType === 'rent')?.driveFileId, null)
}
{
  const b = build([lease({ id: '509', roomNo: '509' })], { certs: [file('끝난계약', '2026-01-03')] })
  eq('중립 · 끝난 계약 발급본도 감추지 않는다', b.groups[1].rows[0].note, '지난 계약')
}
{
  const b = build([lease({ id: '509', roomNo: '509' })])
  eq('중립 · 떠도는 파일이 없으면 그룹도 없다', b.groups.length, 1)
}

console.log(`\n서류 보내기 행 규칙 회귀: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
