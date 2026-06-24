# 감사 + 디자인 브리프 — 대시보드(홈) 통일 §23

> **이 문서는 Claude Design용 프롬프트 + 감사 자료다.** 아래 "프롬프트" 절을 그대로 넘기면 §23 정본 + HTML 목업 + handoff를 만들 수 있다.
> 사양 단일 출처: `docs/brand-guide-v1.3.md`(§09~§22). 충돌 시 가이드 우선.
> 근거는 모두 Claude Code 코드 감사(2026-06-24). 라인 번호는 감사 시점 기준(이후 시프트 가능). **추정은 "추정" 표기.**
> 홈 라우트 = `/dashboard` (사이드바 '홈', `components/layout/Sidebar.tsx:83`). 위젯은 대부분 `DashboardClient.tsx` 한 파일에 인라인.

---

## 프롬프트 (Claude Design에게)

스테이음(고시원/원룸텔 운영 앱)의 **대시보드(홈) 화면**을 하나의 디자인 언어로 통일하는 **브랜드 가이드 §23**을 만들어줘.
이미 통일된 재고(§21)·리스트/테이블(§22)과 **이질감 없이** 이어져야 함. **모든 기능·위젯은 유지**하되, 제각각인 KPI 카드·차트 색·진입 방식·반응형을 정리하고 **첫 화면에서 한눈에 들어오게** 만드는 게 목표.

### 산출물
1. **`docs/brand-guide-v1.3.md`에 붙일 `§23 대시보드·위젯` 절** (마크다운, §21·§22와 동일 형식) — 아래 정본 포함:
   - **23.1 KpiCard 정본** — 카드 1개당 **핵심 수치 1개**(§22 원칙) + 보조 1줄 구조. 타입(강조/일반/경고)별 배경·텍스트·radius·padding 규격. 현재 7개 KPI가 배경(coral 다크 vs cream 라이트)·수치 개수 제각각.
   - **23.2 차트 색 매핑 정본** — 개념(수입·지출·기타수익·보증금·예비비·완납·예정·미납·연체)별 **고정 색 토큰** 1:1. recharts와 자체 DonutChart가 같은 개념에 같은 색 쓰도록. raw hex 전면 토큰화(§14.4).
   - **23.3 위젯 카드 셸** — 위젯 공통 컨테이너(bg·border·radius·padding·헤더·진입 표시) 정본. 재고 InventoryCard/§22와 정합.
   - **23.4 진입(네비) 규칙** — 페이지 이동=Link / 상세=entityModal / 폼=Modal(width 규격 sm·md·lg) 표준. 현재 5가지(Link·router.push·Modal·entityModal·window.location.href) 혼재.
   - **23.5 반응형 그리드** — KPI·차트·방현황의 sm/md/lg 컬럼 정본(현재 lg만, sm/md 거의 미사용 → 모바일 KPI가 항상 2열).
   - **23.6 빈·로딩 정본** — 위젯별 Skeleton(§16·§18) — 현재 전부 텍스트만, 스켈레톤 0.
   - **23.7 상태·연체 배지** — 완납/예정/미납/연체/공실 배지 + 경과일 표기 규칙(현재 "연체 D+"가 7일↑만).
2. **HTML 목업** — 기존 가이드 HTML과 동일 토큰·컴포넌트로, 대시보드 (KPI 그리드 / 현황·재무·입주자 탭 / 모바일·데스크탑 / 빈·로딩) 상태.
3. **handoff** (`claude-code-handoff-dashboard.md`) + 근거 노트 + 사용 토큰·컴포넌트 목록.

### 반드시 지킬 것 (가드레일)
- 데이터·위젯·기능 삭제 금지. 아래 인벤토리의 모든 동작 유지.
- 기존 토큰·컴포넌트 재사용, **새 hue 추가 금지**(§14.4 무지개 디톡스). raw hex(아래 census)는 의미색 토큰으로 1:1 치환.
- 모바일 우선, 한국어, 따뜻한 크림/테라코타. 재고(§21)·리스트(§22)와 정합(SelectionPillBar·StatusBadge·Modal·Btn·MoneyDisplay 등 공용 그대로).
- §14.4 의미색·§15 금액(tnum)·§16 빈/로딩·§17 반응형·§22 "수치 1개" 정본 준수.

