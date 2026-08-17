# 체크리스트 — 상담 도구 (오류신고 ce05bb74, 2026-08-17)

운영자 부재 중이라 갈리는 선택은 패널 권장안으로 확정했다. 되돌리는 법은 context-notes.md 에 있다.

## 0단계 — 설계 (코딩 전)
- [x] AGENTS.md · loop.md · docs/brand-guide-v2.0.md 통독
- [x] 신고 원문 확인(check-error-reports)
- [x] 패널 3인 검토 — UX · 웹디자이너(가이드) · 도메인
- [x] 실데이터 조회(제기역점 Property · FinancialAccount 11행)
- [x] 기준선 측정 — tsc 0 · eslint 497 · 프로덕션 빌드 통과

## 1단계 — 공개 URL 정본 추출
- [x] lib/publicSite.ts 신설(PUBLIC_SITE_ORIGIN · publicSiteUrl)
- [x] marketing/actions.ts 소비 전환(값·동작 불변)
- [x] 커밋 2ca6afd6

## 2단계 — 서버 액션
- [x] app/(app)/consultInfo.ts — getConsultInfo
- [x] 입금 계좌 = Property.bankAccount (FinancialAccount 미사용, 근거 주석)
- [x] 사업자번호 normalizeBizNo 방어(정규화 이전 저장분)
- [x] canReadScope(role,'money') 로 계좌 차단
- [x] check-server-action-exports 통과
- [x] 커밋 143dd963

## 3단계 — 코너 UI + 진입점
- [x] components/ConsultToolsModal.tsx — Modal sm · 풀블리드 · 행 전체 복사
- [x] 행 규격: py-3 · px-5 sm:px-6 · 라벨 12/500 --warm-muted · 값 14/400 --warm-dark · .num
- [x] 구분선 --warm-border/50 · hover --cream-soft · active --sand · focus ring inset
- [x] 말줄임 금지(보이는 값 = 복사되는 값)
- [x] 빈 값은 줄 생략 · 전부 비면 EmptyState + 환경설정 링크
- [x] 안내문 묶음(영업장명·주소·URL·연락처 4줄, 계좌·사업자번호 제외)
- [x] 단기 요금 계산 진입 이관 + StayQuoteModal z 인자(200|260)
- [x] 홈 월 선택 줄 버튼 교체('단기 요금 계산' → '상담 도구') + flex-wrap
- [x] 전체 메뉴 도구 그룹에 '상담 도구' 타일(제한 스태프 숨김)
- [x] 커밋 72f768ce

## 4단계 — 실측·봉합
- [x] 헤드리스 하네스(실제 컴포넌트 번들 + 빌드 CSS + Pretendard)
- [x] 320/360/390 × 라이트/다크 × 이번달/과거월 = 12조합
- [x] 안내문 URL 줄 320px 34px 넘침 발견 → overflow-wrap:anywhere 봉합
- [x] 재측정 12조합 전부 문서 넘침 0 · 잘림 0
- [x] 복사 문안 6종 실측(clipboard.writeText 가로채 원문 대조)
- [x] 대비 라이트 최저 5.12 · 다크 최저 4.91 (AA 통과)
- [x] 커밋 e9e7824b

## 5단계 — 게이트
- [x] tsc 0
- [x] verify:fast 통과
- [x] verify:db 통과(위반 0)
- [x] 프로덕션 빌드 47/47
- [x] eslint 497 → 497 (신규 0)

## 6단계 — 기록
- [x] knowledge/property-public-facts.md 적립 + INDEX 등재
- [x] checklist.md · context-notes.md
- [x] Work_log.md

## 남긴 것 (운영자 판단 대기)
- [ ] 신고 ce05bb74 상태 done 처리 — 운영자 실기 확인 후
- [ ] 명칭 '상담 도구' 확정 여부(대안 '영업장 정보'·'자주 쓰는 정보')
- [ ] 안내문 묶음에 계좌 포함 여부(현재 제외)
