# 테스트 서버 착수 체크리스트

운영자 결정(2026-08-03) — Drive 는 별도 구글 계정, 복사 데이터는 토큰·구독만 무효화, 코드부터 먼저.
계획과 배경은 [staging-plan.md](staging-plan.md), 결정 근거는 [staging-context-notes.md](staging-context-notes.md).

## 1단계 — 코드 (에이전트, 운영 동작 무변화)

- [x] 판정 정본 `lib/env.ts` — `isLiveEnv()` 하나에서 발송 차단과 화면 표시가 함께 나온다
- [x] 웹푸시 차단 — `sendToSubscriptions` 함수 첫 문장 가드
- [x] `sendTestPush` 를 초크포인트로 접기 (종전에는 web-push 를 직접 불러 차단 밖이었다)
- [x] 테스트 사이트 배너 + `--sysbar-h` 높이 예약
- [x] 감지망 `scripts/check-env-isolation.mjs` + `verify:fast` 배선
- [x] 역주입으로 감지망 실동작 확인
- [x] 문자 버튼 잠금 4곳 — 클릭 직전 가로채기(`blockSmsIfStaging`). 화면 배치는 안 건드렸다
- [ ] `lib/smsHref.ts` 정본으로 조립 로직 4곳 수렴 (지금은 가드만 공유하고 URL 조립은 각자 한다)

## 2단계 — Vercel 설정 (운영자)

**develop 브랜치를 만들기 전에 해야 한다.** 지금 보호가 꺼져 있어 브랜치를 푸시하는 순간 공개 URL 이 하나 생긴다.

- [ ] Deployment Protection 비밀번호 잠금 — **반드시 Preview 한정**. All Deployments 로 걸면 운영 공개 사이트가 죽는다
- [ ] 기존 환경변수 21종의 스코프 전수 점검 — "All Environments" 로 돼 있으면 프리뷰가 운영 값을 상속한다
- [ ] `VERCEL_DEPLOY_HOOK_URL` 을 Preview 에서 **미설정**으로. 상속되면 스테이징에서 사진을 바꿀 때 운영이 재배포된다
- [ ] `VAPID_PRIVATE_KEY` / `NEXT_PUBLIC_VAPID_PUBLIC_KEY` 를 Preview 에 **넣지 않는다**. 코드 가드 위의 두 번째 층
- [ ] `GEMINI_API_KEY` · `NAVER_*` · `IPINFO_TOKEN` 은 Preview 에서 비운다 (같은 키를 쓰면 과금·쿼터가 새고 무료 한도를 갉아먹는다)
- [ ] `NEXT_PUBLIC_APP_URL` 을 스테이징 주소로. **안 하면 스테이징에서 구글 로그인이 운영으로 튕긴다**
- [ ] Supabase Auth 의 Redirect URLs 에 스테이징 주소 추가. 허용목록에 없으면 Supabase 가 무시하고 운영으로 폴백한다
- [ ] `CRON_SECRET` 을 운영과 다른 값으로

## 3단계 — 구글 계정 분리 (운영자)

- [ ] 스테이징용 구글 계정 생성
- [ ] 그 계정으로 OAuth refresh token 발급 후 Preview 에 `GOOGLE_CLIENT_ID` · `SECRET` · `REFRESH_TOKEN` 세팅
- [ ] 그 계정 Drive 에 테스트 폴더 생성 후 `GOOGLE_DRIVE_FOLDER_ID` 세팅

계정을 나누는 이유는 폴더 분리가 격리가 아니기 때문이다. `FOLDER_ID` 는 업로드할 때만 쓰이고 삭제·휴지통·공개권한·다운로드는 fileId 만 본다. 복사한 DB 의 `driveFileId` 가 운영 실파일을 가리키므로, 폴더만 나눈 상태에서 스테이징의 삭제 버튼을 누르면 운영 계약서가 휴지통으로 간다.

## 4단계 — DB 분리 (운영자 + 에이전트)

- [ ] Supabase 플랜·활성 프로젝트 수 확인, 백업의 "새 프로젝트로 복원" 가능 여부 확인
- [ ] 테스트 프로젝트 생성 후 운영 스냅샷 복원 (`auth` 스키마가 같이 와야 로그인이 된다)
- [ ] Preview 에 `DATABASE_URL` · `DIRECT_URL` · `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY` 세팅 (Supabase 셋은 반드시 한 묶음)
- [ ] 복원 직후 무효화 스크립트 1회 — `calendarToken` · `ContractShareLink` 전체 · `PushSubscription` 전체 · `joinCode` · `InviteCode` 전체 · `User.geminiApiKey` · `PageView.ip`
- [ ] 무효화 확인 — `push_subscriptions` 건수가 0 인지

## 5단계 — 흐름 전환

- [ ] `develop` 브랜치 생성 (2·3·4단계 뒤)
- [ ] AGENTS.md 에 배포 흐름 반영 — 작업은 develop, main 은 운영자 승인 후
- [ ] 병합 커밋에 승인 기록 트레일러
- [ ] `main` 푸시 훅에 승인 트레일러 게이트

## 미결 (운영자 확인 필요)

- [ ] `scripts/migrate-*` 는 `--env-file=.env.local` 로 도는데 그 파일이 운영이다. 테스트 서버가 생겨도 데이터 작업은 여전히 운영에 바로 꽂힌다
- [ ] `prisma.config.ts` 가 `.env.local` 을 하드코딩해서 Prisma CLI 는 항상 운영을 읽는다
- [ ] 테스트 DB 갱신 주기 (실데이터가 묵으면 이번 달 화면이 비어 검증이 헛돈다)
- [ ] 배너를 인쇄물(계약서 PDF)에도 남길지 여부 (지금은 no-print 라 안 찍힌다)

## 별건으로 나온 것

- [ ] `.claude/settings.local.json` 에 운영 DB 접속문자열이 비밀번호째로 무프롬프트 허용 목록에 있고 명령이 `prisma db push --accept-data-loss` 다. 테스트 서버와 무관하게 지금 지워야 한다
- [ ] 관리자 뷰 배너가 모바일에서 전혀 안 보인다 (`z-[70]` 이 헤더 `--z-sticky` 100 아래라 덮인다). §08 토큰 외 z 값 금지 위반이기도 하다