### 참고
- 가이드: `docs/brand-guide-v1.3.md`(§09~§22) + `stayeum development/stayeum Design/stayeum Brand Guide/stayeum Brand Design Guide v1.2.html`
- 통일 참고 구현: `components/ui/inventory/`(§21), `components/ui/`(StatusBadge·Btn·Modal·MoneyDisplay·SegmentedControl·Loading·EmptyState), `lib/chartColors.ts`(CHART_COLORS)

---

## 1. 위젯 인벤토리 (코드 사실)

파일 = `app/(app)/dashboard/DashboardClient.tsx` (별도 표기 없으면), 데이터 = `page.tsx`/`actions.ts`/`alerts.ts`/`unpaid.ts`/`pendingReceipt.ts`. 라인은 감사 시점.

| 위젯 | 라인 | 역할 | 표시 데이터 | 진입(클릭) |
|---|---|---|---|---|
| 알림 스트립 | ~1895 | 긴급/예정 알림 그룹 | 미수·도래·퇴실·입주·투어·희망호실·요청·고정지출·재고 ~9종 | 모달(AlertDetailModal)→액션/하위페이지 |
| 찍어 올리기 | ~1898 (PendingReceiptSection) | 영수증·물품 사진 AI 분류 큐 | 이미지+AI추론(카테고리·금액·날짜) | 지출/재고 등록 모달 |
| 예상 매출 | 1905–1931 | KPI | 예상매출(원)·달성율(%)·수납/예정/미납 건 | `<Link>` /rooms |
| 예상 순이익 | 1935–1976 | KPI | 순이익(원)·지출반영율(%)·현재장부·남은예정·예비비이체 | `<Link>` /finance?tab=reserve |
| 누적 미납 | 1979–1996 | KPI | 미납(원)·미납건수·도래미회수·납부예정액 | `<Link>` /rooms |
| 예상 지출 | 2000–2037 | KPI | 예상지출(원)·3단계 스택막대·전월/전년 비교(%) | `<Link>` /finance?tab=expense |
| 보유 보증금 | 2040–2049 | KPI | 보증금 합계(원) | `<Link>` /finance?tab=deposit |
| 보유 예비비 | 2052–2069 | KPI | 예비비 잔고·이달 적립/인출 | `<Link>` /finance?tab=reserve |
| 입실 현황 | 2072–2083 | KPI | 현입주/전체(분수)·공실수 | `<Link>` /room-manage |
| 방 현황 그리드 | 2115–2276 | 호실 상태 카드(차원 선택) | 호실·입주자·월임차료·상태(완납/예정/미납/공실) | `entityModal.open()` room |
| 비거주자 현황 | 2279–2310 | 비거주자 카드 그리드 | 호실·비거주자·월임차료·상태 | **`window.location.href`** |
| 이달 미수납 | 2318–2379 | 좌측 리스트(Top5) | 미수건수·입주자·호실·경과일·미납액 | DashboardTenantModal |
| 납입 완료 | 2385–2436 | 좌측 리스트(Top5) | 납입건수·입주자·호실·시간·입금액 | DashboardTenantModal |
| 추이 차트 | 782–920 (재무탭) | 기간별 수입·지출 | 일/주/월/분기/반년/연/전체 | 범위 버튼(차트 재렌더) |
| 지출 카테고리 | 923–943 (재무탭) | 도넛 + 비중 | 총지출·카테고리별 금액·% | `<Link>` /finance?tab=expense |
| 수납 현황 | 945–975 (재무탭) | 도넛 + 상태 | 수납률·완납/예정/미납 건 | `<Link>` /rooms |
| 입주자 현황(호실) | 1005–1020 (입주자탭) | 도넛 + 입주율 | 입주율·거주중/공실/전체 | `<Link>` /room-manage |
| 상태별 현황 | 1022–1036 | 도넛 | 거주중/예약/퇴실예정 | 진입 없음 |
| 성별 분포 | 1038–1052 | 도넛 | 남/여/기타 | 진입 없음 |
| 국적 분포 | 1055–1059 | 수평 바 리스트(Top6) | 국적별 명수·% | 진입 없음 |
| 직업 분포 | 1060–1064 | 수평 바 리스트(Top6) | 직업별 명수·% | 진입 없음 |
| AI 분석 | 1119–1157 (AI탭) | Gemini 스트림 분석 | 재무 기반 AI 텍스트 | 'AI 분석하기' → API |

탭 구조: **현황 / 재무 / 입주자 / AI** (SegmentedControl, sticky).

## 2. 색 사용 census (§14.4 정합 검사)

