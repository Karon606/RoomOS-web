# 입퇴실 캘린더 0단계 — 사건 문구·월 동기화·창 미끄러뜨리기 (2026-08-20, 운영자 승인)

운영자 실기로 원인이 확정됐다. 스크롤 → 월 동기화가 통째로 죽어 있어서(replaceState 가
Next 라우터 패치의 `__NA` 가드에 걸린다) 신고 3·4·5 가 전부 '변화 없음'으로 보였다.
살리는 순간 전역 월 누수와 미래 월 경고 점멸이 함께 깨어나므로 한 묶음으로 닫았다.

## 0단계 — 준비·패널
- [x] 정본 정독(AGENTS·loop·Work_log 2026-08-19/20 캘린더 엔트리·knowledge·brand-guide §03~§05)
- [x] 워크트리 환경(node_modules·.env.local 심링크, 스키마 본선과 SHA 동일 확인)
- [x] 기준선 실측(tsc 0 · move-calendar 회귀 160 · eslint 491 · 드리프트 행 41·막대 72 위반 0)
- [x] Next 라우터 패치 원인 직접 확인(app-router.js:255~278 · copyNextJsInternalHistoryState:84~94)
- [x] 시공 전 상태 실측 저장(주소창만 바뀌고 셀렉터·탭은 8월 고정, 508호 문구 left 66 고정)
- [x] 전문가 패널 4인 회수 — 정보구조 UX · 웹디자이너 · 프런트엔드 성능 · 호실 도메인 **전원 회신**
- [x] 설계 확정(이견·미채택 근거는 context-notes)

## 1항목 — 사건 문구 sticky 해제 (38f3eb38)
- [x] 조립이 startLabel·endLabel·stateLabel 을 따로 낸다(화면 재분할 금기)
- [x] label 한 문자열은 종전 그대로 — title·aria·회귀가 딛는다
- [x] 이름은 sticky 유지, 사건 문구는 막대 시작·끝에 고정
- [x] 상태 문구('퇴실일 미정')는 사건이 아니라 상태라 이름과 함께 흐른다
- [x] 역전 막대는 문구를 안 세운다(기하와 날짜가 어긋나는 자리)
- [x] place()·Placed.ink·공백 캡션 계산 무변경 — 캡션 20개 불변 실측
- [x] 회귀 160 유지

## 2항목 — 월 동기화 살리기 + 전역 누수 차단 (6fb5d2fe)
- [x] replaceState 첫 인자를 null 로 · 틀린 주석 정정
- [x] 트랙 위치를 `?at=` 으로(TRACK_MONTH_KEY) · `?month=` 는 안 건드린다
- [x] MonthSelector 에 paramKey·fallbackKey 개방(형제 9곳 무변경)
- [x] localStorage 전역 월 쓰기는 전역 키일 때만
- [x] applyMonth·clearRoomUrlParams 를 발화 시점 URL 재구성으로(디바운스 레이스)
- [x] 트랙 끝 clamp 보정 · 착지 좌표 억제
- [x] MoveCalendar memo + useSearchParams 제거
- [x] '오늘로' 표시를 React state 에서 DOM 직접 쓰기로
- [x] focusMonth 딥링크 계속 동작(해석 사슬 resolveTrackMonth)
- [x] 내비 링크에 캘린더 달이 안 붙는 것 실증

## 3항목 — 탭 접미 N 동기화 (f324c834)
- [x] data.months[].eventCount 로 서버 왕복 없이
- [x] 판정은 commitPosition 한 군데
- [x] 홈 '이달 입퇴실 N건'과의 정합 유지(착지 순간 악수)
- [ ] **헤더 접힘 경계 흔들림 — 디자이너 판정 대기**

## 4항목 — 이 화면에서 미래 월 경고 톤 끄기 (edf7adb6)
- [x] futureIsNormal 플래그(allowFuture 에서 파생 금지)
- [x] 과거 방향 경고 유지
- [x] 형제 여덟 곳 + 프리즘 수납 면 무변경(기본값)

## 5항목 — 판정점·반응성 (6fb5d2fe 에 포함)
- [x] 표시(‘오늘로’)는 rAF 즉시, URL 쓰기는 1/4 + 180ms 유지
- [x] 표시 값을 React state 로 안 든다
- [x] 착지 직후 옆 달로 안 적힌다(좌표 억제)
- [ ] **왼쪽 끝 통일 여부 — 운영자 실기 확인 항목**(오더에서 이탈, 근거는 context-notes)

## 6항목 — 먼 달 점프를 넓히기에서 옮기기로 (3ec9c186)
- [x] 경계 산식을 lib 순수 함수로(moveRangeWindow)
- [x] 창 밖 점프는 4개월 창으로 옮긴다 · 기본 창은 불변
- [x] 오늘이 창 밖일 때 [오늘로] 분기(재조회) + 카드 밖으로
- [x] beyond today 가드 · 다가오는 14일 분기
- [x] canExtendPast 생존 · 한 달씩 단조 후퇴
- [x] 창 회귀 6축 신설(160 → 186)

## 7항목 — 연도 표기 (7ec6e2fd)
- [x] 범위 첫 달·해 바뀜에 연도 · 밴드 라벨 tnum
- [x] beyond 줄 fmtDateDot(fmtMD 정본은 불변)

## 게이트
- [x] tsc 0
- [x] npm run verify:fast exit 0 (커밋 훅에서 7회 통과)
- [x] npm run verify:db — 기지 예외(서류 표시값 소재지 3건)에서만 정지, 캘린더 축 행 41·막대 72 위반 0
- [ ] 프로덕션 빌드 exit 0
- [x] eslint 491 유지(291 errors · 200 warnings) — 신규 0
- [x] 320/360/390/1280 x 라이트·다크 8조합 넘침 0 · 막대 밖 글자 유출 0 실측
- [x] Android Chrome(Blink) 터치 실측 — 트랙 위 세로 스와이프로 페이지가 따라옴(래치 없음),
      가로 트랙 동작, 스크롤이 낸 RSC 요청 0, CPU 6배 스로틀에서도 longtask 0
- [ ] iOS Safari(WebKit) 실기 — 헤드리스로 못 잼, 운영자 확인 필요
- [ ] 웹디자이너 배포 전 패스
