# B페이즈(사람) 조사 결과 — 진행 중

**아직 수정 전.** `파일:줄` 은 조사 시점 기록이라 단정 전 확인할 것.

## 1. B-1 — 상태 전이 완결성 (상태기계 전문가)

### 구조
상태를 바꾸는 경로가 **4개**다. 전환 버튼(T) · 수정 폼 select(F) · 대시보드 알림(D) · cron(C).
**서버에 전이표가 없다** — `applyStatusTransition` 은 from/to 조합을 검증하지 않고 그대로 캐스팅 저장.
즉 서버가 허용하는 전이는 8×8 전부이고, 게이트는 상태쌍이 아니라 필드 조건 3개(입주일·예약확정 필수값·미니폼)뿐.
**UI 에 없는데 서버가 허용하는 전이가 44개 중 30개**이고, 그중 8종은 실제 운영에서 발생했다(폼 경로).

### [P0] 퇴실을 되돌리면 다시 퇴실할 수 없다 — 작업 차단
`recordDepositReturn` 에 계약당 환불 1건 멱등 가드(tenants/actions 793-797). 전환 버튼의 퇴실 미니폼은
환불을 **먼저** 기록하고 실패 시 return 하므로 상태 전환 자체가 막힌다(TenantStatusTransitions 238-247).
그런데 `undoDepositReturn` 은 **환불 직후 토스트에서만** 호출 가능(TenantClient 955) — 상시 취소 UI 없음.
실측: CHECKED_OUT→ACTIVE 2건·→CHECKOUT_PENDING 2건이 이미 발생. 되돌린 계약에 환불 기록이 남아 있으면
재퇴실이 영구 차단되고, 에러가 안내하는 "기존 환불 취소"는 화면에 존재하지 않는다.
같은 가드가 예약금 반환에도 있어 **재취소도 차단**.

### [P0] 폼 경로 RESERVED→ACTIVE 는 예약 선납 재앵커를 건너뛴다
`reanchorReservationPrepaid` 호출부는 3곳(moveInTenant 1046, confirmReservationToActive 1128,
applyStatusTransition 1317). **updateTenant 에는 없다.** 폼 select 로 예약→거주중을 바꾸면
선납이 옛 달에 남아 입주월이 미납으로 뜬다. **같은 논리 전이인데 경로에 따라 돈 처리가 다르다.**

### [P1] 같은 방 이중 점유 가드가 한 곳에만
호실 중복 검사는 `addTenant:182-193` 에만 있다. `updateTenant`·`applyStatusTransition` 에는 없다.
- 같은 RESERVED→ACTIVE 인데 `confirmReservationToActive` 는 막고 전환 버튼은 안 막는다(진입점별 가드 불일치).
- `applyStatusTransition:1320-1332` 은 그 방의 다른 lease 를 보지 않고 isVacant 를 덮어써,
  비거주+거주 공존 방에서 한쪽 퇴실 시 **거주자가 있는 방이 공실로 표시**된다(현재 실측 0건, 잠재).
- `roomVacantForStatus` 는 투어 상태에서 null 을 반환해 호실을 점유된 채 방치 — 폼 경로와 다름.

### [P1] 자동 전이를 놓치면 조용한 매출 누락
- `autoTransitionReserved` 는 **호출부 없는 죽은 코드**(커밋 b8fe79d 로 의도적 제거).
- 유일한 자동 전이는 cron 의 단기 ACTIVE→CHECKOUT_PENDING 인데 **알림 발송 라우트에 얹혀 있어**
  cron 실패·시크릿 오설정이면 조용히 안 돈다. 재시도 없음.
- 입주 알림은 **당일만** 조회(alerts 71-74). 자동 전이도 없으므로 **입주 당일 하루를 놓치면 RESERVED 영구 방치**
  → RESERVED 는 청구·미납 양쪽에서 제외라 **청구도 미납도 0**. integrityAudit 도 이 케이스를 안 잡는다.

