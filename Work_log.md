# 스테이음 작업 로그

마지막 업데이트: 2026-05-25
브랜치: main

## 완료된 것

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

### A. 우선순위 높음 — 운영자(슈퍼관리자) 대시보드 + 베타 접근 관리
- 앱 안 운영자 전용 영역(/admin 또는 (admin) 그룹). 슈퍼관리자 역할 신규 필요(현재는 영업장 단위 UserPropertyRole만).
- 담을 것: 전체 가입자 조회(실명·이메일·전화·주소), 가입 승인/거절, 영업장 현황·통계.
- 베타 게이팅(당장 필요 — 제한된 테스터만): 가입해도 운영자 승인해야 기능 해제. 쿠폰·초대 코드(선착순 N명 무료).
- 결제·구독(PG)은 추후(쿠폰·승인이 임시 운영 수단): 포트원·토스페이먼츠, 플랜·7일 체험·쿠폰·웹훅·기능 게이팅.

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
- 재고 이월분: 현재 '마지막 점검 잔량' 기준(점검 후 입수분 미반영) — 정확도 개선 여지.

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

### L. 대시보드 동적 알림 센터 (Dynamic Notification Center) — 나중에, 논의 필요 (2026-05-23 제안)
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
