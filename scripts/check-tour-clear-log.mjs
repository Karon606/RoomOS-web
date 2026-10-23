// 투어일 비움 기록 감지망. 투어일을 비우는 저장이 상태 이력에 기록을 남기는지 본다. 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가(2026-10-23 운영자 승인 '추천대로', (가)안). '문의'로 바꿔 저장하면 투어일·투어 시각이 영구히 지워지는데 기록이
// 어디에도 남지 않았다(입실 취소 49건 중 18건이 투어일 보유). 비우는 저장마다 상태 이력 memo 에 '투어일 2026-09-28 비움' 을
// 남기고, 이력 화면이 그 메모를 보인다. 정본은 lib/tourClearLog 다.
//
// 축 넷.
//   ⓐ 쓰기 배선. 앱·lib 에서 투어일을 쓰는 자리(`tourDate: … new Date(` · `tourDate: null` · 직접 SQL)는 등록(addTenant, 새로 만들 뿐
//      비우지 않는다)이거나 그 함수가 tourClearedMemo 를 부른다. 새 쓰기 자리가 생기면 여기서 붉게 선다.
//   ⓑ 입주자 수정. 비우기 전 값을 읽고(select tourDate·tourTime), 상태가 그대로면 같은 상태 행을 만들고(createTourClearedLog),
//      상태가 바뀌면 그 전이 행 하나에 memo 를 싣는다(행 둘 금지).
//   ⓒ 화면. 이력 조회가 memo 를 읽어 내리고, 위젯이 statusLogMemoText 로 그린다. 메모만 있는 같은 상태 행은 그 메모가 제목이다.
//   ⓓ 오인 방지. 메모 행은 사유를 쓰지 않는다(reason 칸 없음). '최근 입실 취소 행'을 읽는 자리는 같은 상태 행을 건너뛴다.
//
// 실행: node scripts/check-tour-clear-log.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const strip = s => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, m => m.replace(/[^\n]/g, ''))
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')
const read = f => strip(readFileSync(f, 'utf8'))
const violations = []
const need = (ok, msg) => { if (!ok) violations.push(msg) }

