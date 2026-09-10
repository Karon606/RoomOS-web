// 요청·컴플레인 '완료 적용취소'의 진리표 + 배선 그물 — 되돌린 뒤 메모가 남는가, 두 화면이 같은 말을 하는가.
//
// 왜 있는가(신고 2026-09-09). 호실 › 입주자 정보 › 요청·컴플레인 탭에서 컴플레인을 완료로 눌렀는데
// 되돌릴 자리가 없었다. /requests 에는 토스트 액션과 원위치 버튼이 둘 다 있었으니, 같은 상태를 바꾸는
// 두 화면 중 한쪽만 §16 을 지키고 있던 것이다. 급소는 셋이다.
//   ① 되돌렸다 다시 완료할 때 **처리 메모가 증발**하는 것. 완료 액션이 memo 를 안 받으면 기존 메모를
//      null 로 덮었다. 되돌리기가 생기면 이 3단 걸음이 실제로 밟히므로 이 그물이 먼저 필요하다.
//   ② 두 화면이 **다른 말**을 하는 것. 같은 동작에 '완료 해제'와 '적용취소'가 섞이면 §16 단일 라벨이 깨진다.
//   ③ 완료는 편집 권한을 요구하는데 **되돌리기는 안 요구**하는 비대칭. 뷰어가 상태를 되돌릴 수 있었다.
//
// 그물은 주석을 안 본다. 배선 검사는 소스에서 주석을 먼저 걷어내고 사실만 찾는다 —
// "적용취소가 있다" 고 적힌 주석이 검사를 통과시키면 그물이 아니라 장식이다.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROLE_LABEL, type Role } from '../lib/role-types'

const ROOT = join(__dirname, '..')
let failed = 0
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { console.log(`  PASS  ${name}`) } else { failed++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}

