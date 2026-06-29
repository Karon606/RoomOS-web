# 도메인: 빌링(월 청구·임대료) — 결제 핵심 (§4)

> ⚠️ 결제 로직 변경은 loop.md §4 — 운영자 확인 후. 코드가 진실, 변경 전 `lib/billing.ts` 확인.

## 단일 엔진
`lib/billing.ts` **`billForLeaseMonth(lease, mon, locked)`** 하나로 청구액을 정한다. 읽기 3곳
(수납 `getRoomPaymentStatus`·대시보드 `page.tsx`·미납 `unpaid.ts`)과 쓰기(`savePayment` 등)가 전부 공유.
**여기 규칙을 바꾸면 모든 화면이 같이 바뀐다.**

## 우선순위 (그 달 청구액)
1. **퇴실 일할** — `checkoutProratedAmount` & `checkoutProratedMonth === mon` 이면 그 값.
2. **락인(locked)** — 그 달 record들의 최대 `expectedAmount`. 월세가 바뀌어도 과거가 소급 재계산되지 않게 고정.
3. **그 달 유효 기준액 × 할인** — `discountedRent(discounts, mon, 유효기준액)`.

## 예약 인상은 '그 달 이용료부터' (2026-06-29)
- 방 `scheduledRent` + `rentUpdateDate`(예 7/1). `applyScheduledRents`가 적용일에 `baseRent`로 옮기고 lease.rentAmount 동기화.
- **그 전에도** 대상월 ≥ 인상적용월이면 `scheduledRent`로 청구해야 한다("7/1부 = 7월 이용료부터"). 적용일 전 선납도 인상가.
- 구현: `billForLeaseMonth`가 `l.room.{scheduledRent, rentUpdateDate}`를 읽어 처리. → 호출부 lease 쿼리에 `room {scheduledRent, rentUpdateDate}` select 필요(수납·대시보드·미납·savePayment·serverBillForMonth·findFirstUnpaidMonth).
- 전 계약 적용(협의가 포함, 7/1 자동적용과 동일). 자동메모리: [[rent-increase-month-based]]

## 할인은 수납에서, 계약서는 정가
조건부·재량 할인(예: 양곡지원 1만)은 수납 단계 할인만, 계약서 입실료는 정가. [[discount-vs-contract-price]]

## 예약 인상/인하 — 적용일(rentUpdateDate) 필수 (2026-06-29)
예약 가격변경은 `Room.scheduledRent`(새 금액) + `Room.rentUpdateDate`(적용일) **둘 다** 있어야 동작한다.
- 청구: `effectiveBaseRent`(billing.ts)는 `scheduledRent>0 && rentUpdateDate 있음 && 대상월 ≥ 적용월`일 때만 scheduledRent 적용. **적용일 없으면 인상/인하가 영원히 적용 안 됨**(옛 baseRent/rentAmount로 청구).
- 적용 스케줄러(`room-manage/actions.ts` ~355)도 `rentUpdateDate <= today`만 처리, 적용 시 baseRent로 옮기며 활성계약 rentAmount 동기화(line 395). 적용일 없으면 스킵 → 고아.
- **버그(해결)**: `updateRoom`이 두 필드를 독립 저장(검증 없음) + 일괄편집(batch)엔 적용일 필드 자체가 없어 → '금액만 있고 적용일 없는 고아' 발생(502·522호). 7월 인상 선납이 옛 금액 처리돼 과납(오류신고 ede8e3f8). **수정**: 두 경로 모두 예약금액↔적용일 동시입력 강제(XOR 차단, 예약삭제 시 적용일도 제거) + batch 모달 적용일 DatePicker 추가. 데이터 보정: 502·522 rentUpdateDate=2026-07-01, 522 7월 470,000 완납·8월 과납기록 삭제. [[rent-increase-month-based]]
- ⚠️ 또 의심되면: `scheduledRent != null && rentUpdateDate == null` 인 방(고아)을 찾아라.

## 기타
- `discountedRent` = `lib/rentDiscount.ts`(단위테스트됨). 월별 할인 적용.
- 퇴실월 무청구: `isCheckoutNoBillingMonth`(퇴실일 ≤ 그 달 납부일이면 0).
- 발생주의(귀속월=targetMonth) 모델. 선납·이월 처리. 용어 [[glossary]].
