# 퇴실 정산 3단계 — 정산 기준월 교체 계획 (2026-08-02)

## 무엇을 바꾸나

정산 기준을 **퇴실월**에서 **퇴실일이 속한 서비스 기간의 월**로 옮긴다.
납부일 20일인 사람이 9월 3일에 나가면 실제 기간은 8/20~9/19 인데, 지금은 퇴실월(9월)만 보고
9/20 부터로 잡아 기간이 통째로 어긋난다. 정본은 `lib/settlementPeriod.ts` 의 `settlementPeriodFor`.

## 설계 문서의 "한 줄이면 된다"는 틀렸다

`checkout-settlement-design.md:38` 이 "환불 함수 두 개는 이미 임의 월을 다루게 짜여 있어 기준월 산출
한 줄 교체로 끝난다"고 적고 있으나 **거짓이다**(코드 실태 조사 2026-08-01).

`previewCheckoutRefund` 는 기준월만 바꾸면 `daysUsed` 가 여전히 `calcCheckoutProration`(퇴실월 고정)
에서 나와 **null → 0** 으로 떨어진다. 그러면 환불 미리보기가 "하루도 안 썼으니 전액 환불"로 표시된다.
**오류도 경고도 없이 조용히 틀린 금액이 나온다.** 이게 이 작업에서 가장 위험한 형태다.

## 고쳐야 하는 12개 지점

| # | 위치 | 내용 |
|---|---|---|
| 1 | `tenants/actions.ts:2273` | preview 기준월 `expectedMoveOut.slice(0,7)` |
| 2 | `tenants/actions.ts:2280-2281` | `daysUsed` 출처를 `settlementPeriodFor().daysUsed` 로 |
| 3 | `tenants/actions.ts:2274` | 할인 적용월 — **정산 귀속월 기준으로 확정**(운영자 2026-08-02) |
| 4 | `tenants/actions.ts:2283` | `appliedProration` 비교월 |
| 5 | `tenants/actions.ts:2327` | finalize 기준월 |
| 6 | `tenants/actions.ts:2110·2112·2113` | `previewCheckoutProration`(에러 문구 포함) |
| 7 | `tenants/actions.ts:2454·2456·2478` | `setCheckoutProration` 저장월 |
| 8 | `tenants/actions.ts:2201·2203·2226·2236` | `prorationDataForChange` |
| 9 | `lib/prorate.ts:47-79` | `calcCheckoutProration` 자체 |
| 10 | `lib/billing.ts:86-94` | "퇴실월 당월에만" 전제 |
| 11 | `lib/prorate.ts:87-97` | `shouldOfferCheckoutProration` 팝업 판정 |
| 12 | `TenantClient.tsx:754·920` | 환불 기준일이 `expectedMoveOut` — 실제 퇴실일이어야 한다 |

**부분 수정은 지금보다 위험하다.** 미리보기와 확정이 각자 월을 계산하므로, 일부만 옮기면
미리보기는 8월 선납으로 환불액을 계산하고 확정은 9월 record 를 지운다(적대검증 P0-5).

## 이미 확보한 방어

0~2단계에서 먼저 깔아둔 것들이다. 3단계는 이것들 위에서만 안전하다.

- **0단계** `settlementPeriodFor` 결함 3건 수정(30일 상한·유예 무시·잘못된 입력 null). 57케이스
- **1단계** 환불 재기록의 증빙 메타 승계 + 홈택스 안내. 감지 5종
- **2단계** 과거 회계월 가드 — 전년도·인수 이전 차단, 같은 해 과거 달은 고지. 27케이스

## 완충 사실 (착수 근거)

기간월이 퇴실월과 다른 계약 12건 중 **일할이 걸린 건 0건, 환불 확정 건도 0건**이다.
즉 규칙을 바꿔도 **지금 저장된 값이 즉시 뒤집히지 않는다.**

