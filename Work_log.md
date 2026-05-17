# 스테이음 작업 로그

마지막 업데이트: 2026-05-18
브랜치: main (f4aa156)

## 현재 상태
Phase A 완료, Phase B는 rewind로 코드 손실 → 다음 세션에서 재구현

완료된 SQL은 Supabase에 이미 적용됨 (코드만 사라진 상태)

## 다음 세션에서 재구현해야 할 것

### #4 요청·컴플레인 통합 페이지
- 경로: `app/(app)/requests/page.tsx`, `app/(app)/requests/RequestsClient.tsx`
- 기능:
  - 요청과 컴플레인을 한 페이지에 통합 조회
  - 카테고리 필터 (tenant_requests.category 컬럼 사용)
  - 긴급 여부 표시 (tenant_requests.isUrgent 컬럼 사용)
  - 요청 컴플레인 누르면 "This page couldn't load" 에러 발생 → 수정 필요
- 참고 SQL (이미 적용됨):

```sql
ALTER TABLE "tenant_requests"
  ADD COLUMN IF NOT EXISTS "category" TEXT,
  ADD COLUMN IF NOT EXISTS "isUrgent" BOOLEAN NOT NULL DEFAULT false;
```
- Sidebar에 "운영" 그룹 안에 메뉴 추가

### #5 계약서 통합 페이지 (/contracts)
- 경로: `app/(app)/contracts/page.tsx`, `app/(app)/contracts/ContractsClient.tsx`
- 기능:
  - 서명/스캔 출처 필터
  - 최신순/입실자별 정렬
  - 검색 기능
- Sidebar "운영" 그룹에 메뉴 추가
- 참고: migrate_contract_template.sql, migrate_contract_files.sql 이미 적용됨

### UI 이슈 (#4, #5 작업하면서 같이)
- 로딩 시 로고 밝기/크기 통일 필요
  - 시기별로 다른 수정 요청을 했었기 때문에 일관성 깨짐
  - 햄버거 버튼이 보일 때 로고 위치가 너무 아래로 내려가 보이는 문제
- SplashScreen.tsx 재작성 필요 (rewind로 삭제됨)

## 다음 작업 (그 이후)
- [ ] Phase B 재구현 후 실기 검증
- [ ] Phase C 진입 (별도 세션 권장):
  - #6 국가 서류·양식 페이지
  - DocumentTemplate 모델 신규 설계
  - 카테고리·태그·다운로드 링크/파일 업로드 + 안내 페이지 링크

## 이메일/인증 인프라 (2026-05-18)

구축 완료: stayeum.com 도메인 연결(Vercel)+SSL, Resend 발송 인프라+도메인
인증(DKIM/SPF/DMARC), Supabase 커스텀 SMTP(Resend) 연결, 이메일 템플릿 5종
브랜드화(가입확인·비번재설정·재인증·이메일변경·초대).

### @stayeum.com 이메일 수신 — 나중에 꼭
- 현재 stayeum.com은 발송만 가능, 수신 불가 (받는 메일함 없음)
- Cloudflare Email Routing(무료)으로 @stayeum.com → Gmail 포워딩 설정 필요
- 설정·수신 확인 후 Supabase 계정 이메일을 gunwoo80@gmail.com → @stayeum.com으로 변경
- 순서: Email Routing 설정 → 수신 테스트 → Supabase에서 이메일 변경
- 정식 메일함(IMAP/자체발신)이 필요해지면 Google Workspace·Zoho Mail 검토
  (Synology 등 자체호스팅은 발송 신뢰도 문제로 비권장)

### 관리자 초대 기능 — 미구현
- Supabase 초대 이메일 템플릿은 등록됨, 기능 자체는 없음
- 앱에 "이메일 입력 → 초대" 관리자 화면 개발 필요
- inviteUserByEmail (Supabase admin API — service role key, 서버사이드 전용)
- UserPropertyRole(STAFF 등) 권한 부여 흐름과 연계 설계

### 이메일 템플릿 디자인 — 임시 상태
- 5종 템플릿 임시 디자인 적용 (퍼시몬 카드형)
- 로고·브랜드 디자인 확정 후 일괄 재디자인 예정
- 같은 트리거로 RoomOS 텍스트 잔재 정리도 함께 (현재 의도적으로 남겨둠)
- [ ] 템플릿 HTML 원본을 레포 docs/email-templates/에 보관할지 결정

## 참고
- Phase B 완료 커밋: `git show 801e572` (rewind 전 결과물 참고용)
  - 단, 그대로 가져오지 말고 다시 짜는 게 깔끔함
- AGENTS.md의 세션 시작 규칙 따라 이 파일 먼저 읽을 것

## 주의사항
- 이번처럼 컨텍스트가 차오르면 일정 시점에 /compact 또는 새 세션으로 넘기기
- rewind는 코드를 되돌릴 수 있으니 신중하게 — 컨텍스트 줄이는 용도로 쓰지 말 것