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

## 화면 id 의 영업장 범위와 금액 스코프 (2026-11-04, 운영자 승인 '추천대로')
- 관문(requirePropertyAccess)을 지나도 그 뒤 조회의 where 에 영업장이 없으면 남의 영업장 행이 읽히고 쓰인다. 화면에서 온 id 로 행을 읽는 서버 액션은 `findFirst({ where: { id, propertyId } })`(자식 모델은 부모 관계 필터 `leaseTerm: { propertyId }`)로 읽고, 못 찾으면 아무것도 쓰지 않고 닫는다. findUnique({ id }) 는 쓰지 않는다.
- 봉합한 자리. 쓰기 recordDepositReceived(보증금 소급 기록, 남의 계약 입주자·보증금으로 내 장부에 행이 섰다)와 거주 호실 일정 넷(startLeaseWithRoomSchedule·saveRoomSchedulePlan·undoSaveRoomSchedulePlan·undoChangeRoomMoveDate, 일정의 방을 `scheduleRoomsInProperty` 로 본다. 종전에는 남의 영업장 방이 겹침 판정을 '안 겹침'으로 지나 사용 중으로 바뀌고 거주 구간이 섰다). 읽기 getRentDiscounts·getPaymentsByLease(마지막 결제 수단·보증금 합계)·analyzeTenantWithGemini·getTenantRequests·previewCheckoutProration.
- 1차 읽기만 영업장으로 걸고 2차 조회(합계·마지막 값)를 계약 id 만으로 두면 같은 구멍이다(getPaymentsByLease). 2차 조회는 where 에 propertyId 를 걸거나, 같은 함수에서 영업장 범위로 확인한 1차 결과의 id 만 쓴다.
- 금액(canReadScope 'money')은 영업장과 별개의 축이다. 제한 스태프(LIMITED_STAFF)는 /tenants 가 허용 라우트라 입주자 목록·상세가 열린다. 그 역할에게 서버가 걷는 칸은 이렇다.
  - 입주자 상세(getTenantDetail): 계약 금액 세 칸(rentAmount·depositAmount·cleaningFee) null, 납부 기록 빈 배열, 금액을 담은 스냅샷(shortStayExtensions·checkoutProrationUndo)과 영업장 단기 정책(property.shortStayPolicy) null. getTenantQuickInfo 는 금액 두 칸 null.
  - 입주자 목록(getTenants): 계약이 include 라 맨 칸이 전부 딸려 나온다. 금액 넷과 Json 스냅샷 전부(일정 roomSchedule 제외), 서명 이미지·계약서 링크를 null(표 TENANT_LIST_MONEY_NULL_KEYS), 납부 기록을 빈 배열로 내린다. 종전에는 세 칸만 지워 나머지가 그대로 내려갔다(2026-11-04 독립 검수 B2). 목록 화면은 이 칸들을 쓰지 않는다.
  - 호실 고르기(getRoomsForSelect): 이용료 세 칸 null(호실 관리 목록 getRooms 와 같은 문법). 단기 요금표(getRoomsForQuote)는 거절이다. 그 역할에게는 입구가 없다. 입주자 화면 페이지는 금액 기본값 셋(보증금·청소비·단기 예약금)을 싣지 않는다.
  - 금액만 내는 조회(할인 목록·퇴실 일할 미리보기·AI 수납 분석·수납 내역)는 빈 목록이거나 거절이다.
- 화면은 null 인 칸을 그리지 않는다(가이드 §27.8 ② 숨김, 캡션 없음). 입주자 화면 호실 미니 창의 기본 이용료 줄도 숨긴다. 계약 정보 격자는 금액 세 칸(홀수)이 빠지고 납부일도 없으면(거주 전·단기) 납부방식을 전폭(Item wide)으로 두어 뒤 칸의 좌우 짝을 금액이 보이는 화면과 같게 지킨다. 단기 입실 정보는 그 역할에게 요금표를 부르지 않고 예상 요금 구획을 세우지 않는다(체류 일수는 남는다).
- 그물 `scripts/check-action-property-scope.mjs`(함수 축, getPaymentsByLease 의 everyWhere, 일정 방 관문 정본, 목록 걷는 칸 표와 스키마 대조, 화면 가드), 통합 `scripts/test-action-property-scope-flow.ts` 의 보증금·할인·입주자 상세 금액·같은 클래스 전수·수납 내역·일정 방·입주자 목록·호실과 요금표 절.

