# 2차 전앱 감사 — 일관성·상용화(테넌트 독립) (2026-07-10)

운영자 지시: 상용화 기준으로 전 기능 재점검, 리스트업만(진행 여부는 운영자 판단). 렌즈 4종: 하드코딩 / 시각 / 인터랙션 / 페이지 구조.

## A. 상용화 차단급 — 제기역점 전용 하드코딩 (심각 5)
| # | 내용 | 위치 |
|---|---|---|
| A1 | 실거주 확인서 제출처 '서울특별시장 귀하' 고정 + 서울 서식 좌표맵 — 타지역 영업장 공문서 오류 | app/residence-cert/[tenantId]/actions.ts:109, lib/residenceCertLayout.ts |
| A2 | 재고 추적 카테고리 '부식비/소모품비/폐기물 처리비' 상수 고정(TRACKED_CATEGORIES) — 설정(inventoryCategories)과 이원화, 개명 시 재고 인식 깨짐 | app/(app)/inventory/constants.ts:1, components/dashboard/PendingReceiptSection.tsx:214 |
| A3 | 품목 추적 단위 기본값이 '폐기물 처리비' 문자열 일치로 분기(4곳) | app/(app)/inventory/actions.ts:253·1409·1491·1591 |
| A4 | 지출 폼 카테고리 목록 하드코딩(설정 미반영) — 폼·OCR·대시보드 승인 UI 3곳 중복 | finance/FinanceClient.tsx:93·1413, PendingReceiptSection.tsx:24·29 |
| A5 | 기본 계약서 템플릿에 제기역점 금액(청소비 2만·추가 3만·보관료 3만) 박힘 — 타 운영자 법적 문서에 그대로 발행 위험 | lib/contract.ts:42·53 |
| A6(경미) | placeholder·예시에 실명·실계좌·실상호('김건우','제기역점','thestayjegi') | SettingsForm.tsx:813·836·2058, RentReceiptView.tsx:132 |

## B. 시각 일관성 (15) — 핵심 6
- B1 수제 primary 버튼 난립(라운드·높이·hover 제각각, 36px 터치타겟 위반 포함) — 정본 Btn 채택률 낮음
- B2 --coral vs --persimmon 토큰 혼용(+ rgba(244,98,58) vs rgba(160,60,46) 원시색 이원화)
- B3 모달 취소 버튼 3종(텍스트링크/아웃라인/Btn secondary), ModalFooterActions 채택 2/22
- B4 금액 포맷터 로컬 재정의 5파일(만원 축약 vs 풀 콤마 혼용) — **lib에 표시용 정본 부재가 근본 원인**
- B5 날짜 포맷 4종 혼용(YYYY.MM.DD / 년월일(요일) / locale 2-digit / M/D) — 정본 포맷터 부재
- B6 라이트 전용 리터럴 색 잔존(dashboard 구분선 rgba, floor-plan hex) — 토스트 사고와 동종 다크 위험 ✅ 2026-07-10 1차 스윕(2f4bd1a): 구코랄 12곳·테라코타 틴트 6곳 color-mix 치환, Sidebar 라벨·ConfirmDialog 아이콘·TrendChart 그리드·정산 박스 토큰화. 잔여: floor-plan 캔버스(의도적 고정 검토), 인쇄 문서 제외 확정
- (그 외: 배지 수제 64곳, 아이콘 strokeWidth 9종, danger 버튼 3종, secondary 배경 토큰 불일치 등)

## C. 인터랙션 문법 (12) — 핵심 6
- C1 같은 카드 안 저장 3문법(배정일 자동/수량 저장버튼/규격 조건부버튼) — 규칙 성문화 필요
- C2 저장 실패 통지 3채널(토스트/인라인/둘 다) 혼재
- C3 finance만 선택 모드 진입 버튼 없음(롱프레스 전용 — 발견 불가)
- C4 삭제엔 undo 토스트 미적용(확인창만), 비삭제 변경엔 undo 적용 — 안전장치가 위험도와 반대
- C5 confirmDialog 취소 버튼에 실 변경 동작('영수증만 첨부' 등) — Esc/배경클릭이 변경 실행
- C6 검색↔필터 규칙 상반(재고=필터 무시 통합, 수납=필터 내 검색) + 월 셀렉터 스코프 고지 4형태
- (그 외: confirm level 누락 1곳, impact[] 미사용, '수정/편집' 라벨, 카드 탭 대상 3종, 토스트 종결형)

