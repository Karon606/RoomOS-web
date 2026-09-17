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

// ── ⓔ-B 복제 목록이 **Expense 스키마의 스칼라 칸을 전부 덮는가** ─────────────────
//
// 왜 스키마에서 읽나(장부 검수 2026-09-16). 쪼개는 자리 셋이 각자 목록을 들고 있었고 셋이
// 서로 같기만 했지 스키마를 덮는지 아무도 안 봤다. `roomWorkId`·`costKind` 가 빠져 있었는데
// 종전 방아쇠는 대개 작업에 걸리기 전 행에서 터져 안 드러났다 — **폐기는 정반대로 이미 방에
// 설치돼 작업에 걸린 행을 겨눈다**(실측 67건이 그 모양이다). 그 행을 쪼개면 그 방 시공비가
// 반으로 줄고 떨어져 나온 조각은 고아 지출이 되어 check-room-work-link 가 빨개진다.
// **손으로 센 목록은 다음 컬럼이 늘 때 또 진다.** 그래서 schema.prisma 를 읽어 대조한다.
{
  // 자동 생성이라 복제하지 않는 셋. 그 밖의 스칼라는 전부 실려야 한다.
  const AUTO = new Set(['id', 'createdAt', 'updatedAt'])
  const model = schema.slice(schema.indexOf('model Expense {'))
  const modelBody = model.slice(0, model.indexOf('\n}'))
  const scalars = []
  for (const raw of modelBody.split('\n').slice(1)) {
    const line = raw.replace(/\/\/.*$/, '').trim()
    if (!line || line.startsWith('@@') || line.startsWith('//')) continue
    if (/\[\]|@relation/.test(line)) continue          // 관계 칸은 복제 대상이 아니다
    const m = line.match(/^(\w+)\s+\S/)
    if (m && !AUTO.has(m[1])) scalars.push(m[1])
  }
  need('스키마에서 Expense 스칼라를 읽었다', scalars.length > 30, `읽은 칸 ${scalars.length}개 — 파싱이 어긋났다`)

  const clone = body(actions, 'function cloneExpenseScalars(')
  need('cloneExpenseScalars 를 찾음', clone.length > 0,
    '분할 복제 목록은 한 자리여야 한다 — 셋으로 흩어지면 또 어긋난다')
  const missing = scalars.filter(k => !new RegExp(`(^|[\\s{,])${k}\\s*[,:]`).test(clone))
  need('복제 목록이 스키마 스칼라를 전부 덮는다', missing.length === 0,
    `빠진 칸: ${missing.join(', ')} — 그 칸은 분할된 행에서 사라진다`)

  // 세 쪼개는 자리가 전부 그 한 자리를 거치는가. 직접 create 를 쓰면 목록이 또 갈린다.
  for (const [fnName, header] of [
    ['buildSplitOps', 'function buildSplitOps('],
    ['buildFanOutOps', 'function buildFanOutOps('],
    ['setAssetReceived(부분 수령)', 'export async function setAssetReceived('],
  ]) {
    const fn = body(actions, header)
    need(`${fnName} 를 찾음`, fn.length > 0)
    need(`${fnName} 의 분할이 cloneExpenseScalars 를 거친다`,
      /prisma\.expense\.create\(\{ data: cloneExpenseScalars\(/.test(fn),
      '직접 목록을 쓰면 스키마 대조를 빠져나간다')
    need(`${fnName} 에 손으로 쓴 create 목록이 없다`,
      !/prisma\.expense\.create\(\{ data: \{/.test(fn))
  }
}

// ── ⓕ 서버 게이트가 정본 판정을 부르는가 ────────────────────────────
{
  const fn = body(actions, 'export async function disposeAssets(')
  need('disposeAssets 를 찾음', fn.length > 0)
  need('disposeAssets 가 정본 게이트를 부른다', /const denial = disposalDenial\(exps, it\.qty\)/.test(fn),
    '여기서 게이트를 다시 쓰면 진리표와 갈린다')
  need('막히면 그 줄 그대로 돌려준다', /if \(denial\) return \{ ok: false, error: denial \}/.test(fn))
  need('폐기는 자리를 안 옮긴다(위치 세 칸은 원행 값)',
    /roomId: rep\.roomId, assignedLocationId: rep\.assignedLocationId, isCommonAsset: rep\.isCommonAsset/.test(fn))
  need('여러 품목도 트랜잭션 하나다', (fn.match(/prisma\.\$transaction\(/g) ?? []).length === 1,
    '보상 호출로 되돌리는 방식이면 그 호출이 실패할 때 절반만 폐기된 채로 끝난다')
  need('게이트를 전부 먼저 보고 나서 쓴다', fn.indexOf('const results = await prisma.$transaction(ops)') > fn.lastIndexOf('if (denial) return'),
    '한 품목이라도 막히면 아무것도 안 써야 한다')
  need('disposeAssets 가 적용취소 토큰을 돌려준다', /restore: restoreRows\.map\(snapshotRow\)/.test(fn))

  // ⚠️ **인자의 정체까지 본다.** `buildSplitOps(live, …)` 라는 글자만 보면 `const live = exps` 로
  //    한 글자 바꾸는 우회가 통째로 투명해진다 — 그물 넷이 전부 `live` 라는 **이름**만 보고,
  //    진리표는 순수층만 보며, 금액 지문도 안 움직인다. 그런데 buildSplitOps 가 폐기 행부터 다시
  //    찍어 **살아 있는 수량이 안 줄고 옛 폐기 기록의 날짜·사유만 덮인다.** 502호·504호처럼 폐기
  //    이력이 있는 방, 즉 이 기능이 겨눈 바로 그 방에서만 발화한다(검수 설계 우회, 2026-09-16).
  need('분할에 넘기는 것이 live 다', /buildSplitOps\(live, propertyId,/.test(fn))
  need('그 live 가 **폐기 행을 걸러낸 것**이다',
    /const live = exps\.filter\(e => !e\.disposedAt\)/.test(fn),
    'const live = exps 로 한 글자만 바꾸면 폐기 행부터 다시 찍혀 살아 있는 수량이 안 준다')
  // 초과 거부가 클램프로 바뀌는 역주입을 잡는다.
  const gate = body(agg, 'export function disposalDenial(')
  need('disposalDenial 을 찾음', gate.length > 0)
  need('초과는 거부다(클램프 아님)', /if \(qty > have \+ 1e-9\) return disposalDenyOver/.test(gate),
    'Math.min 으로 깎으면 운영자가 다른 수량이 빠진 걸 모른다')
  need('게이트에 클램프가 없다', !/Math\.min|Math\.max/.test(gate))
  need('적용취소 복원이 propertyId 로 잠긴다',
    /updateMany\(\{\s*where: \{ id: r\.id, propertyId \}/.test(actions),
    '토큰은 클라가 돌려보내는 값이고 그 안에 amount 가 있다 — id 만 보면 남의 영업장 지출이 덮인다')
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
  // 반대 방향이다 — '묶음이 아직 뜻이 있나' 를 세는 쪽에서는 **폐기 행도 세야** 한다.
  // 빼면 남은 것이 폐기뿐일 때 groupId 가 풀려 undoDisposalRow 가 제 짝을 못 찾는다.
  need('묶음 잔존 판정이 접지 않는 행 전부를 센다(폐기 포함)',
    /count\(\{\s*where: \{ propertyId, allocationGroupId: groupId, id: \{ notIn: unassigned\.map/.test(fn),
    '폐기 행을 빼고 세면 groupId 가 풀려 짝 접기가 안 걸린다')
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
  need('교체 대상이 공용 표식까지 같다', /isCommonAsset: false,\s*\n\s*disposedAt: null, id: \{ notIn: expenseIds \}/.test(fn),
    '공용 자재 행이 끌려오면 폐기 data 의 isCommonAsset: false 가 그 표식을 조용히 끈다')
  need('교체도 **폐기 정본 게이트**를 통과한다', /const replaceDenial = disposalDenial\(already, movedQty\)/.test(fn),
    '초과만 손으로 다시 쓰면 수령 전 행을 교체로 버릴 수 있다')
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
  need('combineAssets 가 폐기 행을 src 에 합친다', /withDisposedSiblings\(propertyId, \[\.\.\.new Set\(srcExpenseIds\)\], disposedIds\)/.test(actions))
  need('setAssetQtyUnit 이 disposedIds 를 받는다', /export async function setAssetQtyUnit\([\s\S]{0,160}?disposedIds\?: string\[\]/.test(actions))
  need('setCommonAsset 이 disposedIds 를 받는다', /export async function setCommonAsset\([\s\S]{0,160}?disposedIds\?: string\[\]/.test(actions),
    'isCommon 도 카드 정체성 키다 — 빠지면 분실 행이 미배정에 유령 카드로 남는다')
  // 클라가 준 id 를 믿지 않는다 — 옛 번들이 부르면 그 인자가 비어 카드가 갈린다.
  for (const fnName of ['setAssetQtyUnit', 'combineAssets', 'setCommonAsset']) {
    need(`${fnName} 이 폐기 행을 **서버가 정체성으로** 찾는다`,
      new RegExp(`export async function ${fnName}\\([\\s\\S]{0,1400}?withDisposedSiblings\\(propertyId,`).test(actions),
      '클라 인자만 믿으면 옛 번들 호출에서 카드가 갈린다')
  }
  need('withDisposedSiblings 가 폐기 행만 데려온다', /disposedAt: \{ not: null \}, OR: keys/.test(actions))
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
    /valueSub=\{it\.disposedQty > 0 \? `폐기 [^`]*` : undefined\}/.test(client),
    '빈 문자열이나 0 표시로 바꾸면 폐기 없는 카드의 픽셀이 바뀐다')
  need('수령 대기가 섞이면 폐기 알약을 숨긴다',
    /!selItems\.some\(it => data\.pending\.some\(p => p\.id === it\.id\)\)[\s\S]{0,160}?폐기·분실/.test(client))
  need('폐기 사유는 select 한 칸', /<select value=\{dispose\.reason\}/.test(client))
  need('미리보기가 돈이 안 움직인다고 말한다', /비용 \$\{won\(totalAmt\)\}은 그대로입니다|비용 \{won\(totalAmt\)\}은 그대로입니다/.test(client))
  need('되돌리기 라벨은 적용취소 단일', /runUndoDisposalRow\(d\.id\)[\s\S]{0,320}?>적용취소</.test(client),
    '§16 어휘 — 이 목록에 "되돌리기" 를 쓰면 안 된다')
  need('상세의 되돌리기 라벨이 적용취소 하나다', !/>되돌리기</.test(client),
    '§16 단일 라벨 — 같은 상세에서 두 목록이 다른 말을 쓰면 다른 일인 줄 안다')
  need('선입선출 정렬이 안정적이다', (actions.match(/\|\| a\.id\.localeCompare\(b\.id\)/g) ?? []).length >= 2,
    '날짜·수량이 같은 행이 둘이면 같은 입력이 다른 행을 쪼갠다')
}

// ── ⓚ 화면이 죽은 컨트롤을 이유 없이 남기지 않는가 (디자이너 검수 2026-09-16) ──────
//    목적지를 바꾸면 교체 사유를 비운다. 안 비우면 새 목적지에 재고가 0일 때 replaceOver 가
//    참으로 굳어 버튼이 비활성인데, 그 이유를 말하는 줄은 셀렉트와 함께 사라진다 —
//    버튼이 **화면에 없는 컨트롤의 이름**(`교체`)을 달고 죽어 있게 된다.
{
  need('목적지를 바꾸면 교체 사유를 비운다',
    /onChange=\{e => setMove\(m => m \? \{ \.\.\.m, to: e\.target\.value, replace: '' \} : m\)\}/.test(client),
    '안 비우면 버튼이 이유 한 줄 없이 죽는다')
  need('살아 있는 수량이 0이면 그 이유를 말한다',
    /max <= 0[\s\S]{0,120}?여기 남아 있는 수량이 없어요\./.test(client),
    '전량 폐기된 카드의 옮기기가 열자마자 죽던 같은 클래스')
  need('전량 폐기 카드의 수치는 --coral(§22 valueDanger)',
    /valueDanger=\{it\.disposedQty > 0 && it\.liveUnits <= 0\}/.test(client))
  need('폐기 목록 적용취소 히트가 44px', /min-h-\[44px\][\s\S]{0,200}?>적용취소</.test(client))
  {
    // 줄 단위로 본다 — [^<]* 를 통짜 문자열에 걸면 줄바꿈을 넘어 주석까지 삼킨다.
    // 주석(// 와 {/* */})은 사용자에게 안 보이므로 걷어내고 본다.
    const uiLines = client
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .split('\n')
      .filter(l => !/^\s*(\/\/|\*)/.test(l))
    const emDash = uiLines.filter(l =>
      /(optgroup label|placeholder|title|subtitle|label)="[^"]*—/.test(l) || />[^<>]*—[^<>]*</.test(l))
    need('사용자 노출 문자열에 em dash 가 없다', emDash.length === 0,
      `가이드 §25(AI 티 금지) — ${emDash[0]?.trim().slice(0, 80) ?? ''}`)
  }
  need('조사를 손으로 안 박는다(단위는 자유 입력)',
    !/\{unit\}(는|가|를|은|이)[요?\s]/.test(client) && /withEunNeun|eunNeunOf|iGaOf/.test(client),
    "'3장는요?'·'3롤가' 가 나간다 — lib/statusReasons 정본을 쓴다")
}

// ── ⓛ 상세 모달의 **범위 표기와 셈법 축** (신고 3e861137·고압호스 / be42800d·앵글밸브, 2026-09-17) ──
//    한 모달 안에 범위가 다른 집계가 셋 있는데 범위를 말하는 글자가 하나도 없었다.
//      카드 머리 `지금 N개`(버킷+규격) · `배치 현황`(품목 전체) · `설치·폐기`(버킷+규격)
//    데이터도 집계 축도 정상이고 결함은 표시 한 겹이었다. 그래서 여기서 지키는 것은 **글자**다 —
//    범위를 말하는 말이 사라지거나, 규격 병기가 조건부로 되돌아가면 같은 신고가 그대로 재발한다.
//    설치·폐기를 품목 단위로 올리는 '해결'은 금지다(커밋 950e73de — 돈의 축은 그 방에 들어간 누적).
//
//    독립 웹디자이너 검수(2026-09-17)가 같은 모달에서 **두 번째 층**을 찾았다. 범위는 적혔는데
//    이번에는 **셈법**이 갈렸다 — 칩 수량은 qtyValue 축, 부기한 `누적`은 liveUnits 축이라 한 카드의
//    "지금"이 한 모달 안에서 두 수로 갈린다. 낱말도 `누적`이라 폐기 수를 읽으려면 뺄셈을 해야 했다.
//    운영자 확정 셋. (1) 칩 낱말은 `폐기` (2) 머리의 `지금`에서 수령 대기분을 뺀다 (3) 칩과 아래
//    블록의 셈법을 통일한다. 그래서 이 절은 이제 **낱말**과 **축**을 같이 본다 — `누적`으로 되돌아가거나
//    한 화면의 `지금`이 두 축으로 갈리면 빨갛다.
{
  // 규격 문자열은 한 자리에서만 조립한다. 세 자리가 각자 만들면 한 화면에서 표기가 갈린다.
  need('규격 문자열 정본(specOf)이 하나다',
    (client.match(/x\.specText \|\| \(x\.specValue != null/g) ?? []).length === 1,
    '복사본이 생기면 카드 제목과 칩의 규격 표기가 갈린다')

  // 1) 배치 현황 = 품목 전체. `총` 은 카드 머리가 다른 범위로 이미 쓰고 있어 이 블록에서 금지.
  need('배치 현황 머리가 범위를 말한다(이 품목 전체)',
    /배치 현황\s*\n\s*<span[^>]*>이 품목 전체 · \{spots\}곳/.test(client),
    '범위를 빼면 카드 머리 `총 N개`와 겹쳐 읽혀 규격 혼입으로 신고된다')
  need('배치 현황 머리에 `총` 이 없다',
    !/<span[^>]*>[^<]*총 \$\{fmtQty\(totalQ\)/.test(client) && !/`총 \$\{fmtQty\(totalQ\)\}/.test(client),
    '같은 글자를 다른 범위로 쓰면 붙어 있는 한 계속 겹쳐 읽힌다')

  // 2) `곳` 은 카드 수가 아니라 자리 수다. sorted.length 로 되돌리면 고압호스 13→14, 앵글밸브 20→22.
  need('곳 수를 **자리**로 센다', /const spots = new Set\(sorted\.map\(spotKey\)\)\.size/.test(client),
    'sorted.length 는 카드 수다 — 같은 자리가 규격 둘로 갈리면 부푼다')
  need('그 자리 수를 화면이 실제로 찍는다', /\{spots\}곳/.test(client),
    '계산만 남기고 찍는 자리를 sorted.length 로 되돌리는 우회')
  need('자리 키가 미배정·공용 자재를 따로 센다',
    /x\.isCommon \? 'common' : 'unassigned'/.test(client),
    "placeKeyOf 는 둘 다 '' 로 접는다 — 옮기기 목적지 키라 이 셈에는 못 쓴다")

  // 3) 규격 병기는 **무조건**. 조건을 달면 무라벨이 '같은 규격'과 '규격 미기록' 두 뜻을 진다.
  need('규격 병기에 조건이 없다', /const chipSpec = specOf\(pl\)\s*\n/.test(client),
    '지금 보는 카드 칩의 규격은 중복이 아니라 나머지를 읽는 기준점이다')
  need('itemIdentity 비교로 되돌아가지 않았다',
    !/itemIdentity\(pl\) !== itemIdentity\(it\)/.test(client),
    '그 조건이 60cm 에만 라벨을 붙여 나머지를 "규격 없음"으로 읽히게 했다(3e861137)')
  need('칩이 그 규격을 실제로 찍는다', /\{chipSpec && <span[^>]*>\{chipSpec\}<\/span>\}/.test(client),
    'const 만 남기고 찍는 자리를 지우면 계산은 멀쩡한데 화면은 종전이다')

  // 4) 폐기가 있는 칩에만 폐기 수를 부기 — 폐기를 적은 사람이 확인할 자리가 앱에 여기뿐이다.
  need('폐기가 있는 칩에 폐기 수를 부기한다',
    /\{pl\.disposedQty > 0 && \(\s*\n\s*<span[^>]*>폐기 \{fmtQty\(pl\.disposedQty\)\}/.test(client),
    '카드 목록 valueSub 와 같은 낱말이다 — 없으면 22곳을 하나씩 눌러 봐야 한다')
  need('폐기 없는 칩은 한 픽셀도 안 바뀐다', /\{pl\.disposedQty > 0 && \(/.test(client),
    '조건을 걷어 0 을 찍으면 폐기 없는 카드의 칩 폭이 바뀐다')
  need('배치 현황 머리가 품목 전체 폐기 합을 말한다',
    /const disposedQ = sorted\.reduce\(\(s, x\) => s \+ x\.disposedQty, 0\)/.test(client)
    && /disposedQ > 0 \? \(units\.size === 1 \? ` · 폐기 /.test(client),
    '목록이 폐기를 빼는 것은 옳다 — 다만 뺀다는 사실을 머리가 말해야 합계의 뜻이 정해진다')

  // 4-B) **낱말은 `폐기` 하나다.** 신고 원문이 "왜 폐기 분실이 0개이고" 였고, `누적 N개`는 폐기 수를
  //      읽으려면 뺄셈을 시킨다. 한 화면에 두 낱말이 서면 안 된다(doc-vocabulary) — 칩과 카드 목록이
  //      같이 간다. disposedQty 는 파생이 아니라 그 자체로 참이라 셈법 충돌도 이 낱말로 사라진다.
  need('칩·카드 목록 어디에도 `누적` 부기가 없다',
    !/>누적 \{fmtQty\(/.test(client) && !/`누적 \$\{fmtQty\(/.test(client),
    '`누적`으로 되돌리면 뺄셈이 돌아오고 liveUnits + disposedQty 파생이라 칩 수량과 축이 또 갈린다')
  need('설치·폐기 블록의 `누적`은 그대로 둔다',
    /<span className="text-xs text-\[var\(--warm-mid\)\]">누적\s*\n/.test(client),
    '세 수(지금·폐기·누적)가 나란히 선 자리라 여기서는 뺄셈이 필요 없다 — 지울 대상이 아니다')

  // 4-C) **셈법 축.** 한 모달의 `지금`이 전부 liveUnits 여야 한다. qtyValue 는 미기록 행을 0으로
  //      접고 liveUnits 는 1로 세므로(aggregate.ts) 섞인 카드에서 같은 낱말이 다른 수를 말한다.
  need('칩 수량이 liveUnits 축이다',
    /<span className="mono font-semibold tabular-nums">\{fmtQty\(pl\.liveUnits\)\}/.test(client),
    '`pl.qtyValue ?? pl.count` 로 되돌리면 수량 미기록 카드가 **구매 건수를 개 단위로** 찍는다')
  need('배치 현황 머리의 `지금`도 liveUnits 축이다',
    /const totalQ = sorted\.reduce\(\(s, x\) => s \+ \([\s\S]{0,80}?\? 0 : x\.liveUnits\), 0\)/.test(client),
    '머리와 칩이 다른 축이면 칩을 세어 더한 수가 머리와 안 맞는다(두 신고가 다 칩을 세서 나왔다)')
  need('카드 머리의 `지금`도 liveUnits 축이다',
    /">지금 \{it\.qtyValue != null \? `\$\{fmtQty\(it\.liveUnits\)\}/.test(client),
    '200px 아래 `지금 있는 것`이 liveUnits 다 — 여기만 qtyValue 면 같은 낱말이 다른 수를 말한다')
  need('카드 머리가 `총` 을 안 쓴다', !/">총 \{it\.qtyValue/.test(client),
    '첫 값만 살아 있는 수량이고 금액·구매 건수는 폐기분까지 전부다 — 총이 세 값을 못 덮는다')

  // 4-D) **머리의 `지금`은 수령 대기를 뺀다**(운영자 확정). 칩은 남기되 머리가 안 센다.
  need('머리의 `지금`이 수령 대기분을 뺀다',
    /const totalQ = sorted\.reduce\(\(s, x\) => s \+ \(data\.pending\.some\(p => p\.id === x\.id\) \? 0 :/.test(client),
    '"지금 44개"라 말한 바로 아래 아직 안 온 물건이 (수령 대기) 딱지를 달고 선다')
  need('수령 대기 딱지가 말줄임 **밖**에 있다',
    /<span className="min-w-0 truncate">\{curPlace\(pl\)\}<\/span>[\s\S]{0,400}?\{isPending && <span>\(수령 대기\)<\/span>\}/.test(client),
    '안에 두면 긴 경로에서 이 딱지부터 잘려 나가 머리가 그 칩을 안 센다는 단서가 사라진다')
  need('곳 수는 수령 대기 자리를 그대로 센다',
    !/spotKey[\s\S]{0,200}?data\.pending/.test(client),
    "`곳`은 칩이 선 자리 수다 — 빼면 전량 수령 대기 품목에서 칩이 둘인데 `0곳`이 된다")

  // 4-E) **칩 안쪽 문법** — 가운뎃점 구분자(§11)와 자리 이름 말줄임. 라이트에서 --warm-mid 와
  //      --warm-muted 가 같은 값이라 색으로는 토막이 안 갈린다(globals.css §05 주석).
  need('칩 토막을 가운뎃점이 가른다',
    /const sep = <span aria-hidden="true" className="text-\[var\(--warm-muted\)\]">·<\/span>/.test(client),
    "gap-1 4px 와 같은 12px 띄어쓰기 3.25px 는 0.75px 차이라 긴 칩이 한 덩어리 문장으로 읽힌다")
  need('그 구분자를 칩이 실제로 찍는다', (client.match(/\{sep\}|&& sep\}/g) ?? []).length >= 3,
    'const 만 남기고 찍는 자리를 지우는 우회 — 계산은 멀쩡한데 화면은 종전이다')
  need('자리 이름이 말줄임된다', /<span className="min-w-0 truncate">\{curPlace\(pl\)\}<\/span>/.test(client),
    '전체 경로는 4단계까지 간다 — 안 줄이면 칩 하나가 328x42 두 줄이 되어 칩 문법이 깨진다')
  need('나머지 토막은 안 줄어든다(whitespace-nowrap)',
    /'inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-sm border/.test(client),
    '없으면 min-content 가 낱말 단위라 `폐기 2개`가 두 줄로 접힌다')
  need('잘린 이름을 title 이 받는다', /onClick=\{\(\) => \{ if \(!isCur\) setDetailItem\(pl\) \}\} title=\{curPlace\(pl\)\}/.test(client),
    '자르면 어느 자리인지 못 읽는다 — 저장소 정본(DashboardClient·FinanceClient)과 같은 문법')

  // 4-F) **범위 머리는 음절로 안 끊긴다.** 자리 이름이 전체 경로라 두 줄이 되는데, 한글 기본
  //      줄바꿈이 음절 단위라 `자동 계산`이 `자` / `동 계산`으로 갈렸다(실측 328px).
  for (const head of ['배치 현황', '설치·폐기']) {
    need(`${head} 머리에 break-keep 이 있다`,
      new RegExp(`<p className="mb-1\\.5 break-keep text-xs font-semibold text-\\[var\\(--warm-mid\\)\\]">${head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(client),
      '저장소가 이미 열 곳 넘게 쓰는 문법이다')
  }

  // 4-G) 칩 수와 곳 수가 다른 이유를 캡션이 말한다. 종전엔 숫자가 틀려도 세면 맞았는데
  //      곳을 자리 수로 바로잡으면서 세면 안 맞게 됐다 — 두 신고가 다 칩을 세서 나온 문장이었다.
  need('캡션이 칩과 곳이 갈리는 이유를 말한다',
    /같은 자리라도 규격이 다르면 따로 나와요\. 눌러서 그 위치 카드로 이동할 수 있어요/.test(client),
    '없으면 `22곳`인데 칩이 22개가 아닌 이유를 화면이 한 글자도 말하지 않는다')

  // 5) 설치·폐기 = 이 카드 한 자리. 범위를 적되 **품목 단위로 올리지 않는다**.
  need('설치·폐기 머리에 그 카드의 자리가 박힌다',
    /설치·폐기\s*\n\s*<span[^>]*>\{here\} 기준 · 자동 계산<\/span>/.test(client),
    '바로 위가 품목 전체라 범위를 안 적으면 두 숫자가 어긋난 것으로 읽힌다(be42800d)')
  need('그 자리 글자가 curPlace + 규격이다',
    /const here = `\$\{curPlace\(it\)\}\$\{specOf\(it\) \? ` \$\{specOf\(it\)\}` : ''\}`/.test(client))
  need('설치·폐기 수치는 **버킷 단위** 그대로다',
    /\{fmtQty\(it\.liveUnits\)\}\{unit\}/.test(client) && /\{fmtQty\(it\.disposedQty\)\}\{unit\}/.test(client)
    && /\{fmtQty\(it\.liveUnits \+ it\.disposedQty\)\}\{unit\}/.test(client),
    '품목 전체(sorted 합)로 올리면 방별 자재비 검산이 서 있는 설계 의도가 깨진다(950e73de)')
}

if (fails.length) {
  console.error(`\n[자재 폐기 배선] 위반 ${fails.length}건`)
  for (const f of fails) console.error('  - ' + f)
  console.error('\n  축은 둘이다 — 돈(amount)은 절대 안 줄고, 물건(qtyValue)만 폐기로 줄어든다.')
  process.exit(1)
}
console.log('[자재 폐기 배선] 위반 0건')
