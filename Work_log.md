# 스테이음 작업 로그

마지막 업데이트: 2026-05-18
브랜치: main (c75126e)

## 완료된 것

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

### #6 국가 서류·양식 페이지 (Phase C — 별도 세션 권장)
- DocumentTemplate 모델 신규 설계
- 카테고리·태그 + 다운로드 링크/파일 업로드 + 안내 페이지 링크

## 참고 / 주의사항
- AGENTS.md 세션 시작 규칙 — 매 세션 이 파일을 먼저 읽고 이어갈 것
- 컨텍스트가 차오르면 /compact 또는 새 세션으로 넘기기
- rewind는 코드를 되돌리니 신중하게 — 컨텍스트 줄이는 용도로 쓰지 말 것
