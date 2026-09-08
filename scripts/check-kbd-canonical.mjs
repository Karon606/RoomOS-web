// fixed inset-0 오버레이가 키보드 정본(useVisibleBand)을 쓰는지 검사 — 읽기 전용, 위반 시 exit 1.
// 키보드 패널 2026-09-02 3단계. 수제 오버레이 여섯이 --kbd-inset 하단 한 항만 밀다가 키보드가
// 서면 헤더가 화면 위로 최대 205px 잘렸다(신고 2026-08-30 계열). 전부 훅에 편입했지만, 다음에
// 생길 일곱 번째 오버레이가 또 제 방식으로 만들면 같은 클래스가 재발한다 — 그 자리를 지킨다.
//
// 규칙: fixed inset-0 을 선언한 tsx 는 useVisibleBand(...) 를 호출하거나 ALLOW 에 사유와 함께
// 올라야 한다. Modal 임포트는 통과 사유가 아니다 — InventoryClient 가 Modal 을 쓰면서도 제
// 오버레이 둘을 따로 갖고 있던 실례가 있다. 새 딤·뷰어류도 ALLOW 등재라는 관문을 거치게 한다.
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

// 파일 → 허용 사유. 텍스트 입력이 없어 소프트 키보드와 무관한 층만 올린다.
const ALLOW = new Map([
  ['app/(app)/floor-plan/FloorPlanEditor.tsx', '메뉴 외부클릭 닫기 투명층. 입력 폼은 전부 정본 Modal 안'],
  ['components/ReceiptScanModal.tsx', '영수증 모서리 드래그 보정 화면 — 캔버스 조작뿐, 텍스트 입력 없음'],
  ['components/brand/SplashController.tsx', '스플래시 — 입력 없음'],
  ['components/brand/SplashIntro.tsx', '스플래시 — 입력 없음'],
  ['components/brand/SplashScreen.tsx', '스플래시 — 입력 없음'],
  ['components/brand/SplashStatic.tsx', '스플래시 — 입력 없음'],
  ['components/entity-modal/widgets/PhotoStrip.tsx', '사진 뷰어 — 입력 없음'],
  ['components/room-manage/PhotoViewer.tsx', '사진 뷰어 — 입력 없음'],
  ['components/ui/ImageLightbox.tsx', '이미지 라이트박스 — 입력 없음'],
  ['components/layout/Sidebar.tsx', '모바일 드로어 딤 — 입력 없음'],
  ['components/ui/DatePicker.tsx', '탭 조작 팝오버(자리는 usePopoverAnchor) — 소프트 키보드가 안 뜬다'],
])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx$/.test(p)) out.push(p)
  }
  return out
}
// 주석을 지운 뒤 판정 — 설명 주석의 같은 글자에 속은 전례가 있다('://'는 URL 이라 예외)
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (_, p) => p)

const violations = []

