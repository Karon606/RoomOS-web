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
- **추천 납입액/귀속월 금액도 인상 반영(2026-06-30)**: `getTargetMonthOptions`(귀속월 드롭다운)는 옛날 `lease.rentAmount` 평면값 대신 **`billForLeaseMonth`**(일할→락인→예약인상→할인) + 퇴실월 이후 제외로 계산. 수납폼(`PaymentEntryForm`) 추천액은 자동(FIFO)일 때 '가장 이른 미완납 달' 기준 → **인상 전 달이 완납되면 다음 납입부터 인상가가 자동 추천**. savePayment는 원래부터 서버에서 월별 재계산(무변경)이라 추천=저장 일치.

### 두 개의 '월 이용료' 소스 — effective vs lease.rentAmount (2026-06-30)
- **청구·매출·미납·수납추천**: `billForLeaseMonth`(effective, room.scheduledRent+rentUpdateDate 직접 읽음) → **7/1부터 자동 정확**(스케줄러 무관).
- **고객관리 리스트·계약서 등 표시**: 원시 필드 `lease.rentAmount` 사용 → `applyScheduledRents()`가 적용일 경과분을 baseRent로 옮기고 활성계약 rentAmount 동기화해야 갱신됨.
- `applyScheduledRents` 트리거: **호실관리·대시보드·고객관리 페이지 로드 시**(2026-06-30 확대). ⚠️ 주석은 `/api/cron/apply-rents` cron 도 있다 하지만 **실제 라우트 없음**(vercel.json엔 push-alerts만) → 페이지 로드가 유일 트리거. 멱등(적용 후 scheduledRent=null). 백로그: 진짜 일일 cron(다영업장 순회) 추가하면 무방문 자동적용 가능.
- 매출 귀속: **발생주의(targetMonth)**. 6월에 낸 7월분(targetMonth=2026-07)은 **7월 매출**, 6월엔 미인식(미래 귀속월 제외).

## 기타
- `discountedRent` = `lib/rentDiscount.ts`(단위테스트됨). 월별 할인 적용.
- 퇴실월 무청구: `isCheckoutNoBillingMonth`(퇴실일 ≤ 그 달 납부일이면 0).
- 발생주의(귀속월=targetMonth) 모델. 선납·이월 처리. 용어 [[glossary]].

## 퇴실 보증금 정산 경로와 감사 (2026-07-21, 신고 249b5652)
퇴실 경로 3개 모두 보증금 정산을 강제한다 — (1) 상태전환 위젯 환불 미니폼, (2) 대시보드 알림 checkoutWithDepositRefund, (3) 입주자 수정 폼(상태 드롭다운 퇴실)은 저장 시 환불 모달 강제(proceedAfterRentDecision, 7/20 봉합: tenantId 필드명 오타 773b990 + z 충돌 d5cf060).
- '계약상 보증금' = LeaseTerm.depositAmount(약정액, 실입금과 별개). 입금 기록 없으면 약정액으로 잔고 폴백. 재무 보증금 탭에 InfoHint(?) 설명.
- 미반환분은 recordDepositReturn이 부가수익 category '보증금'(예약 취소 몰취는 '위약금')으로 자동 생성.
- 감사: `node --env-file=.env.local scripts/check-deposit-settlement.mjs` — CHECKED_OUT+보증금>0+DepositRefund 0건 나열. 7/20 이전 버그 창구 피해 3건 중 임형진은 백필(backfill-lim-deposit.mjs), 비쉬 간바트·윤정승은 운영자 확인 대기.

## 퇴실 일할 자동적용의 안내 게이트 (2026-07-21, 신고 0df59b92)
자동적용(데이터)은 퇴실 예정 저장 즉시 — billForLeaseMonth 가 이 값을 선납 추천액으로 쓰므로 미루면 과납이 생긴다. **안내 문구만** `isMoveOutNear`(lib/prorate 정본, 오늘+1달·과거 포함) 게이트로 분기: 근접이면 금액 포함 현행, 먼 미래면 "N월 이용료가 일할 청구 예정, 지금 처리할 일 없음" 사실 안내. 정산 팝업(shouldOfferCheckoutProration)과 같은 게이트를 공유한다 — 근접 판정 로직을 새로 만들지 말 것.

## 방 청소 비용 (2026-08-05, 신고 b21e4e98)

**청소 이력은 돈을 만들지 않는다. 돈은 기존 둘만 만든다** — 받은 청소비는 `ExtraIncome`,
나간 비용은 `Expense`. `RoomCleaning` 은 그 `Expense` 를 `expenseId` 로 **가리키기만** 한다.

**금액을 청소 이력에 복사하지 않는다.** 사본을 두면 지출 화면에서 금액을 고쳤을 때 갈린다.
표시할 때 `expenseId` 로 조회해 읽는다.