## 열람 전용 역할의 화면 숨김 (2026-11-03, 운영자 지시·승인)
- 역할은 넷이다. OWNER·MANAGER 는 편집(`canEdit`), STAFF·LIMITED_STAFF 는 열람 전용이다. 서버 쓰기 문은 `requireEdit` 이고 화면 판정은 `useCanEdit()` 로 같은 집합이다. `useCanEditScope` 는 제한 스태프에게 재고 쓰기를 주므로 고객 쪽 입구에는 쓰지 않는다.
- **서버가 거절하는 동작은 화면에도 세우지 않는다.** 비활성 + 캡션이 아니라 숨김이다(가이드 §27.8 ②). 열람 직원은 그 자리에서 풀 수 없고 모든 행에 같은 막힘이라 캡션은 되풀이가 된다.
- 고객에게 나가는 길은 역할로 막는다. 문자(sms 링크·문자 창·서류 시트 '문자' 갈래·서명 요청)와 메일(서류 메일·연락처 mailto), 내보내기의 '문자로 보내기' 갈래. 문자는 서버가 보내지 않아 화면 숨김이 실제 차단이고, 메일은 서버 문(requireEdit)이 실제 차단이다. 일반 '공유'(OS 공유 창)와 저장은 열람 직원에게도 남는다.
- RoleProvider 는 (app) 레이아웃에서 AppShell 을 통째로 감싼다. 종전에는 children 만 감싸 Prism 모달·전역 검색·신고 버튼이 밖에 있었고, 그 안의 역할 훅은 기본값 OWNER 를 읽어 열람 직원에게 쓰기 입구가 섰다.
- (app) 밖 화면(계약서·납부 확인서·실거주 확인서·서류 뷰어)은 RoleProvider 가 없다. 역할 훅을 쓰지 않고 page 가 lib/role `canEdit` 로 정한 값을 필수 prop 으로 넘긴다(ContractView `canSendSms`·`canEdit`, SendDocButton `canSendSms`). 기본값을 두지 않는다. ?share= 서명본 분기가 값을 안 넘겨 기본값 true 로 열렸던 일이 있다.
- 쓰기 행만 세우는 조회(getRoomScheduleState·getRoomBusyNotice)는 서버 문을 낮추지 않고 열람 역할에게 부르지 않는다. 링크 상태 조회(getContractShareState)는 토큰을 주므로 열람 역할에게 열지 않는다. 열람 직원의 서명 대기 배지는 배지 여섯 칸만 주는 getContractSignBadge 가 맡는다(2026-11-04 운영자 승인).
- 계약서 화면은 STAFF 에게 읽기 전용으로 열리고(ContractView `canEdit` 거짓 = 쓰기 입구 없음), 제한 스태프는 404, 서명본 `?share=` 는 편집 역할 전용이다. page 가 역할을 데이터보다 먼저 읽는다([[domain-contracts]] '열람 역할과 계약서 화면').
- 서류 성명 표기 힌트 쓰기(noteDocNameStyle)도 계약 행을 쓰므로 requireEdit 를 지난다(2026-11-04 운영자 승인 G6). 화면 경로로는 계약서·납부 확인서 발급 성공 뒤와 실거주 확인서 칸 저장(그 자신이 requireEdit) 안에서만 불러 열람 역할이 닿지 않았지만, 서버 액션은 직접 부를 수 있다.
- 입주자 상세 수납 모달의 발끝 '수납 등록'도 canEdit 아래다(2026-11-04 운영자 승인 '추천대로' G5, 서버 savePayment 가 requireEdit). 감지망 `scripts/check-pay-entry-single-form.mjs` ⓕ.
- 감지망 `scripts/check-sms-role-gate.mjs`(서버 문·입구 전수·창 렌더·버튼·Provider 트리·메일·내보내기·편집 입구 표·쓰기용 조회), 통합 `scripts/test-action-property-scope-flow.ts` 열람 역할 절.

