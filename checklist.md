# 재고 기능 공백 4건 시공 (2026-08-19, 운영자 백로그 위임)

점보롤 사건(Work_log 2026-08-19 (5)·(6))에서 드러난 공백 4건. 정본은 lib/stockLedger
(점검=절대값, 입수·폐기=델타, 잔량=마지막 점검+이후 델타, isReconcile=전파 정지점).
1번이 몸통 — 무상입수에는 이미 배포된 '이후 잔량 자동 재계산'(planStockShift)의 짝을
지출(구매) 수정·삭제 경로에 붙인다.

## 0단계 — 조사·패널 합의
- [x] 정본 문서(AGENTS·loop·Work_log (5)(6)·knowledge/domain-inventory) 정독
- [x] 상류(지출 폼)부터 하류(잔량 표시)까지 흐름 추적 — 구매 델타의 경계 술어는
      receivedAt <= check.createdAt (sumPurchases, overview.ts:35)
- [x] 전문가 패널 4인(재고 도메인·백엔드 감사·UX·웹디자이너) 검토 회수
- [x] 설계 확정 — 실데이터 판정 포함(수령완료 322건 중 자동점검 없는 구식 288건이 본류)

## 1단계 — 지출 수량 정정의 재고 전파 (몸통)
- [x] lib/stockLedger 에 PurchaseDelta·purchaseAfterCheck (5e4d6c67, 회귀 51 → 73)
- [x] 적용층 공용 모듈 ledgerShift 분리 + 감지망 앵커 재지정 (8c9325c6)
- [x] previewExpenseStockShift + updateExpense adjustStock 게이트 + 정체성 차단 +
      cancelReceiptCore(수령 취소 정본, 비움 뒷문 봉합) + deleteExpense 함께 조정 +
      제외/재포함 대칭 + 클라 다이얼로그 정본 stockShiftAsk + 감지망 5축 (7a2e329f)
- [x] 미사용 import 정리, eslint 기준선 복원 (8c830bc0)

## 2단계 — 시작 재고 정식 입력 자리
- [x] createTrackedItem startQty + '[시작 재고]' isReconcile 앵커, AddItemModal 칸 (dbb8f84a)

## 3단계 — 같은 날 중복 앵커 감지·안내
- [x] createStockCheck sameDayNotice(맨 절대값 점검만, 자동 삭제 없음) + 토스트 (3b2ba0f4)

## 4단계 — 실측 > 장부 입수 과소 의심 신호
- [x] overbookExcess 정본 + CheckForm 실시간 경고 박스 (a5a7f434, 회귀 79)

## 게이트 (전부 필수)
- [x] tsc 0
- [x] npm run verify:fast exit 0
- [x] npm run verify:db exit 0 (소재지 오버라이드 3건 기지 예외 + 발급본 래칫 9건 안내는 기존 관찰)
- [x] 프로덕션 빌드 exit 0
- [x] eslint 491 → 491 (신규 0, 기준선 1bd40ad5 대조)
- [x] 좁은 폭 실측 30조합(5탭 × 320/360/390 × 라이트·다크) — 신규 넘침 0,
      탭 줄 46px 단일 행 유지(접힘 0), 트랙 662px 가로 스크롤
- [x] 저장 무회귀 실측 — 실제 DOM 이 만드는 FormData 로 탭 밖 칼럼 침범 0 · 담당 칼럼 누락 0
- [ ] 운영자 실기 확인(배포 후)

## 미결 · 범위 밖
- 계약서 본문 카드의 섹션 삭제 버튼이 320px 에서 11px 넘침 — **재편 전과 동일**(1bd40ad5 대조
  실측: 같은 4요소, 같은 right=331.2). 이번 작업이 만든 것이 아니라 손대지 않았다.
  고치려면 섹션 제목 input 에 min-w-0 한 토큰(플렉스 아이템 min-width:auto 가 축소를 막는다).
- 청소비 보증금 포함 토글이 '기본 청소비' 칸이 아니라 '퇴실 환불 규정' 블록 안에 있다.
  카드 내부 무수정 이동 원칙에 따라 그대로 옮겼다. 자리 재검토는 별건.
# 계약서 '폐기하고 다시 작성' (긴급 신고 63cd1049, 2026-08-19)

신고 원문.
"계약서에 이름이 한국어로 된 채 발급까지 되어버려서 폐기하고 다시 작성을 하기 위해 삭제를 누르고
작성하려니 안 되네. 아래에 안내는 지우라고 하는데 이미 지워졌는데도 안 돼. 계약서 페이지로 가서
보니 발급 안 한 거 있다고 발급하라고 하고. 발급하니 원래대로 돌아왔어. 이 상황이면 이중계약서
(지난번에 어쩔 수 없이 필요한 경우가 있다고 했어) 작성도 못하게 되는 거야."

