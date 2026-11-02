// 상세 셸 [수정] 편집 문 진리표(신고 352716da) · 실행: npx tsx scripts/test-edit-door.ts
//
// 고정하는 것.
//   · 목적지 훅 판정 shouldOpenEdit · 키는 'id:edit'. 같은 키는 한 요청의 재실행이라 건너뛰고, 다른 nonce 는 다시 연다.
//     정리 신호(URL 에서 edit 이 사라짐)를 못 봐 이전 키가 남아도 다음 클릭은 연다(튕김의 원인 자리).
//     대상이 목록에 없으면 열지 않고 이전 키를 그대로 둔다(목록이 오면 다시 판정).
//   · editHref · 클릭마다 edit 값이 다르다.
//   · 제자리 opener · 등록한 페이지가 있으면 그것이 열고, 풀면 false(호출부가 주소 이동으로 폴백).
//   · btnClass 글자색 덧씌우기 · className 글자색이 있으면 변형의 글자색을 뺀다(발끝 '삭제' 회색 결함).
import { shouldOpenEdit, editHref, registerEditOpener, openEditInPlace } from '../lib/editDoor'
import { btnClass } from '../components/ui/Btn'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fails.push(`${name}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
}

// ── 판정 ────────────────────────────────────────────────────────────
eq('파라미터 없음', shouldOpenEdit('t1:a', { id: null, edit: null }, false), { key: null, open: false, reason: 'no-param' })
eq('edit 없음', shouldOpenEdit('t1:a', { id: 't1', edit: null }, true), { key: null, open: false, reason: 'no-param' })
eq('첫 요청', shouldOpenEdit(null, { id: 't1', edit: 'a' }, true), { key: 't1:a', open: true, reason: 'open' })
eq('같은 요청 재실행(저장 뒤 refresh)', shouldOpenEdit('t1:a', { id: 't1', edit: 'a' }, true), { key: 't1:a', open: false, reason: 'same-request' })
eq('같은 대상 재클릭(새 nonce)', shouldOpenEdit('t1:a', { id: 't1', edit: 'b' }, true), { key: 't1:b', open: true, reason: 'open' })
eq('정리 미관측 뒤 다음 클릭', shouldOpenEdit('t1:a', { id: 't1', edit: 'c' }, true), { key: 't1:c', open: true, reason: 'open' })
eq('다른 대상', shouldOpenEdit('t1:a', { id: 't2', edit: 'd' }, true), { key: 't2:d', open: true, reason: 'open' })
eq('대상 없음', shouldOpenEdit('t1:a', { id: 't9', edit: 'e' }, false), { key: 't1:a', open: false, reason: 'not-found' })
eq('대상 없음 뒤 목록 도착', shouldOpenEdit('t1:a', { id: 't9', edit: 'e' }, true), { key: 't9:e', open: true, reason: 'open' })
// 종전 고정값 edit=1 이 왜 안 되는지 — 같은 키라 두 번째 클릭이 건너뛰어진다(이 표가 nonce 를 요구하는 이유).
eq('고정값 edit=1 재클릭은 건너뜀', shouldOpenEdit('t1:1', { id: 't1', edit: '1' }, true).open, false)

// ── 주소 ────────────────────────────────────────────────────────────
const hrefs = new Set(Array.from({ length: 50 }, () => editHref('tenant', 't1')))
eq('editHref 클릭마다 다름', hrefs.size, 50)
const h = new URL(editHref('room', 'r 1'), 'http://x')
eq('room 주소 경로', h.pathname, '/room-manage')
eq('room 주소 roomId', h.searchParams.get('roomId'), 'r 1')
eq('room 주소 edit 있음', !!h.searchParams.get('edit') && h.searchParams.get('edit') !== '1', true)
eq('tenant 주소 경로', new URL(editHref('tenant', 't1'), 'http://x').pathname, '/tenants')

// ── 제자리 opener ───────────────────────────────────────────────────
eq('opener 없음', openEditInPlace('tenant', 't1'), false)
const seen: string[] = []
const off = registerEditOpener('tenant', id => { seen.push(id); return id !== 'missing' })
eq('opener 있음', openEditInPlace('tenant', 't1'), true)
eq('opener 대상 없음', openEditInPlace('tenant', 'missing'), false)
eq('다른 kind 는 안 엶', openEditInPlace('room', 'r1'), false)
const off2 = registerEditOpener('tenant', () => true)
off()   // 덮인 뒤 옛 해제는 새 opener 를 건드리지 않는다
eq('덮인 뒤 옛 해제 무효', openEditInPlace('tenant', 'x'), true)
off2()
eq('해제 뒤', openEditInPlace('tenant', 't1'), false)
eq('opener 받은 id', seen, ['t1', 'missing'])

// ── btnClass 글자색 ─────────────────────────────────────────────────
const tok = (c: string) => c.split(/\s+/)
const del = tok(btnClass('ghost', 'md', 'text-[var(--danger-fg)]'))
eq('ghost + danger-fg: 변형 글자색 빠짐', del.includes('text-[var(--warm-mid)]'), false)
eq('ghost + danger-fg: 덧씌운 색 있음', del.includes('text-[var(--danger-fg)]'), true)
eq('ghost 기본: 변형 글자색 유지', tok(btnClass('ghost', 'md')).includes('text-[var(--warm-mid)]'), true)
eq('크기 글자는 색이 아님', tok(btnClass('ghost', 'md', 'text-[13px]')).includes('text-[var(--warm-mid)]'), true)
eq('primary + color: 글자색', tok(btnClass('primary', 'md', 'text-[color:var(--tc-text)]')).includes('text-[var(--on-solid)]'), false)
eq('크기 클래스 유지', del.includes('text-sm'), true)

console.log(`[편집 문·버튼 글자색] 통과 ${pass} / 실패 ${fails.length}`)
if (fails.length) { for (const f of fails) console.error('  ' + f); process.exit(1) }
