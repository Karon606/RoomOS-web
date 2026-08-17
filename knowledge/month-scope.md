# 보고 있는 월 — 어디까지 흐르고 어디서 잠기나

앱 전체가 공유하는 상태 중 화면을 넘나드는 것은 사실상 이것 하나다. 그래서 규칙이 한 곳에
없으면 화면마다 다른 달을 보게 된다.

## 흐름 (2026-08-18 실측)

- **정본은 URL `?month=`** 다. 서버 페이지가 `searchParams.month` 를 읽어 조회 월로 쓰고,
  클라이언트는 `useSearchParams()` 로 같은 값을 읽어 라벨을 그린다.
- **내비가 값을 옮긴다.** `components/layout/BottomNav.tsx` · `components/layout/Sidebar.tsx`
  가 링크마다 현재 `?month=` 를 붙인다. 홈 → 지출 → 재고로 옮겨도 보던 달이 따라오는 것은
  이 배선 덕이다.
- **`localStorage.stayeum_selected_month` 는 쓰기만 하고 아무도 안 읽는다**
  (`MonthSelector.applyMonth` · `InventoryClient.changeMonth` 두 곳이 쓴다). 월 상태의
  진실은 URL 뿐이라, 이 키를 근거로 무언가를 판단하면 안 된다.
- `MonthSync`(셸 상주)는 `?month=` 가 **없을 때만** 자정 롤오버·재진입에 `router.refresh()`
  를 건다. 값이 있으면 그 달을 그대로 존중한다.

## 규칙 — 미래 월은 입퇴실 캘린더에서만 (운영자 2026-08-18)

원문: "미래달을 보는 건 어디까지나 호실관리 입퇴실에서만이야. 여기서 2026년 9월을
선택했더라도 홈·지출·재고 등으로 넘어가면 현재 기준의 월로 돌아가야 돼."

- 잠금을 푸는 화면은 **호실 관리 입퇴실 캘린더 하나**다(`MonthSelector allowFuture`,
  `room-manage/page.tsx` 의 `resolveMonthParam(month, { allowFuture: true })`). 예약이 사는
  화면이라 미래가 본론이다.
- 나머지는 전부 잠긴다. 잠긴 화면은 **해석 지점에서** 미래를 이번 달로 끌어내린다 —
  정본은 [[../lib/monthParam|lib/monthParam]] `resolveMonthParam` 하나뿐이고, 서버 페이지·
  월 셀렉터 표시·프리즘 수납 면·내보내기(버튼 둘 + `/api/export`)가 모두 이것을 부른다.
- **왜 링크가 아니라 해석인가.** 링크마다 막으면 북마크·뒤로가기·직접 입력·딥링크가 그대로
  새고, 새 링크가 생길 때마다 같은 방어를 또 적어야 한다. 해석이 한 벌이면 어느 길로 들어오든
  같은 규칙을 딛는다.
- **URL 은 안 고친다.** 잠긴 화면이 미래 월 URL 을 이번 달로 *읽을* 뿐, 주소를 다시 쓰지는
  않는다. 고쳐 쓰면 입퇴실로 되돌아갔을 때 보고 있던 달을 잃는다.
- 형식이 어긋난 값(`2026-8`·잡문자)도 이번 달로 떨어진다.

### 잠자게 된 코드

`isFutureMonth` 분기(`dashboard/page.tsx` · `rooms/actions.ts`)와
[[domain-billing]] "미래월은 수납을 말하지 않는다(2026-08-11)" 규칙은 잠긴 화면에서 더 이상
발동하지 않는다. **지우지 않았다** — 어떤 화면에 `allowFuture` 를 주는 순간 그대로 되살아나야
할 규칙이다. 미래 월 표시를 다른 화면에도 열 생각이라면 그 화면의 `allowFuture` 를 켜는 것이
정본 절차다.

## 함정

- **월 셀렉터 팝오버와 `overflow-hidden`.** 알약은 둥근 모서리로 '오늘' 버튼 배경을 자르려고
  `overflow-hidden` 을 걸고 있다. 팝오버의 기준 상자(`relative`)가 그 **안쪽**에 있으면
  팝오버가 통째로 잘려 DOM 에는 있는데 한 픽셀도 안 그려진다 — 2026-06-30부터 2026-08-18까지
  일곱 주 동안 "연월을 눌러도 아무것도 안 뜨는" 상태였다. 기준 상자는 알약 **밖**에 둔다.
- **연속 트랙의 착지와 피드백 루프.** 입퇴실 트랙은 스크롤을 따라 `history.replaceState` 로
  `?month=` 를 다시 쓴다. 이 API 는 라우터 상태만 바꾸고 서버 컴포넌트를 다시 돌리지 않으므로
  (Next 문서: `usePathname`·`useSearchParams` 와만 동기화) **서버가 준 `focusMonth` prop** 을
  보고 착지하면 스크롤이 착지를 부르는 루프가 성립하지 않는다. URL 을 보고 착지하면 루프가 된다.

## 관련

[[domain-billing]] · [[glossary]] · [[mobile-scroll-viewport]]