## 앱 users 행 보장과 승인 흐름 (2026-11-04, 운영자 승인 '추천대로')
- 로그인한 사람의 앱 users 행은 정본 `lib/auth/ensureAppUser` 하나가 만든다. 콜백·로그인 동기화(syncUserToDB)·계정 관문(`getAccessContext`, 행이 없을 때)이 부른다. 없으면 대기로 만들고, 있으면 상태·관리자 표식은 절대 안 덮는다(refreshProfile 일 때 이름·사진·넘긴 칸만). 같은 이메일의 다른 행이 있으면 만들지 않는다. 초대코드(메타데이터 invite_code)는 대기·미사용일 때 한 번. 새 대기 행이면 스테이음 관리자에게 푸시(notifySuperAdmins).
- 원인 확정(로컬 재현): proxy.ts 의 '/'·'/login' 진입 307 이 그 페이지 위 서버 액션 POST 까지 보내, 비밀번호 로그인 직후 syncUserToDB 가 /property-select 로 튕겨 실행되지 않았다(200 application/json, 클라이언트 'unexpected response', 가입 폼 일반 오류). 이제 진입 리디렉트는 GET·HEAD 만. 행동 그물 scripts/test-proxy-entry-redirect.ts.
- 이메일 인증 링크는 signUp·resend 의 emailRedirectTo 로 /callback 에 돌아온다(종전에는 Site URL '/' 로 와서 코드가 교환되지 않았다). Supabase 대시보드 Redirect URLs 에 /callback 이 있어야 한다.
- 콜백은 코드를 먼저 교환한다. 교환이 실패했을 때만 기존 세션으로 통과(뒤로가기 재진입 보호). 종전 '이미 로그인이면 통과' 지름길은 다른 계정 세션으로 Google 코드를 버렸다. 교환 실패는 세션을 지우지 않는다(auth-js).
- 대기 화면은 탭 복귀·30초·[상태 다시 확인]에 checkMyAccess(본인 상태만)로 재확인하고 승인되면 /dashboard 로 넘어간다. 승인 전에 직원으로 초대받았으면 영업장 이름을 보인다.
- 멤버 초대·승인과 계정 승인의 관계는 `memberJoinState` 한 판정이다. 승인 계정 ready, 대기 waiting(역할 줄은 서고 승인되면 들어온다, 초대한 쪽 토스트 + 관리자 푸시), 거절 blocked(초대 거부).
- 스테이음 관리자 권한(DB isSuperAdmin)·가입 상태 변경은 app/admin/actions.ts 한 곳에서 감사 기록(admin_audit_logs)과 같은 트랜잭션이고, 서명 토큰 적용취소(admin-user-access-v1)가 있다. env SUPER_ADMIN_EMAILS 관리자는 화면에서 못 바꾼다. 고아 계정(auth.users 에만 있음)은 verify:db check-auth-user-orphans 가 본다.

## 공용(인증 불필요) 라우트
`/login` · `/callback`(OAuth) · `/reset-password`(이메일 링크) · 입주자용 `/sign/[token]`(계약서 원격 서명 — 토큰+생년월일+HMAC 쿠키가 자격, 2026-07-18 신설) · `/rent-receipt/[tenantId]` · `/residence-cert/[tenantId]`. 이들에 인증 게이팅 넣으면 입주자가 서명·열람 못 함 — proxy 전역 게이팅 금지.
정정(2026-07-18): `/contract/[tenantId]` 는 공용이 아니라 **운영자 인증 필요**(getContractData 가 requirePropertyAccess 경유). 입주자 원격 서명은 `/sign/[token]` 이 담당.

## returnTo 오픈 리다이렉트 방어
`lib/auth/returnTo.ts` — `isInternalPath`(안전 판정)·`safeReturnTo`(위반 시 /property-select). '/' 단일 슬래시 내부 경로만 허용, 절대 URL·'//'·'/\\'·제어문자 차단. 소비 지점 전부 경유: proxy.ts·(app)/layout.tsx·callback/route.ts·EmailLoginForm·LoginButton(OAuth redirectTo는 encodeURIComponent).

관련: [[decisions]] · [[soft-delete-pattern]]
