# 스테이음 작업 로그

마지막 업데이트: 2026-05-22
브랜치: main (17cfc3a)

## 완료된 것

- **리브랜딩 3·4단계 — 컴포넌트 미세조정 + 검증** (2026-05-22 세션):
  - 소규모 정합: 비토큰 빨강·토글 knob bg-white→cream·토스트 반경 (c9d7e6d)
  - **버튼 마이그레이션 73개** → 공유 Btn (인라인 style·className CTA, 토글 제외)
    (55a3a81 / c72d84f / 4198772)
  - 모달 backdrop 8개 black/60→black/70 통일 (58adb1a)
  - **입력란 반경 6px(r-sm)** — 공유 컴포넌트 8개 + 인라인 151줄, focus 시그니처로
    안전 식별 (623bc3a)
  - **터치타겟 44px** — Btn sm/md min-h 36/40→44 (e2256c8), 닫기·아이콘 버튼 22개
    w-8/w-9→w-11 (a47733c)
  - 그림자 정책 — shadow-xl/lg 5곳 → shadow-lift 단일 토큰 (7fd4a72)
  - **카드 반경 rounded-2xl(18px)→rounded-xl(14px)** 96개 (모달은 18px 유지) (17cfc3a)
  - **favicon.ico 옛 RoomOS 로고→Arch** 교체, gen-icons.mjs 에 favicon 생성 추가 (14de56e)
  - 검증: 로그인 페이지(인증 밖) 스크린샷·마커로 6px입력·44px버튼·14px카드·Arch 확인.
    (app) 내부 페이지는 인증 게이팅이라 로그인 세션에서 확인 권장 — 공유 브랜드
    컴포넌트는 정합 확인됨.
- **재고 점검 시스템 정비** (2026-05-19~21 세션):
  - 아이템별 점검 — "채우기 전/채운 후" 입력 + 보충량(후-전)만큼 허브 자동 차감 (d4749bd)
  - 위치별 일괄 점검 — 위치 선택 후 그 위치 품목 일괄 점검, 동일 허브 자동 차감 (d8568bc)
  - 재고 점검 진입 방식 토글 — 아이템별 / 위치별 (B안) (76eedb8)
  - 수령 확인 시 자동 StockCheck 생성으로 점검 prefill 해결 (2ae1327)
  - 무상 입수에 입고 위치 항목 추가 (5c8b8d4)
  - 위치별 점검 이동 유입 UX·타임라인 문장형 표시 (a5f0087, 626f917)
  - **버그 수정 — '채우기 전' 미입력 시 허브 미차감/과차감으로 총량 변동**:
    · 위치별 점검: 위치 선택 시 직전 잔량 prefill (7b886d7)
    · 아이템별 점검(CheckForm): 동일하게 직전 잔량 prefill + restockSum null-처리 통일
      (커밋 7b886d7 의 "CheckForm 과 동일" 주장이 실제로는 미적용이었음 — 2026-05-21 보완)
- **BrandLoader (Brand Guide v1.2)** — Arch 라인드로우 + 워드마크 EN/KO 교차 로더로
  전 화면 로딩 UI 통일 (e89fc47, e5d94aa, 4c152f3, 0ae0e92, 3c6d912, 24e338e)
- **Brand Guide v1.2 적용** — 카드/Status Row 좌측 3px 팁(공실 강조), 토큰 alias 추가
  (eb10201, f2b2ce2, db0a878, 6803d43)
- **수납** — 납부방법을 직전 방식으로 자동 prefill (5e99ada)
- **성능** — 서버액션 인증 getUser→getClaims 전환, 중복 auth API 호출 제거 (b046394)
- **UX** — DatePicker z-index 모달 위로 + 수납 정보 → 호실 딥링크 (069afa0)

- **#4 요청·컴플레인 통합 페이지** — 재구현 완료 (직접 등록·공용부 요청 지원 포함)
- SplashScreen 재작성, 로고·로딩 UI 라이트/다크 정리 — rewind로 잃었던 것 복구됨
- 도면 편집기, 재고 관리, 재무, 고객/입주자 관리, M7 디자인 시스템 등 — git log 참고
- **이메일/인증 인프라** (2026-05-18 세션):
  - stayeum.com 도메인 연결(Vercel) + SSL
  - Resend 발송 인프라 + 도메인 인증(DKIM/SPF/DMARC, Cloudflare DNS)
  - Supabase 커스텀 SMTP(Resend) 연결, 발신 no-reply@stayeum.com
  - 인증 메일 템플릿 5종 브랜드화 → 원본 docs/email-templates/
  - 회원가입 폼 개선 (전화번호 하이픈·우편번호 검색·필수 표시·비밀번호 규칙)
  - 미인증 계정용 "인증 메일 다시 보내기" 버튼
  - vercel.app → www.stayeum.com 영구(308) 리다이렉트
