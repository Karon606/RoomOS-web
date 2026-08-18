# 체크리스트 — 환경설정 IA 재정리 1단계 (운영자 확정 4건, 2026-08-18)

운영자 확정 요지.
1. 홈 카드 2장 → 환경설정 새 '웹사이트' 탭으로. 홈에는 "소개 페이지 반영 대기 N건" 한 줄만(N=0이면 없음).
2. 8탭 재편 중 **1단계만** — 웹사이트 탭 신설. 기본정보 분해 등 2단계는 범위 밖.
3. 카드 2장을 '소개 페이지 반영 대기' 카드 1장으로(안에 올릴 방 / 내릴 방 구획).
4. '공개 페이지' → '소개 페이지' 어휘 통일, glossary 적립.

## 0단계 — 설계 (코딩 전)
- [x] AGENTS.md · loop.md · SettingsForm 구조 · DashboardClient 2872~2910 · knowledge/glossary.md 통독
- [x] 정본 대조 — room-manage `setRoomShowOnSite` · lib/vacancy · ViewTabs(§25) · 홈 '이달 입퇴실 N건' 링크 줄
- [x] 기준선 측정 — tsc 0 · eslint 497 problems
- [x] 좁은 폭 실측(실 dev 서버 + 헤드리스 Chrome, 320/360/390 라이트·다크)

## 1단계 — 어휘 통일 ('공개 페이지' → '소개 페이지')
- [x] 노출 문구 전수 — SettingsForm 슬러그 라벨·설명 / MarketingClient 6곳 / ConsultToolsModal 1곳
- [x] knowledge/glossary.md 적립
- [x] 커밋

## 2단계 — 후보 산출 정본 추출
- [x] lib/siteCandidates.ts 신설 (where 조각 1벌 + 목록/건수)
- [x] dashboard/page.tsx 를 정본 호출로 전환 (손사본 제거)
- [x] 커밋

## 3단계 — 웹사이트 탭 신설
- [x] TABS 에 '웹사이트' 추가 + 탭 줄을 ViewTabs(§25 정본, 자연폭+가로스크롤)로 전환
- [x] settings/page.tsx ?tab= 딥링크 + 후보 목록 서버 로드
- [x] WebsiteTab.tsx — (a) 소개 페이지 주소(슬러그) (b) 반영 대기 카드 (c) 바로가기 2줄
- [x] 기본정보에서 슬러그 제거 + 이사 안내 한 줄(2~4주 후 제거 예정 주석)
- [x] **저장 무회귀** — updatePropertySettings 가 슬러그 필드 부재 시 null 로 덮지 않게 가드
- [x] 대조 테스트 남기기 (scripts/check-settings-slug-guard.mjs, verify:fast 등재)
      — 가드를 떼고 돌려 exit 1 로 잡히는 것까지 확인
- [x] 마케팅 빈 상태·상담 도구 안내의 위치 지목을 웹사이트 탭으로
- [x] 커밋

## 4단계 — 홈 한 줄 알림
- [x] 카드 2장 제거 → "소개 페이지 반영 대기 N건" 한 줄 링크(?tab=website), N=0 이면 렌더 없음
- [x] 서버 페이로드를 목록에서 건수로 축소
- [x] 커밋

## 5단계 — 게이트
- [x] tsc 0 (기준선 0 유지)
- [x] eslint 496 (기준선 497 · 신규 0 · 홈 카드 img 경고 1건 감소)
- [x] verify:fast
- [x] verify:db (check-document-override-lock 3건은 기존 데이터 결함 — 이번 변경과 무관, 나머지 전부 통과)
- [x] 프로덕션 빌드 47/47 정적 생성 성공
- [x] 새 UI 320/360/390 라이트·다크 넘침 0 (6개 조합 전부)
- [x] 실데이터 읽기 전용 확인 — 반영 대기 11건(올릴 방 0 · 내릴 방 11), 건수·목록 일치
