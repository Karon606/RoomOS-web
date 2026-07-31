# 전반 점검 컨텍스트 노트 (2026-08)

작업 중 내린 결정과 그 근거를 계속 덧붙인다. 새 세션이 같은 판단을 다시 하지 않도록.
사실은 `knowledge/`, 진행은 `checklist.md`, 계획은 `plan.md`.

---

## 2026-08-01 · 계획 수립

### 왜 페이지별이 아니라 축별인가
운영자 오더. 홈의 금액이 수납·지출·결산과 얽혀 있어서, 페이지 단위로 끊으면 같은 값을
서로 다른 페이즈에서 두 번 보게 되고 그 사이의 불일치는 아무도 못 본다. 유저가 하는 일(축)로
자르면 값이 흐르는 경로를 한 페이즈 안에서 끝까지 따라갈 수 있다.

### 왜 파일로 남기는가
운영자가 "토큰 문제로 중간에 끊길 수 있다"고 명시. 대화 컨텍스트에만 있으면 세션이 끊길 때
계획과 진행이 함께 사라진다. plan/checklist/context-notes 3종을 저장소에 두면 새 세션이
`checklist.md` 의 마지막 완료 항목부터 이어갈 수 있다.

### 초기 조사에서 나온 것 (가설이며 원인 아님)
전환·반응성(F) 축의 사전 조사에서 아래 지표가 나왔다. **어느 것도 원인으로 확정하지 않았다.**

- 셸 안 라우트 21개 중 자체 `loading.tsx` 를 가진 것은 9개, 없는 것이 12개.
  없는 라우트: accrual-check, settings, card-settlement, tenants, requests, snap-upload,
  rent-receipts, marketing, floor-plan, stats, room-manage, checklist
- `AppShell.tsx:35-36` 이 `const [, startNavigation] = useTransition()` 를 두고 주석에
  "isPending 미사용 — 전환 표시는 라우트 loading.tsx 스켈레톤이 담당" 이라고 적어 두었다.
  다만 `useStartNavigation` 실사용처는 `MonthSelector` 1곳뿐이고,
  `router.push` 를 `startTransition` 으로 감싼 곳은 **0건**으로 나왔다.
  → 처음 세운 "전환이 옛 화면을 붙잡는다" 가설은 그대로는 성립하지 않는다. 재조사 대상.
- 클라이언트 `router.push` 호출은 25곳.

**운영자 지적(중요)**: "11개만 로딩 화면을 가지고 있다고 거기서 단정하고 다른 페이지를
검토 안 하고 그러지는 마." → F 페이즈는 loading.tsx 유무와 무관하게 **전 라우트 35개를 전수**로 본다.

### 상시 대동 전문가에 마케팅 3인을 넣은 이유
운영자가 "UI/UX, 마케팅(홍보·광고·브랜딩 분리), 웹디자이너, 회계, AI 는 항상 대동" 이라고 지정.
축과 접점이 없는 전문가는 "해당 없음" 짧은 회신으로 끝내 토큰을 아끼기로 했다.

### 최우선 4대 점검축을 별도로 뽑은 이유
운영자가 "무엇보다 중요한 건" 으로 지목한 것들이다. 페이즈마다 흩어져 다뤄지면 누락되므로,
모든 페이즈에서 기계적으로 확인하는 공통 체크로 승격했다.
흐름 끊김 / 월 경계 파급 / 스크롤·전환 먹통 / 회귀.

---

## 2026-08-01 · F페이즈 조사 결과 (직접 확인한 사실만)

아래는 코드·실측으로 확인한 것이다. 원인 확정이 아니라 **확인된 사실**과 **가설**을 구분해 적는다.

### 확인된 사실 (코드에서 직접 봄)

