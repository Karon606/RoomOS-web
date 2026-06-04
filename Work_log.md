# 스테이음 작업 로그

마지막 업데이트: 2026-06-02
브랜치: main

## ⏳ 사용자 화면 검증 대기 (2026-06-02 작업, 전부 main 배포·SQL 적용 완료)
오늘 재고·수납 9건 배포(커밋 `0a3ea71`~`eb1a717`). 실데이터 스크립트론 검증했고, 아래는 **실기기/프로덕션 화면 최종 확인**만 남음:
- **재고 월별 사용량 그래프** — 수세미 5월 0, 라면 5월 115·6월 66, 주방세제 6270 등 현실적 수치로 뜨는지. (입고가 사용량으로 둔갑하던 버그·실제 시각 정렬·effTime 적용)
- **전체 재고 보정** — 헤더 '전체 재고 보정' 모달(보충완료 게이트) + **품목별 점검 폼 '전체 보정으로 기록' 토글**. 보정분이 사용량에 안 잡히는지.
- **재고 점검 수정 폼** — 보충 전이 사라지지 않고(2개 유지) 창고 과차감 없는지.
- **미납 유예(최명윤 517호)** — 🔔알림·대시보드 미수·**수납 페이지** 모두에서 "19일 경과" 아니라 **납부예정(6/3)**으로 뜨는지. (수납 페이지는 스크립트 검증 불가)
- **재고 카테고리 설정** — '카테고리 설정' 버튼, 헤더 별칭(식료품/소모품/폐기물 처리용품), 수선유지비 추가·이름 변경.
- **데이터 정리(사용자 직접)** — 5/28에 일괄 백필된 5/12 점검들 중 충돌 건(라면 49 vs 135 등) 검토·정리. 텔레스코핑이 월합은 상쇄하나 타임라인엔 잔존.

## 완료된 것

### 2026-06-02 세션 11부 — 재고 UX 3건 (허브 노출 / 무의미 합계 제거 / 스켈레톤 로더)
1. **창고(허브) 메인 노출·전환**: 허브 지정이 '위치 관리' 모달 깊숙이 있어 안 보였음 → 재고 헤더에 "창고(허브): [이름] ▾" 칩 + 드롭다운으로 즉시 전환. 신규 액션 [actions.ts](app/(app)/inventory/actions.ts) `setStorageHub(id)`(트랜잭션 — 선택 위치 허브 ON·나머지 OFF, 단일 허브 보장). InventoryClient 헤더에 getStorageLocations 로드 + 피커.
2. **위치별 일괄점검 '이동 합계' 제거**: LocationBatchCheckModal 하단 "창고 → 이동 합계 +N"은 여러 품목(단위 제각각) 합이라 무의미 → 숫자 빼고 "보충한 만큼 각 품목의 창고 잔량에서 자동 차감됩니다" 안내만.
3. **스켈레톤 로더**: 페이지 이동 시 작은 BrandLoader(60vh 중앙)라 안 보여 답답 → [components/ui/Skeleton.tsx](components/ui/Skeleton.tsx) 신규(animate-pulse, cream-3 톤) + [app/(app)/loading.tsx](app/(app)/loading.tsx)를 제목·칩·카드6 스켈레톤 화면으로 교체. (app) 라우트 이동 시 본문이 깜빡이는 placeholder 로. SplashScreen(최초 진입)은 그대로.
- tsc·build 통과. SQL 불필요.

### 2026-06-02 세션 10부 — 전체 재고 보정 v2: 타임라인 보정 끼워넣기 (배포 `5de0617`·`7ae3738`)
v1은 과거 날짜 보정 가능했으나 발견·UX가 약함. v2 = 품목 상세 타임라인에서 특정 시점에 보정을 끼워넣고, 그 시점 예상 재고를 미리 보여줌. 사용자 선택(타임라인 끼워넣기).
- **신규 서버액션** [actions.ts](app/(app)/inventory/actions.ts) `getStockAsOf(trackedItemId, date)`: 그 날짜 시점 예상 재고(직전 ≤date 점검 잔량 + 그 사이 입고[구매 receivedAt·무상] 합산, 허브에 증감 귀속) → {total, byLoc}. 저장은 `saveFullReconcile` 단일 품목 재사용(carryOver 없는 plain isReconcile 생성 — createStockCheck 의 carryOver 는 '최신 점검'에서 채워 과거 삽입 시 미래값 끌어올 위험이라 회피).
- **UI** DetailModal: mode 에 'reconcile' 추가, 푸터 '보정 끼워넣기' 버튼 → 신규 `TimelineReconcileForm`(날짜 피커 → getStockAsOf 로 위치별 예상 프리필 → 실측 입력 → 차이 표시 → 사유 → 저장). 위치 없는 품목은 총량 입력.
- v1 자산(isReconcile·overview skip·saveFullReconcile) 그대로 재사용. **스키마 변경 없음.** tsc·build 통과.
- ⚠️ getStockAsOf 는 쿠키/인증 게이트라 스크립트 검증 불가 → 화면 확인 권장(과거 날짜 고를 때 예상 재고·차이 표시·삽입 후 타임라인 위치·사용량 영향).

### 2026-06-02 세션 9부 — 재고관리 카테고리 커스터마이징 (선택+별칭) [SQL 적용됨, 배포 `eb1a717`]
사용자 요청: 재고관리에서 'xx비'(지출 용어)는 안 어울림. ①재고에 보일 카테고리 선택 ②기본 표시명 제안 ③직접 수정. 지출 카테고리/로직은 안 건드리게.
- **스키마**: `Property.inventoryCategories String?`(JSON `[{cat,alias}]`) + `migrate_inventory_categories.sql`. **프로덕션 적용 완료**, prisma generate.
- **하드코딩 상수 동적화**: `TRACKED_CATEGORIES`(부식비·소모품비·폐기물 처리비 고정)를 쓰던 **서버 로직 4곳**(overview.ts·alerts.ts·actions.ts seed×2)을 `getTrackedCategories(propertyId)`로 대체 → 영업장별 카테고리(수선유지비 등 추가) 추적 가능. [categoryConfig.ts](app/(app)/inventory/categoryConfig.ts) 신규(parse+default), [constants.ts](app/(app)/inventory/constants.ts) 에 DEFAULT_INVENTORY_CATEGORIES·SUGGESTED_INVENTORY_ALIAS·suggestInventoryAlias(순수, 클라 공유).
- **표시명(별칭)은 화면 전용** — 부식비→식료품, 소모품비→소모품, 폐기물 처리비→폐기물 처리용품(기본). 지출/장부엔 영향 0.
- **UI**: page.tsx 가 categories·allExpenseCategories 전달. InventoryClient 그룹화/헤더/AddItemModal/FullReconcileModal 가 별칭 표시(`aliasOf`), 설정 밖 카테고리(과거 등록분)는 뒤에 자체 표시. `tintOf`(미등록 카테고리 폴백 색). 헤더 '카테고리 설정' 버튼 → `InventoryCategorySettingsModal`(선택·순서(▲▼)·별칭 편집·추가/제거). 액션 `getInventoryCategorySettings`/`setInventoryCategories`.
- **검증**: 설정 null→기본 3개 별칭 정상, trackedCats 정상. tsc·build 통과.

### 2026-06-02 세션 8부 — 납부일 임시조정 UI: 기본 대상=미납월 (근본 해결, 배포 `5427eb1`)
7부는 잘못 태깅된 override를 '유예'로 해석하는 보정. 8부는 **애초에 올바른 월에 태깅**하도록 UI 개선(근본).
- **원인(근본)**: `DueDayTempAdjustWidget`이 override를 항상 '보고 있던 달(targetMonth)'에 태깅 → 미납월과 어긋남.
- **수정**: 위젯이 `firstUnpaidMonth`(이미 RoomRow/settlement에 있음, PaymentBody가 전달)를 받아 **기본 조정 대상 = 미납월**. "밀린 N월분을 [날짜]로 미루기"로 표시. **'다른 달' 옵션**(월 칩 선택: 미납월·보는 달·향후 2개월)으로 완납 상태에서 미래 달 조정도 가능. 저장 시 override를 그 대상 월에 태깅(다음 달로 미루면 완전한 날짜로 저장) → 기존 정확-월 매칭이 그대로 경과일 정확.
- isActive 판정을 targetMonth 종속 → override 존재 여부로 일반화. 표시에 "[N월]분" 명시. setDueDayOverride(lease, overrideMonth, val).
- 7부 유예 보정 로직은 과거 잘못 태깅 데이터 + 안전망으로 유지. 결제 금액 영향 없음(태깅 월만 개선). tsc·build 통과.

