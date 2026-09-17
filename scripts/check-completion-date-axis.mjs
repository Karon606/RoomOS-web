// 완료 처리 날짜 축이 '클릭한 날'로 되돌아가는 것을 잡는 감지망. 읽기 전용, 위반 시 exit 1.
//
// 왜 넷째 형제가 필요한가 (운영자 지시 2026-09-17)
//   "뭔가를 완료처리하고 처리 날짜가 기록되는 건은 항상 날짜를 수동으로 입력할 수 있게 해줘."
//   기존 시간 감지망 셋은 **이 클래스를 안 본다.**
//     check-ssr-local-now        — '오늘'을 어떻게 만드나(서버·기기 하이드레이션)
//     check-naive-datetime       — 오프셋 없는 일시 문자열·로컬 시각 게터
//     check-local-midnight-boundary — 창(범위)의 양끝
//   셋 다 "값을 어떻게 만드나"를 보고, "운영자에게 물었나"는 안 본다. `resolvedAt: new Date()` 는
//   타임존이 완벽해도 **틀린 날**을 박는다 — 일어난 날이 아니라 누른 날이기 때문이다.
//
// 같은 병을 이미 두 번 앓았다. 현금영수증 발행일(2026-08-24)과 보증금 정산일(2026-09-03)이다.
// 세 번째라 케이스가 아니라 클래스로 막는다.
//
// 무엇을 보나
//   ⓐ 값 — 완료 계열 칸에 `new Date()` 를 직접(또는 '지금' 변수로) 박는 자리. 칸 이름은
//      **prisma/schema.prisma 에서 접미사로 뽑는다**(check-naive-datetime 이 @db.Date 명단을
//      스키마에서 읽는 그 관행). 명단을 손으로 들면 새 완료 칸이 생길 때마다 그물이 뒤처진다.
//      **새 완료 칸은 ALLOW 에 없으므로 fail closed 로 걸린다** — 그것이 이 축의 요점이다.
//   ⓑ 서버 — 완료 액션들이 미래 가드(assertNotFuture)와 값 결정 정본(resolveCompletionAt)을 지나는가.
//   ⓒ 화면 — 완료 버튼 옆에 완료일 칸이 서고 그 칸에 maxDate 가 걸려 있는가.
//   ⓓ 어휘 — 라벨이 '완료일'이다. '처리일'은 **클릭한 날로 읽힌다**(보증금 정산일 축 ⓒ 가 이미 막았다).
//      **거부 사유는 그 화면의 낱말을 쓴다.** 정본 assertNotFuture 의 기본 사유는 '완료일이
//      미래입니다'인데, 그것을 그대로 돌려주면 라벨이 '점검일'·'입수일'·'폐기일'인 폼에서 화면에
//      없는 낱말이 뜬다(검수 지적 B1, 2026-09-17 — 자재 여섯이 그 상태였다). 리터럴 '처리일'만
//      보던 종전 축은 이 클래스를 한 건도 못 잡았다.
//   ⓔ 순서 — **행 인라인 확인 줄은 확인 좌 · 취소 우**다(저장소 전수 7 대 0, 2026-09-17).
//      같은 요청을 완료하는 두 화면에서 좌우가 거울이면, 한쪽에서 완료를 누르던 손 위치가 다른
//      쪽에서는 취소다 — 그 취소는 방금 적은 메모를 버리고 적용취소도 없다. §13·§14 의 '취소 좌'는
//      폼 박스·모달 푸터 축이라 **다른 자리**이므로 이 축은 인라인 확인 줄만 본다.
//   ⓕ 발급일 — 서류 발급일도 미래를 막는다(운영자 확정 2026-09-17 — "미래로 할 필요는 없을 듯,
//      필요하면 발급 전에 수동으로 바꾸면 되니까"). 화면 상한 + 서버 가드 두 겹이다.
//
// 무엇을 안 보나 — 이미 도메인 그물이 보는 자리는 뺀다. 두 그물이 같은 줄을 울면 고치는 사람이
// 어느 규칙을 따를지 모른다.
//   · cashReceiptIssuedAt / CashReceipt.issuedAt — 현금영수증 축(규칙 20·20-b, [[cash-receipt-refund]])
//   · depositReturnDate — 보증금 정산일 축(check-deposit-return-date-axis)
//   이름 접미사에 issued·returned 를 **일부러 안 넣었다.** 넣으면 저 둘을 두 번 세게 된다.
//   · Expense.receivedAt(자재 수령) — 시점별 재고·평균 소모율·리드타임이 그 축에 얹혀 있어 별건이다.
//
// 실행: node scripts/check-completion-date-axis.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCAN_DIRS = ['app', 'components', 'lib']
const violations = []