그리고 조기 퇴실은 환불하지 않는 것이 기본이라 **일할을 아예 걸지 않는다**(설계 (a)안).
퇴실 예정 4명(507·509·413·522)은 전부 조기이거나 딱 맞아서 새 규칙으로도 아무것도 안 걸린다.
과거 달을 실제로 건드리는 경우는 **조기 퇴실인데 예외적으로 환불을 고른 때뿐**이고,
그건 운영자가 화면에서 의식적으로 선택하는 순간이다.

## 하지 않을 것

- **기존 데이터 재계산·백필 금지**(회계 패널). 규칙은 앞으로 처리하는 퇴실부터만 적용한다.
  과거 확정분을 새 규칙으로 다시 굴리면 이미 신고를 마친 달이 통째로 움직이고, 그건 코드로 되돌릴 수 없다.
- 단기 계약은 범위 밖. `settlementPeriodFor` 가 납부일 없으면 null 이고, 단기는 이미
  `prorationDataForChange`·`finalizeRentRefund` 에서 차단된다.

## 검증 계획

1. 전체 계약 × 2026-04~12 의 `billForLeaseMonth` 801행 덤프, 수정 전후 대조. **기대 diff 0행**
   (저장된 값을 안 건드리므로).
2. `test-money` 에 정산 기준월 케이스 추가 — 납부일 20·퇴실 9/3 이 8월 기간으로 잡히는지 등.
3. 퇴실 예정 4명에 대해 preview 금액을 수정 전후로 비교. 조기 퇴실이라 **환불 안 함이 기본**이니
   기본 경로에서는 금액 변화가 없어야 한다.
4. 회귀 주입 — 기준월을 퇴실월로 되돌리면 테스트가 잡는지.

## 착수 보류 — 적대 검증이 이 계획을 깼다 (2026-08-02)

**이 계획대로 하면 안 된다.** 아래가 검증에서 나온 것이고, 셋은 계획 자체의 결함이다.

### 치명적 1 — 검증 계획이 눈을 가린 검증이었다

"801행 덤프 diff 0행"은 맞지만 **아무것도 증명하지 못한다.**
화면 값은 `isCheckoutNoBillingMonthFor(...) ? 0 : billForLeaseMonth(...)` 형태이고,
게이트는 **`billForLeaseMonth` 밖에서 그 앞에** 판정한다. #10 은 정확히 그 게이트를 고친다.
따라서 게이트발 회귀는 덤프에 **한 행도 나타나지 않는다.**

고칠 것 — 덤프 단위를 합성값(`게이트 ? 0 : bill`)으로 바꾸고, 창을 2026-02 부터로 넓히고
(404 이지우 기간월이 2026-02 로 현재 창 밖), `previewCheckoutRefund` 반환값도 12건 전수 대조한다.

### 치명적 2 — 완충 집합과 위험 집합이 같은 집합이다

항등식: **기간월 != 퇴실월 ⟺ 퇴실일 < 퇴실월 납부일 ⟺ `isCheckoutNoBillingMonth` 가 true.**
즉 "저장값을 안 건드리니 안전"의 근거인 12건이, 하필 저장값을 안 거치고 화면에서 재계산되는
그 함수의 유일한 대상 집합이다.

#10 을 소박하게 `기간월 === mon` 으로 번역하면 9건 전부 게이트가 꺼져 퇴실월이
**0원에서 월세 전액 미납**으로 뒤집힌다. 합계 **3,590,000원의 유령 미수**가
대시보드·미납·리포트·수납관리·캘린더 여섯 화면에 동시에 뜬다.

올바른 표현은 `기간월 === mon` 이 아니라 **`기간월 < mon <= 퇴실월` 인 달이 0** 이다.
계획에는 어느 쪽인지 한 글자도 없었다.

### 치명적 3 — 12개 목록이 불완전하고 줄번호가 이미 stale 이다

