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

## 홈·수납 관리 금액 정합 수렴 (2026-08-11 운영자 승인)
- [x] 1. 행 붕괴 봉합 — 점유 계약 전부를 행으로(lib roomLeaseRowOrder 정본) + 만실 기준 방 단위 (a5c1c35)
- [x] 2. 실수납 정본 수렴 — lib getPaidRevenue + 홈 캡 비대칭 제거 + 캡션 '퇴실 귀속' 항 (452449d, 37cf262)
- [x] 3. 다중 행 표시 정합 — 행 순서 층 위계·같은 호실 인접 정렬·카운터 단위 '명'·InfoHint (c49cb58)
- [x] 4. 미래월 스트립 — 청구 예정액 한 값, 수납·달성률·진행바·등식 제거, 선납 보조줄 (c38405b)
- [x] 5. 감지망 교체 — 행 규칙 소스 판독 + 누락 행 직접 검출 + 실수납 축 대조 + 퇴실 초과 수취 (df70937)
- [x] 검증: tsc · server-action-exports · verify:fast(금전 121/예약인상 72/납부일 33 등 전부) · verify:db · next build · 신규 lint 0
- [x] 실증: 6·7·8·9월 전후 대조 차 0(독립 재현 스크립트), 46방 전수 대조 변경 3방, 감지망 전코드 발화 17건
- [ ] 운영자 실기 확인(402호 황인정 행 복귀 등) 후 푸시 — 이 세션은 푸시 금지

## 부가수익 분류 규칙: 보증금 안의 청소비 몫 (2026-08-11 운영자 정본)
- [x] 1. 분류 정본 `splitWithheldDeposit` + recordDepositReturn 이 성격대로 최대 2행 생성 (2da8970)
- [x] 2. 적용취소 대칭 — `extraIncomeIds` 배열, 조회 findMany, 확인창이 지울 카테고리 명시 (2da8970·9e7cf54)
- [x] 3. `CLEANING_FEE_RECEIVED_WHERE` 로 '입실 수령분만' 6자리 수렴 + 청소비 잔고 이중 계상 제거 (3634ac5)
- [x] 4. 안내 문구 6자리 `withheldDestinationLabel` 수렴 (9e7cf54)
- [x] 5. 백필 2건 — 507호 먀 야다나 모에·509호 탄 타르 누 아예 '보증금 몰취' → '청소비'
- [x] 6. 감지망 두 겹 — 게이트(소스 가드 + 합 대조) · verify:data(존량 오분류), 역주입 4종 발화 후 원복 (77c6200)
- [x] 7. 테스트 — 분류 15케이스 추가(보증금 구성 회귀 13 → 28)
- [x] 검증: tsc · server-action-exports · verify:fast · verify:db · next build · 변경 파일 신규 lint 0
- [x] 실증: 4개월(6~9월) 전후 대조 전항 차 0, 바뀐 것은 8월 카테고리 분해뿐
- [ ] **502호 남태우 재분류 승인** — 같은 클래스 1건, 파손 차감 미포함 확인 후 정정 (verify:data 발화 중)
- [ ] 운영자 실기 확인 후 푸시 — 이 세션은 푸시 금지

## 정산 데이터 정정 2건 + 부가수익 연결 결함 (2026-08-12 운영자 확정)
- [x] 1. 남태우(502) 행 모양 대조 — 507·509 정정본과 category 한 칸만 달랐음(연결·결제수단·detail 전부 동일)
- [x] 2. 부가수익 입주자 연결 결함 봉합 — 선택지 정본 `getExtraIncomeLeaseOptions`(퇴실 포함 73개) + 목록 밖 기존 연결 항목화 + 서버 '칸 없음/연결 안 함' 구분
- [x] 3. 남태우 재분류 백필 — '보증금 몰취' → '청소비'(id 7c913657, 금액·날짜·detail·연결 불변)
- [x] 4. [미반환분 분류] 축 verify:data → verify:db 게이트 승격(존량 0 · 체인 마지막)
- [x] 5. 422 파트쿨리나 락인 오염 정정 — 6월 record 소프트삭제 + 청소비 부가수익(scripts/backfill-partkulina-cleaning.mjs, --revert 왕복 실증)
- [x] 6. 근본 봉합 — `rewriteLockedExpectedForRentAmount` 가 단기 두 칸을 청구 엔진에 넘긴다
- [x] 7. 감지망 신설 — `check-billing-lock-drift.ts`(데이터 1축 + 소스 가드 3종) verify:db 편입
- [x] 8. 부가수익 연결 소스 가드 3종 — verify-money-consistency 6-3
- [x] 검증: tsc · check-server-action-exports · verify:fast(전 항목) · verify:db · verify:data · next build · 변경 파일 신규 lint 0
- [x] 실증: 5~9월 KPI 전후 대조 18항 전부 의도한 변화, 그 외 차 0 · 역주입 6종 발화 후 원복 · 왕복 후 상태 재현성 차 0
- [ ] 운영자 실기 확인(부가수익 수정에서 퇴실자 선택·연결 보존) 후 푸시 — 이 세션은 푸시 금지

## 서류 묶음 발송 1단계 (신고 44501308, 확정 설계 시공)

승인 사항: 사람 단위로 열되 행은 계약 축, 미발급 자동 발급 없음(작성 왕복만), 합본 PDF·데스크톱 폴백·이메일은 범위 밖.

- [x] 1. `lib/docShareQueue` 다페이지 확장 — 항목당 `Blob[]`, 첨부 파일명 정본 `shareFileNames`, 1페이지 경로 무회귀 케이스 잠금
- [x] 2. `useDocShare`·`DocMultiShareBar` 배선 — 파일 수 노출, MAX_SHARE(10) 초과 시 바가 개수 안내(막음), 모달 안 알약(aboveModal)
- [x] 3. 서버 액션 `getTenantDocBundle` — CONTRACT_ISSUE_STATUSES 계약별 그룹, 종류별 최신, deletedAt null
- [x] 4. 시트 컴포넌트 `TenantDocBundleSheet` — 형식 세그먼트, 계약 그룹, 서류 목록 4화면 행 문법, 미발급 = 작성 왕복
- [x] 5. `EntityModal` 배선 — 입주자 면 '서류 보내기', 수납 면은 `shownLeaseId` 기본 체크, 공유 미지원 기기 진입점 숨김
- [x] 6. 게이트 — tsc 0 · verify:fast · verify:db · 프로덕션 빌드 · eslint 신규 0(497) · 320/360/390 라이트·다크 넘침 0 실측
- [x] 7. 실데이터 읽기 전용 검증 — 김상혁(509 메인 + 601 비거주 종속) 행 규칙 전부, 계약 1건 입주자 무회귀
- [x] 후속 발견 봉합 — 준비 큐 캐시가 형식을 안 가려 사진/PDF 전환 시 옛 형식이 나가던 길(형식별 큐로 분리)
- [x] 후속 발견 봉합 — 하단 알약이 320px 에서 화면 밖으로 밀려 닫기 버튼에 손이 안 닿던 길(문구 축소 허용)
- [ ] 운영자 실기 확인 — 실기기 공유 시트(사진 여러 장·PDF), 다페이지 계약서 장수, 작성 왕복 복귀
- [ ] 푸시 — 이 세션은 푸시 금지
