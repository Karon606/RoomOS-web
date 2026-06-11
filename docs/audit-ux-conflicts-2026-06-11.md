# 앱 전반 사용 충돌·유저 혼란 점검 보고서

점검일: 2026-06-11 · 방식: 8개 차원 병렬 코드 리뷰(48건 발견) + 발견별 적대적 검증 → **확정 43건 / 기각 5건**
모든 확정 건은 검증 에이전트가 해당 코드를 직접 읽고 재확인한 것입니다.

## 요약

| 차원 | 높음 | 중간 | 낮음 |
|---|---|---|---|
| 청구 엔진 3곳 동기화 | 3 | 3 |  |
| 퇴실 일할 정산 | 2 | 4 |  |
| 지출·배송비/합배송 | 3 | 2 | 1 |
| 재고 점검·단위·병합 | 3 | 3 |  |
| 뱃지·용어·색상 일관성 | 3 | 2 |  |
| 모달·URL·네비게이션 | 2 | 3 | 1 |
| 되돌리기(undo) 커버리지 | 4 | 1 |  |
| 페이지 간 데이터 신선도 | 2 | 1 |  |

## 청구 엔진 3곳 동기화

### 1. [🔴 높음] 수납 등록이 할인 미반영 원금(rentAmount)을 expectedAmount로 저장해 락인 로직이 할인을 무효화 — 할인 입주자가 완납해도 영구 미납으로 잡힘
- **위치**: `app/(app)/rooms/actions.ts:689`
- **내용**: savePayment 호출부 3곳(TenantClient.tsx:747, DashboardClient.tsx:1309·1472) 모두 `expectedAmount: lease.rentAmount`(할인 미반영 원금)를 전달하고, savePayment은 이 값을 모든 충당 월 record에 그대로 저장한다(rooms/actions.ts:689, FIFO 한도 계산 671행도 동일). 그런데 세 청구 엔진의 락인 로직(rooms/actions.ts:254~258, dashboard/page.tsx:864~870, unpaid.ts:93~99)은 '그 달 record의 최대 expectedAmount'를 그 달 청구액으로 채택하고, 락인이 있으면 discountedRent(할인가) fallback을 무시한다(`locked && locked > 0 ? locked : discountedRent(...)`). 즉 월세 50만·할인 5만(청구 45만)인 입주자가 45만을 내는 순간 그 달 record에 expectedAmount=50만이 락인되어, 세 엔진 모두 그 달 청구를 50만으로 재계산한다. recalculatePayments는 isPaid만 갱신하고 expectedAmount를 고치지 않으므로 영구적이다.
- **유저 임팩트**: 할인 입주자가 할인가를 완납한 당일: 수납 페이지 당월은 '완납'(expected=할인가 45만)인데 대시보드 미수납 위젯·매일 푸시 알림은 미수 5만을 표시. 다음 달부터는 수납 페이지 이월액에도 -5만이 떠서 '미납' 뱃지가 붙고, 사용자는 분명히 다 받은 돈을 계속 독촉 대상으로 보게 된다. lib/rentDiscount.ts로 통일했다는 할인 계산이 쓰기 경로에서 깨지는 구조.
- **개선 방향**: savePayment 호출부가 그 달 실제 청구액(할인·일할 반영)을 expectedAmount로 전달하거나, savePayment 내부에서 월별 billForMonth를 재계산해 record별 expectedAmount를 저장.

### 2. [🔴 높음] '퇴실일이 납부일 이전이면 그 달 청구 0'(checkoutNoBilling) 규칙이 수납 페이지에만 있어 퇴실예정자가 대시보드·푸시에서만 미납으로 잡힘
- **위치**: `app/(app)/dashboard/unpaid.ts:291`
- **내용**: 원 설명은 정확하며 한 가지 시점 단서만 보정: 대시보드 미수납 위젯과 미납 푸시에서 '미납(도래·미회수)'으로 잡히는 것은 그 달 dueDay가 지난 시점부터이고(미도래 동안은 '납부 예정'·청구액 불일치로 나타남), CHECKOUT_PENDING→CHECKED_OUT 자동 전환이 없어 관리자가 수동 퇴실 처리를 하기 전까지 이 불일치(완납 vs 한 달치 미납 푸시)가 지속된다.
- **유저 임팩트**: 납부일 6일·퇴실예정일 5/3인 입주자: 수납 페이지는 5월 청구 0원·완납으로 표시하는데, 대시보드 '이달 미수납' 위젯과 매일 발송되는 미납 푸시 알림에는 한 달치 전액 미납으로 계속 등장. 수납현황 위젯의 '완료' 건수에서도 빠져 같은 화면 안에서도 숫자가 어긋난다. 사용자는 어느 쪽이 맞는지 알 수 없고, 이미 나간 사람에게 독촉 알림을 받는다.
- **개선 방향**: checkoutNoBilling 판정을 공용 헬퍼(lib)로 추출해 dashboard 미수납 블록·unpaid.ts·billThisMonth에 동일 적용.

### 3. [🔴 높음] 락인(expectedAmount 우선) 규칙이 당월 청구에는 수납 페이지·수납현황 위젯에서 빠져 있음 — 월세 변경 직후 화면마다 미납 여부가 다름
- **위치**: `app/(app)/rooms/actions.ts:136`
- **내용**: 최근 변경 ①(과거월 락인 우선)이 세 곳에 비대칭 적용된다. rooms/actions.ts의 viewMonth 청구 `expected`(136~138행)와 `viewBilled`(353행)는 일할→현재 할인가 순으로만 계산하고 락인을 보지 않는다(락인은 과거월 합산 billedBeforeSum 327행과 firstUnpaidMonth 402행에만 적용). dashboard/page.tsx의 billThisMonth(649~652행, paidCount·totalExpected에 사용)도 락인 미적용. 반면 dashboard 미수납 블록(948~953행)과 unpaid.ts(289~294행)는 당월 포함 모든 월에 락인을 적용한다.
- **유저 임팩트**: 이달 납부(락인 45만) 후 월세를 50만으로 인상하면: 수납 페이지는 청구 50만·수납 45만으로 '미납 5만', 수납현황 위젯도 미완료로 집계하는데, 미수납 위젯과 푸시 알림은 락인 45만 기준이라 '미납 0건'. 같은 대시보드 화면에서 '완료 N-1건'과 '미수납 0건'이 동시에 보여 합계가 안 맞는다. 과거월을 수납 페이지에서 조회할 때도 당월 칼럼은 현재 월세로 표시돼 락인된 이월액과 모순되는 유령 미납/선납이 보인다.
- **개선 방향**: rooms의 viewBilled와 dashboard의 billThisMonth에도 동일한 billForMonth(일할→락인→할인 fallback)를 사용해 우선순위를 통일.

### 4. [🟡 중간] 수납 페이지 과거월 청구 루프에 퇴실월 초과 제외 규칙이 없음 — 퇴실 후 미처리 계약이 수납 페이지에서만 미납 누적
- **위치**: `app/(app)/rooms/actions.ts:326`
- **내용**: rooms/actions.ts의 과거월 청구 루프(324~329행)와 firstUnpaidMonth 루프(393~407행)에는 dashboard/page.tsx:943, unpaid.ts:284, report/actions.ts:216에 있는 '퇴실월 초과 청구 제외'(expectedMoveOut 컷) 규칙이 없다. checkoutNoBilling(345~350행)은 CHECKOUT_PENDING 상태에서 viewMonth 청구만 0으로 만들 뿐 과거월에는 적용되지 않으므로, ACTIVE+expectedMoveOut 계약(updateTenant 폼 수정·applyStatusTransition으로 가능)은 물론 CHECKOUT_PENDING 상태로 방치된 계약도 퇴실월 이후 월이 수납 페이지에서만 풀 청구되어 이월 미수로 누적된다 — 대시보드 미수납 위젯·알림은 퇴실월까지만 청구해 미납 0으로 표시.
- **유저 임팩트**: 5/20 퇴실예정 입력 후 퇴실 처리를 안 한 채 7월이 되면: 수납 페이지는 6월분 풀 청구가 이월 미수로 떠서 '미납' 뱃지가 붙는데, 대시보드 미수납 위젯·푸시는 5월까지만 청구해 미납 0. 이미 나간 사람의 미납 금액이 수납 페이지에서만 매달 늘어나 사용자가 데이터가 꼬였다고 느낀다.
- **개선 방향**: rooms의 billedBeforeSum·firstUnpaidMonth 루프에도 `mon > moveOutMonth` 스킵을 추가하고, checkoutNoBilling의 상태 조건(CHECKOUT_PENDING 한정)을 dashboard의 billableInTargetMonth와 맞출 것.

### 5. [🟡 중간] 예상매출(totalExpected)·완료건수(paidCount)가 양도인 정산(isPrevOwner record) 월을 제외하지 않아 수납현황 위젯 합계가 어긋남
- **위치**: `app/(app)/dashboard/page.tsx:661`
- **내용**: 인수 다음달(또는 menuMode='show'로 임의 월) 임대료를 양도인 정산(isPrevOwner record) 처리하면: 수납 페이지(rooms/actions.ts:352·371)는 그 달을 청구 제외해 '완납' 표시하고 대시보드 미수납 위젯(page.tsx:942, unpaid.ts:283)도 0원으로 잡지만, 수납현황의 paidCount(page.tsx:653)는 isPrevOwner:false 필터(362-365행) 때문에 그 입주자를 완료로 못 잡고, totalExpected(661-664행)는 dueDay 기반 prevOwnerLeaseIds만 제외할 뿐 record 기반 prevOwnerMonthsByLease를 제외하지 않아 들어올 일 없는 월세가 예상매출·수납예정 금액(pendingRevenue)에 영구 포함된다. 결과: 그 입주자가 도넛의 완료·미납·예정 어디에도 안 잡혀 건수 합계(DashboardClient.tsx:828)가 청구 대상 입주자 수와 안 맞고, 수납예정 금액에는 잡히는데 pendingCount 건수에는 없어 금액-건수가 불일치하며, 수납 페이지('완납')와 대시보드(완료 미포함)가 서로 다르게 표시된다. 다만 '예상매출 = 수납완료 + 수납예정' 항등식 자체는 pendingRevenue가 차감식으로 유도되므로 산술적으로는 항상 성립한다.
- **유저 임팩트**: 인수 다음달 임대료를 양도인 정산 처리하면: 수납 페이지는 그 달 완납, 미수납 위젯도 0건인데, 수납현황 도넛에서는 그 입주자가 '완료'에도 '미납'에도 '예정'에도 안 잡혀 건수 합계가 전체 입주자 수와 안 맞고, 예상매출에는 그 월세가 그대로 포함돼 수납완료+수납예정 합산과 어긋난다.
- **개선 방향**: billableLeases 필터와 paidCount 판정에 prevOwnerMonthsByLease[lease].has(targetMonth) 제외 조건을 추가.

