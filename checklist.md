# 수납 정보 탭 이용료 정산 카드 (2026-09-02, 질문 B 승인)

## 시공
- [x] lib/rentRefundRecord.ts — 환불 record memo 접두어 정본(isRentRefundRecord)
- [x] components/entity-modal/widgets/panelFormStyles.ts — DepositStatusPanel 스타일 상수 추출(문자열 불변), DepositStatusPanel import 로 교체
- [x] tenants/actions.ts — getRentRefundForLease(스냅샷 읽기), finalizeRentRefund reason 선택 인자(메모 꼬리 + 스냅샷 reason), RentRefundSnapshot.reason
- [x] rooms/actions.ts — updatePayment·deletePayment 가 환불 record 를 거부(잠금)
- [x] PaymentRecordList — 환불 record 는 수정·삭제 숨기고 안내 한 줄
- [x] RentSettlementPanel.tsx 신설 — 예상(퇴실 예정) / 환불 완료(적용취소·금액 수정) / 환불 미처리(환불 기록) / 단기·해당 없음이면 카드 없음
- [x] PaymentBody — DepositStatusPanel 아래 배치(모드 분기 밖), '정산 조정' 이 full 전환 + 위젯 자동 펼침 + 스크롤
- [x] TenantBody — RentRefundUndoRow·DepositRefundUndoRow 제거(이관), 고아 import 정리
- [x] integrityAudit — 규칙 8 rent-refund-record-drift, 규칙 6 은 스냅샷 reason 있으면 건너뜀

## 감지망
- [x] check-checkout-side-effects ⓛ 목록에 새 카드(적용취소 뒤 안내), 새 축 ⓟ(카드가 PaymentBody 에 서고 확정 뒤 안내·규칙 8 존재)
- [x] check-deposit-vocab 통과
- [x] 역주입 3건 exit 1 (undoRefundTaxNoticeLines 제거 · PaymentBody 카드 삭제 · 규칙 8 삭제)

## 게이트 (loop.md)
- [x] iCloud 사본 제거
- [x] tsc 0
- [x] verify:fast
- [x] 빌드
- [x] eslint 신규 0 (기준선 대조)
- [x] 웹디자이너 패스(배포 전)
- [ ] 커밋(의미 단위) · push --no-verify

## 문서
- [ ] Work_log · knowledge/domain-checkout-settlement 갱신
- [ ] 운영자 보고(실기 확인 목록)

## 운영자 몫(배포 후)
- [ ] 413호 적용취소 뒤 136,000 재확정(사유 기록)
- [ ] 506호 적용취소(돌려주지 않았다면)
- [ ] 413호 이름(앱 정은숙 / 실제 정희숙) 답