- **`tenants/actions.ts` 의 `paidAgg` 선납액 집계월이 목록에 없다.** 이걸 안 옮기면
  `prepaidAmount = 0` 이 되고, 화면 게이트(`TenantClient` 의 `prepaidAmount > 0`)에 걸려
  **이용료 환불 섹션 자체가 사라진다.** 오류도 경고도 없다. 계획이 스스로 "가장 위험한 형태"라
  부른 것과 같은 형태다.
- **`setCheckoutProration` 에 회계월 가드가 없다(13번째 지점).** 가드는 `finalizeRentRefund`
  한 곳에만 걸려 있는데, 규칙 변경 후 이 함수는 일상적으로 과거 달에 쓴다. 2단계 가드가 우회된다.
- **#7 의 줄번호는 지금 `undoRentRefund` 본문을 가리킨다.** 줄번호를 믿고 편집하면 환불 적용취소를 깬다.
- `TenantStatusTransitions.tsx` 의 `shouldOfferCheckoutProration` 호출부, `scripts/test-money.ts` 의
  **기존 단언 재작성**(케이스 추가가 아니라), `scripts/check-checkout-proration.ts` 도 빠져 있다.

### 그 외

- ~~1월 퇴실 환불이 막힌다~~ — 2026-08-02 가드 경계선 교체로 해소.
- **중간 커밋 배포는 무조건 깨진다.** `calcCheckoutProration` 의 반환 의미가 계약이라
  생산자와 소비자가 같은 커밋에 있어야 한다. 9·10·1~8·12 를 **한 커밋**으로 묶는다.

## 7가지 결정 — 전부 확정 (2026-08-02)