### 6. [🟡 중간] 입주일·인수일이 모두 없는 계약은 수납 페이지가 2000년 1월부터 청구를 시작 — 대시보드(1개월 폴백)와 시작월 규칙 불일치
- **위치**: `app/(app)/rooms/actions.ts:152`
- **내용**: 설명은 정확함. 금액 규모만 보정: 2000-01부터 현재(2026-06)까지 약 316개월치이므로, 월세 50만원 기준 약 1.6억 원(월세에 따라 1억~수억 원대)의 이월 미수가 수납 페이지에 표시되고, 대시보드는 같은 계약을 최대 1개월치 미납으로 표시한다.
- **유저 임팩트**: 인수일을 설정하지 않은 신규 사용자(직접 개업한 운영자 등)가 입주일을 비워둔 채 입주자를 등록하면, 수납 페이지에 수억 원대 이월 미수와 '미납' 뱃지가 표시되는 반면 대시보드 미수납은 한 달치만 표시. 같은 사람의 미납이 화면에 따라 수백 배 차이 나 데이터 전체를 불신하게 된다.
- **개선 방향**: rooms도 acquisitionDate 부재 시 moveInDate(없으면 targetMonth)로 폴백하도록 loopStart 규칙을 dashboard·unpaid.ts와 통일.

## 퇴실 일할 정산

### 7. [🔴 높음] 고객관리 편집 폼(updateTenant)으로 퇴실일을 바꾸면 적용된 일할 정산이 옛 날짜 기준으로 그대로 남음
- **위치**: `app/(app)/tenants/actions.ts:411`
- **내용**: applyStatusTransition(tenants/actions.ts 825~830행)은 expectedMoveOut 변경 시 checkoutProratedAmount/Month/Undo를 정리하지만, 같은 필드를 수정하는 updateTenant의 leaseTerm.update(402~430행, 411행에서 expectedMoveOut 갱신)에는 정리 로직이 없다. 고객관리 편집 폼(TenantClient.tsx 2863행 '퇴실일' 필드)은 updateTenant으로 저장되므로, 일할 정산 적용 후 이 폼에서 퇴실일만 바꾸면 옛 퇴실일 기준 checkoutProratedMonth/Amount가 잔존한다. 청구 엔진(rooms/actions.ts 136~138행, dashboard/unpaid.ts 291행, dashboard/page.tsx 649~651행)은 이 잔존 값으로 해당 월 청구를 무조건 덮어쓴다. 예: 6/26 퇴실로 19일치 정산 적용 후 퇴실일을 7/15로 고치면 6월 청구는 여전히 19일치 감액(틀린 금액), 7월은 풀 청구로 잡혀 수납·대시보드·미수금 화면 숫자가 모두 틀린다. 위젯(CheckoutProrationWidget.tsx 100~101행)에는 새 퇴실일(07/15)과 옛 정산 요약('6월 청구 ...로 일할 적용됨')이 나란히 표시돼 서로 모순된 정보가 보인다.
- **유저 임팩트**: 6/26 퇴실로 19일치 정산을 적용한 뒤 입주자가 '7/15로 미룰게요'라고 해서 고객관리 편집 폼에서 퇴실일만 7/15로 고치면, 6월 청구는 여전히 19일치 감액(잘못된 금액)이고 7월은 풀 청구로 잡힌다. 수납·대시보드·미수금 화면 전부 틀린 숫자가 표시되고, 위젯 요약에는 '6월 청구 ...로 일할 적용됨 · 퇴실 06/26'처럼 실제 퇴실일과 다른 날짜가 계속 보인다.
- **개선 방향**: updateTenant에서 expectedMoveOut(또는 dueDay·rentAmount·status)이 기존 값과 달라지면 applyStatusTransition과 동일하게 checkoutProratedAmount/Month/Undo를 정리하고 토스트로 알리기

### 8. [🔴 높음] CHECKOUT_PENDING→ACTIVE 복귀 경로 3개의 결과가 제각각 — 편집 폼 경로는 정산 감액이 거주중 상태에 잔존
- **위치**: `app/(app)/tenants/actions.ts:405`
- **내용**: 거주중 복귀 경로가 ① 위젯 '적용취소'(clearCheckoutProration: 스냅샷 복원), ② 전환 버튼 '퇴실예정 취소'(applyStatusTransition 819~824행: 정산+퇴실일+undo 모두 정리), ③ 고객관리 편집 폼에서 상태를 '거주중'으로 변경(updateTenant) 3가지인데, ③은 expectedMoveOut만 null이 되고(폼에서 showExitDate=false라 필드 미전송, TenantClient.tsx 2516행) checkoutProratedAmount/Month/Undo는 그대로 남는다. PaymentBody 196행은 ACTIVE 상태에서도 위젯을 렌더링하므로 '...로 일할 적용됨' 표시가 유지되고 청구도 감액된 채 유지된다.
- **유저 임팩트**: 퇴실을 번복한 입주자를 편집 폼에서 '거주중'으로 되돌리면, 겉보기엔 정상 거주중인데 그 달 월세가 일할 감액(예: 50만원→31만원)으로 계속 청구된다. 같은 동작을 '퇴실예정 취소' 버튼으로 하면 풀 청구로 복귀 — 어느 경로를 썼느냐에 따라 같은 입주자의 청구액이 달라져 임대인이 월세를 덜 받게 된다.
- **개선 방향**: updateTenant에서 상태가 ACTIVE로 바뀌는 경우 applyStatusTransition의 ACTIVE 복귀 정리 로직(정산 3필드 초기화)을 동일 적용해 경로별 결과를 통일

### 9. [🟡 중간] 납입일 영구 변경(changeDueDay)이 적용된 퇴실 정산을 재계산하지 않아 일할이 이중으로 꼬임
- **위치**: `app/(app)/tenants/actions.ts:1307`
- **내용**: changeDueDay(1291~1346행)는 dueDay를 바꾸고 자체 일할 조정 record(과입금/추가납부)까지 만들지만, 같은 lease에 걸린 checkoutProratedAmount/Month는 건드리지 않는다. 퇴실 정산액은 적용 시점의 dueDay 기준(calcCheckoutProration의 startDay)으로 고정 저장되므로, 이후 납입일을 바꾸면 '시작일'이 달라졌는데 정산액은 옛 시작일 기준 그대로다. 두 위젯(DueDayPermanentChangeWidget·CheckoutProrationWidget)은 같은 수납 모달(PaymentBody 187·197행)에 나란히 있어 연속 사용이 자연스럽다.
- **유저 임팩트**: 납부일 8일·퇴실 6/26으로 19일치 정산을 적용한 뒤 같은 모달에서 납부일을 20일로 영구 변경하면, 납입일 변경용 일할 조정 record가 추가로 생기는데 6월 청구는 여전히 '8일 기준 19일치'로 덮여 있어 감액이 중복/과소 적용된다. 위젯 안내문(136행 '납부일 X일부터…')과 실제 저장된 정산 기준이 달라 사용자가 금액을 검증할 수 없다.
- **개선 방향**: changeDueDay에서 checkoutProratedAmount가 있으면 새 dueDay로 재계산하거나 정산을 해제하고 재정산을 안내

### 10. [🟡 중간] '적용취소'가 적용 이후의 수동 수정(퇴실일 등)을 무시하고 최초 적용 직전 스냅샷으로 되돌림
- **위치**: `app/(app)/tenants/actions.ts:1469`
- **내용**: 핵심은 updateTenant(편집 폼 저장)이 applyStatusTransition(819~830행)과 달리 퇴실일·상태 변경 시 checkoutProratedAmount/Month/checkoutProrationUndo를 무효화하지 않는 비대칭이다. 그 결과 (a) 정산 적용 후 폼에서 입력한 퇴실일이 '적용취소' 시 적용 시점 스냅샷으로 덮여 증발하고, (b) 폼에서 퇴실일만 바꿔도 옛 날짜 기준 stale 일할액이 청구에 그대로 남는다. 한편 '최초 적용 직전으로 점프'하는 재정산 동작 자체는 코드 주석(1413~1414행)상 의도된 설계이며 confirm 문구도 단일 적용 케이스에선 정확함 — 문구 불일치는 재정산·수동편집이 끼어든 경우에 한정된 부차적 문제.
- **유저 임팩트**: 정산 적용(당시 거주중·퇴실일 없음) → 편집 폼에서 퇴실일 7/15 입력 → 나중에 위젯 '적용취소'를 누르면 상태가 거주중으로, 퇴실일이 null로 돌아가 사용자가 직접 입력한 7/15가 증발한다. '다시 정산'을 거친 경우에도 '직전 정산'이 아니라 몇 단계 전 상태로 한 번에 점프해 사용자가 예상 못 한 데이터 손실을 겪는다.
- **개선 방향**: 복원 전 현재 값과 스냅샷의 차이를 비교해 중간 수정이 감지되면 경고하거나, undo 스냅샷을 lease 수정 시 무효화

