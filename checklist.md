# 퇴실 정산 세 신고 (2026-09-02)

## 사실 관계
- [x] 신고 1: 퇴실 예정 때 적은 사유가 퇴실 처리 폼에 안 옴 (미니폼 열 때 setTransReason('') 로 비움, TenantStatusLog 에는 남아 있음)
- [x] 신고 2: 506호 문정현, 퇴실 처리 화면(RentSettlementSection)이 'legal' 고정이라 단기 요금·환불 안 함 갈래가 없었고 79,800원이 환불로 확정됨
- [x] 신고 3: 퇴실 정산 위젯(CheckoutProrationWidget)의 편집 칸이 '적용 금액'(청구액)이라 환불액을 직접 못 침
- [x] 506호 단기 요금 baseAmount = 380,000 (할인 10,000 반영), 환불 0·미납 0 (회계 패널 inspect-shortstay-refund-class 확인)

## 시공 (신고 2·3)
- [x] lib/checkoutSettlement.ts 순수함수 (SettlementPick, defaultSettlementPick, settlementAmounts, serverModeFor)
- [x] scripts/test-money.ts 케이스 (단기 상한 23일, 할인가, 두 갈래 폭 79,800 vs 0, 반올림 역전, 갈래 기본값·none)
- [x] previewCheckoutRefund 응답에 defaultPick
- [x] RentSettlementSection 4갈래 세그먼트 (위약금 / 면제 / 단기 / 환불 없음), 단기 기본, 캡션, value 에 pick·suggested
- [x] 공용 확인창 confirmRentSettlement (환불 0 또는 계산값과 다름, 전액 환불 흡수) 세 호출처 연결
- [x] 위젯: lib 공용화 + 환불액 직접 입력(적용 금액은 읽기전용 파생), prepaid 0 이면 종전 유지
- [x] 정적 검사 scripts/check-rent-settlement-branch.mjs (역주입으로 exit 1 확인) + verify:fast 등록
- [x] integrityAudit 규칙 6 (단기 자격 퇴실인데 단기 갈래 환불보다 큰 환불 확정, 둘을 한 규칙으로) + 예행 스크립트 inspect-integrity-audit.ts, 실데이터 506호·413호 2건 검출 확인

## 시공 (신고 1)
- [x] lib/checkoutReason.ts inheritableCheckoutReason(logs) 순수 판정 + latestCheckoutReasonFor(prisma, leaseTermId) (scripts/test-checkout-reason.ts 14 케이스, verify:fast 등록)
- [x] getTenantDetail checkoutReason, TenantBody 전달, 프리즘 미니폼 프리필 + 캡션 "퇴실 예정 때 고른 사유 · 필요시 수정"
- [x] 입주자 수정 폼(TenantClient) 프리필 — getTenants statusLogs 에 연장 복귀 행(예정에서 거주로) 포함해 옛 사유가 새 퇴실에 붙지 않게
- [x] 화면 없는 경로(checkoutTenant) 서버에서 같은 판정으로 이어받기
- [x] integrityAudit 규칙 7 checkout-reason-dropped (실데이터 5건 검출) + 정적 축 ⓞ (check-checkout-side-effects, 역주입 4종 exit 1)

## 웹디자이너 패스 반영
- [x] 라벨 '단기'·'환불 없음' (320px 실측), 전제문 settlementPremise·캡션 settlementPickCaption 정본화 + 감지망 축 ⓑ 에 두 호출 검사
- [x] '환불 없음' 갈래 읽기전용 0원 박스(높이 유지), 위약금율 포커스 링, 위젯 환불액 칸 인라인 라벨·초과 시 danger·placeholder 기본값
- [x] 확인창 셋 다 caution·기본 취소 라벨, 보증금 반환·총 환불액 본문
- [x] 홈 알림·프리즘 Modal dirty 에 정산 섹션 편집 포함, 프리필 사유는 dirty 아님

## 게이트 (loop.md)
- [x] iCloud 사본 제거
- [x] tsc 0
- [x] verify:fast 통과
- [x] 빌드
- [x] eslint 신규 0 (기준선 대조)
- [x] 웹디자이너 패스 (필수 14항 반영, 운영자 판단 항목은 보고)
- [x] 커밋·푸시 (c52b2cf9 신고 2·3 · cbac5f8b 신고 1)

## 운영자 몫
- [ ] 506호 프리즘 '적용취소' 클릭 후 이력에서 CHECKED_OUT 사유 기록 (내가 inspect-checkout-case.mjs 로 확인)
- [ ] 결제선생 79,800 부분취소 여부
- [ ] 413호 수동 환불액·의도 (첫 줄 잘림)

## 안 한 것 (의도)
- 폼 순서 재배치(UX/UI 제안) 보류
- 퇴실 처리 화면에서 단기 요금 청구 확정(서버 세 번째 문) 보류
- 미납 집계 CHECKED_OUT 제외 구멍 별건
