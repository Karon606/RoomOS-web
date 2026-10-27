// 작업 이력 한 건 수정 배선 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 왜 (2026-10-27 운영자 지적·승인 계획 2단계). "특정 내역만 수정하고 싶은데 편집을 누르니 내역 전체를 수정할 수 있게 되버리네…
// 다른 내역을 잘못 건드리면 바뀌어서 불안해". 방 모달 작업 이력의 '편집' 이 목록 전체 행의 날짜 변경·적용취소·삭제와 즉시 저장 금액 칸을
// 한꺼번에 세웠다. 이제 행 [수정] → 그 한 건만 고치는 Modal(RecordEditShell) 이고, 되돌림·삭제는 Modal 발끝 `관리` 메뉴다(가이드 §27.1·§13).
// 편집 모드가 되살아나거나, 두 자리(방 모달·작업 탭)의 행 props 가 갈리거나, 저장에 적용취소가 빠지면 붉게 선다.
//
// 축.
//   ⓐ 편집 모드 폐지 — 패널에 editing 상태·'편집' 토글이 없고, 세 행에 showActions·행 안 날짜 변경·사유 변경 폼·즉시 저장 금액 칸이 없다.
//   ⓑ 행 [수정] — 세 행이 RowActionBtn neutral [수정] 을 세우고 그 종류의 수정 Modal 을 z={modalZ} 로 연다.
//   ⓒ 두 자리 같은 props — 방 모달(z 260)과 작업 탭(z 200)이 세 행에 modalZ 를, 청소·작업 행에 recentPerformers 를 명시한다.
//   ⓓ 껍데기 — RecordEditShell 이 Modal width sm·dirty·캡션 한 벌·발끝 두 줄(취소 + 관리 / 저장 풀폭)·관리 메뉴 위로 먼저·오른쪽 맞춤·파괴 행 구분선이고,
//      세 Modal 이 그 껍데기를 쓰며 저장은 expectedUpdatedAt(조건부 쓰기)을 싣고 토스트 [적용취소](recordEditUndoAction)를 단다.
//   ⓔ 관리 메뉴 — 종류별 항목(작업: 완료 적용취소·삭제 / 청소: 안 하기로·완료·안 함 적용취소·삭제 / 점검: 같은 넷)이고 삭제는 danger, 확인창을 먼저 띄운다.
//   ⓕ '삭제된 기록 보기' 는 목록 아래 상시다(편집 모드에 묶이지 않는다).
//   ⓖ 가이드 §27.1 등재 문장. ⓗ 화면 파일이 server-only 서명 모듈을 안 부른다. ⓘ verify:fast 등록.
//
// 실행: node scripts/check-room-record-edit.mjs
import { readFileSync } from 'node:fs'

const fails = []
const strip = s => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, m => m.replace(/[^\n]/g, ''))
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const read = f => strip(readFileSync(f, 'utf8'))
const need = (ok, msg) => { if (!ok) fails.push(msg) }

const PANEL = 'components/entity-modal/widgets/RoomCleaningPanel.tsx'
const TAB = 'app/(app)/room-manage/RoomManageClient.tsx'
const ROWS = {
  work: { file: 'components/work/RoomWorkRowBody.tsx', comp: 'RoomWorkRowBody', modal: 'RoomWorkEditModal', modalFile: 'components/work/RoomWorkEditModal.tsx' },
  cleaning: { file: 'components/cleaning/CleaningRowBody.tsx', comp: 'CleaningRowBody', modal: 'CleaningEditModal', modalFile: 'components/cleaning/CleaningEditModal.tsx' },
  inspection: { file: 'components/inspection/InspectionRowBody.tsx', comp: 'InspectionRowBody', modal: 'InspectionEditModal', modalFile: 'components/inspection/InspectionEditModal.tsx' },
}
const SHELL = 'components/ui/RecordEditShell.tsx'