### 11. [🟡 중간] 전환 버튼 '퇴실일 변경' 시 적용된 정산을 무통보 삭제 — 팝업 조건 밖이면 완전히 침묵
- **위치**: `app/(app)/tenants/actions.ts:826`
- **내용**: applyStatusTransition은 expectedMoveOut이 전달되면 정산 3필드를 무조건 정리한다(826~830행). 토스트는 '퇴실일 변경 완료'만 출력(TenantStatusTransitions.tsx 128행)하고, '퇴실 정산?' 팝업은 shouldOfferCheckoutProration이 true일 때만 다시 뜬다(134~137행). 새 퇴실일이 '오늘+1달'보다 멀거나 daysUsed≥30이면 팝업 자체가 없어, 기존에 확정해 둔 일할 감액과 undo 스냅샷이 아무 안내 없이 삭제된다.
- **유저 임팩트**: 6월 19일치 정산을 확정해 둔 임대인이 '퇴실일 변경' 버튼으로 날짜를 두 달 뒤로 미루면, 화면상 아무 경고 없이 기존 정산이 사라지고 풀 청구로 복귀한다. 나중에 수납 화면에서 '왜 감액이 풀렸지?' 하고 혼란을 겪으며, undo도 파기돼 되돌릴 수단이 없다(사용자의 '모든 기능에 적용취소' 원칙과도 충돌).
- **개선 방향**: 정산이 적용된 상태에서 퇴실일 변경 시 '기존 일할 정산이 해제됩니다' 확인/토스트를 띄우고 재정산 진입을 항상 제안

### 12. [🟡 중간] 퇴실일이 그 달 납부일보다 앞서는 교차월 퇴실은 정산 진입 자체가 불가 — 오류 문구도 오해 유발, 팝업도 안 뜸
- **위치**: `lib/prorate.ts:66`
- **내용**: 원 설명이 정확하다. 한 가지 보충: 교차월 케이스에서 퇴실 달(7월) 청구 자체는 rooms/actions.ts:345 checkoutNoBilling으로 0 처리되어 맞게 동작하지만(단, CHECKOUT_PENDING 상태일 때만), 직전 달(6월) 풀청구분의 미사용 14일 환불을 처리할 경로가 시스템 어디에도 없고, 위젯·팝업·오류 문구 모두 '정산할 것이 없다'는 잘못된 안내를 한다.
- **유저 임팩트**: 납부일 25일인 입주자가 7/10 퇴실하면 임대인은 일할 환불 정산을 하려 해도 위젯이 '일할 청구가 없습니다'라며 거부한다. 실제로는 마지막 달 14일분 환불 정산이 필요한 상황인데 시스템은 '정산할 게 없다'고 답해, 사용자가 기능 오류로 오인하거나 수기로 음수 수납을 만들어 데이터가 꼬이게 된다.
- **개선 방향**: 퇴실일이 dueDay 이전이면 직전 기간(전월 dueDay 시작)의 청구월을 moveOutMonth로 잡아 교차월 일할을 지원하거나, 최소한 오류 문구에 '전월 청구분 환불은 수동 처리' 안내 추가

## 지출·배송비/합배송

### 13. [🔴 높음] 품목 2개 이상 + '배송비 포함(합산)' 조합은 등록·수정이 항상 실패
- **위치**: `app/(app)/finance/actions.ts:361`
- **내용**: 등록/수정 폼은 hidden amount를 '품목합계 + 배송비'로 제출하지만(FinanceClient.tsx:3306-3311 등록, 2937-2942 수정), itemsJson에는 배송비가 없는 품목 금액만 담긴다(3407, 3055). 서버는 품목이 2개 이상이거나 방별 분배가 있으면 multiItems 경로로 들어가 `Math.abs(sum - amount) > 1`이면 거부한다(addExpense 359-361, updateExpense 501-502). 두 값이 정확히 배송비만큼 어긋나므로 이 조합은 구조적으로 저장이 불가능하다. UI는 조합을 막지 않고 오히려 '(품목 X + 배송 Y)' 합계 미리보기까지 보여준다.
- **유저 임팩트**: 쿠팡에서 품목 2개를 사고 배송비 3,000원을 '배송비 포함'으로 체크해 저장하면 무조건 "품목 금액 합계(50,000원)와 총 금액(53,000원)이 일치하지 않습니다" 오류가 뜬다. 유저는 차액이 자신이 입력한 배송비라는 걸 알아채기 어렵고, 금액을 이리저리 고치다 결국 배송비 체크를 풀거나 품목을 지워야만 저장된다.
- **개선 방향**: multiItems 검증 시 배송비(합산분)를 서버에 별도 필드로 전달해 sum+shipping과 amount를 비교하거나, 클라이언트에서 품목 2개 이상일 때 '배송비 포함' 체크를 막고 합배송으로 유도

### 14. [🔴 높음] 배송비 라인 자체를 수정하면 '지출을 찾을 수 없습니다' 오류 + 반쪽 저장 상태
- **위치**: `app/(app)/finance/FinanceClient.tsx:1674`
- **내용**: 수정 진입 프리필은 `detailExp.order`만 보고 '별도 지출로 묶기'를 켠다(2904-2910). 배송비(isShipping) 라인도 order를 갖고 있고 [수정] 버튼(2883)에 isShipping 가드가 없어 같은 프리필을 탄다. 저장 시 updateExpense가 먼저 커밋된 뒤 attachShippingToOrder({expenseIds: [배송비라인 id]})가 호출되는데(1674-1676), 서버는 `isShipping: false` 필터로 조회해(actions.ts:613) 빈 결과 → '지출을 찾을 수 없습니다' 오류를 반환한다. 모달은 닫히지 않고 router.refresh()도 안 불려 화면은 구버전인데 DB는 이미 바뀐 반쪽 저장이 된다. 추가로 updateExpense는 settleStatus를 payMethod 기준으로 재계산하므로(570) '신용(후불)·미정산'이던 배송비 라인이 계좌이체면 조용히 '정산완료'로 뒤집힌다.
- **유저 임팩트**: 합배송 배송비 금액을 3,000→3,500원으로 고치고 저장하면 매번 오류 토스트가 떠서 실패한 줄 알고 재시도를 반복하는데, 실제로는 금액이 이미 바뀌어 있다. 모달을 닫고 보면 수정돼 있어 '오류인데 왜 바뀌었지?' 혼란이 생기고, 미정산이던 후불 배송비가 정산완료로 둔갑해 카드 정산 목록에서 사라질 수 있다.
- **개선 방향**: isShipping 라인은 수정 진입 시 배송비 묶기 섹션을 숨기고 attachShippingToOrder 호출을 건너뛰며, 배송비 라인 전용 간이 수정(금액·결제구분)을 제공

### 15. [🔴 높음] '배송비 포함'으로 등록한 지출, 수정 폼에서 배송비 복원 안 됨 — 이중 합산·표기 소실·단가 왜곡
- **위치**: `app/(app)/finance/FinanceClient.tsx:2902`
- **내용**: 합산형 배송비는 amount(배송비 포함 총액)와 detail 텍스트('· 배송비 X원')에만 녹아 있고 구조화 저장이 없다(actions.ts 437-448). 수정 진입 시 editHasShipping=false, editShipping=undefined로 초기화되고(FinanceClient.tsx 2902), 단일 품목 건은 editItems[0].amount와 unitPrice가 배송비 포함 총액 기준으로 복원된다(2892-2901). (a) 배송비를 다시 체크해 입력하면 total = (배송비가 이미 포함된 base) + ship으로 이중 합산된다(2937-2942) — 품목 없이 detail 텍스트로 등록한 건은 추가로 '배송비 3,000원 · 배송비 3,500원'식 중복 표기도 발생(3053). 품목이 있는 건은 detail이 재생성되므로 중복 표기는 없고 금액만 이중 합산된다. (b) 품목이 있는 건은 아무것도 안 고치고 저장만 해도 detail이 fmtItemListDetail로 재생성되며 배송비 표기가 사라지고 배송비가 품목 금액에 흡수된다(3053). 재고 페이지는 행의 amount/수량으로 단가를 계산하므로(inventory/overview.ts 270-277) 단일 품목 + 합산 배송비 건은 등록 직후부터 단가가 배송비만큼 부풀며, 등록 폼 안내문 '단가에 포함되지 않고 총액에만 더해집니다(합배송이어도 단가 정확)'(3356)와 모순된다.
- **유저 임팩트**: 배송비 3,000원 포함 53,000원으로 등록한 지출의 메모만 고치려고 수정을 열었다가, 배송비 체크가 풀려 있어 다시 3,000원을 입력하고 저장하면 총액이 56,000원이 된다. 반대로 그냥 저장하면 세부항목의 '배송비 3,000원' 기록이 사라져 나중에 품목 원가가 얼마였는지 알 수 없고, 재고 화면의 휴지 단가가 배송비만큼 부풀어 화면마다 단가가 다르게 보인다.
- **개선 방향**: 합산 배송비를 별도 컬럼(예: shippingIncluded)으로 저장해 수정 폼에서 분리 프리필하거나, 최소한 detail에 배송비 표기가 있으면 파싱해 editShipping을 복원

### 16. [🟡 중간] 합배송 묶음 해제 불가 — 수정 폼 체크 해제가 조용한 무동작(no-op)
- **위치**: `app/(app)/finance/FinanceClient.tsx:2997`
- **내용**: 원 설명 거의 정확. 미세 보정 한 가지: 배송비 라인만 개별 삭제하면 배송비 줄 자체는 없앨 수 있으나, 품목 지출들의 orderId와 '주문' 칩은 여전히 남으므로(updateExpense·deleteExpense 모두 orderId를 정리하지 않음) 완전 해제는 주문에 묶인 지출 전부를 삭제 후 재입력하는 방법뿐이다.
- **유저 임팩트**: 엉뚱한 지출 두 건을 실수로 합배송으로 묶은 유저가 수정 폼에서 체크를 해제하고 저장하면 '지출 수정됨' 토스트가 떠서 풀린 줄 알지만, 목록에는 여전히 '주문 · ○○ 외 1건' 칩과 배송비 라인이 남아 있다. 풀 방법이 없어 지출을 통째로 지웠다 다시 입력하는 수밖에 없다.
- **개선 방향**: 체크 해제 + 저장 시 orderId 해제·배송비 라인 처리(삭제 또는 단독 지출 전환)를 수행하는 detachShippingFromOrder 액션 추가

