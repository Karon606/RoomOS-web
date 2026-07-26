# 체크리스트 — 단기 연장 기능 (2026-07-20 운영자 Go)

승인 사항: 엔진 산식 유지(1주 157,000), LeaseTerm.shortStayExtensions Json 컬럼, billForLeaseMonth 단기 입주월 단일 청구(락인보다 뒤), 월 전환 자동화·단축 환불 범위 제외.

## 1단계 — 선행 결제 수정 (직접 작업, 결제 로직)
- [x] billForLeaseMonth: 단기는 입주월 외 fallback 청구 차단(일할·락인은 유지 — 과거 결산 불변)
- [x] 호출부 select에 isShortTerm·moveInDate 확대(rooms 2곳, unpaid, dashboard, report, findFirstUnpaidMonth)
- [x] report 예측 매출 루프(rentAmount 직접 합산) 단기 보정
- [x] CSV 월간 시트(export route) 단기 보정
- [x] scripts/test-money.ts에 단기 월경계 케이스 고정
- [ ] 파트쿨리나 422호 moveOut null 정리(상태 로그 근거로, 근거 없으면 보류 보고)
- [x] 테스트·타입·lint 통과 후 커밋(81dc967 푸시)

## 2단계 — 연장 서버 액션 + undo
- [x] prisma: LeaseTerm.shortStayExtensions Json? 컬럼(비파괴 ALTER)
- [x] previewShortStayExtension / extendShortStay(조건부 updateMany 선점, 일할 필드 클리어, 마커 record, recalculatePayments, 한 tx)
- [x] undoShortStayExtension(스냅샷 원복, 연장 이후 record exp 되쓰기, 가드)
- [x] test-money에 연장 차액·경로 독립 케이스 고정
- [x] 커밋(2c14220 로컬)

## 3단계 — 연장 모달 + 진입점 + 표기
- [x] 연장 모달(Modal+dirty, SegmentedControl+DatePicker, StayQuoteModal 행 분리 문법, 확정 버튼 금액)
- [x] 진입점: 상세 단기 영역 버튼 / CHECKOUT_PENDING '퇴실일 변경' 라우팅 / 수정 폼 저장 후 제안 (D-1 알림 버튼은 후속 — 현재도 알림에서 상세 경유 2탭)
- [x] 확정 후: 지금 수납(FIFO 자동 추천) + 토스트·상시 undo (문자 안내는 후속)
- [x] 카드 (N주) 표기, 상세 연장 이력 줄, 캘린더 ACTIVE 단기 VEVENT
- [x] loop.md 증거 보고 + 커밋 + Work_log·knowledge 적립

## 마감 (2026-07-20)
- [x] 마이그레이션 실행(운영자) — shortStayExtensions jsonb 컬럼 확인됨
- [x] 파트쿨리나 422호 moveOutDate 정리(2026-05-26, scripts/fix-partkulina-moveout.mjs, 1건)
- [x] 푸시·배포 — 717455d까지 4커밋, Vercel 프로덕션 READY(www.stayeum.com)
- [x] 김민정 실데이터 수치 검증(읽기 전용) — 2주 329,000/차액 172,000, 3주 470,000 상한, 30일 초과 월 전환 안내
- [x] 후속 발견 수정: 단기 과납 잔액 입력월 흡수(717455d) — 청소비 합산 입금 시 기록 증발 방지

## 4단계 — 청구 조정 전표 + 단축 감액 (2026-07-26 회계·UX 오더)
- [x] PaymentRecord.isBillingAdjust 컬럼 + 운영 DB ALTER·백필(migrate_billing_adjust.sql, 마커 2건 true)
- [x] syncShortStayCharge: kind(increase/decrease), 마커 isBillingAdjust=true, 감액 되쓰기 + lockRewrites 스냅샷
- [x] updateTenant: newTarget = max(정책·수동가, paidSum), '안내만' 분기 삭제, 하한 도달 시 환불 안내 notice
- [x] 조건 통일: lockAgg·paidSum·undo 가드 모두 isDeposit:false·isPrevOwner:false·deletedAt:null
- [x] undo: lockRewrites 정확 복원(구 스냅샷만 휴리스틱), 문구 연장/감액 분기
- [x] 표시 제외 전수: PaymentBody·PaymentRecordList·PaymentHistoryAll(getAllPaymentsByLease)·TenantClient 수납 모달·/api/export 행·대시보드 납입완료 피드·캘린더 납입 판정·발생주의 점검·lastPayDate/latePaidAt
- [x] 락 계산은 무필터 유지(updateTenant lockAgg·serverBillForMonth·getTargetMonthOptions·getRoomPaymentStatus)
- [x] UX: 월 이용료 '연장 반영' 배지 + 보조 줄(최초→현재, N회 펼침), 잔액 근거 줄, ShortStayInfoWidget '청구 이력'(취소분 취소선)
- [x] test-money 락 조정 케이스 4종(①329,000 ②400,000 하한 ③undo 470,000 ④경로 독립) — 76/76
- [x] tsc·프로덕션 빌드·신규 린트 0 확인 (커밋은 운영자 지시로 보류)
- [ ] 김민정 520호 잔존 락(470,000 vs rentAmount 329,000) 정리 — 다음 저장 시 자동 감액되나, 선제 백필은 운영자 승인 대상