// ⓐ 편집 모드 폐지
{
  const p = read(PANEL)
  need(!/\bsetEditing\b|\bediting\b/.test(p), `ⓐ ${PANEL} · 편집 모드 상태(editing)가 되살아났다. 목록 전체를 켜는 편집 모드는 두지 않는다(가이드 §27.1).`)
  need(!/'편집 완료'|'편집'/.test(p), `ⓐ ${PANEL} · '편집' 토글이 되살아났다.`)
  for (const [k, r] of Object.entries(ROWS)) {
    const s = read(r.file)
    need(!/showActions/.test(s), `ⓐ ${r.file} · showActions 갈래가 되살아났다(편집 모드에만 서는 조작).`)
    need(!/reschedOpen|reasonOpen/.test(s), `ⓐ ${r.file} · 행 안 날짜 변경·사유 변경 폼이 되살아났다. 한 건 수정 Modal 이 받는다.`)
    if (k === 'work') need(!/updateWorkExpense\(/.test(s) && !/<input type="number"[^>]*defaultValue=\{e\.amount\}/.test(s), `ⓐ ${r.file} · 걸린 지출 줄의 즉시 저장 금액 칸이 되살아났다(적용취소 없는 쓰기, §16).`)
  }
}

// ⓑ 행 [수정]
for (const r of Object.values(ROWS)) {
  const s = read(r.file)
  need(/<RowActionBtn tone="neutral" disabled=\{pending\} onClick=\{\(\) => \{ setDoneOpen\(false\); setEditOpen\(true\) \}\}>수정<\/RowActionBtn>/.test(s), `ⓑ ${r.file} · 행 [수정](RowActionBtn neutral)이 없다.`)
  need(new RegExp(`<${r.modal} row=\\{r\\} z=\\{modalZ\\}`).test(s), `ⓑ ${r.file} · [수정] 이 ${r.modal} 을 z={modalZ} 로 열지 않는다.`)
  need(/modalZ: 200 \| 260/.test(s), `ⓑ ${r.file} · modalZ 가 필수 프롭(200 | 260)이 아니다. 부르는 자리가 층을 명시해야 한다.`)
}

// ⓒ 두 자리 같은 props
{
  const p = read(PANEL), t = read(TAB)
  for (const r of Object.values(ROWS)) {
    const inPanel = [...p.matchAll(new RegExp(`<${r.comp} [\\s\\S]*?\\/>`, 'g'))].map(m => m[0])
    const inTab = [...t.matchAll(new RegExp(`<${r.comp} [\\s\\S]*?\\/>`, 'g'))].map(m => m[0])
    need(inPanel.length >= 2 && inPanel.every(x => /modalZ=\{260\}/.test(x)), `ⓒ ${PANEL} · ${r.comp} 가 방 모달 층(modalZ={260})을 명시하지 않는다.`)
    need(inTab.length >= 1 && inTab.every(x => /modalZ=\{200\}/.test(x)), `ⓒ ${TAB} · ${r.comp} 가 페이지 층(modalZ={200})을 명시하지 않는다.`)
    if (r.comp !== 'InspectionRowBody') {
      need([...inPanel, ...inTab].every(x => /recentPerformers=\{recentPerformers\}/.test(x)), `ⓒ ${r.comp} · 두 자리 중 한 곳이 recentPerformers 를 안 넘긴다(수정 Modal 업체 칸 선택지가 갈린다).`)
    }
  }
}

// ⓓ 껍데기
{
  const s = read(SHELL)
  need(/<Modal open z=\{z\} width="sm" dirty=\{dirty\}/.test(s), `ⓓ ${SHELL} · Modal width sm·dirty(§12) 가 아니다.`)
  need(/export const RECORD_EDIT_CAPTION = '이 기록 한 건만 고칩니다\. 다른 기록은 그대로입니다\.'/.test(s) && /\{RECORD_EDIT_CAPTION\}/.test(s), `ⓓ ${SHELL} · 캡션 '이 기록 한 건만 고칩니다. 다른 기록은 그대로입니다.' 를 잃었다.`)
  need(/<div className="flex gap-2">\s*<Btn variant="secondary" size="md" onClick=\{onClose\}[^>]*>취소<\/Btn>\s*\{manage\.length > 0 && <ManageMenu /.test(s), `ⓓ ${SHELL} · 발끝 윗줄이 [취소] + 관리 가 아니다(§13).`)
  need(/<Btn variant="primary" size="md" fullWidth onClick=\{onSave\}/.test(s), `ⓓ ${SHELL} · 발끝 아랫줄 [저장] primary 풀폭이 아니다.`)
  need(!/flex-wrap/.test(s.slice(s.indexOf('footer='))), `ⓓ ${SHELL} · 발끝이 접힌다(flex-wrap). 두 줄 고정이다(§13).`)
  need(/placement: 'above', align: 'end'/.test(s), `ⓓ ${SHELL} · 관리 메뉴가 위로 먼저·오른쪽 맞춤이 아니다(§13).`)
  need(/className=\{MENU_ROW_DANGER\}/.test(s) && /border-t border-\[var\(--warm-border\)\]/.test(s), `ⓓ ${SHELL} · 파괴 항목이 구분선 아래 --danger-fg 행이 아니다.`)
  need(/aria-expanded=\{open\}/.test(s) && /menuKeyNav\(e, close\)/.test(s), `ⓓ ${SHELL} · 관리 메뉴 키보드 문법(aria-expanded·↑↓·Tab 닫기)을 잃었다.`)
  need(/saveReason && <WhyCaption id=\{reasonId\}>/.test(s) && /reason=\{saveReason \? reasonId : undefined\}/.test(s), `ⓓ ${SHELL} · 저장이 막힐 때 이유 한 줄(§27.8 ③)이 없다.`)
  need(/export const RECORD_EDIT_DIRTY_NOTE = '고친 내용은 저장되지 않습니다\.'/.test(s) && /const run = \(f: \(dirty: boolean\) => void\) => \{ close\(\); f\(dirty\) \}/.test(s), `ⓓ ${SHELL} · 관리 메뉴가 고친 상태(dirty)를 항목에 넘기지 않는다(권고 6).`)
  need(/export function recordEditUndoAction\(/.test(s) && /undoRoomRecordEdit\(undo\)/.test(s) && /label: '적용취소'/.test(s), `ⓓ ${SHELL} · 저장 토스트 적용취소 정본(recordEditUndoAction → undoRoomRecordEdit)이 없다.`)
  const UPDATE = { work: 'updateRoomWork', cleaning: 'updateCleaning', inspection: 'updateInspection' }
  for (const [k, r] of Object.entries(ROWS)) {
    const m = read(r.modalFile)
    need(/<RecordEditShell /.test(m), `ⓓ ${r.modalFile} · 공용 껍데기(RecordEditShell)를 안 쓴다.`)
    // 저장 함수 **안에서** 본다(독립 검수 권고 5). 파일 어딘가의 같은 글자(줄 고치기 토스트 등)가 대신 통과시키지 않게 한다.
    // 그 Modal 컴포넌트 몸통 안의 저장 함수다(같은 파일의 줄 고치기 컴포넌트에도 save 가 있다).
    const saveAt = m.indexOf('\n  const save = async () => {', m.indexOf(`export function ${r.modal}(`))
    const saveEnd = saveAt < 0 ? -1 : m.indexOf('\n  }\n', saveAt)
    const save = saveAt < 0 || saveEnd < 0 ? '' : m.slice(saveAt, saveEnd)
    need(!!save, `ⓓ ${r.modalFile} · 저장 함수(const save = async () => {)를 못 찾았다.`)
    need(new RegExp(`${UPDATE[k]}\\(\\{[\\s\\S]{0,160}expectedUpdatedAt: opened(At|\\.updatedAt)`).test(save), `ⓓ ${r.modalFile} · 저장이 연 순간 붙잡은 버전(expectedUpdatedAt)을 안 실어 조건부 쓰기가 안 된다.`)
    need((save.match(/recordEditUndoAction\(res\.undo,/g) ?? []).length === 1, `ⓓ ${r.modalFile} · 저장 토스트에 [적용취소] 가 없다(§16).`)
    // 연 순간의 버전을 useState 로 붙잡는다(권고 4). 열린 동안 부모가 목록을 다시 읽어도 그 값으로 견준다.
    need(/const \[opened(At)?\] = useState\(/.test(m), `ⓓ ${r.modalFile} · 연 순간의 updatedAt 을 붙잡지 않는다(부모가 다시 읽으면 새 버전으로 덮여 조건부 쓰기가 무력해진다).`)
    // 고친 상태에서 관리 항목을 실행하면 고친 내용이 저장되지 않는다는 말을 확인창에 싣는다(권고 6).
    need((m.match(/onSelect: async \(dirty: boolean\)/g) ?? []).length >= 2 && /withDirtyNote\(/.test(m), `ⓓ ${r.modalFile} · 관리 항목 확인창이 '고친 내용은 저장되지 않습니다' 를 안 싣는다.`)
    need(/title=\{`\$\{[^}]+\} 수정`\}|title="청소 수정"/.test(m), `ⓓ ${r.modalFile} · 제목이 '{이름} 수정' 꼴이 아니다.`)
  }
  const wm = read(ROWS.work.modalFile)
  need(/updateWorkExpense\(\{ workId, expenseId: line\.id, amount, vendor, expectedUpdatedAt: line\.updatedAt \}\)/.test(wm) && /recordEditUndoAction\(res\.undo, `'\$\{line\.label\}' 지출`/.test(wm), `ⓓ ${ROWS.work.modalFile} · 여러 건 걸린 작업의 줄 고치기가 그 작업 범위·적용취소를 안 탄다(결정 7).`)
  need(/지출 화면 열기/.test(wm), `ⓓ ${ROWS.work.modalFile} · 여러 건 걸린 작업에서 지출 화면으로 가는 길이 없다(결정 7).`)
}

// ⓔ 관리 메뉴
{
  const items = (f, keys) => {
    const m = read(f)
    for (const k of keys) need(new RegExp(`key: '${k}'`).test(m), `ⓔ ${f} · 관리 메뉴에 '${k}' 항목이 없다.`)
    need(/key: 'delete', label: '삭제', danger: true, onSelect: async \(dirty: boolean\) => \{\s*(\/\/[^\n]*\n\s*)*(const linkedCost[^\n]*\n\s*)?if \(!\(await confirmDialog\(/.test(m), `ⓔ ${f} · 삭제가 danger 이거나 확인창을 먼저 띄우지 않는다.`)
  }
  items(ROWS.work.modalFile, ['reopen', 'delete'])
  items(ROWS.cleaning.modalFile, ['skip', 'reopen', 'delete'])
  items(ROWS.inspection.modalFile, ['skip', 'reopen', 'delete'])
  // 확인창이 없던 상태 적용취소도 고친 상태일 때는 한 번 묻는다(권고 6).
  for (const f of [ROWS.cleaning.modalFile, ROWS.inspection.modalFile]) need(/if \(!\(await confirmDiscardEdits\(dirty, `\$\{what\} 적용취소`\)\)\) return/.test(read(f)), `ⓔ ${f} · 고친 상태에서 상태 적용취소를 실행해도 묻지 않는다.`)
  need(/\.\.\.\(done \? \[\{ key: 'reopen'/.test(read(ROWS.work.modalFile)), `ⓔ ${ROWS.work.modalFile} · 완료 적용취소가 완료 건에만 서지 않는다(쓸 수 없는 항목은 숨긴다).`)
}

// ⓕ 삭제된 기록 보기 상시
{
  const p = read(PANEL)
  need(/\{canEdit && rows !== null && works !== null && inspections !== null && \(\s*trashOpen \?/.test(p) && /삭제된 기록 보기/.test(p), `ⓕ ${PANEL} · '삭제된 기록 보기' 가 목록 아래 상시가 아니다.`)
}

// ⓖ 가이드 등재
{
  const g = readFileSync('docs/brand-guide-v2.0.md', 'utf8')
  need(/여러 종류 행이 섞인 이력 목록의 한 건 수정은 행 \[수정\] RowActionBtn → width sm Modal 폼이고, 그 건의 되돌림·파괴 동작은 Modal 발끝 `관리`\(§13\)에 둔다\. 목록 전체를 켜는 편집 모드는 두지 않는다\./.test(g), 'ⓖ docs/brand-guide-v2.0.md · §27.1 한 건 수정 문법 등재 문장이 없다.')
}

// ⓗ 화면 파일은 server-only 서명 모듈을 안 부른다
for (const f of [SHELL, ...Object.values(ROWS).flatMap(r => [r.file, r.modalFile])]) {
  need(!/from '@\/lib\/(roomRecordEditSign|workPayDefault)'/.test(read(f)), `ⓗ ${f} · server-only 모듈(roomRecordEditSign·workPayDefault)을 화면에서 부른다.`)
}

// ⓘ 등록
need(JSON.parse(readFileSync('package.json', 'utf8')).scripts['verify:fast'].includes('node scripts/check-room-record-edit.mjs'), 'ⓘ package.json verify:fast 에 이 그물이 없다')

console.log(`[작업 이력 한 건 수정 배선] 축 ⓐ 편집 모드 폐지 · ⓑ 행 [수정] · ⓒ 두 자리 props · ⓓ 껍데기·저장 적용취소 · ⓔ 관리 메뉴 · ⓕ 삭제분 상시 · ⓖ 가이드 · ⓗ server-only · ⓘ 등록 / 위반 ${fails.length}건`)
for (const f of fails) console.log('  - ' + f)
process.exit(fails.length ? 1 : 0)