### 17. [🟡 중간] 주문 품목/배송비 라인 삭제 시 고아 발생 — 합계 과대·표기 잔존
- **위치**: `app/(app)/finance/actions.ts:590`
- **내용**: deleteExpense는 해당 행만 삭제하고(588-592) 주문 관련 정리가 전혀 없다. (a) 주문의 품목을 전부 지우면 배송비 라인이 혼자 남는데, orderSummaries는 비배송 행이 없으면 배송비 행 자신을 대표로 잡아(FinanceClient.tsx:1614-1618) 칩이 '배송비 · 착불 · 배송비 (착불)'처럼 자기참조 표기가 되고, ExpenseOrder 레코드도 영구히 남는다. (b) 배송비 라인만 지우면 주문의 shippingType이 남아 품목 상세에 '· 배송 선불'(2851)이 계속 표시되며, 이후 그 품목을 수정하면 '별도 지출로 묶기'가 금액 없이 체크된 채 열린다(2905-2907에서 shipRow가 undefined).
- **유저 임팩트**: 반품해서 품목 지출을 지웠는데 배송비 3,000원 라인이 남아 그 달 지출 합계가 부풀고, 남은 배송비 행의 칩 문구가 이상해 뭘 가리키는지 알 수 없다. 반대로 배송비만 지운 경우 품목 상세에 '배송 선불'이 계속 떠서 배송비가 어딘가에 기록돼 있다고 오해하게 된다.
- **개선 방향**: deleteExpense에서 주문 잔여 구성 확인 — 비배송 품목이 0이 되면 배송비 라인·ExpenseOrder도 함께 정리(확인 팝업), 배송비 라인 삭제 시 주문 shippingType 초기화

### 18. [🟢 낮음] 등록 폼과 수정 폼의 배송비 용어·구조·기본값 불일치 (기본 결제구분 선불 vs 착불)
- **위치**: `app/(app)/finance/FinanceClient.tsx:3351`
- **내용**: 등록 폼은 공통 헤더 없이 인접 배치된 두 독립 토글 '배송비 포함 (이 지출 총액에 합산)'(3351)과 '합배송 (배송비 별도)'(3366)이고, 수정 폼은 하나의 '배송비' 섹션(2982) 안에 '이 지출 금액에 합산'(2988) / '별도 지출로 묶기 (합배송)'(3000)으로 같은 기능을 다른 주 명칭·다른 구조로 제공한다(수정 폼엔 '(합배송)'이 괄호로만 병기). 결제구분 기본값도 등록은 '선불'(addOrderShipType, 1284), 수정은 '착불'(attachShipType 초기값 1259, 주문 있을 때 프리필 폴백 2908, 주문 없을 때는 리셋 없이 초기값 유지)로 서로 다르다. Work_log.md 39행에서 '등록 폼은 기존 2-토글 유지 — 차후 동일 3-way 통일 여지'라고 미통일 상태를 자인하고 있다.
- **유저 임팩트**: 등록에서 '합배송'이라 배운 기능을 수정 화면에선 '별도 지출로 묶기'라는 이름으로 다시 찾아야 하고, 두 화면에서 같은 행동의 기본 결제구분이 선불/착불로 달라 수정에서 배송비를 다시 묶을 때 결제구분이 의도와 다르게 저장될 수 있다(착불로 잘못 기록되면 '신용' 미정산 추적 누락).
- **개선 방향**: 두 폼을 동일한 3-way(없음/합산/별도 묶기) 단일 섹션과 동일 라벨·동일 기본값으로 통일

## 재고 점검·단위·병합

### 19. [🔴 높음] 품목별 점검(CheckForm)에서 잔량 0 입력이 저장 시 이전 잔량으로 조용히 되살아남
- **위치**: `app/(app)/inventory/InventoryClient.tsx:2367`
- **내용**: CheckForm의 handleSubmit은 `buildLocationData().filter(lq => lq.qty > 0 || lq.restockedQty != null)` 로 qty=0이고 보충 없는 위치를 전송 데이터에서 제외한 뒤 `carryOverFromLastCheck: true` 로 createStockCheck를 호출한다(2367·2377행). 서버(actions.ts 663-677행)는 입력에 없는 위치를 직전 점검의 잔량으로 자동 보존하므로, 사용자가 '보충 후'에 0을 입력한 위치(다 써서 비운 위치)는 필터에서 빠지고 직전 점검값이 그대로 복원된다. 허브도 마찬가지 — 보충으로 허브가 0이 되면(hubAutoAfter=0) 허브 행이 제외되고 carryOver가 차감 전 허브 잔량을 되살려 총량이 부풀어진다. 반면 위치별 점검(LocationBatchCheckModal)은 locationPatch.afterQty=0을 applyLocationCheck가 명시적으로 저장하므로 0이 정상 기록된다 — 같은 입력(0)이 폼에 따라 정반대 결과.
- **유저 임팩트**: 주방세제를 다 써서 '5층 화장실 0'으로 점검 저장했는데 점검 기록·현재고에 이전 수량이 그대로 남아 있음. 특히 허브 재고를 전부 풀어 보충한 날은 허브 잔량이 차감 전 값으로 복원돼 총 재고가 실제보다 크게 표시되고, 사용량·소진 예상일 계산이 전부 어긋난다. 사용자는 '0을 입력했는데 왜 숫자가 살아있지?'라는 혼란을 겪는다.
- **개선 방향**: 필터 조건을 '사용자가 실제 입력(터치)한 위치는 qty=0이어도 포함'으로 바꾸거나, restockMode에서는 필터 없이 전체 위치를 전송하고 carryOver를 끄기.

### 20. [🔴 높음] 단위 변환(changeTrackedItemUnit) 후 specUnit 없는 과거 영수증이 환산 없이 원값으로 합산 — UI 안내와 모순
- **위치**: `app/(app)/inventory/actions.ts:333`
- **내용**: changeTrackedItemUnit(app/(app)/inventory/actions.ts 333-369행)은 점검·입수 기록만 배율 환산하고 영수증(Expense)은 '계산 시점 자동 환산'을 전제로 건드리지 않는다(332행 주석). 그러나 자동 환산(lib/units.ts convertSpecValue 105-113행)은 영수증 specUnit이 null이거나 변환 불가 단위면 원값을 그대로 반환하는 폴백이다. 품목 단위를 L→ml로 바꾸면 specUnit이 기록 안 된 과거 영수증의 specValue=1.5(원래 1.5L 의미)는 overview.ts sumPurchases(43-48행, 182·197·215·305행에서 호출)와 inventory/actions.ts의 getMonthlyInflow(66-68행)·getStockAsOf(1907-1911행)에서 1.5ml로 합산돼 1000배 축소된다. 그런데 UI(InventoryClient.tsx 1025행)는 '영수증은 그대로 두어도 자동 환산됩니다'라고 안내하고, 서버는 specUnit 없는 영수증 존재 여부를 검사·경고하지 않는다. specValue만 있고 specUnit이 null인 영수증은 수동 입력(finance/actions.ts 443-445행, 단위 독립 저장)과 OCR 추출(237-238행, 단위 '선택') 양쪽에서 실제로 생성될 수 있다.
- **유저 임팩트**: 단위를 L→ml로 바꾼 직후부터 현재고·월별 입수량·단가(원/ml)가 화면마다 어긋남. 점검 잔량은 1000배로 커졌는데 specUnit 없는 영수증 입고분은 그대로라 currentStock이 비정상적으로 작아지거나, 점검 사이 소모량이 음수/거대값으로 튄다. 사용자는 UI 안내('자동 환산')를 믿었기 때문에 원인을 찾기 어렵다.
- **개선 방향**: 변환 전 specUnit null인 매칭 영수증 수를 세서 경고(또는 품목 기존 단위로 specUnit 백필)하고, UI 문구에서 환산 조건(영수증에 단위가 기록된 경우)을 명시.

### 21. [🔴 높음] 같은 날 '전체 보정' 후 일반 점검·수령 자동점검이 생기면 dedupSameDay가 보정을 통째로 무효화
- **위치**: `app/(app)/inventory/overview.ts:104`
- **내용**: 원 설명은 정확함. 한 가지 디테일 보완: dedupSameDay의 '같은 날' 판정은 UTC 일자(getUTC*) 기준이므로 KST 오전 9시 이전에 생성된 자동 점검은 보정(date=UTC 자정)과 다른 날로 분류되어 충돌을 피할 수 있음. 그러나 KST 09:00 이후 낮 시간대의 수령 확인·일반 점검은 발견 시나리오 그대로 보정 레코드를 dedup에서 밀어내며, 분실·오차분이 소모량으로 재산입되어 평균 소모율(189행 스킵 무력화)·월별 사용량(302행 continue 무력화)·소진 예상일이 모두 왜곡됨.
- **유저 임팩트**: 분실분 50개를 '전체 보정으로 기록'해 사용량에서 제외했는데, 같은 날 택배 수령 확인을 누르는 순간(자동 점검 생성) 그 50개가 그 달 사용량에 도로 합산되고 평균 소모율·소진 예상일·재고부족 알림이 왜곡된다. 사용자가 명시적으로 체크한 옵션이 보이지 않는 내부 규칙(같은 날 dedup)에 의해 취소되는 셈.
- **개선 방향**: dedupSameDay에서 isReconcile 점검은 별도 보존하거나, 같은 날 보정+일반 점검이 공존하면 보정 플래그를 승계하도록 수정.

### 22. [🟡 중간] 위치별 점검 6h 자동 머지가 사용자가 고른 점검일(과거 날짜)을 무시하고 오늘 점검에 합침
- **위치**: `app/(app)/inventory/InventoryClient.tsx:2661`
- **내용**: 원 설명은 정확하다. 한 가지 보탤 뉘앙스: 자동 머지는 '그 품목의 마지막 점검이 오늘 생성됐고 6시간 이내'일 때만 발동하므로, 오늘 점검이 없는 품목의 백필은 정상적으로 새 레코드(선택일 반영)가 생긴다. 또 6h 초과·같은 날엔 확인 팝업이 뜨지만, 팝업 문구가 선택한 과거 점검일이 버려진다는 사실을 알리지 않아 '기존에 합치기' 선택 시 동일하게 날짜가 유실된다.
- **유저 임팩트**: Work_log에도 안내된 '과거 날짜로 보정 점검(backdate)' 워크플로를 위치별 점검에서 쓰면, 입력이 어제가 아니라 오늘 점검에 흡수돼 타임라인에 어제 기록이 안 보인다. 오전 9시 점검 후 오후 2시에 다시 점검한 운영자는 오전 실측값이 사라진 것을 발견하고 당황한다.
- **개선 방향**: 폼의 date가 오늘이 아니면 머지를 건너뛰고 새 레코드 생성, 6h 이내 머지도 최소한 토스트로 '오늘 점검에 합쳐짐'을 알리고 되돌리기 제공.

