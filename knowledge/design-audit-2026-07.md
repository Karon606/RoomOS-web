# 디자인 감사 2026-07 (Phase 1 — 기계 스캔)

전제: [[../docs/brand-guide-v1.3.md]] §09~§23 대조. 코드가 진실 — 라인은 시점 기록.
Phase 2(페이지 대조)·Phase 3(UX 흐름) 미실시, Phase 4(수정)는 아래 '즉시 수정' 완료분만.

## 즉시 수정 완료 (2026-07-02)
- 푸시 테스트 문구 이모지 제거(pushActions.ts 2곳) — no-emoji 규칙.
- EmptyState 이중 구현 통합 — FinanceClient 로컬(label만) 삭제 → 공용(§16 정본) 사용 6곳 전환(카드 안 4곳은 `border-0 bg-transparent`로 이중 배경 방지).

## 보류 — 판단 필요 (Phase 2 대상)
- ~~StatusBadge ROW_TINT~~ → **해소(2026-07-02, §14.4b)**: '공용' 의도 폐기(디자인 정정) → 의미 -bg 토큰 6종(다크 자동). info(비거주)는 neutral-bg 변경 승인.
- ~~Badge pale-green/green~~ → **해소(2026-07-02, §14.4b)**: 신규 토큰 없이 --success-bg/fg **쌍 이동**(틴트 칩 케이스). green 변형 포함(승인).
- ~~입력 radius 혼용(§13.1)~~ → **해소(2026-07-02)**: input/select/textarea의 md·lg·xl 50곳 → rounded-sm(6px) 단일화. 필터 셀렉트도 '셀렉트 전부' 문언대로 포함.
- ~~z-index 리터럴(§12)~~ → **부분 해소(2026-07-02)**: 전역 fixed 레이어 10곳 토큰화(주소검색 modal-2·설정 토스트 toast·하단탭/헤더 sticky·드롭다운·MergeSheet modal). 보존: 표 sticky z-30/20(§22.7 정본)·카드 내부 로컬 스택·floor-plan 캔버스존. ~~가이드 충돌~~ → **정정 완료(2026-07-02)**: §12 --z-pill(120) 신설, §21.3=--z-pill·§21.4=--z-modal로 가이드·코드 동시 반영.
- ~~인라인 "불러오는 중…"(§16)~~ → **해소(2026-07-02)**: 14곳 SkeletonRows 교체 + 모달 타이틀 2곳 중립화. 유지(정당): 품목 프리셋 캡션(§16 예외 1곳)·버튼 상태 라벨·aria-label.
- ~~페이지 제목 혼재~~ → **해소**: 5곳 text-xl 통일(별도 항목 참조).
- **손말이 모달(§22.8)**: FinanceClient·InventoryClient·TenantClient·IncomeSection이 fixed inset-0 직접 구현(페이지 Modal 미사용).
- **앱 화면 색 리터럴**: InventoryClient hex8+rgba6, DashboardClient rgba13 — §14.4 정본 매핑 대조 필요.
- 인쇄 서류(ContractView 52·ResidenceCert 11)는 §20 --p-* 영역이라 별도 기준으로 확인. FloorPlanEditor(30)는 캔버스 특수영역.

## Phase 2 결과 — 페이지 대조 (2026-07-02, 검증 완료)
9페이지 × §21·§22 대조. 3종(수납·고객·호실) 골격·SearchBar·1차필터·sticky는 정본대로 — IA 자체는 건강.

**확정 위반(심각도순)**
1. **손말이 모달 19곳+** (§22.8): FinanceClient 7·TenantClient 8·InventoryClient 5·IncomeSection 2 — **완전 Modal 이관은 백로그**(폼 dirty 정책·z 스택 재검증 필요한 대형 리팩터). **배경 재분류(2026-07-02)**: 7종 혼재의 실체 — 진짜 모달 배경 드리프트는 /40+blur 2곳뿐(고정지출 모달, →/70 수정 완료). /50·/65·/40=이미지 오버레이 칩(PhotoStrip·영수증 X), /90·/92=라이트박스·스캐너 — 별개 정당 패턴으로 판정. 즉 모달 배경은 이제 /70 단일.
2. ~~**탭 패턴 분열**~~ → **해소(2026-07-02)**: §24 뷰 전환 탭 정본 신설(가이드 편입 157c2c4) + `ViewTabs` 컴포넌트(46435ed). 5곳 이관 완료 — 재고 2955575 · 수납 5a638b9 · 재무 B→A · 리포트 C→A · 대시보드 제4변종→A(~ceb0f1c). **판정 기록**: 재고 '품목별/위치별'·지출 '아이템별/주문별'은 **보기 방식(표시 전환) 토글**로 분류 → 트랙형(SegmentedControl) 유지(운영자 승인). 근거: 코랄 조인트=페이지 정체성 전환(화면당 1개), 트랙형=같은 데이터 표시 방식 — 한 화면 코랄 탭 2줄 금지.
3. ~~재고관리 메인 SearchBar 없음~~ → **해소(2026-07-02)**: 메인 검색 신설(품목명·카테고리·메모, 두 보기·수령 대기 공통, 무결과 §22.2 분기).
4. ~~호실관리 SearchBar 은닉~~ → **오탐 정정(2026-07-02)**: SearchBar는 상시 노출 중(552, 토글 뒤는 고급 필터 패널뿐) — 위반 아님.
5. ~~**h1 크기**~~ → **해소(2026-07-02)**: text-base sm:text-lg 5곳(재고 2·계약·입실료·거주확인) → text-xl 통일. marketing/admin/온보딩 text-lg는 §22 범위 밖 유지.
6. 비품·자재 페이지 h1 없음(서브페이지 성격 — 의도 여부 판단).

