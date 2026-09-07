// 서류 보내기 행 규칙 회귀 테스트 — 실행: npx tsx scripts/test-doc-bundle.ts
//
// 여기서 고정하는 것 다섯(2026-08-17, 서류 묶음 발송 1단계, 신고 44501308).
//   · **계약 1건 무회귀** — 방 하나짜리 입주자는 그룹이 하나이고 행 넷이다(화면이 머리를 안 세운다).
//   · 계약서는 딸린 계약에 없다 — 합본이 추가 호실을 이미 싣는다. 한 사람에 계약서 한 줄.
//   · 납부 확인서는 계약마다 한 행. 미발급이어도 행은 선다(작성 왕복으로 보내려면 자리가 있어야 한다).
//   · 실거주 확인서는 거주 + 비거주(NON_RESIDENT) 계약에 선다(운영자 오더 2026-09-07).
//   · 계약을 말할 수 없는 파일은 중립 그룹 — 없는 계약에 갖다 붙이지 않는다.

import { buildDocBundle, type DocBundleFile, type DocBundleLease, type TenantDocBundle, type DocBundleContractVersion } from '../lib/docBundle'

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
const file = (leaseTermId: string | null, at: string, note: string | null = null, targetMonth?: string): DocBundleFile =>
  ({ driveFileId: `drive-${leaseTermId ?? 'none'}-${at}`, leaseTermId, at: D(at), note, targetMonth })

const lease = (p: Partial<DocBundleLease> & { id: string }): DocBundleLease => ({
  status: 'ACTIVE', moveInDate: D('2026-08-15'), depositAmount: 300000,
  parentLeaseTermId: null, roomNo: p.id, ...p,
})

const empty = { contracts: [], rents: [], deposits: [], certs: [] }
const build = (leases: DocBundleLease[], files: Partial<typeof empty> = {}, rentPaidLeaseIds: string[] = []): TenantDocBundle =>
  buildDocBundle({ tenantName: '테스트', leases, ...empty, ...files, rentPaidLeaseIds, now: NOW })

/** 그 그룹의 납부 확인서 행 — 아래 작성 문 케이스가 전부 이 한 줄을 본다. */
const rentRow = (b: TenantDocBundle) => b.groups[0].rows.find(r => r.docType === 'rent')!

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
    { room: '601', kind: 'lease', rows: ['rent', 'residence'] },
  ])
  const all = b.groups.flatMap(g => g.rows)
  eq('다호실 · 계약서는 한 줄', all.filter(r => r.docType === 'contract').length, 1)
  eq('다호실 · 계약서는 메인 계약의 것', all.find(r => r.docType === 'contract')?.leaseTermId, '509')
  eq('다호실 · 납부 확인서는 계약마다 두 행', all.filter(r => r.docType === 'rent').map(r => r.leaseTermId), ['509', '601'])
  // 비거주 601 에도 실거주 확인서 행이 선다(운영자 긴급 오더 2026-09-07, 이원빈 건).
  eq('다호실 · 실거주 확인서는 509 와 비거주 601', all.filter(r => r.docType === 'residence').map(r => r.leaseTermId), ['509', '601'])
  eq('다호실 · 601 비거주에도 실거주 후보가 선다',
    b.groups[1].rows.some(r => r.docType === 'residence'), true)
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

