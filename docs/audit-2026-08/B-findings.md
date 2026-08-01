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

## 2. B-2 / B-3 트랙
조사 진행 중.