### 23. [🟡 중간] CheckEditForm은 빈 '보충 전'을 0으로 계산해 허브를 전액 차감 — 생성 폼과 입력 규칙 정반대
- **위치**: `app/(app)/inventory/InventoryClient.tsx:1846`
- **내용**: 원 설명은 정확함. 한 가지 보완: 수정 폼 하단 합계(1978행)와 허브 행(1930-1931행)에는 차감이 표시되긴 하지만, 행별 '창고 → +N' 배지(1940-1942행)는 null 처리 로직이라 빈 before 행에 표시되지 않아 같은 화면 안에서도 신호가 모순됨 — 사용자가 의도치 않은 허브 차감을 알아채기 어려움.
- **유저 임팩트**: 사용자가 과거 점검을 열어 '빠뜨렸던 5층 화장실 10개'를 보충 후 칸에만 적고 저장하면, 생성 폼에서의 학습('후만 적으면 단순 잔량')과 달리 창고(허브)에서 10개가 추가 차감된다. 같은 입력 방식이 화면(생성 vs 수정)에 따라 다르게 동작해 허브 잔량이 점점 어긋나는 드리프트가 생긴다.
- **개선 방향**: 수정 폼도 빈칸을 null로 처리해 '전·후 모두 입력된 경우에만 보충'으로 세 폼의 규칙을 통일.

### 24. [🟡 중간] 병합 해제(undo) 확인창에 위치 연결·허브 설정 유실 경고 없음
- **위치**: `app/(app)/inventory/InventoryClient.tsx:2986`
- **내용**: 병합 시 source 카드 삭제로 TrackedItemLocation(보관 위치 연결)이 cascade 삭제되는데, mergeTrackedItems의 undo payload(actions.ts 519-537행)는 label·specUnit·hubLocationId 등 카드 속성만 스냅샷하고 위치 연결 목록은 저장하지 않는다. unmergeTrackedItem(1500-1523행)이 카드를 재생성해도 위치 연결은 복원되지 않으며, hubLocationId만 복원돼 '연결 안 된 위치를 허브로 가리키는' 어정쩡한 상태가 된다(setItemHub는 연결된 위치만 허용, 1938-1942행). Work_log.md 103행에 'CARD 병합 복원 시 TrackedItemLocation 유실 → 위치만 재설정 필요'라고 알려진 한계로 기록돼 있으나, UI의 confirm 메시지(2986행)는 '지출·점검이 분리됩니다 / 카드가 다시 생깁니다'만 말하고 위치 유실은 언급하지 않는다.
- **유저 임팩트**: 병합을 되돌린 사용자는 카드가 복구된 것을 보고 안심하지만, 위치별 점검 화면에서 그 품목이 어떤 위치 목록에도 안 떠서 점검을 못 하고, 위치 연결을 다시 해야 한다는 사실을 스스로 알아내야 한다. '모든 기능에 undo'라는 제품 원칙 대비 undo가 불완전한데 그 사실이 숨겨져 있다.
- **개선 방향**: undo payload에 위치 연결 id 목록을 함께 저장해 복원하거나, 최소한 confirm 문구에 '보관 위치 연결은 복원되지 않아 재설정 필요'를 명시.

## 뱃지·용어·색상 일관성

### 25. [🔴 높음] RESERVED(예약) 상태 라벨이 화면마다 다름 — '예약' vs '입실 예정' vs '입실 희망'
- **위치**: `app/(app)/room-manage/RoomManageClient.tsx:71`
- **내용**: 같은 RESERVED 상태가 화면마다 다른 이름으로 표시됨. 공용 사전(lib/statusColors.ts:11 STATUS_LABEL, :43 statusException)은 '예약'이고 수납관리(rooms/RoomsClient.tsx:651·861 '예약'/'예약 확정')와 고객관리(app/(app)/tenants/TenantClient.tsx:130·158 — 경로는 tenant가 아닌 tenants)는 이를 따르는 반면, 호실관리 카드 뱃지(room-manage/RoomManageClient.tsx:71)는 로컬 하드코딩 '입실 예정', 대시보드도 로컬 매핑(DashboardClient.tsx:86·1718)과 StatCard·입주현황(1011·1039)에서 '입실 예정', 대시보드 알림 카테고리 헤더(DashboardClient.tsx:539)는 '입실 희망'(page.tsx:1078·1095·1110·1140에서 RESERVED 리스 알림이 이 카테고리로 생성됨 확인). 호실관리 한 화면 안에서도 상단 요약은 '예약 N실'(RoomManageClient.tsx:482)인데 카드 뱃지는 '입실 예정'(71행)으로 불일치. 단, 알림 개별 텍스트에는 '입실 희망 (예약)'처럼 '예약'이 병기됨(page.tsx:1111).
- **유저 임팩트**: 예약자 1명을 보면서 호실관리에선 '입실 예정', 수납관리에선 '예약', 대시보드 알림에선 '입실 희망'으로 읽게 됨. 사용자는 '입실 예정'과 '예약'이 서로 다른 단계(예: 확정 전/후)라고 오해할 수 있고, 호실관리 화면 안에서는 요약 숫자('예약 2실')와 카드 뱃지('입실 예정')가 매칭이 안 돼 카운트가 틀렸다고 느낄 수 있음.
- **개선 방향**: lib/statusColors.ts의 STATUS_LABEL/statusException을 단일 출처로 삼고 room-manage getRoomStatus·dashboard의 DASH_STATUS_LABEL/LEASE_STATUS_LABEL/CATEGORY_META 라벨을 모두 이것으로 교체

### 26. [🔴 높음] [미납][퇴실 예정] 2뱃지(C안)+checkoutSubText가 rooms에만 적용 — 호실관리·대시보드 방현황 누락
- **위치**: `app/(app)/dashboard/DashboardClient.tsx:2201`
- **내용**: 커밋 3dcc2f2(C안)는 rooms/RoomsClient.tsx와 StatusBadge.tsx만 수정함(git show --stat로 확인). 호실관리는 CHECKOUT_PENDING에 D-day sub 없는 '퇴실 예정' 뱃지만 표시하고 미납 여부는 아예 안 봄(RoomManageClient.tsx:73). 대시보드 방현황 카드 renderCell(DashboardClient.tsx:2201-2232)은 tenantStatus를 받아오기만 하고(67행, page.tsx:845) 전혀 사용하지 않아 퇴실 예정 호실이 완납이면 그냥 '납부완료' 녹색 틴트로 표시됨 — 범례(2141-2151행)에도 납부완료/납부예정/미납/공실 4개뿐 퇴실예정 없음. 추가로 rooms 내부에서도 형식이 갈림: 완납 퇴실예정 sub는 'D-13 (6/26 퇴실)'(RoomsClient.tsx:672,880), 미납 퇴실예정의 checkoutSubText는 '6/26 퇴실 D-13'(145-151행), 대시보드 퇴실 알림은 'N일 남음'(dashboard/page.tsx:36-39,1154)으로 같은 카운트다운이 3가지 표기.
- **유저 임팩트**: 오늘 퇴실하는 미납 입주자가 수납관리에선 [미납][퇴실 예정] 2뱃지로 강조되는데, 대시보드 방현황만 보면 평범한 '납부완료/미납' 칸으로 보여 퇴실 준비를 놓침. 호실관리에서는 같은 방에 미납·D-day 정보가 전혀 없어 화면마다 위험도가 다르게 읽힘.
- **개선 방향**: checkoutSubText·2뱃지 로직을 공용 헬퍼(lib)로 추출해 room-manage 카드에 적용하고, 대시보드 방현황 셀에 퇴실예정(exit 톤) 표시·범례 추가 + D-day 문구 형식 한 가지로 통일

### 27. [🔴 높음] '보유 보증금' 합계가 대시보드와 지출/수익(finance) 화면에서 서로 다른 기준으로 계산됨
- **위치**: `app/(app)/finance/actions.ts:1428`
- **내용**: 대시보드 KPI '보유 보증금'은 ACTIVE+CHECKOUT_PENDING 계약의 계약상 depositAmount 합(dashboard/page.tsx:146-150, 'RESERVED 제외' 주석은 2026-06-05 사용자 보고로 수정된 것). 반면 finance의 보증금 탭 라벨 금액(FinanceClient.tsx:1824 totalDepositBalance, 1830행 '보증금 (N만)')은 getDepositSummaryByTenant(finance/actions.ts:1380-1442)가 CHECKED_OUT만 0 처리하고 RESERVED·NON_RESIDENT를 모두 포함하며, 입금기록이 있으면 실수납액(effectiveIn) − 환불액 기준으로 계산. 즉 (1) 예약자 보증금 포함 여부, (2) 비거주자 포함 여부, (3) 계약액 vs 실수납액 기준이 모두 달라 두 화면 합계가 일치하지 않음.
- **유저 임팩트**: 예약자가 보증금을 걸어둔 상태에서 대시보드는 '보유 보증금 500만', finance 보증금 탭은 '보증금 (550만)'처럼 다른 숫자를 보여줌. 보증금은 반환 의무가 있는 돈이라 사용자가 어느 숫자를 믿고 자금을 준비해야 할지 혼란스럽고, 장부가 틀렸다고 의심하게 됨.
- **개선 방향**: 보증금 잔고 계산을 한 모듈로 통일(상태 포함 범위 + 계약액/실수납 기준 명시)하고 대시보드 KPI와 finance 탭 라벨이 같은 함수를 쓰도록 변경

