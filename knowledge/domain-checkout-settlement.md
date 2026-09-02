# 퇴실 이용료 정산의 갈래와 사유 승계 (2026-09-02 신고 3건, 커밋 c52b2cf9 · cbac5f8b)

퇴실 처리 세 화면(홈 알림·프리즘 입주자 정보·입주자 관리 수정)과 수납 정보의 퇴실 정산 위젯이
같은 기본값·같은 산식·같은 라벨·같은 확인창을 쓴다. 갈래 판단은 `lib/checkoutSettlement.ts` 한 벌이다.

## 신고 요지 (2026-09-02, 원문은 오류신고 기록에)

- 신고 1. 퇴실 예정 때 적은 사유가 퇴실 처리 폼에 안 온다(미니폼이 열 때마다 사유를 비웠다).
- 신고 2. 506호 문정현 님, 짧게 지내다 나갔는데 퇴실 처리 화면이 위약금 갈래 고정이라 79,800원이
  환불로 확정됐다. 위젯만 단기 요금을 알았다.
- 신고 3. 퇴실 정산 위젯의 편집 칸이 적용 금액(청구액)이라 환불액을 직접 못 쳤다.

## 갈래 넷 (SettlementPick)

| 갈래 | 라벨 | 뜻 | 서버 모드 |
|---|---|---|---|
| legal | 위약금 | 원칙. 사용 일수 + 잔여 이용금액의 위약금(계약서 §2) | legal |
| goodwill | 면제 | 사용 일수만 청구, 위약금 안 받음 | goodwill |
| shortStay | 단기 | 처음부터 단기로 계약했을 때와 같은 금액(calcShortStay baseAmount) | goodwill 견적에 baseAmount 대입 |
| none | 환불 없음 | 이용료를 돌려주지 않고 퇴실(결제액 회사 귀속) | 퇴실 처리 화면에만 선다 |

- **기본 갈래는 단기 견적이 있으면 단기, 없으면 위약금** (`defaultSettlementPick`). 1개월을 못 채운
  중도 퇴실은 처음부터 단기로 계약했을 때와 같은 금액을 받는 게 원칙이다(운영자 확정 2026-08-29).
  견적이 없다는 것은 한 달을 채웠거나 만기 퇴실이라 단기 요금이라는 것이 없다는 뜻이다.
- **단기 요금이 결제액을 넘으면 환불은 0 에서 멈추고 차액은 청구하지 않는다** (`settlementAmounts`,
  설계 확정 2026-09-02). 한 달치를 내고 나가는 사람에게 더 내라는 것은 정산이 아니다. 위젯의 적용
  금액(청구액)은 단기 요금 그대로 두어 종전 동작을 지킨다.
- '환불 없음'은 위젯에는 없다. 위젯은 청구액을 확정하는 자리라 '안 함'이 성립하지 않는다.
- 라벨은 네 개가 320px 폼 폭(224px)·글자 확대 1.25배에서 한 줄에 서야 해서 '단기'·'환불 없음'으로
  짧다. 짧아진 뜻은 세그먼트 위 전제문(`settlementPremise`)과 갈래 캡션(`settlementPickCaption`)이
  채운다. 전제문이 없으면 '환불 없음' 옆의 '면제'가 이용료 면제(전액 환불)로 거꾸로 읽힌다.

## 확인창 (`components/checkout/confirmRentSettlement.ts`)

확정 직전에 세 화면이 같은 문장으로 묻는다. 묻는 조건은 셋이다. 계산값과 다른 금액, 환불 0,
결제액 전액. 셋 다 caution 한 등급이다(전액 환불과 나머지의 등급이 갈리면 위험도가 뒤집힌다).
보증금 반환액이 같은 확정에 실리면 "보증금 반환 M · 총 환불액 N" 을 본문에 붙인다.
사람이 안 만진 계산값 0 도 caution 으로 묻는 것은 운영자 판단 항목으로 남겼다.

## 위젯 환불액 직접 입력 (신고 3)