- **성능 개선** (2026-05-18 세션):
  - 페이지 전환 시 풀스크린 스플래시 제거 → 콘텐츠 영역 경량 스피너 + 상단 진행바
  - 레이아웃 인증을 getClaims()로 전환 — 중복 네트워크 왕복 제거 (비대칭 JWT 서명키)
  - Vercel 함수 리전 미국(iad1) → 서울(icn1) — DB와 같은 리전, 쿼리 왕복 ~200ms→~2ms
    (vercel.json의 regions로 고정)
  - 재고 모달 '위치 저장' 버튼 — 보관 위치 변경 시 강조
  - 대시보드 스트리밍(Fix C)은 검토 후 보류 — 리전 이전으로 충분, 리팩터링 위험 대비 효과 낮음

## 할 일

### #5 계약서 통합 페이지 (/contracts) — 미착수
- 경로: app/(app)/contracts/page.tsx, ContractsClient.tsx
  (현재 contracts/ 폴더만 있고 비어 있음)
- 기능: 서명/스캔 출처 필터, 최신순·입실자별 정렬, 검색
- Sidebar "운영" 그룹에 메뉴 추가
- 참고 SQL 이미 적용됨: migrate_contract_template.sql, migrate_contract_files.sql
- rewind 전 결과물 참고용: `git show 801e572` (그대로 쓰지 말고 다시 짜기)

### 영업장 구성원 초대·참여 기능 — 미구현
두 흐름 모두 지원하기로 결정 (2026-05-18):
- 모델 A — 운영자 초대: 운영자가 구성원 관리 화면에서 이메일 입력 → 초대 발송
- 모델 B — 사용자 요청 + 운영자 승인: 사용자가 영업장 참여 코드 입력 → 참여 요청
  → 운영자가 요청 목록에서 승인/거절
- 공통: 운영자용 "구성원·요청 관리" 화면 필요
- 영업장 참여 코드는 영업장 개설 시 자동 생성·부여, 운영자가 재발급 가능
- 신규(계정 없음) 초대는 Supabase inviteUserByEmail(admin API, 서버사이드 전용),
  이미 계정 있는 사용자는 UserPropertyRole 행 추가로 연결
- Supabase 초대 이메일 템플릿은 이미 등록됨
- UserPropertyRole(STAFF 등) 권한 부여 흐름과 연계 설계

### @stayeum.com 이메일 수신 — 나중에 꼭
- 현재 stayeum.com은 발송만 가능, 수신 불가 (받는 메일함 없음)
- Cloudflare Email Routing(무료)으로 @stayeum.com → Gmail 포워딩 설정
- 설정·수신 확인 후 Supabase 계정 이메일을 @stayeum.com으로 변경
- 정식 메일함(IMAP/자체발신) 필요 시 Google Workspace·Zoho Mail 검토
  (Synology 등 자체호스팅은 발송 신뢰도 문제로 비권장)

### 구글 로그인 시 supabase.co 도메인 노출 제거 — 나중에
- 구글로 로그인할 때 브라우저에 "yzzxuafsvfuzlwvkiuad.supabase.co(으)로 이동…"이
  잠깐 노출됨 — Supabase가 자동 생성한 프로젝트 서브도메인이 OAuth 리다이렉트에
  그대로 보이는 것
- 완전 제거(유료): Supabase Custom Domain 설정 → auth.stayeum.com 등 브랜드
  도메인으로 auth 엔드포인트 교체. Custom Domain 애드온 ~$10/월 + Pro 플랜
  ($25/월) 필요 → 결제·구독(PG) 도입으로 Pro 올라갈 때 묶어서 처리 권장
- 무료로 가능한 것: Google Cloud OAuth 동의 화면 브랜딩(앱 이름·로고·지원
  이메일). 단 동의 화면만 정돈될 뿐 리다이렉트 중 supabase.co 표시는 안 사라짐
- 표시는 리다이렉트 통과 중 잠깐이라 체감 짧음 → 우선순위 낮음, 나중에

### 이메일 템플릿 디자인 재작업 — 로고 확정 후
- 현재 5종 템플릿은 임시 디자인 (퍼시몬 카드형)
- 로고·브랜드 디자인 확정 후 docs/email-templates/ 수정 → Supabase 대시보드 재반영
- 같은 트리거로 앱 내 "RoomOS" 텍스트 잔재 정리도 함께 (현재 의도적으로 남겨둠)

