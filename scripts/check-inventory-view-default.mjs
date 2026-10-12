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
//      (2026-10-12 재고 정비 2단계) 안내문·폐기 안내는 실제와 같은 문장으로 높이를 맞추고, 발끝 고정에 맞춰
//      골격 발끝(DetailCheckFooterSkeleton)도 둔다.
//   ⑧ (2026-10-12 재고 정비 3단계) 상세 보기 — 탭 위 요약 블록(골격과 한 함수)·창고 패널·발끝 두 줄·'관리' 메뉴·낱말.
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
  /function DetailModalSkeleton\(\{ mode, row \}: \{ mode: 'view' \| 'check'; row: InventoryRow \}\)/.test(client),
  '골격이 함수 한 채여야 모드별 모양을 가를 수 있다')
// 여백은 **대체할 화면의 것**이다(디자이너 검수 2026-09-16). 점검 폼은 `px-5 sm:px-6 py-4`(2단계 검수 12 — 모달
// 발끝 px-6 과 맞춰 640px 이상에서 4px 어긋나지 않게), 보기 화면은 **두 블록**(위 `px-5 sm:px-6 pt-3` · 이력
// `px-5 sm:px-6 py-3`)이다(3단계 — 한 블록 space-y-3 이던 골격은 실제와 세로 12px 어긋났다).
need('점검 골격 여백이 점검 폼과 같다',
  /className="px-5 sm:px-6 py-4 space-y-3 delayed-fallback"/.test(client) &&
  /<form onSubmit=\{handleSubmit\} className="px-5 sm:px-6 py-4 space-y-3/.test(client),
  "bodyClassName='' 인 모달의 children 은 자기 여백을 갖는 것이 규칙이다(§13 풀블리드) — 그 여백이 대체할 폼과 같아야 점프가 없다")
const viewSkeleton = (() => { const body = fnBody(client, "function DetailModalSkeleton({ mode, row }: { mode: 'view' | 'check'; row: InventoryRow })"); const i = body.indexOf(') : ('); return i < 0 ? '' : body.slice(i) })()
need('보기 골격 여백이 보기 화면과 같다(두 블록)',
  /<div className="delayed-fallback" aria-busy="true" aria-label="불러오는 중">\s*<div className="px-5 sm:px-6 pt-3">/.test(viewSkeleton) &&
  /<div className="px-5 sm:px-6 py-3">\s*<div className="space-y-1\.5">/.test(viewSkeleton) &&
  /<div className="px-5 sm:px-6 pt-3">\s*<DetailViewSummary row=\{row\}\s/.test(client) &&
  /<div className="px-5 sm:px-6 py-3 space-y-3">/.test(client),
  '보기 화면은 sm 에서 24px 이고 위 여백이 pt-3, 이력 블록이 py-3 이다 — 한 블록으로 그리면 로디드에서 12px 밀린다')
// **주석이 아니라 마크업을 겨눈다**(재검수 2026-09-16). 이 파일의 client 는 주석을 걷은 소스라,
// 블록을 지우고 설명만 남기면 초록이 되는 축을 세우면 안 된다. 골격의 첫 블록은 안내문이고, 그 아래
// 폐기 안내, 다시 그 아래 점검일 라벨(h-3 w-12)이 온다 — 그 순서를 그대로 본다.
// 2단계(2026-10-12) — 안내문이 세 문장으로 길어져 폭마다 줄 수가 달라졌다(320px 네 줄 · 402px 세 줄 · 모달 최대폭
// 두 줄). 고정 막대로는 어느 폭에서든 어긋나서, 골격이 **실제 폼과 같은 상수**를 투명 글자로 그린다(폐기 안내도
// 같다 — 320px 에서 세 줄로 꺾여 종전 50px 막대가 15px 짧았다). 같은 상수를 두 자리가 함께 쓰는지를 본다.
const checkSkeleton = fnBody(client, "function DetailModalSkeleton({ mode, row }: { mode: 'view' | 'check'; row: InventoryRow })")
need('점검 골격 본문을 찾음', checkSkeleton.length > 200)
need('점검 골격의 첫 블록이 실제와 같은 안내문이고 폐기 안내·점검일 라벨이 뒤따른다',
  /\{CHECK_GUIDE_RESTOCK\}<\/span><\/p>[\s\S]{0,40}?<div className="flex items-center justify-between[^\n]*>\s*\n\s*<p className="text-\[0\.65625rem\] text-transparent">\{CHECK_DISPOSAL_HINT\}<\/p>[\s\S]{0,500}?<div className={`h-3 w-12 \$\{bar\}`} \/>/.test(checkSkeleton) &&
  /\? CHECK_GUIDE_RESTOCK\n/.test(client) && /\{CHECK_DISPOSAL_HINT\}<\/p>/.test(client.slice(client.indexOf('function CheckForm('), client.indexOf('function TransferStockModal('))),
  '실제 폼의 첫 블록(안내문)을 빼거나 다른 문장으로 그리면 골격이 폭마다 위아래로 어긋난다')
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
  /<DetailModalSkeleton mode=\{initialMode\} row=\{row\} \/>/.test(client),
  "'다음 품목' 으로 이어 열면 점검 폼부터 뜬다 — 그때 보기 골격을 그리면 로디드에서 갈아엎힌다")
