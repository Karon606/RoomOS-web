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

## 그 달 실수납의 상한은 '그 축이 인식하는 그 달 청구액'이다 (2026-08-11, 회계 패널)

홈 대시보드는 같은 달에 대해 두 축을 적는다. 예상 축(`totalExpected`)과 실수납 축(`paidRevenue`)이다.
두 축은 서로 다른 두 숫자가 아니라 **같은 분모에 대한 인식과 회수** 두 상태다. 그러므로 실수납의
상한은 인식액과 정의상 같아야 한다. 다르면 그 차이가 `pendingRevenue`(미수납)라는 이름으로 새어 나간다.

**정본은 `lib/leaseStatus.ts getPaidRevenue`** 하나다.

- 거주·비거주 계약: `min(그 달 귀속 수납 합, 그 달 청구액)`. 청구액은 양도인 귀속월 0, 퇴실월 초과 0,
  무청구 퇴실월 0, 나머지는 `billForLeaseMonth`(락인 반영). 홈 `billThisMonth` · 수납 행 `rowExpected`
  와 같은 규칙이다.
- 퇴실(CHECKED_OUT) 계약: `getCheckedOutRecognizedRevenue` 를 **그대로** 쓴다. 이 축의 인식액이
  정책상 rentAmount 가 아니라 '그 달 귀속 수납 합' 자체라(일할 정산되는 짧은 거주를 과다 인식하지
  않기 위한 기존 정본), 상한도 그 값과 같다. 두 축이 문자 그대로 같은 함수를 부르므로 갈릴 수 없다.

**왜 `lease.rentAmount` 로 캡하면 안 되는가.** rentAmount 는 오늘의 가격표(가변 마스터)고,
`record.expectedAmount` 락인은 그 달의 확정 청구권(불변 기록)이다. 가변 마스터로 과거를 재계산하면
방 가격을 고치는 순간 이미 마감한 달의 숫자가 바뀐다 — 결산 재현성이 사라진다. 실측으로 502호
남태우는 5·6월 청구가 각각 470,000 으로 락인돼 있고 그대로 완납했는데, 나중에 rentAmount 가
440,000 이 되면서 두 달 합 60,000 이 잘렸다. 잘린 돈은 매출도 부채도 아니게 증발하고, 그만큼이
이미 퇴실하고 완납한 사람에게 미수로 섰다. 반대로 헐겁기도 했다(519호 6월 실제 청구 370,000 에
캡 470,000, 418호 6월 실제 청구 80,000 에 캡 400,000).

**진짜 과납은 캡으로 자르지 않는다.** 회계 패널은 퇴실 항에도 락인 캡을 걸자고 했다. 초과분이
아무 판단 없이 수익이 되는 것을 막자는 취지였는데, 캡을 걸면 인식 축(무캡)과 실수납 축(유캡)이
갈려 같은 이름의 숫자가 화면마다 달라진다. 그래서 **취지를 캡이 아니라 감지망으로 옮겼다** —
`verify-money-consistency` 18번이 '퇴실 계약의 그 달 수납 > 그 달 락인 청구'를 직접 잡는다.
초과분의 귀착은 사람이 정할 일이다. 계약이 살아 있고 다음 달이 있으면 선수금(앱의 '이월'),
계약이 끝나고 반환의무가 소멸했으면 잡수입(앱의 '기타수익')이다. 앱이 수납 폼에서 묻는 그
두 선택지가 곧 회계 분기다.

전 기간 (계약, 월) 189 그룹 실측에서 수납이 락인 청구를 넘는 건은 0건이다.

## 청구의 단위는 방이 아니라 계약이다 (2026-08-11)

수납 관리는 방마다 대표 계약 하나(+비거주 하나)만 행으로 만들었다. 한 방에 계약이 둘이면
나머지 하나가 화면에서 통째로 사라졌고 그 계약의 그 달 청구액도 함께 사라져, 홈 예상 수입과
수납 화면 청구 합이 갈렸다(402호 황인정 329,000 · 503호 송호준 420,000). 대표 선택이 정렬 없는
조회 순서에 달려 있어 어느 쪽이 사라지는지도 비결정적이었다.