// 최상위 함수 머리(내보내든 안 내보내든). 본문은 머리부터 다음 최상위 머리·export 앞까지다.
const TOP_FN = /^(?:export )?(?:async )?function (\w+)\(/gm
const fnBody = (src, name) => {
  const at = src.search(new RegExp(`^(?:export )?(?:async )?function ${name}\\(`, 'm'))
  if (at < 0) return null
  const rest = src.slice(at + 1)
  const next = rest.search(/\n(?:export |(?:async )?function )/)
  return src.slice(at, next < 0 ? undefined : at + 1 + next)
}

// ⓐ 쓰기 배선
const walk = dir => readdirSync(dir).flatMap(n => {
  const p = path.join(dir, n)
  if (/ 2(\.[^/]*)?$/.test(n) || n === 'node_modules') return []
  return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : []
})
// 새 계약을 만드는 폼 읽기(addTenant·addLeaseToTenant 공용). 만들 뿐 비우지 않는다.
const CREATE_ONLY = new Set(['readLeaseFields'])
const WRITE = /(?<![.\w])tourDate\s*:\s*(null\b|[^,\n]*new Date\()/g
for (const f of [...walk('app'), ...walk('lib')]) {
  if (/\.tsx$/.test(f)) continue   // 화면 파일은 DB 에 쓰지 않는다
  const s = read(f)
  need(!/"tourDate"\s*=|\btour_date\s*=/.test(s), `${f}: 직접 SQL 로 투어일을 쓴다. lib/tourClearLog 를 거치지 않는 쓰기다.`)
  for (const m of s.matchAll(WRITE)) {
    const before = s.slice(0, m.index)
    const fn = [...before.matchAll(TOP_FN)].at(-1)?.[1] ?? '(최상위)'
    if (CREATE_ONLY.has(fn)) continue
    const body = fnBody(s, fn) ?? ''
    need(/tourClearedMemo\(/.test(body), `${f}: ${fn} 이 투어일을 쓰는데 tourClearedMemo 를 부르지 않는다. 비우는 저장이 이력에 안 남는다.`)
  }
}

// ⓑ 입주자 수정
{
  const f = 'app/(app)/tenants/actions.ts'
  const body = fnBody(read(f), 'updateTenant') ?? ''
  need(/tourDate: true, tourTime: true/.test(body), `${f}: updateTenant 가 비우기 전 투어일·시각을 읽지 않는다.`)
  need(/const tourMemo = tourClearedMemo\(currentLease, tourDate\)/.test(body), `${f}: updateTenant 가 폼 투어일 값으로 메모를 만들지 않는다.`)
  need(/if \(status === prevStatus && tourMemo\) \{\s*await createTourClearedLog\(prisma, \{ tenantId, leaseTermId, propertyId, status, changedById: user\.sub, memo: tourMemo \}\)/.test(body),
    `${f}: 상태가 그대로인 투어일 비움 저장이 같은 상태 행을 만들지 않는다.`)
  const create = body.match(/if \(status !== prevStatus\) \{[\s\S]*?tenantStatusLog\.create\(\{[\s\S]*?\n    \}\)/)
  need(!!create && /\.\.\.\(tourMemo \? \{ memo: tourMemo \} : \{\}\)/.test(create[0]), `${f}: 상태가 바뀌는 저장의 전이 행에 투어일 메모를 싣지 않는다.`)
  need((body.match(/createTourClearedLog\(/g) ?? []).length === 1, `${f}: updateTenant 가 같은 상태 행을 두 번 이상 만들 수 있다(상태 동반 저장은 행 하나).`)
}

// ⓒ 화면
{
  const f = 'app/(app)/rooms/actions.ts'
  const body = fnBody(read(f), 'getTenantStatusHistory') ?? ''
  need(/reason: true, memo: true/.test(body) && /memo: r\.memo/.test(body), `${f}: 이력 조회가 memo 를 읽어 내리지 않는다(화면 어디에도 안 보인다).`)
  const w = 'components/entity-modal/widgets/TenantStatusHistory.tsx'
  const s = read(w)
  need(/const memoOnly = \(it: HistItem\) => it\.fromStatus === it\.toStatus && !it\.isCreated && !it\.reason && !!tourClearedValueText\(it\.memo\)/.test(s), `${w}: 메모만 있는 같은 상태 행 판정이 없다.`)
  need(/memoOnly\(it\) \? '투어일 비움'/.test(s), `${w}: 메모만 있는 같은 상태 행이 '투어 예정에서 투어 예정으로' 로 그려진다.`)
  need(/const memoLine = memoOnly\(item\) \? `비운 투어일 \$\{tourClearedValueText\(item\.memo\)\}` : statusLogMemoText\(item\.memo\)/.test(s), `${w}: 메모 줄이 지운 값을 안 보이거나 제목과 같은 말을 되풀이한다.`)
  need(/\{memoLine && \([\s\S]*?text-\[0\.65625rem\] text-\[var\(--warm-muted\)\]">\{memoLine\}/.test(s), `${w}: 메모 줄이 사유 줄 문법(10.5px · --warm-muted)이 아니다.`)
}

// ⓓ 오인 방지
{
  const f = 'lib/tourClearLog.ts'
  const s = read(f)
  const c = s.match(/export async function createTourClearedLog[\s\S]*?\n\}\n/)?.[0] ?? ''
  need(!!c && !/reason/.test(c) && /memo: row\.memo/.test(c), `${f}: 같은 상태 행이 사유(reason)를 쓰거나 메모를 안 쓴다. 이어받기·이름 변경이 사유로 읽는다.`)
  need(/fromStatus: row\.status,\s*toStatus: row\.status,/.test(c), `${f}: 같은 상태 행이 아니다.`)
  const t = read('app/(app)/tenants/actions.ts')
  need(/\{ toStatus: 'CANCELLED', fromStatus: \{ not: 'CANCELLED' \} \}/.test(t), `app/(app)/tenants/actions.ts: 목록 조회가 입실 취소 그대로 행을 최신 취소 행으로 잡는다(취소 단계가 사라진다).`)
  const cal = read('app/api/calendar/[token]/route.ts')
  need(/toStatus: 'CANCELLED', fromStatus: \{ not: 'CANCELLED' \}/.test(cal), `app/api/calendar/[token]/route.ts: 투어 피드가 입실 취소 그대로 행을 최근 취소 전이로 읽는다.`)
}

console.log(`[투어일 비움 기록] 축 ⓐ 쓰기 배선 · ⓑ 입주자 수정 · ⓒ 화면 · ⓓ 오인 방지 / 위반 ${violations.length}건`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error('  투어일을 비우는 저장은 상태 이력에 비우기 전 값을 남긴다(lib/tourClearLog).')
  process.exit(1)
}
