// 영업장 관리 메모(PropertyNote) 통합 회귀 + 입력 정본 진리표 + 화면 배선 정적 검사. 실제 서버 액션을 메모리 PGlite 위에서 돌린다. 실패 시 exit 1.
// 실행: npx tsx --tsconfig scripts/tsconfig.reason-flow.json scripts/test-property-note-flow.ts
//
// 고정하는 것(신고 d1e5fecc, 2026-11-02 운영자 승인).
//   · 입력: 제목 필수(60자), 본문 선택(4000자, 줄바꿈 보존), 분류 한 개 선택(20자, 비우면 null). 화면 막힘 이유와 서버 거부가 같은 문장.
//   · 적용취소 셋: 추가는 지움(그사이 고쳤으면 거부), 수정은 저장 직전 모습(그사이 바뀌면 거부), 삭제는 되살림(그 도장 그대로일 때만).
//   · 수정·삭제는 연 순간의 버전 그대로일 때만 쓴다. 열람은 STAFF 도, 쓰기는 편집 권한만. 남의 영업장 id 로는 한 바이트도 못 바꾼다.
//   · 화면: 헤더 '관리 메모' 는 STAFF 에게도 서고 쓰기 둘만 canEditUi, 목록 Modal 과 추가·수정 Modal 은 형제, 빈 상태 문장, 본문 자르기 금지,
//     분류는 메타 칩, 수정은 RecordEditShell + 발끝 관리 메뉴 삭제, 토스트 [적용취소] 셋.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  normalizeNoteInput, noteTagOptions, NOTE_TITLE_REQUIRED, NOTE_TITLE_TOO_LONG, NOTE_BODY_TOO_LONG, NOTE_TAG_TOO_LONG,
  NOTE_CHANGED, NOTE_UNDO_CONFLICT,
} from '../lib/propertyNote'

