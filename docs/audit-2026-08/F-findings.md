# F페이즈 조사 결과 원본 (2026-08-01)

전문가 3인(라우트 전환 / 모바일 스크롤 / 사용자 흐름)의 전수 조사 결과를 합친 것. **아직 수정 전.**
`파일:줄` 은 조사 시점 기록이라 단정 전 확인할 것.

---

## A. 전환 표시가 세 갈래로 갈려 있다 (스켈레톤 간헐성의 직접 원인)

| 갈래 | 대상 | 동작 |
|---|---|---|
| 즉시 스켈레톤 | contracts, finance, inventory, inventory/assets, market-analysis, report, residence-certs, rooms (8) | 항상 깜빡 |
| 300ms 지연 | (app)/loading.tsx 상속 12개 + dashboard (13) | 300ms 안에 끝나면 **아예 안 보임**. 그동안 셸만 남고 본문 빈 화면 |
| 전체화면 스플래시 | 셸 밖 14개 | 한 번 뜨면 **최소 1.4초** 유지(MIN 1000 + FADE 400) |

- `.delayed-fallback` = `--loader-delay: 300ms` (globals.css:231,265). 붙은 곳은 `app/(app)/loading.tsx`, `app/(app)/dashboard/loading.tsx` **2개뿐**.
- `SplashController.tsx:18-24` — DELAY 300 / MIN 1000 / FADE 400 / OFF_GRACE 400.
- 셸 밖 이동 경로: rent-receipts→rent-receipt/*, residence-certs→residence-cert/*, EntityModal 서류 발급, Sidebar→property-select, Sidebar→admin.

## B. 표시가 완전히 0인 구간

- `MonthSelector.tsx:87` 350ms 디바운스 → `startNavigation`(useTransition) push. 트랜지션이 Suspense 폴백 억제 + 같은 세그먼트라 폴백 없음 + nprogress `disableSameURL` 로 차단.
- `Header.tsx:47-57` 영업장 전환: `await selectProperty()` 무표시 → 트랜지션 push → refresh 경합.
- `AppShell.tsx:36` `const [, startNavigation] = useTransition()` — isPending 폐기. 주석은 "표시는 loading.tsx 담당"이나 트랜지션이 그 폴백을 억제.
- `BottomNav.tsx:86-88` 주석에 **같은 클래스의 과거 신고(2026-07-06)와 해결책이 이미 기록**돼 있다. 하단바에서만 제거됐고 3곳 잔존.

## C. 프리페치 무효화

- 내비 href 에 `?month=` 부착(Sidebar 222·259·393·414, BottomNav 85·117). 프리페치 캐시 키는 쿼리 포함 → **월 변경 시 전 링크 프리페치 무효**.
- 동적 라우트 프리페치 TTL 30초. 한 화면에 30초 이상 머물면 프리페치 없이 클릭.
- `prefetch` 속성을 명시한 `<Link>` 는 저장소 전체에 0개.

## D. 서버 응답 지연 요인

- `proxy.ts:34` 미들웨어가 모든 요청(프리페치 포함)에서 `await supabase.auth.getUser()` **네트워크 왕복**.
  `app/(app)/layout.tsx:28-30` 은 이미 `getClaims()` 로 이전하며 "중복 네트워크 왕복 제거" 주석. **미들웨어만 옛 방식.**
  → **loop.md §4 인증 로직. 운영자 승인 필요.** getClaims 는 비대칭 JWT 서명키 설정 전제, 세션 갱신 담당 여부 확인 필요.
- 무거운 라우트: dashboard(직렬 tail 4곳), finance(21개 액션), report(getForecastReport 18쿼리),
  room-manage(`await applyScheduledRents()` 쓰기 선행), floor-plan(Promise.all 후 순차 2).
  ※ 이건 **스켈레톤이 오래 남는** 원인이지 **늦게 뜨는** 원인이 아니다. 구분할 것.
- `app/(app)/layout.tsx:56-118` 순차 체인 — 콜드 부트·셸 밖 복귀 때마다.

## E. nprogress

- `NavProgress.tsx` → `document` 전체 subtree MutationObserver + 콜백마다 `querySelectorAll('a')` 전수 + 리스너 재부착. 전환 순간 메인 스레드 점유. 목록 긴 라우트(tenants·rooms·finance·inventory) 비용 큼.
- `<a>` 클릭에만 붙음 → `router.push` 이동은 진행바 없음.
- `history.pushState` Proxy 로 커밋 시점에 종료 → 그 뒤 스켈레톤→콘텐츠 구간은 무표시.

## F. 스크롤 (실제 깨진 것)

1. **floor-plan `h-screen`** (`app/(app)/floor-plan/page.tsx:48`) — 셸 안인데 100vh 요구. 하단 110~200px 잘림.
   편집 모드 캔버스 `touch-action:none`(FloorPlanEditor.tsx:1341)이라 **캔버스 위 스크롤 불가**. 양 엔진, iOS 더 심함.
2. **ConfirmDialog 스크롤러 부재** (`components/ui/ConfirmDialog.tsx:93-107`) — `--confirm-w:360px` 고정 + FontSizeProvider 가 root 20px(1.25배)까지 확대 → 세로로만 자람 → 위아래 동시 잘림, 스크롤 불가. **확인/취소 버튼이 먼저 사라진다.** 양 엔진.
3. **자체 바텀시트 3종** — `InventoryClient.tsx:3511`(HubShortDialog), `:3790`(LocationBatchCheckModal 비-inline, 현재 호출부 없음), `MergeSheet.tsx:38-41`(max-height·스크롤러 둘 다 없음).
   Modal.tsx 의 visualViewport 보정(`--modal-vvh`) 미상속 → **iOS 키보드가 하단 버튼 덮음**. + `env(safe-area-inset-bottom)` 누락(정본 5곳은 전부 적용).
4. **내가 만든 회귀** — 2026-07-31 `DocumentScroll` 도입으로 B패턴 페이지(login·reset-password·pending·profile-setup·property-select·rent-receipt·sign)에서 **모달 배경이 스크롤된다.**
   `Modal.tsx:21-24` 가 "셸이 overflow-hidden 이라 배경은 원래 안 움직인다"는 전제로 배경 잠금을 생략했는데 그 전제가 깨짐.
   `AddressSearch.tsx:78` 의 `body.style.overflow='hidden'` 도 무효 — `html.doc-scroll` 이 **html** 에 스크롤을 주므로 실제 스크롤러는 html.
5. **뒤로가기 스크롤 복원 없음** — 실제 스크롤러는 `main.app-main` 인데 브라우저는 window 만 복원. 긴 목록에서 상세 갔다 오면 맨 위.
   `EntityModal.tsx:58,66-67` 의 `window.scrollY` 복원 코드는 **죽은 코드**(window.scrollY 는 항상 0).
6. 잠복: `check-standalone-scroll.mjs` 커버리지 구멍 5종(조건부 분기·이른 return·디렉토리 밖 뷰·FULL_HEIGHT 게이트·파일 단위 OR).
7. 낮음: 중첩 overscroll-contain 5곳, ReceiptScanModal 가로화면, RoomsClient 리사이즈 핸들 `touch-none`.

## G. 흐름 끊김 (전환 직후)

**높음**
- `rent-receipts/RentReceiptsClient.tsx:263` — **재발급 링크가 kind 유실.** 보증금 탭에서 누르면 입실료 폼이 열리고 엉뚱한 금액 자동 채움. dd1ddbb 가 절반만 봉합됨. **잘못된 서류가 실제로 발급된다.**
- `search/actions.ts:262,287` — 요청 검색 착지가 month 유실. 지난달 요청을 검색으로 찾아 들어가면 "없습니다"만 뜨고 필터 초기화로도 안 나옴. **작업 완료를 실제로 막는다.**

**중간**
- 탭 URL 단방향 3곳: `DashboardClient.tsx:1279`, `FinanceClient.tsx:1350`, `RoomsClient.tsx:272`. 재진입 시 첫 탭 리셋. `lib/useUrlState.ts` 정본 존재.
- `tenants/page.tsx:11-15` — `?month=` 를 읽는 8개 라우트 중 **유일하게 MonthSelector 부재**. 과거 월 데이터를 보면서 표시도 되돌릴 방법도 없는데 수납까지 가능.
- `TenantClient.tsx:497-517` — `?tab=` 데드 파라미터인데 3곳이 보냄. 프리즘이 항상 맨 위.
- `PendingReceiptSection.tsx:332` month 미탑재 / `FinanceClient.tsx:1710-1713` `?pendingReceipt=` 소비 후 URL 미정리(재진입 시 오류 토스트). 정본은 `TenantClient.tsx:806-812`.
- `EntityModal.tsx:173,209,238,244` — 프리즘 이동이 month·검색어 미탑재. `/room-manage` 는 복귀 동선 없음.
- `ReportClient.tsx:158-159` — AI 진단 탭 조건부 마운트라 탭 이동 시 결과 증발. 재분석은 쿼터 + 10~20초.
- 돈 액션 무피드백: `CardSettlementClient.tsx:156,386`(반환값 미확인·토스트 없음), `FinanceClient.tsx:4900/4966/5051`(에러 렌더가 폼 블록 안이라 안 보임).
- `dashboard/pendingReceipt.ts:392` — `revalidatePath('/dashboard')` 만. 섹션은 `/snap-upload` 로 이동했는데 그쪽 미갱신.
- `RoomManageClient.tsx:601-607` 사진 삭제 무토스트·무undo(Drive 영구 삭제).
- `RecurringExpenseRecordModal.tsx:194-202` 예약 취소 결과 미확인.
- **error.tsx 가 2곳뿐**(contracts, residence-certs). 나머지 19개 라우트는 실패 시 복귀 동선 없음.

**되돌리기 부재(중간)**
- `PaymentRecordList.tsx:71-87` 수납 **귀속월 변경**에 확인·undo 없음(같은 파일 삭제·현금영수증은 있음).
- `PrevOwnerSettleWidget.tsx:54-60` 양도인 정산(주석에 "고위험") undo 없음.
- 고정지출 토글(`FinanceClient.tsx:1812`, `SettingsForm.tsx:684`) — 삭제에는 "다음 달부터 중단" 고지가 있는데 실질 효과가 같은 토글에는 없음.

## H. 월 경계 파급 (목록만 — 계산 검증은 A페이즈)

수납 귀속월 변경 / 고정지출 비활성화 / 납부일 임시조정 / 양도인 정산.
대조군(문법 참고): 퇴실 일할 게이트, 보관 위치 삭제(InventoryClient.tsx:4331-4354), 예정가격 즉시적용(EntityModal.tsx:123-140).

## I. 이상 없음 (확인 완료)

checklist, contracts, floor-plan(흐름 측면은 가장 견고), inventory/assets, market-analysis, marketing,
snap-upload, card-settlement/page, accrual-check/page, dashboard 서버측, settings 하위 4종,
tenants 하위 3종, 셸 밖 서류 3종, sign/[token], SMS 3종 모달.
과거 갤럭시 먹통 클래스(가짜 스크롤러 + overscroll-contain) **현재 0건** — 봉합 유지.
