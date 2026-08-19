# 재고 기능 공백 4건 시공 (2026-08-19, 운영자 백로그 위임)

점보롤 사건(Work_log 2026-08-19 (5)·(6))에서 드러난 공백 4건. 정본은 lib/stockLedger
(점검=절대값, 입수·폐기=델타, 잔량=마지막 점검+이후 델타, isReconcile=전파 정지점).
1번이 몸통 — 무상입수에는 이미 배포된 '이후 잔량 자동 재계산'(planStockShift)의 짝을
지출(구매) 수정·삭제 경로에 붙인다.

## 0단계 — 조사·패널 합의
- [x] 정본 문서(AGENTS·loop·Work_log (5)(6)·knowledge/domain-inventory) 정독
- [x] 상류(지출 폼)부터 하류(잔량 표시)까지 흐름 추적 — 구매 델타의 경계 술어는
      receivedAt <= check.createdAt (sumPurchases, overview.ts:35)
- [x] 전문가 패널 4인(재고 도메인·백엔드 감사·UX·웹디자이너) 검토 회수
- [x] 설계 확정 — 실데이터 판정 포함(수령완료 322건 중 자동점검 없는 구식 288건이 본류)

## 1단계 — 지출 수량 정정의 재고 전파 (몸통)
- [x] lib/stockLedger 에 PurchaseDelta·purchaseAfterCheck (5e4d6c67, 회귀 51 → 73)
- [x] 적용층 공용 모듈 ledgerShift 분리 + 감지망 앵커 재지정 (8c9325c6)
- [x] previewExpenseStockShift + updateExpense adjustStock 게이트 + 정체성 차단 +
      cancelReceiptCore(수령 취소 정본, 비움 뒷문 봉합) + deleteExpense 함께 조정 +
      제외/재포함 대칭 + 클라 다이얼로그 정본 stockShiftAsk + 감지망 5축 (7a2e329f)
- [x] 미사용 import 정리, eslint 기준선 복원 (8c830bc0)

## 2단계 — 시작 재고 정식 입력 자리
- [x] createTrackedItem startQty + '[시작 재고]' isReconcile 앵커, AddItemModal 칸 (dbb8f84a)

## 3단계 — 같은 날 중복 앵커 감지·안내
- [x] createStockCheck sameDayNotice(맨 절대값 점검만, 자동 삭제 없음) + 토스트 (3b2ba0f4)

## 4단계 — 실측 > 장부 입수 과소 의심 신호
- [x] overbookExcess 정본 + CheckForm 실시간 경고 박스 (a5a7f434, 회귀 79)

## 게이트 (전부 필수)
- [x] tsc 0
- [x] npm run verify:fast exit 0
- [x] npm run verify:db exit 0 (소재지 오버라이드 3건 기지 예외 + 발급본 래칫 9건 안내는 기존 관찰)
- [x] 프로덕션 빌드 exit 0
- [x] eslint 491 → 491 (신규 0)
- [x] 320/360/390 라이트·다크 헤드리스 실측 54측점 넘침 0 (빌드 CSS + Pretendard,
      모달·경고 박스·3지/2지 다이얼로그 최장 라벨)
- [x] 역주입 — 신규 감지망 축 2종 발화 확인
- [x] 웹디자이너 패스
- [x] knowledge/domain-inventory.md 적립
- [ ] 푸시 금지 — 메인 세션이 검증 후 머지