**의미색 토큰은 다수 사용** (DashboardClient 기준 census): `--warm-muted`×92, `--warm-border`×55, `--warm-dark`×47, `--warm-mid`×42, `--coral`×40, `--success`×13, `--tc`×12, `--viz-4`×9, `--persimmon`×8, `--viz-2`×2, `--badge-overdue-*`, `--status-{paid/unpaid/await/vacant}-*`, `--deposit-*`, `--accent-reserve`.

**⚠️ raw hex (인라인 style) — §14.4 무지개 디톡스 위반, 토큰 치환 필요:**
| hex | 의미(코드상) | 치환 후보 |
|---|---|---|
| `#22c55e` 녹색 | 입주 확정·희망호실 매칭 | `--success-fg` |
| `#eab308` 노랑 | 퇴실예정 | `--warning-fg` |
| `#d4a847` 황갈 | 투어예정·재고부족 | `--inspect-fg` 또는 `--warning-fg` |
| `#6366f1` 남보라 | 고정지출 | `--deposit-fg`/`--info-fg` (디자인 결정) |
| `#dc2626` 빨강 | 미납 경과 | `--danger-fg` |
| `#a855f7` 보라 | 투어대기 | `--deposit-fg` |
| `#f59e0b` 주황 | 양도인 수납 | `--info-fg`(양도인=info 별칭) 또는 별도 |
| `#64748b` 슬레이트 | 추이 차트 '지출' bar | `--warm-mid`/`--ink` 계열(디자인 결정) |

**--viz-* 토큰**: `--viz-2`(보라)·`--viz-4`(노랑)만 사용, `--viz-1/3` 등은 미사용/미정의(추정 — census상 미검출). 차트 색은 `lib/chartColors.ts`의 `CHART_COLORS` 배열 + `chartColor(i)` 동적 함수.

**연체(OVERDUE) 단계 — ✅ 대시보드에 존재:**
- `page.tsx:1001–1003` `overdueByLease`·`overdueAmount`(도래·미회수 집계), `page.tsx:1049` `daysOverdue`(첫 미수월 경과일)
- `DashboardClient.tsx:2351–2355` `l.daysOverdue >= 7` → **"연체 D+{일}" 배지**, 색 `--badge-overdue-bg/fg`
- 누적 미납 KPI(1979–1996)에 도래·미회수 강조.

## 3. 레이아웃·반응형 (코드 클래스)

- **KPI 그리드**: `grid grid-cols-2 gap-3.5` (1901) — **항상 2열, sm/md 분기 없음** → 모바일에서 세로로 길어짐.
- 재무탭 상단 KPI: `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5` (826).
- 차트: `grid grid-cols-1 lg:grid-cols-2 gap-4` (922) / 입주자 도넛 `grid-cols-2 lg:grid-cols-3` (996).
- 방 현황: `gridTemplateColumns: repeat(5, minmax(0,1fr))` — **5열 고정**(2257·2268), 비거주자도 5열(2285).
- 메인: `grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3.5` (2109) — 우측 320px 고정.
- 탭 sticky: `sticky -top-4 md:-top-6` (2089).
- **요약**: `lg:`는 자주, `sm:/md:`는 거의 미사용. 위젯 순서: 기간셀렉터→알림→찍어올리기→KPI→탭(현황/재무/입주자/AI).

## 4. 수치·차트 표기

- **금액 tnum**: ✅ KPI 수치 `className="mono tnum"` + 인라인 `fontSize`. 리스트 `fmtKorMoney()`(2360·2418), recharts Tooltip formatter `toLocaleString()`.
- **KPI 카드당 수치 개수 (§22 "수치 1개" 검사):** 예상매출 **3**, 예상순이익 **3**, 누적미납 **2**, 예상지출 **2**, 보유예비비 **2**, 입실현황 **2** → **위반**; 보유보증금 **1** → 준수. (감사 기준 7개 중 6개가 복합 정보 카드.)
- **차트 라이브러리/색 지정:**
  - 추이: recharts AreaChart(`fill=url(#gradRev)` + `stroke=var(--coral)`) / 월↑ BarChart(`fill=var(--coral)` 수입, **`fill="#64748b"`** 지출 — hardcoded).
  - 지출 카테고리: 자체 SVG DonutChart, `chartColor(i)`(CHART_COLORS 동적).
  - 수납 현황: 자체 DonutChart, hardcoded `var(--persimmon)`·`var(--sun)`·`var(--cream-3)`.
  - 호실/상태/성별: 자체 DonutChart, STATUS_COLORS/GENDER_COLORS.
  - **불일치**: 같은 '수입'이 추이=`--coral` vs 수납도넛=`--persimmon`; '지출'이 추이=`#64748b` vs 예상지출막대=`--ink-2`/`--warm-mid`/`--coral`.

