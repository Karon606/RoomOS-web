# 이용료 정산 '환불 없음' 확정 갈래 맥락 (2026-09-02)

## 왜 필요한가
카드의 '환불 미처리'는 "아직 안 돌려줌"과 "안 돌려줄 것"을 구분 못 했다. 퇴실 처리 세 화면은 환불 0 이면 서버에 아무것도 안 싣고(finalize 가 0 을 거부), 적용취소 뒤 prevProration 이 복원돼도 같은 모양이라 카드가 영영 '미처리'로 선다. 운영자 말대로 일찍 나가며 환불받는 쪽이 오히려 드물어 0원 출구가 당장 필요했다.

## 후보 B 채택 — finalizeRentRefund 가 0 을 확정으로 받는다
별도 액션 + noRefund 키(후보 A)는 'refund' 키 보호 지점(prorationDataForChange·clearCheckoutProration·감사 6/8·record 잠금)을 복제한다. 퇴실 시 자동으로 청구를 받은 돈에 맞추는 것(후보 C)은 되돌리기와 흔적이 없다. 0 갈래는 record 를 안 만지고 checkoutProratedAmount 를 그 달 받은 돈으로 올린 뒤 refunded 0 스냅샷만 남긴다. 적용취소는 기존 undoRentRefund 그대로(deletedRecordIds 빈 배열, newRecordId null).

## 'none' 의 뜻 (운영자 수정 1)
"이용료를 안 돌려준다"가 아니라 "지낸 달(귀속월) 이용료는 안 돌려주고, 아직 지내지 않은 뒤 달 선납(futurePrepaid)은 돌려준다". settlementAmounts 한 줄이 바뀌면 퇴실 처리 섹션·카드 예상·확정 셋이 같이 움직인다. 카드에서 later > 0 이면 0 확정 대신 안내창을 띄우고 환불 기록 폼에 later 를 채운다(운영자 요청 "해당 금액은 환불해야 한다는 알림"). 서버도 later > 0 이면 0 을 거부해 우회 경로를 막는다.

## 기본 갈래 = 환불 없음 (운영자 수정 2)
퇴실 처리 화면(withNone)은 단기 견적 유무와 상관없이 'none' 이 기본. 운영자 확인: "환불이 없지만 필요에 따라 환불을 할 수 있게는 가능한거지?" → 세그먼트에 위약금·면제·단기가 그대로 남고 금액도 손댈 수 있어 가능. 위젯(withNone 없음)은 종전대로 단기 있으면 단기, 없으면 위약금. defaultSettlementPick 에 withNone 인자를 더해 한 함수가 둘을 답한다.

## 0원 확인창은 매번 (운영자 결정)
기본값 'none' 그대로 확정해도 "이용료를 환불하지 않고 처리할까요?" 를 지금처럼 띄운다. 설계 패널의 "기본값 그대로면 안 묻기" 제안은 기각. 선납이 있으면 환불액이 0 이 아니라 어차피 안 뜬다.

## 서로 배타적인 두 갈래
later > 0 인 계약은 >0 확정(환불 기록)으로만 닫힌다(keeps = paid(mon) 이 되어 '환불 완료'). 0 스냅샷은 later === 0 일 때만 성립. 그래서 "환불 없음 확정 뒤 선납이 남는" 상태가 생기지 않는다.

## 낙관적 잠금
0 갈래는 record 를 안 지우니 트랜잭션 count 불일치 가드가 없다. 대신 lease updateMany 의 where 에 읽어 둔 checkoutProratedMonth·Amount 를 걸어 동시 확정을 CONFLICT 로 막는다.

## 멱등 가드 접두어 불변
'이미 환불 처리된' 으로 시작하는 오류 문자열을 세 화면과 checkoutWithDepositRefund 가 멱등 재시도 판단에 쓴다. 0 갈래도 같은 문구를 낸다.

## 세 화면의 `> 0` 게이트 (커밋 3)
환불 0 을 서버에 안 싣던 게이트가 '환불 미처리' 의 생성 경로다. 게이트를 걷으면 세 화면 모두 0 을 finalize 로 보내 스냅샷이 남는다. 단기 계약(isShortTerm)은 finalize 가 여전히 거부하므로 화면이 settlementApplies 로 먼저 거른다.

## 감사 규칙 3 확장
스냅샷이 있는데 checkoutProratedAmount !== prepaid − refunded 이면 refund-billing-drift. 0 갈래 뒤 누가 청구를 다시 손대면 잡힌다.
