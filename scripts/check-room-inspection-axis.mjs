// 방 점검(퇴실 점검·청소 검수·입실 전 점검) 배선 감지망. 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가(2026-10-27, 신고 2911c217). 점검은 퇴실·청소 완료가 저절로 만들고 그 처리를 무르면 걷는다. 만드는 자리와
// 걷는 자리가 갈리면 거주 중인 방에 '점검 남음' 이 서거나, 퇴실 경로 하나만 점검을 안 만든다(퇴실 청소가 경로마다 갈렸던
// 2026-08-30 사고와 같은 모양). 소프트삭제 표라 조회가 deletedAt 을 하나라도 빠뜨리면 지운 점검이 되살아나 보인다.
//
// 축
//   ⓐ 조회 전수 deletedAt: roomInspection 을 읽는 호출(findMany·findFirst·findUnique·count·groupBy)은 where 에 deletedAt 을 적는다.
//   ⓑ 퇴실 부수효과 양 경로: 퇴실 부수 처리 정본(applyCheckoutSideEffects)이 점검 둘을 만들고, 퇴실 청소를 걷는 자리
//      (clearAutoCheckoutCleaning 호출)마다 바로 뒤에서 그 퇴실의 예정 점검도 걷는다. 청소 완료는 청소 검수를 만들고
//      완료 적용취소는 그 검수를 걷는다. 걷는 함수는 예정(PLANNED)만 고른다(끝낸 점검은 사실이라 남긴다).
//   ⓒ 생성 문은 화면이 못 부른다: 영업장 id 를 받는 생성·걷기(lib/roomInspectionEnsure)는 'use server' 가 아니고 server-only 다.
//      화면 문(inspectionActions)은 ensure·clear 를 내보내지 않는다.
//   ⓓ 라벨 한 벌: 단계 이름 셋('퇴실 점검'·'청소 검수'·'입실 전 점검')을 따옴표 낱말로 적는 자리는 inspectionConstants 뿐이다.
//      홈 알림 끄기 키 'inspection:' 도 그 파일의 inspectionMuteKey 만 만든다.
//   ⓔ 항목 잠금: 항목 결과·더하기·빼기·되살리기는 예정 점검에서만(끝낸 점검의 결과가 조용히 바뀌지 않는다).
//   ⓖ 행 UI: 정본 부품(StatusBadge·RowActionBtn·fmtDateDot·DatePicker 상한)·22px r7 체크와 44px 히트·쓰기마다 [적용취소] 짝·두 자리 배선·카드 배지 넷째 금지.
//   ⓗ 흐름 안 한 줄: 홈 퇴실·입실 토스트, 입주자 상태 위젯 입실 처리 앞 WhyCaption, 청소 완료 뒤 청소 검수 '열기'.
//   ⓕ 비품 규칙: 퇴실 점검 비품 조회가 승인 조건 일곱(영업장·방·받음·폐기 안 함·배송비 아님·재고 제외 아님·품명 있음)과
//      추적 카테고리 제외를 갖고, 순수 함수가 같은 조건을 한 번 더 본다.
//
// 실행: node scripts/check-room-inspection-axis.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const violations = []
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const read = p => readFileSync(p, 'utf8')

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n.startsWith('.')) continue
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(n)) out.push(p)
  }
  return out
}
const SOURCES = [...walk('app'), ...walk('components'), ...walk('lib')]