## D. 페이지 구조 (15) — 핵심 6
- D1 마케팅·시세조사 페이지가 별도 제품처럼 보임(서체·색·수제 탭·인라인 style 전면)
- D2 이중 패딩 위반 5페이지(contracts·확인서 2종·accrual·market) — 인셋 어긋남
- D3 **권한 가드 전무**: 뷰어(STAFF)에게 편집 버튼 노출→눌러야 실패 (canEdit 死코드 포함)
- D4 '불러오는 중…' 인라인 텍스트 §16 위반 5곳(정본 SkeletonRows)
- D5 빈 상태 3형태 혼재(EmptyState/수제 p/EmptyHint), InfoHint 유무 쌍둥이 페이지 불일치
- D6 loading.tsx 없는 잦은 전환 라우트(rooms·finance·report·market)
- (그 외: h1 크기 3종, 제목 '섹션 · 탭' 규칙 미일관, report raw 버튼/셀렉트, floor-plan h-screen 셸 깨짐, '처리 중...' 표기 3종)

## 진행 현황 (2026-07-10)
- **A1~A6 전건 완료·배포**: 실거주 확인서 비서울 발급 차단(유추 금지, 운영자 정정 반영), 재고·지출 카테고리 설정 기반, 추적단위 키워드 휴리스틱, 계약서 {{청소비}} 변수화, placeholder 일반화.
- **D3 완료(2배치)**: RoleProvider/useCanEdit — 입주자·수납·호실·지출·재고·비품의 편집 진입 버튼을 뷰어(STAFF)에게 숨김(서버 requireEdit 최종 방어).
- **B4 완료**: accrual·alerts·report 로컬 금액 포맷터 제거 → 정본 fmtWon. (marketing fmt는 방문 수 카운트라 금액 아님 — 제외)
- **B5 1단계**: lib/fmtDate.ts 정본 신설(fmtDateDot/fmtDateKor/fmtMD) — 로컬 fmtDate 치환 스윕은 다음 단계.
- **B5-2 완료(2026-07-10)**: 로컬 fmtDate 16곳 lib/fmtDate 치환. **C 완료**: 가이드 §26 성문화 + C2(토스트 단일화 14곳)·C3(finance 선택 버튼)·C4(점검·입수 삭제 undo)·C5(choiceDialog 3지선다)·C6(재고 검색 탭 스코프) 코드 반영.
- **D 대부분 완료(2026-07-10)**: D2 이중 패딩 5페이지, D4 인라인 로딩 5곳 SkeletonRows, D5 발급 쌍둥이 h1+InfoHint·EmptyState, D6 loading.tsx 4라우트(rooms·finance·report·market).
- **마무리 배치 완료(2026-07-11)**: D1 잔여(시세 모달 입력·라벨 정본 클래스 14곳, report raw 버튼 Btn화, 시세 로컬 Btn·마케팅 수제 알약은 전일 완료), B2(유일한 raw 푸터 취소 버튼 Btn화), C 경미('…' 말줄임 79곳 통일, 세부스펙 삭제 level 부여, '편집' 라벨은 기존에 정리 확인), D5 잔여(체크리스트 로컬 EmptyHint → EmptyState).
- **의도적 보류**: B3 정적 배지 스윕(54곳) — 카테고리 틴트 등 동적 색 변형이 많아 기계 전환 부적합, 화면별 검토가 필요한 별도 작업. impact[] 확충은 삭제 API들이 연쇄 건수를 반환하도록 하는 서버 작업과 묶어서.
- 이로써 2차 감사 48건 중 B3·impact 확충 외 전건 종결.

## 우선순위 제안
1. **A1~A5 (상용화 차단)** — 다른 영업장에서 오작동·법적 문서 오류
2. **D3 권한 가드** — 상용 멀티유저 기본기
3. **B4·B5 정본 포맷터 신설 + 일괄 치환** — 레버리지 최대
4. B1~B3 정본 컴포넌트 채택 스윕, C1~C6 문법 성문화(가이드 §)
5. D1·D2 이탈 페이지 정렬, 나머지 경미
