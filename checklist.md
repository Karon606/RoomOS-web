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

## 운영자 실행 대기 (권한 차단으로 보류)
- [ ] `node --env-file=.env.local scripts/migrate-short-stay-extensions.mjs` 실행(컬럼 추가) — 완료 후 푸시 가능
- [ ] 파트쿨리나 422호 moveOutDate 정리(2026-05-26, 상태 로그 근거)
- [ ] 2c14220·d6b06dd 푸시(마이그레이션 적용 확인 후)