// ── 계약서 판본(긴급 신고 2026-08-25, 419호) ──────────────────────────
// 여기서 지키는 것 셋.
//   · **기본 선택은 언제나 대표본** — 판본을 얹어도 행의 driveFileId 가 안 바뀐다(무회귀).
//   · **대표가 공석이어도 행은 서고 판본이 후보로 남는다** — 제출용만 남은 계약을 보낼 길.
//   · **폐기본은 후보가 아니다** — 조회부가 걸러 넘기는 것을 여기서 못 박는다.
const ver = (o: Partial<DocBundleContractVersion> & { contractFileId: string; leaseTermId: string | null }) => ({
  driveFileId: `drive-${o.contractFileId}`, at: '2026-08-01T00:00:00.000Z',
  purposeLabel: null, note: null, representative: false, mime: 'application/pdf', ...o,
})
{
  // 실계약 대표 + 제출용 1부
  const b = buildDocBundle({
    tenantName: '테스트', ...empty, leases: [lease({ id: '419', roomNo: '419' })],
    contracts: [file('419', '2026-05-11', '스캔본')],
    contractVersions: [
      ver({ contractFileId: 'scan', leaseTermId: '419', note: '스캔본', representative: true }),
      ver({ contractFileId: 'sub', leaseTermId: '419', purposeLabel: '제출용', at: '2026-08-25T00:00:00.000Z' }),
    ],
    now: NOW,
  })
  const row = b.groups[0].rows.find(r => r.docType === 'contract')!
  eq('판본 · 기본 선택은 대표본 그대로', row.driveFileId, 'drive-419-2026-05-11')
  eq('판본 · 두 부가 후보로 실린다', row.versions?.length, 2)
  eq('판본 · 파생 라벨', row.versions?.[1].purposeLabel, '제출용')
  eq('판본 · 대표 표시', row.versions?.map(v => v.representative), [true, false])
  eq('판본 · leaseTermId 는 행에 안 실린다', 'leaseTermId' in (row.versions?.[0] ?? {}), false)
}
{
  // 419 실제 상황 — 스캔본을 지워 대표가 공석이고 제출용만 남았다
  const b = buildDocBundle({
    tenantName: '테스트', ...empty, leases: [lease({ id: '419', roomNo: '419' })],
    contracts: [],
    contractVersions: [ver({ contractFileId: 'sub', leaseTermId: '419', purposeLabel: '제출용' })],
    now: NOW,
  })
  const row = b.groups[0].rows.find(r => r.docType === 'contract')!
  eq('공석 · 행은 선다', !!row, true)
  eq('공석 · 대표 파일은 없다', row.driveFileId, null)
  eq('공석 · 판본은 후보로 남는다', row.versions?.length, 1)
  eq('공석 · 사실을 말한다', row.note, '실계약 계약서가 없습니다')
}
{
  // 무회귀 — 판본을 안 넘기면 행 모양이 종전과 완전히 같다
  const b = buildDocBundle({
    tenantName: '테스트', ...empty, leases: [lease({ id: '509', roomNo: '509' })],
    contracts: [file('509', '2026-08-01')], now: NOW,
  })
  const row = b.groups[0].rows.find(r => r.docType === 'contract')!
  eq('무회귀 · versions 없음', row.versions, undefined)
  eq('무회귀 · 파일 그대로', row.driveFileId, 'drive-509-2026-08-01')
}