대상 입주자 e1fe94c6(501호). 실데이터는 읽기 전용으로만 본다 — 정정은 배포 후 운영자 실기 몫.

## 0단계 — 원인 확정 (읽기 전용, 완료)
- [x] 실데이터 재구성: 링크 f0c0b642 서명(8/19 06:10) → 발급 #014(06:13) → 삭제(06:17) → 재발급 #015(06:19)
- [x] 잠금 사슬 지목: isSignatureLocked(4칸 OR) → saveContractFieldOverride 거부 → nameStyle 전환 불가
- [x] 발급본 삭제(deletedAt)가 잠금 사슬 어느 고리도 안 건드림을 확인
- [x] "지우라" 안내(FIELD_LOCK_MSG)와 실제 조건(4칸 OR·전량 삭제 문이 드리프트 경고에만) 갈림 확인
- [x] /contracts 발급 대기 부활 경로(isContractIssued 의 deletedAt: null) 확인
- [x] 재발급이 옛 이름으로 나가는 이유(nameStyle 오버라이드 부재 → 기본 'ko') 확인
- [x] 기준선 채취: tsc 0 · verify:db 통과 · 박제 8건(기준선 6, 스크립트가 8 로 상향 안내)

## 1단계 — 폐기 정본 (스키마 + 서버)
- [x] lib/contractVersion.ts — 폐기 이력 모양·조립·복원·'지금 서명을 만든 링크' 판정 정본
- [x] schema.prisma: lease_terms.contractVersionArchive(Json?) · contract_files.voidedAt(DateTime?)
- [x] prisma/migrate_contract_version_void.sql (IF NOT EXISTS, 행 데이터 불변) + DIRECT_URL 적용
- [x] voidContractVersion / restoreContractVersion 서버 액션
- [x] clearContractSignature 가 '서명 0' 이 되는 모든 갈래에서 같은 정본을 타게 (증거 파괴 경로 봉합)
- 검증: tsc 0 · 함수 단위 테스트 통과

## 2단계 — 진입로와 표시
- [x] ContractView 툴바 [이 계약서 폐기] (잠긴 상태에서만) + 확인창 + 토스트 적용취소
- [x] 드리프트 '재서명 받기' 갈래도 같은 정본으로
- [x] ContractFilesPanel · /contracts 목록 [폐기됨] 배지 + [현재] 후보에서 제외
- 검증: 320/360/390 라이트·다크 넘침 0

## 3단계 — 오판 문구·판정 봉합
- [x] 잠금 안내 3종(표시값·본문·계약일)이 실제 조건과 폐기 진입로를 말하게
- [x] 발급본 삭제 확인창이 "삭제는 폐기가 아니다"를 먼저 말하게 (두 화면 동일 문구)
- [x] /contracts 발급 대기 안내에 '내용을 바꾸려면 폐기' 경로 한 줄
- [x] 드리프트 비교 대상을 '지금 서명을 만든 링크'로 한정 (폐기 후 허위 경고 차단)

## 4단계 — 감지망·검증
- [x] check-sign-date-integrity 축 1 에서 폐기본 제외 (폐기된 종이의 계약일은 그때가 맞다)
- [x] check-contract-override-lock G1·G5 대조 대상을 같은 정본으로 + G7(폐기 이력 증거 결손) 신설
- [x] check-contract-issued-snapshot SNAPSHOT_BASELINE 6 → 8 (스크립트 자체 안내)
- [x] scripts/test-contract-void.ts + verify:fast 편입, 역주입 발화 확인
- [x] 실데이터 함수 수준 실증(쓰기 없음): 폐기 → 이름 표기 전환 → 재발급 값 확인
- [x] tsc 0 · verify:fast · verify:db · 프로덕션 빌드 · eslint 신규 0
- [x] eslint 491 → 491 (신규 0)
- [x] 320/360/390 라이트·다크 헤드리스 실측 54측점 넘침 0 (빌드 CSS + Pretendard,
      모달·경고 박스·3지/2지 다이얼로그 최장 라벨)
- [x] 역주입 — 신규 감지망 축 2종 발화 확인
- [x] 웹디자이너 패스
- [x] knowledge/domain-inventory.md 적립
- [ ] 푸시 금지 — 메인 세션이 검증 후 머지
