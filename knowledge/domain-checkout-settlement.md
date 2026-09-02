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
| none | 환불 없음 | 지낸 달 이용료는 돌려주지 않는다. 아직 지내지 않은 뒤 달 선납(futurePrepaid)은 돌려준다 | 퇴실 처리 화면에만 선다 |

- **기본 갈래는 자리마다 다르다** (`defaultSettlementPick(shortStay, withNone)`). 퇴실 처리 화면
  (withNone)은 단기 견적 유무와 상관없이 **'환불 없음'** 이 기본이다(운영자 확정 2026-09-02, "일찍
  나가며 환불받는 쪽이 오히려 드물다"). 위약금·면제·단기는 세그먼트에 그대로 남고 금액도 손댈 수
  있어 필요하면 환불한다. 위젯(withNone 없음)은 단기 견적이 있으면 단기, 없으면 위약금이다. 1개월을
  못 채운 중도 퇴실은 처음부터 단기로 계약했을 때와 같은 금액을 받는 게 원칙이다(운영자 확정
  2026-08-29). 견적이 없다는 것은 한 달을 채웠거나 만기 퇴실이라 단기 요금이라는 것이 없다는 뜻이다.
- **'환불 없음'의 뜻은 지낸 달(귀속월) 이용료를 안 돌려주는 것이지, 이용하지 않은 달까지 갖는 게
  아니다**(운영자 정의 2026-09-02). `settlementAmounts('none')` 은 뒤 달 선납(futurePrepaid)만 환불로
  낸다. 그래서 선납이 있으면 '환불 없음' 갈래의 환불액이 0 이 아니고, 섹션 캡션이 "아직 지내지 않은
  기간의 선납 X은 환불 없음과 상관없이 돌려드립니다" 라고 말한다.
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

묻는 조건과 문장은 `lib/checkoutSettlement.ts` 의 순수 함수 `rentSettlementConfirmSpec(rent,
depositReturn)` 이 쥔다(2026-09-03). 회귀 테스트가 문장을 직접 보게 하려고 뽑았고,
`confirmRentSettlement` 는 그것을 §14 다이얼로그 · §27.4 caution 으로 띄우기만 한다.

'전액' 판정은 `amount > 0 && amount >= max && amount > futurePrepaid` 다. `amount >= max` 만
보면 그것은 "선납 전부"이지 문장이 말하는 "사용분까지 모두"가 아니다. '환불 없음'이 뒤 달 선납을
돌려주게 된 뒤 지낸 달 받은 돈이 0 인 계약(prepaid === futurePrepaid)은 기본값이 전액과 같아져
"전액 환불할까요"가 떴다. 갈래별 예외를 두지 않고 판정식을 문장에 맞추면 기존 "계산값 그대로면
안 묻기" 규칙 안으로 들어온다. 그래서 `RentSettlementValue` 에 `futurePrepaid` 가 있고
정본 섹션의 `valueFor` 가 서버 값을 채운다.

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
  축 ⓔ 는 확인창 문장·판정이 lib 정본에 있는지(래퍼에 문장 없음, `const full` 이 futurePrepaid 를
  봄, `valueFor` 가 서버 값을 채움), 축 ⓘ 는 환불 확정 위젯 잠금(서버 판정·prop 전달·버튼 없는 줄).
- `scripts/check-checkout-side-effects.mjs` 축 ⓞ 사유 승계, 축 ⓠ 환불 확정 뒤 쓰기 거부.
  ⓠ 는 함수를 열거해 `checkoutProrationUndo` 를 DbNull 로 비우는 것이 RESTORE 넷 밖이면 술어를
  요구하고, 술어가 쓰기보다 앞인지·다섯 자리가 상수를 쓰는지·리터럴 문장과 `'refund' in` 관용구가
  없는지 본다.
- `scripts/test-money.ts` 확인창 판정 7 케이스(전액·다른 금액·0·prepaid === futurePrepaid).
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

## 확정 뒤의 자리 — 수납 정보 이용료 정산 카드 (2026-09-02 밤, 커밋 87241683)

`components/entity-modal/widgets/RentSettlementPanel.tsx`. 퇴실 예정·완료 계약의 보증금 패널 바로
아래에 서고 단기 계약에는 안 선다. 세 상태.

- 예상(퇴실 예정). `previewCheckoutRefund` 기본 갈래의 환불액. 위젯이 먼저 확정해 둔 청구가 있으면
  결제액 − 그 청구. 편집 칸은 없다 — 예정 단계의 조정은 퇴실 정산 위젯이 정본이라 '정산 조정'이
  위젯을 연다(같은 값을 두 자리가 다르게 저장하는 일을 막는다).
- 환불 완료(스냅샷 있음). 환불 / 원 수납 / 청구 확정과 사유. [적용취소]가 §16 상시 진입점이고
  [금액 수정]은 적용취소 + `finalizeRentRefund` 재확정 두 호출이다. 확정만 과거 회계월 보호에
  걸리므로 카드가 `checkSettlementMonth` 를 먼저 묻는다(되돌리기만 남는 길을 막는다). 둘째 호출이
  막히면 카드 안 경고로 남고 홈택스 안내는 확정 쪽만 띄운다. 입주자 정보 탭에 있던 적용취소 두 행은
  이 카드로 이관했다(getTenantDetail 이 CHECKED_OUT 을 안 실어 퇴실자에게 안 그려졌었다).
- 환불 미처리(스냅샷 없이 청구 확정만 있고 받은 돈이 더 많음, 또는 뒤 달 선납이 살아 있음,
  `getPendingRentRefundNotice`). 출구가 둘이다(2026-09-02). 돌려줬으면 [환불 기록](`finalizeRentRefund`
  >0), 안 돌려주기로 했으면 [환불 없음](`finalizeRentRefund` 0). 재확정 둘째가 막힌 중간 상태도 같은
  모양이라 입구가 같다. 뒤 달 선납(later)이 있으면 [환불 없음]은 안내창을 띄우고 환불 기록 폼에 그
  금액을 채운다. 서버도 later > 0 이면 0 을 거부한다(우회 경로 차단).
- 환불 없음(스냅샷 refunded 0). 배지 '환불 없음', 금액 줄 "환불 0원 / 원 수납 X 전액 회사 귀속".
  [적용취소]가 스냅샷을 지우고 청구 확정을 기록 전으로 돌려 카드가 다시 '환불 미처리'로 선다.

수동 환불액에는 사유 한 줄을 받는다(메모 꼬리 `· 사유: …` + 스냅샷 `reason`). 규칙 6 은 사유가
있는 스냅샷을 건너뛴다 — 알고 고른 금액을 매일 다시 묻지 않는다.

환불 확정이 만든 record(메모 `[중도퇴실 환불]`, 정본 `lib/rentRefundRecord.ts`)는 잠근다.
`updatePayment`·`deletePayment` 가 거부하고 두 수납 목록은 버튼 대신 안내 한 줄. 여기서 고치면
스냅샷(원 수납 − 환불)과 어긋나 적용취소가 엉뚱한 금액을 복원한다. 규칙 8 `rent-refund-record-drift`
가 그 달 살아 있는 이용료 record 합 ≠ 원 수납 − 환불을 잡는다(잠금을 뚫은 흔적).

적용취소 뒤 prevProration 이 null 인 계약(위젯을 거치지 않고 확정된 506·519호)은 checkoutProratedMonth
가 비어 카드가 사라진다(재확정 입구 없음).

## '환불 없음' 확정 (`finalizeRentRefund` 0 갈래, 2026-09-02)

환불 0 은 거부가 아니라 확정이다. record 는 한 건도 안 만진다(받은 돈이 그대로 매출이라 지울 것도
재기록할 것도 없다). 그 달 청구 확정(checkoutProratedAmount)을 받은 돈으로 올려 '받은 돈 > 확정
청구'를 닫고, refunded 0 스냅샷(deletedRecordIds 빈 배열, newRecordId null)을 남긴다. 적용취소는
기존 `undoRentRefund` 그대로다. record 를 안 지우니 count 불일치 가드가 없어, 읽어 둔 청구 확정을
updateMany where 에 걸어 동시 확정을 CONFLICT 로 막는다(낙관적 잠금).

- 뒤 달 선납(later > 0)이 있으면 0 을 거부한다. 그 계약은 환불 기록(>0)으로만 닫힌다. 그래서 "환불
  없음 확정 뒤 선납이 남는" 상태가 생기지 않는다.
- '환불 미처리'가 없는 계약(청구 확정이 없거나 이미 받은 돈 이상)은 남길 스냅샷이 없어 noop 성공이다.
  일할 자동 적용이 폐지돼(2026-08-01) 위젯이 세운 계약만 청구 확정이 있으므로, 보통의 조기 퇴실을
  기본 갈래 '환불 없음' 그대로 확정하면 이 경로다(카드는 안 선다).
- 스냅샷 존재 가드가 record 메모 가드 앞에 선다. 메모 가드는 재기록이 있는 달만 잡아 전액 환불(회사
  귀속 0)과 환불 없음(record 무접촉)을 못 봤다. 오류 접두어 '이미 환불 처리된' 은 세 화면과
  `checkoutWithDepositRefund` 가 멱등 재시도 판단에 쓰므로 바꾸지 않는다.
- 퇴실 처리 세 화면과 `checkoutWithDepositRefund` 의 `> 0` 게이트가 '환불 미처리'의 생성 경로였다.
  정산 섹션이 섰으면 0 도 싣는다. 섹션이 안 선 계약(단기 등)은 홈 알림이 null 을 실어 안 보낸다.
- `getPendingRentRefundNotice` 와 0 갈래는 같은 셈(`rentRefundPendingFor`)을 쓴다. 카드가 보여 준
  숫자와 서버가 거부하는 기준이 갈리지 않게.
- 0원 확인창("이용료를 환불하지 않고 처리할까요?")은 기본값 그대로여도 매번 묻는다(운영자 결정).
  선납이 있으면 환불액이 0 이 아니라 어차피 안 뜬다. 결제액 전부가 뒤 달 선납인 계약
  (prepaid === futurePrepaid)이 'none' 기본에서 '전액 환불' 확인창을 띄우던 엣지는 판정식에
  `amount > futurePrepaid` 를 더해 해소했다(2026-09-03, 위 확인창 절).
- 감사 규칙 3-b `refund-billing-drift`. 스냅샷이 있는데 checkoutProratedAmount ≠ prepaid − refunded
  이면 신고(예행 0건). 확정 뒤 위젯이나 스크립트가 청구를 다시 손대면 잡힌다.

## 환불 확정 뒤의 쓰기는 술어 하나로 막는다 (2026-09-03)

환불을 확정하면 `checkoutProrationUndo.refund` 스냅샷이 남고 그것이 적용취소의 유일한 근거다.
그 스냅샷을 지우거나 청구를 덮는 쓰기가 여섯 자리에 흩어져 있었고 `'refund' in undo` 관용구가
두 곳에만 있었다. 술어를 `hasRentRefundSnapshot(undo)` 하나로 뽑고(`lib/rentRefundRecord.ts`)
거부 문장도 상수 `RENT_REFUND_LOCKED` 하나로 모았다. "이용료 환불이 확정된 계약입니다. 환불
적용취소를 먼저 진행해 주세요."

막는 자리 다섯. `setCheckoutProration`(위젯 재적용), `clearCheckoutProration`,
`prorationDataForChange`(퇴실일 변경), `updateTenant` 의 거주중 복귀, `applyStatusTransition` 의
거주중 복귀, `syncShortStayCharge`(단기 연장). 앞 셋은 청구를 덮고 뒤 셋은 스냅샷을 지운다.
그래서 **환불 확정 계약은 복귀·연장 전에 환불 적용취소부터**가 상태 전환 규칙이다.

- `prorationDataForChange` 의 가드는 `isShortTerm` 해제 분기보다 **앞**에 선다. 뒤에 두면 확정 뒤
  단기로 바뀐 계약이 그 분기에서 스냅샷을 잃는다.
- 면제(RESTORE)는 넷. `finalizeRentRefund`(소유자), `undoRentRefund`(복원이 일), `undoChangeDueDay`
  와 `undoShortStayExtension`(원복). 마지막은 `finalizeRentRefund` 가 단기를 거부해 도달할 수 없다.
- `syncShortStayCharge` 만 throw 인데 호출자 둘(수정 폼·단기 연장 모달)의 catch 가
  `(err as Error).message` 를 그대로 돌려주므로 화면에 닿는 문장은 다섯 자리가 같다.
- 화면 쪽 짝은 잠긴 줄이다. `RoomRow.rentRefundFinalized` 를 서버가 계산해 내리고
  `CheckoutProrationWidget` 이 버튼 슬롯을 비운 한 줄로 선다. 눌러야 거절되는 버튼을 두지 않는
  것이 §22 이고, 적용취소 진입점은 같은 화면 위 이용료 정산 카드다(§16 원위치).

## 관련 노트

[[open-checkout-paths-split]] 세 경로 통합의 전사. [[short-stay-policy]] 단기 요금 산식.
[[deposit-return-pending]] 보증금 반환 보류. [[cash-receipt-refund]] 환불 시 현금영수증.
