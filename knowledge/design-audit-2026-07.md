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

## Phase 계획
1. ~~기계 스캔~~ (완료) → 2. 페이지별 헤더·필터·카드·모달 전수 대조(§21·§22 정본) → 3. UX 흐름(터치 타겟·정보 위계·§10 undo·§22 선택모드) → 4. 승인분 수정.
