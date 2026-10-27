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
  for (const re of [/propertyId, roomId, receivedAt: \{ not: null \}, disposedAt: null, isShipping: false, excludeFromInventory: false,/, /itemLabel: \{ not: null \}, category: \{ notIn: trackedCategories \}/, /excluded: parseOptionList\('inspectionExcludedItems'/]) {
    if (!re.test(plan)) violations.push(`${ENSURE} · 퇴실 점검 비품 조회가 승인 조건을 잃었다(${re.source.replace(/\\/g, '').slice(0, 50)}).`)
  }
  const s = strip(read(SEED))
  const isA = fnBody(s, 'isInspectableAsset') ?? ''
  for (const re of [/!row\.receivedAt \|\| row\.disposedAt/, /row\.isShipping \|\| row\.excludeFromInventory/, /!row\.itemLabel/, /trackedCategories\.includes\(row\.category\)/]) {
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
    ['항목 결과', /setInspectionItemResult\(\{ itemId: it\.id, result,[\s\S]{0,400}undo\(async \(\) => \{\s*const back = await setInspectionItemResult\(\{ itemId: it\.id, result: res\.prev\.result, note: res\.prev\.note, restoreCheckedAt: res\.prev\.checkedAt \}\)/],
    ['항목 더하기', /addInspectionItem\([\s\S]{0,300}undo\(\(\) => removeInspectionItem\(res\.item\.id\)/],
    ['항목 삭제', /removeInspectionItem\(it\.id\)[\s\S]{0,300}label: '적용취소',\s*run: \(\) => \{ void restoreInspectionItem\(res\.snapshot\)/],
    ['완료', /completeInspection\(\{ id: r\.id, doneDate \}\)[\s\S]{0,200}undo\(\(\) => reopenInspection\(r\.id\)/],
    ['안 하기로', /skipInspection\(r\.id\)[\s\S]{0,200}undo\(\(\) => reopenInspection\(r\.id\)/],
    ['삭제', /deleteInspection\(r\.id\), '삭제됨'[\s\S]{0,200}undo\(\(\) => restoreInspection\(r\.id\)/],
    ['복원', /restoreInspection\(r\.id\), '점검 기록 복원됨'[\s\S]{0,200}undo\(\(\) => deleteInspection\(r\.id\)/],
  ]
  for (const [what, re] of PAIRS) if (!re.test(r)) violations.push(`${ROW} · '${what}' 쓰기에 토스트 [적용취소] 짝이 없다(§16, 모든 쓰기에 적용취소).`)
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

console.log(`[방 점검 배선] 축 ⓐ 조회 deletedAt · ⓑ 퇴실·청소 양 경로 · ⓒ 생성 문 · ⓓ 라벨 한 벌 · ⓔ 항목 잠금 · ⓕ 비품 규칙 · ⓖ 행 UI·적용취소 / 위반 ${violations.length}건`)
for (const v of violations) console.error(`  - ${v}`)
process.exit(violations.length ? 1 : 0)