## 5. 빈·로딩 상태

- **skeleton 컴포넌트: ❌ 전무.** 위젯은 모두 텍스트 또는 기본 spinner.
- 방 현황 0개→텍스트(2123), 미수납/납입 빈→텍스트(2331·2397), 분포 0→"데이터 없음"(759), 지출도넛 빈→텍스트(925), AI→spinner+텍스트(1138), 찍어올리기→"불러오는 중…"/"대기 항목 없음"(PendingReceiptSection.tsx:88).
- 모달 로딩: DashboardTenantModal 다이아몬드 spinner(1378), TenantQuickModal `<Loading/>`(1713).
- page.tsx = 서버 RSC(초기 직렬화). **`dashboard/loading.tsx` 없음**(추정 — 디렉터리 리스트에 미검출).

## 6. 핵심 불일치 목록 (§23 과제)

1. **KPI 카드 배경 불규칙** — 예상매출/순이익은 `var(--coral)`/`var(--np-card-bg)`(다크), 나머지 4개는 `var(--cream)`+border (1905·1947·1979·2000·2040·2052). 시각 계층 제각각.
2. **KPI 수치 계층 없음** — 6/7 카드가 핵심+보조 구분 없이 여러 수치(§22 위반).
3. **수입 색 다중 정의** — `--coral`(추이·예상매출) vs `--persimmon`(수납도넛) (860·812·1905).
4. **지출 색 hardcoded** — 추이 bar `#64748b` vs 예상지출 막대 `--ink-2`/`--warm-mid`.
5. **경고/위험 색 중복** — 미납 `--tc` + `#dc2626`(같은 빨강) + 배지 `--badge-overdue-*` (1983·2359·page.tsx:1274).
6. **진입 5종 혼재** — `<Link>`·`router.push`·DashboardTenantModal·`entityModal.open()`·`window.location.href`(비거주자 2298).
7. **모달 width 혼재** — DashboardTenantModal=md, TenantQuick/AlertDetail/CheckoutRefund=sm, 용도 기준 불명확.
8. **반응형 미흡** — KPI 항상 2열(sm/md 분기 없음), 방현황 5열 고정 → 모바일 협소.
9. **빈/로딩 텍스트만** — skeleton 0, 위젯별 메시지 제각각.
10. **연체 배지 기준** — 7일↑만 "연체 D+", 1~6일 경과 미납은 배지 없음.
11. **글자 크기 인라인 hardcode** — `style={{fontSize:'0.65625rem'…}}` 다수, 클래스/토큰 미통일.

## 7. 가이드로 충분 vs §23이 정할 것

### (a) 가이드(§14.4·§21·§22)로 이미 충분 (Code가 바로 적용 — 디자인 갭 아님)
- 의미색 토큰 체계(`--success/--warning/--danger/--info/--inspect/--deposit/--reserve/--neutral`) — raw hex를 1:1 치환만 하면 됨.
- 공용 컴포넌트(StatusBadge·Btn·Modal·MoneyDisplay·SegmentedControl·Loading·EmptyState) 재사용.
- 금액 tnum(§15), 간격 단위(gap-3.5 등) 일관.
- `loading.tsx`(§18) 패턴 — 재고에서 이미 적용해둔 방식 그대로 대시보드에 추가 가능.

### (b) §23이 새로 정해야 할 갭
1. **KpiCard 정본** — 핵심수치 1개+보조, 타입(강조/일반/경고)별 bg·텍스트·radius·padding.
2. **차트 색 매핑** — 개념별 고정 토큰(수입·지출·기타수익·보증금·예비비·완납·예정·미납·연체) — recharts·DonutChart 공통.
3. **진입 규칙** — Link/entityModal/Modal(width sm·md·lg) 표준, `window.location.href` 제거.
4. **반응형 그리드** — KPI·차트·방현황의 sm/md/lg 컬럼 정본(모바일 1열 등).
5. **빈·로딩** — 위젯 Skeleton 정본(§16·§18).
6. **상태·연체 배지** — 완납/예정/미납/연체/공실 + 경과일 표기 규칙(1일부터? 7일부터?).
7. **위젯 우선순위·fold** — 첫 화면 우선 정보.
8. **타이포 토큰화** — 인라인 fontSize → 클래스/토큰 계층(라벨·본문·수치·제목).
