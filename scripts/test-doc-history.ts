// 발급 서류 이력 정렬·보조문구 회귀 — lib/docHistory. 실패 시 exit 1.
// 실행: npx tsx scripts/test-doc-history.ts
//
// 왜 고정하는가. 이 목록은 원장이라 **순서가 곧 사실**이다. 정렬이 흔들리면 같은 화면을 두 번
// 열 때 줄이 뒤바뀌고, 운영자가 "아까 위에 있던 게 어디 갔지"를 겪는다. 그리고 납부 확인서의
// 귀속월은 발행일과 다른 축이라(선납) 보조 문구가 그것을 말해야 같은 날 나간 두 장이 갈린다.
import { sortDocHistory, docHistoryNote, type DocHistoryFile } from '../lib/docHistory'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fails.push(`${name}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
}

const D = (s: string) => new Date(`${s}T00:00:00.000Z`)
const f = (p: Partial<DocHistoryFile> & { id: string }): DocHistoryFile => ({
  docType: 'rent', driveFileId: `drive-${p.id}`, issuedAt: D('2026-08-01'),
  leaseTermId: 'L1', ...p,
})

// ── 정렬 ──────────────────────────────────────────────────────────
{
  const rows = sortDocHistory([
    f({ id: 'a', issuedAt: D('2026-07-01') }),
    f({ id: 'b', issuedAt: D('2026-09-01') }),
    f({ id: 'c', issuedAt: D('2026-08-01') }),
  ])
  eq('정렬 · 최신이 위', rows.map(r => r.id), ['b', 'c', 'a'])
}
{
  // 같은 날 여러 장 — 발행번호가 큰 것이 나중이다.
  const rows = sortDocHistory([
    f({ id: 'a', receiptNo: '20260801-001' }),
    f({ id: 'b', receiptNo: '20260801-003' }),
    f({ id: 'c', receiptNo: '20260801-002' }),
  ])
  eq('정렬 · 같은 날은 발행번호 큰 것이 위', rows.map(r => r.id), ['b', 'c', 'a'])
}
{
  // 번호가 없는 실거주 확인서끼리 — id 로 갈라 순서를 안정시킨다.
  const rows = sortDocHistory([
    f({ id: 'z', docType: 'residence' }), f({ id: 'a', docType: 'residence' }),
  ])
  eq('정렬 · 번호가 없으면 id 로 안정 정렬', rows.map(r => r.id), ['a', 'z'])
  const again = sortDocHistory([...rows].reverse())
  eq('정렬 · 입력 순서가 바뀌어도 같은 답', again.map(r => r.id), ['a', 'z'])
}
{
  eq('정렬 · 빈 목록', sortDocHistory([]), [])
  // 원본을 안 건드린다 — 부르는 쪽이 같은 배열을 다시 쓸 수 있다.
  const src = [f({ id: 'b', issuedAt: D('2026-07-01') }), f({ id: 'a', issuedAt: D('2026-09-01') })]
  sortDocHistory(src)
  eq('정렬 · 입력 배열을 안 건드린다', src.map(r => r.id), ['b', 'a'])
}

// ── 보조 문구 ─────────────────────────────────────────────────────
{
  const one = { showRoom: false }
  eq('문구 · 납부 확인서는 귀속월을 말한다',
    docHistoryNote(f({ id: 'a', targetMonth: '2026-09', receiptNo: '20260901-001' }), one),
    '2026년 9월분 · No. 20260901-001')
  // 선납 — 발행일은 8월인데 귀속월은 9월이다. 문구가 그것을 말해야 두 장이 갈린다.
  eq('문구 · 선납 발급본도 귀속월 그대로',
    docHistoryNote(f({ id: 'a', issuedAt: D('2026-08-17'), targetMonth: '2026-09' }), one),
    '2026년 9월분')
  eq('문구 · 귀속월이 없는 옛 발급본은 침묵(추측 금지)',
    docHistoryNote(f({ id: 'a', receiptNo: '20260701-002' }), one), 'No. 20260701-002')
  eq('문구 · 아무것도 없으면 null', docHistoryNote(f({ id: 'a', docType: 'residence' }), one), null)
  // 보증금 영수증은 월 축이 없다 — 귀속월이 실려도 말하지 않는다.
  eq('문구 · 보증금 영수증은 월을 말하지 않는다',
    docHistoryNote(f({ id: 'a', docType: 'deposit', targetMonth: '2026-09', receiptNo: '20260901-005' }), one),
    'No. 20260901-005')
}
{
  // 계약이 둘 이상일 때만 방을 붙인다 — 하나뿐이면 겹말이다.
  eq('문구 · 계약이 여럿이면 방을 앞에',
    docHistoryNote(f({ id: 'a', roomNo: '402', targetMonth: '2026-09' }), { showRoom: true }),
    '402호 · 2026년 9월분')
  eq('문구 · 계약이 하나면 방을 안 붙인다',
    docHistoryNote(f({ id: 'a', roomNo: '402', targetMonth: '2026-09' }), { showRoom: false }),
    '2026년 9월분')
  // '호'는 fmtRoomNo 가 붙인다 — 숫자가 아닌 호실에는 안 붙는다(감지망 [호실번호 '호']).
  eq('문구 · 숫자가 아닌 호실에는 호를 안 붙인다',
    docHistoryNote(f({ id: 'a', roomNo: '사무실', targetMonth: '2026-09' }), { showRoom: true }),
    '사무실 · 2026년 9월분')
}

console.log(`\n발급 서류 이력 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const m of fails) console.error(`  - ${m}`)
if (fails.length > 0) process.exit(1)
