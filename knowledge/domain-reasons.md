# 사유 목록(입실 취소·퇴실·보증금 미반환)과 '기타' 저장 규약

2026-10-22 운영자 승인("입실취소 사유를 추가하는게 환경설정에 있어?" 이어서 "'기타'를 넣고 이 사유를 목록에 추가하는 기능을 다 넣고 … 삭제 수정 등은 설정에서"). 관련: [[domain-checkout-settlement]] · [[domain-cleaning]] · [[domain-auto-checkout]] · [[decisions]]

## 무엇이 참인가
- **목록은 영업장 설정이다.** `Property.cancelReasons`·`checkoutReasons`·`withholdReasons`(콤마 칸, null = 코드 기본값). 기본값은 `lib/optionLists` `OPTION_LIST_DEFAULTS` 한 벌이고 종전 코드 상수에서 '기타'만 뺀 것이다(백필 없음, 기존 영업장은 목록이 한 글자도 안 바뀐다). 환경설정 > 분류 관리의 할인 사유 카드 옆 세 장(OptionSection 정본, 삭제·초기화·이름 변경 적용취소)에서 고친다.
- **'기타'는 목록 항목이 아니다.** 고르는 칸(CategorySelect `addMode="ask"`) 맨 끝에 늘 붙는다. '기타'·'기타 · …'·시스템 라벨은 목록에 못 넣는다(`reservedOptionNameError`, 손 추가·이름 변경·자동 추가가 같은 문).
- **저장 규약(정본 `lib/reasonLists`).** 기타에 적은 글은 `'기타 · 글'`(글이 없으면 `'기타'`). '이 사유를 목록에 추가'(기본 꺼짐)를 체크하면 그 글이 목록 끝에 들어가고 기록은 맨 글자로 남는다. 서버(`lib/reasonListSave` `reasonForSave`)는 화면을 믿지 않는다. 목록(과 보호 이름)에 없는 맨 글자는 `'기타 · 글'` 로 바꿔 남기고, 고치는 기록의 지금 값과 같으면 그대로 둔다(목록에서 뺀 항목·옛 이름 '키값'). 목록 추가는 기록이 선 뒤(commit)다.
- **수정 화면 해석**(`reasonPickOf`). 목록에 있으면 그 항목, `'기타 · '` 로 시작하면 기타 + 글, 둘 다 아니면 저장 글자 그대로 한 줄 세워 손대지 않으면 그대로 저장된다. 상태 이력 사유 적용취소는 이전 글자를 다시 재지 않는다(`restore`).
- **이미 쌓인 `'기타 · 공실 없음'` 류는 손대지 않는다**(결정 4). 운영 DB 2026-10-22: 취소 '기타' 7건 중 6건이 공실 없음 갈래, 퇴실 '기타 · 친구와 동반거주' 2건, DepositRefund '키값' 4건.
- **보호 이름**: 미반환 '청소비'(퇴실 정산이 몰취를 청소비와 나누고 청소비 잔고를 센다)·'인수 승계 보증금'(인수 전 입주자 퇴실에서 앱이 미리 고른다)은 이름을 못 바꾼다. 목록에서 빼도 서버가 그 글자를 그대로 받는다(보호 이름은 '알려진 이름').
- **이름 변경이 따라가는 기록**: 취소·퇴실 사유는 `TenantStatusLog.reason` 을 영업장(`propertyId` 칸이 있다)과 `toStatus`(취소 CANCELLED / 퇴실 CHECKOUT_PENDING·CHECKED_OUT)로 나눠 바꾼다. 같은 글자의 다른 사유·`'기타 · 글'`·남의 영업장은 안 바뀐다. 무효 처리 행도 그때의 표기라 함께 바뀐다. 미반환은 `DepositRefund.reason` 만 바꾸고 `ExtraIncome.detail` 문장은 그때의 기록이라 안 바꾼다. 적용취소는 바뀐 행 id.
- **퇴실 사유 이어받기**(`lib/checkoutReason`)는 '시스템 라벨이 아닌가'로 본다. 시스템 라벨 전수는 `lib/statusReasons` `SYSTEM_STATUS_REASONS`(단기 자동 전환·퇴실 한 달 전 자동 전환·자동 전환 되돌림·단기 연장·퇴실 적용취소·단기 연장/감액 적용취소)이고 상태 이력 쓰기는 이 상수만 쓴다(글자를 바로 적으면 `scripts/test-reason-lists` 가 붉게 선다). 운영 퇴실 예정 사유 전부에서 종전 판정과 답이 같다.
- **저절로 쌓던 목록(할인 사유·직업·지출 카테고리 두 폼·요청 카테고리)도 같은 체크박스**(`addMode="auto"`, 기본 켜짐, 결정 2). 끄면 목록에 안 넣고 값은 적은 글자 그대로다. 이 칸들은 원래 목록 밖 글자(뺀 카테고리)를 맨 글자로 두는 칸이라 `'기타 · '` 꼴로 바꾸지 않는다. 단위·쇼핑몰·수행자는 종전 그대로(체크박스 없음).

## 사유 고르는 자리(전부 `addMode="ask"`)
입실 취소·퇴실: 상태 전환 미니폼(TenantStatusTransitions)·입주자 수정 폼 상태 칸(TenantClient, FormData `cancelReason`·`cancelReasonAddToList`)·상태 이력 사유 수정(TenantStatusHistory). 미반환: 미니폼·입주자 환불창(TenantClient)·홈 퇴실 정산(DashboardClient)·보증금 패널 기록 폼(DepositStatusPanel, 힌트 `hintTone="mid"`, --cream-soft 위 --warm-muted 는 다크 4.46:1). 새 자리는 `scripts/check-option-lists` ⓛ ASK_SITES 에 적는다.

## 알려진 공백
- 분류 관리 카드(OptionSection)는 320·360px × 글자 125% 에서 행 단추(수정·삭제)와 등록 단추가 카드 밖으로 넘친다. 기존 카드(할인 사유)도 같다(2026-10-22 하네스 실측). 카드 전부의 공용 문제라 이번 범위 밖.
- 상태 전환·입주자 수정 경로의 통합 하네스는 관문 대역 사용자 id 가 uuid 가 아니라 이력 행을 못 만든다. 그 두 경로는 배선 그물(ⓛ)이 본다.
- 2차 목록(결정 5)은 이번 범위 밖.

## 그물
`scripts/test-reason-lists.ts`(진리표) · `scripts/test-reason-lists-flow.ts`(PGlite 통합) · `scripts/check-option-lists.mjs` ⓕ·ⓛ · `scripts/test-checkout-reason.ts` · `scripts/test-discount-reasons.ts`(목록 17·보호 이름). 운영 적용은 `prisma/migrate_reason_lists.sql` 먼저.