1. `.delayed-fallback` 은 `--loader-delay: 300ms`(globals.css:231, 265) 로 스켈레톤을 300ms 늦게 띄운다.
   **붙은 곳은 `app/(app)/loading.tsx` 와 `app/(app)/dashboard/loading.tsx` 두 곳뿐.**
   → 자체 loading 이 있는 나머지 8개(contracts·finance·inventory·assets·market-analysis·report·
   residence-certs·rooms)는 **즉시** 스켈레톤. 같은 앱 안에서 전환 표시가 두 종류로 갈린다.
2. 셸 밖 라우트는 `app/loading.tsx`(전체화면 스플래시)를 폴백으로 쓴다.
   `SplashController.tsx:18-24` — DELAY 300 / MIN 1000 / FADE 400 / OFF_GRACE 400.
   **한 번 보이면 최소 1.4초 유지된다.** 서버가 301ms 에 응답해도 마찬가지.
3. 내비 링크 href 에 `?month=` 가 붙는다(Sidebar 222·259·393·414, BottomNav 85·117).
   프리페치 캐시 키는 쿼리 포함 전체 URL 이므로, **월을 한 번 바꾸면 모든 내비 링크의 프리페치가 무효화**된다.
4. `proxy.ts:34` 미들웨어가 모든 요청에서 `await supabase.auth.getUser()`(네트워크 왕복)를 한다.
   반면 `app/(app)/layout.tsx:28-30` 은 이미 `getClaims()` 로 옮겨가며 주석에 "중복 네트워크 왕복 제거"라 적어뒀다.
   **미들웨어만 옛 방식으로 남아 있다.** → 인증 로직이라 loop.md §4, 운영자 승인 대상.
5. `MonthSelector.tsx:87` 월 전환에 **350ms 디바운스**가 붙어 있고, 그 뒤 `startNavigation`(useTransition)으로
   push 한다. 트랜지션은 Suspense 폴백을 억제하므로 이 구간은 **표시가 전혀 없다.**
   `BottomNav.tsx:86-88` 주석이 같은 클래스를 이미 진단해 두었다(운영자 신고 2026-07-06) — 하단바에서만 제거됐다.
6. `AppShell.tsx:36` 이 `const [, startNavigation] = useTransition()` 으로 isPending 을 버렸다.
   주석은 "표시는 loading.tsx 가 담당"이라 적혀 있으나, 트랜지션이 그 폴백을 억제하므로 담당자가 없는 구간이 생긴다.
7. 코드베이스 전체에 `prefetch` 속성을 명시한 `<Link>` 가 **0개**. 전부 Next 기본값.

### 실측 (참고용, 환경 주의)

- 로컬(집 회선)에서 DB 단순 쿼리 왕복 28~1171ms, 복합 병렬 8쿼리 4222ms. **편차가 크다.**
  운영(Vercel)은 DB 와 가까워 다를 수 있으므로 이 수치로 단정하지 않는다.
- Vercel 로그에 같은 라우트 요청이 수 초 내 여러 번 찍힌다(예: 7/31 15:42 finance 7회). 프리페치로 추정.

### 스크롤 조사에서 확인된 것

- 과거 갤럭시 먹통 클래스(가짜 스크롤러 + overscroll-contain)는 **현재 0건**. 봉합 유지되고 있다.
- **새로 확인된 실제 결함**: floor-plan 이 셸 안에서 `h-screen` 사용(app/(app)/floor-plan/page.tsx:48),
  ConfirmDialog 에 스크롤러 부재(components/ui/ConfirmDialog.tsx:93-107), 자체 바텀시트 3종의
  키보드·안전영역 미대응.
- **내가 만든 회귀**: 2026-07-31 `DocumentScroll` 도입으로 B패턴 페이지에서 모달 배경이 스크롤된다.
  `Modal.tsx:21-24` 가 "셸이 overflow-hidden 이라 배경은 원래 안 움직인다"는 전제로 배경 잠금을 생략했는데,
  그 전제를 내가 깼다. `AddressSearch.tsx:78` 의 body 잠금도 html 이 스크롤러라 무효.
  → 운영자가 지목한 "새 기능이 기존 기능을 죽이는" 클래스의 실제 사례.
