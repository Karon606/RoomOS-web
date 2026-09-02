# 이용료 정산 '환불 없음' 확정 갈래 (2026-09-02, 운영자 승인 + 수정 2건 반영)

## 커밋 1 feat(이용료 정산): 환불 없음은 선납분만 환불, 조기 퇴실 기본 갈래
- [x] lib/checkoutSettlement.ts — settlementAmounts('none') 이 futurePrepaid 만 돌려줌, 캡션·전제문에 선납 문장, defaultSettlementPick(shortStay, withNone), futureMonthsLabel
- [x] tenants/actions.ts previewCheckoutRefund — defaultPick: defaultSettlementPick(shortStay, true)
- [x] CheckoutProrationWidget:105 — defaultSettlementPick(refRes.shortStay, false)
- [x] RentSettlementSection — 전제문·캡션 opts·none 분기 박스 금액·캡션 셋·선납 미달 경고
- [x] scripts/test-money.ts — 기본값 4쌍, none 선납 케이스, 클램프

## 커밋 2 feat(이용료 환불): 환불 없음 확정 갈래와 카드 출구
- [x] actions.ts — rentRefundPendingFor 헬퍼(paid·keeps·later·laterMonths), getPendingRentRefundNotice 확장(amount = 초과분 + later)
- [x] actions.ts finalizeRentRefund — 스냅샷 존재 가드 공통화, 0 갈래(later > 0 거부, 비대기 noop, 대기면 record 무접촉 + 낙관적 잠금), `< 0` 거부
- [x] RentSettlementPanel — 배지·완료 금액 줄 꼬리·미처리 두 버튼·선납 경고 줄·안내창(later > 0)·확정창·undo 분기·폼 max/캡션/오류·reviseWarn·예상 캡션 futurePrepaid
- [x] integrityAudit 규칙 3 — refund-billing-drift

## 커밋 3 fix(퇴실 처리): 환불 0원도 확정으로 서버에 싣는다
- [x] TenantClient 1412·1441, TenantStatusTransitions 461, DashboardClient 301·359·549 — `> 0` 게이트 제거
- [x] actions.ts checkoutWithDepositRefund ~2206 — `rentRefundAmount != null`

## 커밋 4 chore(감지망)
- [x] check-rent-settlement-branch ⓕⓖⓗ, check-checkout-side-effects ⓓ·ⓟ 확장
- [x] 역주입 5건 exit 1 (none 분기 되돌리기 · preview 한 인자 · later 거부 삭제 · 상태전환 게이트 되돌리기 · 스냅샷 가드 삭제)

## 커밋 5 docs
- [x] Work_log · knowledge/domain-checkout-settlement(백로그 해소) · INDEX

## 게이트 (loop.md)
- [ ] iCloud 사본 제거
- [ ] tsc 0
- [ ] test-money
- [ ] verify:fast
- [ ] 빌드
- [ ] eslint 신규 0 (기준선 대조)
- [ ] 웹디자이너 패스(none 박스 선납액 320px · 카드 375px 두 버튼 · 다크)
- [ ] 각 커밋 push --no-verify

## 운영자 실기 (배포 후)
- [ ] 422호 [환불 없음] → 배지 '환불 없음' · 금액 줄 1회 표기 · [적용취소] 뒤 미처리 복귀
- [ ] 퇴실 처리 화면 기본 '환불 없음' · 선납 있는 계약 캡션