### 이미지 업로드 → 자동 입력 (OCR/AI)
- 이미지를 올리면 내용을 읽어 필요한 자리에 자동 입력, 확인 절차를 거쳐 실제 반영
- 케이스 1 — 입금 계좌 캡처: 이름·방번호 추출 → 입력자 확인 → 수납 데이터 업데이트
- 케이스 2 — 영수증 이미지: 추출 → 지출에 자동 입력
- 참고: 영수증 스캔(크롭+OCR+첨부)은 이미 일부 구현됨 (커밋 51b8eb8) — 확장·연계 검토
- 참고: Gemini AI(@ai-sdk/google) 이미 앱에서 사용 중 (도면 인식 등)

### 엑셀 내보내기/가져오기 개선
- 내보내기: 현재까지 업데이트된 모든 내용이 빠짐없이 나오도록
- 가져오기: 적용 방식을 사용자가 선택하게
  · 덮어쓰기 — 기존 데이터를 전부 지우고 엑셀 내용으로 교체
  · 추가 — 기존 데이터는 유지, 엑셀의 행만 추가 (엑셀에 1~2줄만 있어도 그것만 추가)
  · 중복 선택 — 중복 데이터가 있으면 부분적으로 선택해 적용
- 참고: 기존 import/export 존재 (app/api/export, app/api/import, import/preview)

### 영업장 랜딩 페이지 + 유입 트래킹
- 영업장 홍보용 공개 페이지를 stayeum.com 하위 경로로 제공
- URL 구조: `stayeum.com/stay/<영업장-슬러그>` — 접두어 `/stay/`, 확장자(.html) 없음
  (슬러그를 루트에 직결하면 앱 라우트와 충돌 위험 → `/stay/` 접두어 사용)
- 바로 할 일 — thestay-jegi 페이지 이전:
  · 출처 https://thestay-jegi.netlify.app — 확인 결과 순수 정적 HTML
    (HTML 1장 + 이미지 몇 개, 프레임워크 없음)
  · public/stay/thestay-jegi/ 에 HTML·이미지 배치 → stayeum.com/stay/thestay-jegi 서빙
  · 이미지 상대경로는 <base> 태그로 처리
- 비전 — 스테이음 성장 시 회원이 각자 영업장 페이지를 만들·관리하는 기능
  · 유입 트래킹(페이지뷰·방문자·referrer/UTM)을 회원 대시보드에 노출
  · 앱이 직접 서빙하므로 트래킹 가능 (Vercel Analytics 또는 자체 DB 기록)
- 외부 사이트 리버스 프록시 방식은 비채택 — 트래킹 불가·에셋 경로 문제

### 운영자(슈퍼관리자) 대시보드 + 베타 접근 관리 — 우선순위 높음
- Supabase 대시보드와 별개로, 앱 안에 운영자 전용 관리 영역 (/admin 또는 (admin) 그룹)
- 슈퍼관리자 역할 필요 — 현재 스키마엔 영업장 단위 역할(UserPropertyRole)만 있음
- 담을 것: 전체 가입자 조회(실명·이메일·전화·주소), 가입 승인/거절, 영업장 현황, 통계
- 베타 접근 게이팅 (당장 필요 — 앱 미완성, 제한된 테스터에게만 공개가 목적):
  · 가입해도 바로 전체 기능 X → 운영자가 대시보드에서 승인해야 기능 해제/가입 확정
  · 쿠폰·초대 코드 — "선착순 N명 무료 가입" 같은 코드 (PG 없이 당장 운영 가능)
- 결제·구독(PG)은 추후 (위 쿠폰·승인 방식이 PG 도입 전까지의 임시 운영 수단):
  · 한국 SaaS면 포트원·토스페이먼츠 권장 (정기결제)
  · 플랜·구독·7일 무료체험·쿠폰 모델, 결제 웹훅, 기능 게이팅, 결제 UI

