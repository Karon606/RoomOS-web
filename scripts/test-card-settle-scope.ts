// 카드 정산 적용취소의 진리표 + 배선 그물 — 남의 영업장 건을 못 건드리는가, 건별로 무를 자리가 있는가.
//
// 왜 있는가. settleCardExpenses·unsettleExpenses 의 where 에 propertyId 가 없었다. 지출 id 만 맞으면
// 다른 영업장의 정산 상태가 그대로 뒤집혔다. settleStatus 는 표시 플래그라 돈은 안 움직이지만,
// 남의 영업장 화면에서 정산 완료가 미정산으로 되돌아 앉는 것은 그 자체가 사고다(§4 멀티테넌트).
//
// 그리고 §16. 그룹 전체 취소만 있어 한 건을 잘못 넣은 정산을 무르려면 그 달 청구분을 통째로 풀어야 했다.
// 건별 적용취소가 진입점 2 로 서고, 정산 처리·적용취소 양쪽 토스트가 진입점 1 로 선다.
//
// 그물은 주석을 안 본다 — 배선 검사는 소스에서 주석을 먼저 걷어내고 사실만 찾는다.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')
let failed = 0
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { console.log(`  PASS  ${name}`) } else { failed++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}

const src = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const code = (p: string) => src(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')

/** 액션 파일에서 함수 하나의 몸통만 잘라 낸다 — 파일 어딘가의 propertyId 가 대신 통과하지 않게. */
const fnBody = (source: string, name: string): string => {
  const at = source.indexOf(`export async function ${name}(`)
  if (at < 0) return ''
  const next = source.indexOf('\nexport ', at + 1)
  return source.slice(at, next < 0 ? source.length : next)
}

// ── 진리표 ──────────────────────────────────────────────────────────
// updateMany 의 where 를 그대로 옮긴 순수 술어. 액션 몸통이 갈리면 ③ 의 배선 검사가 먼저 붉게 선다.
type Status = 'SETTLED' | 'UNSETTLED'
type Row = { id: string; propertyId: string; settleStatus: Status }

const settleWhere = (r: Row, ids: string[], propertyId: string) =>
  ids.includes(r.id) && r.propertyId === propertyId && r.settleStatus === 'UNSETTLED'
const unsettleWhere = (r: Row, ids: string[], propertyId: string) =>
  ids.includes(r.id) && r.propertyId === propertyId

const apply = (
  rows: Row[], ids: string[], propertyId: string,
  where: (r: Row, ids: string[], p: string) => boolean, next: Status,
): Row[] => rows.map(r => (where(r, ids, propertyId) ? { ...r, settleStatus: next } : r))

const statusOf = (rows: Row[], id: string) => rows.find(r => r.id === id)!.settleStatus

const HERE = 'prop-제기역'
const THERE = 'prop-남의집'

console.log('\n① 진리표 — 내 영업장 건은 정산되고 무를 수 있는가')
{
  const rows: Row[] = [{ id: 'e1', propertyId: HERE, settleStatus: 'UNSETTLED' }]
  const settled = apply(rows, ['e1'], HERE, settleWhere, 'SETTLED')
  ok('미정산 건이 정산 완료가 된다', statusOf(settled, 'e1') === 'SETTLED')
  const back = apply(settled, ['e1'], HERE, unsettleWhere, 'UNSETTLED')
  ok('적용취소하면 미정산으로 돌아온다', statusOf(back, 'e1') === 'UNSETTLED')
  // 이미 정산된 건을 다시 정산으로 밀지 않는 종전 규칙 — propertyId 를 넣으면서 죽으면 안 된다.
  ok('이미 정산된 건은 정산이 다시 안 건드린다',
    apply(settled, ['e1'], HERE, settleWhere, 'SETTLED')[0].settleStatus === 'SETTLED')
}

console.log('\n② 진리표 — 다른 영업장의 지출 id 를 넘기면 아무것도 안 바뀌는가')
{
  const rows: Row[] = [
    { id: 'mine', propertyId: HERE, settleStatus: 'SETTLED' },
    { id: 'theirs-unsettled', propertyId: THERE, settleStatus: 'UNSETTLED' },
    { id: 'theirs-settled', propertyId: THERE, settleStatus: 'SETTLED' },
  ]
  const afterSettle = apply(rows, ['theirs-unsettled'], HERE, settleWhere, 'SETTLED')
  ok('남의 미정산 건은 내 영업장에서 정산되지 않는다',
    statusOf(afterSettle, 'theirs-unsettled') === 'UNSETTLED')
  const afterUndo = apply(rows, ['theirs-settled'], HERE, unsettleWhere, 'UNSETTLED')
  ok('남의 정산 완료 건은 내 영업장에서 적용취소되지 않는다',
    statusOf(afterUndo, 'theirs-settled') === 'SETTLED')
  // 섞어 넘겨도 내 것만 바뀐다 — 목록 통째로 넘기는 그룹 처리가 그 경로다.
  const mixed = apply(rows, ['mine', 'theirs-settled'], HERE, unsettleWhere, 'UNSETTLED')
  ok('섞어 넘기면 내 영업장 건만 바뀐다',
    statusOf(mixed, 'mine') === 'UNSETTLED' && statusOf(mixed, 'theirs-settled') === 'SETTLED')
}

console.log('\n③ 배선 그물 — 액션 where 가 진리표와 같은 축을 쓰는가')
{
  const actions = code('app/(app)/finance/actions.ts')
  for (const name of ['settleCardExpenses', 'unsettleExpenses']) {
    const body = fnBody(actions, name)
    ok(`${name} 몸통이 있다`, body.length > 0)
    ok(`${name} 이 영업장 판정 정본을 부른다`, /await getPropertyId\(\)/.test(body))
    // [^}]* 는 못 쓴다 — id: { in: ids } 의 닫는 중괄호에서 멈춰 실제로 있는 propertyId 를 놓친다.
    ok(`${name} 의 where 에 propertyId 가 있다`, /where:\s*\{[\s\S]{0,120}?propertyId/.test(body))
    ok(`${name} 이 편집 권한을 먼저 본다`, /await requireEdit\(\)/.test(body))
  }
  ok('정산은 미정산 건만 민다는 종전 조건이 남아 있다',
    /settleStatus:\s*'UNSETTLED'/.test(fnBody(actions, 'settleCardExpenses')))
}

console.log('\n④ 배선 그물 — 건별 적용취소와 토스트가 §16 대로 서는가')
{
  const cs = code('app/(app)/card-settlement/CardSettlementClient.tsx')
  ok('행 액션 정본을 import 한다', /from '@\/components\/ui\/RowActionBtn'/.test(cs))
  ok("정산 완료 행에 '정산 적용취소' 가 선다",
    /<RowActionBtn[\s\S]{0,300}?정산 적용취소[\s\S]{0,40}?<\/RowActionBtn>/.test(cs))
  ok('건별 적용취소가 한 건만 넘긴다', /handleUnsettleOne\s*=\s*\(id: string\)\s*=>\s*undoSettle\(\[id\]\)/.test(cs))
  ok('적용취소 결과 토스트가 §16 형식이다', cs.includes('정산을 적용취소했습니다 · 미정산으로 복귀'))
  ok('적용취소 토스트에도 되돌릴 액션이 붙는다',
    /정산을 적용취소했습니다 · 미정산으로 복귀'[\s\S]{0,200}label: '적용취소'/.test(cs))
  ok('정산 처리 토스트에 적용취소 액션이 붙는다',
    /'정산 완료로 처리됨'[\s\S]{0,200}label: '적용취소'[\s\S]{0,80}undoSettle\(ids\)/.test(cs))
  // 라벨이 길어지면 행이 넘친다 — 넘침 신고 이력이 있는 자리라 폭 규칙을 고정한다.
  ok('행 라벨은 줄고 금액·버튼은 안 줄어든다',
    /className="min-w-0 truncate"/.test(cs) && /<RowActionBtn tone="neutral" className="shrink-0"/.test(cs))

  const fin = code('app/(app)/finance/FinanceClient.tsx')
  ok('지출 상세도 같은 라벨을 쓴다', /정산 적용취소/.test(fin))
  ok("지출 상세에 옛 라벨 '정산 취소' 가 안 남았다", !/>\s*정산 취소\s*</.test(fin))
}

console.log(failed === 0 ? '\n전부 통과\n' : `\n${failed}건 실패\n`)
process.exit(failed === 0 ? 0 : 1)