### [P1] 전환 위젯의 막다른 상태
`transitionsFor()` 의 `default: return []` 때문에 CHECKED_OUT·CANCELLED 에서 버튼이 없다. 추가로
NON_RESIDENT 종료 수단 없음, ACTIVE 즉시 퇴실 없음(퇴실예정을 반드시 경유), ACTIVE·CHECKOUT_PENDING 입실취소 없음.
탈출구가 수정 폼뿐이라 **되돌리기·종료가 '계약 수정'으로 위장**되고, 그 경로는 위 P0/P1 부수효과를 건너뛴다.

### [P2] 역행 시 돈이 원복되지 않는다
- CHECKED_OUT→ACTIVE: moveOutDate·RoomStay 는 복구되나 **DepositRefund·ExtraIncome(몰취분)은 그대로 남는다.**
- CANCELLED→RESERVED/ACTIVE(실측 5건): prepaid 취소로 소프트삭제된 record 가 복원되지 않는다.
  코드 주석이 "상태는 유지 — 필요 시 상태 변경으로 복구"라며 **돈과 상태의 undo 분리를 인정**한다.

### [P2] 원자성 없음 + 실측 잔재
`applyStatusTransition` 은 lease→roomStay→room→statusLog 를 **트랜잭션 없이** 순차 실행하고,
그 앞단에서 환불·몰취를 별도 액션으로 **먼저** 커밋한다. 중간 실패 시 "돈은 처리됐는데 상태는 그대로".
실측 잔재 1건: Jihan Ismam(RESERVED) 에 소프트삭제된 8월 실수납 50,000 이 남아 있다.

### [P2] 상태 변경이 집계에서 조용히 빠뜨린다
ACTIVE→RESERVED(실측 3건)·ACTIVE→CANCELLED(1건) 시 그 계약의 청구·미납이 사라지고 이미 받은 실수납도
매출에서 증발한다. 경고 문구 없음(현재 CANCELLED 중 살아있는 record 0건이라 실 피해 없음).

### [정상]
입주일 강제 4경로 일치, 거주 전 dueDay null 전 경로 일치, RoomStay 이력 처리, 예약 확정 검증 4중 일치,
예약금 몰취 회계 분리, DB 무결성(이중 점유 0·퇴실일 없는 CHECKED_OUT 0·isVacant 불일치 0·입주일 지난 RESERVED 0).

## 2. B-2 — 되돌리기·예약금 (임대차 운영 전문가)

### [높음] 보증금 환불 되돌리기 진입점이 토스트뿐
`recordDepositReturn` 은 계약당 1건 멱등 가드(tenants/actions 793-797). `undoDepositReturn` 호출부는
`TenantClient.tsx:955` 토스트 액션 **한 곳뿐**. 위젯 경로(TenantStatusTransitions 253)·홈 알림 경로는
undo 액션조차 없다. 토스트가 사라지면 취소 UI가 존재하지 않고, `DepositRefund` 를 지우는 화면도 없다.
게다가 `undoDepositReturn` 은 DepositRefund·ExtraIncome 를 **하드 삭제**한다.

### [높음] 예약금 재앵커 판정이 원값만 본다 — 황인정 5만원 위험
`reanchorReservationPrepaid` 는 `lease.reservationDepositMode !== 'prepaid'` 면 즉시 return(rooms/actions 1183).
그런데 이 컬럼은 `saveReservationDeposit` 경유 수납에서만 채워진다. 기존 경로는 null 이고,
`resolveReservationDepositMode`(기본 deposit)는 표시·취소 분기에만 쓰인다.
**실측 황인정**: RESERVED, mode=null, 입주 2026-08-02, 계약보증금 0, `PaymentRecord{2026-07, isDeposit:false, 50,000}`.
- 입주 시 재앵커 no-op → 7월 매출 인식, 8월 미납
- 취소 시 deposit 갈래로 가는데 `getReceivedDepositTotal`(isDeposit=true)=0 → 반환·몰취 화면이 안 뜬다.
  **받은 5만원이 장부에서 증발한다.**

### [높음] 부분 실패 데드엔드
`recordDepositReturn` → `applyStatusTransition` 순서인데 트랜잭션이 없다. 앞이 성공하고 뒤가 실패하면
환불 기록은 남고 상태는 그대로. 재시도는 멱등 가드가 막고, DepositRefund 를 지우는 UI 는 없다.