// ── 완료 계열 칸 이름 — 스키마에서 접미사로 뽑는다 ──────────────
const FAMILY = /(?:resolved|checked|done|completed|finished|settled)(?:At|Date)$/i
const SCHEMA = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8')
const COMPLETION_COLUMNS = new Set(
  (SCHEMA.match(/^\s*(\w+)\s+DateTime\??/gm) ?? [])
    .map(l => l.trim().split(/\s+/)[0])
    .filter(n => FAMILY.test(n)),
)
if (COMPLETION_COLUMNS.size === 0) {
  violations.push('schema.prisma 에서 완료 계열 칸을 하나도 못 뽑았다 — 아무것도 안 보는 그물이 가장 나쁘다. 접미사 규칙을 고칠 것')
}

/**
 * '지금'을 박아도 되는 자리. **로그다** — 그 조작을 언제 눌렀는지가 기록의 뜻 자체인 칸.
 * 명단은 최소로 유지한다. 사실(언제 일어났나)을 적는 칸은 절대 여기 오면 안 된다.
 */
const ALLOW = [
  {
    file: 'app/(app)/tenants/actions.ts', column: 'undoneAt',
    why: '단기 연장 적용취소를 **누른 시각**이다. 일어난 날이 따로 있는 사실이 아니라 조작 로그라 지금이 맞다',
  },
  {
    file: 'app/(app)/finance/actions.ts', column: 'undoneAt',
    why: '품목명 병합 되돌리기를 **누른 시각**이다. 같은 이유로 로그다',
  },
]
const allowed = (file, column) => ALLOW.some(a => a.file === file && a.column === column)

// ── ⓐ 값 축 ──────────────────────────────────────────────────
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { walk(p); continue }
    if (!/\.tsx?$/.test(name)) continue
    scan(relative(ROOT, p).split('\\').join('/'), readFileSync(p, 'utf8'))
  }
}

function scan(rel, src) {
  const lines = src.split('\n')
  // '지금'으로 만들어진 변수 이름. `const now = new Date()` 를 거쳐 칸에 실리면 직접 대입과 같다.
  const nowVars = new Set()
  lines.forEach((raw, i) => {
    // 주석은 걷는다 — 설명하려고 적은 낱말이 위반으로 잡히면 그물이 주석을 못 쓰게 만든다.
    const line = raw.replace(/\/\/.*$/, '')
    const at = rule => violations.push(`${rel}:${i + 1} [${rule}]\n      ${raw.trim()}`)

    const nv = line.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new Date\(\s*\)/)
    if (nv) nowVars.add(nv[1])

    for (const m of line.matchAll(/\b(\w+)\s*:\s*([^,{}]*)/g)) {
      const col = m[1]
      if (!COMPLETION_COLUMNS.has(col) || allowed(rel, col)) continue
      const val = m[2].trim()
      if (/^new Date\(\s*\)/.test(val)) {
        at(`완료 칸(${col})에 '지금'을 직접 박는다 — 클릭한 날이지 일어난 날이 아니다. lib/completionDate resolveCompletionAt 을 쓸 것`)
      } else if (nowVars.has(val)) {
        at(`완료 칸(${col})에 '지금' 변수(${val})를 박는다 — 같은 클래스다. lib/completionDate resolveCompletionAt 을 쓸 것`)
      }
    }
    // data: { checkedAt } 같은 축약 표기
    for (const m of line.matchAll(/[{,]\s*([A-Za-z_$][\w$]*)\s*[,}]/g)) {
      const col = m[1]
      if (COMPLETION_COLUMNS.has(col) && !allowed(rel, col) && nowVars.has(col)) {
        at(`완료 칸(${col})에 '지금' 변수를 축약으로 싣는다 — 같은 클래스다`)
      }
    }
  })
}

for (const d of SCAN_DIRS) walk(join(ROOT, d))

// ── ⓑ 서버 축 — 완료 액션이 두 정본을 지나는가 ─────────────────
const strip = s => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')

