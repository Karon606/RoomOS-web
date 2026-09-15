// 재고 점검 기본 보기(위치별) 배선 감지 — 실행: node scripts/check-inventory-view-default.mjs
//
// 왜 필요한가. 2026-09-15 설계 패널 결정 — 재고 화면의 기본 보기를 '위치별'로 바꿨다. 이 결정은
// 값 하나가 아니라 **다섯 자리가 같이 서야** 성립하고, 하나만 되돌아가도 화면은 조용히 옛 모양이
// 된다(테스트로는 안 잡힌다 — 전부 렌더 기본값·저장 키·스켈레톤이라 돌려도 초록이다).
//
// 잡는 것 여섯.
//   ① 초기값 식이 딥링크 아닐 때 'location' 으로 떨어진다.
//   ② 마운트 후 복원이 'item' 만 되살린다(옛 축 '=== location' 으로 돌아가면 기본이 뒤집힌다).
//   ③ 세그먼트 옵션의 첫 원소가 'location' 이다(§23 — 기본값이 첫 칸).
//   ④ doSave 성공 가지의 onClose() 가 else 아래에 있다(인라인이면 안 불린다).
//   ⑤ loading.tsx 본문이 패널 골격이다.
//   ⑥ (2026-09-15) 상세 모달 골격도 제 여백을 갖고, 열릴 모드의 모양을 본뜬다.
//
// ④ 를 왜 여기서 또 보나. check-draft-lifecycle 은 onClose 가 **실패 0 일 때만** 서는지를 본다.
// 여기서 보는 것은 다른 축이다 — 인라인(기본 보기)에서는 아예 안 서야 한다. 되돌아가면 체인 저장에
// 성공할 때마다 아이템별로 튕기고, changeView 가 저장 키에 'item' 을 덮어써 기본값이 사실상 사라진다.
//
// 한계. 소스 가드라 '존재'만 본다. 값을 다른 상수로 우회하거나 판정을 다른 파일로 옮기는 변경은
// 못 잡는다. 주석은 걷고 보므로 설명 글자가 검사를 통과시키지는 못한다(형제 그물과 같은 문법).
import { readFileSync } from 'node:fs'

// 주석을 걷는다 — 설명 글자가 검사를 통과시키면 안 된다(이 저장소에서 실제로 한 번 뚫렸다).
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(l => l.replace(/\/\/.*$/, ''))
    .join('\n')
}

// 함수 하나만 잘라 본다 — 파일 전체로는 형제 함수의 코드가 섞여 판정이 무의미해진다.
function fnBody(src, header) {
  const start = src.indexOf(header)
  if (start < 0) return ''
  const i = src.indexOf('{', start + header.length - 1)
  if (i < 0) return ''
  let depth = 0
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1) }
  }
  return ''
}

const CLIENT = 'app/(app)/inventory/InventoryClient.tsx'
const LOADING = 'app/(app)/inventory/loading.tsx'
const client = stripComments(readFileSync(CLIENT, 'utf8'))
const loadingRaw = readFileSync(LOADING, 'utf8')

const fails = []
const need = (name, cond, hint) => { if (!cond) fails.push(`${name}${hint ? ` — ${hint}` : ''}`) }

// ── ① 기본값은 위치별 ──────────────────────────────────────────────
need('딥링크 판정이 ?focus= 와 ?q= 두 축이다',
  /const deepLinked = !!\(searchParams\.get\('focus'\) \|\| searchParams\.get\('q'\)\)/.test(client),
  '종 알림(?focus=)과 통합검색(?q=)은 둘 다 아이템별 의도다')
need("초기값이 딥링크 아닐 때 'location' 이다",
  /useState<'item' \| 'location'>\(deepLinked \? 'item' : 'location'\)/.test(client),
  "기본 보기가 위치별이다 — 'item' 고정으로 돌아가면 결정이 사라진다")

// ── ② 복원은 'item' 만 되살린다 ────────────────────────────────────
need('복원이 승격된 키를 읽는다',
  /localStorage\.getItem\('stayeum-inventory-view2'\)/.test(client),
  "옛 키 'stayeum-inventory-view' 의 값은 선택이 아니라 부작용이다(인라인 onClose 가 덮어썼다)")
need("복원 비교가 === 'item' 이다",
  /if \(v === 'item'\) setViewMode\('item'\)/.test(client) &&
  !/setViewMode\('location'\)/.test(client),
  "'=== location' 으로 돌아가면 저장값 없는 기기가 아이템별로 열린다")