### 28. [🟡 중간] 미납·퇴실예정 상태색이 대시보드에서만 다른 팔레트(노랑·빨강 hex) 사용 — 연체 구분도 대시보드엔 없음
- **위치**: `app/(app)/dashboard/DashboardClient.tsx:538`
- **내용**: 원 설명은 정확함. 보완 사항 두 가지: (1) 용어 불일치는 '미납/누적 미수/연체' 3종이 아니라 '누적 미납'(DashboardClient.tsx:1991)까지 4종이 혼재. (2) 빨간색 경고 임계값도 불일치 — 대시보드 미수납 리스트(daysLabel, 116-121행)는 1일 경과부터 #ef4444 빨강이지만, 수납관리(RoomsClient.tsx:169)는 7일 초과부터 연체(테라코타)로 표시되어 같은 3일 경과 미납이 대시보드에선 빨강, 수납관리에선 Amber로 보임.
- **유저 임팩트**: 수납관리에서 '연체는 빨간(테라코타) 솔리드'라고 학습한 사용자가 대시보드에 오면 같은 연체가 노란 칸으로, 퇴실예정이 화면 위치마다 노랑/금색/카멜로 보임. 색으로 위험도를 판단하는 사용자가 연체 호실을 대시보드에서 덜 심각하게 인지하거나, '누적 미수'와 '미납'을 다른 개념으로 오해함.
- **개선 방향**: 대시보드 CATEGORY_META·STATUS_COLORS·daysLabel 색을 StatusBadge 토큰(var(--badge-*-fg/bg), var(--coral))으로 교체하고 연체(7일) 임계 로직을 공용 헬퍼로 공유

### 29. [🟡 중간] 금액 용어 혼용 — 화면은 '월 이용료'인데 수납 토스트·할인 위젯은 '월세'
- **위치**: `components/entity-modal/widgets/PaymentEntryForm.tsx:107`
- **내용**: 서비스 전반의 표시 용어는 '월 이용료/월이용료' 계열(RoomsClient.tsx:70 '월 이용료'·91 '기본 월이용료', TenantClient.tsx:97·136·1285, RoomManageClient.tsx:836·953, PaymentBody.tsx:62)인데, 수납 기록 시 토스트는 '월세 수납됨'(PaymentEntryForm.tsx:107, TenantClient.tsx:767, DashboardClient.tsx:1324), 할인 위젯 제목은 '월세 할인'(DiscountWidget.tsx:61), 대시보드 미납 알림 부제도 '월세 N원 미납'(alerts.ts:86)으로 '월세'가 노출됨. 특히 수납 토스트는 보증금/청소비/월세 3분기 구조라 문구가 곧 어떤 항목으로 기록됐는지의 확인 수단인데, 같은 모달의 요약 화면(PaymentBody '월 이용료')과 어긋남. '월 이용료'와 '월이용료' 띄어쓰기 혼재도 같은 파일 내에서까지 확인됨(약 28개 라인 규모; 원 설명의 '22곳'은 근사치).
- **유저 임팩트**: 고시원 운영자가 '이용료'로 통일된 화면에서 입금을 기록했는데 '월세 수납됨' 토스트가 떠서 다른 항목(임대차 월세)으로 잘못 기록된 건 아닌지 순간 의심하게 됨. 특히 보증금/청소비/월세 토스트가 분기되는 구조라 용어가 곧 '어떤 돈으로 기록됐는지'의 확인 수단인데 화면 용어와 어긋남.
- **개선 방향**: 토스트·DiscountWidget 등 사용자 노출 문자열의 '월세'를 '월 이용료'로 통일하고 띄어쓰기 표기('월 이용료')도 한 가지로 고정

## 모달·URL·네비게이션

### 30. [🔴 높음] room-manage의 ?roomId&edit=1 처리에 handledEditRef 가드·URL 정리가 없어 편집 폼이 계속 재오픈됨 (고객관리에서 고친 버그의 복제본)
- **위치**: `app/(app)/room-manage/RoomManageClient.tsx:204`
- **내용**: TenantClient는 2026-06-05 보고된 동일 버그를 handledEditRef(432행) + clearTenantUrlParams(626행)로 고쳤지만, RoomManageClient의 URL 자동 열기 useEffect(204-212행)는 (1) 1회 가드가 없고 (2) deps가 [searchParams, initialRooms]이며 (3) URL에서 roomId/edit를 지우는 코드가 파일 어디에도 없음. 게다가 호실 수정 저장(handleUpdate)은 372행에서 window.location.reload()를 호출하는데, URL에 ?roomId=X&edit=1이 그대로 남아 있어 리로드 직후 mount effect가 openEdit(found)를 다시 실행함. 또 이 페이지는 useUrlState('q')(134행)를 쓰므로 검색 타이핑마다 router.replace로 searchParams 객체가 갱신돼 effect가 재실행됨 — 잔존한 roomId/edit 때문에 편집 폼(또는 Prism 셸)이 또 열림.
- **유저 임팩트**: Prism 셸의 [수정] 버튼(EntityModal.tsx 119행이 /room-manage?roomId=X&edit=1로 push)으로 진입해 호실을 수정하고 저장하면, 페이지가 리로드되면서 방금 닫힌 편집 폼이 즉시 다시 열림 — '저장이 안 됐나?' 하고 다시 저장을 반복하게 됨. 폼을 취소로 닫은 뒤 검색창에 글자를 입력해도 300ms 뒤 편집 폼이 불쑥 다시 뜸.
- **개선 방향**: TenantClient와 동일하게 handledEditRef 패턴 적용 + 폼 닫기/저장 시 router.replace로 roomId·edit 파라미터 제거 (reload 대신 router.refresh 권장)

### 31. [🔴 높음] 알림벨·딥링크가 이미 같은 페이지에 있으면 무반응 — 그런데 알림은 '읽음' 처리돼 사라짐
- **위치**: `components/layout/NotificationBell.tsx:92`
- **내용**: NotificationBell.onItem(88-93행)은 markRead 후 router.push('/tenants?tenantId=X')로 이동. 그러나 TenantClient의 Prism 자동 오픈 effect(406-425행)는 deps=[] + initialOpenRef로 최초 mount 1회만 동작하고, 같은 경로에서 쿼리만 바뀌는 내비게이션은 클라이언트 컴포넌트를 remount하지 않으므로(프로젝트 자체 주석 405행이 동일 메커니즘의 과거 버그를 기록해 입증), 사용자가 이미 /tenants에 있을 때 알림을 클릭하면 URL만 바뀌고 모달이 열리지 않음. RoomsClient의 ?roomNo 딥링크(394-406행)도 deps=[]라 동일 문제. 또한 EntityModal의 close(EntityModal.tsx 48-56행)가 URL 파라미터를 지우지 않아 새로고침 시 모달이 다시 열리는 부수 증상도 사실. 유저 임팩트: 고객관리 화면에서 미납 알림 클릭 → 화면 무반응인데 markRead가 먼저 실행돼 그 알림이 벨의 오늘 목록에서 사라짐. 단, 읽음 처리는 벨에만 적용되고 대시보드 알림 스트립에는 여전히 표시되므로 '다시 찾을 방법이 없음'은 과장 — 대시보드에서 재확인 가능하고 다음 날 벨에도 재노출됨. 그래도 '클릭했는데 아무 일도 안 일어나고 알림만 사라지는' 혼란은 실제 발생.
- **유저 임팩트**: 고객관리 화면에서 미납 알림을 클릭 → 화면에 아무 변화 없음. 그런데 markRead가 먼저 실행돼 그 알림은 오늘 목록에서 사라져 버려, 사용자는 어떤 고객 건이었는지 다시 찾을 방법이 없음.
- **개선 방향**: tenantId/roomNo 딥링크 effect의 deps를 [searchParams]로 바꾸고 '한 번 처리한 값' ref 가드 + 처리 후 URL 파라미터 제거 (handledEditRef 패턴과 동일)

### 32. [🟡 중간] openCheckoutProration 시드가 모달이 닫힐 때까지 잔존 — 하단 나브바로 수납 면에 재진입할 때마다 퇴실 정산 폼이 자동으로 펼쳐짐
- **위치**: `components/entity-modal/EntityModal.tsx:77`
- **내용**: TenantStatusTransitions(235행)의 '예, 정산하기'는 entityModal.open({openCheckoutProration: true})로 시드를 심는다. 이 플래그는 state.seed에 남아 PrismShellView가 매 렌더마다 PaymentBody(212행)에 전달함. PrismNavBar로 kind를 '고객'→'수납'으로 오갈 때마다 PaymentBody가 unmount/remount되며 mode 초기값이 'full'(PaymentBody.tsx 39행)이 되고, CheckoutProrationWidget의 autoOpenedRef(57행)도 remount로 리셋돼 폼 자동 펼침 + 서버 미리보기(previewCheckoutProration)가 매번 재실행됨. 정산을 이미 '적용'한 뒤에도 동일하게 재진입 시마다 정산 폼으로 끌려 들어감.
- **유저 임팩트**: 퇴실 정산 팝업에서 '예'로 들어와 정산을 적용한 사용자가 같은 모달에서 '고객' 면을 봤다가 '수납' 면으로 돌아오면, 요약 화면 대신 또 퇴실 정산 입력 폼이 펼쳐져 있어 '정산이 적용 안 됐나? 또 적용해야 하나?' 혼란 — 이미 적용된 상태에서 다시 '정산 적용'을 누르는 중복 조작 유도.
- **개선 방향**: PaymentBody 첫 mount(또는 자동 진입 1회 소비) 후 seed의 openCheckoutProration을 false로 클리어하는 콜백을 Provider에 추가

### 33. [🟡 중간] 브라우저 뒤로가기로 페이지가 바뀌어도 전역 Prism 모달이 닫히지 않고 새 페이지 위에 떠 있음 + 닫으면 엉뚱한 스크롤 위치로 점프
- **위치**: `components/entity-modal/EntityModal.tsx:39`
- **내용**: EntityModalProvider는 app/(app)/layout.tsx(82행)에서 모든 페이지를 감싸고, 모달 상태는 React state이며 usePathname 감시나 popstate 처리(grep 결과 인증용 AuthBackTrap 외 전무)가 없음. 모달이 열린 채 브라우저 뒤로/앞으로 가기(모바일 스와이프 포함)를 하면 밑의 페이지만 바뀌고 모달은 그대로 남음. 또 PrismShellView는 month를 현재 URL에서 읽으므로(91행) 페이지가 바뀌면 수납 면의 조회 월이 소리 없이 바뀔 수 있고, close()의 스크롤 복원(48-56행)은 이전 페이지에서 저장한 scrollY로 '새 페이지'를 scrollTo하여 엉뚱한 위치로 점프함.
- **유저 임팩트**: 모바일에서 고객 상세 모달을 열고 뒤로 스와이프하면 모달이 닫히는 대신 대시보드 위에 고객 모달이 그대로 떠 있음. 모달을 닫으면 대시보드가 이전 페이지의 스크롤 위치로 휙 이동해 '화면이 제멋대로 움직인다'는 인상을 줌.
- **개선 방향**: EntityModalProvider에서 usePathname을 구독해 pathname 변경 시 setState(null)로 모달을 닫고 스크롤 복원은 같은 pathname일 때만 수행

