// 자재 폐기 축 배선 감지 — 실행: node scripts/check-asset-disposal-wiring.mjs
//
// 왜 필요한가. 진리표(test-asset-disposal)는 순수 함수만 본다. 판정이 맞아도 **부르지 않으면**
// 아무 일도 안 일어나고, 조회가 폐기 행을 걸러 주지 않으면 이미 버린 자재가 되살아난다.
// 그래서 여기서는 두 축이 실제로 코드에 꽂혀 있는지 **모양으로** 확인한다.
//
// 단언 열. ⓐ 조회가 두 칸을 읽는가 ⓑ 매핑이 실어 나르는가 ⓒ 모집단에서 폐기를 안 뺐는가
// ⓓ 집계가 두 축으로 가르는가(금액은 전 행) ⓔ 분할 기계가 폐기 표식을 복제하는가
// ⓕ 서버 게이트가 정본 판정을 부르는가 ⓖ **mergeUnassignedGroup 의 disposedAt: null**(급소)
// ⓗ 속성으로 찾는 조회들이 폐기 행을 거르는가 ⓘ 교체가 한 트랜잭션인가
// ⓙ 화면이 폐기분을 옮기기 대상에서 빼고, 폐기 없는 카드에 보조줄을 안 주는가.
import { readFileSync } from 'node:fs'

const agg     = readFileSync('app/(app)/inventory/assets/aggregate.ts', 'utf8')
const actions = readFileSync('app/(app)/inventory/assets/actions.ts', 'utf8')
const client  = readFileSync('app/(app)/inventory/assets/AssetsClient.tsx', 'utf8')
const schema  = readFileSync('prisma/schema.prisma', 'utf8')

const fails = []
const need = (name, cond, hint) => { if (!cond) fails.push(`${name}${hint ? ` — ${hint}` : ''}`) }

// 함수 하나만 잘라 본다 — 파일 전체로 세면 다른 함수의 같은 글자가 대신 통과시킨다.
function body(src, header) {
  const start = src.indexOf(header)
  if (start < 0) return ''
  const rest = src.slice(start + header.length)
  const nextFn = rest.search(/\n(export )?(async )?function \w/)
  return header + (nextFn < 0 ? rest : rest.slice(0, nextFn))
}

// ── 0. 스키마에 두 칸이 있는가 ─────────────────────────────────────
{
  const expense = schema.slice(schema.indexOf('model Expense {'), schema.indexOf('model ExpenseOrder {'))
  need('스키마에 disposedAt 이 있다', /disposedAt\s+DateTime\?\s+@db\.Date/.test(expense))
  need('스키마에 disposalReason 이 있다', /disposalReason\s+String\?/.test(expense))
}

// ── ⓐ 조회가 두 칸을 읽는가 ────────────────────────────────────────
{
  const fn = body(actions, 'export async function getDurableItems(')
  need('getDurableItems 를 찾음', fn.length > 0)
  need('조회 select 가 disposedAt·disposalReason 을 읽는다',
    /disposedAt:\s*true,\s*disposalReason:\s*true/.test(fn),
    '안 읽으면 화면이 폐기를 영원히 모른다')
}

// ── ⓑ 매핑이 실어 나르는가 ─────────────────────────────────────────
{
  need('RawAsset 매핑이 폐기 두 칸을 싣는다',
    /disposedAt:\s*r\.disposedAt\s*\?\s*kstYmd\(r\.disposedAt\)\s*:\s*null,\s*disposalReason:\s*r\.disposalReason/.test(actions),
    '날짜는 KST 로 접어야 자정 근처에서 하루가 안 밀린다')
}

