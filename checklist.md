# 퇴실 정산 환불 가드 + AI 티 2차 정비 (2026-09-03, 운영자 "전부 권고대로")

## A1 fix(퇴실정산): 환불 확정 뒤 일할 재적용을 서버가 거부한다
- [x] lib/rentRefundRecord.ts hasRentRefundSnapshot(undo)
- [x] actions.ts setCheckoutProration 가드(lease 조회 직후, settlementCalcFor 앞, clear 와 같은 문장)
- [x] clearCheckoutProration · prorationDataForChange 술어 교체(동작 동일)
- [x] check-checkout-side-effects ⓠ(세 본문 술어, set 은 settlementCalcFor 앞, 문장 정확히 2회) + 역주입

## A2 feat(퇴실정산): 환불 확정 계약은 일할 위젯이 잠긴 줄로 선다
- [ ] rooms/actions.ts RoomRow.rentRefundFinalized, select checkoutProrationUndo, 조립 두 곳
- [ ] PaymentBody prop 전달
- [ ] CheckoutProrationWidget prop, 잠금 한 줄(muted, 버튼 없음, 폼 안 열림) "변경은 위 이용료 정산 항목에서 적용취소 후."
- [ ] PaymentRecordList 캡션 "맨 위" 를 "위" 로 (A-3)
- [ ] check-rent-settlement-branch ⓘ + 역주입
- [ ] 웹디자이너 패스

## A3 fix(퇴실정산): 전액 환불 확인창은 지낸 달 사용분까지 돌려줄 때만 뜬다
- [ ] RentSettlementValue 를 lib/checkoutSettlement 로, futurePrepaid 필드, 섹션 재수출·valueFor 채움
- [ ] rentSettlementConfirmSpec 순수 함수, confirmRentSettlement 래퍼화(문장 무변경)
- [ ] test-money 7 케이스
- [ ] check-rent-settlement-branch ⓔ 확장 + 역주입

## A4 fix(퇴실정산): 환불 확정 계약의 복귀·단기 연장은 환불 적용취소부터
- [ ] updateTenant 1177 · applyStatusTransition 3405 · syncShortStayCharge 5944 가드(같은 문장)
- [ ] ⓠ 일반화(DbNull 로 비우는 함수는 finalize·undo·clear 외엔 술어 필수) + 역주입
- [ ] knowledge/domain-checkout-settlement 규칙 적립

## B1 design(칩): 글자 알약 마지막 한 곳을 걷고 감지망 패딩 구멍을 닫는다
- [ ] NoticeSmsModal 344 조건 칩(형제 357 골격, 코랄 채움 제거) · check-pill-text 정규식 \b(px|pl|pr|p)-

## B2 design(배지): Badge ring·pale-coral 을 토큰 트라이어드로
- [ ] Badge.tsx pale-green/green ring --success-ring, pale-coral/coral 을 --danger-* 트라이어드
- [ ] scripts/check-badge-tokens.mjs(--viz-, hex, /NN 알파 금지) + verify:fast 등록 + 역주입

## B3 design(정산 카드): 읽기전용 박스 높이를 입력에 맞춘다
- [ ] panelFormStyles readonlyCls · RentSettlementPanel 343

## B4 design(버튼 행): gap 을 정본에 맞춘다
- [ ] Btn 행 gap-2: RentSettlementPanel 257·289, RoomCleaningPanel 168, MarketClient 1018 · RowActionBtn 행 TenantClient 3020 gap-1.5

## B5 chore(감지망): 장식 그라데이션 재발 감지
- [ ] tsx gradient 문자열·css mask-image 밖 linear-gradient 금지 + verify:fast + 역주입

## B6 design(배지): 틴트 배지에서 ring 을 걷는다 (§11 개정)
- [ ] 가이드 §11 문단 + 부록 A 개정 전 문장 · Badge.tsx ring-1 제거 · 다크 대비 실기

## B7 design(홈 알림): 카테고리 립을 걷는다 (§18 개정)
- [ ] 가이드 §18 문단 + §29 점검 "카테고리색 립 0" · DashboardClient 844 · check-card-rip 대상에 알림 행

## B8 design(퇴실 정산 위젯): 입력을 40/44 로 올린다 (§12)
- [ ] CheckoutProrationWidget 입력 5 + DatePicker + 읽기전용 박스 · 320px 세로 실기

## 게이트 (커밋마다)
- [ ] tsc 0 · verify:fast · eslint 신규 0 · 감지망 역주입 · 빌드(마지막) · iCloud 사본 · push
- [ ] 웹디자이너 패스: A2 위젯, B2/B6 배지, B7 알림 행, B8 위젯

## 문서
- [ ] Work_log · knowledge(domain-checkout-settlement, design-visual-identity) · INDEX
