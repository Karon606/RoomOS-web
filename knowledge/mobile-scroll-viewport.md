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
