# 스테이음 작업 로그

마지막 업데이트: 2026-05-27
브랜치: main

## 완료된 것

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
  2. **env `SUPER_ADMIN_EMAILS`** 설정 — 로컬 `.env.local` + Vercel(prod/dev). 예: `SUPER_ADMIN_EMAILS=gunwoo80@gmail.com`. (미설정 시 DB `isSuperAdmin`만으로 운영자 식별 → 첫 운영자 부트스트랩 곤란하니 env 권장.)
  3. 현재 로컬만·미푸시 — 다음 작업과 묶어 push 예정.

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

### D. 영업장 구성원 초대·참여 — 미구현 (두 흐름 다 지원, 2026-05-18 결정)
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
- 공개 페이지 `stayeum.com/stay/<슬러그>`. 바로 할 일: thestay-jegi(순수 정적 HTML) → public/stay/thestay-jegi/.
- 비전: 회원이 각자 페이지 제작·관리 + 유입 트래킹(페이지뷰·referrer/UTM) 대시보드 노출.

### H. #6 국가 서류·양식 페이지 (별도 세션 권장)
- DocumentTemplate 모델 신규. 카테고리·태그 + 다운로드 링크/파일 업로드 + 안내 링크.

### I. 작은 개선 (자투리)
- ✅ 고객 폼: 입주희망일을 상태 클러스터로 이동 (2026-05-23 완료, feat/quick-polish).
- ✅ 통합모달 도입 후 죽은 서브모달 코드 정리 (2026-05-23 완료).
- ✅ 재고 이월분: 점검 후 입수분 반영 완료 (2026-05-27, `fea5c4d`). 점검 잔량 + 점검 이후~월초 입수(구매수령·무상) 합산, 내역 표시.

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
- **남은 여지**: 카테고리별 차등 임계값(현재 전역 2일), 긴급 항목 within-group 부분펼침(B안 요소)은 필요 시.

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

---

## 참고 / 주의사항
- AGENTS.md 세션 시작 규칙 — 매 세션 이 파일을 먼저 읽고 이어갈 것.
- 컨텍스트가 차오르면 /compact 또는 새 세션으로.
- rewind는 코드를 되돌리니 신중하게 — 컨텍스트 줄이는 용도로 쓰지 말 것.
- 배포: main push → Vercel 자동 배포. 일시 빌드 실패 시 재배포(`vercel redeploy <url>`)로 대개 복구.