function matchClose(src, open) {
  const pairs = { '(': ')', '{': '}', '[': ']' }
  const stack = [pairs[src[open]]]
  for (let i = open + 1; i < src.length; i++) {
    const c = src[i]
    if (c === "'" || c === '"' || c === '`') { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++ } continue }
    if (pairs[c]) stack.push(pairs[c])
    else if (c === stack[stack.length - 1]) { stack.pop(); if (!stack.length) return i }
  }
  return -1
}
/** export·일반 함수 하나의 본문(다음 최상위 function 앞까지). */
function fnBody(src, name) {
  const m = new RegExp(`(?:^|\\n)(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\(`).exec(src)
  if (!m) return null
  const rest = src.slice(m.index + 1)
  const next = rest.search(/\n(?:export\s+)?(?:async\s+)?function\s+\w+\(/)
  return next < 0 ? rest : rest.slice(0, next)
}

const ACTIONS = 'app/(app)/room-manage/inspectionActions.ts'
const ENSURE = 'lib/roomInspectionEnsure.ts'
const CONST = 'app/(app)/room-manage/inspectionConstants.ts'
const TENANTS = 'app/(app)/tenants/actions.ts'
const CLEANING = 'app/(app)/room-manage/cleaningActions.ts'
const SEED = 'lib/roomInspectionSeed.ts'

// ⓐ 조회 전수 deletedAt.
{
  let reads = 0
  for (const file of SOURCES) {
    const src = strip(read(file))
    for (const m of src.matchAll(/\b(?:prisma|tx)\s*\.\s*roomInspection\s*\.\s*(findMany|findFirst|findFirstOrThrow|findUnique|count|groupBy|aggregate)\s*\(/g)) {
      reads++
      const open = m.index + m[0].length - 1
      const arg = src.slice(open, matchClose(src, open) + 1)
      const line = src.slice(0, m.index).split('\n').length
      if (!/\bdeletedAt\b/.test(arg)) violations.push(`${file}:${line} · roomInspection.${m[1]} 이 deletedAt 을 안 본다. 지운 점검이 목록·배지·생성 판정에 되살아난다(살아 있는 것만이면 deletedAt: null, 지운 것을 찾는 자리면 그렇게 적는다).`)
    }
  }
  if (reads < 8) violations.push(`roomInspection 조회를 ${reads}곳만 찾았다(8곳 이상 기대). 정규식이 낡았거나 조회 자리가 바뀌었다.`)
}

// ⓑ 퇴실 부수효과 양 경로 + 청소 완료·적용취소.
{
  const t = strip(read(TENANTS))
  const side = t.match(/async function applyCheckoutSideEffects[\s\S]*?\n\}\n/)?.[0] ?? ''
  if (!/ensureCheckoutInspections\(propertyId, opts\.roomId, leaseTermId\)/.test(side)) violations.push(`${TENANTS} · 퇴실 부수 처리 정본이 퇴실 점검·입실 전 점검을 안 만든다(ensureCheckoutInspections). 퇴실 경로 셋이 모두 그 정본을 지나므로 여기 한 곳이면 된다.`)
  if (!/inspectionFailureNotice\(\[inspections\.checkout, inspections\.movein\]\)/.test(side)) violations.push(`${TENANTS} · 점검을 못 만든 사실을 퇴실 안내에 싣지 않는다.`)
  const outside = t.replace(side, '')
  if (/ensureCheckoutInspections\(|ensureRoomInspection\(/.test(outside)) violations.push(`${TENANTS} · 퇴실 부수 처리 정본 밖에서 점검을 만든다. 두 벌이 되면 언젠가 갈린다.`)
  const calls = [...t.matchAll(/await clearAutoCheckoutCleaning\(propertyId, ([\w.]+)\)/g)]
  if (calls.length === 0) violations.push(`${TENANTS} · clearAutoCheckoutCleaning 호출을 못 찾았다. 퇴실 적용취소 자리가 바뀌었으면 이 그물도 고친다.`)
  for (const c of calls) {
    const after = t.slice(c.index, c.index + 400)
    if (!new RegExp(`await clearCheckoutInspections\\(propertyId, ${c[1].replace('.', '\\.')}\\)`).test(after)) {
      violations.push(`${TENANTS}:${t.slice(0, c.index).split('\n').length} · 퇴실 청소 예정을 걷는 자리가 그 퇴실의 예정 점검을 함께 안 걷는다(clearCheckoutInspections). 거주 중인 방에 '점검 남음' 이 선다.`)
    }
  }
  const c = strip(read(CLEANING))
  const complete = fnBody(c, 'completeCleaning') ?? ''
  if (!/ensureRoomInspection\(propertyId, \{ roomId: cur\.roomId, stage: 'AFTER_CLEANING', cleaningId: cur\.id, scheduledDate: doneDate \}\)/.test(complete)) violations.push(`${CLEANING} · 청소 완료가 그 청소의 청소 검수를 안 만든다.`)
  if (!/insp\.kind === 'created' \|\| insp\.kind === 'revived'/.test(complete)) violations.push(`${CLEANING} · 청소 완료가 이미 열려 있던 검수까지 새로 생긴 것처럼 알린다(만들거나 되살린 것만 알린다).`)
  const reopen = fnBody(c, 'reopenCleaning') ?? ''
  if (!/await clearCleaningInspection\(propertyId, id\)/.test(reopen)) violations.push(`${CLEANING} · 청소 완료 적용취소가 그 청소의 예정 검수를 안 걷는다.`)
  const e = strip(read(ENSURE))
  for (const [fn, re] of [
    ['clearCheckoutInspections', /where: \{ propertyId, leaseTermId, stage: \{ in: \['CHECKOUT', 'BEFORE_MOVEIN'\] \}, status: 'PLANNED', deletedAt: null \}/],
    ['clearCleaningInspection', /where: \{ propertyId, cleaningId, stage: 'AFTER_CLEANING', status: 'PLANNED', deletedAt: null \}/],
  ]) {
    if (!re.test(fnBody(e, fn) ?? '')) violations.push(`${ENSURE} · ${fn} 가 예정(PLANNED)·살아 있는 그 처리의 점검만 고르지 않는다. 끝낸 점검은 사실이라 남겨야 한다.`)
  }
  const ens = fnBody(e, 'ensureRoomInspection') ?? ''
  const openAt = ens.search(/status: 'PLANNED', deletedAt: null \}/)
  const aliveAt = ens.search(/kind: 'skipped-exists'/)
  const reviveAt = ens.search(/deletedAt: \{ not: null \}/)
  const createAt = ens.search(/createRoomInspection\(propertyId, input\)/)
  if (!(openAt >= 0 && aliveAt > openAt && reviveAt > aliveAt && createAt > reviveAt)) violations.push(`${ENSURE} · ensureRoomInspection 의 차례가 '열린 것 건너뛰기 · 살아 있는 것 건너뛰기 · 무른 것 되살리기 · 새로 만들기' 가 아니다. 중복 퇴실에 점검이 둘 서거나 다시 퇴실해도 체크가 안 돌아온다.`)
  const cio = fnBody(e, 'ensureCheckoutInspections') ?? ''
  if (!/stage: 'CHECKOUT', leaseTermId, scheduledDate: lease\?\.moveOutDate \?\? null/.test(cio) || !/stage: 'BEFORE_MOVEIN', leaseTermId, scheduledDate: null/.test(cio)) violations.push(`${ENSURE} · 퇴실이 만드는 둘의 예정일이 '퇴실 점검 = 퇴실일, 입실 전 점검 = 없음' 이 아니다.`)
}

// ⓒ 생성 문은 화면이 못 부른다.
{
  const e = read(ENSURE)
  if (/^\s*['"]use server['"]/m.test(strip(e))) violations.push(`${ENSURE} · 'use server' 파일이 됐다. 영업장 id 를 받는 생성·걷기가 화면에서 불리면 남의 영업장에 점검을 만든다.`)
  if (!/^import 'server-only'/m.test(e)) violations.push(`${ENSURE} · server-only 를 안 불러온다. 화면 번들에 섞여 들어가도 아무도 안 막는다.`)
  const a = strip(read(ACTIONS))
  for (const m of a.matchAll(/export async function (\w+)\(/g)) {
    if (/^(ensure|clear)/.test(m[1])) violations.push(`${ACTIONS} · 화면 문이 ${m[1]} 를 내보낸다. 생성·걷기는 lib/roomInspectionEnsure 에만 있다.`)
  }
  for (const m of a.matchAll(/export async function (\w+)\(/g)) {
    const b = fnBody(a, m[1]) ?? ''
    if (!/await requirePropertyAccess\(\)/.test(b)) violations.push(`${ACTIONS} · ${m[1]} 이 관문(requirePropertyAccess)을 안 지난다.`)
  }
}

// ⓓ 라벨 한 벌·끄기 키.
for (const file of SOURCES) {
  if (file === CONST) continue
  const src = strip(read(file))
  for (const m of src.matchAll(/(['"`])(퇴실 점검|청소 검수|입실 전 점검)\1/g)) {
    violations.push(`${file}:${src.slice(0, m.index).split('\n').length} · 단계 이름 '${m[2]}' 을 따로 적었다. inspectionConstants INSPECTION_STAGE_LABEL 한 벌을 읽는다.`)
  }
  if (/[`'"]inspection:/.test(src)) violations.push(`${file} · 점검 알림 끄기 키를 글자로 조립한다. inspectionMuteKey 를 쓴다.`)
}

// ⓔ 항목 잠금.
{
  const a = strip(read(ACTIONS))
  const ed = fnBody(a, 'editableItem') ?? ''
  if (!/insp\.status !== 'PLANNED'\) return \{ ok: false as const, error: INSPECTION_LOCKED \}/.test(ed) || !/deletedAt: null/.test(ed)) violations.push(`${ACTIONS} · editableItem 이 살아 있는 예정 점검만 받지 않는다.`)
  for (const fn of ['setInspectionItemResult', 'removeInspectionItem']) {
    if (!/await editableItem\(propertyId, /.test(fnBody(a, fn) ?? '')) violations.push(`${ACTIONS} · ${fn} 가 항목 잠금(editableItem)을 안 지난다. 끝낸 점검의 결과가 조용히 바뀐다.`)
  }
  for (const fn of ['addInspectionItem', 'restoreInspectionItem']) {
    if (!/insp\.status !== 'PLANNED'\) return \{ ok: false, error: INSPECTION_LOCKED \}/.test(fnBody(a, fn) ?? '')) violations.push(`${ACTIONS} · ${fn} 가 끝낸 점검에 항목을 더한다.`)
  }
  for (const fn of ['completeInspection', 'skipInspection']) {
    if (!/cur\.status !== 'PLANNED'/.test(fnBody(a, fn) ?? '')) violations.push(`${ACTIONS} · ${fn} 가 예정이 아닌 점검을 다시 덮는다(완료일·상태가 조용히 바뀐다).`)
  }
}

// ⓕ 비품 규칙.
{
  const e = strip(read(ENSURE))
  const plan = fnBody(e, 'planItems') ?? ''
  for (const re of [/propertyId, roomId, receivedAt: \{ not: null \}, disposedAt: null, isShipping: false, excludeFromInventory: false,/, /itemLabel: \{ not: null \}, category: \{ notIn: trackedCategories \}/, /roomWorkId: null,/, /excluded: parseOptionList\('inspectionExcludedItems'/]) {
    if (!re.test(plan)) violations.push(`${ENSURE} · 퇴실 점검 비품 조회가 승인 조건을 잃었다(${re.source.replace(/\\/g, '').slice(0, 50)}).`)
  }
  const s = strip(read(SEED))
  const isA = fnBody(s, 'isInspectableAsset') ?? ''
  for (const re of [/!row\.receivedAt \|\| row\.disposedAt/, /if \(row\.roomWorkId\) return false/, /row\.isShipping \|\| row\.excludeFromInventory/, /!row\.itemLabel/, /trackedCategories\.includes\(row\.category\)/]) {
    if (!re.test(isA)) violations.push(`${SEED} · isInspectableAsset 가 조건 하나를 잃었다(${re.source.replace(/\\/g, '').slice(0, 40)}).`)
  }
}

// ⓖ 행 UI 정본과 적용취소(가이드 §16·§22·§27.1). 행은 형제 청소 행과 같은 정본 부품을 쓰고, 쓰기마다 토스트 [적용취소] 가 짝이 있다.
//    항목 체크는 22px r7(§22) 이고 누르는 자리는 44px 다. 작업 목록·방 상세 두 자리가 같은 행을 부르고, 카드 배지는 넷째로 늘지 않는다.
{
  const ROW = 'components/inspection/InspectionRowBody.tsx'
  const r = strip(read(ROW))
  for (const [re, what] of [
    [/<StatusBadge tone=\{inspectionTone\(r\.status\)\}>/, '상태 배지(StatusBadge, 청소 행과 같은 톤 셋)'],
    [/fmtDateDot\(/, '날짜 표기 정본 fmtDateDot'],
    [/<RowActionBtn /, '행 동작 정본 RowActionBtn'],
    [/maxDate=\{kstYmdStr\(\)\}/, '완료일 미래 상한'],
    [/role="checkbox" aria-checked=\{ok\}/, '항목 체크의 접근 역할(role=checkbox·aria-checked)'],
    [/min-h-\[44px\] min-w-\[44px\]/, '항목 체크 히트 44px'],
    [/h-\[22px\] w-\[22px\] place-items-center rounded-\[7px\]/, '항목 체크 22px r7(§22)'],
  ]) if (!re.test(r)) violations.push(`${ROW} · ${what} 을 잃었다.`)
  const PAIRS = [
    ['항목 더하기', /addInspectionItem\([\s\S]{0,400}label: '적용취소',\s*run: \(\) => \{ void removeInspectionItem\(res\.item\.id\)/],
    ['항목 삭제', /removeInspectionItem\(it\.id\)[\s\S]{0,400}label: '적용취소',\s*run: \(\) => \{ void restoreInspectionItem\(res\.snapshot\)/],
    ['완료', /completeInspection\(\{ id: r\.id, doneDate \}\)[\s\S]{0,200}undo\(\(\) => reopenInspection\(r\.id\)/],
    ['안 하기로', /skipInspection\(r\.id\)[\s\S]{0,200}undo\(\(\) => reopenInspection\(r\.id\)/],
    ['삭제', /deleteInspection\(r\.id\), '삭제됨'[\s\S]{0,200}undo\(\(\) => restoreInspection\(r\.id\)/],
    ['복원', /restoreInspection\(r\.id\), '점검 기록 복원됨'[\s\S]{0,200}undo\(\(\) => deleteInspection\(r\.id\)/],
  ]
  for (const [what, re] of PAIRS) if (!re.test(r)) violations.push(`${ROW} · '${what}' 쓰기에 토스트 [적용취소] 짝이 없다(§16, 모든 쓰기에 적용취소).`)
  // 판정 토글(확인·문제·해당 없음)은 토스트가 없고(운영자 결정 ④) 그 항목만 잠그며 부모를 다시 읽지 않는다(독립 검수 R1).
  // 다시 누르면 미확인으로 돌아가는 것이 적용취소다. '문제' 는 메모 칸을 먼저 열고 저장 한 번에 문제 + 메모를 남긴다(R9).
  const setResult = r.match(/const setResult = [^\n]*\n[^\n]*/)?.[0] ?? ''
  if (!/itemRun\(it\.id, /.test(setResult) || /pushToast|onChanged/.test(setResult)) violations.push(`${ROW} · 판정 토글이 토스트를 띄우거나 부모를 다시 읽는다(운영자 결정 ④·R1). 그 항목만 고친다.`)
  const itemRun = r.match(/const itemRun = async[\s\S]*?\n  \}\n/)?.[0] ?? ''
  if (!itemRun || /onChanged\(/.test(itemRun) || !/setBusy\(prev => new Set\(prev\)\.add\(key\)\)/.test(itemRun)) violations.push(`${ROW} · 항목 쓰기가 그 항목 하나만 잠그지 않거나 부모를 다시 읽는다(R1).`)
  if (/disabled=\{!editable \|\| pending\}/.test(r) || !/const locked = !editable \|\| busy\.has\(it\.id\)\n/.test(r)) violations.push(`${ROW} · 항목 잠금이 그 항목 하나(busy)가 아니라 행 전체(pending)에 묶였다. 연달아 체크가 막힌다(R1).`)
  if (!/if \(it\.result === 'NG'\) \{ setResult\(it, 'PENDING'\); return \}\s*setNoteVal\(it\.note \?\? ''\); setNoteFor\(it\.id\)/.test(r) || !/saveNote\(it, noteVal\)/.test(r) || !/setInspectionItemResult\(\{ itemId: it\.id, result: 'NG', note: text \}\)/.test(r)) violations.push(`${ROW} · '문제' 가 메모 칸을 먼저 열고 저장 한 번에 문제 + 메모를 남기는 토글이 아니다(R9).`)
  if (!/<ToggleChip tone="warning" on=\{it\.result === 'NG'\}/.test(r) || !/<ToggleChip tone="neutral" on=\{it\.result === 'NA'\}/.test(r) || !/setResult\(it, it\.result === 'NA' \? 'PENDING' : 'NA'\)/.test(r) || !/aria-pressed=\{on\}/.test(r)) violations.push(`${ROW} · 문제·해당 없음이 켜고 끄는 토글 칩(aria-pressed, 다시 누르면 미확인)이 아니다.`)
  // 칩은 형제 '긴급만' 필터 칩 문법(켜짐 = 의미색 트라이어드, 꺼짐 = --canvas + --seg-ink-off). '문제' 색 뜻은 warning 하나(디자이너 재검수).
  if (!/warning: 'bg-\[var\(--warning-bg\)\] text-\[var\(--warning-fg\)\] ring-\[var\(--warning-ring\)\]'/.test(r) || !/bg-transparent ring-\[var\(--warm-border\)\] text-\[var\(--seg-ink-off\)\]/.test(r)) violations.push(`${ROW} · 토글 칩이 '긴급만' 칩 문법(켜짐 warning 트라이어드·꺼짐 테두리 + seg-ink-off, 카드 안이라 바탕 투명)이 아니다.`)
  // 같은 판정을 배지로 또 말하지 않는다(상자 + 눌린 칩 + 메모). 메모는 문제일 때만 보이고 끄면 저장된 채 숨는다(권고 6b).
  if (/<StatusBadge tone=\{it\.result/.test(r) || /'문제' : '해당 없음'/.test(r)) violations.push(`${ROW} · 문제·해당 없음을 배지로 또 말한다(상자·칩·배지 세 번).`)
  if (!/\{it\.result === 'NG' && it\.note && noteFor !== it\.id && \(/.test(r)) violations.push(`${ROW} · 메모가 문제가 아닐 때도 보인다(문제를 끄면 숨고 다시 켜면 돌아와야 한다).`)
  // 이미 적힌 메모를 고치면 옛 글을 되살리는 [적용취소] 가 있다(권고 6a).
  if (!/const editing = !!prevNote && prevNote !== \(text\.trim\(\) \|\| null\)/.test(r) || !/note: prevNote \}\)\.then\(back =>/.test(r)) violations.push(`${ROW} · 메모를 고쳐 저장하면 옛 글을 되살릴 길(토스트 적용취소)이 없다.`)
  // 항목을 바꿨으면 접을 때·사라질 때 한 번 맞춘다(권고 5). 방 모달은 router.refresh 로 호실 카드까지.
  if (!/if \(open\) settleRef\.current\(\)/.test(r) || !/useEffect\(\(\) => \(\) => settleRef\.current\(\), \[\]\)/.test(r) || !/itemsDirty\.current = true\n\s*onOk\(/.test(r)) violations.push(`${ROW} · 항목을 바꾼 뒤 접거나 사라질 때 수·배지를 맞추지 않는다(R1 낡은 표시, 권고 5).`)
  if (!/onItemsSettled=\{\(\) => router\.refresh\(\)\}/.test(strip(read('components/entity-modal/widgets/RoomCleaningPanel.tsx')))) violations.push(`RoomCleaningPanel · 점검 항목을 바꾼 뒤 모달을 닫거나 접을 때 호실 목록을 맞추지 않는다(권고 5).`)
  if (!/\{open \? '항목 접기' : '항목 펼치기'\}/.test(r)) violations.push(`${ROW} · 행 여닫기 이름이 '항목 펼치기 / 항목 접기' 짝이 아니다.`)
  // 판정 셋이 상자에 보인다(R2). 진행 'N' 이 판정을 마친 항목 수라 상자와 어긋나지 않는다.
  if (!/NG: 'border-\[var\(--warning-fg\)\] bg-\[var\(--warning-bg\)\]/.test(r) || !/NA: 'border-\[var\(--warm-border\)\] bg-\[var\(--neutral-bg\)\]/.test(r) || !/BOX_CLS\[it\.result\]/.test(r)) violations.push(`${ROW} · 상자가 문제·해당 없음을 안 보인다. 진행 '점검 N/M' 의 N 과 채워진 상자 수가 갈린다(R2).`)
  // 진행 문장은 정본 하나(R2). 행·카드 보조줄이 손으로 숫자 문장을 짓지 않는다.
  const cst = strip(read(CONST))
  if (!/export function inspectionProgressText\(judged: number, total: number\): string \{\s*return `점검 \$\{judged\}\/\$\{total\}`/.test(cst)) violations.push(`${CONST} · 진행 문장 정본이 '점검 N/M' 이 아니다(R2).`)
  for (const f of [ROW, 'app/(app)/room-manage/RoomManageClient.tsx']) {
    const src = strip(read(f))
    if (!/inspectionProgressText\(/.test(src)) violations.push(`${f} · 진행 문장을 정본 inspectionProgressText 로 안 낸다(R2).`)
    if (/`(점검|확인) \$\{/.test(src)) violations.push(`${f} · 진행 문장('점검 N/M')을 손으로 짓는다. inspectionProgressText 를 쓴다(R2).`)
  }
  // 항목 쓰기 서버 액션은 화면 갱신(revalidatePath)을 부르지 않는다(R1). 점검 상태 쓰기만 부른다.
  const a = strip(read(ACTIONS))
  for (const fn of ['setInspectionItemResult', 'addInspectionItem', 'removeInspectionItem', 'restoreInspectionItem']) {
    if (/revalidatePath\(/.test(fnBody(a, fn) ?? '')) violations.push(`${ACTIONS} · ${fn} 가 revalidatePath 를 부른다. 체크마다 영업장 전체 목록을 다시 읽는다(R1).`)
  }
  for (const fn of ['completeInspection', 'reopenInspection', 'skipInspection', 'deleteInspection', 'restoreInspection']) {
    if (!/revalidatePath\('\/room-manage'\)/.test(fnBody(a, fn) ?? '')) violations.push(`${ACTIONS} · ${fn}(점검 상태 쓰기)가 화면 갱신을 안 부른다.`)
  }
  // 손수 등록은 방 모달에만(운영자 결정 ①).
  if (/InspectionPlanForm|setAdding\('inspection'\)/.test(strip(read('app/(app)/room-manage/RoomManageClient.tsx')))) violations.push(`RoomManageClient · 작업 탭 목록 헤더에 점검 등록이 되살아났다(운영자 결정 ①: 방 모달에서만).`)
  if (!/setAdding\('inspection'\)/.test(strip(read('components/entity-modal/widgets/RoomCleaningPanel.tsx')))) violations.push(`RoomCleaningPanel · 방 모달에 점검 등록이 없다(운영자 결정 ①).`)
  if (!/label: '적용취소'/.test(r)) violations.push(`${ROW} · 적용취소 라벨이 '적용취소' 가 아니다(§16).`)
  const PLAN = 'components/inspection/InspectionPlanForm.tsx'
  if (!/createInspection\([\s\S]{0,400}label: '적용취소', run: \(\) => \{ void deleteInspection\(res\.id\)/.test(strip(read(PLAN)))) violations.push(`${PLAN} · 손수 등록 토스트에 [적용취소](그 점검 삭제)가 없다.`)
  const panel = strip(read('components/entity-modal/widgets/RoomCleaningPanel.tsx'))
  if (!/<InspectionRowBody row=\{m\.inspection\}/.test(panel) || !/getRoomInspections\(roomId, \{ includeDeleted: true \}\)/.test(panel)) violations.push(`RoomCleaningPanel · 방 상세 작업 이력이 점검 행이나 삭제분 복원 문을 잃었다.`)
  const rm = strip(read('app/(app)/room-manage/RoomManageClient.tsx'))
  if (!/<InspectionRowBody row=\{i\}/.test(rm)) violations.push(`RoomManageClient · 작업 목록이 점검 행(정본 InspectionRowBody)을 안 그린다.`)
  if (!/\{cleaning \? \([\s\S]{0,400}청소 필요[\s\S]{0,80}\) : insp && \([\s\S]{0,300}점검 남음/.test(rm)) violations.push(`RoomManageClient · 카드 배지가 '청소 필요' 와 '점검 남음' 을 한 자리에서 가르지 않는다. 배지를 넷째로 늘리면 §11 최대 2개를 넘긴다.`)
  if (!/initialInspections=\{inspections\}/.test(strip(read('app/(app)/room-manage/page.tsx')))) violations.push(`room-manage/page.tsx · 점검 목록을 화면에 안 넘긴다.`)
}

// ⓗ 흐름 안 한 줄(4단계). 서버가 돌려준 점검 안내가 화면에서 버려지지 않는다.
//    홈 퇴실 처리 → '퇴실 점검 N항목 · 열기'(그 호실 모달), 홈 입실 처리 → notice, 입주자 상태 위젯 '입실 처리' 앞 WhyCaption + '점검 열기',
//    청소 완료 토스트 뒤 '청소 검수 N항목 · 열기'(방 상세는 그 검수를 펼치고 목록은 그 방을 연다). 서버 결과는 checkoutWithDepositRefund 가 물려준다.
{
  const t = strip(read(TENANTS))
  const cwr = fnBody(t, 'checkoutWithDepositRefund') ?? ''
  if (!/checkoutRes\.inspection \? \{ inspection: checkoutRes\.inspection \}/.test(cwr)) violations.push(`${TENANTS} · checkoutWithDepositRefund 가 퇴실 점검 안내를 화면에 안 물려준다.`)
  // 입실이 닫은 입실 전 점검은 입실 토스트의 둘째 줄이다(운영자 결정 ③). 상태 위젯은 moveInInspectionClosed 를 detail 로, 홈 입실은 notice 를 detail 로.
  const d = strip(read('app/(app)/dashboard/DashboardClient.tsx'))
  if (!/if \(res\.inspection\) \{[\s\S]{0,200}INSPECTION_STAGE_LABEL\.CHECKOUT[\s\S]{0,160}label: '열기', run: \(\) => entityModal\.open\(\{ kind: 'room', roomId: insp\.roomId \}\)/.test(d)) violations.push(`DashboardClient · 홈 퇴실 처리가 퇴실 점검 '열기' 토스트를 안 띄운다.`)
  if (!/confirmReservationToActive\(reservationDueLeaseId\)[\s\S]{0,900}pushToast\('success', '입실 처리됨', res\.notice \? \{ detail: res\.notice \} : undefined\)/.test(d)) violations.push(`DashboardClient · 홈 입실 처리 토스트가 늘 같은 '입실 처리됨' 이 아니거나 닫힌 입실 전 점검을 둘째 줄로 안 싣는다.`)
  const w = strip(read('components/entity-modal/widgets/TenantStatusTransitions.tsx'))
  if (!/const detail = 'moveInInspectionClosed' in res \? res\.moveInInspectionClosed : undefined/.test(w) || !/\.\.\.\(detail \? \{ detail \} : \{\}\)/.test(w)) violations.push(`TenantStatusTransitions · 입실 처리 토스트가 닫힌 입실 전 점검을 둘째 줄로 안 말한다(운영자 결정 ③).`)
  if (!/getOpenMoveInInspection\(moveInRoomId\)/.test(w) || !/<WhyCaption id=\{moveInWhyId\}[\s\S]{0,200}label: '점검 열기'/.test(w) || !/aria-describedby=\{def\.key === 'moveIn' && moveInInsp \? moveInWhyId : undefined\}/.test(w)) violations.push(`TenantStatusTransitions · '입실 처리' 앞 입실 전 점검 안내 줄(WhyCaption · 점검 열기 · describedby)을 잃었다.`)
  const c = strip(read('components/cleaning/CleaningRowBody.tsx'))
  if (!/completeCleaning\(\{ id: r\.id,[\s\S]{0,900}announceInspection\)/.test(c) || !/INSPECTION_STAGE_LABEL\.AFTER_CLEANING/.test(c)) violations.push(`CleaningRowBody · 청소 완료가 만든 청소 검수를 알리지 않는다.`)
  const pnl = strip(read('components/entity-modal/widgets/RoomCleaningPanel.tsx'))
  if (!/onOpenInspection=\{i => \{ setUserOpen\(true\); setFocusInspection\(i\.id\) \}\}/.test(pnl) || !/autoOpen=\{focusInspection === m\.inspection\.id\}/.test(pnl)) violations.push(`RoomCleaningPanel · 청소 검수 '열기' 가 그 검수를 펼치지 않는다.`)
}

// ⓑ' 독립 검수 반영(2026-10-27). 퇴실을 무르는 **모든** 경로·청소 삭제와 그 적용취소·입실을 만드는 모든 경로와 입실 적용취소.
{
  const t = strip(read(TENANTS))
  // CHECKED_OUT 에서 다른 상태로 쓰는 경로(이전 상태가 CHECKED_OUT 인지 보는 export 함수)는 전부 퇴실 청소와 예정 점검을 함께 걷는다(R3).
  // 새 경로가 생겨도 이 판정에 걸린다. 걷기 없이 퇴실을 무르면 거주 중인 방에 '청소 필요'·'점검 남음' 이 남는다.
  let leaves = 0
  for (const m of t.matchAll(/export async function (\w+)\(/g)) {
    const b = fnBody(t, m[1]) ?? ''
    if (!/(prevStatus|lease\.status) === 'CHECKED_OUT'/.test(b)) continue
    leaves++
    if (!/await clearAutoCheckoutCleaning\(propertyId, /.test(b) || !/await clearCheckoutInspections\(propertyId, /.test(b)) violations.push(`${TENANTS} · ${m[1]} 가 퇴실(CHECKED_OUT)에서 다른 상태로 쓰는데 자동 퇴실 청소·예정 점검을 함께 걷지 않는다(R3).`)
  }
  if (leaves < 2) violations.push(`${TENANTS} · 퇴실을 무르는 경로를 ${leaves}곳만 찾았다(상태 위젯·수정 폼 둘 이상). 판정이 낡았다.`)
  const ut = fnBody(t, 'updateTenant') ?? ''
  if (!/if \(prevStatus === 'CHECKED_OUT' && status !== 'CHECKED_OUT'\) \{\s*await clearAutoCheckoutCleaning\(propertyId, leaseTermId\)\s*await clearCheckoutInspections\(propertyId, leaseTermId\)/.test(ut)) violations.push(`${TENANTS} · updateTenant 의 퇴실 무르기(CHECKED_OUT 에서 다른 상태로)가 청소 예정·예정 점검을 걷지 않는다(R3).`)
  // ── 입실(운영자 결정 ③, 독립 재검수 차단 1·2) ──
  // 판정은 정본 isMoveInTransition 하나다(다음 상태 거주중이고 이전 상태가 거주가 아님. 계약 생성은 이전 상태 null).
  const cst2 = strip(read(CONST))
  if (!/export function isMoveInTransition\(prev: string \| null, next: string\): boolean \{\s*return next === 'ACTIVE' && prev !== 'ACTIVE' && prev !== 'CHECKOUT_PENDING'/.test(cst2)) violations.push(`${CONST} · 입실 판정 정본이 '다음 거주중 · 이전 거주 아님' 이 아니다(차단 1).`)
  // 되돌리기 판정은 입실 판정의 정확한 역에서 나온다(재확인 차단 2). 일반 전이용은 그 역 가운데 입주 전 단계만(진짜 퇴실은 안 연다).
  if (!/export function undoesMoveIn\(current: string, restored: string\): boolean \{\s*return isMoveInTransition\(restored, current\)/.test(cst2)
      || !/export function isMoveInUndoTransition\(prev: string \| null, next: string\): boolean \{\s*return prev !== null && undoesMoveIn\(prev, next\) && PRE_MOVE_IN_STATUSES\.includes\(next\)/.test(cst2)
      || !/const PRE_MOVE_IN_STATUSES = \['RESERVED', 'TOUR_DONE', 'WAITING_TOUR', 'CANCELLED'\]/.test(cst2)) violations.push(`${CONST} · 입실 되돌리기 판정이 입실 판정의 정확한 역(undoesMoveIn)에서 나오지 않거나 일반 전이용이 입주 전 단계 밖으로 넓어졌다(재확인 차단 2).`)
  const helper = fnBody(t, 'moveInInspectionOnTransition') ?? ''
  if (!/if \(isMoveInTransition\(prev, next\)\) return \(await closeMoveInInspection\(propertyId, roomId, leaseTermId\)\)/.test(helper) || !/if \(opts\.undo \? prev !== null && undoesMoveIn\(prev, next\) : isMoveInUndoTransition\(prev, next\)\) await reopenMoveInInspectionOnUndo\(propertyId, leaseTermId\)/.test(helper)) violations.push(`${TENANTS} · moveInInspectionOnTransition 이 정본 판정(입실·정확한 역·일반 전이 역)으로 닫기·되열기를 하지 않는다.`)
  // 일괄 수정 적용취소는 되돌림이 확실한 자리라 정확한 역으로 되연다(재확인 차단 2). 빠지면 비거주·퇴실 완료에서 들어온 입실이 안 열린다.
  if (!/await moveInInspectionOnTransition\(propertyId, b\.id, b\.roomId, b\.status, restored\.status, \{ undo: true \}\)/.test(fnBody(t, 'undoBatchUpdateTenants') ?? '')) violations.push(`${TENANTS} · undoBatchUpdateTenants 가 입실의 정확한 역({ undo: true })으로 되열지 않는다(재확인 차단 2).`)
  // 방 이동이 닫는 점검은 이사 표식이다. 입실 적용취소가 그 방까지 되열지 않게(재확인 차단 2).
  for (const fn of ['advanceRoomSchedule', 'updateTenant']) {
    if (!/closeMoveInInspection\([^)]*, 'move'\)/.test(fnBody(t, fn) ?? '')) violations.push(`${TENANTS} · ${fn} 의 방 이동 닫기가 이사 표식('move')이 아니다. 입실 적용취소가 이사로 닫은 다른 방 점검까지 연다(재확인 차단 2).`)
  }
  // 지점 기준(fail closed). 계약 상태를 바꾸거나 계약을 만들거나 방을 옮기는 함수는 거주 구간을 함께 맞춘다(저장소 불변식).
  // 그래서 계약 생성·거주 구간 도우미·거주중 쓰기가 보이는 함수는 전부 입실 훅을 부르거나, 입실이 아닌 까닭이 아래 표에 있어야 한다.
  const MARK = /leaseTerm\.create\(|leaseTerms: \{ create|recordRoomChange\(|syncRoomStayOnSave\(|ensureOpenStay\(|status: 'ACTIVE'[,\s}]/
  // 훅은 직접 부르기만 센다. 계약 생성 두 곳은 afterLeaseCreated 에 맡기는데, 그 몸통이 직접 훅을 불러야만 위임으로 인정한다.
  const HOOK = /moveInInspectionOnTransition\(|closeMoveInInspection\(|closeMoveInInspectionOnMoveIn\(/
  const tenantsSrc = strip(read(TENANTS))
  const afterBody = (fnBody(tenantsSrc, 'afterLeaseCreated') ?? '').split('\n').slice(1).join('\n')
  const DELEGATE_OK = HOOK.test(afterBody)
  if (!DELEGATE_OK) violations.push(`${TENANTS} · afterLeaseCreated(계약 생성 공통부)가 입실 훅을 안 부른다. 거주중으로 바로 등록해도 입실 전 점검이 안 닫힌다(차단 1).`)
  const NOT_MOVE_IN = {
    'app/(app)/tenants/actions.ts#undoAutoCheckout': '퇴실 예정에서 거주중으로 되돌림. 계속 사는 것이라 입실이 아니다',
    'app/(app)/tenants/actions.ts#setCheckoutProration': '퇴실 예정으로 가는 전이',
    'app/(app)/tenants/actions.ts#clearCheckoutProration': '퇴실 예정 정산 되돌림. 거주·퇴실 예정 사이만 오간다',
    'app/(app)/tenants/actions.ts#getTenants': '조회(거주중 조건)',
    'lib/moveInDate.ts#restoreSubLeaseMoveInDates': '딸린 계약 입주일 되돌림. 상태·방이 안 바뀐다',
    'lib/moveInDate.ts#propagateMoveInDateToSubLeases': '딸린 계약 입주일 전파. 상태·방이 안 바뀐다',
    'app/(app)/dashboard/getDashboardData.ts#getDashboardData': '조회(거주중 조건)',
    'app/api/cron/push-alerts/route.ts#GET': '조회(거주중 조건으로 퇴실 예정 자동 전환 후보를 고른다). 거주중에서 나가는 전이뿐',
    'lib/autoCheckout.ts#resolveCheckoutTiming': '퇴실 예정 시점 선택(거주중 유지 또는 퇴실 예정). 이미 사는 계약이다',
    'lib/billing.ts#offerRentForMonth': '청구 계산 입력 값. 쓰기가 아니다',
  }
  // 닫는 함수마다 짝인 적용취소가 되열어야 한다(차단 2). 짝이 없는 것은 그 까닭을 적는다.
  const UNDO_PAIR = {
    'app/(app)/tenants/actions.ts#applyStatusTransition': 'app/(app)/tenants/actions.ts#applyStatusTransition',
    'app/(app)/tenants/actions.ts#updateTenant': 'app/(app)/tenants/actions.ts#updateTenant',
    'app/(app)/tenants/actions.ts#moveInTenant': 'app/(app)/tenants/actions.ts#applyStatusTransition',
    'app/(app)/tenants/actions.ts#confirmReservationToActive': 'app/(app)/tenants/actions.ts#applyStatusTransition',
    'app/(app)/tenants/actions.ts#startLeaseWithRoomSchedule': 'app/(app)/tenants/actions.ts#undoRoomSchedule',
    'app/(app)/tenants/actions.ts#advanceRoomSchedule': 'app/(app)/tenants/actions.ts#undoRoomMove',
    'app/(app)/tenants/actions.ts#batchUpdateTenants': 'app/(app)/tenants/actions.ts#undoBatchUpdateTenants',
    'app/(app)/tenants/actions.ts#undoBatchUpdateTenants': 'app/(app)/tenants/actions.ts#undoBatchUpdateTenants',
    'app/(app)/tenants/actions.ts#afterLeaseCreated': null,          // 계약 생성(addTenant·addLeaseToTenant). 등록 취소는 계약 삭제라 적용취소가 없다
    'app/(app)/tenants/actions.ts#addTenant': null,
    'app/(app)/tenants/actions.ts#addLeaseToTenant': null,
    'app/(app)/tenants/actions.ts#moveInInspectionOnTransition': null, // 정본 도움 함수 자신
    'app/(app)/tenants/actions.ts#closeMoveInInspection': null,
    'app/api/import/route.ts#createTenantAndLease': null,             // 엑셀 가져오기. 적용취소가 없다(계약 삭제로 정리)
  }
  const fnsOf = src => [...src.matchAll(/(?:^|\n)(?:export\s+)?(?:async\s+)?function\s+(\w+)\(/g)].map(m => m[1])
  const SCAN = [...walk('app'), ...walk('lib')].filter(f => /\.ts$/.test(f) && !['lib/roomStay.ts', 'lib/roomInspectionEnsure.ts'].includes(f))
  let points = 0
  const closers = []
  for (const file of SCAN) {
    const src = strip(read(file))
    if (!MARK.test(src) && !HOOK.test(src)) continue
    for (const name of new Set(fnsOf(src))) {
      // 첫 줄(선언)을 걷는다. 함수 이름이 훅 이름이면 자기 선언이 훅으로 세어진다.
      const b = (fnBody(src, name) ?? '').split('\n').slice(1).join('\n')
      const key = `${file}#${name}`
      const hooked = HOOK.test(b) || (DELEGATE_OK && /afterLeaseCreated\(/.test(b))
      if (HOOK.test(b)) closers.push(key)
      if (!MARK.test(b)) continue
      points++
      if (hooked || NOT_MOVE_IN[key]) continue
      violations.push(`${file} · ${name} 가 계약 생성·상태 쓰기·방 이동 지점인데 입실 훅(moveInInspectionOnTransition·closeMoveInInspection)을 안 부르고, 입실이 아닌 까닭도 NOT_MOVE_IN 에 없다(차단 1).`)
    }
  }
  if (points < 12) violations.push(`입실 지점을 ${points}곳만 찾았다(12곳 이상 기대). 판정이 낡았다.`)
  for (const key of closers) {
    if (!(key in UNDO_PAIR)) { violations.push(`${key} · 입실 전 점검을 닫는데 짝인 적용취소가 표(UNDO_PAIR)에 없다(차단 2).`); continue }
    const undo = UNDO_PAIR[key]
    if (!undo) continue
    const [uf, un] = undo.split('#')
    const ub = fnBody(strip(read(uf)), un) ?? ''
    if (!/reopenMoveInInspectionOnUndo\(propertyId, |moveInInspectionOnTransition\(/.test(ub)) violations.push(`${undo} · ${key} 의 적용취소인데 그 입실이 닫은 입실 전 점검을 되열지 않는다(차단 2).`)
  }
  // 방 이동 적용취소는 옮겨 들어갔던 방 하나만 되연다(입실 전체를 되열면 앞서 들어간 방까지 열린다).
  if (!/await reopenMoveInInspectionOnUndo\(propertyId, input\.leaseTermId, \{ roomId: moved\.roomId, by: 'move' \}\)/.test(fnBody(t, 'undoRoomMove') ?? '')) violations.push(`${TENANTS} · undoRoomMove 가 옮겨 들어갔던 방의 이사가 닫은 입실 전 점검만 되열지 않는다.`)
  // 입실 적용취소는 입실 표식만 본다(이사 표식을 넘기면 이사로 닫은 방까지 열린다).
  if (!/await reopenMoveInInspectionOnUndo\(propertyId, leaseTermId\)\n/.test(fnBody(t, 'undoRoomSchedule') ?? '')) violations.push(`${TENANTS} · undoRoomSchedule 이 입실 표식만으로 되열지 않는다(재확인 차단 2).`)
  // 동시성(권고 3) — 닫기·되열기는 조건부 쓰기다. 읽은 뒤 그사이 바뀐 점검은 건드리지 않는다.
  const e = strip(read(ENSURE))
  const close = fnBody(e, 'closeMoveInInspectionOnMoveIn') ?? ''
  if (!/where: \{ id: open\.id, propertyId, status: 'PLANNED', deletedAt: null \},\s*data: \{ status: 'SKIPPED', doneBy: moveInClosedMarker\(leaseTermId, by\) \}/.test(close) || !/if \(done\.count === 0\) return null/.test(close)) violations.push(`${ENSURE} · 입실 닫기가 '예정일 때만' 조건부 쓰기가 아니거나 못 닫았는데 닫았다고 말한다(권고 3).`)
  const reopen = fnBody(e, 'reopenMoveInInspectionOnUndo') ?? ''
  if (!/const marker = moveInClosedMarker\(leaseTermId, opts\.by \?\? 'movein'\)/.test(reopen) || !/doneBy: marker, deletedAt: null, \.\.\.\(opts\.roomId/.test(reopen)
      || !/where: \{ id: row\.id, propertyId, status: 'SKIPPED', doneBy: marker, deletedAt: null \}/.test(reopen) || !/if \(other\) continue/.test(reopen)) violations.push(`${ENSURE} · 입실 적용취소가 '그 입실 표식이 있는 안 함일 때만' 조건부로 되열지 않거나 열린 점검과 겹쳐 연다(권고 3).`)
  // 청소 삭제·삭제 적용취소(운영자 판단 ③). 삭제는 예정 검수만 걷고, 완료된 청소를 되살리면 걷힌 검수만 되살린다(새로 만들지 않는다).
  const c = strip(read(CLEANING))
  if (!/await clearCleaningInspection\(propertyId, id\)/.test(fnBody(c, 'deleteCleaning') ?? '')) violations.push(`${CLEANING} · 청소 삭제가 그 청소의 예정 검수를 안 걷는다.`)
  if (!/if \(cur\.status === 'DONE'\) \{\s*await ensureRoomInspection\(propertyId, \{ roomId: cur\.roomId, stage: 'AFTER_CLEANING', cleaningId: cur\.id, scheduledDate: cur\.doneDate, reviveOnly: true \}\)/.test(fnBody(c, 'restoreCleaning') ?? '')) violations.push(`${CLEANING} · 청소 삭제 적용취소가 완료된 청소의 걷힌 검수를 되살리지 않는다(또는 새로 만든다).`)
  // 같은 방·같은 단계에 예정 점검이 둘 서지 않는다(R7). 손수 등록·되열기·되살리기가 같은 문을 지난다.
  const a = strip(read(ACTIONS))
  for (const fn of ['reopenInspection', 'restoreInspection']) {
    if (!/await openSiblingError\(propertyId, cur\)/.test(fnBody(a, fn) ?? '')) violations.push(`${ACTIONS} · ${fn} 가 같은 방·같은 단계의 예정 점검과 겹치는지 안 본다(R7).`)
  }
}

console.log(`[방 점검 배선] 축 ⓐ 조회 deletedAt · ⓑ 퇴실·청소 양 경로(+ 모든 퇴실 무르기·청소 삭제·입실 닫기) · ⓒ 생성 문 · ⓓ 라벨 한 벌 · ⓔ 항목 잠금 · ⓕ 비품 규칙 · ⓖ 행 UI·적용취소 · ⓗ 흐름 안 한 줄 / 위반 ${violations.length}건`)
for (const v of violations) console.error(`  - ${v}`)
process.exit(violations.length ? 1 : 0)