행 순서 정본은 `lib/leaseStatus.ts roomLeaseRowOrder` 다. 거주(거주중·퇴실 예정) 먼저,
그다음 입실 예약, 마지막이 비거주. 각 층 안에서는 입주 예정일 오름차순. 층 위계를
`primaryRoomLease` 와 같게 맞춰 두어 '첫 행 = 주 계약'이 항상 참이 되게 했다.

파생 규칙 둘. **만실 기준의 채움은 방 하나당 한 번씩**이다(계약 수로 늘면 같은 방을 두 번 판
셈이 된다). **상태 칩 카운터의 단위는 '명'**이다(칩은 필터라 숫자가 곧 그 목록의 행 수여야 하고,
행은 계약 단위다). 공실만 방에만 있는 사실이라 '실'을 유지한다.

## 미래월은 수납을 말하지 않는다 (2026-08-11)

서버는 미래월 행의 그 달 청구(`viewBilled`)를 0으로 잠근다(아직 안 온 달이라 미납 판정을 하지
않기 위함). 그래서 스트립의 수납액이 청구액과 같아져 늘 100% 완납으로 떴다. 미래월에는 수납액·
달성률·진행바를 두지 않고 '이 달 청구 예정액' 한 값만 세운다. 수납 0 / 0% 로 뒤집는 안은
기각했다 — 같은 진행바 문법이 현재월에서 '다 밀렸다'를 뜻해 거짓의 방향만 바뀐다. 미리 받은
돈은 사실이라 보조줄로 적되, 값은 행 잔액 되계산이 아니라 서버 정본(`getPaidRevenue`)이다.

## 딸린 계약의 납부일은 부모를 따라간다 — 플래그 없이 값끼리 견주어 (2026-08-13, 운영자 오더)

한 사람이 방을 둘 쓰면(509호 거주 + 601호 창고) 돈은 대개 같은 날 한 번에 들어온다. 그래서
딸린 계약(`LeaseTerm.parentLeaseTermId`)의 납부일은 **딸릴 계약과 같은 날이 기본**이고, 다르게
받고 싶으면 폼의 '납부일 따로 정하기'로 푼다. 잠그지 않는 이유는 다른 날을 원하는 경우가
실제로 있기 때문이다(운영자 원문).

**상속 플래그 컬럼을 만들지 않았다.** 저장되는 것은 늘 구체적인 날 하나이고, 그 날이 곧 청구가
읽는 값이다. '부모와 같은가'는 두 값을 견주면 알 수 있다. 그래서 폼의 초기 모드 판정과 서버의
전파 판정이 **문자 그대로 같은 규칙** 하나를 쓴다 — 딸린 계약의 납부일이 **비었거나 부모와 같으면
'같음'**, 그 밖이면 '따로'. 정본은 `lib/dueDay.ts` 의 `sameDueDay`(30 과 '말일'을 같은 날로 본다).

부모의 납부일이 바뀌면 `propagateDueDayToSubLeases` 가 '같음'이던 딸린 계약만 같은 트랜잭션에서
함께 옮긴다. 거는 자리는 부모의 dueDay 가 변할 수 있는 저장 경로 전부다 — `updateTenant`,
`moveInTenant`, `confirmReservationToActive`, `applyStatusTransition`(빈 납부일 자동 파생),
`changeDueDay`, `batchUpdateTenants`, 엑셀 가져오기 덮어쓰기. 적용취소가 있는 두 경로
(`changeDueDay`·`batchUpdateTenants`)는 전파분 원값까지 스냅샷에 실어 함께 되돌린다.

닿지 않는 것 둘. **거주 전 단계(문의·투어·예약·취소)의 딸린 계약에는 심지 않는다** — 그 상태에
납부일이 남아 있는 것 자체를 `lib/integrityAudit` 이 오염으로 센다. **끝난 계약(퇴실 완료)**의
납부일은 지난 기록이라 손대지 않는다.

한계 하나는 알고 받아들인 것이다. '따로'로 두었지만 우연히 부모와 같은 날을 적은 딸린 계약은
부모를 따라 움직인다. 값끼리 견주는 규칙에서 그 둘은 구별되지 않고, 그 구별을 만들려면 결국
플래그 컬럼이 필요하다. 폼이 그 계약을 '같음'으로 보여 주고 있으므로 화면과 저장은 어긋나지 않는다.
