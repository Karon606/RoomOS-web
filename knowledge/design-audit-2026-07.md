# 디자인 감사 2026-07 (Phase 1 — 기계 스캔)

전제: [[../docs/brand-guide-v1.3.md]] §09~§23 대조. 코드가 진실 — 라인은 시점 기록.
Phase 2(페이지 대조)·Phase 3(UX 흐름) 미실시, Phase 4(수정)는 아래 '즉시 수정' 완료분만.

## 즉시 수정 완료 (2026-07-02)
- 푸시 테스트 문구 이모지 제거(pushActions.ts 2곳) — no-emoji 규칙.
- EmptyState 이중 구현 통합 — FinanceClient 로컬(label만) 삭제 → 공용(§16 정본) 사용 6곳 전환(카드 안 4곳은 `border-0 bg-transparent`로 이중 배경 방지).

## 보류 — 판단 필요 (Phase 2 대상)
- **StatusBadge ROW_TINT rgba 6곳**: 주석에 "라이트·다크 공용" 의도 명시된 리터럴. 토큰화 시 다크 시각 변경 → 의도 확인 후 결정.
- **Badge pale-green/green** `bg-[#eef2e5] text-[#4e6834]`: 쌍 고정이라 대비 유지 중. text만 토큰화하면 다크에서 깨짐 → 쌍 토큰 신설(예: --pale-green-bg/fg) 여부 판단.
- **입력 radius 혼용(§13.1 위반)**: rounded-lg 입력·셀렉트 12곳+(설정 10·고객 2·재무 필터…). '필터 컨트롤'도 §13.1 대상인지 해석 포함 일괄 마이그레이션 필요.
- **z-index 리터럴(§12 우회)**: StatsClient 24·Dashboard 12·Report 8 등.
- **인라인 "불러오는 중…"(§16 원칙 금지)**: 8파일 ~10곳(PaymentBody·entity-modal 위젯들) → 스켈레톤 전환.
- **페이지 제목 3종 혼재**: text-xl(8) vs text-base sm:text-lg(재고 계열 5) vs text-lg font-semibold(2).
- **손말이 모달(§22.8)**: FinanceClient·InventoryClient·TenantClient·IncomeSection이 fixed inset-0 직접 구현(페이지 Modal 미사용).
- **앱 화면 색 리터럴**: InventoryClient hex8+rgba6, DashboardClient rgba13 — §14.4 정본 매핑 대조 필요.
- 인쇄 서류(ContractView 52·ResidenceCert 11)는 §20 --p-* 영역이라 별도 기준으로 확인. FloorPlanEditor(30)는 캔버스 특수영역.

## Phase 2 결과 — 페이지 대조 (2026-07-02, 검증 완료)
9페이지 × §21·§22 대조. 3종(수납·고객·호실) 골격·SearchBar·1차필터·sticky는 정본대로 — IA 자체는 건강.

**확정 위반(심각도순)**
1. **손말이 모달 19곳+** (§22.8): FinanceClient 7(694·1228·2959·2994·3421·3779·4008), TenantClient 8(1010·1050·1128·1435·1480·1507·1551·2076), InventoryClient 5(292·855·1690·1822·2889), IncomeSection 2. **배경 불투명도 7종 혼재**(black/40·50·60·65·70·90·92 — 실측) = 모달 느낌이 화면마다 다름.
2. ~~**탭 패턴 분열**~~ → **해소(2026-07-02)**: §24 뷰 전환 탭 정본 신설(가이드 편입 157c2c4) + `ViewTabs` 컴포넌트(46435ed). 5곳 이관 완료 — 재고 2955575 · 수납 5a638b9 · 재무 B→A · 리포트 C→A · 대시보드 제4변종→A(~ceb0f1c). **판정 기록**: 재고 '품목별/위치별'·지출 '아이템별/주문별'은 **보기 방식(표시 전환) 토글**로 분류 → 트랙형(SegmentedControl) 유지(운영자 승인). 근거: 코랄 조인트=페이지 정체성 전환(화면당 1개), 트랙형=같은 데이터 표시 방식 — 한 화면 코랄 탭 2줄 금지.
3. **재고관리 메인에 SearchBar 없음**(§22.1) — 품목 검색이 모달 안에만. 상위 검색 부재.
4. **호실관리 SearchBar가 필터 패널 뒤에 숨음**(RoomManageClient 554) — 타 페이지는 상시 노출.
5. **h1 크기**: 재고만 text-base sm:text-lg, 나머지 text-xl.
6. 비품·자재 페이지 h1 없음(서브페이지 성격 — 의도 여부 판단).

**오탐 정정**: requests 상태 필터는 SegmentedControl 사용 중(299) — 위반 아님. card-settlement·stats는 목록형 아님(§22 비적용).

## Phase 계획
1. ~~기계 스캔~~ (완료) → 2. 페이지별 헤더·필터·카드·모달 전수 대조(§21·§22 정본) → 3. UX 흐름(터치 타겟·정보 위계·§10 undo·§22 선택모드) → 4. 승인분 수정.
