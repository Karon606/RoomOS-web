// 작업·청소가 만드는·고치는 지출이 결제수단과 정산상태를 싣는지 지키는 정적 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 왜 (2026-10-27 운영자 지적, 승인 계획 1단계). "작업탭 통해서 지출 내역이 들어가니 이쪽에서는 결제수단 입력이 안되어 있네".
// completeRoomWork·completeCleaning 이 지출을 만들 때 payMethod·결제 계정을 안 적어 결제수단 빈 지출이 남았고, 신용카드로 낸
// 청소비가 카드 정산에 안 올랐다(운영 실측 작업·청소 지출 7건, 전부 정산완료).
//
// 축.
//   ⓐ 정본 lib/workPayDefault — 기본값 차례(같은 업체 → 같은 카테고리 → 영업장 목록 첫 값), 결제 계정은 그 영업장 것만 읽고
//      표시명(financeName)은 계정에서 다시 짓는다. server-only.
//   ⓑ 쓰기 함수(아래 WRITERS)의 몸통이 resolveWorkPay 를 부르고, 그 안의 expense.create 는 payMethod·financialAccountId·financeName 과
//      settleStatus: settleStatusForNew( 를 싣는다. 결제수단을 바꾸는 expense.update 는 같은 data 안에 settleStatusForEdit( 가 있다.
//      몸통에 날것 판정('신용카드' ? …)이 없다. 함수를 못 찾으면 통과가 아니라 위반이다.
//   ⓒ 화면 조회(getWorkPayOptions)는 편집 권한만 열고 기본값은 정본 표(workPayDefaults)에서 낸다. 지출 화면의 직전 지출(getLastPayDefaults)은
//      작업·청소 쪽 어디서도 안 쓴다(아무 지출이나 마지막 것이라 청소비가 장보기 카드를 따라간다).
//   ⓓ 완료 폼 두 곳이 결제수단 칸(PayMethodField)을 세우고 고른 값(pay.payload)을 완료 액션에 싣는다.
//   ⓔ verify:fast 등록 · check-settle-status-canon 의 쓰는 파일 명단에 두 액션 파일이 있다.
//
// 실행: node scripts/check-work-expense-paymethod.mjs
import { readFileSync } from 'node:fs'

const fails = []
const read = f => readFileSync(f, 'utf8')
// 주석을 공백으로 바꾼다(주석 속 예시가 통과·위반으로 잡히지 않게). '://' 는 URL 이라 남긴다.
const strip = s => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, pre) => pre + ' '.repeat(m.length - pre.length))

/** export async function 이름( 부터 다음 최상위 export 직전까지. 못 찾으면 null. */
function bodyOf(src, name) {
  const at = src.search(new RegExp(`^export\\s+async\\s+function\\s+${name}\\(`, 'm'))
  if (at < 0) return null
  const next = src.indexOf('\nexport ', at + 1)
  return next < 0 ? src.slice(at) : src.slice(at, next)
}

/** open 위치의 여는 괄호와 짝인 닫는 괄호. 문자열은 건너뛴다. */
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
/** 몸통 안 expense.<op>( 호출들의 인자 글자. */
function callsOf(body, op) {
  const out = []
  for (const m of body.matchAll(new RegExp(`\\.expense\\.${op}\\(`, 'g'))) {
    const open = m.index + m[0].length - 1
    const close = matchClose(body, open)
    out.push(close < 0 ? null : body.slice(open + 1, close))
  }
  return out
}

