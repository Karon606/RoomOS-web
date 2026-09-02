# 퇴실 정산 환불 가드 + AI 티 2차 정비 맥락 (2026-09-03)

## 결정 (운영자 "전부 권고대로")
- A-1 지낸 달 받은 돈 0 인 계약의 '환불 없음' 기본값은 확인창 없이 통과. 섹션 캡션이 설명한다.
- A-2 환불 스냅샷을 지우는 세 경로(수정 폼 거주중 복귀·전환 버튼 거주중 복귀·단기 연장)도 같은 문장으로 거부. "환불 확정 계약은 복귀·연장 전에 환불 적용취소부터"가 상태 전환 규칙이 된다.
- A-3 위치 표현은 "위 이용료 정산 항목"(보증금 카드 다음이라 '맨 위'는 거짓).
- B-1 §11 틴트 배지 ring 폐지. B-2 §18 홈 알림 행 립 제거·틴트 유지. B-3 퇴실 정산 위젯 입력 40/44 이번에.

## 왜 술어 하나인가
`'refund' in undo` 관용구가 clear·prorationDataForChange 두 곳에 흩어져 있었고 set 이 빠졌다. 세 번째(이제 여섯 번째) 자리가 생기니 `hasRentRefundSnapshot` 으로 뽑아 감지망이 이름 하나로 건다. finalizeRentRefund 의 멱등 검사와 getRentRefundForLease 파싱은 소유자라 그대로.

## 왜 위젯에 불리언 prop 인가
위젯이 직접 getRentRefundForLease 를 부르면 버튼이 먼저 뜨고 잠기는 점프. RentSettlementPanel 콜백은 카드와 위젯의 결합. RoomRow 에 서버가 계산한 불리언 하나를 얹으면 JSON 은 서버에 머물고 첫 렌더부터 잠긴 줄이다.

## 왜 '전액 환불' 판정에 futurePrepaid 를 더하는가
`amount >= max` 는 "선납 전부"이지 문장의 "사용분까지"가 아니다. '환불 없음'이 뒤 달 선납을 돌려주게 된 뒤(2026-09-02) prepaid === futurePrepaid 면 기본값이 전액과 같아진다. 갈래별 예외(후보 a·b)가 아니라 판정식을 문장에 맞추면(c) 기존 "계산값 그대로면 안 묻기" 규칙 안으로 들어온다.

## 왜 prorationDataForChange 의 환불 가드를 isShortTerm 분기 앞으로 옮겼나
가드가 단기 해제 분기 뒤에 있으면 환불 확정 뒤 단기로 바뀐 계약이 그 분기에서 스냅샷을 잃는다. finalizeRentRefund 가 단기를 거부하므로 "확정 뒤 단기로 전환"만 남는 구멍인데, 가드를 앞에 두면 단기 여부와 무관하게 막힌다. 같은 이유로 undoShortStayExtension 은 finalize 가 단기를 거부해 도달할 수 없어 RESTORE(면제)로 둔다. 운영자 승인 범위(세 경로) 밖으로 넓히지 않았다.

## 왜 거부 문장을 상수 하나로 모았나
같은 뜻의 문장이 다섯 자리에 서면 한 자리만 고쳐지는 날이 온다. `RENT_REFUND_LOCKED` 하나를 술어 옆(lib/rentRefundRecord)에 두고 감지망 ⓠ 가 리터럴을 금지한다. 폼 경로(updateTenant)는 `{ ok: false, error }`, syncShortStayCharge 는 throw 인데 두 호출자의 catch 가 `(err as Error).message` 를 그대로 돌려주므로 화면에 닿는 문장은 같다.

## B 전제
1차 정비는 2026-08-25 완료(7커밋). 이번은 잔여·정본 불일치·가이드 개정 항목. 스타일 변경의 적용취소는 git revert, 가이드 개정의 되돌리기는 부록 A 에 개정 전 문장.