### 2026-06-02 세션 7부 — 납부일 임시조정으로 미납 유예 시 경과일 계산 (배포 `167c2d6`)
사용자 보고: 최명윤 517호 "미납 19일 경과"로 뜨는데, 5월 미납분을 6/1로 납부일 임시변경(유예)했으니 19일 경과가 아님.
- **원인**: 임시조정 위젯이 override를 '보고 있던 월(targetMonth)'에 붙임([DueDayTempAdjustWidget.tsx:103](components/entity-modal/widgets/DueDayTempAdjustWidget.tsx#L103) `setDueDayOverride(leaseTermId, targetMonth, ...)`). 오늘이 6월이라 override가 **2026-06**(day 3)에 붙음. 그런데 미납 채무는 **2026-05** → `overrideDueDayMonth===monthStr` 정확 매칭만 보던 경과일 계산이 5월엔 원래 납부일(14일) 적용 → 5/14 기준 19일.
- **수정(유예날짜 기준 — 사용자 선택)**: override 가 미납 월과 같거나 **이후** 월에 걸려 있고 그 유예 날짜가 원래 납부일보다 **늦으면**(=채무를 뒤로 미룬 것) 유예 절대날짜 기준으로 경과일 계산. `overrideAbsDate`(override를 절대 Date로 해석) + `daysOverdueForMonth` 헬퍼.
  · [unpaid.ts](app/(app)/dashboard/unpaid.ts)(🔔알림·푸시 — computeUnpaidStatus) · [dashboard/page.tsx](app/(app)/dashboard/page.tsx)(대시보드 미수 위젯) · [rooms/actions.ts](app/(app)/rooms/actions.ts) getRoomPaymentStatus effDueDateForMonth(수납 페이지) **3곳 동기화**. 정확-월 override 는 무조건 적용(기존 동작 보존), 교차-월은 '뒤로 미루기'만(`>= origDate` 가드).
- **검증**: computeUnpaidStatus 실데이터 — 최명윤이 미납(긴급) 목록에서 빠지고(6/3 유예 < 오늘 6/2 → 미도래=납부예정), 타 미납자(이재인 2일 등) 영향 없음. tsc·build 통과. SQL 불필요.
- ⚠️ 수납 페이지는 쿠키/인증 게이트라 스크립트 런타임검증 불가 → 사용자 화면 최종 확인 권장(unpaid.ts와 동일 규칙).

### 2026-06-02 세션 6부 — 재고 보정 후속(사용자 피드백 4건)
1. **수세미 사용량 0 안 됨 → effTime 도입(overview.ts)**: 수령 즉시 자동 생성되는 점검(sourceExpenseId)이 그 구매를 이미 반영하는데, 구매를 점검 date(자정) 기준 귀속하면 같은 날 자동점검이 baseline 인데도 구매가 다음 구간에 또 입고로 더해져 사용량 부풀림(수세미: 사서 분산만 했는데 10 소모). 입고/소모 구간 경계를 date→**effTime**(입력 당일이면 createdAt, 백필이면 date — 타임라인과 동일 규칙)으로 변경. 검증: 수세미 5월 10→**0**, currentStock 10 유지. 라면 6월 26→66(6/1 입고 +40 이 자정경계로 누락됐다가 정상 계산된 것 — 개선).
2. **벌크 모달 배경 투명 → 통일(#1)**: `--surface` 미정의(투명)였음 → 다른 모달과 동일하게 `bg-[var(--cream)] border shadow-lift`.
3. **문구(#2)**: '세면'(세면대 연상) 제거 → "보충이 끝나기 전(입주자가 아직 쓰는 중)에 점검하면 …".
4. **아이템별 보정(#3)**: 한번에 전체보정은 임시저장 안 되고 미입력 픽스 우려 → **CheckForm(품목별 점검 폼)에 '전체 보정으로 기록' 체크 토글** 추가(createStockCheck isReconcile 파라미터). 품목별 점검은 드래프트 지원 → 임시저장 가능. 벌크 모달도 유지(차이 있는 품목만 저장 = 미입력 픽스 안 됨).
- tsc·build 통과.

### 2026-06-01 세션 5부 — 전체 재고 보정(총점검) 기능 구현 [SQL 적용됨, 코드 배포 대기]
[[project_inventory_full_reconcile]] 설계대로 v1 구현. 계산/입력 오차로 실제 수량과 차이 날 때 전 품목을 한 번에 보정.
- **스키마**: `StockCheck.isReconcile Boolean @default(false)` + `migrate_stock_check_reconcile.sql`(추가전용). **프로덕션 적용 완료**(idempotent ALTER), prisma generate 완료.
- **보정 점검 = 실측 리셋, 차이는 사용량 아님**: [overview.ts](app/(app)/inventory/overview.ts) 월별 사용량 루프에서 `curr.isReconcile`면 그 구간 소모 합산 skip(차이=분실·오차, 소모 아님). curr 는 다음 구간 기준선으론 그대로. lastPeriodConsumption(평균소모율)도 보정이면 제외. allChecksForUsage select 에 isReconcile 추가.
- **서버액션** [actions.ts](app/(app)/inventory/actions.ts) `saveFullReconcile({date, items[]})`: 차이 0 아닌 품목만 isReconcile 점검 생성(위치 있으면 위치별, 없으면 총량). 트랜잭션·소유권 검증. 읽기는 기존 rows 재사용(별도 액션 X).
- **타임라인**: getItemTimeline 에 isReconcile 전파 + TimelineEntry 타입 + 점검 렌더에 '보정' 뱃지/'전체 보정' 라벨.
- **UI** [InventoryClient.tsx](app/(app)/inventory/InventoryClient.tsx) `FullReconcileModal`: 헤더 '전체 재고 보정' 버튼 → 모달(날짜 DatePicker + **'창고→방 보충 완료' 체크 게이트**(통과해야 입력 활성) + 카테고리별 전 품목 위치별 실측 입력(예상치 프리필: 직전점검 위치별+현재고차이를 허브 가산) + 품목별 '예상/실측/차이' 표시 + 차이 있는 N품목만 저장).
- **E2E 검증(실데이터, 생성→측정→삭제)**: 수세미에 차이 −3 보정 점검 → isReconcile=true 면 6월 사용량 0 유지·currentStock 7 리셋 / 대조(false)면 6월 +3 소모로 잡힘. 정확히 동작. tsc·build 통과.
- **참고/한계**: 과거 달(예: 5월) 오염은 그 시점 백필 데이터 정리 or **과거 날짜로 보정 점검**(DatePicker 로 backdate 가능)해야 교정됨. 완전 2단계 '플로팅 후 끼워넣기'는 v2.

### 2026-06-01 세션 4부 — 재고 점검 '수정' 폼에서 보충 전 사라지고 창고 과차감되던 버그 (배포 `63eb124`)
사용자 보고: 수정 폼 열면 4층 주방 보충 전이 0 으로 뜸("분명 2개 입력했는데"). "이런 식으로 보충 전이 계속 사라지는 거 아냐?"
- **원인([InventoryClient.tsx](app/(app)/inventory/InventoryClient.tsx) CheckEditForm 보충 전 역산)**: `before = restocked > 0 ? qty - restocked : 0`. **보충(창고→이동) 없이 그냥 센 위치는 restockedQty=0** 이라 보충 전이 0 으로 복원됨(=사라진 것처럼). 그 상태로 저장하면 `restock = 보충후 − 0 = 보충후 전체` → 창고(허브)가 그만큼 또 차감 → 열고 저장할 때마다 누적 드리프트(자기강화 버그).
- **수정**: 조건 제거하고 항상 `before = max(0, 보충후 − restocked)` 로 역산 → 보충 없는 위치는 보충 전=보충 후 → 재저장 시 restock 0 (과차감 없음).
- **확인**: 새 점검 폼(CheckForm)은 안전(빈칸 보충 전을 null 로 처리해 과차감 방지 — actions `carryOverFromLastCheck`/null 핸들링). 원래 4층이 restock=12 로 저장됐던 건 이전에 이 버그난 수정 폼을 거치며 박힌 것으로 추정. 실데이터 현재값은 사용자가 재입력해 정상(4층 보충후12·restock10·보충전2).
- tsc·build 통과. SQL 불필요.

### 2026-06-01 세션 3부 — 재고 타임라인 정렬을 '실제 발생 시각' 단일 기준으로 (배포 `646690c`)
사용자 스샷 피드백: 라면 5/13 수령확정 15:11 인데 5/13 점검 16:46 → 흐름상 수령(+160) 먼저, 점검(207) 나중인데 타임라인엔 수령이 점검 **위(더 최신)**로 떠 거꾸로. "항상 실제 시각에 맞춰 순서가 정해져야 한다."
- **원인([actions.ts](app/(app)/inventory/actions.ts) getItemTimeline 정렬)**: 1차 정렬키가 점검=`date`(자정 00:00), 구매=`receivedAt`(시각 포함)으로 **해상도 불일치** → 같은 날 안에서 수령(15:11)이 그 뒤 점검(자정으로 취급)보다 위로.
- **수정**: 모든 entry 를 단일 `effTime`(실제 발생 시각, 시:분)으로 정렬. 구매=`receivedAt ?? date`, 점검·입수=입력 당일(KST)이면 `createdAt`(실제 점검 시각) / 과거 보정 입력(백필, createdAt 의 KST 날짜≠점검일)이면 `date`(백필이 순서 안 깨게). 동률 시 type 우선(점검>입수>구매) 유지.
- **검증**: 실데이터 라면 타임라인 — 6/01 점검 15:23 이 6/01 구매(수령 14:45) **위**로 정상화. 5/13 동일 로직. tsc·build 통과. SQL 불필요.

### 2026-06-01 세션 2부 — 재고 월별 사용량 계산 버그 (입고가 소모량으로 둔갑) fix [배포됨 `0a3ea71`]
사용자 1순위: "월별 사용량 그래프가 합계만 보이고 그 양도 틀림. 입고/이월이 소모량으로 잡히는 것 아닌지."
- **진단(스크립트로 실데이터 추적, 더스테이 제기)**: 그래프는 이미 월별 막대로 그려짐(`599d256`) — 점검 기록이 5월부터만 있어 1~4월이 0이고 5월만 거대해 "합계처럼" 보였던 것. **수치 오류는 진짜 코드 버그**:
  · 소모량 구간 계산이 구매 입고를 `createdAt`(입력시각) 기준으로 배정 → 사용자가 과거 점검을 나중에 보정 입력하면 createdAt 이 며칠~수주 밀려 인접 구간과 겹쳐 **같은 입고를 중복/오배정**.
  · 더 큰 원인: 구간 `consumed ≤ 0` 이면 **건너뛰기(skip)** 했는데, 입고로 재고가 점프한 구간(−)을 건너뛰면 그 입고분이 타이밍 차로 **다음 구간에 +로 더해져 '입고=가짜 사용량'** 으로 부풀려짐. 예) 주방세제 5/15 입고 6080 → 5/14→5/15 −3470 skip + 5/15→5/18 +6680. 라면 입고 160 → 165 소모로 둔갑.
- **수정([overview.ts](app/(app)/inventory/overview.ts))**:
  · 소모량 구간의 구매 입고 기준 `createdAt` → **`date`** 로 통일(additions 와 동일, 구간 겹침 제거). `lastPeriodConsumption`·월별 루프 양쪽.
  · 월별 루프: **음수 구간 건너뛰기 제거 → 부호 그대로 월별 합산(telescoping)** + 월 단위 합이 음수면 0 클램프. 같은 입고의 +/− 가 같은 달에서 상쇄 → 물리적 정답(시작잔량+입고−월말잔량)에 수렴. **백필된 잘못된 점검값에도 자동 면역**(인접 두 구간 +/− 상쇄).
  · `currentStock` 계산은 의도 달라(실사 후 승인 구매 제외) 그대로 둠 — 영향 없음 확인.
- **검증(before→after, 실데이터)**: 라면 5월 187→**115**(=85+입고160−130 ✓), 쌀 159→**77**(=60+입고70−53 ✓), 주방세제 6270(우연히 맞던 값 유지, =3570+6080−3380 ✓), 김치 56.5→18, 세탁세제 25→6, 키친타월 16→9. 전부 물리적 정답과 일치. `npx tsc --noEmit` 통과, `npm run build` 확인.
- **데이터 진단(코드로 자동보정 불가, 사용자 확인 필요)**: 2026-05-28 에 여러 품목 5/12 점검을 일괄 백필함. 그중 **라면 5/12 는 실시간값 49 vs 백필값 135 충돌** → dedup('최신 입력 우선')이 잘못된 135 채택(텔레스코핑이 월합은 상쇄하나 타임라인·현재고 표시엔 잔존). 그 외 같은날 충돌: 김치 5/14(10 vs 19.5), 키친타월 6/01(2 vs 14 — 최신일이라 현재고에 영향). → 화면에서 직접 검토·삭제 권장. (선택) 라면 135 정리 스크립트 별도 가능.
- ⚠️ **남은 것**: 사용자 화면 확인 후 배포(`overview.ts` 단독 변경, SQL 불필요). dedup '최신입력 우선' 규칙이 백필 오류를 선호하는 구조적 약점은 차후 검토.

### 2026-05-27 세션 (#19 할인 기간 입력 UI + #14 후속 할인 미수 3중 반영, 둘 다 배포)
- **#19 월세 할인 '일시(기간)' 입력 수정 (`332dffb`)**: `<input type="month">`가 모달 밖으로 튀어나가고
  입력 방식이 불명확하던 문제([[feedback_date_input]] 위반) → **DatePicker에 `monthOnly` 모드 추가**:
  월 뷰에서 시작, 월 클릭 시 `'YYYY-MM-01'` 반환·닫힘, 표시는 연·월만, 월 뷰에 초기화(무기한) 버튼.
  RoomsClient 할인폼은 scope 셀렉트 전체폭 분리 + 기간 피커를 그 아래 전체폭 행으로 스택(오버플로 해소).
  discStart/discEnd는 'YYYY-MM' 유지 → 피커엔 `+'-01'`/`slice(0,7)`로 변환. (스키마-프리)
- **#14 후속 — 할인을 발생주의 3곳 전부에 반영 (`52b881d`)**: 지금까지 할인은 수납 페이지(getRoomPaymentStatus)
  에만 반영됐고 대시보드·푸시는 정가로 계산해, **할인 입주자가 완납해도 영구 미납으로 잡혀 매일 푸시가 가던** 문제 해결.
  · `dashboard/page.tsx`: 수납현황 위젯(완납 판정·예상 수입)=이달 할인가(billThisMonth), 발생주의 미수 블록=월별
    billForMonth(=discountedRent)로 총예상·FIFO충당·도래/미도래 분리 전부. activeLeases·unpaidLeasesRaw에 discounts select.
  · `dashboard/unpaid.ts`(푸시 cron): 동일하게 billForMonth — 대시보드 건수와 일치 유지.
  · 세 곳 모두 단위테스트된 `lib/rentDiscount.discountedRent` 단일 헬퍼. **할인 없는 계약은 동작 불변**(billForMonth===rentAmount, /tmp 시뮬 검증).
- 검증: `npm run build` 통과. ⚠️ 실데이터(할인 적용 입주자)에서 대시보드 미수납·수납현황·다음날 푸시 일치 최종 확인 권장.
- **#20 재고 점검 '수정' 모달 창고(허브) 처리 일치 + '창고→' 이동 용어 (`074580a`)**: 사용자 캡처 — 수정
  모달에서 **창고(허브) '보충 전'이 0**으로 뜨고 창고 '보충 후'를 직접 입력해야 했음. "보충 +5"가 신규 구매처럼 읽힘.
  · 원인: 수정 모달(CheckEditForm)이 창고를 일반 위치와 동일하게 보충전/후로 다뤄 저장된 `restockedQty`에서 '전'을
    역산 → 창고는 차감되는 쪽이라 restockedQty 없음 → 빈칸(0). 새 점검 모달(CheckForm)은 이미 올바르게 처리 중이었음.
  · 수정: 수정 모달 창고 행을 새 점검 모달과 동일하게 — **이전 잔량**(= 저장된 창고잔량 + 이 점검의 원래 보충합계로
    역산, 캡처 기준 120+15=135) 표시 + **자동 차감 후** 자동계산(직접 입력 불필요, 보정은 가능). 총량 보존.
  · 용어(사용자 결정 — "창고 →" + 보충 라벨 유지): 위치 증가 배지 "보충 +N"→**"창고 → +N"**, 합계 "보충 합계"→
    **"창고 → 이동 합계"**. CheckForm·CheckEditForm·LocationBatchCheckModal·점검 이력 카드 전반 통일. 입력칸 '보충 전/후' 라벨 유지.
  · 빌드 통과. ⚠️ 실데이터 점검 수정 시퀀스(특히 연속 위치점검 머지)에서 창고 이전/차감 표시 최종 확인 권장.
- **작은 후속 정리 (사용자 "작은 후속부터 정리" 선택):**
  · **#1 후속 — 고정지출 관리폼 세부항목 직접 편집 (`811a35d`)**: 서버(items 파라미터)는 이미 준비됐고 settings 폼에
    UI만 없었음 → 세부항목 추가/이름·금액·변동 편집/삭제 UI 추가. 항목 있으면 부모 금액=합계·변동=자동파생(금액칸은 합계
    표시, 변동 체크박스 자동·비활성). 다 지우면 items:[]로 단순지출 복귀(수동금액 유지). 목록에 '묶음 N' 배지·세부요약.
    서버 semantics: items 배열=교체+파생, []=클리어(amount 수동값), undefined=미변경. 저장 후 getRecurringExpenses 재조회.
  · **재고 이월분 정확도 (`fea5c4d`)**: 직전 월 마지막 점검 잔량만 보이던 '이월분'에 **점검 이후~월초 입수**(구매수령·무상)
    합산. 변환은 월별입수(actions.ts)와 동일(구매=qtyValue×spec, 무상=addedQty). '점검 100 + 입수 50 / 잔량 150'처럼
    내역 표시(추정 근거 투명). 점검↔월초 소모는 데이터로 알 수 없어 미반영(본질적 추정). 표시 전용.

### 2026-05-26 운영 피드백 마라톤 (#1~#18, 전부 배포 또는 병합 완료)
사용자가 실사용 중 연속으로 던진 18건. 스키마-프리는 main 즉시 배포, 스키마성 3건은 통합 브랜치
`feat/schema-batch`에 모아 SQL 일괄 적용 후 main 병합(`640e296`). **SQL 3개 프로덕션 적용 완료**
(recurring_expense_items, lease_terms.signatureImageUrl, rent_discounts + expenses.breakdownJson).

**main 배포 (커밋)**
- #2·#4·#5·#6·#7 (`89c2bf3`): 고정지출 기록 버튼 명확화 / 위치점검 창닫힘 / 수납 납부방법 입주자별 /
  고정지출 지난달 방식·계좌 / '이번 달 기록 취소' 라벨.
- #9 (`7a941f7`): 하단바 6탭(홈/방/입주자/수납/지출/재고)+전체. 모바일 '전체' 전체화면 그리드 메뉴.
- #10 (`5deedd7`): 🔔 알림 클릭 딥링크 이동(/tenants?tenantId 등) + localStorage 날짜별 읽음처리·'모두 확인'.
  (원인: 종이 EntityModalProvider 밖이라 useEntityModal no-op)
- #11 (`6c212d2`): 보증금 수납 시 입력금액이 보증금액으로 덮어써져 월세 누락 → 보증금+이용료 전체 프리필.
- #12 (`8cfa9c8`): 방 관리 예약가격 '즉시 적용' 미반영 → rooms useState(initialRooms) 캡처 제거(prop 직접).
- #13 (`188b51d`): 공실 카드 표시정보 선택(창문/방향/층 등, 모바일 칩 최대4) + 방향 옵션 추가.
- #15·#16 (`aab543f`): 체크리스트 → 스테이음 Lab 이동·대시보드 알림 제거 / '지금 급함'→'긴급'.
- #17 (`311d36c`): 재고 알림 단위 박스→kg(specUnit) + 라벨 '입주자 관리'→'재고 관리에서 보기'.
- #18 (`acb593e`): 안드로이드 뒤로가기 반복 로그아웃 완화 — /callback 재진입 가드(이미 인증이면 code 재교환 skip)
  + 로그인 후 window.location.replace. ⚠️ Android 실기기 테스트 필요(잔존 시 refresh-token 회전 레이스 의심).
- #3 (`6f6ae07`): 위치별 재고 점검 허브 과다차감 — 클라가 stale props로 계산하던 것을 서버권위로 전환.
  lib/stockCheckMerge.ts applyLocationCheck(단위테스트). create/updateStockCheck에 locationPatch 모드
  (DB 현재/직전 잔량 base) + 머지 시 시각 갱신. ⚠️ 실데이터 점검 시퀀스 검증 권장.

**스키마 3건 (`feat/schema-batch`→main `640e296`)**
- #8 계약서 출력 서명: LeaseTerm.signatureImageUrl — 서명 시 dataURL 저장, getContractData 반환,
  ContractView 초기값 로드 → 재출력 시 서명 표시.
- #1 관리비 부모+세부항목: RecurringExpenseItem + Expense.breakdownJson. 묶기 UI(기존 항목→부모 전환),
  기록 모달 세부항목(변동 편집)·합계, 지출 상세 breakdown. (남은 것: 관리폼에서 부모 세부항목 직접 편집 — 후속)
- #14 월세 할인: RentDiscount(입주자별·여러개·금액/%·영구/일시). lib/rentDiscount.ts(단위테스트 10/10).
  **수납 관리 미수에 완전 반영**(getRoomPaymentStatus expected·이월·firstUnpaid 월별 할인). 수납 모달 할인 관리 UI.

**남은 것 (검증/후속)**
- ~~#14 후속: 대시보드 미수납 위젯 + 푸시 미수에 할인 미반영~~ → ✅ **완료 (2026-05-27, `52b881d`)** — 위 세션 참고.
- 사용자 라이브 검증 대기: #1 묶기·기록 / #8 계약서 서명 / #14 할인 미수(수납+대시보드+푸시) / #3 재고 점검 시퀀스 / #18 Android.
- #12 보충: 509호처럼 '이미 공실'인데 예약인상이 안 걸린 경우는 즉시적용 버튼으로 처리(즉시적용 자체는 #12로 수정됨).

### 2026-05-26 세션 2부 (운영 피드백 수정 — 고정지출·수납·재고, main `89c2bf3` 배포됨)
사용자 운영 중 발견 버그 7건 중 **명확·저위험 5건 처리·배포**. #3(재고)·#1(재설계)은 아래 '할 일'에 설계/계획 남김.
- **#4 재고 위치별 점검 최종저장 후 창 안 닫힘**: `LocationBatchCheckModal.doSave` 성공 후 `onClose()` 호출 추가.
- **#5 수납 납부방법 입주자별**: 기존엔 localStorage 전역("마지막 쓴 방법", 입주자 무관)이었음 → `getPaymentsByLease`가
  `lastPayMethod`(해당 lease 최근 납부방법) 반환, 모달 열 때 그 값으로 기본 세팅. select에 `key`(lease+method)로 fetch 도착 반영.
  RoomsClient·DashboardClient 둘 다.
- **#6 고정지출 기록 시 지난달 방식·계좌 자동 대기**: `getRecurringExpensesWithStatus`에 `lastPayMethod`/`lastFinancialAccountId`
  (가장 최근 실제 기록 Expense 기준) 추가 → 기록 모달 기본값으로(템플릿값 대신 우선).
- **#2 고정지출 기록 버튼 명확화**: '기록 저장'→'지출로 기록 (정산 완료)', '예약 저장'→'💾 금액만 저장 (정산 안 함 · 나중에 납부)'
  + 안내문. (사용자가 '기록 저장'을 금액만 저장으로 오해 → 정산돼버린 문제.)
- **#7 고정지출 기록 취소 ≠ 항목 삭제**: 지출 상세에서 `recurringExpenseId` 있으면 삭제 버튼 라벨 '이번 달 기록 취소' +
  확인 문구로 "고정지출 항목 자체는 유지" 명시. (handleDeleteExp가 Expense 객체 받도록 변경.)
- 검증: 빌드 통과, 신규 5건 lint 클린(기존 무관 에러만 잔존). UI 시각확인은 iCloud dev 한계로 실기기 권장.

### 2026-05-26 세션 (대시보드 알림 긴급/예정 2존, 배포됨)
- **대시보드 알림 긴급/예정 2존** (main `7e2fb77`, 배포됨): 알림이 고정 카테고리 순서라 급한 걸 놓치는 문제 해결(L 완료).
  · 사용자 선택: UX=긴급/예정 2존, 긴급기준=경과(음수) or D-2 이내(appConfig `ALERT_URGENT_WITHIN_DAYS=2`).
  · **'지금 급함'** 존 — urgencyDays ≤ 2 항목을 카테고리 무관 최상단·긴급순·항상 펼침. **'예정'** — 나머지 카테고리 그룹, 기본 접힘.
  · urgencyDays는 **클라에서 timeLabel 파싱**(urgencyDaysOf)으로 도출 → page.tsx(1900줄 금융 빌더) 미수정, 리스크 최소.
  · DashboardClient AlertsStrip만 변경(+ AlertRow 추출). 종(L-2)은 numeric urgency로 이미 정렬돼 별개. (상세: 할 일 L)
  · 검증: 빌드 통과, urgencyDaysOf 단위테스트 18/18. 2존 시각확인은 iCloud dev 한계로 실기기 권장.

### 2026-05-25 세션 (레이아웃 마무리 + 인앱 알림센터, 둘 다 배포됨)
- **월 셀렉터를 페이지 콘텐츠 상단으로 이동** (main `d948453`, 배포됨): 헤더 스위처 옆 월 네비(◀5월▶)가
  복잡해 보여 각 월-페이지 콘텐츠 상단 우측으로 분리. 헤더는 `[좌] 스위처 … [우] 🔔`로 단순화.
  · MonthSelector(신규, 보이는 컨트롤) + MonthSync(신규, 안 보이는 자동 새로고침 effect 3개, 셸 상주) +
    NavigationContext(신규, AppShell useTransition을 페이지로 공급) 로 ①컨트롤/②자동새로고침 분리.
  · Header에서 월 UI·effect·MonthPicker·MONTH_PAGES 전부 제거. 배치는 ?month 실사용처(dashboard·rooms·finance)만
    — report는 자체 연도 셀렉터, stats는 redirect라 제외. (상세: 할 일 M Phase 1-3)
- **🔔 인앱 알림센터** (main `2138242`, 배포됨): 헤더 종 placeholder → 실제 알림센터. "오늘 챙길 일"
  (미납·오늘 퇴실/투어/입주·재고 소진·수령 대기)을 드롭다운 목록으로, 클릭 시 입주자=EntityModal 제자리·재고=/inventory.
  · **computeAlerts(propertyId) 단일 소스**(app/(app)/dashboard/alerts.ts) — cron(푸시)+종이 공유 → 뱃지 일치.
    cron 리팩터(인라인 countAlerts 제거), getMyAlerts() 서버액션, NotificationBell(신규). (상세: 할 일 L-2)
  · 런타임 검증: 실제 DB로 무에러 완주, 당일 정책 정상(오늘 0건 = 원천 대조 확인). 종 시각확인은 실기기 권장.
- ⚠️ 이 환경 한계 확인: **iCloud Drive라 dev 서버가 상시 Fast Refresh 스래싱** → dev 인터랙티브(클릭→팝오버/드롭다운)
  검증 불가. SSR 스크린샷·서버 런타임은 OK. (메모리 reference_gui_verify 갱신)

### 2026-05-23 세션 (2부 — 푸시 알림·정리·계약서)
- **#5 계약서 통합 페이지 (/contracts)** (feat/contracts-page, 배포 예정): 영업장 전체 계약서를 한곳에서.
  · contracts/actions.ts getAllContractFiles(전체 + 입주자·호실·상태 조인), page.tsx → ContractsClient
    (검색 이름·호실·파일명 / 출처 필터 전체·앱서명·스캔 / 정렬 최신순·입실자별 / 보기(Drive)·삭제 / 입주자 클릭→통합 모달).
  · Sidebar 운영 그룹 '계약서'(IcoContract) 메뉴. 삭제는 tenants deleteContractFile 재사용.
- **푸시 알림 2차 (Vercel Cron 실제 알림)** (feat/push-cron, 배포 예정): 매일 09:00 KST(00:00 UTC) Cron이
  구독 사용자별로 영업장 알림을 web-push 발송 + 뱃지 갱신.
  · app/api/cron/push-alerts/route.ts — CRON_SECRET 인증(Authorization: Bearer, ?secret= 도 허용),
    구독자→영업장(owned+roles) 해소 → countAlerts(영업장,윈도우) 합산 → total>0이면 1건 push("오늘 챙길 일 N건").
  · 알림: 퇴실예정(CHECKOUT_PENDING·expectedMoveOut)·투어예정(WAITING_TOUR·tourDate)·입주예정(RESERVED·moveInDate)·
    수령대기(미수령 tracked 지출) + 재고 소진 임박(computeInventoryOverview 재사용). 윈도우 = appConfig 7일전~30일후.
  · vercel.json crons + CRON_SECRET env(prod/dev) 등록. 만료 구독(410/404) 자동 정리.
  · 재고소진은 inventory/overview.ts(비-server 모듈)로 compute 안전 추출해 cron이 재사용.
  · ⏳ v2b 남은 것: 납부예정(발생주의 getRoomPaymentStatus) — 동일 추출 후 연결, 금융 정확성 런타임 검증 필요.
  · 테스트: 배포 후 `GET /api/cron/push-alerts?secret=<CRON_SECRET>` 로 수동 실행 가능(구독·알림 없으면 sent:0).
- **푸시 알림 1차 (PWA Web Push + 홈화면 뱃지)** (2c32170): 설정→'알림(푸시)'에서 알림 받기/끄기/테스트.
  · public/sw.js(push→showNotification+setAppBadge, notificationclick→딥링크), PushSubscription 모델 +
    migrate_push_subscriptions.sql(프로덕션 적용 완료), settings/pushActions(save/delete/sendTestPush, web-push),
    settings/PushToggle(권한·구독·테스트), next.config serverExternalPackages에 web-push.
  · VAPID 키: .env.local + Vercel env(prod/dev) 등록(NEXT_PUBLIC_VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT).
  · iOS는 홈화면 설치 PWA에서만(16.4+), 권한 1회 허용 필요. 사용자 폰 테스트 미완(차차).
  · 2차(Cron 실제 알림)는 할 일 K 참조.
- **고객 폼 입주희망일 위치 개선 + 통합모달 죽은코드 정리** (feat/quick-polish, 배포 예정):
  · TenantForm: 입주 희망일을 청소비 행 → 상태 클러스터(상태 바로 아래)로. roomIsOptional(투어/예약/취소)이면
    클러스터에 '입주 희망일', 거주단계면 청소비 행에 '입주일'(상호배타 렌더, name=moveInDate 중복 없음).
  · 통합 EntityModal 도입 후 안 쓰이게 된 죽은 서브모달 제거: RoomsClient(TenantInfoModal/RoomInfoModal/
    InfoCol/STATUS_LABEL_RC 꼬리 truncate), RoomManageClient(RoomMgr*Modal/RmInfoCol/STATUS_LABEL_RM 꼬리 truncate),
    TenantClient(SettlementInfoModal/RoomInfoSimpleModal 중간블록 삭제) + 죽은 state·렌더·import 정리.
  · 동작 변화 없음(죽은 코드만 제거). 빌드·정적생성 통과.

### 2026-05-23 세션 1부 (9건, 전부 배포·정상)
- **점검 임시저장(드래프트) UI** (4f72b91): 백엔드(#2 StockCheckDraft)에 UI 연결 — 아이템별/위치별
  점검에 임시저장 버튼·복원·'점검 중' 배지·완료 시 자동 삭제.
- **임시저장 cross-mode 공유** (835c2b7): 아이템별↔위치별 드래프트 상호 반영(savedAt 우선 병합),
  완료/비우기 시 정리. getLocationDrafts 병합 + deleteItemDrafts.
- **재고관리 토글 위치 고정** (b0f6a87): 아이템별/위치별 토글을 제목 옆 우측 상단 고정(모드 전환 점프 방지),
  액션 버튼은 아래 별도 줄.
- **재고 상세 타임라인 월별 끊기** (843f793): 전역 월(?month=) 기준 그 달만 표시. 컷오프 — 점검·무상입수=날짜,
  구매=수령확정(receivedAt, 미수령은 현재 월 이월). 매월 1일자 '이월분' 줄 + 타임라인 월 네비.
- **영수증→재고 병합 확인 기능** (36fe44b): 자동등록 시 라벨 변형 카드 난립 해결. 별칭(LINK)+유사라벨
  후보 제시 → 확인 후 병합(조용히 흡수 X). MergeDecisionModal + MergeRulesModal(거절 되돌리기) + '병합 규칙'
  버튼. TrackedItemMergeRule 모델·마이그레이션 적용됨. (상세: memory project_merge_confirm)
- **고객 명시적 상태 전환** (00afefd): 상세 모달 상단에 상태별 '다음 단계' 버튼(투어완료·예약전환·입실처리·
  퇴실예정·퇴실·비거주/거주전환·입실취소) + 필요값만 묻는 미니폼 → applyStatusTransition(호실·이력 자동,
  퇴실 시 보증금 환불 동시).
- **고객 폼 동적 배치** (00afefd): 연락처를 기본정보 뒤로(이름→연락처 인접), 상태별 단계정보(문의일시·
  투어예정일·예약확정)를 상태 선택 바로 아래로 클러스터링.
- **호실·고객·수납 통합 상세 모달 1·2단계** (56bfbda, 917414f): 전역 공유 모달(components/entity-modal)
  — 어느 페이지든 배경 유지한 채 [호실][고객][수납] 제자리 넘나듦. 수납 뷰에 이번 달 납부 내역(읽기).
  (상세·2b 명세: memory project_entity_modal)
- **Vercel 일시 빌드오류 복구**: 1:30am 배포가 'modifyConfig' 단계에서 일시 실패 → 재배포로 정상화
  (코드 문제 아님, 빌드 캐시/플랫폼 일시 오류).

### 이전 세션 (요약)
- **리브랜딩 1~4단계 완료** (~2026-05-22): Terracotta 팔레트·Arch 로고/파비콘·BrandLoader, 컴포넌트 정합
  (버튼 73개 공유 Btn화, 입력 6px·터치타겟 44px·카드 14px·그림자 shadow-lift·backdrop black/70). 검증 완료.
- **재고 점검 시스템 정비** (2026-05-19~21): 아이템별/위치별 점검, 보충 전·후 입력, 허브 자동 차감,
  '보충 전' 미입력 버그 수정.
- **#4 요청·컴플레인 통합 페이지** 재구현 완료.
- **이메일/인증 인프라** (2026-05-18): stayeum.com 도메인·SSL, Resend 발송·도메인 인증, Supabase 커스텀 SMTP,
  인증 메일 템플릿 5종, 회원가입 폼 개선, 308 리다이렉트.
- **성능** (2026-05-18): 풀스크린 스플래시 제거(경량 스피너+상단 진행바), getClaims 인증, Vercel 리전 서울(icn1).
- 도면 편집기, 재무, 고객/입주자 관리, M7 디자인 시스템 등 — git log 참고.

---

## 할 일 (남은 것)

### ★ 신규 요청 배치 (2026-05-28 사용자) — 1차 완료, 2·3차 남음

**✅ 1차 완료 (코드·로컬, 푸시 전 SQL 적용 필요):**
- **#2 재고 점검 '유지' 버튼** — `app/(app)/inventory/InventoryClient.tsx` 3폼(CheckForm·CheckEditForm·LocationBatchCheckModal) 비허브 행 헤더에 작은 '유지' 버튼 추가. 클릭 → 보충 후 = 보충 전(or 이전 잔량) 자동 채움. LocationBatchCheckModal은 허브 케이스도 잔량 = prev로 채움. [[project_inventory_check_consistency]] 통일 준수.
- **#1e 재고 구매 링크** — `TrackedItem.purchaseUrl String?` 신규(스키마+`migrate_tracked_item_purchase_url.sql` 추가전용). constants/overview/actions 전파, SettingsForm 입력칸 추가(발주 메모 아래), 인벤토리 카드에 '구매 페이지 열기' 외부링크 버튼(외부링크 아이콘+target=_blank+stopPropagation). 향후 제휴 링크 수익모델 활용 여지.
- 빌드·새 코드 lint 클린. ⚠️ **푸시 전 SQL 적용 필요**: `migrate_tracked_item_purchase_url.sql` (ALTER TABLE tracked_items ADD COLUMN IF NOT EXISTS "purchaseUrl" TEXT). SQL 없이 배포하면 인벤토리 페이지 Prisma 쿼리 실패.

**✅ 2차 완료 (코드·로컬, 푸시 전 SQL 적용 필요):**
- **#1c 환경설정 "등급" 옵션 + #1d 호실관리 등급 필터** — 용어 = **"등급"** (DB: `Room.tier`/`Property.roomTierOptions`).
  · 스키마: `Property.roomTierOptions String?` + `Room.tier String?` + `migrate_room_tier.sql` 추가 전용.
  · 환경설정 백엔드: `getRoomTierOptions·addRoomTierOption·deleteRoomTierOption` + 제네릭 `ReorderableField` 에 `'roomTierOptions'` 등록(rename·reorder·reset·revalidate 자동 합류). 기본값 `'스탠다드,실속형'`.
  · 환경설정 UI(`SettingsForm.tsx`): 방타입 OptionSection 바로 아래 **'등급 관리'** OptionSection 추가(설명·placeholder 별도).
  · 호실관리 페이지: `getRoomTierOptions()` fetch 추가 → `RoomManageClient`에 `roomTiers` prop 전파.
  · `room-manage/actions.ts`: `addRoom`/`updateRoom`이 `tier` 폼필드 읽어 저장, `batchUpdateRooms` data 타입에 `tier?` 추가.
  · `RoomManageClient.tsx`: ① Room 타입에 `tier` 추가, ② `filterTier` 상태·리셋·activeCount·필터로직 동기화, ③ 필터 UI에 등급 드롭다운(방 타입 옆), ④ `TierSection` 컴포넌트(등록·수정 폼 둘 다), ⑤ 카드에 등급 칩 표시, ⑥ 상세 모달에 등급 DetailRow, ⑦ `BatchEditRoomsModal`에 등급 미변경/선택 chip 그룹 + state + apply 합류.
- 빌드 통과. ⚠️ **푸시 전 SQL 적용 필요**: `migrate_room_tier.sql` (ALTER TABLE properties/rooms ADD COLUMN). 없이 푸시하면 환경설정·호실관리 페이지 Prisma 쿼리 실패.

**✅ 3차 완료 (코드, SQL 불필요 — 스키마 변경 없음):**
- **#1a + #1b 대시보드 다차원 그룹화** — 사용자 의도는 *기존 '방 현황' 호실 카드의 묶음 단위를 차원 조합으로 바꾸는 것*이었음(개별 통계 위젯 X). 1차 시도 별도 RoomDistribution 위젯은 의도 오해 → 폐기·재작업.
  · **재작업(2026-05-28)**: 별도 위젯 제거(`RoomDistribution.tsx` 삭제, import 제거). 기존 **방 현황 그리드 헤더 아래에 차원 칩 5개**(층·등급·창문·방향·방타입). 다중 선택 + **순서 보존**(앞=상위 묶음). 디폴트 [층] = 기존 동작 유지. 선택 상태 localStorage 보존.
  · 그룹화 = 선택 차원 값들의 카르테시안 곱(빈 그룹 자동 숨김). 라벨은 ' · ' 조인(예: "4층 · 스탠다드"). 정렬은 차원 순서대로 dim별 sortKey 적용(층=숫자, 그 외=사전순, '미지정'은 뒤).
  · 각 그룹 안엔 기존 호실 카드(renderCell) 그대로(상태색·이름·이용료). 차원 0개 선택 시 헤더 없이 한 덩어리(전체) 표시.
  · dashboard/page.tsx rooms select에 `tier:true` + roomsData map에 `tier` 추가(2차 SQL 의존 — `rooms.tier` 컬럼 필요). DashboardData.rooms 타입에 `tier`.
- 빌드 통과. **SQL 변경 없음** (2차 `rooms.tier` 컬럼은 별도 — 이미 필수).

**남은 작업:**
   - 환경설정에 옵션 등록(roomTypeOptions 패턴 미러링: `Property.roomTierOptions` 같은 콤마구분 컬럼 추가).
   - `Room.tier` 필드 신규 + 마이그레이션 SQL.
   - 호실관리에 이 타입 **필터** 추가.
   - **대시보드에 층별 + 타입조합 그룹화 표시** — 예: "4층 + 내창 + 스탠다드", "내창 + 실속형 + 북향" 등 사용자가 차원 조합(층·창문·등급·방향)을 골라 그룹별 카드/숫자로 표시. UX는 다차원 그룹 빌더(드롭다운/칩 다중선택) 형태로 설계 합의 필요.
2. **(재고 구매 링크)** — `TrackedItem.purchaseUrl` 필드 추가 + 인벤토리 카드에서 새 탭으로 바로 열기(target=_blank rel=noopener). 향후 수익모델(아마존 어소시에이트·쿠팡 파트너스 등 제휴 링크) 활용 여지.
3. **(재고 점검 '유지' 버튼)** — 점검 시 보충 전 그대로 유지하는 케이스가 많음 → 보충 후=보충 전을 한 클릭으로 채우는 버튼. 3폼([[project_inventory_check_consistency]] — CheckForm·CheckEditForm·LocationBatchCheckModal) 동기화 필수.

### ★ 운영 피드백 후속 (2026-05-26 — 사용자 확인 대기)

#### ✅ #3. 재고 점검 허브 자동 차감 과다 (위치별 연속 점검 시) — 완료·배포 (`6f6ae07` + `074580a`), 라이브 검증만 대기
> ✅ **해결(2026-05-26~27)**: 클라 stale-props 계산 → **서버 권위**로 전환(`6f6ae07`, `lib/stockCheckMerge.ts applyLocationCheck` 단위테스트) + 수정모달 창고 처리 일치(`074580a`). 아래는 당시 분석 기록(보존). **남은 건 사용자 실데이터 점검 시퀀스 최종 확인뿐.**
- **증상**: 5/22 잔량 155(창고135·4층10·5층10)에서, 5/26 4층 +5 보충·5층 +10 보충 + 실측(4층9·5층11) 하면
  **기대 최종 140**(창고 120+9+11)인데 **135**로 나옴(과다 차감). 또 두 위치 보충이 한 기록에 같이 안 보이고 점검시각도 09:23 고정.
- **원인**: `InventoryClient.tsx` LocationBatchCheckModal `doSave`(1894~)가 허브 차감·타위치 이월을 **props의
  `r.lastCheckLocationBreakdown`(직전 점검값)** 으로 계산. 6h 내 연속 위치점검을 머지(updateStockCheck)할 때 이 값이
  stale하면 앞 점검을 덮어쓰고 허브를 잘못된 기준에서 다시 빼서 과다 차감. (서버 액션 createStockCheck/updateStockCheck는
  받은 locationQtys를 그대로 저장만 함 — 허브 차감이 UI 계산이라 staleness에 취약. actions.ts:452 주석 참고.)
- **수정 방향(예정)**: 허브 차감·이월을 **서버에서 현재 persisted 상태 기준으로 트랜잭션 내 계산**하도록 이전(또는
  클라가 머지 직전 최신 breakdown 재조회). + 머지 시 두 위치 보충 누적 표시 + **점검 시각을 마지막 점검 시각으로 갱신**.
- **검증 제약**: 프로덕션 재고 데이터를 변경(쓰기)하며 테스트할 수 없음 → **계산 로직을 순수함수로 추출해 단위테스트**로
  검증 + **사용자 실제 점검 시퀀스로 최종 확인** 후 배포. (착수 전 이 방식 OK인지 확인)

#### ✅ #1. 고정지출 '관리비' 부모 + 세부항목 재설계 — 완료·배포 (스키마 `640e296` + 후속 `811a35d`), 라이브 검증만 대기
- **맥락**: 관리비를 청소관리비·공용전기비·공과금(기타)·전기안전검사·상하수도요금 등 여러 고정지출로 따로 등록 중.
  한 번에 납부(고지서 1장)인데 영수증을 지출 수정 화면에서 첨부 → 번거로움. "임대관리비 부모 1건 + 세부항목(고정/변동 혼재)".
- **확정 설계(2026-05-26 사용자 답)**:
  ① 장부엔 **관리비 1줄(합계)** + 그 안에 세부항목 내역. ② 세부항목별 고정/변동: **수도요금=변동, 나머지=고정** → 합계는 변동.
  ③ 기존 고정지출을 **'묶기' UI로 선택→부모로 전환**(마이그레이션). ④ 영수증은 그 1줄(Expense)에 첨부.
- **구현 완료(main 병합·배포됨 — 스키마배치 `640e296` + 후속 `811a35d`, 구 작업브랜치 `feat/recurring-expense-items` 병합 완료)**:
  · ✅ 스키마: `RecurringExpenseItem{ recurringExpenseId, name, amount, isVariable, sortOrder }` + `Expense.breakdownJson` + `RecurringExpense.items`.
    `migrate_recurring_expense_items.sql` **프로덕션 적용 완료**. `prisma generate` 완료.
  · ✅ 서버: `getRecurringExpensesWithStatus` items 포함, `recordRecurringExpense` breakdown 받아 합계 기록+breakdownJson.
  · ✅ UI 전부 완료: settings `RecurringExpenseRow.items` + add/update items 수용 + **`groupRecurringExpenses`(묶기)** +
    고정지출 관리 모달 **세부항목 직접 편집**(`811a35d`, 5/27) + 기록 모달 변동항목 금액 편집·합계 + 지출 상세 breakdown 표시.
- **배포 순서(완료)**: SQL 3건은 프로덕션 적용 완료 → 코드 main 병합·배포 완료(`640e296`·`811a35d`). 더 이상 미배포 브랜치 없음.
- **⚠️ 남은 것 = 라이브 검증뿐**: 재무 데이터라 iCloud dev 런타임 검증 불가 → 기록 합계·breakdown·묶기는 **사용자와 함께 실데이터로 확인** 후 신뢰.
- 메모리: 금융 정확성 민감([[project_push_alert_policy]]).

### A. 우선순위 높음 — 운영자(슈퍼관리자) 대시보드 + 베타 접근 관리 ✅ 코드 완료(2026-05-27, 로컬·미푸시) — 활성화 대기
- 앱 안 운영자 전용 영역(/admin 또는 (admin) 그룹). 슈퍼관리자 역할 신규 필요(현재는 영업장 단위 UserPropertyRole만).
- 담을 것: 전체 가입자 조회(실명·이메일·전화·주소), 가입 승인/거절, 영업장 현황·통계.
- 베타 게이팅(당장 필요 — 제한된 테스터만): 가입해도 운영자 승인해야 기능 해제. 쿠폰·초대 코드(선착순 N명 무료).
- 결제·구독(PG)은 추후(쿠폰·승인이 임시 운영 수단): 포트원·토스페이먼츠, 플랜·7일 체험·쿠폰·웹훅·기능 게이팅.

**확정 설계(2026-05-27 사용자 답):** ① 운영자 식별 = **env `SUPER_ADMIN_EMAILS`(부트스트랩·잠김방지) + `User.isSuperAdmin`(DB)** 병행.
② 1차 범위 = **초대코드/쿠폰까지** 포함. ③ 신규 가입 = **전부 PENDING(승인 대기)**, 기존 사용자는 마이그레이션에서 APPROVED 백필.

**스키마 변경(추가 전용):** `enum AccessStatus{PENDING/APPROVED/REJECTED}`, `User.{status(@default PENDING)·isSuperAdmin·approvedAt·approvedBy·inviteCode}`,
`InviteCode{code·note·maxUses·usedCount·autoApprove·isActive·expiresAt·createdBy}`. → **`migrate_admin_beta_gating.sql`**(루트, 추가전용+기존 APPROVED 백필).
⚠️ **배포 순서**: SQL 먼저 적용 → 코드 배포(신규 컬럼/테이블 사용, #1과 동일 제약). 현재 로컬만, 미푸시(다음 작업과 묶어 푸시 예정).

**✅ 체크포인트 1 — 토대 완료(빌드·lint 통과):**
  · schema.prisma 변경 + `prisma generate` 완료. `migrate_admin_beta_gating.sql` 작성.
  · **`lib/auth/access.ts`(신규)**: `isSuperAdminEmail()`(env), `getAccessContext()`(claims+DB, 슈퍼관리자는 status 무관 APPROVED 간주), `requireSuperAdmin()` 가드.
  · **게이트**: `app/(app)/layout.tsx` — claims 확인 직후 `me.status!==APPROVED && !isSuperAdmin → redirect('/pending')`. 앱 전체 단일 게이트.
  · **`app/pending/page.tsx`(신규)**: 승인 대기/거절 안내(브랜드 StayeumWordmark·Terracotta), 로그아웃. 승인됨/운영자면 /dashboard 리다이렉트.
**✅ 체크포인트 2 — 운영자 영역(`app/admin/`, (app) 셸 밖·자체 `requireSuperAdmin()` 가드):**
  · `app/admin/layout.tsx`(헤더+`AdminNav` 탭: 가입자/영업장/초대코드, '앱으로→' 링크) · `app/admin/page.tsx`(→ /admin/users 리다이렉트).
  · **가입자**(`users/page.tsx`+`UsersClient.tsx`): 실명·이메일·전화·주소·상태·가입일·소유/참여수 목록 + 상태필터(기본 '승인 대기') + **승인/거절/대기로** + **운영자 지정/해제**(본인 제외). `actions.getSignups·setUserStatus·setSuperAdmin`.
  · **영업장**(`properties/page.tsx`): 전체 Property + 소유자·방수·입주자수·구성원수·개설일 + 총계. `getPropertiesOverview`.
**✅ 체크포인트 3 — 초대코드/쿠폰:**
  · 운영자(`invites/page.tsx`+`InvitesClient.tsx`): 코드 발급(코드 비우면 STAY-XXXXXX 자동생성)·메모·사용인원(0=무제한)·만료일(**DatePicker**, [[feedback_date_input]] 준수)·자동승인 토글, 목록·활성화/비활성·삭제. `getInviteCodes·createInviteCode·toggleInviteCode·deleteInviteCode`.
  · 가입 연동: `EmailLoginForm` 회원가입에 **초대코드 입력칸** + signUp `options.data`에 real_name·phone·address·invite_code 적재(이메일 인증 ON이면 signUp 직후 세션 없음 → 첫 로그인 때 `syncUserToDB`가 user_metadata에서 회수). `syncUserToDB`에 `redeemInviteCode`(트랜잭션, 선착순 usedCount<maxUses·미만료·active·autoApprove면 status=APPROVED). ⚠️ **Google OAuth 가입은 코드 입력 없음 → PENDING(수동 승인)**.
**✅ 체크포인트 4 — Sidebar 진입점:** layout→AppShell→Sidebar로 `isSuperAdmin` 전달 → 계정 섹션(데스크톱 NavContent + 모바일 MobileMenu)에 슈퍼관리자만 보이는 '운영자'(/admin) 링크.
- **검증**: `npm run build` 성공(/admin·/admin/users·/admin/properties·/admin/invites·/pending 생성), 신규/변경 파일 ESLint 클린(Sidebar의 IcoLab·<img> 경고는 기존). GUI 인터랙티브는 iCloud dev 한계로 실기기/프로덕션 권장.

**⚠️ 활성화에 필요(배포 전/시):**
  1. **`migrate_admin_beta_gating.sql` 을 Supabase에 먼저 적용**(기존 사용자 APPROVED 백필 포함) → 그 다음 코드 배포.
  2. **env `SUPER_ADMIN_EMAILS`** 설정 — 로컬 `.env.local`(적용됨: `stayeum2026@gmail.com,gunwoo80@gmail.com`) + **Vercel(prod) 설정 필요**. (미설정 시 DB `isSuperAdmin`만으로 식별. 미가입 주소는 env만 가능, 가입 후엔 DB 플래그도 가능.)

**✅ 배포됨 (2026-05-27→28):** `990d10c`(A 본체) + `727179f`(게이트 누수 수정) + `3560186`(영업장 0개 운영자 크래시 수정). SQL(`migrate_admin_beta_gating.sql`) 프로덕션 적용 완료. stayeum2026 운영자 셋업 완료(DB 플래그).
- **영업장 0개 크래시 수정(`3560186`)**: 순수 운영자(stayeum2026, 소속 영업장 없음)가 /dashboard 가면 빈 영업장 컨텍스트로 로드 실패("this page couldn't load"). → (app) 레이아웃에서 properties 0개면 운영자→/admin·그외→/property-select 리다이렉트. 운영자 헤더 '앱으로'는 /property-select로 + 영업장 보유 운영자에게만 표시.
- **게이트 누수 수정(`727179f`)**: 게이트가 `(app)/*`만 막아 **`/property-select` 진입점이 무방비**였음(미승인자도 영업장 개설 가능 → 베타 게이팅 무력화). → property-select 페이지·`createProperty` 액션에 승인 가드 추가, **운영자는 소속 영업장 없으면 `/admin`으로 라우팅**(+property-select에 '운영자 페이지' 링크, /pending도 운영자는 /admin으로).
- 운영자 계정 셋업: stayeum2026@gmail.com(주력·영구) 구글 로그인 → 행 생성 후 `UPDATE users SET isSuperAdmin=true,status='APPROVED'` 로 즉시 운영자. gunwoo80은 임시(나중 제거 가능, env에만 두면 한 곳 수정으로 제거).
- ⚠️ Google OAuth 가입은 초대코드 입력 없음 → PENDING(수동 승인). 신규 가입자 관리하려면 운영자 계정으로 /admin에서 승인.

### B. 통합 상세 모달 2b — 수납 '쓰기' 제자리 확장 (신중 작업)
- 수납 등록·납부일 임시/영구조정을 공유 모달 제자리 전체기능으로. RoomsClient 수납 모달(~750줄:
  deposit/cleaning/prev-owner settle/prorate/dueDay override 얽힘)을 페이지 비종속 공유 컴포넌트로 추출 필요.
- **결제 정확성 리스크 큼 → 블라인드 복제 금지, 런타임 검증 가능한 세션에서.** 현재는 '수납 관리에서 열기' 딥링크로 처리.
- 상세: memory project_entity_modal

### ✅ C. #5 계약서 통합 페이지 (/contracts) — 완료 (2026-05-23, feat/contracts-page)
- contracts/actions.ts getAllContractFiles(): 영업장 전체 ContractFile + 입주자·호실·상태 조인, viewUrl(Drive).
- contracts/page.tsx(서버 조회) → ContractsClient: 검색(이름·호실·파일명) + 출처 필터(전체/앱 서명/스캔) +
  정렬(최신순/입실자별) + 목록(보기 Drive 링크·삭제). 입주자 클릭 시 통합 EntityModal(고객 뷰)로 연결.
- Sidebar "운영" 그룹에 '계약서'(IcoContract) 메뉴 추가. 삭제는 tenants/actions deleteContractFile 재사용(Drive 원본도 삭제).
- 남은 개선 여지: 계약서 직접 업로드/생성 진입은 기존 고객 상세(ContractFilesPanel) 유지 — 통합 페이지는 조회·관리 중심.

### ✅ D. 영업장 구성원 초대·참여 (2026-05-28, 코드·로컬 — SQL 적용 후 푸시)
**구현(두 흐름 다 지원):**
- **흐름 A — 이메일 직접 초대**: 기존 settings/actions.ts 의 `inviteMember/updateMemberRole/removeMember`가 이미 동작(기존 UI 그대로 유지, 변경 없음).
- **흐름 B — 참여 코드 (신규)**: 운영자가 6자 참여 코드 발급/재발급 → 공유 → 받은 사람이 영업장 선택 화면에서 입력하면 PENDING 요청 생성 → 운영자가 settings에서 승인/거절 → 승인 시 UserPropertyRole 생성.
- **스키마**: `Property.joinCode String? @unique` + `JoinRequest{propertyId·userId·status·role·message·createdAt·decidedAt·decidedBy}` + `JoinRequestStatus enum(PENDING/APPROVED/REJECTED)`. (영업장,사용자) unique → 거절 후 재요청 시 동일 record를 PENDING으로 갱신.
- **`migrate_join_requests.sql`** 추가 전용. **SQL 적용 후** 코드 푸시 필요.
- **신규 서버 액션** `settings/memberActions.ts`: `getJoinCode·regenerateJoinCode·listJoinRequests·approveJoinRequest·rejectJoinRequest`. 권한: 읽기=requireEdit, 쓰기=requireOwner.
- **사용자 측** `property-select/actions.ts`에 `requestJoinByCode(code, message?)` — getAccessContext 가드(미승인은 차단), 코드로 영업장 찾기, 본인 소유/이미 구성원 검사, JoinRequest upsert(같은 쌍 1개).
- **UI 운영자(settings 멤버 관리 탭)**: 신규 '참여 코드' 박스(발급/재발급/복사) + 신규 '참여 요청' 박스(이름·연락처·메시지·역할 select·승인/거절). 기존 멤버 목록·이메일 초대 박스는 그대로 유지.
- **UI 사용자(property-select)**: '참여 코드로 영업장 참여' 입구(빈 상태/리스트 상태 둘 다). 새 영업장 개설 옆에 점선 보더 버튼. 코드+선택 메시지 입력 → 성공 시 안내.
- 빌드 통과. lint는 기존 CreateForm 인라인 패턴과 동종 4건(기존 컨벤션 유지).

⚠️ **활성화**: 1) `migrate_join_requests.sql` 적용. 2) 그 다음 코드 푸시 → Vercel 배포.

### D. 영업장 구성원 초대·참여 — 미구현 (두 흐름 다 지원, 2026-05-18 결정) — 위 ✅로 대체
- 모델 A: 운영자가 이메일 입력 → 초대 발송. 모델 B: 사용자가 참여 코드 입력 → 운영자 승인/거절.
- 운영자용 "구성원·요청 관리" 화면. 참여 코드는 영업장 개설 시 자동 생성·재발급 가능.
- 신규 초대 = Supabase inviteUserByEmail(admin API), 기존 계정 = UserPropertyRole 행 추가. 초대 템플릿 등록됨.

### E. 이미지 업로드 → 자동 입력 (OCR/AI)
- 이미지 읽어 자동 입력 + 확인 후 반영. 케이스1: 입금 계좌 캡처 → 이름·방번호 → 수납 업데이트.
  케이스2: 영수증 → 지출 자동 입력. 영수증 스캔 일부 구현됨(51b8eb8). Gemini(@ai-sdk/google) 사용 중.

### F. 엑셀 내보내기/가져오기 개선
- 내보내기: 모든 최신 내용 누락 없이. 가져오기: 덮어쓰기/추가/중복선택 방식 사용자 선택.
- 기존: app/api/export, app/api/import, import/preview.

### G. 영업장 랜딩 페이지 + 유입 트래킹
- **공개 페이지 라우트 = `/members/<slug>`** ([[project_public_listing_page]] 정설). 초기 `/stay/<slug>` 시도는 폐기.
- **✅ 1단계 완료**: 첫 영업장(더스테이 제기) 정적 HTML 라이브 — `public/members/thestayjegi/index.html` (배포됨, 3차례 다듬음). 360° 객실 라벨 포함.
- **✅ 유입 트래킹(2026-05-28)**: `@vercel/analytics` 설치 + 루트 layout에 `<Analytics />`(앱 전체) + 정적 랜딩 head에 `/_vercel/insights/script.js`(공개 페이지) → 페이지뷰·referrer·국가 등 자동 수집. **Vercel 대시보드 → Analytics 탭**에서 확인. 무료 한도(2,500/월 hobby, 250k/월 pro) 충분.
- **✅ 정리**: 구버전 `public/stay/thestay-jegi/` 제거 (5/18 1회 커밋 후 방치된 잔재).
- **비전 남은 것**:
  · 2단계 — **회원이 직접 페이지 편집** = 인앱 편집기(Property.slug 필드 + 콘텐츠 저장 구조 + UI). 큰 작업, 별도 세션 권장.
  · 유입 트래킹 **인앱 대시보드 위젯** (Vercel API 또는 자체 events 테이블로 페이지뷰/referrer를 운영자 대시보드에 표시). Vercel Analytics가 외부 대시보드에 있어 1차 가치는 충족 — 인앱 노출은 데이터 쌓인 뒤 자체 트래킹으로 별도 작업.

### H. #6 국가 서류·양식 페이지 (별도 세션 권장)
- DocumentTemplate 모델 신규. 카테고리·태그 + 다운로드 링크/파일 업로드 + 안내 링크.

### I. 작은 개선 (자투리)
- ✅ 고객 폼: 입주희망일을 상태 클러스터로 이동 (2026-05-23 완료, feat/quick-polish).
- ✅ 통합모달 도입 후 죽은 서브모달 코드 정리 (2026-05-23 완료).
- ✅ 재고 이월분: 점검 후 입수분 반영 완료 (2026-05-27, `fea5c4d`). 점검 잔량 + 점검 이후~월초 입수(구매수령·무상) 합산, 내역 표시.

### 보안 점검 (권장 — 2026-05-28 Supabase 메일 계기로 발견)
- **public 테이블 Data API 노출 / RLS 점검**: 이 앱은 데이터 접근을 **Prisma 직결로만** 하고 Supabase는 인증(auth)에만 씀
  (`.from()` 테이블 호출 0건 — 전수 확인). 그런데 Supabase 기본값상 public 스키마 테이블이 Data API(PostgREST)에 노출돼
  있고 RLS가 꺼져 있으면, 브라우저에 노출되는 `anon` 키로 **고객 PII(users.realName·phone·address, tenants 등)가 외부에서
  읽힐 수 있음.** → Supabase 대시보드 **Security Advisor**로 노출 테이블 확인 후 Data API 비활성화 또는 RLS 적용으로 잠글 것.
  (참고: Supabase 2026-05-30 "Data API 기본값 변경"은 **신규 프로젝트만**, 기존은 2026-10-30까지 현행 → 앱 기능 영향 없음. 보안만 별개로 챙기면 됨.)

### J. 나중에 (낮은 우선순위)
- **@stayeum.com 이메일 수신**: 현재 발송만 가능. Cloudflare Email Routing(무료)으로 → Gmail 포워딩.
- **구글 로그인 supabase.co 노출 제거**: 리다이렉트 중 잠깐 노출. 완전 제거는 Custom Domain(유료, Pro). 체감 짧음.
- **이메일 템플릿 디자인 재작업**: 현재 임시(퍼시몬). 로고·브랜드 확정 후 docs/email-templates/ 수정 →
  Supabase 재반영. 같은 트리거로 앱 내 "RoomOS" 텍스트 잔재 정리.

### K. 푸시 알림 (PWA Web Push + 홈화면 뱃지)
- ✅ **1차 완료 (2026-05-23, main 2c32170)**: 서비스워커(public/sw.js, push→알림+setAppBadge, 클릭→딥링크),
  PushSubscription 모델+마이그레이션(적용됨), settings/pushActions(구독 저장/삭제/테스트 발송, web-push),
  설정 '알림(푸시)' 섹션 PushToggle(권한·구독·테스트 푸시). VAPID 키 Vercel env(prod/dev) + .env.local 등록.
  next.config web-push 외부패키지.
  · iOS는 홈화면 설치 PWA에서만(16.4+). 권한 1회 허용 필요.
- ✅ **2차 완료 (2026-05-23, feat/push-cron)**: Vercel Cron 매일 09:00 KST → /api/cron/push-alerts
  (CRON_SECRET 인증) → 구독자→영업장 해소 → 일정기반 알림 카운트 발송 + 뱃지. vercel.json crons + CRON_SECRET env.
  · 알림: 퇴실예정·투어예정·입주예정·수령대기 (윈도우 7일전~30일후) + **재고 소진 임박**. 만료 구독 자동정리.
- ✅ **2b 재고 소진 추가 (2026-05-23, feat/push-v2b-inventory)**: getInventoryOverview 의 compute 로직을
  app/(app)/inventory/overview.ts (비-'use server' 모듈)로 안전 추출 → computeInventoryOverview(propertyId).
  actions.ts는 얇은 래퍼. cron이 이를 재사용해 lowStock(daysUntilEmpty ≤ alertThresholdDays) 카운트 추가.
  (보안: 'use server'에 propertyId 인자 추가 시 타 영업장 조회 우려 → 모듈 분리로 회피.)
- ✅ **2c 알림 정책 변경 + 미납 추가 (2026-05-24)** — 사용자 요청("당일에 있을 일만, 미납만 완납까지 매일"):
  · **일정 기반(퇴실·투어·입주) → '당일'만**: cron 윈도우를 [오늘 00:00, 내일 00:00)로 변경
    (`expectedMoveOut/tourDate/moveInDate: { gte: today, lt: tomorrow }`). 2~3일 후·경과 건은 더 이상 알림 X.
    메시지 라벨도 "오늘 퇴실/투어/입주"로. (기존 ALERT_WINDOW_BEFORE/AFTER 상수 사용 제거)
  · **진행 중 상태 → 해소될 때까지 매일 유지**: 재고 소진 임박·수령 대기(기존) + **미납(신규)**.
  · **미납 신규**: app/(app)/dashboard/unpaid.ts 에 computeUnpaidStatus(propertyId) 추가(비-'use server').
    대시보드 getDashboardData 의 '누적 미납 발생주의' 블록을 **그대로 복제** → 도래·미회수(overduePortion>0)
    건수 = 대시보드 '이달 미수납' 위젯과 동일. cron 이 매일 카운트 발송(완납 시 자동 0). targetMonth=오늘 월.
  · ⚠️ unpaid.ts 는 대시보드 로직 복제본 — 한쪽 수정 시 양쪽 동기화 필수(파일 상단 경고 주석). 장기적으로 단일화 권장.
  · 검증: 빌드 통과. 런타임 건수 일치(푸시 미납 N = 대시보드 이달 미수납 N)는 다음 기회에 확인 권장
    (참고: /accrual-check 라우트 존재). 납부예정(미도래·upcoming)은 정책상 알리지 않음(당일/미납만).

### ✅ L. 대시보드 동적 알림 센터 — 긴급/예정 2존으로 완료·배포 (2026-05-26, main `7e2fb77`)
- **결정(사용자 선택)**: UX = **긴급/예정 2존**, 긴급 기준 = **경과(음수) or D-2 이내**(appConfig `ALERT_URGENT_WITHIN_DAYS=2`, 조정 가능).
- **구현(대시보드 AlertsStrip만 — DashboardClient.tsx)**:
  · **urgencyDays 도출은 클라이언트에서 `timeLabel` 파싱**(`urgencyDaysOf`) — page.tsx(1900줄 금융 빌더) 미수정으로 리스크 최소.
    경과→음수, 오늘/임박/필요→0, "N일 남음"→N, 날짜없음(후보·연락·미정·미처리)→9999(긴급아님). 라벨 바뀌면 9999로 graceful.
  · **'지금 급함' 존**: urgencyDays ≤ 2 항목을 **카테고리 무관** 최상단에 긴급순 정렬 + **항상 펼침**(빨간 헤더).
  · **'예정'**: 나머지를 기존 카테고리 그룹으로, **기본 접힘**(수동 토글). 단 긴급이 0건이면 옛 동작(≤3개 펼침)으로 폴백.
  · AlertRow 컴포넌트로 행 렌더 공유. CATEGORY_ORDER/META 유지.
- **검증**: build 통과, ESLint 신규코드 클린(769 set-state-in-effect는 기존 FinanceTab 이슈·무관),
  urgencyDaysOf 단위테스트 18/18 통과(모든 실제 라벨 형식). ⚠️ 2존 시각/인터랙티브 확인은 iCloud dev Fast Refresh로 불가 → 프로덕션/실기기 권장.
- **종(L-2)과의 관계**: 종은 computeAlerts의 numeric `urgency`로 이미 정렬됨(별개 서브시스템). L은 대시보드 AlertsStrip 전용.
- **남은 여지**: ~~카테고리별 차등 임계값~~ → ✅ 적용(2026-05-28, L 후속). 긴급 항목 within-group 부분펼침(B안 요소)은 필요 시.

#### L 후속 폴리시 ✅ (2026-05-28) — 카테고리별 '지금 급함' 임계값
- 기존: 전역 `ALERT_URGENT_WITHIN_DAYS = 2`로 모든 카테고리 동일 임계값. 미납은 도래 즉시 급하고 재고는 며칠 전부터 급한데 동일 잣대였음.
- 변경: `lib/appConfig.ts` 에 `ALERT_URGENT_CATEGORY_DAYS` 맵 신규. 카테고리별 오버라이드(없으면 전역값 폴백).
  · unpaid 0(도래 즉시) · upcoming 2 · moveout 3 · movein 3 · tour 1 · wish −1(절대 긴급 X) · request 0 · recurring 2 · inventory 5.
- DashboardClient `AlertsStrip`의 urgent 분리 로직: 전역 비교 → `thresholdFor(category)` 호출로 항목별 임계값 비교. `restItems` 도 동일 기준.
- 결과: 진짜 급한 것만 '지금 급함' 존에, 카테고리 본연의 시간 감각 반영. 사업장별 튜닝이 필요해지면 Property 컬럼으로 이전.
- 빌드 통과, 신규 코드 lint 클린. SQL 불필요. 즉시 배포 가능.

#### L(원안). 대시보드 동적 알림 센터 (Dynamic Notification Center) — 2026-05-23 제안
- **문제**: 대시보드 알림이 많다 보니(납부 예정·퇴실 예정·투어 예정·희망호실 조건 매칭 등) 정해진 고정 순서라
  정작 급한 알림을 놓침. 어떤 건 열려있고 어떤 건 닫혀있는데 긴급도와 무관.
- **아이디어**: 도래가 임박한(급한) 것부터 **위로 정렬 + 펼침**, 시간 여유 있는 건 **아래로 + 닫힘/숨김**.
  같은 카테고리 안에서도 급한 항목만 펼치고 나머지는 닫힌 채 유지.
- **예시**: 고정지출이 '내일' 나갈 건이면(지금은 뒤에서 2번째) → 최상단으로 올라오고 그 항목만 펼쳐져 내일 나갈
  것만 표시. 그 아래 칸엔 내일 있을 투어 예정 알림이 펼쳐지고, 투어 알림 중 다음 주 건은 여전히 닫힘.
  → 사실상 **카테고리를 2단(그룹 + 긴급도) 으로 펼치는** 구조.
- **미정(논의 필요)**: ① 알림 종류별 '긴급' 판정 로직(D-N 임계값 등 알림마다 다름) ② UI/UX 방식
  (자동 펼침/접힘이 과한지, 수동 토글과 어떻게 공존할지). 착수 전 함께 설계.
- 연계: K(푸시 알림)의 긴급도 판정과 로직 공유 가능.

#### ✅ L-2. 헤더 우측 🔔 인앱 알림 센터 — (A) 접근으로 완료·배포 (2026-05-25, main `2138242`)
- **구현 요지**: 헤더 🔔 placeholder를 실제 알림센터로 교체. "오늘 챙길 일"(미납·오늘 퇴실/투어/입주·재고 소진·수령 대기)을
  드롭다운 목록으로. 뱃지 숫자 = 항목 수 = 홈화면 푸시 뱃지(구조적 일치).
- **핵심: 단일 소스 `computeAlerts(propertyId)`** (`app/(app)/dashboard/alerts.ts`, 비-'use server') 신규:
  · 미납 = 기존 `computeUnpaidStatus().unpaidLeases` 재사용(로직 변경 없음 → 새 금융 리스크 없음).
  · 오늘 퇴실/투어/입주 = cron과 같은 당일 [00:00,내일) 윈도우 + tenant·room 상세.
  · 재고 소진 = `computeInventoryOverview()` lowStock 필터. 수령 대기 = 미수령 tracked 지출.
  · 각 AlertItem: category·title·subtitle·tenantId(또는 href)·urgency(정렬). `summarizeAlerts()`로 cron 메시지 카운트 생성.
- **cron 리팩터**(`api/cron/push-alerts/route.ts`): 인라인 countAlerts 제거 → `computeAlerts`+`summarizeAlerts` 사용.
  메시지 라벨·순서 동일(미납→오늘퇴실→오늘투어→오늘입주→재고소진→수령대기). **cron·종이 같은 소스 → 카운트 불일치 원천 차단.**
- **`getMyAlerts()` 서버액션**(`alertActions.ts`): 쿠키 영업장+getClaims 인증 → computeAlerts. propertyId 클라 인자 안 받음(타 영업장 차단).
- **NotificationBell.tsx**(클라): 마운트·영업장전환·페이지이동 시 lazy fetch(재고계산 무거워 네비 비블로킹). 빨간 뱃지(99+),
  드롭다운 목록(긴급도순), 항목 클릭 → tenantId는 전역 EntityModal(고객뷰) 제자리, 재고·수령은 /inventory. 빈 상태 문구. 자체 외부클릭 닫기.
- **검증**: build 통과(TS+번들, 서버/클라 경계 OK), ESLint 신규 5파일 클린. **런타임**: 임시 라우트로 실제 DB 호출 →
  computeAlerts 에러 없이 완주, 오늘 0건이 정상임을 원천 대조로 확인(퇴실 3·투어 2·예약 1 존재하나 당일=0, 미납·재고·수령 0).
  ⚠️ 종 드롭다운 **시각/인터랙티브 확인은 iCloud dev Fast Refresh로 불가** → 실기기/프로덕션에서 확인 권장(비어있지 않을 때 목록·딥링크).
- **범위 밖(별도)**: 대시보드 넓은 AlertsStrip·동적 정렬(L)은 그대로. 미납 unpaid.ts↔대시보드 중복 통합은 금융검증 세션에서.
- **남은 것**: (B) 푸시 내역 히스토리 테이블은 미구현(필요 시). L 동적 정렬은 urgency 필드 이미 부여해둠 → 차후 펼침/정렬 UI에 재사용.

#### L-2(원안). 헤더 우측 🔔 인앱 알림 센터 (2026-05-24 제안 — 푸시 UX 논의 중 도출)
- **문제(맥락)**: 현재 푸시 알림은 OS 알림센터(아이폰 알림함)에만 쌓이고, **앱 안에는 알림 내역을 볼 곳이 없다.**
  홈화면 뱃지 숫자만 뜨고(예: "1") 그 숫자가 무슨 알림인지 앱에서 확인할 방법이 없음. 또 앱을 켜둔(포그라운드)
  상태에서 받은 푸시는 iOS가 배너를 숨겨서 뱃지만 올라가, 사용자가 "이유 없이 숫자만 뜬다"고 느낌.
- **아이디어**: 일반 앱처럼 **헤더 우측 상단에 종 모양(🔔) 아이콘 + 안 읽은 개수 뱃지**를 두고, 누르면 알림
  목록(드롭다운/시트)이 뜨고, 항목을 누르면 해당 상세(EntityModal·해당 페이지)로 딥링크. 뱃지 숫자는 홈화면
  앱 뱃지 숫자와 **일치**시킨다(같은 카운트 로직 공유).
- **두 가지 접근**:
  - **(A) 살아있는 알림(현재 챙길 일) 집계 — 추천.** 별도 저장 없이, cron/대시보드가 쓰는 카운트 로직
    (퇴실예정·투어예정·입주예정·수령대기·재고소진+나중에 납부예정)을 그대로 종 안에 모아 보여줌. 일이 해소되면
    목록에서 사라짐 → 뱃지 숫자와 자연히 일치. **L(동적 알림센터)의 인앱 표면(surface)** 으로 딱 맞음.
  - **(B) 받은 푸시 내역 저장(테이블).** Notification 모델 새로 만들어 발송한 푸시를 row로 적재 → 읽음/안읽음
    관리. 진짜 '알림함' 히스토리지만 스키마·발송 시 적재·읽음처리 로직이 추가로 필요. (A)와 병행도 가능.
- **권장 순서**: 먼저 (A)를 L 본체와 함께 설계·구현(긴급도 정렬·펼침 로직을 종 목록에 재사용) → 필요 시 (B) 히스토리 추가.
- 연계: 알림 계산 로직은 **K(cron) · 대시보드 · 🔔 종** 3곳이 공유 → 한 모듈(예: computeAlerts(propertyId))로
  추출해 단일 소스화하면 카운트 불일치 방지(재고 추출 때 쓴 비-'use server' 모듈 분리 패턴과 동일).

### M. 앱 레이아웃 IA 재정리 (2026-05-24 논의·확정) — 익숙함 + 영업장 전환 차별점 + 멀티플랫폼
- **원칙**: 독창성보다 **타 앱(토스·신한SOL·하나카드·애플지갑)과의 익숙함**을 이어가되, 이 앱의 차별점
  (영업장 넘나들기, 사무실 데스크탑 상주 + 모바일 현장 사용 = 멀티앱)은 살린다.
- **현재 셸 문제**(components/layout: AppShell·Header·BottomNav·Sidebar 기준):
  ① 영업장 전환이 우측 아바타 드롭다운 안에 숨음(차별점인데 2단계 진입) ② 🔔 종 없음(L-2 진입점 부재)
  ③ 월 네비(◀5월▶)가 헤더 좌측 주인공 — '월' 무관 페이지(재고·입주자·계약서)에선 노이즈
  ④ 모바일 햄버거+하단 6탭 중복, 6탭은 HIG(≤5) 초과로 빽빽.
- **확정 방향**(사용자 선택): 모바일 **하단 4+'전체'(햄버거 제거)**, 월 네비 **맥락형**.
- **목표 공통 헤더**: `[좌] 영업장 스위처 ▾ … [우] 🔔  프로필`. 데스크탑은 좌측 사이드바 유지.
- **재사용 자산**: getMyProperties()/selectProperty(id)(app/property-select/actions.ts) → 스위처 즉시 활용.
  모바일 '전체' 탭 = 기존 Sidebar 드로어 그대로 열기(이미 전체 NAV_GROUPS 포함, 새 컴포넌트 불필요).
- **단계**: Phase 1 = 헤더(영업장 스위처+🔔+프로필) + 월 네비 맥락형 + 하단 4+전체(햄버거 제거).
  Phase 2 = 🔔 알림센터 내용(L-2) + 대시보드 동적 알림(L). 기존 기능은 **삭제 없이 이동만**.
- ✅ **Phase 1 완료 (2026-05-24, feat/layout-ia-phase1)**:
  · layout.tsx — claims.sub로 영업장 목록(id·name) 직접 조회(getUser 왕복 회피) → AppShell→Header 전달.
  · Header.tsx 재구성 — [좌] 영업장 스위처(selectProperty 재사용, 전환 후 /dashboard) + 맥락형 월 네비
    (MONTH_PAGES=dashboard·rooms·finance·report·stats에서만), [우] 🔔(셸; 내용은 L-2) + 프로필(영업장 관리/로그아웃).
    햄버거 제거. 월 자동 새로고침 로직·MonthPicker 그대로 보존.
  · BottomNav.tsx — 핵심 4탭(홈/방/입주자/수납) + '전체'(버튼) → 기존 Sidebar 드로어 재사용(전체 메뉴).
  · AppShell.tsx — Header에 properties/currentPropertyId 전달, BottomNav onMenuOpen=드로어 열기.
  · 데스크탑 좌측 사이드바 유지. 빌드 통과. (남은 점검: 모바일 헤더 폭 — 영업장명 truncate로 방어, 실기기 확인 권장)
- ✅ **Phase 1 정리 (2026-05-24, 사용자 피드백 "복잡해보임")**:
  · 프로필/계정(이메일·영업장 관리·로그아웃)을 헤더 우측 → **전체 메뉴(Sidebar 하단)** 로 이동.
    헤더 우측은 🔔만 남김. Sidebar에 user prop 추가(AppShell→Sidebar), 데스크탑/모바일 드로어 공통 하단 계정 섹션.
  · 대시보드 상단 **영업장명 배너(h1) 제거**(스위처와 중복) + DataButtons 제거. property findUnique·Suspense·import 정리.
  · **엑셀 가져오기/내보내기(DataButtons) → 환경설정 기본정보 탭** '엑셀 가져오기·내보내기' 카드로 이동(데이터 백업 위).
- ✅ **Phase 1-3: 월 셀렉터 위치 재배치 — (A) 페이지 콘텐츠 상단으로 완료 (2026-05-25, 사용자 (A) 선택)**:
  · **결정**: 헤더의 월 네비(◀ 5월 ▶)가 영업장 스위처 옆에 붙어 "복잡해 보임" → **각 월-페이지 콘텐츠 상단 우측**으로 이동.
    헤더는 이제 `[좌] 스위처 … [우] 🔔`로 깔끔. '기간 선택은 데이터 옆에' 관례 부합.
  · **구현(①/② 분리)**:
    - **components/layout/MonthSelector.tsx (신규)** — 보이는 컨트롤 ◀ label ▶ + MonthPicker 팝오버(우측 정렬 right-0,
      화면밖 방지) + ?month URL push(디바운스 350ms) + 낙관적 localMonth. cream pill+border, 이번달이면 ▶ disabled.
      URL↔로컬 동기화는 **렌더 중 상태조정 패턴**(useEffect 아님; react-hooks/set-state-in-effect 회피),
      ref 동기화만 작은 effect.
    - **components/layout/MonthSync.tsx (신규)** — 안 보이는 자동 새로고침 effect 3개(자정 롤오버·자정 타이머·재진입)만.
      셸(AppShell)에 **항상 마운트**(Suspense fallback=null). useSearchParams 사용.
    - **components/layout/NavigationContext.tsx (신규)** — AppShell useTransition(startNavigation)을 페이지 트리로 공급.
      MonthSelector가 페이지로 내려가며 prop이 끊겨서, 컨텍스트로 전환 로딩 오버레이(BrandLoader) 공유. Provider 밖이면 직접 navigate 폴백.
    - **Header.tsx** — 월 UI·월 effect·MonthPicker·MONTH_PAGES·usePathname/useSearchParams **전부 제거**(244→약 160줄).
      스위처·🔔만 유지. 영업장 스위처 max-w 42vw→60vw(공간 여유).
    - **AppShell.tsx** — <MonthSync/>(Suspense) 마운트 + <main> children을 <NavigationProvider>로 감쌈.
  · **배치 페이지(3곳, ?month 실제 사용처만)**: dashboard(상단 우측정렬 행), rooms(기존 제목옆 정적 {targetMonth} 텍스트를 교체),
    finance(제목과 한 행 justify-between). **report·stats는 제외** — report는 자체 `?year=` 셀렉터(ReportClient) 보유,
    stats는 /dashboard로 redirect만. (기존 헤더 월 네비는 이 둘에선 무동작 노이즈였음 → 제거가 개선).
  · **검증**: `npm run build` 통과(TypeScript·정적생성, 5개 월-페이지 ƒ 동적). ESLint 신규/변경 5파일 클린.
    MonthSelector 모바일 390px 렌더·우측정렬·pill·▶disabled 스크린샷 확인.
  · ⚠️ **GUI 인터랙티브 검증은 불가**(iCloud 환경): 프로젝트가 iCloud Drive라 dev 서버가 거의 상시 Fast Refresh 재빌드 상태
    (클릭 없이도 버튼수 4→0 유지). 팝오버 열림 등 일시상태가 매번 리셋돼 dev 자동검증 불가 — **코드 버그 아님, 프로덕션엔 Fast Refresh 없음**.
    실기기/프로덕션에서 ◀▶·달력 팝오버 동작·모바일 폭 최종 확인 권장. (메모리 reference_gui_verify 의 iCloud 빌드 이슈와 동일 계열)
  · ✅ 배포됨 (main `d948453`).
- 참고: Brand Guide v1.1/v1.2 리스킨([[project_status_colors_pending]])과 색·radius는 별개로 진행 가능(IA 우선).

### N. Prism(프리즘) 본질화 — Phase 1: 공통 하단 네비 통일 (2026-05-30)

- **맥락**: 회전 애니메이션 시도(3D rotateY) 했으나 "휙휙 도는 느낌 전혀 안 남" → 폐기. 본질 재정의:
  Prism = 어디 페이지서 상세 팝업을 열든 **하단에 같은 자리·같은 모양·같은 순서의 3버튼**(호실/고객/수납),
  현재 면은 Terracotta 강조, 연결 대상 없으면 비활성. 안드로이드 시스템 바처럼 어딜 가나 유지.
  스샷에서 확인된 격차: 고객=[삭제][수납정보][호실정보][계약서출력][수정], 호실=[삭제][입주자정보][수납정보][수정],
  수납=[양도인메뉴][입주자정보][호실정보][양도인정산][수납등록] — 라벨·순서·강조·위치 다 다름.
- **Phase 1 (UI 통일만, 클릭 동작은 기존 entityModal.open() 유지)**:
  · 신규 [components/entity-modal/PrismNavBar.tsx](components/entity-modal/PrismNavBar.tsx) — 3버튼 공통(호실/고객/수납),
    `current`·`links`(roomId/tenantId/leaseTermId) prop. 현재 면 disabled+Terracotta, 비활성 면 disabled+opacity-40.
  · [TenantClient.tsx:2123-2150](app/(app)/tenants/TenantClient.tsx#L2123-L2150) — 푸터 2줄(액션[삭제·계약서출력·수정] + PrismNavBar current="tenant").
    useEntityModal 직접 호출 제거(PrismNavBar 내부에서 처리).
  · [RoomManageClient.tsx:897-919](app/(app)/room-manage/RoomManageClient.tsx#L897-L919) — 푸터 2줄(액션[삭제·수정] + PrismNavBar current="room").
  · [RoomsClient.tsx:1836-1905](app/(app)/rooms/RoomsClient.tsx#L1836-L1905) — 푸터 2줄(액션[양도인메뉴·양도인정산·수납등록] + PrismNavBar current="payment").
  · EntityModal 자체 내부 navBtn은 시각 동일(같은 클래스·순서) — `setKind` 인플레이스 전환이라 PrismNavBar로 치환하면 매 클릭 재페치 회귀.
    Phase 1에선 시각 통일만 목표라 그대로 두고, Phase 2 풀팝업 추출 단계에서 자연 정리.
  · 타입체크 클린(npx tsc --noEmit, .next 자동생성 제외).
- **남은 격차(Phase 2/3 — 본질의 본질)**:
  사용자 비전 = 클릭 시 그 면의 **진짜 풀 팝업**이 그 자리에 뜸(현재처럼 미니 요약 EntityModal이 아니라).
  뒷 배경은 처음 들어온 페이지 유지(닫으면 그 페이지로). 이를 위해서는 각 페이지의 풀 상세 팝업
  (Tenant 상세 ~510줄·Room 상세 ~127줄·Payment 상세 ~660줄)을 페이지 비종속 공유 컴포넌트로 추출 필요.
  Payment는 결제 정확성·양도인 정산·임시조정 등 얽힘 커서 [[project_entity_modal]]의 "2b 고위험" 그대로 — 신중한 세션에서.
  Tenant/Room부터 단계 분할 가능.
- **GUI 확인 미수행**: 세션 dev 서버 미가동, 실기기 또는 다음 세션에서 세 페이지 모두 동일 하단바인지 시각 확인 필요.

### N-2. Prism Phase 2.1 — 호실 풀팝업 본문 통일 (2026-05-30)

- **목표**: Phase 1의 "버튼만 통일"을 넘어 본질 — **면 클릭 = 그 entity의 진짜 풀팝업 본문이 그 자리에 뜸**. 호실(저위험·~127줄)부터 진행. 고객·수납은 차후.
- **공유 데이터**: [rooms/actions.ts](app/(app)/rooms/actions.ts) 신규 `getRoomDetail(roomId)` — quickInfo 대비 tier·floor·비거주 가격·areaPyeong/M2·풀 leaseTerms 포함, 상태 라벨/뱃지(`{label, badge:{tone,label}|null}`)까지 서버에서 계산해 돌려줌.
- **공유 컴포넌트**: 신규 [components/entity-modal/RoomDetailBody.tsx](components/entity-modal/RoomDetailBody.tsx) — 자체 fetch + 내부 Lightbox(키보드·스와이프·Drive 원본). props: `roomId`, optional `onApplyScheduledNow`(room-manage 페이지에서만 전달 → 버튼 표시).
- **EntityModal 정리**: [EntityModal.tsx](components/entity-modal/EntityModal.tsx) — 미니 `RoomView`(요약 6필드) 삭제 → `<RoomDetailBody roomId={...} />` 사용. `getRoomQuickInfo` import 제거.
- **RoomManageClient 정리**: [RoomManageClient.tsx](app/(app)/room-manage/RoomManageClient.tsx) — 인라인 상세 팝업의 본문(사진 슬라이더 + 정보행, ~70줄) 제거 → `<RoomDetailBody roomId={r.id} onApplyScheduledNow={...} />`. 부수 정리:
  · `lightboxPhotos/lightboxIndex` state 제거 + Lightbox render 제거 (이제 RoomDetailBody 내부)
  · 로컬 `Lightbox` 함수 정의(~155줄) 제거
  · 로컬 `DetailRow` 함수(~7줄) 제거 — RoomDetailBody 내부로 이동
  · IIFE 안 unused `const tenant` 제거
  · 결과: RoomManageClient 1618 → 1368줄 (-250). EntityModal 230 → 209줄. RoomDetailBody +290줄. 순증 미미, 로직 통일.
- **검증**: `npx tsc --noEmit` 통과(.next 자동생성 제외 0 에러).
- **사이드 효과**: room-manage 페이지에서 상세 팝업 열 때 잠깐 "불러오는 중…" 플리커 가능 — RoomDetailBody가 서버 액션 재fetch. 데이터 신선도는 +1(편집 후 즉시 반영), UX 살짝 -1. 거슬리면 `initial` prop 추가하는 후속 가능.
- **남은 격차**: 헤더(호실번호+상태 뱃지)와 푸터(삭제·수정·PrismNavBar)는 여전히 페이지마다 직접 그림 — 본문만 통일. 다음 단계로 헤더/푸터까지 흡수하면 RoomDetailFull 카드 통째로 공유 가능. 수정·삭제 액션을 callback prop 으로 받는 패턴이면 EntityModal에서도 동일 풀팝업 가능.

### N-2b. Prism Phase 2.2 — 위젯 모델 + PrismShell + room-manage 마이그레이션 (2026-05-30)

- **멘탈 모델 전환**: "페이지 종속 팝업" → "데이터 조합으로 발현되는 뷰". 원자 단위 위젯(InfoRow·PhotoStrip 등)을 entity·view 별로 조합. 페이지가 데이터 소유 X.
- **2중 스택 해소(부분)**: PrismShell 안 PrismNavBar 클릭이 **인플레이스 body 교체** → 같은 셸 안에서 면만 바뀜. room-manage 카드 클릭 진입 → 셸이 곧장 뜸(자체 모달 없음). Phase 2.3/2.4 에서 tenant·rooms 도 셸로 이주하면 2중 스택 완전 제거.
- **신규 위젯 (components/entity-modal/widgets/)**:
  · `InfoRow` — 모든 entity 공유 표시 한 줄
  · `PhotoStrip` — 사진 가로 스트립 + 풀스크린 Lightbox(키보드·스와이프·Drive 원본). 호실 외 entity 사진도 재사용 가능
  · `RoomBasicInfo` — 상태·입주자·타입·등급·기본/예약/비거주 이용료 + 예정 즉시 적용 버튼 (콜백 prop)
  · `RoomSpatialInfo` — 층·창문·방향·면적
  · `MemoSection` — 메모(빈 값 시 미렌더)
- **신규 body (components/entity-modal/bodies/)**: `RoomBody` — 호실 위젯들의 조합. 자체 getRoomDetail fetch.
- **PrismNavBar 확장**: `onSelect` 옵셔널 prop. 셸 내부에선 인플레이스 전환, 페이지 자체 팝업 안에선 entityModal.open() 폴백.
- **EntityModal → PrismShellView 패턴**: kind 라우팅 + footer 액션 행([삭제][수정] for room) + PrismNavBar(onSelect={setKind}). 호실 액션은 셸이 직접 처리 — 삭제(deleteRoom + router.refresh), 예정 즉시 적용(applyScheduledRentNow + router.refresh), 수정(`/room-manage?roomId=X&edit=1` 로 push + close). Tenant/Payment 면은 기존 미니 요약 + 딥링크 유지(Phase 2.3/2.4 에서 위젯화).
- **RoomManageClient 마이그레이션**:
  · 인라인 상세 모달 JSX 완전 제거(~50줄)
  · `detailRoom` state, `closeDetail`, `handleDelete`, `handleApplyScheduledNow` 함수 제거
  · 카드 클릭 → `entityModal.open({kind:'room', roomId})`
  · URL `?roomId=X` → 셸 열림, `?roomId=X&edit=1` → `openEdit(found)` 직접 (편집 폼은 페이지 종속 잔존)
  · deleteRoom/applyScheduledRentNow import 제거 (셸이 사용)
  · 1368 → 1297줄 (-71)
- **RoomDetailBody.tsx 삭제** — 위젯 조합(RoomBody)로 대체.
- **검증**: `npx tsc --noEmit` 통과.
- **사용자 시점 변화**: 호실 관리 카드 클릭 → 동일한 콘텐츠가 PrismShell 로 뜸(헤더·푸터 통일됨). 인플레이스 [고객][수납] 전환 시 새 모달 안 뜨고 같은 셸의 body 만 부드럽게 갈아끼움(2중 스택 X). 수정 누르면 `/room-manage?roomId=X&edit=1` 로 push → 편집 폼 자동 열림(같은 페이지면 무이동, 다른 페이지면 일시 배경 전환 — Phase 2.5 에서 위젯 편집 모드로 흡수 예정).
- **남은 한계**: tenant·rooms 페이지의 자체 팝업 안에서 PrismNavBar 클릭은 여전히 셸을 그 위에 띄움(2중 스택 잔존). Phase 2.3/2.4 가 해소.

### N-3a. Prism Phase 2.3a — 2중 스택 즉시 해소 (2026-05-30)
- **증상**: 고객 관리 페이지에서 상세 팝업 후 [호실] 클릭 시 셸이 그 위에 떠 2중 스택. 수납 팝업도 동일.
- **수정**: TenantClient / RoomsClient 의 PrismNavBar 에 커스텀 onSelect 박아 다른 면 클릭 시 자기 팝업을 먼저 닫고 entityModal.open() 호출. 시각상 2개 모달이 겹치는 순간이 사라짐.
- **`getTenantDetail` 서버 액션 미리 추가** — 2.3b 본문 추출 대비.
- main `c05a47f`.

### N-3b. Prism Phase 2.3b — 고객 본문 위젯화 + 셸의 [고객] 면 풀 콘텐츠 (2026-05-30)
- **목표**: 셸 [고객] 면이 이전엔 미니 요약(6필드) → 이제 진짜 풀 콘텐츠. 어디서 들어오든(대시보드·셸 안 전환·페이지) 동일한 본문.
- **신규 위젯 (components/entity-modal/widgets/)**:
  · `Section` + `Grid` + `Item` (제목 + 2열 표) — 모든 entity 표시 공유 원자
  · `TenantBasicInfo` (이름·호실·영어이름·성별·국적+국기·직업·생년월일·기초수급자)
  · `TenantContactInfo` (주/비상/본국 연락처)
  · `TenantContractInfo` (월이용료·보증금·청소비·납부일·납부방식·입주일·거주기간·퇴실예정·문의일시) — 읽기 전용 (납입일 변경 인라인 폼은 페이지로 위임)
  · `TenantAdditionalInfo` (전입신고·결제수단·현금영수증·방문경로·희망 이동 호실·계약서 URL)
  · `ContractFilesPanel` — TenantClient 의 ~80줄 그대로 이주 (출력/서명·스캔 본 업로드·삭제)
- **신규 body**: `bodies/TenantBody.tsx` — 자체 fetch + 위젯 한 화면 스크롤 조합:
  · 상태 칩 → BasicInfo → Contact → ContractInfo → AdditionalInfo → 메모 → ContractFilesPanel → 수납 요약 카드 3개 + AI 분석 버튼 → "고객 관리에서 더 보기" 딥링크
- **PrismShell 와이어링** ([EntityModal.tsx](components/entity-modal/EntityModal.tsx)):
  · kind='tenant' body = `TenantBody` (이전 미니 `TenantView` 제거)
  · 액션 행 추가 — [삭제] + [계약서 출력] + [수정]. 삭제는 `deleteTenant` 직접, 수정은 `/tenants?tenantId=X&edit=1` push (TenantClient 가 ?edit=1 감지 → 자동 편집 모드)
  · STATUS_LABEL·getTenantQuickInfo import 정리
- **TenantClient URL 핸들링 확장**: `?tenantId=X&edit=1` → 상세 + 편집 모드 자동 진입 (셸에서 [수정] 누르면 페이지로 점프)
- **남은 격차 (Phase 2.3c+)**:
  · 상태 전환 버튼(퇴실예정·비거주 등) — 셸엔 아직 X, 페이지 진입 필요
  · 요청·컴플레인 CRUD — 셸엔 X (페이지에서)
  · 납입일 변경 인라인 폼 — 셸엔 X
  · TenantClient 자체 모달은 그대로 유지 (페이지 진입 + 풀 CRUD/편집 전담)
- **검증**: `npx tsc --noEmit` 통과.

### N-4a. Prism Phase 2.4a — 수납 위젯화 1차 + 셸 in-place 풀모드 (2026-05-30)

- **사용자 비전 확정**: "수납 관리에서 열기" 클릭해도 **배경은 처음 접속한 페이지 그대로**, 프리즘 모듈만 풀팝업으로 in-place 전환. router.push 제거.
- **추출 전략**: 결제 정확성 위험 단계별 분할. 한 세션에 8개 통째 X. 이번 = 저~중 위험 4개. 다음 세션(2.4b) = 고위험 4개.
- **신규 위젯 (components/entity-modal/widgets/)**:
  · `PaymentSummaryCards` — 총수납·잔액·이월액 3카드. settlement prop 만 받음. 읽기 전용.
  · `DiscountWidget` — 월세 할인 추가/삭제. 자체 fetch (getRentDiscounts) + onChange 콜백. 위젯 내부 state.
  · `DueDayTempAdjustWidget` — 납부일 임시 조정. 입력 변환 로직(같은 월 = 숫자/말일, 다른 월 = full date) 그대로 이주. 위젯에 room override prop 필요.
  · `DueDayPermanentChangeWidget` — 영구 변경 + 일할 정산. calcProRata 결과 실시간 표시(extra/refund/none).
- **신규 body**: `bodies/PaymentBody.tsx` — 2 sub-mode:
  · **summary**: SummaryCards + 월 이용료·납부일 + 이번 달 납부 내역(읽기) + "수납 관리에서 자세히 ▼" 버튼
  · **full**: SummaryCards + 월 이용료·납부일 + DiscountWidget + DueDayPermanentChangeWidget + 고급 기능 딥링크
  · 토글: 같은 셸 안에서 in-place body 교체. 배경 안 바뀜. 사용자 비전 본질.
- **PrismShell wiring** ([EntityModal.tsx](components/entity-modal/EntityModal.tsx)):
  · kind='payment' body = `PaymentBody` (이전 `PaymentView` 미니 요약 제거)
  · '수납 관리에서 열기' 푸터 딥링크 **제거** — PaymentBody 내부 모드 토글로 대체
  · 사용 안 되는 getLeaseSettlementInfo·getPaymentsByLease·fmtWon·Loading·Row 정리
- **남은 격차 (Phase 2.4b — 고위험·다음 세션)**:
  · **PaymentRecordList** (편집·삭제) — 귀속월 변경 회귀 위험
  · **PaymentEntryForm** (FIFO 자동 충당) — 알고리즘 정확성
  · **PrevOwnerSettleWidget** — 매출/미납 집계 영향
  · **DepositCleaningSplit** — 분리 저장 로직
  · DueDayTempAdjustWidget 도 만들었지만 PaymentBody 에 wiring 안 함 — override 정보 fetch 추가 필요 (다음 세션)
- **남은 격차 (Phase 2.4c)**: RoomsClient 자체 모달을 셸로 마이그레이션 → 2중 스택 완전 제거.
- **검증**: `npx tsc --noEmit` 통과.

### N-4b. Prism Phase 2.4b — 수납 위젯화 2차: 고위험 4개 + temp adjust wiring (2026-05-30)

- **목표**: 셸의 [수납] 면 full 모드에서 **모든 수납 기능**을 in-place 처리. "수납 관리 페이지로 이동" 딥링크 제거.
- **확인**: `getLeaseSettlementInfo` 가 반환하는 RoomRow 에 이미 `overrideDueDay/Month/Reason`·`depositAmount`·`cleaningFee`·`moveInDate`·`tenantId` 가 다 있음 → 추가 fetch 불필요.
- **신규 위젯 (고위험 3개)**:
  · `PaymentEntryForm` — 일반 수납 등록 (FIFO 자동 충당) + 보증금/청소비 분리 모드 통합. RoomsClient `handleSavePayment` 그대로 이주(savePayment·saveDepositPayment 호출, allocations 결과 토스트, lastPayMethod localStorage). 폼 자체는 위젯 안에서 관리, 저장 후 onSaved 콜백.
  · `PaymentRecordList` — 납부 내역 + 편집 + 삭제. 자체 fetch (getPaymentsByLease). 편집 가능: 금액·납부일·납부방법·메모·**귀속월**(보증금 제외). updatePayment/deletePayment 호출 후 자체 reload + onChange 콜백. 양도인 record 색·뱃지 그대로.
  · `PrevOwnerSettleWidget` — 양도인 메뉴(auto/show/hide) + 양도인 정산 버튼. getPrevOwnerSettleState 로딩 후 canSettle 시에만 버튼 표시. savePrevOwnerSettle 은 한 번만 호출(서버에서 중복 체크), confirm 다이얼로그.
- **DueDayTempAdjustWidget wiring** — Phase 2.4a 에서 만들었지만 안 박았던 위젯을 PaymentBody full 모드에 추가. settlement 의 override 정보 사용.
- **PaymentBody full 모드 확장**:
  · PaymentRecordList
  · "+ 수납 등록" 버튼(접힘) → 클릭 시 PaymentEntryForm 펼침 → 저장 후 자동 접힘 + refresh
  · DiscountWidget · DueDayTempAdjustWidget · DueDayPermanentChangeWidget · PrevOwnerSettleWidget
  · **"수납 관리 페이지에서" 딥링크 완전 제거** — 모든 기능 in-place
- **결제 정확성 보호**:
  · 추출은 UI/state 만 이동, 서버액션은 그대로 호출 (FIFO·일할·정산 알고리즘 변경 X)
  · 각 위젯이 `onChange` 콜백으로 부모(PaymentBody)의 settlement 재fetch 트리거 → 카드/잔액 즉시 갱신
  · confirm 다이얼로그 그대로 (삭제·양도인 정산)
- **검증**: `npx tsc --noEmit` 통과.
- **남은 격차 (Phase 2.4c)**:
  · RoomsClient 자체 수납 모달은 그대로 (페이지 진입 + 풀 CRUD 양쪽 가능)
  · RoomsClient 의 자체 수납 모달도 PaymentBody 위젯들 사용하도록 마이그레이션하면 코드 중복 제거 + 2중 스택 완전 종료
  · 이번 세션은 셸에 풀 기능 추가까지만 (RoomsClient 통합은 별도 세션)
- **회귀 시나리오 (사용자가 프로덕션에서 확인해야 할 것)**:
  · 셸 → [수납] → "수납 관리에서 자세히 ▼" → full 모드 진입 → 카드 + 위젯 다 보임
  · 일반 수납 등록 (예: 미수 있는 월에 2만 입력) → FIFO 자동 분배 토스트
  · 보증금 + 이용료 동시 입력 → 분리 저장
  · 납부 내역 → 수정 → 금액 변경 → 저장 → 카드 재계산
  · 납부 내역 → 귀속월 변경 → 저장 → 미납 상태 재산정
  · 할인 추가 → 잔액 변경 반영
  · 임시 조정 → 그 달만 적용 / 해제
  · 영구 변경 → 일할 정산 → 다음달부터 적용
  · 양도인 정산 → confirm → 미납 집계에서 제외 / 한 번만 가능

### N-3c. Prism Phase 2.3c — TenantClient 셸 마이그레이션 (2026-05-30)

- **고객 관리 페이지 카드 클릭 / URL `?tenantId=X`** → 전역 셸(`TenantBody`) 직행. 자체 인라인 상세 모달 통째 제거.
- **편집 모드만 페이지에 잔존**: 셸 [수정] 버튼이 `?tenantId=X&edit=1` push → TenantClient 가 편집 폼 모달만 띄움. 편집 폼 자체 위젯화는 Phase 2.5 (장기).
- **신규 위젯**:
  · `TenantStatusTransitions` — 상태 전환 버튼(투어/예약/입실/퇴실 예정/비거주/거주 등) + 미니폼 모달 (z=300, 셸 위). transitionsFor() 정의 그대로 이주. applyStatusTransition·recordDepositReturn 호출.
  · `TenantRequestsTab` — 요청·컴플레인 CRUD. 자체 fetch (getTenantRequests). 생성·완료·삭제 + 처리 이력 펼침.
- **TenantBody 확장**: 상태 칩 → 상태 전환 행 → BasicInfo/Contact/Contract/Additional/Memo/ContractFiles → TenantRequestsTab → 수납 분석+AI. reloadKey 패턴으로 status transition 후 재fetch.
- **TenantClient 인라인 상세 팝업 삭제** (~580줄). 편집 모달만 z=260 으로 잔존 (셸 z=280 보다 위).
- **TS 통과**. TenantClient 3817 → 3268 줄(-549).
- **남은 격차**:
  · 납입일 변경 인라인 폼 (계약정보 안) — 셸엔 X, 편집 모드 사용해야
  · 편집 폼 자체 위젯화 — 페이지 종속 잔존 (Phase 2.5)
- **2중 스택 완전 종료**: 호실·고객·수납 세 페이지 모두 셸 진입. 어디서 들어오든 같은 컨테이너.

### N-4c. Prism Phase 2.4c — RoomsClient 셸 마이그레이션 (2026-05-30)

- **카드 클릭 / URL ?roomNo=X 진입** → `entityModal.open({kind:'payment', leaseTermId, roomId, tenantId})` → 전역 셸(PaymentBody)이 모든 수납 기능 in-place 처리.
- **자체 인라인 수납 모달 JSX 통째 제거** (~810줄): 헤더·요약·납부 내역·할인·임시 조정·영구 변경·양도인 정산·수납 등록 폼 — 전부 PaymentBody 위젯들이 대체.
- **2중 스택 완전 종료**: 어디서 들어오든 셸 한 컨테이너만 뜸 (대시보드·고객 페이지에서 [수납] 전환·수납 관리 페이지 카드 클릭 모두 동일).
- **결제 정확성 불변**: 서버액션(savePayment·saveDepositPayment·updatePayment·deletePayment·addRentDiscount·deleteRentDiscount·setDueDayOverride·clearDueDayOverride·changeDueDay·setPrevOwnerSettleMenu·savePrevOwnerSettle) 그대로. UI/state 만 셸로 이동.
- **TS 통과**. RoomsClient 1903 → 1216 줄(-687).
- **후속 청소**: RoomsClient 안에 dead state·핸들러(handleSavePayment 등) + 사용 안 되는 import 잔존 — 기능 영향 0, 별도 정리 세션에서 제거 가능.
- TenantClient 상세 팝업 ~510줄. 탭 3개(상세/요청·컴플레인/AI), 편집 모드, 퇴실예정·비거주 전환 액션.
- RoomDetailBody 패턴 그대로 — TenantDetailBody에 fetch+탭+읽기 표시. 편집은 callback prop.
- 위험: 폼 상태 동기화, 회귀 가능. 데이터는 안 깨짐.

### N-4. Prism Phase 2.3 — 수납(Payment) 풀팝업 추출 (별도 세션 권장)
- RoomsClient 수납 상세 ~660줄. 결제 정확성·양도인 정산·임시조정·FIFO 귀속 얽힘.
- 회귀 테스트 시나리오 통과 후에만 머지(수납 등록·할인·임시조정·양도인 정산 각 1회).
- 메모리 [[project_entity_modal]] "2b 고위험" 그대로.

### O. 호실 셸 enum 라벨 매핑 fix (2026-05-30, b340ad2)
- **증상**: 호실 셸의 창문 타입에 `OUTER`, 방향에 `SOUTH` 등 raw enum 값 그대로 노출.
- **원인**: Phase 2.2 의 `components/entity-modal/widgets/RoomSpatialInfo.tsx` 가 소문자 키(`exterior`/`south`)로 매핑 표를 만들어 매칭이 일어나지 않아 fallback(`val`)이 표시됨.
- **수정**: DB 실제 값은 대문자 enum(`OUTER`/`INNER`, `NORTH`/`NORTH_EAST`/.../`NORTH_WEST`). `RoomManageClient` 의 기존 매핑(대문자)과 일치시키고 소문자도 호환 유지. settings 폼 기준.

### P. 수납 UX 회귀 6건 (2026-05-30, b370207)
사용자 회귀 발견 → 한 번에 6건 잡음.

1. **PaymentEntryForm 금액 자동 프리필** — 미수 있으면(`balance<0`) 그 절댓값(보충액), 없으면 `expected`. `room` 데이터 바뀌면 useEffect 로 재프리필. settlement 에 `balance` 노출.
2. **보증금/청소비 분리 모드 체크박스 숨김** — 기본 숨김 + "보증금·청소비 함께 수납 ▾" 토글로 노출. 첫 달 외엔 거의 안 쓰여서.
3. **PrevOwnerSettleWidget 설명 명확화** — "메뉴 모드"(언제든 변경 가능) vs "양도인 정산 버튼"(계약당 1회) 구분 명시. 모호한 '한 번만' 제거.
4. **PaymentRecordList 레이아웃 재구성** — 줄1=회차·날짜·방법 + 금액(우측, nowrap), 줄2=뱃지(보증금/양도인/귀속월)+메모+액션. 셸 좁은 폭에서도 "귀속 5월" 안 잘리고 270,000원 안 줄바뀜.
5. **공실 '열 설정' 버튼 위치** — 페이지 하단(공실 섹션 헤더) → 상단 필터 행. 공실 0실에도 항상 노출. 라벨도 "공실 표시" 로 변경(메인 표 열 설정과 구분).
6. **StatusBadge sub 가독성** — "8일 초과" 등 색을 흰색(badge fg) → tone별 진한 톤(overdue=coral, unpaid=amber bg, ...)으로. `SUB_FG` 맵 추가. 옅은 행 틴트에서 가독성 회복.

### Q. 계약서 워드마크 색 fix (2026-05-30, 187cb6f)
- **증상**: 계약서 출력 페이지의 'made with 스테이음' 워드마크의 'eum'·Arch 가 브랜드 Terracotta(`#a03c2e`)가 아니라 다른 주황(`#e84a1a`)으로 노출. 메모리 `feedback_brand_wordmark` 위반.
- **수정**: `.made-with` 가 `--persimmon` 까지 오버라이드하던 거 제거. `'stay'` 만 톤 다운한 회색(`--ink: #4a4a4a`)으로 유지하고 `'eum'`·Arch 는 브랜드 색 그대로.

### R. A2 — Dead code 청소 (2026-05-30, 2e50e62) — 합계 −460줄
Phase 2.4c 와 2.3c 의 셸 마이그레이션 후 잔존한 페이지 내 잡동사니 정리. 기능 영향 0.

- **RoomsClient 1216 → 959 (−257줄)**
  · payment 모달 state 다수(`selectedRoom`·`paymentHistory`·`payDiscounts`·`prevOwner*`·`override*`·`payAmount`·`isDeposit*`·`edit*` 등)
  · 핸들러: `handleSavePayment`, `handle*Discount`, `handle*Payment`
  · 미사용 actions/lib imports(`savePayment`·`updatePayment`·`addRentDiscount`·`getPrevOwnerSettleState` 등 + `calcProRata`·`PRORATE_BASE_DAYS`·`fmtKorMoney` 등 UI 헬퍼)
- **TenantClient 3268 → 3073 (−195줄)**
  · 요청·컴플레인 탭 state, AI 분석 state, 상태 전환 미니폼 state
  · 핸들러: `transitionsFor()`, `startTransitionAction`, `runTransition`, `submitTransition`, `handleChangeDueDayAction`
  · 상태 전환 미니폼 JSX 블록
  · 미사용 imports(`analyzeTenantWithGemini`·`applyStatusTransition`·`*TenantRequest` 등)
- **RoomManageClient 1297 → 1289 (−8줄)** — 잔여 주석·미사용 imports(`Loading`/`Badge`/`kstMonthStr`/`withSave`)

**KEEP**: 페이지 자체 카드/필터/정렬/검색·편집 폼·일괄 편집·새 등록 모달.

### S. NotificationBell 청소 (2026-05-30, 37ee518)
- **메모 기록상**: 종 본문·딥링크 미구현. 실제 코드 점검 결과 `NotificationBell` 은 이미 완성됨(`computeAlerts()` 단일 소스, dropdown, 점 색, 딥링크, 읽음 처리 localStorage, "모두 확인", "대시보드에서 보기").
- **잔재만 청소**: 딥링크 URL 의 옛 `&tab=info` 파라미터 제거. Phase 2.3c 후 탭 시스템 사라져서 무용. 셸 진입 정상.

### T. B 잔여 — 푸시 발송 내역 히스토리 (2026-05-30, 18f451c)
- **신규 model `PushHistory`** — `userId`·`source`('cron-daily'|'test')·`title`·`body`·`url`·`badge`·`tag`·`endpointCount`·`successCount`·`sentAt`. 인덱스 `(userId, sentAt DESC)`.
- **`migrate_push_history.sql`** — 테이블 + 인덱스 + FK(`auth.users` cascade) + RLS.
- **cron `/api/cron/push-alerts`** — webpush 발송 후 `prisma.pushHistory.create({source:'cron-daily', endpointCount, successCount})`. 실패해도 푸시 자체엔 영향 X.
- **`sendTestPush`** — 동일하게 `source: 'test'` 로 row 적재.
- **server action `getMyPushHistory(limit=20)`** — 본인 앞 발송 row.
- **신규 `PushHistoryList`** 컴포넌트 — 펼침/접힘, 소스 라벨링(매일 알림/테스트), 상대시간(`방금/분/시간/일 전`), 성공/시도 카운트. 설정 페이지의 `PushToggle` 안에 통합.
- ⚠️ **푸시 전 SQL 적용 필요**: `migrate_push_history.sql`.

### U. #18 후속 — 안드로이드 뒤로가기 google.com/accounts 노출 회귀 (2026-05-30, 2ed5529)
- **증상**: 로그인 후 안드로이드 시스템 백 누르면 google.com/accounts 가 노출됨. 이전 fix(`acb593e`)는 `/callback` 재진입만 막았고 Google OAuth 페이지 자체가 히스토리에 남는 건 그대로였음.
- **수정 2단계**:
  1. `LoginButton` — `skipBrowserRedirect: true` + `window.location.replace(data.url)` 로 Google 이동 → `/login` 이 history 에서 제거.
  2. `/callback` 의 redirect URL 에 `?_fa=1` 부착 → 신규 `AuthBackTrap` 컴포넌트가 첫 popstate 1회 만 소비(`replaceState` 로 `_fa` 제거 + `pushState` 더미 + `popstate` 핸들러 1회 후 해제).
- **마운트**: `AuthBackTrap` 을 root `app/layout.tsx` 에 단일 마운트. `_fa=1` 없으면 no-op 이라 다른 페이지 영향 0.

### V. OCR 트랙 — "찍어 올리기" 패러다임 (2026-05-30~05-31)

**V-1. OCR MVP** (2026-05-30, a2253ba)
- **사용자 비전**: 영수증/물품 사진 찍어 올리면 앱이 분류·요약하고 사용자 검토 후 승인. 직접 입력 패러다임의 대안.
- **신규 model `PendingReceipt`** — `propertyId`·`uploaderId`·`imageUrl`·`driveFileId`·`status`(pending/approved/rejected)·`inferredKind`/`Vendor`/`Date`/`Amount`/`Category`·`parsedJson`·`linkedExpenseId`·`createdAt`·`reviewedAt`.
- **`migrate_pending_receipts.sql`** — 테이블·인덱스·FK·RLS.
- **server actions `app/(app)/dashboard/pendingReceipt.ts`**:
  · `uploadPendingReceipt` — Drive 업로드 + Gemini 2.5-flash 분류('expense'/'inventory'/'unknown') + 필드 추출. AI 실패해도 row 적재(수동 처리 가능).
  · `getPendingReceipts` — 현재 영업장 pending 리스트.
  · `approvePendingReceipt(id, final)` — Expense 생성 + `status='approved'` + `linkedExpenseId`.
  · `rejectPendingReceipt(id)` — `status='rejected'`.
- **`PendingReceiptSection`** — 📸 사진 올리기(camera capture) + 대기 카드 리스트(썸네일·AI 분류 뱃지·요약·등록/거절). 등록 시 인라인 폼(날짜·금액·카테고리·상호·메모) 프리필 후 확인.
- 마운트: `DashboardClient` 의 `AlertsStrip` 다음 행.
- ⚠️ **푸시 전 SQL 적용 필요**: `migrate_pending_receipts.sql`.

**V-2. 재고 분류 케이스 처리** (2026-05-30, f334bef)
- 이전엔 `'inventory'` 분류된 사진은 거절 후 재고 페이지 수동 이동만 가능.
- **AI 프롬프트 확장** — `itemLabel`·`specValue/Unit`·`qtyValue/Unit` 도 추출 ('신라면', '300ml', '6봉지').
- **`approvePendingReceipt` 시그니처 확장** — optional `itemLabel`·`spec*`·`qty*`. 그대로 Expense row 에 저장 → 재고 모듈이 `TRACKED_CATEGORIES`(부식비/소모품비/폐기물 처리비) + `itemLabel` 패턴으로 자동 인식. `revalidatePath('/inventory')` 추가.
- **UI 분기** — 카드에 [지출 등록] + [재고 등록] + [거절] 3액션. AI 추론에 맞춰 강조 색(지출=coral, 재고=green). `editingMode = 'expense' | 'inventory'`. 재고 모드면 폼에 품목명·규격·수량 필드 + 카테고리는 추적 가능 3개로 제한.

**V-3. 영수증 모서리 돋보기 + 계약서/신분증 OCR** (2026-05-31, 14ec148)

1. **CornerLoupe (영수증 모서리 확대경)** — `FinanceClient` 의 `ReceiptScanModal`:
   - 드래그 시작 시 활성 코너 위(공간 부족 시 아래) 120px 원형 확대경 표시.
   - 원본 비트맵에서 코너 중심 영역 잘라 2.8× 확대 + 십자선·중심점.
   - 손가락이 코너 가려도 픽셀 단위 정밀 조정 — 모바일 필수 UX.
   - `CornerHandle` 에 `onStart`/`onEnd` 콜백 추가, `activeCorner` state 로 토글.

2. **계약서 OCR — `analyzeContractWithGemini`** (tenants/actions):
   - 추출 필드: 이름·영문이름·성별·국적·생년월일·직업·주연락처·비상연락처·관계·호실·월세·보증금·청소비·납부일·입주일·계약만료.

3. **신분증/외국인등록증 OCR — `analyzeIdCardWithGemini`** (tenants/actions):
   - 추출: 이름·영문이름·성별·생년월일·국적.
   - 주민번호 앞 7번째 숫자로 19YY/20YY 변환 가이드(내·외국인 5/6/7/8 포함).

4. **`OcrToolbar`** — 입주자 등록·편집 폼 최상단 마운트:
   - 버튼 [📄 계약서] / [🪪 신분증] + camera capture.
   - controlled state(`rentAmount`/`depositAmountVal`/`cleaningFeeVal`/`selectedRoomId`/`applyDueDay`)는 직접 setter.
   - uncontrolled `<input name="X">` 들은 React 네이티브 value setter 트릭(`Object.getOwnPropertyDescriptor(...).set.call(el, value)` + `input`/`change` 이벤트 dispatch)으로 채워서 onChange 가 정상 트리거.
   - 호실은 `roomNo` 정규화 매칭으로 select 옵션 자동 선택.
- ⚠️ **사용자 안내**: 추출 결과 자동 입력. 한글 이름이 영문 칸에 들어가거나 호실 매칭 실패 등 오인 가능 → 반드시 확인 후 저장.

### V-2 (2026-05-31, W 전). 매출 인식 일관성 + 단기·중도퇴실 lease 매출 누락 fix

**버그**: dashboard `totalExpected` / `totalRevenue` 가 ACTIVE/CHECKOUT_PENDING/NON_RESIDENT lease 만 합산. CHECKED_OUT 단기 입주(예: 422호 파트쿨리나 5월 262,500) + 거주 중 중도퇴실(예: 507호 정종학 5/1 5월 귀속 370,000) 매출이 KPI 카드·손익 현황에서 누락.

**원인**: status 필터링이 50+ 곳에 산재. 같은 "매출 인식 대상" 의도인데 곳마다 다른 status 조합. 새 케이스 추가 시 모든 곳을 수동 업데이트 필요.

**조치**:
- `app/(app)/dashboard/page.tsx` totalExpected 에 CHECKED_OUT 의 그 달 귀속 paymentRecord 합 추가 (`a25d6c9`)
- 같은 정책으로 totalRevenue 에도 CHECKED_OUT 입금 인식 (`e0c7cb3`)
- 회귀 방지: `lib/leaseStatus.ts` 신설 — `BILLABLE_STATUSES`, `CURRENT_OCCUPANCY_STATUSES`, `TENANT_LIST_STATUSES`, `CLOSED_STATUSES` 상수화 + `getCheckedOutLeasesWithRevenue()`, `getCheckedOutRecognizedRevenue()` 헬퍼. dashboard 인라인 쿼리 2곳 → 헬퍼 호출로 교체.

**확인된 안전 지점**: dashboard 6개월 trend 는 paymentRecord 기반이라 영향 없음.
**아직 미정정 (영향 작음)**: report 결산 보고서의 미수·임대료 분포 — ACTIVE/CHECKOUT_PENDING 만 기준이지만 통계 용도라 단기 미수 사례에서만 의미 있음. 필요 시 별도 작업.

### V-3 (2026-05-31). 그 외 작업
- /tenants 퇴실자 클릭 → Prism 수납 face (getLeaseSettlementInfo fallback) — `c5019f4`
- Prism [수정] 클릭 시 편집 폼 안 열리는 버그 (useEffect deps 비어있음) — `a1c266a`
- 수납 관리 필터 '임시 조정' 탭 추가 — `976c092`
- PaymentRecordList 회차 표시: DB seqNo(귀속월 기준) → 화면 순(payDate asc index) — `c5019f4`
- StatusBadge sub 가독성: badge-bg(옅음) → badge-fg(진함) — `c5019f4`
- 재고 월별 사용량 막대 + 숨김 UX + 김치 수령일 자동 동기화 (StockCheck.sourceExpenseId) — `5853921`

### V-4 (2026-06-01). 결산보고서 매출 통일 + UI 다듬기 + 재고 사용량 정확성

**결산보고서 매출 dashboard 통일 (`13df2a7`)**: 호실 단위 baseRent 기반 → lease 단위 BILLABLE_STATUSES + CHECKED_OUT recognized 정책으로 통일. 5월 expectedRevenue 14,720,000 → 15,592,500 = dashboard `totalExpected` 와 완전 일치. `lib/leaseStatus.ts` 헬퍼 재사용.

**하단바 즉각 피드백 + 확대경 경계 fix (`04d6e94`)**:
- BottomNav: pendingHref state + useTransition. 클릭 즉시 그 탭 색이 coral 로 + 옅은 배경. pathname 변경 시 자동 해제. active:bg 잔물결.
- CornerLoupe (영수증 OCR 모서리 확대경): source 사각형이 bitmap 밖으로 벗어날 때 destination 위치를 같은 비율로 이동해 핸들 위치가 캔버스 중앙에 유지되게. 잘려 나간 부분은 fillRect 의 흰색 반투명으로.

**Prism 수정 폼 + OCR 토글 + 스크롤 복원 + 계약서 출력 모달 (`c33430c`, `1475282`)**:
- TenantForm 수정 모드에 `ContractFilesPanel` 추가 — 뷰어와 동일 UX 로 스캔본 첨부·삭제 가능.
- '계약서 링크' → '외부 계약서 링크 (Google Drive·Dropbox 등, 선택)'.
- OcrToolbar 기본 접힘 + 펼치기 토글, '(선택)' 명시. 신분증 사진 강요 느낌 완화.
- EntityModalProvider 가 open 직전 `window.scrollY` 저장 → close 시 RAF + 150ms 후 두 번 복원. router.refresh() 의 상단 리셋 회피.
- 계약서 출력: 스캔본 있으면 3-버튼 모달 (`스캔본 출력` / `시스템 계약서 새로 출력` / `취소`). confirm() 의 [확인]/[취소] 패턴이 사용자 의도와 안 맞아 분리.

**모바일 카드 customize + 라벨 명확화 (`c33d0a9`, `a5d60cb`, `7c4c92e`)**:
- 수납 관리 헤더 버튼 라벨 명확화: `공실 표시` → `공실 카드 항목`, `열 설정` → `표시 항목`.
- 모바일에서 `표시 항목` 노출 (이전 hidden sm:block 제거).
- 모바일 입주 카드에 `colVis` 적용 — 타입·연락처·월이용료·미수/예정·납부일·보증금·총납부액 토글 가능. `type` defaultOn true 로 회귀 방지.
- `공실 표시` 드롭다운이 모바일에서 좌측으로 잘리던 문제: 두 버튼을 ml-auto flex 그룹으로 묶어 wrap 새 줄에서도 우측 정렬.

**고정지출 silent fail (`cdefb2e`)**:
- 고정지출 저장 시 액션 응답 ok/error 미체크 → DB 변경 안 됐는데 폼 닫히거나 사용자 재시도로 중복 등록.
- `handleSaveRec` / `handleDeleteRec` / `handleToggleRec` 에 try/catch + ok 체크 + showToast + router.refresh().

**재고 위치별 점검 carryOver + 데이터 보정 (`e206764`)**:
- 품목별 점검 폼 (`CheckForm`) 에서 위치 일부만 입력하면 나머지가 0 으로 처리되어 다음 점검에서 "큰 소모" 로 오인되던 문제.
- `createStockCheck` 에 `carryOverFromLastCheck` 옵션 추가 — 입력 안 한 위치는 직전 점검에서 자동 보존. CheckForm 이 그 옵션으로 호출.
- `scripts/fix-stockcheck-carryover.ts` 로 과거 손상 데이터 보정 (적용): 주방세제 +2670 / 김치 +4 / 세탁세제 +19 / 수세미 +1. 라면·쌀은 위치 누락 없음 — 별개 이슈.

**같은 날 여러 점검 dedup (`9cebcc1`)**:
- `overview.ts` 에 `dedupSameDay` 헬퍼 — 같은 UTC 날짜 점검 중 가장 늦은 createdAt 만 유효.
- `it.stockChecks` (take 2→10) + `allChecksForUsage` 양쪽 적용.
- 사용자가 같은 날 임시 점검 후 확정 점검을 다시 할 때 두 점검 사이 잔량 jump 가 사용량으로 누적되던 문제 fix.

**타임라인 정렬 receivedAt 기준 + 세탁조크리너 정리 (`13d568b`)**:
- 구매(purchase) entry 의 시간 기준이 createdAt(=입력 시각)이라 과거 수령분을 늦게 입력하면 위치가 어긋남.
- 정렬 키 변경: purchase 는 receivedAt 우선 → date/createdAt fallback. 동률 시 type 우선순위 check > addition > purchase (점검이 수령 위).
- 세탁조크리너 데이터: 부식비 → 소모품비 카드 이전 + Expense itemLabel null 채움.

**월별 사용량 막대 숫자 노출 (`599d256`)**:
- '월별 사용량' 인데 합계만 보이고 막대만 있어서 각 월 사용량을 알기 어려움.
- 각 막대 위에 그 달 사용량 숫자 표시 (1000+ k 축약). 합계는 우측 상단 작게.

**📌 라면 187·쌀 159 같은 큰 값의 진짜 원인**:
- 위치 누락(3)·같은 날 dedup(4)·정렬(5,6) fix 후에도 잔존.
- 원인: 점검 잔량 또는 구매 수량 자체의 입력 오류 (예: 라면 5/12 135 → 5/13 207 = +72 점프 + 같은 시점 구매 160. 기대 135+160=295 vs 실제 207 → 88 차이가 가짜 "사용량" 으로 누적).
- 코드로 자동 보정 불가. 사용자가 화면에서 직접 점검·구매 데이터 검토·수정 필요.

**월별 사용량 계산이 단순 차이가 아닌 이유 (사용자 설명 요청)**:
9가지 변수가 섞임: ① 구매(+) ② 무상입수(+) ③ 위치 여러 곳 ④ 같은 날 여러 점검 ⑤ 수령일≠입력일 ⑥ 자동 점검 vs 사용자 점검 시각 일치 ⑦ 점검 잔량 입력 오류 ⑧ "보충 전/후" 잔량 의미 혼재 ⑨ 자동 vs 수동 점검 신뢰도. 오늘 fix 들이 ①③④⑤⑥ 을 잡음.

### W. 남은 트랙 (다음 세션)
- **OCR 후속**: 보증금 반환·수익 분류 케이스, 더 다양한 분류(예: 임대료 영수증)
- **공실 안내 페이지 2단계** — 인앱 편집기 (큰)
- **Brand Guide v1.2 잔여 점검** — 상태색·radius 누락 부위 훑기 (작)
- **국가 서류 (H)** — 외국인 입주자 신고·신원 서류 (큰)
- **Phase 2.5 — 편집 모드 위젯화** — 호실/고객 편집 폼 → 셸에서 in-place 편집 (큰)
- **납입일 변경 인라인 폼** — Tenant 계약 정보 안 dueDay 변경 위젯 (작)

### W-검증. 사용자가 직접 돌려야 할 회귀 (2026-05-31 기준 미완료)
- **결제 정확성 회귀** — Phase 2.4 의 9개 시나리오(FIFO·할인·임시조정·영구변경·양도인정산·보증금분리·내역편집·삭제·납부).
- **OCR MVP 검증** — SQL 적용 후 영수증/물품/계약서/신분증 사진 올려서 분류·등록 흐름.
- **#18 뒤로가기 fix 검증** — 안드로이드에서 로그인 후 시스템 백 → google.com/accounts 안 뜨는지.

---

## 참고 / 주의사항
- AGENTS.md 세션 시작 규칙 — 매 세션 이 파일을 먼저 읽고 이어갈 것.
- 컨텍스트가 차오르면 /compact 또는 새 세션으로.
- rewind는 코드를 되돌리니 신중하게 — 컨텍스트 줄이는 용도로 쓰지 말 것.
- 배포: main push → Vercel 자동 배포. 일시 빌드 실패 시 재배포(`vercel redeploy <url>`)로 대개 복구.