// ── 이번 달 납부 확인서를 새로 쓸 문 (2026-09-03 운영자 요청) ──────────
//
// 지난달 발급본이 있으면 행은 '발급됨'이라 종전에는 새로 만들 길이 없었다. 이 시트가 발급의
// 유일한 입구가 된 뒤로(2026-08-29) 그 길이 곧 막힌 길이었다. 문은 둘의 곱으로만 연다.
// NOW 는 KST 2026-08-17 이다.
{
  const paid = ['402']
  const stale = { rents: [file('402', '2026-07-20')] }

  const a = build([lease({ id: '402' })], stale, paid)
  eq('작성 문 · 지난달 발급본 + 이번 달 납부면 열린다', rentRow(a).canWriteNew, true)
  eq('작성 문 · 그때도 보조 문구는 그대로', rentRow(a).note, '이번 달 발급본이 아닙니다')

  const b = build([lease({ id: '402' })], stale, [])
  eq('작성 문 · 이번 달 납부가 없으면 안 열린다', rentRow(b).canWriteNew, false)

  // 이번 달 발급본이면 stale 자체가 없다 — 문을 물을 상황이 아니다.
  const c = build([lease({ id: '402' })], { rents: [file('402', '2026-08-05')] }, paid)
  eq('작성 문 · 이번 달 발급본이면 보조 문구 없음', rentRow(c).note, null)
  eq('작성 문 · 그때는 플래그도 안 선다', rentRow(c).canWriteNew, undefined)

  // 미발급 행은 이미 [작성]이 서므로 여기서 다시 열 것이 없다.
  const d = build([lease({ id: '402' })], {}, paid)
  eq('작성 문 · 미발급 행에는 플래그가 없다', rentRow(d).canWriteNew, undefined)

  // 다른 종류에는 절대 서지 않는다 — 그 서류들은 달과 무관하다.
  const e = build([lease({ id: '402' })], { rents: [file('402', '2026-07-20')], deposits: [file('402', '2026-07-20')], certs: [file('402', '2026-07-20')], contracts: [file('402', '2026-07-20')] }, paid)
  for (const t of ['contract', 'deposit', 'residence'] as const) {
    eq(`작성 문 · ${t} 행에는 플래그가 없다`, e.groups[0].rows.find(r => r.docType === t)!.canWriteNew, undefined)
  }

  // 납부한 계약만 열린다 — 한 사람이 방을 둘 쓰면 계약마다 답이 다르다.
  // 단기는 발급 화면이 대상월을 무시하고 입주월로 고정한다 — 라벨 '이번 달'이 거짓이 된다.
  const sh = build([lease({ id: '402', isShortTerm: true })], stale, paid)
  eq('작성 문 · 단기 계약에는 안 선다', rentRow(sh).canWriteNew, undefined)

  const f = build([lease({ id: '402' }), lease({ id: '601' })],
    { rents: [file('402', '2026-07-20'), file('601', '2026-07-20')] }, ['402'])
  const rows = f.groups.flatMap(g => g.rows).filter(r => r.docType === 'rent')
  eq('작성 문 · 납부한 계약만 열린다', rows.map(r => r.canWriteNew), [true, false])
}

// ── 선납 발급 (귀속월 축, 2026-09-03) ────────────────────────────────
//
// 8월에 9월분을 선납받아 미리 발급한 종이가 있다. 발행일로 판정하면 9월에 그것이 stale 로 뜨고
// 9월 납부 기록도 있어 문까지 열려 같은 달 확인서가 두 장 나간다. 귀속월로 판정하면 닫힌다.
// NOW 는 KST 2026-08-17 이다.
{
  // 8/17 에 8월분을 발급했다 — 이번 달 것이다.
  const a = build([lease({ id: '402' })], { rents: [file('402', '2026-08-17', null, '2026-08')] }, ['402'])
  eq('선납 · 귀속월이 이번 달이면 stale 아님', rentRow(a).note, null)

  // 8/17 에 9월분을 미리 발급했다 — 발행일은 이번 달이지만 귀속월은 다음 달이다.
  const b = build([lease({ id: '402' })], { rents: [file('402', '2026-08-17', null, '2026-09')] }, ['402'])
  eq('선납 · 귀속월이 다음 달이면 stale 로 본다(이번 달 것이 아니다)', rentRow(b).note, '이번 달 발급본이 아닙니다')

  // 7/20 에 8월분을 미리 발급했다 — 발행일은 지난달인데 귀속월이 이번 달이라 stale 이 아니다.
  // 종전 발행일 판정에서는 여기가 stale 로 떠서 문이 열리고 두 장이 나갔다.
  const c = build([lease({ id: '402' })], { rents: [file('402', '2026-07-20', null, '2026-08')] }, ['402'])
  eq('선납 · 발행일이 지난달이어도 귀속월이 이번 달이면 stale 아님', rentRow(c).note, null)
  eq('선납 · 그러면 문도 안 열린다(중복 발급 봉합)', rentRow(c).canWriteNew, undefined)

  // 귀속월이 없는 옛 발급본은 종전대로 발행일로 읽는다.
  const d = build([lease({ id: '402' })], { rents: [file('402', '2026-07-20')] }, ['402'])
  eq('선납 · 귀속월이 없으면 발행일 폴백', rentRow(d).note, '이번 달 발급본이 아닙니다')
}

console.log(`\n서류 보내기 행 규칙 회귀: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
