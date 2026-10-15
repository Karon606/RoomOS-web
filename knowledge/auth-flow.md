# 인증·세션·복귀(returnTo) 흐름

이 저장소의 인증 구조는 표준 Next.js와 달라 비직관적이다. 정본으로 기록한다.

## 미들웨어는 middleware.ts 가 아니라 proxy.ts
- 이 수정된 Next.js는 미들웨어를 루트 `proxy.ts`(export `proxy`, `config.matcher`)로 쓴다. 빌드 로그의 "Proxy (Middleware)"가 이것.
- `lib/supabase/middleware.ts`(export `updateSession`)는 **어디서도 호출 안 되는 죽은 코드**(옛 잔재). 여기 고쳐봐야 효과 없음. proxy.ts를 봐야 한다.

## 세션 갱신·진입 라우팅 = proxy.ts
- 매 요청 `supabase.auth.getUser()`로 세션 갱신(응답 쿠키 재설정).
- `/`·`/login`만 리다이렉트 처리. 로그인 상태면 returnTo(또는 hasProperty ? /dashboard : /property-select)로, 비로그인 `/`는 /login으로.
- **보호 라우트(/dashboard·/rooms 등)의 인증 가드는 proxy가 안 함** — 아래 layout이 함.
- 서버 컴포넌트가 현재 경로를 알도록 요청 헤더 `x-pathname`(경로+쿼리) 주입. `set()`이라 클라이언트 위조값은 덮어써 무시.

## 실제 인증 가드 = (app)/layout.tsx
- `supabase.auth.getClaims()`(JWT 로컬 검증, getUser 네트워크 왕복 제거 — 의도된 최적화. proxy가 세션 갱신하므로 layout은 검증만).
- `if (!claims) redirect('/login?returnTo=<x-pathname>')` — 세션 만료 시 딥링크 복귀. returnTo는 `isInternalPath`로 정제.
- 이후 승인(/pending)·프로필(/profile-setup)·영업장(/property-select) 게이팅.
- 이 가드는 **(app) 그룹에만** 적용. 공용/입주자 페이지는 그룹 밖이라 무관.

## 서버 액션·API 의 관문 = lib/auth/propertyAccess (2026-10-14, 권한 감사 P0)
- 레이아웃 가드는 화면만 막는다. 서버 액션은 액션 id 로 직접 POST 할 수 있고 proxy.ts 도 막지 않는다. 그래서 모든 서버 함수가 `requirePropertyAccess`(실패 시 redirect)·`getPropertyAccess`(실패 시 null) 또는 그 위의 역할 문(lib/role)을 직접 지나야 한다.
- 관문은 계정 승인 상태도 본다. 승인(APPROVED)이거나 슈퍼관리자(env 또는 DB 플래그)여야 통과하고, 아니면 `requirePropertyAccess` 가 /pending 으로 보낸다. 규칙은 레이아웃 47행과 같다. 세 조회(역할 행·사용자·영업장 소유주)는 병렬 1회다.
- 영업장을 고르기 전 단계는 계정 승인 문 `requireApprovedAccount`(lib/auth/access, 영업장 무관)를 지난다. 영업장 선택·개설·참여 요청·오너 관리(운영 종료·재개·영구 삭제)와 푸시 구독 저장이 여기다. `getAccessContext` 는 상태를 돌려주기만 하고 막지 않으므로 인증 문으로 쓰지 않는다.
- 관리자 화면·액션은 `requireSuperAdmin` 이라 슈퍼관리자만 지난다. 로그인 동기화·프로필 설정·내 영업장 목록은 로그인만 보고(대기 계정도 지나야 하는 문), 그물의 IDENTITY_ONLY 목록에 사유가 있다.
- 영업장 알림 푸시(일일 크론·서명 제출 알림)는 `approvedPushRecipients`(lib/pushSend)로 승인 계정·슈퍼관리자에게만 간다.
- 영업장 안의 역할은 순수 판정 한 함수 `resolvePropertyRole`(lib/auth/resolveRole, 2026-10-15)이 정한다. 역할 줄이 있으면 그 역할이고 env 슈퍼관리자는 줄이 낮아도 소유자, 역할 줄이 없으면 소유주·슈퍼관리자(env 또는 DB 표식)만 소유자다. 관문(종 알림 포함)이 이 함수를 부르고, 일일 크론 푸시는 같은 함수를 묶은 `pushRoleMap` 을 부른다. 이메일 출처가 다르다. 관문의 역할 줄 갈래는 로그인 클레임 이메일만, 역할 줄 없는 갈래는 클레임이 없으면 사용자 행 이메일도 보고, 크론은 사용자 행 이메일(승인된 수신자만 조회)을 본다. 종전에는 크론만 env 승격이 없었다. 운영 데이터 대조 결과 차이 0(2026-10-15 읽기 조회). 그물은 진리표 scripts/test-resolve-role.ts 와 관문을 대역으로 통째로 돌리는 행동 그물 scripts/test-property-access.ts 다. 둘 다 조합 전수 대조를 둔다. 관문은 역할 줄 5 x 소유 3 x 클레임 이메일 3 x 사용자 행 이메일 2 x DB 표식 2 x 상태 4(720조합), 크론은 영업장 둘 x (줄 5 x 소유 2) x 이메일 3(300조합)을 정본을 부르지 않는 독립 기대 함수(32d87d95 관문 코드를 글로 옮긴 것)와 견준다. 조건에 무엇을 '더하는' 상승·상태 풀기 역주입은 장면 몇 개로는 안 잡혔다(2단계 독립 검수 권장 1).
- `supabase.auth.getSession()` 은 서버에서 쓰지 않는다(쿠키 서명을 검증하지 않는다). 그물 check-server-auth-gate 가 지킨다.
- 실패를 catch 로 삼키는 헬퍼 금지. lib/geminiKey 가 관문 redirect 를 '세션 밖(크론)'으로 읽어 공용 키를 내줬다. 세션이 필요한 헬퍼는 예외를 그대로 올리고, 크론은 라우트가 CRON_SECRET 을 확인한 뒤 부르는 별도 경로만 쓴다(지금 AI 를 부르는 크론은 없다).

## 공용(인증 불필요) 라우트
`/login` · `/callback`(OAuth) · `/reset-password`(이메일 링크) · 입주자용 `/sign/[token]`(계약서 원격 서명 — 토큰+생년월일+HMAC 쿠키가 자격, 2026-07-18 신설) · `/rent-receipt/[tenantId]` · `/residence-cert/[tenantId]`. 이들에 인증 게이팅 넣으면 입주자가 서명·열람 못 함 — proxy 전역 게이팅 금지.
정정(2026-07-18): `/contract/[tenantId]` 는 공용이 아니라 **운영자 인증 필요**(getContractData 가 requirePropertyAccess 경유). 입주자 원격 서명은 `/sign/[token]` 이 담당.

## returnTo 오픈 리다이렉트 방어
`lib/auth/returnTo.ts` — `isInternalPath`(안전 판정)·`safeReturnTo`(위반 시 /property-select). '/' 단일 슬래시 내부 경로만 허용, 절대 URL·'//'·'/\\'·제어문자 차단. 소비 지점 전부 경유: proxy.ts·(app)/layout.tsx·callback/route.ts·EmailLoginForm·LoginButton(OAuth redirectTo는 encodeURIComponent).

관련: [[decisions]] · [[soft-delete-pattern]]