// 0) 정본 자체가 살아 있는지 — 소비자만 검사하면 알맹이가 빠져도 전부 통과한다.
try {
  const hook = strip(readFileSync('lib/useVisibleBand.ts', 'utf8'))
  if (!/visualViewport/.test(hook) || !/addEventListener\(['"]resize['"]/.test(hook)) {
    violations.push('lib/useVisibleBand.ts — visualViewport resize 구독이 사라짐. 훅을 불러도 아무 값이 안 나온다')
  }
  if (!/setProperty\(/.test(hook)) {
    violations.push('lib/useVisibleBand.ts — CSS 변수 대입이 사라짐. 구독은 도는데 화면은 그대로다')
  }
  const modal = strip(readFileSync('components/ui/Modal.tsx', 'utf8'))
  if (!/useVisibleBand\(/.test(modal)) {
    violations.push('components/ui/Modal.tsx — 정본 훅 호출이 사라짐. 모든 모달이 키보드 보정을 잃는다')
  }
} catch {
  violations.push('lib/useVisibleBand.ts 를 읽을 수 없음 — 보이는 띠 정본이 사라졌다')
}

// 1) 소비자 전수 — fixed inset-0 선언자는 훅을 호출하거나 ALLOW 사유가 있어야 한다.
const files = [...walk('components'), ...walk('app')]
const declaring = new Set()
for (const f of files) {
  const src = strip(readFileSync(f, 'utf8'))
  if (!/fixed inset-0/.test(src)) continue
  declaring.add(f)
  if (/useVisibleBand\(/.test(src)) continue   // 임포트가 아니라 호출을 본다
  if (ALLOW.has(f)) continue
  violations.push(`${f} — fixed inset-0 오버레이가 정본 훅(useVisibleBand) 없이 섰다. 키보드가 서면 위 겹침·시트 높이를 모른다(가이드 §30). 텍스트 입력이 정말 없다면 ALLOW 에 사유와 함께 올릴 것`)
}
// 2) 허용 목록 케케묵음 — 선언이 사라진 파일이 남아 있으면 목록이 거짓이 된다.
for (const f of ALLOW.keys()) {
  if (!declaring.has(f)) violations.push(`${f} — ALLOW 에 있는데 fixed inset-0 선언이 없다. 목록에서 내릴 것`)
}

// 3) 복귀 재동기화 관문(2026-09-08) — 첫 패스가 낡은 스냅샷으로 화면을 줄이지 못하게 한다.
//
// 앱 전환·잠금에서 돌아온 직후 프레임의 vv 는 아직 옛 값이다. 그 값을 첫 패스가 받으면 짧은
// 창·어긋난 인셋이 그대로 박힌다. 판정은 정본 resumeAllowsShrink 가 하고 소비자는 두 패스를
// 그 함수로만 나눠야 한다 — 한쪽이 syncSize(true) 로 되돌아가면 이 관문이 통째로 없어진다.
const need = (file, res, why) => {
  let src
  try { src = strip(readFileSync(file, 'utf8')) } catch { violations.push(`${file} — 읽을 수 없음`); return }
  for (const [re, msg] of res) if (!re.test(src)) violations.push(`${file} — ${msg}${why ? ` (${why})` : ''}`)
}
need('lib/modalViewport.ts', [
  [/export function resumeAllowsShrink\(/, '정본 resumeAllowsShrink 가 사라짐. 복귀 첫 패스의 축소 금지가 없어진다'],
])
need('lib/useVisibleBand.ts', [
  [/resumeAllowsShrink\(/, '복귀 재동기가 정본 관문(resumeAllowsShrink)을 안 지난다'],
  [/editableFocused\(\)/, '복귀 재동기가 포커스를 묻지 않는다. 포커스가 없으면 작은 띠는 낡은 값이다'],
  [/resyncPass\(\s*1\s*\)/, '복귀 첫 패스(1)가 사라짐'],
  [/requestAnimationFrame\([^\n]*resyncPass\(\s*2\s*\)/, '복귀 두 번째 패스(rAF 안의 2)가 사라짐'],
])
// 편집 포커스 판정은 한 곳에서만 한다 — 두 소유자가 생기면 한쪽만 참인 구간에서 어긋난다.
need('lib/editableTarget.ts', [
  [/export function isEditableTarget\(/, '편집 요소 판정 정본이 사라짐'],
  [/export function editableFocused\(/, '포커스 여부 정본이 사라짐'],
])
need('components/layout/ViewportOffsetGuard.tsx', [
  [/from '@\/lib\/editableTarget'/, '편집 요소 판정을 정본에서 안 가져온다'],
  [/editableFocused\(\)/, '복귀 재동기가 포커스를 묻지 않는다. 키보드가 없는데 인셋이 남는다'],
])
// 판정 사본이 되살아나면 두 소유자가 갈린다 — 여기서만 막는다(정본은 lib/editableTarget).
try {
  const guard = strip(readFileSync('components/layout/ViewportOffsetGuard.tsx', 'utf8'))
  if (/function isEditable\s*\(/.test(guard)) {
    violations.push('components/layout/ViewportOffsetGuard.tsx — 편집 요소 판정 사본이 되살아났다. lib/editableTarget 만 쓸 것')
  }
} catch { /* 위에서 이미 신고됨 */ }

// 4) 계측 배선과 개인정보 경계(2026-09-08) — 다음 재현 한 번을 사실로 바꾸는 자리다.
need('lib/viewportProbe.ts', [
  [/export function viewportProbe\(/, '계측 정본이 사라짐'],
  [/visualViewport/, '보이는 띠를 안 담는다. 이 신고 축은 그 숫자가 없으면 또 추측이 된다'],
  [/--modal-vvh/, '모달 띠 높이 변수를 안 담는다'],
  [/--kbd-inset/, '키보드 인셋 변수를 안 담는다'],
])
// 값·본문 텍스트는 절대 담지 않는다. 신고는 운영자 기기를 떠나 저장되고, 거기 입주자의 이름·
// 연락처가 실려 있으면 그 자체가 사고다(첨부 공개권한 사건과 같은 클래스).
{
  let src = ''
  try { src = strip(readFileSync('lib/viewportProbe.ts', 'utf8')) } catch { /* 위에서 이미 신고됨 */ }
  const leaks = [
    [/\.value\b/, '입력값(.value)'],
    [/placeholder/, 'placeholder'],
    [/textContent|innerText|innerHTML|outerHTML/, '본문 텍스트'],
  ]
  for (const [re, what] of leaks) {
    if (re.test(src)) violations.push(`lib/viewportProbe.ts — ${what} 을 읽는다. 계측은 기하와 요소의 종류만 담는다`)
  }
}
need('components/ErrorReportButton.tsx', [
  [/viewportProbe\(\)/, '신고 제출이 화면 계측을 안 담는다'],
  [/note\.trim\(\)/, '메모가 계측보다 앞에 오는 조립이 사라짐. 운영자가 읽는 문장이 먼저다'],
])
need('components/ui/Modal.tsx', [
  [/data-modal-panel/, '계측이 모달을 찾을 손잡이가 사라짐(lib/viewportProbe 가 이 표식으로 읽는다)'],
])

console.log(`\n[키보드 오버레이 정본] 선언 ${declaring.size}개 / 위반 ${violations.length}건`)
for (const v of violations) console.log('  - ' + v)
if (violations.length > 0) process.exit(1)