need('딥링크 회차는 복원을 건너뛴다',
  /if \(deepLinkedRef\.current\) return/.test(client),
  '건너뛰지 않으면 알림으로 들어온 화면이 마지막 선택에 덮여 엉뚱한 보기로 열린다')
need('저장도 승격된 키로 한다',
  /localStorage\.setItem\('stayeum-inventory-view2', m\)/.test(client) &&
  !/'stayeum-inventory-view'/.test(client),
  '읽기·쓰기 키가 갈리면 선택이 한 번도 기억되지 않는다')

// ── ③ 세그먼트 첫 칸이 기본값 ──────────────────────────────────────
need('세그먼트 첫 원소가 위치별이다',
  /options=\{\[\{ value: 'location', label: '위치별' \}, \{ value: 'item', label: '아이템별' \}\]\}/.test(client),
  '§23 — 기본값이 첫 칸이다. 순서가 뒤집히면 기본이 오른쪽에 서서 형제 화면과 관례가 갈린다')

// ── ④ 인라인은 저장 후 닫지 않는다 ─────────────────────────────────
const doSave = fnBody(client, "const doSave = async (forceMerge?: boolean, dupDecision?: 'keep' | 'skip') => {")
need('doSave 를 찾음', doSave.length > 0)
// 인라인 마감은 '닫지 않는' 대신 **입력을 전부 비우는** 자리다. confirmItems 가 빠지면
// '기존 기록에 합칠까요?' 바가 저장 성공 직후 유령으로 되살아난다(표시 조건이 다시 참이 된다).
need('doSave 의 onClose 가 else 아래에 있다',
  /if \(inline\) \{ setBeforeQtys\(\{\}\); setAfterQtys\(\{\}\); setMergeChoice\(null\); setConfirmItems\(\[\]\) \}\s*\n?\s*else onClose\(\)/.test(doSave),
  '인라인에서 닫으면 기본 보기를 떠나고 changeView 가 저장 키를 item 으로 덮어쓴다 · confirmItems 를 안 비우면 물음 바가 되살아난다')
const hubResolved = fnBody(client, 'const onHubShortResolved = async () => {')
need('onHubShortResolved 를 찾음', hubResolved.length > 0)
need('팝업 마감도 같은 모양이다',
  /if \(inline\) \{ setBeforeQtys\(\{\}\); setAfterQtys\(\{\}\); setMergeChoice\(null\); setConfirmItems\(\[\]\) \}\s*\n?\s*else onClose\(\)/.test(hubResolved),
  '두 마감이 갈리면 허브 부족을 거친 저장만 화면을 떠난다')
need('성공 토스트가 두 마감에 다 있다',
  (client.match(/pushToast\('success', `\$\{out\.done\}건 저장됨`\)/g) ?? []).length === 2,
  '닫히지 않는 패널에서 토스트까지 없으면 저장이 됐는지 알 길이 없다')
need('인라인은 onClose prop 자체를 안 받는다',
  /<LocationBatchCheckModal inline rows=\{visibleRows\} onDone=/.test(client),
  'prop 을 넘기면 언젠가 누군가 다시 부른다 — 넘기지 않는 것이 규칙이다')