const src = (p: string) => readFileSync(join(ROOT, p), 'utf8')
/** 주석을 걷은 소스 — 설명 글자가 배선 검사를 통과시키지 못하게 한다. */
const code = (p: string) => src(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')

const TAB = 'components/entity-modal/widgets/TenantRequestsTab.tsx'
const LIST = 'app/(app)/requests/RequestsClient.tsx'
const ACTIONS = 'app/(app)/tenants/actions.ts'

/** 액션 파일에서 함수 하나의 몸통만 잘라 낸다 — 파일 어딘가의 requireEdit 이 대신 통과하지 않게. */
const fnBody = (source: string, name: string): string => {
  const at = source.indexOf(`export async function ${name}(`)
  if (at < 0) return ''
  const next = source.indexOf('\nexport ', at + 1)
  return source.slice(at, next < 0 ? source.length : next)
}

// ── 진리표가 재는 규칙 ────────────────────────────────────────────────
// 완료 액션이 tenantRequest.update 에 싣는 data 는 이 규칙 하나다. undefined 는 '안 건드림',
// 그 외(빈 문자열 포함)는 '이 값으로 덮음'. ⑤ 배선 검사가 소스의 그 줄이 이 규칙과 같은지 본다.
type Row = { resolvedAt: Date | null; resolutionMemo: string | null }
const resolveData = (memo?: string): Partial<Row> => ({
  resolvedAt: new Date('2026-09-09T00:00:00Z'),
  ...(memo === undefined ? {} : { resolutionMemo: memo.trim() || null }),
})
const unresolveData = (): Partial<Row> => ({ resolvedAt: null })
const apply = (row: Row, data: Partial<Row>): Row => ({ ...row, ...data })

const FRESH: Row = { resolvedAt: null, resolutionMemo: null }

console.log('\n① 진리표 — 완료 › 되돌림 › 재완료 3단에서 처리 메모가 남는가')
{
  // /requests 에서 메모를 적어 완료하고, 잘못 눌렀다며 되돌리고, 탭에서 다시 완료한다.
  const step1 = apply(FRESH, resolveData('보일러 교체 완료'))
  ok('1단 완료: 메모가 적힌다', step1.resolutionMemo === '보일러 교체 완료' && step1.resolvedAt !== null)

  const step2 = apply(step1, unresolveData())
  ok('2단 되돌림: resolvedAt 만 비고 메모는 남는다',
    step2.resolvedAt === null && step2.resolutionMemo === '보일러 교체 완료')

  const step3 = apply(step2, resolveData())          // 탭의 완료 — memo 를 안 싣는다
  ok('3단 재완료: memo 없는 호출은 기존 메모를 안 지운다',
    step3.resolutionMemo === '보일러 교체 완료', `실제 ${JSON.stringify(step3.resolutionMemo)}`)
  ok('3단 재완료: 완료 표시는 다시 선다', step3.resolvedAt !== null)

  // 되돌림 › 재완료를 여러 번 반복해도 같아야 한다 — 한 번만 버티는 규칙은 규칙이 아니다.
  let loop = step3
  for (let i = 0; i < 3; i++) loop = apply(apply(loop, unresolveData()), resolveData())
  ok('되돌림·재완료를 반복해도 메모가 그대로', loop.resolutionMemo === '보일러 교체 완료')
}

console.log('\n② 진리표 — 메모를 명시적으로 비우면 비워지는가')
{
  const had: Row = { resolvedAt: new Date('2026-09-01T00:00:00Z'), resolutionMemo: '이전 메모' }
  ok("빈 문자열은 지운다", apply(had, resolveData('')).resolutionMemo === null)
  ok('공백만 있는 문자열도 지운다', apply(had, resolveData('   ')).resolutionMemo === null)
  ok('새 메모는 옛 메모를 덮는다', apply(had, resolveData('새 메모')).resolutionMemo === '새 메모')
  ok('앞뒤 공백은 걷힌다', apply(had, resolveData('  정리함  ')).resolutionMemo === '정리함')
  // undefined 와 '' 가 갈리지 않으면 ① 이 통과해도 비우기 경로가 죽는다. 둘이 다름을 못박는다.
  ok("undefined 와 '' 는 다른 뜻이다",
    apply(had, resolveData()).resolutionMemo === '이전 메모' && apply(had, resolveData('')).resolutionMemo === null)
  ok('메모 없이 처음 완료하면 메모는 비어 있다', apply(FRESH, resolveData()).resolutionMemo === null)
}

console.log('\n③ 진리표 — 뷰어 권한이 되돌리기에서 거부되는가')
{
  // lib/role 은 server-only 를 끌어와 노드에서 못 읽는다. 규칙만 여기 두고, 바로 아래에서
  // lib/role.ts 소스가 정말 같은 규칙인지 대조한다 — 규칙이 갈리면 그 줄이 붉게 선다.
  const canEdit = (role: Role): boolean => role === 'OWNER' || role === 'MANAGER'
  const roleSrc = code('lib/role.ts')
  ok('lib/role 의 canEdit 이 이 규칙과 같다',
    /export function canEdit\(role: Role\): boolean \{\s*return role === 'OWNER' \|\| role === 'MANAGER'/.test(roleSrc))
  ok('requireEdit 은 canEdit 이 아니면 던진다',
    /export async function requireEdit\(\)[\s\S]{0,200}if \(!canEdit\(role\)\) throw/.test(roleSrc))

  const allowed: Role[] = ['OWNER', 'MANAGER']
  const denied: Role[] = ['STAFF', 'LIMITED_STAFF']
  for (const r of allowed) ok(`${ROLE_LABEL[r]} 는 되돌릴 수 있다`, canEdit(r))
  for (const r of denied) ok(`${ROLE_LABEL[r]} 는 거부된다`, !canEdit(r))
  ok('역할은 넷이고 그중 둘만 편집이다',
    (['OWNER', 'MANAGER', 'STAFF', 'LIMITED_STAFF'] as Role[]).filter(canEdit).length === 2)
  // 완료와 되돌리기가 같은 관문을 지나야 대칭이다 — 한쪽만 열려 있으면 뷰어가 상태를 바꾼다.
  const a = code(ACTIONS)
  const resolveFn = fnBody(a, 'resolveTenantRequest')
  const unresolveFn = fnBody(a, 'unresolveTenantRequest')
  ok('완료 액션 몸통에 requireEdit 이 있다', /await requireEdit\(\)/.test(resolveFn))
  ok('되돌리기 액션 몸통에도 requireEdit 이 있다', /await requireEdit\(\)/.test(unresolveFn),
    '되돌리기가 편집 권한을 안 본다')
  ok('되돌리기도 영업장 격리 관문을 지난다', /await getPropertyId\(\)/.test(unresolveFn))
}

console.log('\n④ 배선 그물 — 완료를 부르는 두 화면이 모두 되돌릴 자리를 갖는가')
{
  for (const [name, p] of [['입주자 정보 탭', TAB], ['/requests', LIST]] as const) {
    const s = code(p)
    ok(`${name}: 완료 액션을 부른다`, /resolveTenantRequest\(/.test(s))
    ok(`${name}: 기존 되돌리기 액션을 import 한다`, /\bunresolveTenantRequest\b/.test(s))
    ok(`${name}: 되돌리기를 실제로 호출한다`, /unresolveTenantRequest\(/.test(s))
    // §16 진입점 1 — 완료 토스트에 액션이 붙는다(액션이 있으면 pushToast 가 6초를 고른다).
    ok(`${name}: 완료 토스트에 적용취소 액션이 붙는다`,
      /action:\s*\{\s*label:\s*'적용취소'/.test(s))
    // §16 진입점 2 — 토스트가 사라져도 원위치에 자리가 남는다.
    ok(`${name}: 원위치 버튼이 btn-subtle sm 이다`,
      /<Btn variant="subtle" size="sm"[\s\S]{0,400}완료 적용취소/.test(s))
    // 아이콘은 공용 RotateCcw 하나다 — 인라인 SVG 를 다시 손으로 베끼면 여기서 걸린다.
    // (기존 세 자리는 이 그물의 범위가 아니다. 새로 생긴 두 화면만 공용을 탄다.)
    ok(`${name}: 공용 RotateCcw 를 import 한다`,
      /import \{ RotateCcw \} from '@\/components\/doc\/FieldOverrideListModal'/.test(s))
    ok(`${name}: 원위치 버튼 안에서 그 아이콘을 쓴다`,
      /<Btn variant="subtle" size="sm"[\s\S]{0,300}<RotateCcw \/>[\s\S]{0,120}완료 적용취소/.test(s))
    ok(`${name}: 되돌리기 아이콘을 인라인 SVG 로 베끼지 않았다`,
      !/M3 3v5h5/.test(s))
    ok(`${name}: 옛 라벨이 안 남아 있다`, !s.includes('완료 해제') && !s.includes('되돌리기<'))
    // §16 Do — 적용취소 후에도 결과 토스트.
    ok(`${name}: 되돌린 뒤 결과 토스트가 선다`, /pushToast\('info', '완료를 적용취소했습니다/.test(s))
    // 조용한 실패 금지 — 결과를 안 보고 넘어가면 권한 거부가 무반응으로 보인다.
    ok(`${name}: 완료 실패를 토스트로 알린다`,
      /resolveTenantRequest\([\s\S]{0,200}if \(!res\.ok\) \{ pushToast\('error'/.test(s))
    ok(`${name}: 되돌리기 실패도 토스트로 알린다`,
      /unresolveTenantRequest\([\s\S]{0,200}if \(!res\.ok\) \{ pushToast\('error'/.test(s))
  }
}

console.log('\n⑤ 배선 그물 — 두 화면이 문자 단위로 같은 문장을 쓰는가')
{
  const SENTENCES = ['완료로 처리했습니다', '완료를 적용취소했습니다 · 미처리로 복귀', '완료 적용취소']
  const tab = code(TAB)
  const list = code(LIST)
  for (const line of SENTENCES) {
    ok(`'${line}' 가 입주자 정보 탭에 있다`, tab.includes(line))
    ok(`'${line}' 가 /requests 에 있다`, list.includes(line))
  }
  // §29 — 부연은 가운뎃점. 괄호 부연·em dash·느낌표가 되살아나면 여기서 걸린다.
  ok('되돌림 문안에 괄호 부연이 없다', !/완료를 적용취소했습니다\s*\(/.test(tab + list))
  ok('되돌림 문안에 em dash 가 없다', !SENTENCES.some(s => s.includes('—')))
  // 한 동작에 두 동사 금지 — 버튼이 '적용취소'면 결과 토스트도 같은 동사여야 한다.
  // 이 화면의 다른 적용취소(요청 수정 되돌리기)는 이 그물의 범위가 아니라 '완료를' 로 좁힌다.
  ok('되돌림 토스트가 버튼과 같은 동사를 쓴다', !/완료를 (되돌렸습니다|해제했습니다)/.test(tab + list))

  // 새 서버 액션이 생기면 권한·격리 규칙이 한 벌 더 생긴다. 그 자리를 아예 막는다.
  const a = code(ACTIONS)
  const newAction = /export async function \w*(undoTenantRequest|revertTenantRequest|reopenTenantRequest)\w*/i
  ok('되돌리기 전용 새 액션이 안 생겼다', !newAction.test(a))

  // 완료 액션의 data 가 ① 의 규칙과 같은 문법인가 — 진리표가 재는 것이 실제 소스인지 잇는다.
  const resolveFn = fnBody(a, 'resolveTenantRequest')
  ok('완료 액션은 memo === undefined 일 때 메모 칸을 안 싣는다',
    /memo === undefined \? \{\} : \{ resolutionMemo: memo\.trim\(\) \|\| null \}/.test(resolveFn),
    '기존 메모를 null 로 덮는 옛 문법이 남았다')
  ok('되돌리기는 resolvedAt 만 null 로 둔다(메모를 안 건드린다)',
    /data:\s*\{\s*resolvedAt:\s*null\s*\}/.test(fnBody(a, 'unresolveTenantRequest')))
}

console.log('\n⑥ 배선 그물 — 44px 버튼이 들어온 행이 좁은 폰에서 안 넘치는가')
{
  // 웹디자이너 차단 판정(2026-09-10). 처리 이력 행에 44px Btn 이 서면서 정렬·넘침 규칙이 바뀌었다.
  // 넘침 자체는 소스로 못 재지만 그 원인이 된 클래스 넷은 잴 수 있다 — 되돌아가면 여기서 선다.
  const tab = code(TAB)
  ok('이력 행 컨테이너가 items-center 다 (10.5px 메타가 버튼 윗변에 안 붙는다)',
    /className="flex items-center justify-between gap-2 mb-1"[\s\S]{0,400}>완료</.test(tab),
    'items-start 로 되돌아갔거나 gap 이 갈렸다')
  ok('왼쪽 메타가 flex-wrap 이다 (두 자리 날짜에 줄을 바꾼다)',
    /className="flex flex-wrap items-center[\s\S]{0,300}>완료</.test(tab))
  ok('왼쪽 메타에 min-w-0 이 있다 (오른쪽 shrink-0 을 밀어내지 않는다)',
    /className="flex flex-wrap items-center[^"]*min-w-0[\s\S]{0,300}>완료</.test(tab))
  // §10 터치 타겟 — 옆 Btn 이 44px 인데 삭제만 20px 이면 손끝이 갈린다. 아이콘은 11px 그대로.
  ok('이력 행 삭제 히트가 44px 다', /className="shrink-0 w-11 h-11 -my-3 -mr-2 /.test(tab))
  ok('그 삭제 아이콘은 11px 그대로다',
    /w-11 h-11[\s\S]{0,300}<svg width="11" height="11"/.test(tab))
  // /requests 의 나란한 액션이 같은 정본을 탄다 — raw 40px 텍스트 버튼이 남으면 높이가 갈린다.
  const list = code(LIST)
  // [^>]* 는 못 쓴다 — onClick 의 화살표(=>)에 걸려 실제로 맞는 마크업을 놓친다.
  ok('/requests 의 수정 버튼도 정본 Btn 이다',
    /<Btn variant="ghost" size="sm"[\s\S]{0,150}?>수정<\/Btn>/.test(list))
  ok('/requests 처리 행에 raw 40px 텍스트 버튼이 안 남았다', !/min-h-\[40px\][\s\S]{0,300}>수정</.test(list))
}

console.log(failed === 0 ? '\n전부 통과\n' : `\n${failed}건 실패\n`)
process.exit(failed === 0 ? 0 : 1)
