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

console.log(`\n[키보드 오버레이 정본] 선언 ${declaring.size}개 / 위반 ${violations.length}건`)
for (const v of violations) console.log('  - ' + v)
if (violations.length > 0) process.exit(1)