### [중간] 그 밖
- `undoReservationPrepaidCancel` 이 `recalculatePayments` 를 다시 안 돌린다(isPaid 가 옛 상태로 남음)
- 몰취 귀속월이 '취소 실행일' — 반대편 선납은 원래 달에서 사라져 두 달이 동시에 움직이는데 안내 없음
- `checkoutTenant`·`moveInTenant` 의 revalidatePath 가 `/tenants` 뿐 — 호실·도면·홈이 안 갱신
- prepaid 모드는 보증금 영수증이 0원(선납은 isDeposit=false) 인데 발급 대상에는 오른다
- 돈이 움직이는 액션 9개 중 **금액을 말하는 토스트는 2개뿐** (money-display-feedback §2a 위반)
- `deleteTenant` 는 하드 삭제(cascade) — 소프트삭제 패턴 미적용

## 3. B-3 — 퇴실 정산 연결 (정산 전문가)

### [P0] 환불 경로가 3개 퇴실 경로 중 1개에만, 그마저 게이트에 막힘
위젯·홈 알림 경로는 `finalizeRentRefund` 를 아예 호출하지 않는다. 편집폼 경로만 있고 그것도
`depositAmount > 0` 일 때만 열린다. 일할 위젯이 약속한 "퇴실 처리 때 뜨는 환불 창"이 대부분 경로에 없다.
**실측 미환불 잔액**: 504호 이예준 50,667원(계약보증금 0이라 경로C도 차단), 409호 변세진 13,000원.
둘 다 CHECKED_OUT 이라 미납 집계에서도 빠져 영구 방치.

### [P0] 퇴실일 < 납부일이면 정산 수단이 아예 없다
`lib/prorate.ts:74` 가 null 을 반환하고 미리보기가 "일할 불필요"로 닫는다. 맞는 말이지만
**실제 미사용 기간은 전월에 전액 청구돼 있고**, 일할·환불은 `checkoutProratedMonth` 단일 월에만 걸려 있어
전월 귀속분을 건드릴 수단이 없다.
**실측(진행 중)**: 509호 탄 타르 누 아예 약 62,667원, 507호 먀 야다나 모에 약 62,667원(둘 다 8/2 퇴실),
413호 박순자 약 58,333원(8/15 퇴실). ※ 522호 이경호는 기간 마지막날 퇴실이라 정당.

### [P1] 실수납 보증금이 있어도 계약 보증금 0이면 정산 화면이 안 뜬다
위젯·편집폼 모두 `lease.depositAmount > 0` 게이트. 예약 취소 경로만 실수납 기준을 쓴다.
**실측**: 520호 김민정(단기) 계약 0, 실수납 20,000(메모 '청소비'). 8/2 퇴실인데 반환·몰취 화면이 없다.

### [P1] 실제 퇴실일(moveOutDate)이 청구·일할·환불 어디에도 안 들어간다
전부 `expectedMoveOut` 만 본다. 실측: 418호 서민준 예정 6/13·실제 6/16 → 3일치 미청구.

### [P1] 일할·환불 baseRent 가 예약 인상 미반영 (A페이즈 P1 재확인, 미수정)

### [P1] `isCheckoutNoBillingMonthFor` 의 납부일 소스가 화면마다 4가지
`rooms/actions.ts:693`(findFirstUnpaidMonth)만 `lease.dueDay` 원본을 쓴다 — 임시조정·유예 전부 무시.

### [정상]
단기 일할 차단 작동, 일할·환불 적용취소(스냅샷 기반) 정상, 환불 확정 케이스 정합(임형진),
CHECKED_OUT 중 계약보증금>0 인 6건 모두 DepositRefund 존재, 소프트삭제 이중계상 없음.

## 4. 운영자 확인 대기 (규칙)

1. 퇴실일이 납부일보다 앞설 때 **안 쓴 기간을 환불하는가**. 한다면 위약금 규칙은.
2. 이미 퇴실한 이예준(50,667)·변세진(13,000) 미정산을 어떻게 할 것인가.
3. 김민정 청소비 20,000 은 반환인가 몰취인가.