// 발끝 고정(2단계) — 점검 모드는 모달 발끝에 버튼이 선다. 불러오는 동안 발끝이 비어 있다가 생기면 그만큼 본문이 줄며
// 튄다. 골격 발끝은 실제 발끝과 같은 높이다 — 보충 모드는 합계 줄 16 · 간격 8 · 버튼 줄 44(93px), 첫 점검·위치 없는
// 품목은 합계 줄이 없어 버튼 줄뿐(69px)이라 호출부가 보충 모드인지 넘긴다(2단계 검수 6 — 늘 합계 줄을 그리면 첫
// 점검에서 24px 튄다). 넘기는 판정은 CheckForm restockMode 와 같은 식(직전 위치 내역 · 숨김 아닌 위치)이다.
const footSk = fnBody(client, 'function DetailCheckFooterSkeleton({ restock }: { restock: boolean }) {')
need('점검 모드 발끝 골격이 보충 모드를 따라간다',
  footSk.length > 100 && /\{restock && \(/.test(footSk) && /<div className={`h-11 flex-1 \$\{bar\}`} \/>/.test(footSk) &&
  /<DetailCheckFooterSkeleton restock=\{row\.currentLocationBreakdown\.length > 0 && row\.locations\.some\(l => !row\.hiddenLocationIds\.includes\(l\.id\)\)\} \/>/.test(client) &&
  /const restockMode = hasPrev && hasLocations/.test(client),
  '발끝이 로디드 순간 생기거나 줄면 본문 높이가 그만큼 바뀌며 점프한다')
need('골격 막대가 loading.tsx 와 같은 색이다',
  /rounded-md bg-\[var\(--canvas\)\] animate-pulse/.test(client),
  '같은 화면의 두 골격이 다른 색이면 어느 쪽이 정본인지 알 수 없다')

// ⑦ 보기에 안 매인 것은 보기 밖에 둔다 (운영자 지적 2026-09-23).
//
//    수령 대기 섹션이 아이템별 갈래 **안**에 있어서 위치별에서 통째로 사라졌다. 기본 보기가
//    위치별이라, 주문해 놓고 아직 안 받은 물건이 화면 어디에도 없었다. 같은 클래스가 이 화면에서
//    두 번째다 — 툴바 행도 같은 이유로 위치별에서 액션이 0개가 됐었다(오류신고 2e82ab7b).
//    그래서 자리를 본다. 수령 대기 섹션이 `{viewMode === 'location' ? (` 보다 **앞**에 있어야 한다.
{
  const pend = client.indexOf(`id="inventory-pending"`)
  const branch = client.indexOf("{viewMode === 'location' ? (")
  if (pend < 0 || branch < 0) {
    fails.push("수령 대기 섹션이나 보기 분기를 못 찾았다 — 마크업이 바뀌었으면 이 그물부터 고친다(침묵 통과 금지)")
  } else if (pend > branch) {
    fails.push("수령 대기 섹션이 보기 분기 안에 있다 — 위치별에서 사라져 주문해 둔 물건을 놓친다(운영자 지적 2026-09-23)")
  }
  const n = (client.match(/id="inventory-pending"/g) ?? []).length
  if (n > 1) fails.push(`수령 대기 섹션이 ${n}곳이다 — 보기마다 사본을 두면 한쪽만 고쳐진다`)
}

// ⑧ 상세 보기 — 요약 블록 · 창고 패널 · 발끝 두 줄 · '관리' 메뉴 (2026-10-12 재고 정비 3단계, 운영자 승인 배치).
//
//    요약 블록(지금 · 최근 점검 · 창고 + 변경)은 골격과 **한 함수**다(ghost 로 같은 글자를 투명하게 그린다). 사본을
//    두면 문장 길이가 갈리는 날 폭마다 줄 수가 달라져 로디드 순간 탭이 밀린다. 보기 발끝도 골격이 같은 높이로 선다.
//    발끝은 두 줄 고정이다 — 윗줄 [폐기][무상 입수][위치 이동] + '관리', 아랫줄 '재고 점검' 풀폭. wrap 이 돌아오면 버튼
//    자리가 기기마다 달라지고, 위치 이동이 점검과 한 무리로 서면 오클릭이 난다(오류신고 97839062). 보정은 기준선 리셋이라
//    메뉴 안이고, 품목 삭제는 서버가 지울 수 있을 때만 메뉴에 선다(판정은 서버 거부와 같은 계수 한 함수). 메뉴·창고 패널은
//    portal 로 띄운다 — 모달 본문 안 absolute 패널은 스크롤 컨테이너에 잘렸다(종전 창고 칩). 파괴 행 글자색은 별도 상수다 —
//    같은 클래스에 글자색 둘을 얹으면 생성 CSS 차례가 이겨 '삭제' 가 --warm-dark 로 그려졌다(3단계 렌더 실측).
//    검수 반영(같은 날): 관리 트리거 secondary · 키보드(열면 첫 행 포커스, 닫으면 트리거로 복귀, ↑↓·Tab) · 품목 삭제 적용취소 ·
//    위치 관리 메뉴 구분선 · 좁은 폭 13px · '(기본 창고)' · 보정 폼 제목 중복 제거.
{
  // 최상위 함수 한 채 — 머리에서 다음 최상위 선언 전까지. fnBody 는 머리 뒤 첫 '{' 를 몸통으로 잡아, 매개변수 타입
  // 리터럴(`}: {`)을 가진 함수에서는 타입만 잘라 온다.
  const topFn = name => {
    const start = client.indexOf(`\nfunction ${name}(`)
    if (start < 0) return ''
    const m = /\n(function |const |type |export |let )/.exec(client.slice(start + 1))
    return client.slice(start, m ? start + 1 + m.index : client.length)
  }
  const detail = topFn('DetailModal')
  const menu = topFn('DetailManageMenu')
  const picker = topFn('ItemHubPicker')
  const footSk = topFn('DetailViewFooterSkeleton')
  const locset = topFn('LocationSettingsModal')
  const summary = topFn('DetailViewSummary')
  const reconcile = topFn('TimelineReconcileForm')
  const actions = stripComments(readFileSync('app/(app)/inventory/actions.ts', 'utf8'))
  need('상세 모달·관리 메뉴·창고 패널·보기 발끝 골격을 찾음', detail.length > 2000 && menu.length > 500 && picker.length > 500 && footSk.length > 100,
    '함수 머리가 바뀌었으면 이 그물부터 고친다(침묵 통과 금지)')
  // 요약 한 벌
  need('보기 골격의 요약이 실제와 같은 함수다',
    /<DetailViewSummary row=\{row\} ghost \/>/.test(viewSkeleton) && /<DetailViewSummary row=\{row\}\s*\n?\s*hubPicker=\{<ItemHubPicker /.test(detail),
    '요약을 골격에 따로 그리면 문장·줄바꿈이 갈려 로디드 순간 탭과 이력이 밀린다')
  need('보기 발끝 골격이 두 줄(넷 + 풀폭)이고 불러오는 동안 선다',
    /!data && initialMode === 'view' \? \(\s*<DetailViewFooterSkeleton \/>/.test(detail) &&
    (footSk.match(/<div className=\{`h-11 flex-1 \$\{bar\}`\} \/>/g) ?? []).length === 3 &&
    /<div className=\{`h-11 w-11 \$\{bar\}`\} \/>/.test(footSk) && /<div className=\{`h-11 \$\{bar\}`\} \/>/.test(footSk),
    '발끝이 로디드 순간 생기면 그만큼 본문이 줄며 튄다')
  // 발끝 두 줄
  const foot = (() => { const i = detail.indexOf('footer={isViewMode ? ('); const j = detail.indexOf(') : !data && initialMode'); return i < 0 || j < 0 ? '' : detail.slice(i, j) })()
  need('보기 발끝을 찾음', foot.length > 200)
  need('보기 발끝에 flex-wrap 이 없다', !/flex-wrap/.test(foot),
    '접히면 버튼 자리가 기기마다 달라지고 파괴 버튼의 자리가 레이아웃 계산 결과가 된다(EntityModal 발끝과 같은 이유)')
  const top = foot.slice(foot.indexOf('<div className="flex gap-2">'), foot.indexOf('</div>', foot.indexOf('<div className="flex gap-2">')))
  need("윗줄이 [폐기][무상 입수][위치 이동] + '관리' 메뉴다",
    /onClick=\{\(\) => setMode\('disposal'\)\}>폐기<\/Btn>[\s\S]*onClick=\{\(\) => setMode\('addition'\)\}>무상 입수<\/Btn>[\s\S]*onClick=\{\(\) => setTransferOpen\(true\)\}>위치 이동<\/Btn>[\s\S]*<DetailManageMenu /.test(top) &&
    (top.match(/<Btn variant="secondary" size="md"/g) ?? []).length === 3,
    '운영자 승인 배치다(근거: 90일 실사용 위치 이동 10·맞바꿈 9, 보정 0)')
  need("아랫줄이 '재고 점검' 풀폭 primary 하나다",
    /<Btn variant="primary" size="md" fullWidth onClick=\{\(\) => setMode\('check'\)\}>재고 점검<\/Btn>/.test(foot) && (foot.match(/variant="primary"/g) ?? []).length === 1,
    '주 버튼은 하나이고 위치 이동과 다른 줄이다(오클릭 신고 97839062)')
  need('품목 삭제 노출과 서버 거부가 같은 계수 한 함수다',
    /onDelete=\{data\.deletable \? handleDeleteItem : undefined\}/.test(foot) &&
    /async function itemRecordCounts\(propertyId: string, it: \{ id: string; category: string; label: string \}\)/.test(actions) &&
    /const n = await itemRecordCounts\(propertyId, it\)\s*\n\s*if \(n\.total > 0\)/.test(actions) &&
    /itemRecordCounts\(propertyId, item\),/.test(actions) && /deletable: records\.total === 0,/.test(actions) &&
    !/onDelete=\{data\.timeline\.length/.test(foot),
    "이력 건수로 가르면 재고 제외 지출만 있는 품목에서 '보이는데 서버가 거부'가 난다(검수 실측 옥상 폐기물처리)")
  need('품목 삭제에 적용취소가 있다(같은 id 로 되살림)',
    /export async function deleteTrackedItemIfEmpty\(id: string\): Promise<\{ ok: true; undo: TrackedItemDeleteUndo \}/.test(actions) &&
    /export async function undoDeleteTrackedItem\(undo: TrackedItemDeleteUndo\)/.test(actions) &&
    /tx\.trackedItem\.create\(\{\s*data: \{\s*id: i\.id, propertyId,/.test(actions) &&
    /tx\.trackedItemLocation\.createMany/.test(actions) && /tx\.stockCheckDraft\.create/.test(actions) && /tx\.trackedItemMergeRule\.createMany/.test(actions) &&
    /pushToast\('success', '품목을 삭제했습니다', \{\s*action: \{ label: '적용취소', run: \(\) => \{ void undoDeleteTrackedItem\(res\.undo\)/.test(detail),
    '§16 모든 쓰기에 적용취소 — 지울 때 FK 로 함께 지워지는 위치 연결·임시저장·병합 규칙까지 되살려야 원래대로다')
  // 관리 메뉴
  need("'관리' 메뉴 항목이 보정 · 설정 · 숨기기 · 구분선 · 품목 삭제(파괴색) 차례다",
    />보정<\/button>[\s\S]*>설정<\/button>[\s\S]*>숨기기<\/button>[\s\S]*\{onDelete && \([\s\S]*border-t[\s\S]*className=\{MENU_ROW_DANGER\}[\s\S]*>품목 삭제<\/button>/.test(menu),
    '파괴 항목은 마지막·구분선 아래다(가이드 §13 모달 발끝 관리 메뉴)')
  need("'관리' 트리거가 secondary 이고 윗줄과 같은 좁은 폭 보정을 쓴다",
    /<Btn variant="secondary" size="md" className=\{`min-w-11 \$\{FOOT_TOP_BTN\}`\} aria-expanded=\{open\}/.test(menu) &&
    (foot.match(/className=\{`flex-1 \$\{FOOT_TOP_BTN\}`\}/g) ?? []).length === 3 &&
    /const FOOT_TOP_BTN = 'whitespace-nowrap max-sm:px-1\.5 max-\[359px\]:text-\[13px\]'/.test(client) && !/aria-haspopup/.test(menu),
    'ghost 는 바탕·테두리가 없어 버튼·메뉴로 안 읽혔다 · 360px 미만 14px 이면 글자 110% 에서 관리가 밀린다 · role 없는 aria-haspopup 은 거짓 약속이다')
  need('메뉴·창고 패널 키보드 — 열면 포커스, 닫으면 트리거 복귀, ↑↓·Tab 공용',
    /panelRef\.current\?\.querySelector<HTMLButtonElement>\('button:not\(:disabled\)'\)\?\.focus\(\)/.test(menu) &&
    /const close = \(\) => \{ setOpen\(false\); triggerRef\.current\?\.querySelector\('button'\)\?\.focus\(\) \}/.test(menu) &&
    /const run = \(f: \(\) => void\) => \{ close\(\); f\(\) \}/.test(menu) && /onKeyDown=\{e => menuKeyNav\(e, close\)\}/.test(menu) && /onClick=\{close\}/.test(menu) &&
    /button\[data-selected="true"\]:not\(:disabled\)/.test(picker) && /onKeyDown=\{e => menuKeyNav\(e, close\)\}/.test(picker) && /onClick=\{close\}/.test(picker) &&
    /<RowActionBtn disabled=\{disabled\} expanded=\{open\}/.test(picker) &&
    /menuPanelRef\.current\?\.querySelector<HTMLButtonElement>\('button:not\(:disabled\)'\)\?\.focus\(\)/.test(locset) &&
    /onKeyDown=\{e => menuKeyNav\(e, closeMenu\)\}/.test(locset) && /<RowActionBtn expanded=\{menuId === node\.id\}/.test(locset) &&
    /function menuKeyNav\(e: React\.KeyboardEvent<HTMLElement>, onTab: \(\) => void\)/.test(client),
    'portal 패널이라 포커스를 옮기지 않으면 키보드 사용자는 메뉴에 닿지 못하고, 닫은 뒤 포커스가 문서 끝으로 샌다')
  need("위치 관리 메뉴도 파괴 항목이 구분선 아래고 높이 예측이 실측이다",
    /<div className="my-1 border-t border-\[var\(--warm-border\)\]" \/>\s*<button type="button" disabled=\{pending\}\s*className=\{MENU_ROW_DANGER\}/.test(locset) &&
    /usePopoverAnchor<HTMLElement>\(\{ minWidth: 208, estimatedHeight: LOC_MENU_EST_H \}\)/.test(locset) && /const LOC_MENU_EST_H = 362/.test(client),
    '가이드 §13 과 한 문법 · 예측이 내용보다 작으면 위로 뒤집힐 때 메뉴 끝이 트리거를 덮는다')
  need('관리 메뉴가 정본 자리 산수·portal 로 위로 먼저 뜬다',
    /usePopoverAnchor<HTMLSpanElement>\(\{[^}]*placement: 'above'[^}]*\}\)/.test(menu) && /createPortal\(/.test(menu) && /fixed inset-0 z-\[var\(--z-lightbox\)\]/.test(menu),
    "아래로 뜨면 '재고 점검' 을 덮고 모달 밖으로 나간다 · 모달 본문 안 absolute 면 스크롤에 잘린다")
  need('파괴 행 글자색이 별도 상수이고 기본 행 글자색과 한 클래스에 겹치지 않는다',
    /const MENU_ROW_DANGER = `\$\{MENU_ROW_BOX\} text-\[var\(--danger-fg\)\] hover:bg-\[var\(--danger-bg\)\]`/.test(client) &&
    !/\$\{MENU_ROW\} text-\[var\(--danger-fg\)\]/.test(client) && !/text-\[var\(--warm-dark\)\]/.test((client.match(/const MENU_ROW_BOX = '[^']*'/) ?? [''])[0]),
    "글자색 둘이 한 클래스에 서면 생성 CSS 차례가 이겨 '삭제' 가 --warm-dark 로 그려진다")
  // 창고 패널
  need('창고 패널이 정본 자리 산수·portal·44px 행이고 따르기 행이 구분선 아래 마지막이다',
    /usePopoverAnchor<HTMLSpanElement>\(/.test(picker) && /createPortal\(/.test(picker) && /min-h-\[44px\]/.test(picker) &&
    /text-\[var\(--tc-text\)\] font-semibold/.test(picker) &&
    /<div className="my-1 border-t border-\[var\(--warm-border\)\]" \/>\s*<button[^>]*onClick=\{\(\) => pick\(null\)\}[\s\S]*기본 창고 따르기/.test(picker),
    '모달 본문 안 absolute 패널은 아래가 잘린다(종전 칩) · 지정 해제는 후보와 섞이면 안 된다')
  need('고른 행을 다시 누르면 쓰기가 없다', /const pick = \(locId: string \| null\) => \{ close\(\); if \(locId !== hubLocationId\) onPick\(locId\) \}/.test(picker),
    '같은 값으로 저장하면 헛 토스트와 헛 적용취소가 선다')
  need('창고 패널 높이 상한이 화면에 남은 자리다', /maxHeight: Math\.max\(160, window\.innerHeight - pos\.top - 8\)/.test(picker) && !/maxHeight: '320px'/.test(picker),
    '고정 320px 이면 긴 경로 한 줄이 꺾일 때 4px 만 넘쳐 안쪽 스크롤이 생겼다')
  need("기본 창고를 따르면 요약 값 뒤에 '(기본 창고)' — 패널 체크와 같은 값(row.hubLocationId)",
    /const followsDefault = row\.hubLocationId == null && itemHub != null/.test(summary) && /\{followsDefault && <span className="whitespace-nowrap text-\[var\(--warm-muted\)\]">\{g\(' \(기본 창고\)'\)\}<\/span>\}/.test(summary) &&
    /<ItemHubPicker locations=\{row\.locations\} hubLocationId=\{row\.hubLocationId\}/.test(detail),
    "패널 체크는 '기본 창고 따르기' 인데 요약이 위치 이름만 말하면 둘이 다른 말을 한다 · 출처가 갈리면 갱신 사이에 어긋난다")
  need('창고 변경이 종전 적용취소 경로를 그대로 쓴다',
    /onPick=\{changeItemHub\}/.test(detail) && /setItemHub\(trackedItemId, prevHubId\)/.test(detail),
    '1단계 창고 변경 적용취소(§16)')
  // 낱말
  need('발끝·보정 폼 낱말이 정리됐다',
    !/보정 \(차이 소모 제외\)/.test(client) && !/\+ 무상 입수<\/Btn>/.test(detail) && !/보정 끼워넣기<\/p>/.test(client) &&
    !/>숨김<\/Btn>/.test(detail) && !/이 품목 창고:/.test(client) && !/bg-\[var\(--honey\)\]\/10/.test(detail) &&
    reconcile.length > 500 && !/>보정<\/p>/.test(reconcile),
    "'보정 (차이 소모 제외)' 는 사실과 다르다(보정 폼에 차이를 소모로 넣는 선택지가 있다) · honey 칩은 경고 배지처럼 읽혔다")
}

console.log(`\n[재고 기본 보기(위치별) 배선] 위반 ${fails.length}건`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