need('onClose 는 모달 모드 전용 optional prop 이다',
  /function LocationBatchCheckModal\(\{ rows, onClose = \(\) => \{\}, onDone, inline = false, onDraftChange \}/.test(client) &&
  /rows: InventoryRow\[\]; onClose\?: \(\) => void;/.test(client))

// ── ⑤ 스켈레톤이 패널 골격 ─────────────────────────────────────────
need('loading.tsx 에 패널 골격 마커가 있다',
  /본문 골격 = 기본 보기 = 위치별 패널/.test(loadingRaw),
  '주석 마커가 없으면 무엇을 본뜬 골격인지 다음 사람이 모른다')
const loading = stripComments(loadingRaw)
need('스켈레톤이 2열 그리드 두 칸이다',
  /grid grid-cols-2 gap-2/.test(loading) &&
  (loading.match(/h-11 rounded-sm bg-\[var\(--canvas\)\] animate-pulse/g) ?? []).length === 2,
  '점검 위치·점검일 두 칸이 패널 상단의 모양이다')
need('카드 5장 모형이 남아 있지 않다',
  !/Array\.from\(\{ length: 5 \}\)/.test(loading),
  '아이템별 목록 모형이 남으면 로딩에서 로디드로 갈 때 목록이 패널로 바뀌는 점프가 된다')

// ── ⑥ 상세 모달 골격도 제 여백을 갖는다 (2026-09-15) ────────────────────────────
// 같은 축의 다른 자리다. 이 모달은 풀블리드(bodyClassName='')라 하위 폼마다 제 여백을 세우는데,
// 골격만 맨몸 SkeletonRows 였다. 첫 페인트가 모달 벽에 붙어 뜨고, 로디드 순간 좌우 20/24px·
// 상하 16px 이 한꺼번에 밀려 들어왔다. 세로 길이도 실제 본문의 몇 분의 일이라 통째로 늘어났다.
need('상세 모달 골격 컴포넌트가 있다',
  /function DetailModalSkeleton\(\{ mode \}: \{ mode: 'view' \| 'check' \}\)/.test(client),
  '골격이 함수 한 채여야 모드별 모양을 가를 수 있다')
// 여백은 **대체할 화면의 것**이다(디자이너 검수 2026-09-16). 점검 폼은 `px-5 py-4`, 보기 화면은
// `px-5 sm:px-6 pt-3` 이라, 한 벌만 쓰면 640px 이상에서 첫 페인트가 4px 튄다.
need('점검 골격 여백이 점검 폼과 같다',
  /className="px-5 py-4 space-y-3 delayed-fallback"/.test(client) &&
  /<form onSubmit=\{handleSubmit\} className="px-5 py-4 space-y-3/.test(client),
  "bodyClassName='' 인 모달의 children 은 자기 여백을 갖는 것이 규칙이다(§13 풀블리드) — 그 여백이 대체할 폼과 같아야 점프가 없다")
need('보기 골격 여백이 보기 화면과 같다',
  /className="px-5 sm:px-6 pt-3 space-y-3 delayed-fallback"/.test(client) &&
  /<div className="px-5 sm:px-6 pt-3">/.test(client),
  '보기 화면은 sm 에서 24px 이고 위 여백이 pt-3 이다 — 골격이 py-4 면 로디드에서 아래로 밀린다')
// **주석이 아니라 마크업을 겨눈다**(재검수 2026-09-16). 이 파일의 client 는 주석을 걷은 소스라,
// 블록을 지우고 설명만 남기면 초록이 되는 축을 세우면 안 된다. 골격의 첫 블록은 안내문 두 줄
// (h-4 + h-4 w-2/3)이고, 그 아래에 점검일 라벨(h-3 w-12)이 온다 — 그 순서를 그대로 본다.
const checkSkeleton = fnBody(client, "function DetailModalSkeleton({ mode }: { mode: 'view' | 'check' })")
need('점검 골격 본문을 찾음', checkSkeleton.length > 200)
need('점검 골격의 첫 블록이 안내문 두 줄이다',
  /<div className={`h-4 \$\{bar\}`} \/>\s*\n\s*<div className={`h-4 w-2\/3 \$\{bar\}`} \/>[\s\S]{0,400}?<div className={`h-3 w-12 \$\{bar\}`} \/>/.test(checkSkeleton),
  '실제 폼의 첫 블록(안내문)을 빼면 골격이 통째로 위로 당겨 붙는다')
need('행 골격 입력칸이 실제와 같은 44px 다',
  (checkSkeleton.match(/<div className={`h-11 \$\{bar\}`} \/>/g) ?? []).length >= 4,
  '입력칸이 34px 모형이면 행마다 10px 씩 짧아 로디드에서 세로가 늘어난다')
need('골격에 표시 지연이 걸려 있다',
  /delayed-fallback/.test(client),
  '300ms 안에 끝나는 전환에서 골격이 한 프레임 번쩍이면 그게 더 산만하다(§21 임계)')
need('맨몸 SkeletonRows rows={5} 가 남아 있지 않다',
  !/<SkeletonRows rows=\{5\}/.test(client),
  '모달 벽에 붙은 막대 다섯 줄로 돌아가면 로디드 순간 여백이 통째로 밀려 들어온다')
need('골격이 열릴 모드를 따라간다',
  /<DetailModalSkeleton mode=\{initialMode\} \/>/.test(client),
  "'다음 품목' 으로 이어 열면 점검 폼부터 뜬다 — 그때 보기 골격을 그리면 로디드에서 갈아엎힌다")
need('골격 막대가 loading.tsx 와 같은 색이다',
  /rounded-md bg-\[var\(--canvas\)\] animate-pulse/.test(client),
  '같은 화면의 두 골격이 다른 색이면 어느 쪽이 정본인지 알 수 없다')

console.log(`\n[재고 기본 보기(위치별) 배선] 위반 ${fails.length}건`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
