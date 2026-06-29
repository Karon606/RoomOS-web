# 용어집

- **귀속월(targetMonth)** — 그 납부가 "어느 달 이용료"인지. 발생주의 모델의 기준. 5/1 입금이라도 귀속월 4월이면 4월 청구에 충당.
- **락인(locked expectedAmount)** — record에 저장된 그 달 청구액. 이후 월세가 바뀌어도 과거가 소급 변경되지 않게 고정. [[domain-billing]]
- **일할(prorate)** — 월 미만 거주분을 날짜로 계산. 1일 = 월÷30(설정). 퇴실월 등.
- **예약 인상(scheduledRent)** — 방의 미래 인상 예약(rentUpdateDate에 적용). '그 달 이용료부터' 반영. [[rent-increase-month-based]]
- **확정/예정 (카드 정산)** — 확정=청구 마감일(cutOffDay) 지남=금액 고정·출금 대상. 예정=마감 전·금액 더 늘 수 있음. [[domain-inventory]]는 별개(재고).
- **허브(hub)** — 품목의 창고 위치(hubLocationId, 없으면 영업장 기본 isHub). 수령 시 기본 배치처. [[domain-inventory]]
- **수령확정(confirmReceipt)** — 구매를 재고 입고로 확정. receivedAt 설정 + 허브 배치 + 자동 점검.
- **양도인(prevOwner)** — 영업장 인수 전 점유자 몫. 인수일(acquisitionDate)·cutoff로 분리.
- **CHECKOUT_PENDING / RESERVED / ACTIVE / NON_RESIDENT** — lease 상태. 거주성·청구 대상 판정에 사용.