| # | 항목 | 결정 |
|---|---|---|
| 1 | 무청구 게이트(#10)의 의미 | **`기간월 < mon <= 퇴실월` 인 달이 0.** `기간월 === mon` 으로 쓰면 9건이 0원에서 전액 미납으로 뒤집혀 359만원 유령 미수가 생긴다. 운영자 "기존 데이터는 재계산 안 하면 돼"와도 일치 |
| 2 | `calcCheckoutProration` 의 null 정의 | **null 을 없애지 않는다.** 새 정본 `settlementPeriodFor` 가 이미 null 규약을 갖고 있으므로(퇴실일 < 기간 시작), 기존 세 분기(미리보기 안내·기존 일할 해제·무청구 영역)는 그 null 을 그대로 먹는다. 다만 **발동 조건이 달라진다** — 종전 "퇴실일 < 그 달 납부일"에서 "퇴실일 < 기간 시작(입주일 보정 포함)"으로. 후자는 잘못된 입력일 때만 참이다 |
| 3 | 일할 저장에 회계월 가드 | **건다.** 2026-08-02 선반영 완료(커밋 b50783a) |
| 4 | 1월 퇴실(기간월 = 전년 12월) 환불 | **예외 불필요.** 가드 경계선을 신고 기한 날짜로 교체해 해소(커밋 c635f04) |
| 5 | `overrideDueDay` | **무청구 게이트도 정산 기간 정본을 타게 통일한다.** 지금은 게이트가 임시조정을 보고 정본은 안 봐서 한 화면에 두 규칙이 공존한다. 유예는 기한만 미룰 뿐 기간을 안 옮긴다는 운영자 확정이 정본 쪽이므로 게이트를 그쪽에 맞춘다 |
| 6 | 환불 기준일을 실제 퇴실일로 | **바꾼다.** 운영자 "환불 기준일은 실제 퇴실일이 맞기는 하지". 다만 **기존 데이터는 재계산하지 않는다** — 박민서·이현재·윤정승 3건은 이미 퇴실 완료라 새 기준을 소급 적용하지 않는다. 백필 없음 |
| 7 | `daysUsed` 상한 | **`settlementPeriodFor` 가 정본** — `min(rawUsed, periodDays, 30)`. 계약서 조항(1일 = 월/30)이 근거이고 기간을 넘는 일수도 있을 수 없다 |

## 고쳐야 하는 지점 — 13개 (줄번호 없이 함수명으로)

줄번호는 커밋마다 밀린다. 실제로 초판 계획의 #7 줄번호가 두 커밋 만에 `undoRentRefund` 를 가리켰다.
**함수명과 변수명으로만 지목한다.**

`app/(app)/tenants/actions.ts`
1. `previewCheckoutRefund` — 기준월(`moveOutMonth`)
2. `previewCheckoutRefund` — `daysUsed` 출처를 `settlementPeriodFor().daysUsed` 로
3. `previewCheckoutRefund` — 할인 적용월(정산 귀속월 기준)
4. `previewCheckoutRefund` — **`paidAgg` 의 선납액 집계월**(초판 누락. 안 옮기면 선납액 0 → 화면에서 이용료 환불 섹션이 통째로 사라진다)
5. `previewCheckoutRefund` — `appliedProration` 비교월
6. `finalizeRentRefund` — 기준월(`mon`)
7. `previewCheckoutProration` — 기준월과 에러 문구
8. `setCheckoutProration` — 기준월·할인월·저장월
9. `prorationDataForChange` — 기준월·할인월·저장월·안내 문구

`lib/`
10. `prorate.ts` `calcCheckoutProration` — 기간 기반으로
11. `prorate.ts` `shouldOfferCheckoutProration` — 위 함수 경유라 자동이나 시그니처 확인
12. `billing.ts` `isCheckoutNoBillingMonth` — **결정 1의 표현으로.** 여기가 359만원이 걸린 자리

화면
13. `TenantClient.tsx` 환불 기준일 2곳(`rentMoveOutYmd` 계열) — `expectedMoveOut` 에서 실제 퇴실일로.
    `TenantStatusTransitions.tsx` 의 `shouldOfferCheckoutProration` 호출부도 함께 확인

테스트
14. `scripts/test-money.ts` — **기존 단언 재작성**(케이스 추가가 아니다). 예:
    `calcCheckoutProration(RENT,'15','2026-06-10') === null` 은 새 규칙에서 5월 기간 26일로 유효값이 된다
15. `scripts/check-checkout-proration.ts` — 직접 호출부. 시그니처 변경 시 컴파일 확인

## 커밋 전략

**10·12·1~9·13 을 한 커밋으로 묶는다.** `calcCheckoutProration` 의 반환 의미가 계약이라
생산자와 소비자가 같은 커밋에 있어야 한다. 중간 상태로 배포되면 반드시 깨진다.
테스트 갱신(14·15)만 같은 커밋 안에서 따로 정리한다.

## 검증 계획 (재작성)

초판의 "801행 덤프 diff 0행"은 **눈을 가린 검증**이었다. 화면 값은
`게이트(...) ? 0 : billForLeaseMonth(...)` 형태이고 게이트가 `billForLeaseMonth` **밖에서 먼저**
판정하므로, 게이트발 회귀가 덤프에 한 행도 안 나타난다.

1. 덤프 단위를 **합성값**(`게이트 ? 0 : bill`)으로. 창은 **2026-02 부터**(404 이지우 기간월이 2026-02).
   **기대 diff 0행** — 결정 1·6에 따라 기존 데이터는 그대로여야 한다.
2. `previewCheckoutRefund` 반환값(`prepaidAmount`·`refund`·`appliedProration`)을 **12건 전수** 전후 대조.
   지점 4의 누락은 이 덤프로만 잡힌다.
3. `overrideDueDay` 보유 10건에 대해 게이트와 정본의 판정이 일치하는지(결정 5의 통일 확인).
4. 회귀 주입 — 게이트를 `기간월 === mon` 으로 되돌리면 덤프가 9건을 잡는지.

## 진행 상태

- [x] 계획 수립
- [x] 계획 적대 검증 — 깨짐
- [x] 7가지 결정 확정
- [x] 3·4번 선반영(가드 확장·경계선 교체)
- [ ] 13지점 한 커밋 구현
- [ ] 검증 1~4