### ✅ 앱 전체 리브랜딩 — Claude Design 가이드 반영 (1~4단계 완료 2026-05-22)
Claude Design에서 stayeum 브랜드 가이드 확정 (Arch Symbol + Brand & Design Guide).
앱 전반을 새 브랜드로 재스킨 — 현 Persimmon(#e84a1a 주황) → Terracotta 팔레트.

핵심 컬러 토큰:
- Terracotta #A03C2E (primary·CTA·로고) / hover #7C2D26 / soft #B85042
- Camel #C8A07D · Sand #F2D9B8 / #F5E5CC
- Cream #FBF6EF / #F5EDE0 · Page(배경) #E8DDD0
- Ink #3D2418 / #7A6553 / #A89380 · Success #1A6E4C
- 폰트: Pretendard(본문·UI) / DM Mono(숫자·KPI) / Plus Jakarta Sans(로고 전용) — 이미 적용됨

새 로고 — Arch Symbol (단일 filled path, viewBox "0 0 130 100"):
  M 8 82 C 8 32 22 8 55 8 C 88 8 121 32 121 82 A 8.5 8.5 0 0 1 104 82 C 104 44 80 26 55 26 C 30 26 28 44 28 82 A 10 10 0 0 1 8 82 Z
워드마크: stay(ink) + eum(terracotta) · 한글 스테이(ink) + 음(terracotta)

적용 단계:
1. ✅ app/globals.css 컬러 토큰 재매핑 완료 (2026-05-18)
   - Terracotta: --persimmon #a03c2e / -d #7c2d26 / -l #f2dfd8(파생 페일 틴트)
   - Ink: --ink·--ink-2 #3d2418 / --ink-3 #7a6553 / --ink-mute #a89380
   - Surface: --cream #fbf6ef / --cream-2(Page) #e8ddd0 / --cream-3(테두리) #dccfbc(파생)
   - 신규 토큰: --cream-soft #f5ede0(보조 표면), --camel #c8a07d, --sand/-2
   - Success #1a6e4c → status-paid 계열 반영
   - 다크모드·@theme inline·print 블록 모두 동기화
   - 차트 팔레트(--chart-*)는 '브랜드와 분리' 주석대로 의도적으로 미변경
2. ✅ 로고 교체 완료 (2026-05-18)
   - 심볼: Floor Mark(4선) → Arch Symbol(단일 filled path)로 전환
   - StayeumWordmark.tsx: Arch + 워드마크 재구성, ARCH_PATH 상수 export(심볼 단일 출처)
     · 워드마크 표기 'Stay' → 'stay' 소문자 — 가이드 'stay(ink)+eum(terracotta)' 반영
     · viewBox를 콘텐츠 타이트(8 8 …)로 잘라 height prop = 실제 로고 높이
       (구 워드마크보다 가로폭이 더 컴팩트해짐 — 4단계 육안 검증 시 레이아웃 확인)
   - SplashScreen.tsx: Arch 페이드인 애니메이션, "Room/OS" 잔재 → "stay/eum" 수정
   - AppShell PageLoadingOverlay: 4바 슬라이드 → Arch 펄스 로더
   - public/icon.svg: Terracotta 배경 + Cream Arch
   - PNG 아이콘 재생성: scripts/gen-icons.mjs(sharp) — icon-192(둥근)/512(풀블리드)/apple-touch
   - manifest.json·layout.tsx: theme #a03c2e / background #e8ddd0
   - ✅ app/favicon.ico 도 Arch 로 교체 완료 (2026-05-22, 14de56e) — gen-icons.mjs 가
     16/32/48 멀티사이즈 ICO 생성. 이제 모든 아이콘(favicon·icon.svg·192/512·apple-touch)이 Arch.
3. ✅ 컴포넌트 미세조정 완료 (2026-05-22) — 위 '완료된 것' 참조
   - 버튼→공유 Btn(73개)·입력 반경 6px·터치타겟 44px·카드 반경 14px·모달 backdrop
     black/70·그림자 shadow-lift·favicon Arch 교체
   - 점검 결과 이미 정합이던 것: 색상 토큰·배지 반경·모달 컨테이너 반경
4. ✅ 검증 완료 (2026-05-22) — 인증 밖 페이지(로그인·비번재설정) 스크린샷/마커 검증.
   (app) 내부 페이지는 인증 게이팅이라 헤드리스 검증 불가 → 로그인 세션에서 영업장선택·
   Sidebar·계약뷰 육안 확인 권장 (단 동일 브랜드 컴포넌트 사용하므로 정합 확인됨).
   남은 미세 후보: SegmentedControl shadow-sm(활성 인디케이터, 의도적 유지),
   floor-plan 드로잉 툴바 '완료' 버튼(const 기반, 비대상).
이 작업이 끝나면 이메일 템플릿 재디자인도 함께 해소 ("RoomOS" 텍스트 잔재 중
스플래시 화면분은 2단계에서 해결됨).

### #6 국가 서류·양식 페이지 (Phase C — 별도 세션 권장)
- DocumentTemplate 모델 신규 설계
- 카테고리·태그 + 다운로드 링크/파일 업로드 + 안내 페이지 링크

## 참고 / 주의사항
- AGENTS.md 세션 시작 규칙 — 매 세션 이 파일을 먼저 읽고 이어갈 것
- 컨텍스트가 차오르면 /compact 또는 새 세션으로 넘기기
- rewind는 코드를 되돌리니 신중하게 — 컨텍스트 줄이는 용도로 쓰지 말 것