**오탐 정정**: requests 상태 필터는 SegmentedControl 사용 중(299) — 위반 아님. card-settlement·stats는 목록형 아님(§22 비적용).


## Phase 3 결과 — UX 흐름 (2026-07-02, 재검증 포함)
7규칙 검사. **합격**: R1 confirm/alert(앱 본체 클린 — 가이드의 '71곳 교체'는 기완료 상태 확인) · R2 window.location.href(전부 파일 다운로드 등 정당) · R3 삭제류 confirmDialog danger 준수+일괄수납 undo 양성대조 확인 · R4 선택모드 3페이지 완비.

**발견·처치**:
- ~~R6 음수 ASCII '-' 4곳~~ → **해소**(−U+2212: PaymentSummaryCards 잔액·이월, TenantClient 청소비, DashboardClient 미수).
- **R5 dirty 정책(§13.2) 위반 4모달** → **모달 이관(백로그 #2) 설계 입력**: 거래처 관리(FinanceClient:696)·부가수익 수정(IncomeSection:229)·재고 카테고리 설정(InventoryClient:1706)·고객 편집(TenantClient:1058) — 배경클릭 무조건 닫힘·입력 유실. 양성 패턴: FinanceClient:3781(고정지출 관리).
- **R1 추가발견(에이전트 스코프 밖)**: 인쇄 뷰 공개 페이지 alert() 6곳(ContractView 3·ResidenceCert 2·RentReceipt 1) — 공개 페이지 토스트 호스트 존재 확인 후 교체(무확인 제거 금지: pushToast가 no-op이면 alert가 유일 통지).
- **R7 터치 타겟**: AssetsClient 배정/취소 등 카드 액션 행 py-1(~26px) — §21.1 정본 34px로 '카드 액션 34px 정합 배치' 백로그(형제 버튼 전수 동반).
- **R6 잔여**: toLocaleString 직접 호출 176곳(재무 42·대시 36·고객 19…) — §15 단일 포맷 유틸 경로 백로그(대형).

## 감사 클로즈 (2026-07-02) — 백로그 전량 처리
1. ~~손말이 모달~~ → **완료**: 15개 이관(IncomeSection 2·재고 2·재무 6·고객 8 중 이관분) + dirty(§13.2) 배선. 정당 유지 3: 삭제 확인(§9.3 영향고지형)·영수증 스캐너(라이트박스, z-lightbox 정정)·LocationBatchCheckModal 미사용 오버레이 분기.
2. ~~색 리터럴~~ → **완료**: 재고 카테고리 팔레트 신규 hue 8종 → viz 토큰(color-mix 틴트), 성공색 리터럴 7곳 → success-fg, NavProgress → --tc. Dashboard rgba는 §23.1 강조카드 스펙·차트 그리드·동적 보간으로 정당 판정(유지).
3. ~~§15 포맷~~ → **완료(부분·안전 범위)**: fmtWon 신설(음수 −), 정확 패턴 114곳 치환 + 로컬 헬퍼 5곳 통합. 옵션 지정·비화폐·인쇄 뷰(§20 자체 규정)는 대상 외.
4. ~~카드 액션 34px~~ → **완료**: 13곳 min-h 정합.
5. ~~인쇄 뷰 alert~~ → **완료**: contract 레이아웃 토스트 호스트 마운트 + alert 6곳 제거(중복 4·교체 2).
6. ~~마감 재스캔~~ → **완료**: 손말이 2(정당)·alert 0·radius 0·h1 0·인라인 로딩 1(§16 허용 예외)·이모지 0(마감 스윕 9곳 제거)·앱화면 hex 잔존은 스플래시(§18 명시)·ConfirmDialog(§9.2 명시)·주석 참조값뿐.

**잔여(선택적 후속, 위반 아님)**: toLocaleString 옵션형·비화폐 호출들의 점진 정리 / Dashboard DIVIDER_COLOR 등 중립 상수의 토큰 승격 검토 / 모달 이관 후 실기기 스모크(§4 인접: 보증금 환불·수납 모달 열고닫기 확인 권장).

## Phase 계획
1. ~~기계 스캔~~ (완료) → 2. 페이지별 헤더·필터·카드·모달 전수 대조(§21·§22 정본) → 3. UX 흐름(터치 타겟·정보 위계·§10 undo·§22 선택모드) → 4. 승인분 수정.
