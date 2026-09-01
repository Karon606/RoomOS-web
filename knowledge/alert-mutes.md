# 홈 알림 끄기 — 전 카테고리 공용, 파생 목록 위의 접기

2026-09-02 운영자 지시. "업무가 실제로 처리되는 것과는 관계없이 이 알림은 이제 필요없어" -
알림마다 수동으로 끌 수 있어야 한다. 전날 만든 현금영수증 건별 끄기를 하루 만에 일반화했다.

## 정본 규칙

- 저장은 `Property.alertMutes`(Json, [{k, at}]) 한 칸. 끄기·켜기는 `muteHomeAlert`/
  `unmuteHomeAlert`(rooms/actions). 현금영수증 건별 키는 `receipt:계약|수납일|수단`이고
  기존 `muteReceiptAlert` 는 접두어만 얹는 껍데기다. 구 칸 `receiptAlertMutes` 는 이주 후
  안 읽는다(migrate-alert-mutes.mjs, 멱등).
- **키는 만드는 쪽(dashboard/page)이 정한다.** 명시 muteKey 가 없으면 파생 -
  recurring 은 `recurring:{id}:{이체일}`(회차 단위), 그 외 leaseTermId, tenantId 순.
  명시 키의 단위 결정: movein/moveout/tour/unpaid = 계약 단위(다시 켤 때까지),
  upcoming = 납부일 회차 단위(다음 달엔 다시 알림), move = 이사 회차, wish = 방 단위,
  request = 요청 건, inventory = 품목(low/draft 구분), receipt 홈 요약 = `receipt:summary`.
  키가 없는 알림은 끄기 버튼 자체가 안 선다.
- 끈 건은 숨기지 않고 홈 하단 '끈 알림' 접힌 목록으로 - 언제든 다시 켠다(§16).
  알림 상세의 '이 알림 끄기' + 토스트 적용취소.
- 앱은 알림만 접는다 - 일(발급 의무 등) 자체가 사라지는 게 아니라고 문구가 말한다.
