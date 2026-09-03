# 서류 작성 문 + 발급 이력 목록 + 몰취 날짜 축 (2026-09-03, 운영자 승인)

## A 납부확인서 새 달 작성 문 (요청 1)
- [x] A1 lib/docBundle: 입력에 rentPaidLeaseIds, rent 행에 작성 가능 플래그 파생
- [x] A1 test-doc-bundle 케이스(stale+납부=문 열림 / stale+미납=닫힘 / 이번 달 발급본=stale 없음
      / 보증금·계약서·실거주 행에는 플래그 없음 / 미발급 행 종전 그대로)
- [x] A2 실입금 존재 술어를 공유 헬퍼로(actions.ts·integrityAudit·docBundle 조회가 같은 것 import)
- [x] A2 tenants/docBundle.ts 조회가 PaymentRecord 한 번 더 읽어 집합 전달
- [ ] A3 시트에 링크 문('판본 바꾸기' 문법) · 미납 안내 문구 · writeHref 에 month 명시
- [ ] A3 웹디자이너 패스

## B 선납 중복 발급 봉합 (운영자 승인, 스키마)
- [x] B1 RentReceiptFile.targetMonth 칼럼 + 마이그레이션(기존 행 NULL)
- [x] B1 발급 저장 경로가 귀속월을 적는다
- [x] B2 stale 판정을 발급일에서 귀속월로(NULL 이면 종전대로 발급일 폴백)
- [x] B2 test-doc-bundle 선납 케이스(8월에 9월분 발급 → 9월에 stale 아님)

## C 입주자별 발급 이력 목록 (요청 2 최소판)
- [ ] C1 lib/docHistory.ts 순수 병합·정렬 + test-doc-history.ts
- [ ] C2 조회 액션(rent·deposit·residence 세 모델, propertyId 스코프, 계약서 제외)
- [ ] C3 PaymentHistoryAll 접힘 문법 위젯 · TenantBody '계약서 파일' 아래 · 행은 [보기]만
- [ ] C3 웹디자이너 패스

## D 감지망
- [ ] check-doc-write-gate.mjs(수납 술어 사본 금지 — 두 기능이 갈라지는 지점)

## E 몰취 날짜 축 (운영자 승인, 패널 권고대로)
- [ ] E1 recordDepositReturn 미래 날짜 가드
- [ ] E1 두 폼 기본값을 퇴실일로, 라벨 '정산일' 통일, 카드 표시 '{날짜} 정산'
- [ ] E1 TenantClient 확인창 귀속월 버그(오늘의 달로 계산하는데 저장은 고른 날짜)
- [ ] E2 check-deposit-return-date-axis.mjs + verify:db 월 이탈 축
- [ ] E3 backfill 예행 보고 → 운영자 승인 → 적용

## 게이트 (커밋마다)
- [ ] tsc 0 · verify:fast · eslint 신규 0 · 감지망 역주입 · 빌드(마지막) · iCloud 사본 · push

## 문서
- [ ] Work_log · knowledge · INDEX