`CheckoutProrationWidget` 의 편집 칸은 환불액이고 적용 금액(청구액)은 읽기전용 파생이다
(§12 자동 합산 읽기전용). 저장 형식은 그대로 `checkoutProratedAmount = prepaid − 환불액`.
선납이 0 이면 환불이 성립하지 않으니 종전 적용 금액 칸을 그대로 둔다(칸이 두 상태).
초과 입력은 지우지 않고 danger 테두리와 적용 버튼 비활성으로 막는다.

## 퇴실 사유 승계 (신고 1, `lib/checkoutReason.ts`)

사유를 말하는 시점은 통보를 받는 '퇴실 예정'이다. 퇴실 처리는 그 사유를 이어받는다.

- `inheritableCheckoutReason(logsNewestFirst)` 는 최신부터 거슬러 CHECKOUT_PENDING 으로 들어온
  행의 사유(정본 목록에 있는 것)를 돌려준다. 시스템 라벨('퇴실 한 달 전 자동 전환' 등)은 사유가
  아니라 건너뛴다. 예정 구간 밖 전이(연장으로 거주 복귀, 이미 퇴실)를 먼저 만나면 null 이다.
  연장했다가 다시 나가는 사람에게 옛 사유가 붙으면 안 된다. 무효 처리된 행은 없던 일이다.
- 쓰는 곳. 서버 `checkoutTenant`(화면 없는 경로도 이어받음), 프리즘 미니폼 프리필, 입주자 수정 폼
  프리필(`getTenants` statusLogs 에 연장 복귀 행을 OR 로 더함), 감사 규칙 7, 정적 축 ⓞ.
- 프리필과 같은 값이면 캡션 "퇴실 예정 때 고른 사유 · 필요시 수정" 으로 출처를 밝히고, 그 상태는
  Modal dirty 로 치지 않는다.

## 감지망

- `scripts/test-money.ts` 단기 상한 23일·할인가·두 갈래 폭(79,800 대 0)·반올림 역전·기본값·none.
- `scripts/test-checkout-reason.ts` 14 케이스. 둘 다 verify:fast.
- `scripts/check-rent-settlement-branch.mjs` 정적. 두 화면이 lib 갈래·라벨·전제문·캡션을 쓰는지.
- `scripts/check-checkout-side-effects.mjs` 축 ⓞ 사유 승계.
- `lib/integrityAudit.ts` 규칙 6 `refund-over-short-stay`(단기 자격 퇴실인데 단기 갈래 환불보다 큰
  환불 확정), 규칙 7 `checkout-reason-dropped`. 예행은 `npx tsx --env-file=.env.local
  scripts/inspect-integrity-audit.ts <규칙>`. 운영자가 일부러 면제를 고른 건은 무시(dismiss)로 닫으면
  재적재 안 된다.
- 한 건의 흔적은 `node --env-file=.env.local scripts/inspect-checkout-case.mjs <이름> [호실]`,
  클래스 전수는 `scripts/inspect-shortstay-refund-class.ts`.

## 남긴 것

- 환불 스냅샷에 갈래(pick)가 안 남는다. 그래서 규칙 6 은 '단기 자격인데 위약금 갈래' 를 직접
  판정하지 못하고 금액 비교로 포함한다. 남기려면 `finalizeRentRefund` 인자와 세 호출처를 건드린다.
- 퇴실 처리 화면에서 단기 요금 청구 확정(서버 세 번째 문)은 보류. 폼 순서 재배치 보류.
- 실데이터 검출. 규칙 6 은 506호 문정현(79,800)·413호 정은숙(112,200), 규칙 7 은 5건. 데이터는
  앱의 '적용취소' 로 운영자가 되돌린다(스크립트로 안 만진다).

## 관련 노트

[[open-checkout-paths-split]] 세 경로 통합의 전사. [[short-stay-policy]] 단기 요금 산식.
[[deposit-return-pending]] 보증금 반환 보류. [[cash-receipt-refund]] 환불 시 현금영수증.
