# 도메인: 재고 관리

핵심 파일: `app/(app)/inventory/{overview.ts(잔량 계산), actions.ts, InventoryClient.tsx}`.

## 품목 식별 = (propertyId, category, label) 유니크
`TrackedItem`은 `@@unique([propertyId, category, label])`. **qtyUnit 은 식별자가 아니다**(표시용 메타데이터, null 가능). 구매(Expense)의 품목 귀속은 (category, itemLabel)로 판단.
- 잔량/소모/입수/단가 계산의 구매 매칭은 **느슨 매칭**(`qtyUnit이 null이거나 같으면 일치`)으로 통일됨. 엄격(완전일치)이면 단위 미입력 구매가 누락됨(과거 라면·물티슈 버그).

## 수령확정 = 반드시 위치에 배치
`confirmReceipt`는 위치 미지정으로 받아도 **품목 허브(hubLocationId → 영업장 기본 창고 → 첫 위치)에 자동 배치**하고 자동 점검(`sourceExpenseId`)을 생성한다. 안 그러면 위치별 점검이 미배치 입고분을 못 세어 잔량에서 증발(과거 라면 120개 버그).
- 인라인 일괄수령은 **순차** 처리(동시 호출 시 자동점검 경합).

## 위치별 점검 더블클릭 방지
저장 중복 제출 차단: 클라 동기 가드(`savingRef`/`submittingRef`) + 서버 멱등(같은 patch면 재적용 안 함). `locationPatch`는 상대 차감(허브 −보충)이라 재적용 시 허브 2배 차감되던 버그.

## 잔량 계산 모델 (overview.ts)
`currentStock = 마지막 점검 remainingQty + (점검 이후 수령 구매·무상입수)`. 같은 날 중복 점검은 최신만 채택(dedupSameDay). 입고 귀속은 `receivedAt`(수령일) 기준.

관련 자동메모리: [[trace-full-dataflow]]