### 34. [🟡 중간] Esc/배경클릭 처리 계층별 비일관 — 공용 Modal은 Esc 무시, 배경 클릭은 저장 중·입력 중에도 무조건 전체 닫힘
- **위치**: `components/ui/Modal.tsx:52`
- **내용**: Esc 처리가 계층마다 다름: PhotoStrip 라이트박스(z-[300], window keydown 73행)와 room-manage 라이트박스(z-[320], document keydown 1095행)는 Esc로 닫히지만, 공용 Modal(ui/Modal.tsx — Esc 핸들러 없음), 계약서 출력 선택(z-[290]), 상태전환 미니폼(z-[300]), 퇴실정산 팝업(z-[310])은 Esc가 안 먹음. 배경 클릭도 비일관: TenantStatusTransitions 미니폼은 'if (!pending)' 가드(174행)가 있지만 공용 Modal 오버레이 onClick={onClose}(52행)는 무조건 실행 — PaymentEntryForm이 저장 중이거나 금액·메모 입력 중에도 배경 클릭 시 Prism 셸 전체가 확인 없이 닫힘. 저장은 서버에서 계속 진행되므로(startTransition 내 비동기 서버 액션) 기록은 남는데 사용자에겐 피드백 없음. '저장 안 된 줄' 알고 재저장하면 savePayment에 중복 가드가 없어 두 번째 레코드가 추가됨 — 단 FIFO 분배 로직 때문에 같은 달 이중 기록이 아니라 다음 미수월로 '과납 이월'되어 유령 수납이 생기는 형태(원 설명의 '같은 달 이중 기록'만 부정확).
- **유저 임팩트**: 수납 등록 폼에 금액을 입력하다 모달 바깥을 잘못 누르면 확인 없이 입력이 전부 날아감. 더 나쁜 경우: '저장' 클릭 직후 배경을 눌러 닫고 '저장 안 된 줄' 알고 다시 열어 한 번 더 저장 → 같은 달 수납이 이중 기록됨. 사진 라이트박스에선 Esc가 되는데 그 밑 모달에선 안 되니 단축키 신뢰도도 떨어짐.
- **개선 방향**: ui/Modal에 Esc 핸들러 추가(최상위 레이어만 닫히도록 z 기준 가드) + 오버레이 클릭 닫기에 saving/dirty 가드 prop 도입

### 35. [🟢 낮음] useUrlState 디바운스가 스테일 params 스냅샷으로 URL을 재구성 — 직전에 다른 코드가 세팅한 month 파라미터를 지워버리는 레이스
- **위치**: `lib/useUrlState.ts:27`
- **내용**: useUrlState의 effect는 deps=[value]뿐이라, 타이머가 발화할 때 'value가 마지막으로 바뀐 렌더 시점'의 params 스냅샷(27행 new URLSearchParams(params.toString()))으로 URL 전체를 router.replace함. 따라서 디바운스 300ms 사이에 다른 코드가 추가한 파라미터가 통째로 유실됨. 실제 충돌 경로: TenantClient.openTenantPrism(310-320행)은 퇴실 고객 클릭 시 month=퇴실월을 router.replace로 세팅하고 Prism을 여는데, 사용자가 검색창에 이름을 치고(q 디바운스 타이머 가동) 300ms 안에 검색 결과의 퇴실 고객을 클릭하면, 타이머가 month 없는 옛 params로 URL을 덮어써 month가 사라짐. PrismShellView(EntityModal.tsx 91행)는 month를 URL에서 읽으므로 수납 면이 퇴실월 대신 현재월로 조회됨.
- **유저 임팩트**: 검색으로 퇴실 고객을 찾아 바로 클릭하는 가장 흔한 동선에서, 모달의 수납 내역이 비어 보임('이 달 납부 기록이 없습니다') — month 자동 세팅 기능이 고치려던 바로 그 혼란이 간헐적으로 재발하고, 간헐적이라 재현 문의도 어려움.
- **개선 방향**: 타이머 발화 시점에 window.location.search(또는 최신 searchParams ref)로 URL을 재구성해 자기 key만 갱신하도록 수정

## 되돌리기(undo) 커버리지

### 36. [🔴 높음] 합배송 묶기(attachShippingToOrder)에 묶기 해제 수단이 전혀 없음
- **위치**: `app/(app)/finance/actions.ts:597`
- **내용**: attachShippingToOrder는 선택한 지출들에 orderId를 부여하고 배송비 라인을 생성하지만, orderId를 다시 null로 되돌리거나 ExpenseOrder를 해체하는 서버 액션이 코드베이스 어디에도 없습니다(grep 결과 'orderId: null'은 쿼리 필터 1건뿐). updateExpense도 orderId를 건드리지 않아 수정 폼으로도 풀 수 없습니다. FinanceClient.tsx:2864 주석은 "배송비(합배송 등) 관리는 [수정]에서 일괄 — 안내만"이라며 안내만 하고, 수정 저장 경로(1673행)는 묶기만 추가할 뿐입니다. 배송비 라인을 deleteExpense로 지워도 품목 지출들의 orderId는 남아 '외 N건' 주문 칩이 계속 표시됩니다.
- **유저 임팩트**: 엉뚱한 지출을 실수로 합배송에 묶으면(예: 다른 주문 건을 형제로 선택) 풀 방법이 없어, 지출 행을 통째로 삭제하고 다시 입력하는 것 외엔 복구 불가. 잘못 묶인 '○○ 외 N건' 칩이 지출 목록에 영구히 남음. 오늘(f461c97 직전) 추가된 최신 기능인데 사용자 원칙(모든 적용엔 적용취소)을 위반.
- **개선 방향**: detachExpenseFromOrder(expenseId) 액션 추가 — orderId를 null로 되돌리고, 주문에 품목이 0개가 되면 배송비 라인·ExpenseOrder도 정리

### 37. [🔴 높음] 호실 삭제(deleteRoom)가 과거 계약·수납(매출) 기록까지 연쇄 영구 삭제 — confirm 한 번
- **위치**: `app/(app)/room-manage/actions.ts:201`
- **내용**: deleteRoom은 활성 계약만 차단할 뿐, 과거 LeaseTerm을 deleteMany로 지우고(201-210행) PaymentRecord는 LeaseTerm cascade(schema.prisma 450행 onDelete: Cascade)로 자동 삭제, Drive 사진도 즉시 삭제합니다. EntityModal.tsx 110행에서 confirm() 한 번("되돌릴 수 없습니다")으로 즉시 실행되며 스냅샷·soft delete·백업 유도가 전혀 없습니다.
- **유저 임팩트**: 리모델링 등으로 호실을 정리하다 방 하나를 지우면 그 방의 수년치 수납 기록이 통째로 사라져 연간 리포트·매출 추이 숫자가 소리 없이 바뀜. '왜 작년 매출이 줄었지?'를 한참 뒤에 발견해도 복구 불가.
- **개선 방향**: Room에 isArchived(soft delete) 도입 또는 삭제 전 exportAllData식 스냅샷 저장 + 과거 수납 기록 N건이 함께 삭제됨을 confirm 문구에 명시

### 38. [🔴 높음] 고객 삭제(deleteTenant)도 수납 이력 연쇄 삭제 — undo·스냅샷 없음
- **위치**: `app/(app)/tenants/actions.ts:1165`
- **내용**: 원 설명은 사실이나 한 가지 보정: TenantClient의 자체 다이얼로그(TenantClient.tsx:1070-1072)는 "수납 기록, 계약 이력, 연락처 등 모든 데이터가 영구적으로 삭제되며 복구할 수 없습니다"라고 연쇄 삭제 범위를 명시적으로 경고함. 반면 EntityModal의 confirm()(EntityModal.tsx:126)은 "삭제할까요? 되돌릴 수 없습니다"만 표시해 수납 이력 소실을 알리지 않음. 다만 두 경로 모두 실행 후 복구 수단(undo·스냅샷·soft-delete)이 전혀 없다는 핵심 문제는 그대로 유효하며, 같은 파일의 퇴실 정산(checkoutProrationUndo)에는 undo가 구현돼 있어 비일관적임.
- **유저 임팩트**: 동명이인 정리나 중복 등록 정리 중 잘못된 고객을 지우면 그 사람의 입금 이력 전체가 매출 통계에서 빠짐. 같은 달 리포트를 다시 열면 합계가 달라져 있어 사용자가 원인을 추적할 수 없음.
- **개선 방향**: 삭제 대신 기본을 '보관(soft delete)'으로 하고, 진짜 삭제 시 연쇄 삭제될 수납 N건·금액 합계를 다이얼로그에 표시 + 삭제 직전 JSON 스냅샷 보관

### 39. [🔴 높음] batchUpdateRooms의 baseRent 일괄 변경이 계약별 협의 임대료(rentAmount)까지 덮어쓰기 — 이전 값 어디에도 안 남음
- **위치**: `app/(app)/room-manage/actions.ts:452`
- **내용**: batchUpdateRooms(actions.ts 446-460행)는 선택 호실들의 baseRent를 하나의 값으로 updateMany한 뒤, ACTIVE/RESERVED/CHECKOUT_PENDING 계약의 rentAmount까지 같은 값으로 일괄 덮어씀. 계약 시 개별 협의로 baseRent와 달라진 rentAmount가 경고·확인 절차 없이 소실되며, 스냅샷·undo·변경 이력이 전혀 없음(스키마에 다른 기능용 undo는 존재). applyScheduledRentNow(404-416행)·applyScheduledRents(373-378행)도 동일. 미납 판정(dashboard/unpaid.ts 293·330행)은 월별 락인 청구액이 저장된 달은 보호되지만, 락인 없는 달과 미래 청구·연체 개월 수 계산은 덮어쓰인 rentAmount 기준으로 잘못 계산됨.
- **유저 임팩트**: 체크박스 범위를 잘못 잡고 일괄 편집을 저장하면 거주 중 입주자들의 협의 임대료가 전부 새 값으로 바뀜. 이전 금액이 화면 어디에도 남지 않아 계약서를 한 장씩 다시 꺼내 보며 수동 복원해야 하고, 그 사이 수납 화면의 '미납' 판정이 잘못된 금액 기준으로 계산됨.
- **개선 방향**: 일괄 변경 직전 {roomId, 이전 baseRent, leaseTermId, 이전 rentAmount} 스냅샷을 저장하고 '일괄 편집 취소' 버튼 제공 (퇴실 정산의 checkoutProrationUndo 패턴 재사용)

