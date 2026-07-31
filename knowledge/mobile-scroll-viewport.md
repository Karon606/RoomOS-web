# 모바일 스크롤·뷰포트 함정 (iOS/Android 엔진 차이)

신고 d8554128·9ee1e70f(갤럭시 스크롤 먹통, 2026-07-30) 수습에서 확정된 사실. 관련: [[domain-inventory]], loop.md 1번 게이트.

## overscroll-behavior: contain 은 "진짜 스크롤러"에만

- **진짜 스크롤러** = 실효 높이 제약이 있어 실제로 넘칠 수 있는 요소. `max-h-*`, 또는 부모 체인이 진짜 flex column + 높이 상한(`max-h-[85vh] flex-col` 등)일 때의 `flex-1`.
- **가짜 스크롤러** = `overflow-y-auto` 는 있지만 높이 제약이 무효라 콘텐츠만큼 늘어나 한 번도 스스로 스크롤되지 않는 요소. 대표: Modal 본문(블록 컨테이너) 아래에서 `flex-1` 이 무효가 된 풀블리드 내부 div.
- 가짜 스크롤러에 `overscroll-contain` 을 붙이면 **Android Chrome(Blink)** 은 스펙대로 터치 제스처를 그 요소에 래치한 뒤 체이닝을 끊어 **화면 전체가 스크롤 먹통**이 된다. iOS WebKit 은 스크롤 불가 요소를 래치하지 않고 부모로 넘겨 정상 — "아이폰은 되는데 갤럭시만 안 됨" 패턴의 전형.
- 전수 작업 시 클래스 문자열(`overflow-y-auto` 유무)로 판정하지 말고 **부모 체인의 실효 높이 제약**을 먼저 판별할 것. 2026-07-29 회귀가 정확히 이 판정 실수(클래스 문자열만 보고 26곳 일괄 적용)였다.

## 키보드와 뷰포트 (2026-07-29 Modal 개선)

- iOS Safari: 소프트 키보드는 layout viewport(dvh)를 줄이지 않고 visualViewport 만 줄인다. 고정 높이 모달은 키보드 뒤에 깔림 → Modal.tsx 가 `visualViewport.resize` 를 구독해 `--modal-vvh` 로 maxHeight 를 줄인다(useEffect 안, null 폴백 100dvh, body 고정 금지 — 신고 d4cf82d5 회귀 전례).
- Android Chrome: 키보드가 layout viewport 자체를 줄이므로 dvh 도 함께 줄어 이 문제가 원래 없다. visualViewport 값도 정상이라 위 개선과 충돌하지 않는다.
- iOS 에서 fixed/sticky 는 핀치줌 시 layout viewport 에 고정되어 시야 밖으로 나간다 — 줌 허용 페이지(계약서 서명)의 상시 액션은 문서 흐름 안(in-flow)에 둬야 확실하다(신고 d9f93bdd).

## 검증 규칙

- 스크롤·뷰포트·키보드 접점을 바꾸면 iOS Safari + Android Chrome **두 엔진 실기 확인**이 필수다(loop.md 1번). 에뮬레이터는 터치 래치를 재현하지 못한다.
- 풀블리드 모달 내부의 죽은 `overflow-y-auto`(가짜 스크롤러 잔재)는 2026-07-30 기준 정리하지 않고 남겨둠(회귀 반경 최소화) — 후속 정리 시 Modal 본문을 flex-col 로 바꿔 내부 스크롤러를 진짜로 만드는 구조 정석과 함께 검토.

## 셸 밖 단독 라우트의 스크롤 계약 (신고 000a22ed, 2026-07-31)

`globals.css` 가 html·body 를 `overflow:hidden; height:100%` 로 잠근다(iOS 헤더 보호). 따라서
**AppShell 밖 라우트의 기본값은 "스크롤 불가"** 이고, 각 페이지가 둘 중 하나를 명시 선언해야 한다.

- **A. 자체 스크롤러** — `h-dvh` 컨테이너 + 내부 `overflow-y-auto` (셸형: AppShell·admin)
- **B. 문서 스크롤** — `<DocumentScroll />` 마운트 (폼·문서형). `html.doc-scroll` 로 그 페이지에서만 잠금 해제.

판정 기준: 상단 고정 크롬이 필요하면 A, 그 외 폼·문서형은 B. B 가 기본 권장이다(iOS 네이티브
focus-scroll·visual viewport 팬 경로와 가장 잘 맞고, DOM 구조를 바꾸지 않는다).

**함정 3가지.**
1. **잠복형이다.** 콘텐츠가 짧으면 무증상이라 리뷰를 통과하고, 몇 달 뒤 기능이 늘면 하단 버튼에
   닿을 수 없게 된다. 이 신고의 페이지는 2026-07-10 에 이미 "버튼 잘림"으로 신고됐는데(344001b)
   근본 원인 대신 하단 여백을 늘려 **콘텐츠를 더 길게 만드는** 증상 패치를 했고, 7/27 스테퍼 추가로
   임계치를 넘었다. 증상 패치가 다음 사고의 연료가 된 전형.
2. **`overflow:hidden` 이어도 프로그램적 스크롤은 된다.** 입력칸을 탭하면 iOS focus-scroll 이 그
   칸까지는 밀어준다. 그래서 "작성은 되는데 저장을 못 누른다"는 형태로 나타난다.
3. **형제 코드를 통째로 복사하지 말 것.** contract·residence-cert 의 styled-jsx 에는 배경색이
   하드코딩돼 있다(인쇄 문서는 라이트 고정이라 의도된 값). 베끼면 다크모드가 깨진다.
   `DocumentScroll` 은 overflow·height 만 건드리고 배경엔 손대지 않는다.

**감지**: `node scripts/check-standalone-scroll.mjs` — 셸 밖 page.tsx 가 A/B 중 하나를 선언했는지 검사.
도입 시 마운트를 빼고 돌려 신고 상황을 정확히 재현·탐지함을 확인했다(위반 1 → 0).

**제약**: `ViewportOffsetGuard`(키보드 닫힘 시 `scrollTo(0,0)`)는 "scrollY 는 항상 0"이라는 A 패턴
전제 위에서만 옳다. 루트 layout 으로 승격하면 B 패턴 페이지들이 "타이핑 끝내면 맨 위로 튀는" 버그를
얻는다. 현재는 `app/(app)/layout.tsx` 에만 있다 — 여기서 옮기지 말 것.
