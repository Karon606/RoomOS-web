// AppShell 밖 단독 라우트가 스크롤 권한을 선언했는지 검사 — 읽기 전용, 위반 시 exit 1.
// globals.css 가 html·body 를 overflow:hidden 으로 잠그므로(iOS 헤더 보호), 셸 밖 페이지의 기본값은
// '스크롤 불가'다. 콘텐츠가 짧을 땐 무증상이라 리뷰를 통과하고, 몇 달 뒤 기능이 늘면 하단 버튼에
// 닿을 수 없게 된다(신고 000a22ed — 같은 페이지가 344001b 로 한 번 증상 패치된 뒤 재발).
// 두 정본 중 하나를 반드시 선언해야 한다.
//   A: 자체 스크롤러 — h-dvh/h-screen 컨테이너 + overflow-y-auto (셸형: AppShell·admin)
//   B: 문서 스크롤   — <DocumentScroll /> 마운트 (폼·문서형). styled-jsx 로 html/body 를 직접
//      오버라이드한 기존 2곳(contract·residence-cert)도 B 로 인정한다.
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, dirname, relative } from 'path'

const APP = 'app'
// (app)·admin 은 자체 셸(A)이 보증, api 는 UI 없음
const EXCLUDED = [/^app\/\(app\)\//, /^app\/admin\//, /^app\/api\//]

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx$/.test(p)) out.push(p)
  }
  return out
}