// ── ⓒ 모집단에서 폐기를 빼면 안 된다 ────────────────────────────────
{
  const fn = body(actions, 'function durableExpenseWhere(')
  need('durableExpenseWhere 를 찾음', fn.length > 0)
  need('durableExpenseWhere 가 폐기를 안 거른다', !/disposedAt/.test(fn),
    '여기서 거르면 전량 폐기된 카드가 통째로 사라져 그 방에 든 비용의 행방이 끊긴다')
}
// 버킷 분류도 폐기를 안 본다 — 폐기 행은 그 방 버킷에 그대로 남는다.
{
  const fn = body(actions, 'export async function getDurableItems(')
  const bucket = fn.slice(fn.indexOf('const roomBuckets'), fn.indexOf('const orderRows'))
  need('버킷 분류를 찾음', bucket.length > 0)
  need('버킷 분류가 폐기를 안 본다', !/disposedAt/.test(bucket),
    '가르는 일은 aggregateAssets 안에서만 한다')
}

// ── ⓓ 집계가 두 축으로 가르는가 ────────────────────────────────────
{
  const fn = body(agg, 'export function aggregateAssets(')
  need('aggregateAssets 를 찾음', fn.length > 0)
  need('살아 있는 행을 가른다', /const live = rows\.filter\(r => !r\.disposedAt\)/.test(fn))
  need('폐기 행을 가른다', /const dead = rows\.filter\(r => !!r\.disposedAt\)/.test(fn))
  need('수량은 살아 있는 합', /const qtyValue = hasQty \? live\.reduce/.test(fn),
    '물건의 축은 살아 있는 것만 센다')
  need('**금액은 전 행 합**', /const amount = rows\.reduce\(\(s, r\) => s \+ r\.amount, 0\)/.test(fn),
    '돈의 축은 절대 안 줄어든다 — live 로 바꾸면 방별 투자금이 폐기로 줄어든다(domain-room-work 위반)')
  need('ids 는 살아 있는 행만', /ids: live\.map\(r => r\.id\)/.test(fn),
    '폐기 행이 ids 에 남으면 옮기기·합치기가 죽은 행을 집어 든다')
  need('disposedIds 는 폐기 행', /disposedIds: dead\.map\(r => r\.id\)/.test(fn))
  need('breakdown 은 전 행 + disposed 표식', /breakdown: rows\.map\(.*disposed: !!r\.disposedAt/s.test(fn))
  need('대표는 살아 있는 행 우선', /const rep = live\[0\] \?\? rows\[0\]/.test(fn))
}

// ── ⓔ 분할 기계가 폐기 표식을 복제하는가 ────────────────────────────
{
  need('MoveData 가 폐기 두 칸으로 넓어졌다',
    /type MoveData = [\s\S]{0,320}?disposedAt\?: Date \| null; disposalReason\?: string \| null/.test(actions))
  for (const [fnName, header] of [['buildSplitOps', 'function buildSplitOps('], ['buildFanOutOps', 'function buildFanOutOps(']]) {
    const fn = body(actions, header)
    need(`${fnName} 를 찾음`, fn.length > 0)
    need(`${fnName} 의 분할 create 가 폐기 표식을 잇는다`,
      /disposedAt: 'disposedAt' in d(ata)? \? d(ata)?\.disposedAt : e\.disposedAt/.test(fn)
      && /disposalReason: 'disposalReason' in d(ata)? \? d(ata)?\.disposalReason : e\.disposalReason/.test(fn),
      '빠지면 분할된 조각이 폐기 표식을 잃고 되살아난다')
  }
  need('buildSplitOps 가 새 행 위치를 돌려준다', /return \{ ops, movedQty, touchedGroups: \[\.\.\.new Set\(touched\)\], createdOpIndexes \}/.test(actions),
    '적용취소 deleteIds 가 이 값에서 나온다')
}

// ── ⓕ 서버 게이트가 정본 판정을 부르는가 ────────────────────────────
{
  const fn = body(actions, 'export async function disposeAsset(')
  need('disposeAsset 를 찾음', fn.length > 0)
  need('disposeAsset 가 정본 게이트를 부른다', /const denial = disposalDenial\(exps, qty\)/.test(fn),
    '여기서 게이트를 다시 쓰면 진리표와 갈린다')
  need('막히면 그 줄 그대로 돌려준다', /if \(denial\) return \{ ok: false, error: denial \}/.test(fn))
  need('폐기는 자리를 안 옮긴다(위치 세 칸은 원행 값)',
    /roomId: rep\.roomId, assignedLocationId: rep\.assignedLocationId, isCommonAsset: rep\.isCommonAsset/.test(fn))
  need('disposeAsset 가 적용취소 토큰을 돌려준다', /undo: \{\s*restore: live\.map\(snapshotRow\)/.test(fn))
  // 초과 거부가 클램프로 바뀌는 역주입을 잡는다.
  const gate = body(agg, 'export function disposalDenial(')
  need('disposalDenial 을 찾음', gate.length > 0)
  need('초과는 거부다(클램프 아님)', /if \(qty > have \+ 1e-9\) return disposalDenyOver/.test(gate),
    'Math.min 으로 깎으면 운영자가 다른 수량이 빠진 걸 모른다')
  need('게이트에 클램프가 없다', !/Math\.min|Math\.max/.test(gate))
  need('적용취소가 폐기 표식을 되돌린다',
    /r\.disposedAt !== undefined \? \{ disposedAt: r\.disposedAt \? new Date\(r\.disposedAt\) : null \}/.test(actions))
}

// ── ⓖ 급소 — mergeUnassignedGroup 의 disposedAt: null (양쪽) ──────────
//    이 함수는 여러 행을 하나로 접고 나머지를 **삭제**한다. 폐기 행이 끌려 들어오면
//    폐기 기록이 통째로 사라지고 그 수량이 살아 있는 행에 합쳐진다. 데이터 소실이다.
{
  const fn = body(actions, 'async function mergeUnassignedGroup(')
  need('mergeUnassignedGroup 을 찾음', fn.length > 0)
  // 읽는 조회 둘만 본다(뒤쪽 update·deleteMany 의 where 는 id 로 찍으므로 대상이 아니다).
  need('**미배정 조회 where 에 disposedAt: null**',
    /findMany\(\{\s*where: \{ propertyId, allocationGroupId: groupId, roomId: null, assignedLocationId: null, disposedAt: null \}/.test(fn),
    '빠지면 폐기 행이 합쳐져 사라진다 — 표시 오염이 아니라 데이터 소실이다')
  need('**배정 개수 count where 에 disposedAt: null**',
    /count\(\{\s*where: \{ propertyId, allocationGroupId: groupId, disposedAt: null, OR:/.test(fn),
    '폐기 행은 배정된 행이 아니라 이제 세지 않는 행이다')
}

// ── ⓗ 속성으로 찾는 조회가 폐기 행을 거르는가 ───────────────────────
{
  const fn = body(actions, 'export async function revertAssignmentLog(')
  need('revertAssignmentLog 를 찾음', fn.length > 0)
  need('되돌리기 조회가 폐기 행을 거른다', /\.\.\.specOf\(log\), disposedAt: null/.test(fn),
    '안 거르면 이미 버린 자재가 되돌리기로 미배정에 되살아난다')
}

// ── ⓘ 교체가 한 트랜잭션인가 ───────────────────────────────────────
{
  const fn = body(actions, 'export async function assignAggregateToTarget(')
  need('assignAggregateToTarget 을 찾음', fn.length > 0)
  need('교체 인자를 받는다', /replace\?: \{ reason: string \} \| null/.test(fn))
  need('교체 대상 조회가 살아 있는 행만 본다', /disposedAt: null, id: \{ notIn: expenseIds \}/.test(fn))
  need('교체 폐기 ops 를 배정 ops 에 **이어 붙인다**', /ops = \[\.\.\.ops, \.\.\.disp\.ops\]/.test(fn),
    '따로 커밋하면 넣었는데 뺀 기록이 없는 중간 상태가 생긴다')
  need('교체도 트랜잭션은 하나다', (fn.match(/prisma\.\$transaction\(/g) ?? []).length === 1)
  need('교체 적용취소 토큰이 배정·폐기 양쪽 행을 담는다', /undoRows = \[\.\.\.exps, \.\.\.already\]/.test(fn))
  // 카드 정체성이 같은 것끼리만 교체한다 — 라벨만 보면 규격이 다른 것을 버린다(5853a0ff 클래스).
  need('교체 대상은 규격까지 같은 것만', /itemLabel: rep0\.itemLabel, \.\.\.specOf\(rep0\)/.test(fn))
}
// 합치기·단위 바꾸기가 폐기 행을 데려가는가 — 안 데려가면 카드가 갈라져 폐기 기록이 사라진다.
{
  need('combineAssets 가 disposedIds 를 받는다', /export async function combineAssets\([\s\S]{0,160}?disposedIds\?: string\[\]/.test(actions))
  need('combineAssets 가 disposedIds 를 대상에 합친다', /\[\.\.\.new Set\(\[\.\.\.srcExpenseIds, \.\.\.\(disposedIds \?\? \[\]\)\]\)\]/.test(actions))
  need('setAssetQtyUnit 이 disposedIds 를 받는다', /export async function setAssetQtyUnit\([\s\S]{0,160}?disposedIds\?: string\[\]/.test(actions))
  need('setAssetQtyUnit 이 두 묶음을 함께 바꾼다', /targetIds = \[\.\.\.new Set\(\[\.\.\.expenseIds, \.\.\.\(disposedIds \?\? \[\]\)\]\)\]/.test(actions))
  // 합치기 이력 고아 봉합 — 지출만 바꾸면 그 카드의 배정 이력이 아무 카드에도 안 붙는다.
  const fn = body(actions, 'export async function combineAssets(')
  need('합치기가 배정 이력도 대상 값으로 옮긴다', /tx\.assetAssignmentLog\.updateMany\(/.test(fn))
  need('옮긴 이력의 옛값을 적용취소 payload 에 싣는다', /assetLogs: logRows\.map\(l => \(\{ id: l\.id, oldLabel: l\.itemLabel/.test(fn))
  const undo = readFileSync('app/(app)/finance/actions.ts', 'utf8')
  need('적용취소가 배정 이력도 원복한다', /aff\?\.assetLogs \?\? \[\][\s\S]{0,200}?assetAssignmentLog\.update\(/.test(undo))
}

// ── ⓙ 화면 ────────────────────────────────────────────────────────
{
  need('buysOf 가 폐기분을 옮기기 대상에서 뺀다', /for \(const b of it\.breakdown\) \{\s*if \(b\.disposed\) continue/.test(client),
    '남기면 "그 구매분 N개" 가 살아 있는 수량보다 많다고 말해 초과 거부에 걸린다')
  need('폐기 없는 카드는 보조줄을 안 받는다',
    /valueSub=\{it\.disposedQty > 0 \? `누적 [^`]*` : undefined\}/.test(client),
    '빈 문자열이나 0 표시로 바꾸면 폐기 없는 카드의 픽셀이 바뀐다')
  need('수령 대기가 섞이면 폐기 알약을 숨긴다',
    /!selItems\.some\(it => data\.pending\.some\(p => p\.id === it\.id\)\)[\s\S]{0,160}?폐기·분실/.test(client))
  need('폐기 사유는 select 한 칸', /<select value=\{dispose\.reason\}/.test(client))
  need('미리보기가 돈이 안 움직인다고 말한다', /비용 \$\{won\(totalAmt\)\}은 그대로입니다|비용 \{won\(totalAmt\)\}은 그대로입니다/.test(client))
  need('되돌리기 라벨은 적용취소 단일', /runUndoDisposalRow\(d\.id\)[\s\S]{0,320}?>적용취소</.test(client),
    '§16 어휘 — 이 목록에 "되돌리기" 를 쓰면 안 된다')
  need('폐기 목록에 되돌리기라는 말이 없다', !/폐기[\s\S]{0,400}?>되돌리기</.test(client))
}

if (fails.length) {
  console.error(`\n[자재 폐기 배선] 위반 ${fails.length}건`)
  for (const f of fails) console.error('  - ' + f)
  console.error('\n  축은 둘이다 — 돈(amount)은 절대 안 줄고, 물건(qtyValue)만 폐기로 줄어든다.')
  process.exit(1)
}
console.log('[자재 폐기 배선] 위반 0건')