/** 파일에서 export 함수 하나의 몸통만 잘라 낸다 — 파일 어딘가의 가드가 대신 통과하지 않게. */
function fnBody(source, name) {
  const at = source.indexOf(`export async function ${name}(`)
  if (at < 0) return null
  const next = source.indexOf('\nexport ', at + 1)
  return source.slice(at, next < 0 ? source.length : next)
}

const SERVER = [
  { file: 'app/(app)/tenants/actions.ts', fn: 'resolveTenantRequest', what: '요청·컴플레인 완료' },
  { file: 'app/(app)/checklist/actions.ts', fn: 'markChecklistDone', what: '점검 완료' },
  { file: 'app/(app)/room-manage/workActions.ts', fn: 'completeRoomWork', what: '작업 완료', guardOnly: true },
  { file: 'app/(app)/room-manage/cleaningActions.ts', fn: 'completeCleaning', what: '청소 완료', guardOnly: true },
]
for (const s of SERVER) {
  const body = fnBody(strip(readFileSync(join(ROOT, s.file), 'utf8')), s.fn)
  if (body === null) {
    violations.push(`${s.file} — ${s.fn} 을 못 찾았다(${s.what}). 이름이 바뀌었으면 이 그물도 같이 고쳐야 한다`)
    continue
  }
  if (!/assertNotFuture\(/.test(body)) {
    violations.push(`${s.file} — ${s.fn} 에 미래 가드가 없다(${s.what}). 화면 maxDate 가 전부여도 다섯째 경로가 뚫는다`)
  }
  // 값 결정을 정본에 맡기는가. 날짜만 받는 자리(작업·청소)는 ymdToDbDate 로 @db.Date 에 바로 앉힌다.
  if (!s.guardOnly && !/resolveCompletionAt\(/.test(body)) {
    violations.push(`${s.file} — ${s.fn} 이 값 결정 정본(resolveCompletionAt)을 안 지난다(${s.what})`)
  }
}

// 엑셀 임포트가 화면과 **같은 정본**을 지나는가 — 두 경로가 갈리면 임포트만 옛 규칙에 남는다.
{
  const imp = strip(readFileSync(join(ROOT, 'app/api/import/route.ts'), 'utf8'))
  if (!/resolveCompletionAt\(/.test(imp) || !/assertNotFuture\(/.test(imp)) {
    violations.push("app/api/import/route.ts — 요청 시트의 '해결일'이 완료 날짜 정본을 안 지난다")
  }
  if (/resolvedAt\s*=[\s\S]{0,80}\?\?\s*new Date\(\)/.test(imp)) {
    violations.push("app/api/import/route.ts — 임포트가 '해결일'이 비면 오늘을 박는 옛 문법으로 되돌아갔다")
  }
}

// ── ⓓ 어휘 축(2) — 거부 사유가 그 화면의 낱말을 쓰는가 ──────────
//
// 정본 assertNotFuture 의 기본 사유는 '완료일이 미래입니다'다. 라벨이 '점검일'·'입수일'인 폼에서
// 그것을 그대로 돌려주면 **화면에 없는 낱말**이 뜬다. 시공자는 이 규칙을 알고 있었다 —
// lib/cashReceipt 주석이 "사유 문구만 이 도메인의 말이다"이고 퇴실도 제 말을 쓴다. 자재 여섯만
// 빠졌고, 리터럴 '처리일'만 보던 종전 축은 한 건도 못 잡았다(검수 지적 B1).
//
// **명단은 fail closed 다.** 새 가드 자리가 생기면 여기 적히기 전까지 걸린다 — 적는 순간
// '이 화면의 낱말이 무엇인가'를 스스로 답하게 되는 것이 이 축의 요점이다. 열쇠는 줄 번호가 아니라
// 감싸는 함수 이름이라 코드가 위아래로 밀려도 안 썩는다.
const GUARD_SITES = [
  { file: 'app/(app)/tenants/actions.ts', fn: 'checkoutTenant',        word: '퇴실일' },
  { file: 'app/(app)/tenants/actions.ts', fn: 'applyStatusTransition', word: '퇴실일' },
  { file: 'app/(app)/tenants/actions.ts', fn: 'resolveTenantRequest',  word: '완료일' },
  { file: 'app/(app)/inventory/actions.ts', fn: 'createStockCheck',     word: '점검일' },
  { file: 'app/(app)/inventory/actions.ts', fn: 'updateStockCheck',     word: '점검일' },
  { file: 'app/(app)/inventory/actions.ts', fn: 'saveFullReconcile',    word: '보정일' },
  { file: 'app/(app)/inventory/actions.ts', fn: 'createStockAddition',  word: '입수일' },
  { file: 'app/(app)/inventory/actions.ts', fn: 'updateStockAddition',  word: '입수일' },
  { file: 'app/(app)/inventory/actions.ts', fn: 'createStockDisposal',  word: '폐기일' },
  { file: 'app/(app)/room-manage/cleaningActions.ts', fn: 'completeCleaning',   word: '완료일' },
  { file: 'app/(app)/room-manage/cleaningActions.ts', fn: 'rescheduleCleaning', word: '완료일' },
  { file: 'app/(app)/room-manage/workActions.ts', fn: 'completeRoomWork',    word: '완료일' },
  { file: 'app/(app)/room-manage/workActions.ts', fn: 'rescheduleRoomWork',  word: '완료일' },
  { file: 'app/(app)/checklist/actions.ts', fn: 'markChecklistDone', word: '완료일' },
  { file: 'app/api/import/route.ts', fn: 'importRequests', word: '완료일' },
  // 아래 셋은 완료 축 밖의 도메인이라 제 말을 쓴다(현금영수증·서류 발급은 각자의 노트가 정본).
  { file: 'lib/cashReceipt.ts', fn: 'resolveCashReceiptIssuedAt', word: '발행일' },
  { file: 'app/api/rent-receipt/generate/route.ts', fn: 'POST', word: '발급일' },
  { file: 'app/api/residence-cert/generate/route.ts', fn: 'POST', word: '발급일' },
]

/** 이 위치를 감싸는 `function 이름(` 을 위로 거슬러 찾는다. 줄 번호보다 안 썩는 열쇠다. */
function enclosingFn(src, index) {
  const head = src.slice(0, index)
  let name = null
  for (const m of head.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g)) name = m[1]
  return name
}

{
  const seen = new Set()
  for (const site of new Set(GUARD_SITES.map(s => s.file))) {
    const src = strip(readFileSync(join(ROOT, site), 'utf8'))
    for (const m of src.matchAll(/assertNotFuture\(/g)) {
      const fn = enclosingFn(src, m.index)
      const decl = GUARD_SITES.find(s => s.file === site && s.fn === fn)
      if (!decl) {
        violations.push(`${site} — ${fn ?? '(파일 최상위)'} 의 미래 가드가 명단에 없다. 이 화면의 날짜 칸 라벨을 GUARD_SITES 에 적을 것(그 낱말이 거부 사유에 서야 한다)`)
        continue
      }
      seen.add(`${site}::${fn}`)
      // 이 가드가 무엇을 사유로 돌려주는지 — 다음 가드 전까지만 본다.
      const next = src.indexOf('assertNotFuture(', m.index + 1)
      const chunk = src.slice(m.index, next < 0 ? m.index + 400 : Math.min(next, m.index + 400))
      const usesCanon = /\.reason\b/.test(chunk)
      if (usesCanon && decl.word !== '완료일') {
        violations.push(`${site} — ${fn} 이 정본 기본 사유를 그대로 돌려준다. 이 폼의 라벨은 '${decl.word}'이라 화면에 없는 낱말('완료일')이 뜬다`)
      }
      if (!usesCanon && !chunk.includes(`${decl.word}이 미래입니다`) && !chunk.includes(`${decl.word}가 미래입니다`)) {
        violations.push(`${site} — ${fn} 의 거부 사유가 제 낱말('${decl.word}')을 안 쓴다`)
      }
    }
  }
  for (const s of GUARD_SITES) {
    if (!seen.has(`${s.file}::${s.fn}`)) {
      violations.push(`${s.file} — ${s.fn} 에서 미래 가드가 사라졌다(명단에는 '${s.word}'로 적혀 있다). 이름이 바뀌었으면 명단도 같이 고칠 것`)
    }
  }
}

// ── ⓕ 발급일 축 — 서류 발급일도 미래를 막는다 ────────────────────
// 운영자 확정 2026-09-17. 종전 조사가 "미래 발급이 정당한 업무인지 확인 못 했다"로 남겼는데
// **정당한 업무가 없다는 답**이 나왔다("필요하면 발급 전에 수동으로 바꾸면 되니까").
// 화면 상한이 둘로 갈린다 — 영수증은 정본 DatePicker(maxDate), 실거주 확인서는 툴바 칩이라
// 네이티브 input 의 max 다(.rc-field 가 옆 select 와 한 규칙으로 모양을 준다).
for (const s of [
  { file: 'app/rent-receipt/[tenantId]/RentReceiptView.tsx', re: /maxDate=\{kstYmdStr\(\)\}/, what: '납부 확인서·보증금 영수증 발행일(정본 DatePicker)' },
  { file: 'app/residence-cert/[tenantId]/ResidenceCertView.tsx', re: /type="date"[^>]*\bmax=\{kstYmdStr\(\)\}/, what: '실거주 확인서 작성일(툴바 칩, 네이티브 max)' },
]) {
  if (!s.re.test(strip(readFileSync(join(ROOT, s.file), 'utf8')))) {
    violations.push(`${s.file} — 발급일 칸에 미래 상한이 없다(${s.what}). 아직 발급하지 않은 날짜로 종이가 나간다`)
  }
}

// ── ⓒⓓ 화면 축 — 완료 버튼 옆 날짜 칸·maxDate·라벨 ──────────────
// dateFields = 이 화면에 서야 하는 **상한 걸린 날짜 칸의 수**. 개수를 안 박으면 칸이 둘인 화면에서
// 하나를 지워도 나머지 하나가 검사를 통과시킨다 — 이 그물을 세우고 역주입으로 실제로 겪었다
// (체크리스트는 카드와 점검 모달 둘인데, 카드 칸을 지워도 초록불이 떴다). 정당하게 칸이 늘면
// 이 수를 같이 올린다. 그 한 줄이 "칸을 하나 더 세웠다"는 선언이다.
const SCREENS = [
  { file: 'app/(app)/requests/RequestsClient.tsx', what: '/requests 완료 확인 줄', dateFields: 1 },
  { file: 'components/entity-modal/widgets/TenantRequestsTab.tsx', what: '입주자 정보 › 요청·컴플레인 탭', dateFields: 1 },
  { file: 'app/(app)/checklist/ChecklistClient.tsx', what: '체크리스트 카드·점검 모달', dateFields: 2 },
  { file: 'components/work/RoomWorkRowBody.tsx', what: '작업 행 완료 폼', dateFields: 2 },
  { file: 'components/cleaning/CleaningRowBody.tsx', what: '청소 행 완료 폼', dateFields: 2 },
]
for (const s of SCREENS) {
  const raw = readFileSync(join(ROOT, s.file), 'utf8')
  const src = strip(raw)
  if (!/(^|[>\s]) *완료일/m.test(src)) {
    violations.push(`${s.file} — 완료일 라벨이 없다(${s.what}). 완료 처리가 날짜를 안 묻는 상태로 되돌아갔다`)
  }
  // maxDate 가 kstYmdStr() 로 걸려 있는가 — **몇 칸인지까지 센다.** 상수로 빼도 되지만
  // 그때는 이 그물을 같이 고친다.
  const fields = [...src.matchAll(/maxDate=\{[^}]*kstYmdStr\(\)/g)].length
  if (fields !== s.dateFields) {
    violations.push(fields === 0
      ? `${s.file} — 완료일 칸에 maxDate 가 없다(${s.what}). 아직 하지 않은 일을 완료로 고를 수 있다`
      : `${s.file} — 상한 걸린 날짜 칸이 ${fields}개다(${s.what}, 있어야 할 수 ${s.dateFields}). 칸이 줄었으면 어느 경로가 상한을 잃었는지 보고, 정당하게 늘었으면 이 그물의 dateFields 를 같이 올릴 것`)
  }
  // 어휘 — '처리일'은 클릭한 날로 읽힌다(보증금 정산일 축 ⓒ 와 같은 판정).
  // '목표 처리일'은 앞날을 적는 다른 칸이라 예외다.
  if (/(?<!목표 )처리일(?!\s*\(선택\))/.test(src.replace(/목표 처리일/g, ''))) {
    violations.push(`${s.file} — 라벨이 '처리일'이다(${s.what}). 축 이름은 '완료일' 하나다`)
  }
}

// ── ⓔ 순서 축 — 행 인라인 확인 줄은 확인 좌 · 취소 우 ────────────
//
// 위 다섯 화면에 **정본을 더해서** 본다. 정본(수납 내역의 발행일 줄)이 뒤집히면 나머지가 전부
// 그쪽으로 끌려가므로, 기준이 되는 줄이야말로 지켜야 한다.
for (const s of [
  ...SCREENS,
  { file: 'components/entity-modal/widgets/PaymentRecordList.tsx', what: '수납 내역 발행일 확인 줄(정본)' },
]) {
  for (const v of confirmRowOrder(readFileSync(join(ROOT, s.file), 'utf8'), s)) violations.push(v)
}

/**
 * 인라인 확인 줄의 버튼 순서를 본다 — **확인 좌 · 취소 우**(저장소 전수 7 대 0).
 *
 * 무엇을 한 줄로 보나. 상한이 걸린 날짜 칸(`maxDate={…kstYmdStr()}`) 뒤에 오는 첫 버튼 행 하나다.
 *
 * **폼 박스·모달 푸터는 뺀다**(§13·§14 는 취소 좌라 반대 축이다). 가르는 표식은 `justify-end` 다 —
 * 폼 푸터는 오른쪽에 모아 세우고 행 인라인 줄은 flex-1 로 폭을 나눠 가진다. 실제로 이 축을 세울 때
 * PaymentRecordList 의 수납 편집 폼(`flex gap-2 justify-end`, 취소 좌)이 걸려 나왔고, 그것은 결함이
 * 아니라 **다른 축의 올바른 줄**이었다. 표식 없이 창만 좁히면 그 줄을 잘못 빨갛게 만든다.
 *
 * 버튼 종류는 안 본다. CleaningRowBody 는 RowActionBtn 이 아니라 Btn 을 쓰는데도 확인이 왼쪽이다.
 * **컴포넌트가 아니라 자리가 문법을 정한다.**
 */
function confirmRowOrder(raw, s) {
  const out = []
  const src = strip(raw)
  for (const m of src.matchAll(/maxDate=\{[^}]*kstYmdStr\(\)/g)) {
    // 다음 날짜 칸 전까지가 이 줄의 몫이다.
    const next = src.indexOf('maxDate={', m.index + 1)
    const win = src.slice(m.index, next < 0 ? src.length : next)
    const rowAt = win.search(/<div className="flex gap-/)
    if (rowAt < 0) continue                       // 확인 줄이 아닌 날짜 칸(모달 본문 등)
    const row = divBlock(win, rowAt)
    if (row === null) continue
    if (/^<div className="[^"]*justify-end/.test(row)) continue   // 폼 박스·모달 푸터 = §13·§14 취소 좌
    // 버튼 하나하나의 글자를 본다. '적용취소'는 취소가 아니라 되돌리기라 뺀다.
    const btns = [...row.matchAll(/<(?:button|Btn|RowActionBtn)\b/g)].map(b => {
      const el = row.slice(b.index, b.index + 600)
      return { at: b.index, cancel: /(?<!적용)취소/.test(el.split(/<\/(?:button|Btn|RowActionBtn)>/)[0]) }
    })
    const firstCancel = btns.find(b => b.cancel)
    const firstConfirm = btns.find(b => !b.cancel)
    if (!firstCancel || !firstConfirm) continue   // 한쪽만 있는 줄은 순서가 없다
    if (firstCancel.at < firstConfirm.at) {
      const line = src.slice(0, m.index).split('\n').length
      out.push(`${s.file}:${line} 인라인 확인 줄이 [취소][확인] 이다(${s.what}). 저장소 문법은 **확인 좌 · 취소 우**(전수 7 대 0) — 같은 일을 하는 형제 화면에서 완료를 누르던 손 위치가 여기서는 취소가 된다`)
    }
  }
  return out
}

/** `<div …>` 한 벌을 여닫는 짝을 세어 떼어 온다. */
function divBlock(src, start) {
  let depth = 0
  for (const m of src.slice(start).matchAll(/<div\b|<\/div>/g)) {
    depth += m[0] === '</div>' ? -1 : 1
    if (depth === 0) return src.slice(start, start + m.index + m[0].length)
  }
  return null
}

console.log(`[완료 처리 날짜 축] 완료 칸 ${COMPLETION_COLUMNS.size}종(${[...COMPLETION_COLUMNS].join('·')}) · 허용 ${ALLOW.length}곳 / 위반 ${violations.length}건`)
for (const v of violations) console.error(`  - ${v}`)
if (violations.length > 0) {
  console.error('\n  완료 처리 날짜는 운영자가 적는다(지시 2026-09-17). 값 결정은 lib/completionDate 하나,')
  console.error('  미래는 화면 maxDate 와 서버 assertNotFuture 두 겹으로 막는다. 자세히는 knowledge/domain-completion-date.md')
  process.exit(1)
}
