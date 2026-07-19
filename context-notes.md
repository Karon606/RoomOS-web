# 컨텍스트 노트 — 오류신고 64bebb05

## 배경 사실
- 단기 lease.rentAmount = 체류 전체 사용료(청소비 제외)가 저장 규약. 폼 '이 금액 채우기'가 rentAmount=baseAmount, cleaningFee 별도 필드로 넣는다.
- 실데이터: 김민정 520호 RESERVED 7/20~7/26, rent 157,000, clean 20,000, dep 0.
- 하류 안전 판정(도메인 검토): 청구는 rentAmount 그대로, 단기 매출은 paymentRecord 실수납 인식이라 라벨 수정 무회귀.

## 결정
- 라벨은 '이용료' (운영자 결정 2026-07-20). 패널은 '사용료'(UX·도메인) vs '이용료'(디자인, TenantQuickModal 전례) 갈렸고 운영자가 '이용료' 채택. 장기 라벨('월이용료'/'월 이용료')은 불변.
- 단기 카드에서 납부일('매월 N일')은 무의미하므로 청소비로 슬롯 대체 (운영자 확인). dueDay 데이터 자체는 퇴실월 무청구 판정에 쓰여 유지.
- 합산 표기(사용료+청소비) 금지: DB에 없는 파생 금액이라 수납 모달 예정액과 어긋남. 분리 병기가 정본(StayQuoteModal 문법).
- 테이블 컬럼 신설 대신 단기 행 셀 보조줄. CSV 헤더·컬럼 key·localStorage key 불변(가져오기 매칭·사용자 설정 보존).

## 범위 제외 (별도 결정 필요, 보고 완료)
- 계약서 헤더 '입실료 (Rent / month)' 단기 영문 오류 — 계약 문서, loop.md 4번.
- 보증금·청소비 동시 존재 시 청소비 수납 진입점 부재 (PaymentEntryForm depositAmount===0 게이트).
- 단기 월 넘김 시 rentAmount 2회 청구 가능 구조.
- '월 이용료 범위' 필터에 단기 총액 혼입.
- 수납 토스트 '월 이용료 수납됨' 등 저우선 라벨(933, PaymentEntryForm 186)은 접점 최소화로 미수정.

# 컨텍스트 노트 — 단기 연장 프로세스 설계 (2026-07-20, 운영자 Go 대기)

패널 7인(요금 정책·결제 회계·UX·디자인·상태모델 설계 5인 + 결제·플로우 적대 검증 2인) 논의 결과. 코드 미수정.

## 확정 설계 요지
- 요금: 누적 재계산(최초 입실일부터 새 퇴실일 전체를 calcShortStay로 재계산, 차액 = 새 사용료 - 기존 rentAmount). 경로 독립 검증됨. 청소비는 입실 1회. 30일 초과는 월 계약 전환 안내 후 확정 비활성.
- 김민정(월세 47만) 수치: 1주 157,000 / 2주 329,000(차액 172,000) / 3주 이상 470,000 상한(차액 141,000).
- 저장: 전용 서버 액션(preview/extend 쌍), 한 tx에서 조건부 updateMany 선점(구 퇴실일 조건) + rentAmount 누적 갱신 + autoCheckoutAt 리셋 + 일할 정산 필드 클리어(P0-1 반영) + 입주월 마커 record(락 인상) + recalculatePayments. undo는 shortStayExtensions Json 스냅샷 + 상시 진입점, 마커 단독 삭제 금지(연장 이후 record 전체 exp 되쓰기).
- UX: 상세 모달 단기 영역 '단기 연장' 버튼 주 진입점, CHECKOUT_PENDING 단기의 '퇴실일 변경'은 연장 모달로 라우팅(뒷문 폐쇄), D-1 알림 상세에 버튼(재조회 필수), 수정 폼은 인터셉트 대신 저장 후 후속 제안(P0-1 플로우 반영). 모달은 Modal+dirty, SegmentedControl(+1주/+2주/직접)+DatePicker, StayQuoteModal 행 분리 재계산 블록, 확정 버튼에 금액 표기.
- RESERVED는 연장 모달 제외, 수정 폼 단기 블록에 차액 한 줄만(prepaid 한정).

## 선행 수정 필수(연장 출시 전, 운영자 승인 대상)
1. billForLeaseMonth 단기 입주월 단일 청구 — 락인보다 뒤 배치로 과거 결산 불변. 호출부 select 확대 + report 예측 루프 + CSV 월간 시트 보정.
2. 기존 데이터 정리: 파트쿨리나 422호 CHECKED_OUT인데 moveOut null이라 매달 미수 무한 증가 중(별개 P1 실증), 둘째 달 과납 이월 record.
3. 단기 미납 기일: dueDay null이라 경과일 오탐, 차액 기일 = 연장일.
4. 예약 선납의 청소비 분리 수납(현행 FIFO가 청소비 2만을 다음달 이용료로 밀어냄 — 파트쿨리나 실증).

## 운영자 결정 대기
(1) 엔진 산식 확인(1주 157,000 vs 기억식 176,250), (2) LeaseTerm.shortStayExtensions Json 컬럼(스키마), (3) billForLeaseMonth 단기 규칙(결제 로직), (4) 월 전환 자동화·단축 환불은 범위 제외 동의.