### 40. [🟡 중간] 재고 제외(excludeExpenseFromInventory)가 일방향 — '다시 포함' 액션이 코드에 없음
- **위치**: `app/(app)/inventory/actions.ts:1108`
- **내용**: excludeExpenseFromInventory는 excludeFromInventory=true만 설정하며, 기존 지출의 이 플래그를 false로 되돌리는 코드 경로가 전무합니다(grep 결과 false 대입은 모두 쿼리 필터/신규 생성 기본값). updateExpense도 이 필드를 다루지 않습니다. InventoryClient.tsx 1267-1274행에서 confirm 한 번으로 실행되고 '지출 페이지에는 그대로 남습니다'라고만 안내해, 되돌릴 수 있다는 인상을 주지만 실제로는 영구 제외입니다.
- **유저 임팩트**: 구매 내역 정리 중 실수로 '재고에서 제외'를 누르면 해당 구매가 입고량·단가 추이·월별 유입 계산에서 영원히 빠짐. 재고 잔량이 실제와 안 맞는데 지출 페이지엔 멀쩡히 있어 원인을 찾기 어려움(같은 구매가 화면마다 다르게 집계).
- **개선 방향**: includeExpenseInInventory(플래그 false 복원) 액션 + 품목 상세에 '제외된 구매 N건 보기/복원' UI 추가

## 페이지 간 데이터 신선도

### 41. [🔴 높음] 수납 등록·수정·삭제 액션에 revalidatePath가 전혀 없음 (현재 페이지 router.refresh에만 의존)
- **위치**: `app/(app)/rooms/actions.ts:638`
- **내용**: 원 설명이 정확함. 보완 한 가지: 스테일 노출 경로는 브라우저 back/forward 내비게이션(클라이언트 캐시의 페이지 세그먼트 재사용)에 한정되며, 일반 Link 클릭 내비게이션은 동적 페이지를 기본적으로 캐시하지 않아(Next 16 staleTimes.dynamic=0) 새로 fetch함. 즉 "수납 입력 → 뒤로가기로 다른 페이지 복귀" 시에만 '여전히 미납' 표시가 재현됨.
- **유저 임팩트**: 대시보드의 미납 위젯에서 수납을 입력하면 대시보드는 갱신되지만, 뒤로가기(back/forward 캐시)로 /rooms나 /tenants로 돌아가면 해당 호실이 여전히 '미납'으로 표시됨. 반대로 /rooms 모달에서 수납 후 뒤로가기로 대시보드에 가면 미납 알림이 그대로 남아 '돈을 받았는데 왜 아직 미납이지?'라는 혼란 발생. 과납 이월로 다음 달 record가 생겨도 어떤 경로도 무효화되지 않음.
- **개선 방향**: savePayment·saveDepositPayment·updatePayment·deletePayment에 recordDepositReceived와 동일하게 revalidatePath('/rooms'), '/dashboard', '/tenants', '/finance' 추가

### 42. [🔴 높음] 귀속월 진단(accrual-check)의 record 이동 액션이 어떤 경로도 무효화하지 않음
- **위치**: `app/(app)/accrual-check/actions.ts:178`
- **내용**: 발견 내용은 사실이나 범위를 정밀화하면: Next.js 16 기본값상 페이지는 클라이언트 캐시에 저장되지 않으므로 일반 링크 내비게이션으로 /rooms·/dashboard·/finance에 가면 서버에서 새로 렌더되어 최신 데이터가 보인다. 낡은 데이터가 노출되는 경로는 브라우저 뒤로가기/앞으로가기(방문했던 페이지 페이로드 재사용)로 한정된다. 다만 진단 페이지 특성상 다른 화면에서 확인 후 뒤로가기로 돌아가는 흐름이 자연스러워 실사용 임팩트는 유효하며, revalidatePath('/rooms')·('/dashboard')·('/finance') 추가가 올바른 수정이다.
- **유저 임팩트**: 사용자가 진단 페이지에서 '지연 입금 일괄 적용'으로 수십 건의 record를 전월로 옮긴 뒤 뒤로가기로 /rooms에 돌아가면, 이동 전 기준의 수납/미납 상태가 그대로 보임. 방금 일괄 정리한 결과가 화면마다 달라 '적용이 된 건가?' 하고 같은 작업을 반복하거나 수동으로 또 옮길 위험(중복 적용).
- **개선 방향**: moveRecordTargetMonth 성공 시 revalidatePath('/rooms'), '/dashboard', '/finance', '/tenants' 호출 (bulk는 내부적으로 이를 재사용하므로 한 곳만 추가해도 됨)

### 43. [🟡 중간] 존재하지 않는 경로 revalidatePath('/expenses') — 지출 페이지(/finance) 무효화 의도가 빗나감
- **위치**: `app/(app)/inventory/actions.ts:1100`
- **내용**: updateExpenseFromInventory는 재고 페이지에서 구매 기록(expense)의 금액·일자·거래처·수령일을 직접 수정하는 액션인데, revalidatePath('/inventory')와 함께 revalidatePath('/expenses')를 호출한다(1100행). app 디렉터리에 /expenses 라우트는 존재하지 않으며(검색 결과 0건) 지출 목록 페이지는 /finance다. 같은 파일의 다른 expense 연동 액션들(updateTrackedItem 322행, mergeTrackedItems 543행 등)은 모두 '/finance'를 올바르게 무효화하고 있어 명백한 오타/잔재로 보인다.
- **유저 임팩트**: 재고 페이지에서 구매 기록의 금액이나 날짜를 고친 뒤 지출 페이지(/finance)로 이동하면(특히 뒤로가기) 수정 전 금액이 그대로 보여, 같은 지출의 숫자가 재고 화면과 지출 화면에서 서로 다르게 표시됨. Next의 현행 임시 동작(서버 액션 revalidatePath 시 방문 페이지 전체 새로고침)이 사라지면 항상 재현되는 잠복 버그.
- **개선 방향**: revalidatePath('/expenses')를 revalidatePath('/finance')로 교체 (지출 변경이므로 '/dashboard'도 함께 고려)

## 기각된 발견 (검증 결과 사실과 다르거나 과장)

- (뱃지·용어·색상 일관성) 비거주(NON_RESIDENT) 계약 호실이 호실관리에서는 그냥 '공실'로 표시됨
  - 기각 사유: 코드 인용 자체는 정확하나(room-manage/actions.ts:34 필터, RoomManageClient.tsx:66-69·471-473 공실 분류/집계, rooms/actions.ts:80, RoomsClient.tsx:644, DashboardClient.tsx:2210 모두 확인), 핵심 임팩트 주장 2가지가 코드 설계와 모순됨. (1) '새 입주자 등록 시 충돌': tenants/actions.ts:129-141에 "NON_RESIDENT(명의만)와 실거주자는 같은 방에 공존 가능" 주석과 함께 비거주 방에 실거주자 등
- (되돌리기(undo) 커버리지) 지연 입금 일괄 이동(bulkApplyLatePayments) — 원래 귀속월을 보존하지 않아 사실상 비가역
  - 기각 사유: app/(app)/accrual-check/actions.ts를 직접 읽고 확인. 'late-payment' 카테고리는 diff===1(payMonth = targetMonth+1)일 때만 분류되고(라인 116), 이때 inferredAccrualMonth = prevMonthStr(payMonth)는 정확히 현재 targetMonth와 같음(라인 119, 연 경계 케이스 포함 산술 검증). bulkApplyLatePayments(라인 161~175)가 moveRecordTargetMonth(s.id, s.inferredAccrua
- (페이지 간 데이터 신선도) 입·퇴실 핵심 액션(checkoutTenant 등)이 '/tenants'만 무효화 — 같은 파일 내 다른 전환 액션과 커버리지 비일관
  - 기각 사유: 코드 레벨 사실관계는 정확함 — app/(app)/tenants/actions.ts에서 checkoutTenant(731행, revalidatePath '/tenants'만 776행), addTenant(229행), updateTenant(500행), moveInTenant(653행), deleteTenant(1166행)은 '/tenants'만 무효화하고, confirmReservationToActive(719~722행)와 applyStatusTransition(860~864행)은 4~5개 경로를 무효화하는 비일관성이 실제로 존재함
- (페이지 간 데이터 신선도) 지출 CRUD·합배송이 '/finance'만 무효화 — 재고(입고/잔량)·대시보드 손익이 의존하는데 누락
  - 기각 사유: 코드 위치 인용 자체는 정확함: finance/actions.ts의 addExpense(433·452행)·updateExpense(555·580행)·deleteExpense(591행)·attachShippingToOrder(683행)는 revalidatePath('/finance')만 호출하고, 재고의 getMonthlyInflow(app/(app)/inventory/actions.ts 31~80행)는 expense의 qtyValue·receivedAt·amount를 직접 쿼리함. 그러나 주장된 유저 임팩트(뒤로가기 시 재고/대시보
- (페이지 간 데이터 신선도) 호실 추가/삭제가 '/room-manage'만 무효화 — /rooms·대시보드·평면도 누락 (updateRoom과 비일관)
  - 기각 사유: 코드 사실관계는 맞음: app/(app)/room-manage/actions.ts에서 addRoom(104행)·deleteRoom(213행)은 revalidatePath('/room-manage')만 호출하고, updateRoom(177–179행)·applyScheduledRents(381–383행)·batchUpdateRooms(462–464행)는 '/rooms'·'/tenants'까지 무효화하며 '/dashboard'·'/floor-plan'은 이 파일 어디서도 무효화되지 않음. 그러나 유저 임팩트는 성립하지 않음. (1) 영향
