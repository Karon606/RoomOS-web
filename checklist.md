# 체크리스트 — 단기 연장 기능 (2026-07-20 운영자 Go)

승인 사항: 엔진 산식 유지(1주 157,000), LeaseTerm.shortStayExtensions Json 컬럼, billForLeaseMonth 단기 입주월 단일 청구(락인보다 뒤), 월 전환 자동화·단축 환불 범위 제외.

## 1단계 — 선행 결제 수정 (직접 작업, 결제 로직)
- [ ] billForLeaseMonth: 단기는 입주월 외 fallback 청구 차단(일할·락인은 유지 — 과거 결산 불변)
- [ ] 호출부 select에 isShortTerm·moveInDate 확대(rooms 2곳, unpaid, dashboard, report, findFirstUnpaidMonth)
- [ ] report 예측 매출 루프(rentAmount 직접 합산) 단기 보정
- [ ] CSV 월간 시트(export route) 단기 보정
- [ ] scripts/test-money.ts에 단기 월경계 케이스 고정
- [ ] 파트쿨리나 422호 moveOut null 정리(상태 로그 근거로, 근거 없으면 보류 보고)
- [ ] 테스트·타입·lint 통과 후 커밋

## 2단계 — 연장 서버 액션 + undo
- [ ] prisma: LeaseTerm.shortStayExtensions Json? 컬럼(비파괴 ALTER)
- [ ] previewShortStayExtension / extendShortStay(조건부 updateMany 선점, 일할 필드 클리어, 마커 record, recalculatePayments, 한 tx)
- [ ] undoShortStayExtension(스냅샷 원복, 연장 이후 record exp 되쓰기, 가드)
- [ ] test-money에 연장 차액·경로 독립 케이스 고정
- [ ] 커밋

## 3단계 — 연장 모달 + 진입점 + 표기
- [ ] 연장 모달(Modal+dirty, SegmentedControl+DatePicker, StayQuoteModal 행 분리 문법, 확정 버튼 금액)
- [ ] 진입점: 상세 단기 영역 버튼 / CHECKOUT_PENDING '퇴실일 변경' 라우팅 / D-1 알림(재조회) / 수정 폼 저장 후 제안
- [ ] 확정 후 3택(지금 수납 프리필 / 문자 NoticeSmsModal / 나중에) + 토스트·상시 undo
- [ ] 카드 '(N주)' 표기, 상세 연장 이력 줄, 캘린더 ACTIVE 단기 VEVENT
- [ ] loop.md 증거 보고 + 커밋 + Work_log·knowledge 적립