const ROOT = path.resolve(__dirname, '..')
const PORT = 57000 + Math.floor(Math.random() * 900)
const URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`
process.env.CR_FLOW_DATABASE_URL = URL
process.env.DATABASE_URL = URL
process.env.DIRECT_URL = URL

let pass = 0, fail = 0
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; return }
  fail++
  console.log(`  실패 ${name}\n    기대 ${w}\n    실제 ${g}`)
}
const ok = (name: string, cond: boolean) => eq(name, cond, true)
const J = <T>(x: T): T => JSON.parse(JSON.stringify(x))   // 화면을 거쳐 돌아오는 값처럼 직렬화한다

function schemaSql(): string {
  const bin = path.join(ROOT, 'node_modules', '.bin', 'prisma')
  const out = execFileSync(bin, ['migrate', 'diff', '--from-empty', '--to-schema', 'prisma/schema.prisma', '--script'], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, DATABASE_URL: URL, DIRECT_URL: URL },
  })
  return out.split('\n').filter(l => !l.startsWith('◇')).join('\n')
    .split(/;\s*\n/).filter(s => !/FOREIGN KEY/.test(s)).join(';\n')
}

// ── 1. 입력 정본 진리표 ───────────────────────────────────────
eq('제목 비면 거부', normalizeNoteInput({ title: '   ', body: 'x' }), { ok: false, error: NOTE_TITLE_REQUIRED })
eq('제목 61자 거부', normalizeNoteInput({ title: 'ㄱ'.repeat(61) }), { ok: false, error: NOTE_TITLE_TOO_LONG })
eq('제목 60자 통과', normalizeNoteInput({ title: 'ㄱ'.repeat(60) }).ok, true)
eq('본문 4001자 거부', normalizeNoteInput({ title: 't', body: 'a'.repeat(4001) }), { ok: false, error: NOTE_BODY_TOO_LONG })
eq('분류 21자 거부', normalizeNoteInput({ title: 't', tag: 'a'.repeat(21) }), { ok: false, error: NOTE_TAG_TOO_LONG })
eq('앞뒤 공백 걷고 줄바꿈 보존·빈 분류는 null', normalizeNoteInput({ title: ' 보일러 ', body: '\n 1층 22도\n2층 20도 \n', tag: '  ' }),
  { ok: true, value: { title: '보일러', body: '1층 22도\n2층 20도', tag: null } })
eq('본문 없음은 빈 글', normalizeNoteInput({ title: 't' }), { ok: true, value: { title: 't', body: '', tag: null } })
eq('분류 선택지 가나다·겹침 없음', noteTagOptions([{ tag: '청소' }, { tag: null }, { tag: '계절 설정' }, { tag: '청소' }]), ['계절 설정', '청소'])

// ── 2. 화면 배선 정적 검사 ────────────────────────────────────
{
  const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8')
  const strip = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const ui = strip(read('app/(app)/room-manage/PropertyNotes.tsx'))
  const rm = strip(read('app/(app)/room-manage/RoomManageClient.tsx'))
  const act = strip(read('app/(app)/room-manage/noteActions.ts'))
  // 헤더: '관리 메모' 는 rooms 뷰 묶음 안, canEditUi 묶음 밖(STAFF 열람). 쓰기 둘은 canEditUi 안.
  const head = rm.match(/\{viewTab === 'rooms' && \(\s*<div className="flex flex-wrap items-center justify-end gap-2 ml-auto max-w-full">([\s\S]*?)\n        <\/div>\n        \)\}/)
  ok('헤더 버튼군이 rooms 뷰에 접히는 줄로 선다', !!head)
  const gate = head ? head[1].match(/\{canEditUi && \(([\s\S]*?)\n {10}\)\}/) : null
  const afterGate = head && gate ? head[1].slice(head[1].indexOf(gate[0]) + gate[0].length) : ''
  ok("'관리 메모' 는 Btn secondary md, 쓰기 가림 밖 맨 뒤(STAFF 도 보고, 320px 에서 + 호실 등록이 첫 줄에 남는다)", /^\s*<Btn variant="secondary" size="md" onClick=\{\(\) => setShowNotes\(true\)\}>\s*관리 메모\s*<\/Btn>\s*$/.test(afterGate))
  ok('쓰기 둘(사진·호실 등록)은 canEditUi 안', !!gate && /공용·외관 사진[\s\S]*\+ 호실 등록/.test(gate[1]) && !/관리 메모/.test(gate[1]))
  ok('창은 편집 권한을 넘겨받는다', /<PropertyNotesManager canEdit=\{canEditUi\}/.test(rm))
  ok('빈 상태 문장', ui.includes("NOTES_EMPTY_TITLE = '관리 메모가 없습니다'") && ui.includes("NOTES_EMPTY_DESC = '계절마다 바꾸는 설정처럼 때가 지나면 잊는 내용을 적어 두세요.'") && /<EmptyState title=\{NOTES_EMPTY_TITLE\} description=\{canEdit \? NOTES_EMPTY_DESC : undefined\}/.test(ui))
  ok('제목 13px/700', /text-\[0\.8125rem\] font-bold[^"]*">\{n\.title\}/.test(ui))
  ok('본문 줄바꿈 그대로·자르지 않음', /whitespace-pre-wrap break-keep[^"]*">\{n\.body\}/.test(ui) && !/truncate|line-clamp/.test(ui))
  ok('분류는 §11 메타 칩', /META_CHIP = 'shrink-0 rounded-sm bg-\[var\(--canvas\)\] px-1\.5 py-0\.5 text-\[0\.65625rem\] text-\[var\(--warm-muted\)\] ring-1 ring-\[var\(--warm-border\)\]'/.test(ui) && /\{n\.tag && <span className=\{META_CHIP\}>/.test(ui))
  ok('쓰기 버튼은 canEdit 일 때만', /\{canEdit && <RowActionBtn [^\n]*>수정<\/RowActionBtn>\}/.test(ui) && /\{canEdit && <Btn [^\n]*>\+ 메모 추가<\/Btn>\}/.test(ui))
  ok('수정은 RecordEditShell, 삭제는 발끝 관리 메뉴 danger', /<RecordEditShell title="관리 메모 수정"/.test(ui) && /key: 'delete', label: '삭제', danger: true/.test(ui))
  ok('추가·수정 Modal 은 목록 Modal 의 형제(z 260)', /<\/Modal>\s*\{adding && <PropertyNoteAddModal/.test(ui) && /z=\{260\}/.test(ui))
  ok('토스트 적용취소 셋', /undoCreatePropertyNote\(res\.undo\)/.test(ui) && /undoUpdatePropertyNote\(undo\)/.test(ui) && /restorePropertyNote\(res\.undo\)/.test(ui))
  ok('저장 막힘 이유는 서버와 같은 정본', /const check = normOf\(value\)/.test(ui) && /normalizeNoteInput\(v\)/.test(ui) && /const v = normalizeNoteInput\(raw\)/.test(act))
  ok('노랑 메모지·핀·틴트 원 금지', !/--warning-bg|yellow|amber|pin|rounded-full/i.test(ui))
  ok("Room.memo('메모')와 이름 겹침 없음(라벨에 맨 '메모' 단독 없음)", !/>메모</.test(ui) && !/title="메모"/.test(ui))
  for (const fn of ['createPropertyNote', 'undoCreatePropertyNote', 'updatePropertyNote', 'undoUpdatePropertyNote', 'deletePropertyNote', 'restorePropertyNote']) {
    const at = act.indexOf(`export async function ${fn}(`)
    const next = act.indexOf('\nexport ', at + 1)
    const body = act.slice(at, next < 0 ? undefined : next)
    ok(`${fn} 는 편집 권한을 먼저 본다`, /await requireEdit\(\)\s*\n\s*const \{ propertyId \} = await requirePropertyAccess\(\)/.test(body))
    ok(`${fn} 는 영업장 범위로만 쓴다`, /where: \{ (id: (raw|u|cur)\.id, )?propertyId/.test(body))
  }
  const st = strip(read('app/(app)/settings/actions.ts'))
  const exp = st.slice(st.indexOf('export async function exportAllData('), st.indexOf('\nexport ', st.indexOf('export async function exportAllData(') + 1))
  for (const [m, k] of [['propertyNote', 'propertyNotes'], ['roomWork', 'roomWorks'], ['roomInspection', 'roomInspections'], ['roomCleaning', 'roomCleanings']]) {
    ok(`백업에 ${k}(삭제분 제외)`, new RegExp(`prisma\\.${m}\\.findMany\\(\\{ where: \\{ propertyId, deletedAt: null \\}`).test(exp) && new RegExp(`\\n\\s+${k},`).test(exp))
  }
  ok('백업 점검은 항목째', /prisma\.roomInspection\.findMany\(\{[^\n]*include: \{ inspectionItems: true \}/.test(exp))
  const getBody = act.slice(act.indexOf('export async function getPropertyNotes('), act.indexOf('export async function createPropertyNote('))
  ok('읽기는 편집 권한을 안 묻는다(STAFF 열람)', !/requireEdit/.test(getBody) && /requirePropertyAccess\(\)/.test(getBody) && /deletedAt: null/.test(getBody))
}

// ── 3. 통합(PGlite) ───────────────────────────────────────────
async function main() {
  const { PGlite } = await import('@electric-sql/pglite')
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket')
  const pg = await PGlite.create()
  await pg.exec(schemaSql())
  const server = new PGLiteSocketServer({ db: pg, port: PORT, host: '127.0.0.1' })
  await server.start()

  const prisma = (await import('@/lib/prisma')).default
  const A = await import('@/app/(app)/room-manage/noteActions')
  const g = globalThis as unknown as { __CR_FLOW_PID?: string; __CR_FLOW_ROLE?: string }

  const P1 = randomUUID(), P2 = randomUUID(), OWNER = randomUUID()
  await prisma.property.create({ data: { id: P1, name: '하네스 1', ownerId: OWNER } })
  await prisma.property.create({ data: { id: P2, name: '하네스 2', ownerId: OWNER } })
  g.__CR_FLOW_PID = P1
  const list = async () => { const r = await A.getPropertyNotes(); return r.ok ? r.notes : null }

  eq('처음엔 빈 목록', await list(), [])
  const c1 = await A.createPropertyNote({ title: ' 겨울 보일러 ', body: '1층 22도\n2층 20도', tag: '계절 설정' })
  const c2 = await A.createPropertyNote({ title: '분리수거 요일', body: '' })
  eq('추가 둘', [c1.ok, c2.ok], [true, true])
  const n1 = c1.ok ? c1.note : null, n2 = c2.ok ? c2.note : null
  eq('정리된 값으로 저장·차례는 끝으로', [n1?.title, n1?.body, n1?.tag, n1?.sortOrder, n2?.sortOrder, n2?.tag], ['겨울 보일러', '1층 22도\n2층 20도', '계절 설정', 0, 1, null])
  eq('제목 없는 추가 거부(서버도 같은 문장)', await A.createPropertyNote({ title: '' }), { ok: false, error: NOTE_TITLE_REQUIRED })
  eq('목록은 차례대로', (await list())?.map(n => n.title), ['겨울 보일러', '분리수거 요일'])

  // 추가 적용취소. 그사이 고쳤으면 거부, 그대로면 지운다
  const c3 = await A.createPropertyNote({ title: '지울 메모' })
  const undo3 = c3.ok ? c3.undo : null
  const n3 = c3.ok ? c3.note : null
  const e3 = await A.updatePropertyNote({ id: n3!.id, expectedUpdatedAt: n3!.updatedAt, title: '고친 메모', body: '', tag: null })
  eq('고친 뒤 추가 적용취소 거부', await A.undoCreatePropertyNote(J(undoA(undo3))), { ok: false, error: NOTE_UNDO_CONFLICT })
  eq('고친 메모는 남아 있다', (await list())?.map(n => n.title), ['겨울 보일러', '분리수거 요일', '고친 메모'])
  // 새로 하나 더. 그대로면 지운다
  const c4 = await A.createPropertyNote({ title: '바로 지울 메모' })
  eq('그대로면 추가 적용취소가 지운다', await A.undoCreatePropertyNote(J(c4.ok ? c4.undo : null)!), { ok: true })
  eq('한 번 더 누르면 거부', await A.undoCreatePropertyNote(J(c4.ok ? c4.undo : null)!), { ok: false, error: NOTE_UNDO_CONFLICT })
  const gone = await prisma.propertyNote.findFirst({ where: { title: '바로 지울 메모' } })
  eq('추가 적용취소는 소프트삭제(행은 남고 삭제 도장, 목록에서 빠짐)', [!!gone, !!gone?.deletedAt, (await list())?.some(n => n.title === '바로 지울 메모')], [true, true, false])
  void e3

  // 수정. 연 순간 버전, 무변경, 적용취소
  const fresh1 = (await list())!.find(n => n.id === n1!.id)!
  eq('고친 게 없으면 아무것도 안 쓴다', await A.updatePropertyNote({ id: n1!.id, expectedUpdatedAt: fresh1.updatedAt, title: '겨울 보일러 ', body: '1층 22도\n2층 20도', tag: '계절 설정' }), { ok: true, undo: null })
  const u1 = await A.updatePropertyNote({ id: n1!.id, expectedUpdatedAt: fresh1.updatedAt, title: '겨울 보일러 온도', body: '1층 23도', tag: '' })
  eq('수정 통과', u1.ok, true)
  const after1 = (await list())!.find(n => n.id === n1!.id)!
  eq('수정 값(빈 분류는 null)', [after1.title, after1.body, after1.tag], ['겨울 보일러 온도', '1층 23도', null])
  eq('연 뒤 바뀐 메모는 수정 거부', await A.updatePropertyNote({ id: n1!.id, expectedUpdatedAt: fresh1.updatedAt, title: '늦은 저장' }), { ok: false, error: NOTE_CHANGED })
  eq('수정 적용취소: 저장 직전 모습 전체로', await A.undoUpdatePropertyNote(J(u1.ok ? u1.undo! : null)!), { ok: true })
  const back1 = (await list())!.find(n => n.id === n1!.id)!
  eq('되돌린 값', [back1.title, back1.body, back1.tag], ['겨울 보일러', '1층 22도\n2층 20도', '계절 설정'])
  eq('수정 적용취소 두 번은 거부', await A.undoUpdatePropertyNote(J(u1.ok ? u1.undo! : null)!), { ok: false, error: NOTE_UNDO_CONFLICT })
  // 그사이 다른 수정이 끼면 거부
  const u2 = await A.updatePropertyNote({ id: n1!.id, expectedUpdatedAt: back1.updatedAt, title: '둘째 수정' })
  const mid = (await list())!.find(n => n.id === n1!.id)!
  await A.updatePropertyNote({ id: n1!.id, expectedUpdatedAt: mid.updatedAt, title: '셋째 수정' })
  eq('그사이 바뀌면 수정 적용취소 거부', await A.undoUpdatePropertyNote(J(u2.ok ? u2.undo! : null)!), { ok: false, error: NOTE_UNDO_CONFLICT })
  eq('거부된 적용취소는 무변경', (await list())!.find(n => n.id === n1!.id)!.title, '셋째 수정')

  // 삭제·되살림
  const cur2 = (await list())!.find(n => n.id === n2!.id)!
  eq('연 뒤 바뀐 메모는 삭제 거부', await A.deletePropertyNote({ id: n2!.id, expectedUpdatedAt: '2026-01-01T00:00:00.000Z' }), { ok: false, error: NOTE_CHANGED })
  const d2 = await A.deletePropertyNote({ id: n2!.id, expectedUpdatedAt: cur2.updatedAt })
  eq('삭제 통과·목록에서 빠짐', [d2.ok, (await list())?.some(n => n.id === n2!.id)], [true, false])
  eq('행은 남는다(소프트삭제)', !!(await prisma.propertyNote.findUnique({ where: { id: n2!.id } }))?.deletedAt, true)
  eq('삭제한 메모 수정 거부', (await A.updatePropertyNote({ id: n2!.id, expectedUpdatedAt: cur2.updatedAt, title: 'x' })).ok, false)
  eq('삭제 적용취소: 되살림', await A.restorePropertyNote(J(d2.ok ? d2.undo : null)!), { ok: true })
  eq('되살린 메모가 제자리', (await list())?.map(n => n.title), ['셋째 수정', '분리수거 요일', '고친 메모'])
  eq('되살림 두 번은 거부', await A.restorePropertyNote(J(d2.ok ? d2.undo : null)!), { ok: false, error: NOTE_UNDO_CONFLICT })
  eq('꼴이 틀린 토큰 거부', await A.restorePropertyNote({ id: 'x', deletedAt: 'y' }), { ok: false, error: NOTE_UNDO_CONFLICT })

  // 권한. STAFF 는 읽고 못 쓴다
  g.__CR_FLOW_ROLE = 'STAFF'
  eq('STAFF 열람', (await list())?.length, 3)
  const before = JSON.stringify(await prisma.propertyNote.findMany({ orderBy: { id: 'asc' } }))
  const curS = (await list())![0]
  eq('STAFF 추가 거부', (await A.createPropertyNote({ title: '스태프' })).ok, false)
  eq('STAFF 수정 거부', (await A.updatePropertyNote({ id: curS.id, expectedUpdatedAt: curS.updatedAt, title: '스태프' })).ok, false)
  eq('STAFF 삭제 거부', (await A.deletePropertyNote({ id: curS.id, expectedUpdatedAt: curS.updatedAt })).ok, false)
  eq('STAFF 쓰기 무변경', JSON.stringify(await prisma.propertyNote.findMany({ orderBy: { id: 'asc' } })), before)
  g.__CR_FLOW_ROLE = undefined

  // 남의 영업장
  g.__CR_FLOW_PID = P2
  const x = await A.createPropertyNote({ title: '남의 메모' })
  const xn = x.ok ? x.note : null
  const xd = await A.deletePropertyNote({ id: xn!.id, expectedUpdatedAt: xn!.updatedAt })
  eq('P2 에서 P1 메모는 안 보인다', (await list())?.map(n => n.title), [])
  g.__CR_FLOW_PID = P1
  eq('P1 에서 P2 메모는 안 보인다', (await list())?.some(n => n.title === '남의 메모'), false)
  const snapP2 = async () => JSON.stringify(await prisma.propertyNote.findMany({ where: { propertyId: P2 }, orderBy: { id: 'asc' } }))
  const beforeP2 = await snapP2()
  const rawP2 = (await prisma.propertyNote.findUnique({ where: { id: xn!.id } }))!
  eq('남의 메모 수정 거부', (await A.updatePropertyNote({ id: xn!.id, expectedUpdatedAt: rawP2.updatedAt.toISOString(), title: '침입' })).ok, false)
  eq('남의 메모 삭제 거부', (await A.deletePropertyNote({ id: xn!.id, expectedUpdatedAt: rawP2.updatedAt.toISOString() })).ok, false)
  eq('남의 삭제 토큰으로 되살림 거부', (await A.restorePropertyNote(J(xd.ok ? xd.undo : null)!)).ok, false)
  eq('남의 영업장 바이트 무변경', await snapP2(), beforeP2)

  console.log(`[관리 메모 통합] 통과 ${pass} / 실패 ${fail}`)
  await prisma.$disconnect()
  await server.stop()
  await pg.close()
  process.exit(fail > 0 ? 1 : 0)
}
// 추가 적용취소 토큰은 만든 직후 그대로다. 하네스에서 null 이면 실패로 드러나게 빈 꼴을 넘긴다.
function undoA<T>(u: T | null): T { return (u ?? { id: 'x', updatedAt: 'x' }) as T }

main().catch(e => { console.error(e); process.exit(2) })
