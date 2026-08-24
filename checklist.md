# 보증금 수납 경로 시공 체크리스트 (신고 98fb6fce · 00c39371 · 9e6c7cb3)

운영자 승인 완료. 워크트리 작업, 푸시 없음(메인이 검증 후 머지). 항목별 즉시 커밋.

## 1단 — 1급 진입로
- [x] `DepositStatusPanel` 미수납·부분수납에 '받음으로 기록' CTA (`Btn subtle sm`, 형제 '환불 정산 기록'과 같은 자리·문법)
- [x] 인라인 미니폼 — 금액(잔여 프리필) · 납부일(정본 DatePicker) · 납부방법. 새 모달 없음
- [x] 잔여 초과 입력은 인라인 오류로 차단(초과분이 조회월 밖 이용료로 앉는 길을 막는다)
- [x] 노출 술어에서 `preAcquisition` 제외(`carriedOver` 로는 '일부 받은 승계' 3건이 샌다)
- [x] 저장은 `saveDepositPaymentForLease` → `saveDepositPayment` 정본
- [x] 성공 토스트에 금액·수납일 + 적용취소
- [x] 수납 폼의 보증금 진입점을 미수납 상태에서 금액 칸 **위**로(상태 줄) — 3단 블록이 아래를 맡는다

## 2단 — 자동 스탬프 봉합
- [x] 호출부 3곳 전수 `payDate`·`payMethod` 전달 (tenants 신규 · tenants 수정 · DepositSection 행)
- [x] 입주자 폼 체크 아래 입금일·결제수단 두 칸(§29 em dash 제거 포함)
- [x] DepositSection 행 인라인 미니폼(확인창 둘 제거 — 금액이 칸이 되면 3지선다가 물을 것이 없다)
- [x] 소급 경로 결제수단 기본값 '기타' 유지(모르는 것을 지어내지 않는다), 날짜 기본값 오늘
- [x] 두 함수 역할 경계를 코드 주석에 명시
- [x] `recordDepositReceived` 가 만든 record id 반환 → 적용취소
- [x] `DEPOSIT_PAY_METHODS` 정본 신설(이름 없는 부분집합 사본 셋 수렴)

## 3단 — 배분 제안·확인형 (운영자 승인 2026-08-24)
- [x] `proposeDepositEntrySplit` 순수 함수(lib/depositComposition) — 잔여 기준, 계약액 기준 아님
- [x] 보증금 잔여 > 0 이면 분해 블록 상시(입력값이 아니라 데이터로 선다)
- [x] 보증금·청소비 편집 가능, 이용료는 §12 자동 합산 읽기전용
- [x] 합 불일치 인라인 오류 + 저장 차단(선언·버튼 결선·제출 경로 셋)
- [x] 승계 계약은 보증금 몫 기본값 0 + 올릴 때 기준액 전환 고지
- [x] 제안 그대로면 오늘과 같은 한 번의 호출, 고쳤을 때만 몫별 정본 저장부
- [x] 현금영수증이 보증금 몫에도 찍히는 사실을 화면이 말한다(집계 규칙 변경은 운영자 결정)
- [x] 적용취소(`undoOverpayExtraIncome`, extraIncomeId 옵셔널화)

## 회귀
- [x] `test-deposit-composition` 36 → 54 (분해 제안 9축 + 합 항등 9축)
- [x] `verify-money-consistency` 규칙 20 — 소스 5 · 데이터 2(기준선 래칫) · 나열 1
- [x] 역주입 7축 전부 exit 1 확인 후 복원
- [x] 규칙 3 소스 가드의 대소문자 구멍 봉합(실제 위반 두 자리를 못 잡고 있었다)

## 게이트
- [x] tsc 0
- [x] `npm run verify:fast` exit 0
- [x] `npm run verify:db` 기지 예외(서류 표시값 소재지 3건)에서만 정지 — 규칙 20 은 통과
- [x] 프로덕션 빌드 exit 0
- [x] eslint 491 유지(신규 0)
- [x] 320/360/390/430 × 라이트·다크 8조합 넘침 0 · 날짜 잘림 0 실측(헤드리스 크롬 + 프로덕션 CSS)
- [x] `test-money` 200 통과 무변동 — 산식 무접점
- [x] 배포 전 웹디자이너 패스 — **차단 5건 전부 반영**(죽은 오류 보더 · 모달 안 뷰포트 질의 ·
      min-h 로 늘어난 높이 혼용 · 형제 전수 미완 · 다크 표면 셋 중 둘) + 반영 권고 5건

## 안 한 것(의도)
- [ ] 현금영수증 스탬프를 이용료 몫에만 찍기 — 집계 축 변경(loop.md 4번), 운영자 결정 대기
- [ ] `ExtraIncome.cashReceiptIssuedAt` — 스키마 변경, 운영자·세무 확인 대기
- [ ] 8/23 건 포함 자동 스탬프 7건 정정 — 실입금일·수단은 운영자만 안다(DB 쓰기 금지)
- [ ] `/tenants` 수제 수납 폼을 정본 `PaymentEntryForm` 으로 수렴 — 범위 밖(아래 컨텍스트 노트)
- [ ] `MoneyInput` 42px → 44px — 소비처 스무 곳 넘는 컴포넌트 차원
- [ ] `<select>` 고유 높이 40px 대 입력 42px 2px 차 — 토큰에 없는 높이를 박지 않는다(종전 4px 차)
- [ ] `DepositSection` 서브탭 raw button → ViewTabs 정본 — 범위 밖
- [ ] `saveCleaningFeePayment` 의 잔여 가드 부재·영업장 스코프 검증 누락 — 범위 밖(기록만)