const A_SHELL = /h-dvh|h-screen/
const A_SCROLLER = /overflow-y-auto/
const B_MARKER = /<DocumentScroll\b|html\s*,\s*body[^}]*overflow-y:\s*auto/
// 뷰포트 높이를 하한으로 잡는 루트 컨테이너 — 넘치면 잘리는 후보
// height 로 잡는 형태도 대상이다 — minHeight 만 보다가 인라인 height:'100dvh' 페이지를
// '뷰포트를 안 채운다'로 건너뛰었다(서류 뷰어 신설 때 실측)
const FULL_HEIGHT = /min-h-(screen|dvh)|h-dvh|h-screen|(min-h|min-height|height):\s*['"]?100(vh|dvh)['"]?/

const violations = []

// 0) 정본 컴포넌트 자체가 살아 있는지 — 마운트만 검사하면 알맹이가 빠져도 통과한다.
//    (실제로 이 검사를 넣기 전, DocumentScroll 안의 클래스 토글을 지워도 감지망이 통과했다)
try {
  const docScroll = readFileSync('components/layout/DocumentScroll.tsx', 'utf8')
  if (!/classList\.add\(['"]doc-scroll['"]\)/.test(docScroll)) {
    violations.push('components/layout/DocumentScroll.tsx — doc-scroll 클래스 부착이 사라짐. 마운트해도 스크롤이 살아나지 않는다')
  }
  if (!/classList\.remove\(['"]doc-scroll['"]\)/.test(docScroll)) {
    violations.push('components/layout/DocumentScroll.tsx — 언마운트 해제가 사라짐. 셸 페이지로 돌아가도 문서 스크롤이 남아 이중 스크롤이 된다')
  }
} catch {
  violations.push('components/layout/DocumentScroll.tsx 를 읽을 수 없음 — 정본 컴포넌트가 사라졌다')
}

// 0b) 배경 잠금 정본 — 오버레이가 떠 있는 동안 뒤 페이지가 스크롤되지 않게 한다(F페이즈 회귀 봉합).
try {
  const lock = readFileSync('lib/scrollLock.ts', 'utf8')
  if (!/doc-scroll-locked/.test(lock)) {
    violations.push('lib/scrollLock.ts — doc-scroll-locked 토글이 사라짐. 문서 스크롤 페이지에서 모달 배경이 스크롤된다')
  }
  const modal = readFileSync('components/ui/Modal.tsx', 'utf8')
  if (!/lockBackgroundScroll\(\)/.test(modal)) {   // import 만 남아도 통과하지 않게 '호출'을 본다
    violations.push('components/ui/Modal.tsx — 배경 잠금 호출이 사라짐(회귀 전례: DocumentScroll 도입으로 전제가 깨진 건)')
  }
  const css = readFileSync('app/globals.css', 'utf8')
  if (!/html\.doc-scroll\.doc-scroll-locked/.test(css)) {
    violations.push('app/globals.css — doc-scroll-locked 잠금 규칙이 사라짐')
  }
} catch {
  violations.push('배경 잠금 정본(lib/scrollLock.ts) 을 읽을 수 없음')
}

// 0c) 셸 안 키보드 도달성 정본 (신고 e1df22e9·395652b3, 2026-08-04).
//   iOS 는 키보드가 떠도 layout viewport(dvh)를 안 줄인다. 셸은 h-dvh 고정이라 스크롤 여유가
//   1px 도 안 늘고, 하단 입력칸이 키보드 뒤에 깔린 채 손가락으로 꺼낼 수 없다.
//   Modal 은 --modal-vvh 로 보정하는데 인라인 패널은 모달 껍데기를 벗어서 그 보정을 못 받았다.
//
//   "이 화면이 키보드에 가리나"는 정적으로 판정 불가다(JSX 서브트리 판정이고, 같은 노드가
//   런타임 값에 따라 두 모양이 되는 경우가 실재한다 — inline 분기). 그래서 결함을 찾지 않고
//   **고친 정본이 다시 사라지는지**를 지킨다. 0·0b 절과 같은 모양이다.
try {
  const guard = readFileSync('components/layout/ViewportOffsetGuard.tsx', 'utf8')
  // 문자열 존재만 보면 이름만 바꿔도 통과한다 — 구독·대입을 호출 형태로 본다
  if (!/addEventListener\(['"]resize['"]/.test(guard)) {
    violations.push('components/layout/ViewportOffsetGuard.tsx — visualViewport resize 구독이 사라짐. 키보드가 열려도 셸에 여유를 아무도 만들지 않는다')
  }
  if (!/setProperty\(KBD_INSET|setProperty\(['"]--kbd-inset['"]/.test(guard)) {
    violations.push('components/layout/ViewportOffsetGuard.tsx — --kbd-inset 대입이 사라짐. 구독은 도는데 값이 CSS 로 나가지 않아 화면은 그대로다')
  }
  // 여유를 만드는 것과 그 자리로 데려가는 것은 다른 일이다. 구독과 실행을 따로 건다(신고 4555b1fd).
  if (!/addEventListener\(['"]focusin['"]/.test(guard)) {
    violations.push('components/layout/ViewportOffsetGuard.tsx — 포커스 구독이 사라짐. 키보드는 열리는데 가려진 칸으로 아무도 데려다주지 않는다')
  }
  // fixed 조상에서 멈추지 않으면 모달 안에서 배경(.app-main)을 잡아 배경만 스크롤된다(신고 716e7b0c 조사)
  if (!/position\s*===\s*['"]fixed['"]/.test(guard)) {
    violations.push('components/layout/ViewportOffsetGuard.tsx — 재노출이 fixed 조상에서 멈추지 않는다. 모달 안에서 창은 그대로 두고 배경만 스크롤된다')
  }
  // 이름이 아니라 처방의 행위 자체를 본다 — 리네임에 안 죽는다
  if (!/\.scrollTop\s*\+?=/.test(guard)) {
    violations.push('components/layout/ViewportOffsetGuard.tsx — 재노출 스크롤 대입이 사라짐. 구독은 도는데 아무것도 스크롤하지 않는다')
  }
  const appLayout = readFileSync('app/(app)/layout.tsx', 'utf8')
  // 태그 닫힘까지 본다 — 접두만 보면 ViewportOffsetGuardX 로 개명해도 통과한다(역주입 실측)
  if (!/<ViewportOffsetGuard\s*\/?>/.test(appLayout)) {
    violations.push('app/(app)/layout.tsx — ViewportOffsetGuard 마운트가 사라짐. 가드가 살아 있어도 셸에 안 붙어 무동작이다')
  }
  // admin 셸도 같은 A 패턴 셸이다(키보드 패널 2026-09-02 3단계). 마운트가 빠지면 관리자
  // 화면만 --kbd-inset 이 영영 0 이라 무증상으로 돌아간다 — (app) 축과 따로 지킨다.
  const adminLayout = readFileSync('app/admin/layout.tsx', 'utf8')
  if (!/<ViewportOffsetGuard\s*\/?>/.test(adminLayout)) {
    violations.push('app/admin/layout.tsx — ViewportOffsetGuard 마운트가 사라짐. 관리자 화면은 키보드가 서도 여유가 안 생긴다')
  }
  // 여유는 main 자기 패딩이 만든다(.app-main 재사용 금지 — 그쪽 기본 여백 규칙까지 딸려 온다)
  if (!/paddingBottom:\s*'var\(--kbd-inset/.test(adminLayout)) {
    violations.push('app/admin/layout.tsx — main 의 --kbd-inset 패딩이 사라짐. 가드는 도는데 관리자 하단 입력칸이 키보드에 덮인다')
  }
  // 두 규칙 양쪽에 있어야 한다. 한쪽만 남으면 그 화면 폭에서만 되살아난다.
  const css = readFileSync('app/globals.css', 'utf8')
  const appMainDecls = (css.match(/\.app-main\s*\{[^}]*padding-bottom:[^;]*;/g) ?? [])
  if (appMainDecls.length < 2) {
    violations.push('app/globals.css — .app-main 하단 패딩 선언을 다 찾지 못했다. 키보드 여유 대조가 건너뛰어졌다. 감지망을 고쳐야 한다')
  } else if (appMainDecls.some(d => !d.includes('var(--kbd-inset'))) {
    violations.push('app/globals.css — .app-main 하단 패딩 중 --kbd-inset 을 안 더하는 선언이 있다. 그 화면 폭에서 키보드가 하단 입력칸을 덮는다')
  }
} catch {
  violations.push('components/layout/ViewportOffsetGuard.tsx 를 읽을 수 없음 — 키보드 보정 정본이 사라졌다')
}

const pages = walk(APP).filter(p => /\/page\.tsx$/.test(p) && !EXCLUDED.some(re => re.test(p)))

for (const page of pages) {
  // 라우트 디렉토리의 모든 tsx + 상위 layout 들을 한 덩어리로 본다
  // (페이지가 뷰를 별도 컴포넌트로 분리하고 거기서 선언하는 경우가 정상 패턴)
  const dir = dirname(page)
  const sources = walk(dir)
  let cur = dir
  while (cur !== APP && cur !== '.') {
    cur = dirname(cur)
    const lay = join(cur, 'layout.tsx')
    try { statSync(lay); sources.push(lay) } catch { /* 없으면 건너뜀 */ }
  }
  // 주석을 지운 뒤 판정한다. 서류 뷰어를 만들며 "A 계약 — h-dvh 컨테이너 + overflow-y-auto" 라고
  // **설명하는 주석** 때문에 선언을 지워도 통과했다(실측). 같은 함정이 open.kakao.com 에서도 났다.
  // '://' 는 URL 이라 줄 주석으로 보지 않는다.
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_, p) => p)
  const texts = sources.map(f => strip(readFileSync(f, 'utf8')))
  const blob = texts.join('\n')

  const hasA = texts.some(t => A_SHELL.test(t) && A_SCROLLER.test(t))
  const hasB = B_MARKER.test(blob)
  if (hasA || hasB) continue
  if (!FULL_HEIGHT.test(blob)) continue   // 뷰포트를 채우지 않는 페이지는 대상 아님

  violations.push(`${relative('.', page)} — 스크롤 선언 없음(A: 자체 스크롤러 / B: <DocumentScroll /> 중 하나 필요)`)
}

// 2) 셸 밖 라우트가 다이얼로그·토스트를 부르면서 호스트를 안 붙였는지 (뷰어 실측, 2026-08-04).
//    confirmDialog 는 호스트가 없으면 큐에만 쌓이고 아무도 안 비워 **Promise 가 영원히 안 풀린다.**
//    버튼은 눌러도 아무 일이 안 일어나고, pushToast 도 구독자가 0이라 실패 알림조차 안 뜬다.
//    무증상이라 리뷰를 통과한다 — 서류 뷰어가 그렇게 신설된 지 사흘간 [보내기]가 죽어 있었다.
//    AppShell 안은 셸이 호스트를 보증하므로 대상이 아니다(EXCLUDED 가 이미 걸러낸다).
const CALLERS = /\bconfirmDialog\(|\bchoiceDialog\(|\balertDialog\(|\bpushToast\(|<SendDocButton\b|<SaveDocImageButton\b/
for (const page of pages) {
  const dir = dirname(page)
  const own = walk(dir)
  const layouts = []
  let cur = dir
  // 자기 디렉토리의 layout 도 포함한다 — 라우트 자신이 붙이는 경우가 정상 패턴이다
  for (const f of own) if (/\/layout\.tsx$/.test(f)) layouts.push(f)
  while (cur !== APP && cur !== '.') {
    cur = dirname(cur)
    const lay = join(cur, 'layout.tsx')
    try { statSync(lay); layouts.push(lay) } catch { /* 없으면 건너뜀 */ }
  }
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_, p) => p)
  // 호출 여부는 라우트 자기 소스에서만 본다. layout 까지 넣으면 호스트 마운트가 스스로를 근거로 만든다
  const callsIn = own.filter(f => !/\/layout\.tsx$/.test(f)).map(f => strip(readFileSync(f, 'utf8')))
  if (!callsIn.some(t => CALLERS.test(t))) continue
  const layBlob = layouts.map(f => strip(readFileSync(f, 'utf8'))).join('\n')
  // 태그 닫힘까지 본다 — 접두만 보면 ConfirmHostX 로 개명해도 통과한다
  if (!/<ConfirmHost\s*\/?>/.test(layBlob)) {
    violations.push(`${relative('.', page)} — 다이얼로그를 부르는데 <ConfirmHost /> 가 layout 사슬에 없음. 확인 창이 큐에만 쌓여 버튼이 무반응이 된다`)
  }
  if (!/<SaveFeedback\s*\/?>/.test(layBlob)) {
    violations.push(`${relative('.', page)} — 토스트를 쓰는데 <SaveFeedback /> 가 layout 사슬에 없음. 성공·실패 알림이 조용히 버려진다`)
  }
}

console.log(`\n[단독 라우트 스크롤] 검사 ${pages.length}개 / 위반 ${violations.length}건`)
for (const v of violations) console.log('  - ' + v)
if (violations.length > 0) {
  console.log('\n  셸(app/(app), app/admin) 밖 페이지는 스크롤이 기본으로 꺼져 있다.')
  console.log('  폼·문서형이면 <DocumentScroll /> 을 마운트하면 된다(components/layout/DocumentScroll.tsx).')
  process.exit(1)
}