// ⓐ 정본
{
  const f = 'lib/workPayDefault.ts'
  const s = strip(read(f))
  if (!/^import 'server-only'/m.test(s)) fails.push(`ⓐ ${f} 가 server-only 가 아니다(화면이 기본값 규칙을 직접 부를 수 있다)`)
  const def = bodyOf(s, 'defaultPayMethodFor') ?? ''
  const iV = def.search(/where:\s*\{\s*propertyId,\s*vendor,/), iC = def.search(/where:\s*\{\s*propertyId,\s*category:\s*opts\.category,/), iF = def.search(/return fallbackPay\(db, propertyId\)/)
  if (!(iV >= 0 && iC > iV && iF > iC)) fails.push(`ⓐ ${f} defaultPayMethodFor 의 차례가 같은 업체 → 같은 카테고리 → 영업장 목록 첫 값이 아니다(운영자 승인 결정 3)`)
  if (!/isShipping:\s*false,\s*payMethod:\s*\{\s*not:\s*null\s*\}/.test(def)) fails.push(`ⓐ ${f} 직전 지출을 고를 때 배송비 줄·결제수단 빈 줄을 안 거른다`)
  const fb = s.slice(s.indexOf('async function fallbackPay'), s.indexOf('export async function defaultPayMethodFor'))
  if (!/effectivePayMethods\(parseOptionList\('paymentMethods'/.test(fb)) fails.push(`ⓐ ${f} 영업장 목록 첫 값이 지출 폼과 같은 선택지 정본(effectivePayMethods)에서 오지 않는다`)
  const res = bodyOf(s, 'resolveWorkPay') ?? ''
  if (!res) fails.push(`ⓐ ${f} 에서 resolveWorkPay 를 못 찾았다`)
  if (!/financialAccount\.findFirst\(\{\s*where:\s*\{\s*id:\s*input\.financialAccountId,\s*propertyId\s*\}/.test(res)) fails.push(`ⓐ ${f} resolveWorkPay 가 결제 계정을 영업장 범위로 읽지 않는다(남의 영업장 카드가 걸린다)`)
  if (!/financeName:\s*accName\(acc\)/.test(res) || /input\.financeName/.test(res)) fails.push(`ⓐ ${f} resolveWorkPay 가 표시명을 계정에서 다시 짓지 않는다(화면 글자를 믿는다)`)
  if (!/if \(!method\) return \{ ok: true, pay: await defaultPayMethodFor\(/.test(res)) fails.push(`ⓐ ${f} resolveWorkPay 가 값 없이 온 저장을 기본값 규칙으로 채우지 않는다(null 이 남는다)`)
}

// ⓑ 쓰기 함수
const WRITERS = [
  ['app/(app)/room-manage/workActions.ts', 'completeRoomWork'],
  ['app/(app)/room-manage/cleaningActions.ts', 'completeCleaning'],
  // 한 건 수정(2026-10-27 2단계)도 걸린 지출을 고치거나 새로 만든다.
  ['app/(app)/room-manage/workActions.ts', 'updateRoomWork'],
  ['app/(app)/room-manage/cleaningActions.ts', 'updateCleaning'],
]
for (const [file, fn] of WRITERS) {
  const body = bodyOf(strip(read(file)), fn)
  if (body == null) { fails.push(`ⓑ ${file} 에서 ${fn} 을 못 찾았다(이름이 바뀌었으면 이 그물도 고칠 것)`); continue }
  if (!/resolveWorkPay\(prisma, propertyId,/.test(body)) fails.push(`ⓑ ${fn} 이 결제수단 정본(resolveWorkPay)을 안 부른다`)
  if (/'신용카드'\s*\?|===\s*'신용카드'/.test(body)) fails.push(`ⓑ ${fn} 에 날것 정산 판정('신용카드')이 있다. lib/settleStatus 를 쓸 것`)
  const creates = callsOf(body, 'create')
  if (creates.length === 0) fails.push(`ⓑ ${fn} 에서 지출 생성을 못 찾았다(그물이 낡았다)`)
  for (const c of creates) {
    if (c == null) { fails.push(`ⓑ ${fn} expense.create 괄호를 못 읽었다`); continue }
    for (const k of ['payMethod: pay.payMethod', 'financialAccountId: pay.financialAccountId', 'financeName: pay.financeName', 'settleStatus: settleStatusForNew(pay.payMethod)']) {
      if (!c.includes(k)) fails.push(`ⓑ ${fn} 의 expense.create 에 '${k}' 가 없다(결제수단 빈 지출·카드 정산 누락)`)
    }
  }
  for (const c of callsOf(body, 'update')) {
    if (c == null) { fails.push(`ⓑ ${fn} expense.update 괄호를 못 읽었다`); continue }
    if (/payMethod/.test(c) && !/settleStatusForEdit\(/.test(c)) fails.push(`ⓑ ${fn} 의 expense.update 가 결제수단을 바꾸면서 정산상태를 고치는 경로 정본(settleStatusForEdit)을 안 탄다`)
  }
  // 한 건 고치는 갈래가 data 를 따로 모으는 꼴(workActions next 객체)이면 그 객체 쪽을 본다.
  if (/next\.payMethod = pay\.payMethod/.test(body) && !/next\.settleStatus = settleStatusForEdit\(/.test(body)) fails.push(`ⓑ ${fn} 이 걸린 지출의 결제수단을 바꾸면서 정산상태를 정본으로 다시 정하지 않는다`)
}

// ⓒ 화면 조회
{
  const f = 'app/(app)/room-manage/workPayActions.ts'
  const s = strip(read(f))
  const b = bodyOf(s, 'getWorkPayOptions') ?? ''
  if (!b) fails.push(`ⓒ ${f} 에서 getWorkPayOptions 를 못 찾았다`)
  if (!/await requireEdit\(\)/.test(b)) fails.push(`ⓒ getWorkPayOptions 가 편집 권한을 안 본다(결제 계정 이름이 읽기 역할에 보인다)`)
  if (!/workPayDefaults\(prisma, propertyId,/.test(b)) fails.push(`ⓒ getWorkPayOptions 가 기본값을 정본 표(workPayDefaults)에서 내지 않는다`)
  for (const g of ['app/(app)/room-manage/workActions.ts', 'app/(app)/room-manage/cleaningActions.ts', f, 'components/work/useWorkPay.ts', 'components/work/RoomWorkRowBody.tsx', 'components/cleaning/CleaningRowBody.tsx']) {
    if (/getLastPayDefaults/.test(strip(read(g)))) fails.push(`ⓒ ${g} 가 지출 화면의 직전 지출 기본값(getLastPayDefaults)을 쓴다(운영자 승인 결정 3 은 같은 업체·같은 카테고리)`)
  }
}

// ⓓ 완료 폼
for (const [f, call] of [
  ['components/work/RoomWorkRowBody.tsx', /const args = \{ id: r\.id, doneDate, performer, performerName, cost: Number\(cost \|\| 0\), \.\.\.\(payAsked \? pay\.payload : \{\}\) \}/],
  ['components/cleaning/CleaningRowBody.tsx', /completeCleaning\(\{ id: r\.id, doneDate, performer, performerName, cost: c, fromCleaningFund: fromFund, \.\.\.\(c > 0 \? pay\.payload : \{\}\) \}\)/],
]) {
  const s = strip(read(f))
  if (!/<PayMethodField dense /.test(s)) fails.push(`ⓓ ${f} 완료 폼에 결제수단 칸이 없다`)
  if (!call.test(s)) fails.push(`ⓓ ${f} 완료 폼이 고른 결제수단(pay.payload)을 완료 액션에 안 싣는다`)
  if (!/pay\.reset\(/.test(s)) fails.push(`ⓓ ${f} 완료 폼을 열 때 걸린 지출의 결제수단으로 처음 값을 안 맞춘다`)
}

// ⓔ 등록
{
  const pkg = JSON.parse(read('package.json'))
  if (!pkg.scripts['verify:fast'].includes('node scripts/check-work-expense-paymethod.mjs')) fails.push('ⓔ package.json verify:fast 에 이 그물이 없다')
  const canon = read('scripts/check-settle-status-canon.mjs')
  for (const f of ['app/(app)/room-manage/workActions.ts', 'app/(app)/room-manage/cleaningActions.ts']) {
    if (!canon.includes(`'${f}'`)) fails.push(`ⓔ check-settle-status-canon 의 쓰는 파일 명단에 ${f} 가 없다`)
  }
}

console.log(`[작업·청소 지출 결제수단] 축 ⓐ 정본 · ⓑ 쓰기 ${WRITERS.length}곳 · ⓒ 화면 조회 · ⓓ 완료 폼 · ⓔ 등록 / 위반 ${fails.length}건`)
for (const f of fails) console.log('  - ' + f)
process.exit(fails.length ? 1 : 0)