**비용 0(직접 청소)이면 `Expense` 를 안 만든다.** 자기 노동은 비용이 아니고, 지출 정본이
금액 0 을 애초에 거부한다.

**`fromCleaningFund` 는 회계 처리가 아니라 표식이다.** 어느 돈으로 냈는지를 적을 뿐 손익을 안 바꾼다.
예비비처럼 `Expense` 를 안 만드는 방식을 베끼면 **실제로 나간 현금이 손익에서 사라진다** —
예비비는 자기자본 적립이라 그게 성립하지만 청소비는 이미 수익으로 인식된 돈이라 성립하지 않는다.
운영자 확정(2026-08-05)도 (가) 관리용 꼬리표이고, 매출 정의는 안 바뀐다.

**연결된 `Expense` 를 청소 쪽에서 지우지 않는다.** `Expense` 에는 소프트삭제 칸이 없어
되돌릴 길이 없고, 운영자가 지출 화면에서 손본 것(구매처·메모·영수증)이 통째로 사라진다.
재완료는 있는 지출을 고치고, 되돌리기는 연결만 끊는다. 지울지는 지출 화면에서 사람이 정한다.

**주의 — 커밋 39f3ed8 의 메시지가 "1단계는 회계에 접점이 0" 이라고 적었는데 그 시점 코드는
이미 `Expense` 를 만들고 있었다.** 운영자가 2단계(비용 연결)를 곧바로 승인해 같은 흐름에서
구현됐기 때문이다. 기록과 코드가 어긋난 채 남으면 다음 세션이 틀린 전제로 판단한다.
정본은 이 노트다.

### 받은 청소비 잔고 (2026-08-05 운영자 승인, 4단계)

**잔고는 파생값이라 어디에도 저장하지 않는다.** 칸을 하나 만들면 수납·몰취·지출 셋 중
아무거나 고칠 때마다 갈린다. 계약 L 의 잔고는 그때그때 이렇게 합한다.

```
실현 수입 = ExtraIncome(leaseTermId=L, category '청소비') 합
          + DepositRefund(leaseTermId=L, reason '청소비') withheldAmount 합
부담      = RoomCleaning(leaseTermId=L, status DONE, deletedAt null, fromCleaningFund=true)
            가 가리키는 Expense.amount 합
잔고      = 실현 수입 − 부담
```

받은 청소비는 반환의무가 없는 확정 수입이다(운영자 2회 확정). 그래서 잔고는 부채가 아니라
**관리용 숫자**다. 넘게 쓰면 초과분은 운영 부담이고, 남으면 그냥 남는다. 어느 쪽도 입주자에게
더 받거나 돌려줄 근거가 아니다. 몰취(보증금에서 뗀 청소비)는 부가수익 category 가 '보증금'
이라 category 로는 안 잡힌다 — 그래서 `DepositRefund.reason` 쪽을 따로 더한다.

**귀속은 완료 시점에 한 번만 정한다.** 예정 등록에서 계약을 안 고르고 만든 청소가 대부분이라,
'받아둔 청소비로 부담' 을 체크해 완료하는 순간 그 방의 `CHECKED_OUT`·`CHECKOUT_PENDING`
계약 중 퇴실일(확정 퇴실일 없으면 예정일)이 가장 늦은 것으로 해석해 `leaseTermId` 에 적는다.
매번 다시 푸는 방식은 안 된다 — 나중에 계약 상태가 바뀌면 과거 기록의 귀속이 조용히 움직인다.
이미 걸려 있으면 다시 손대지 않는다. 표식은 **퇴실 청소에만** 붙는다. 도배 후·입실 중 청소는
귀속시킬 퇴실 계약이 없고, 비용 0(직접 청소)도 부담할 것이 없어 체크가 무시된다.

**정산 전에도 체크할 수 있다**(권고안 승인). 퇴실 청소는 보증금 정산보다 먼저 끝나는 것이
정상 순서라, 실현 수입이 아직 0 이면 계약 청소비를 근거로 `정산 전, 계약 청소비 20,000원`
이라고 병기한다. 실현분이 있으면 `이 퇴실 건 받은 청소비 20,000원, 남은 20,000원`.

**표시는 청소 패널 한 곳뿐이다.** 보증금 패널(`DepositStatusPanel`)은 건드리지 않는다 —
그쪽은 반환의무가 있는 돈의 잔고를 다루는 화면이고, 반환의무 없는 청소비 잔고를 같이 세우면
두 숫자가 같은 성격으로 읽힌다. 코드: `getCleaningFundStatus`(cleaningActions.ts),
`CleaningFundStatus`(cleaningConstants.ts), `RoomCleaningPanel`.
