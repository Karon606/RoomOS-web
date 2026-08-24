# 오류신고 1건(증상 둘) 시공 체크리스트 (2026-08-24, 운영자 승인 완료)

대상: [16f691e1] /room-manage?tab=moves — ① 왼쪽 호실 열이 안 눌린다 ② 스케줄 막대가 스침에 발화한다.
**표시·인터랙션 층만.** 데이터·계산 무접점(DB 쓰기 0, 스키마 변경 0, `lib/moveCalendar` 조립 무수정).

## 0. 전제
- [x] 워크트리를 최신 main 에서 땀 (68f1638c, 0단계 e245aa06 포함 확인)
- [x] `.env.local`·`node_modules` 심링크
- [x] 기준선 — tsc 0 · eslint 491 · 빌드 exit 0 · 조립 회귀 236 · 드리프트 위반 0(행 41·막대 72)
- [x] 실측 하네스 세움 — 실데이터 SSR + 빌드된 Tailwind CSS + 로컬 Pretendard + 헤드리스 Chrome
- [x] 0단계 불변 기준선 재현 (16조합 전부 동일)
      노드 609 · 트랙 높이 1040(fine)/1200(coarse) · 인터랙티브 36 · sticky 80 · 행 19 ·
      거주 레인 20 · 막대 36 · 표식 14 · 공실 캡션 20 · 호실칸 최소 높이 36(fine)/44(coarse)

## 1. 전문가 패널 (서브에이전트 3인)
- [x] UX/UI — 임계값, 호실 열에도 같은 가드를 걸지, 20px 터치 타겟, aria 문안, 어포던스
- [x] **웹디자이너(가이드 정합)** — focus 링 문자열·오프셋, div→button 기하 리셋 전수, §23 식별자 색, 대비
- [x] 프런트엔드 성능 — 핸들러 배치, 좌표 보관처, pointermove 대 pointerup, Blink 래치 재발 여부
- [x] 세 회신 모두 최종 출력으로 수령 — UX/UI · 웹디자이너 · 성능. 배포 후 디자이너 재패스 1회 추가

## 2. 증상 ① 호실 열 열기
- [x] `GanttRow` 호실 셀 `<div>` → `<button type="button">`
- [x] `entityModal.open({ kind: 'room', roomId })` — 계약 시드 없음, 열기 경로는 `MoveCalendar` 안
- [x] `aria-label` · `focus-visible` 링
- [x] sticky · z-index · 배경 · `.attn` 코랄 3px 팁 그대로
- [x] 스페이서 셀 둘(행 아래 줄·꼬리)은 `<div>` 유지
- [x] 기하 무변동 실증 (노드 +N 외 전항 동일)

## 3. 증상 ② 스침 무시
- [x] 순수 함수 정본 신설 — 임계 상수 + 이동 판정 + click 억제 판정
- [x] 선례 문법 재사용 (RoomCard 10px §23 · ErrorReportButton 8px)
- [x] 막대·호실 열 양쪽에 같은 가드
- [x] 시간 임계 없음 · `touch-action` 무변경 · 히트영역 무축소
- [x] 키보드·보조기기 활성화는 언제나 통과
- [x] Blink 관성 스크롤 중 click 성립 여부 — 흐름 축으로 덮게 설계, **실기 확인 대상으로 보고**

## 4. 회귀
- [x] 제스처 순수 함수 회귀 신설 (임계 이내 탭 통과 · 초과 억제 · 세로만 이동 · 키보드 통과)
- [x] 호실 열 접근성 축 (role · aria-label · focus · 스페이서 제외)
- [x] `verify:fast` 에 배선
- [x] 조립 회귀 **236 무변동** 확인(verify:fast 로그 33행) — 새 축은 별도 파일이라 이 수가 안 움직인다

## 5. 게이트
- [x] tsc 0
- [x] `npm run verify:fast` — **선재 red 에서 정지**(check-datepicker-shell 3건, main 68f1638c 에 이미 있던 보증금 트랙 잔재). 이번 변경분 무접점, 잔여 17종 따로 돌려 전부 통과
- [x] `npm run verify:db` 기지 예외(서류 표시값 소재지 3건)에서만 정지
- [x] 프로덕션 빌드 exit 0
- [x] eslint 신규 0 (491 유지)
- [x] 320/360/390 라이트·다크 넘침 0
- [x] 44px 터치 타겟·대비 실측 — coarse 44px 미달 0(합성 행 포함) · 링 대비 2.78→4.63:1
- [x] **배포 전 디자이너 패스**

## 6. 마무리
- [x] 임시 하네스 파일 전부 삭제 (`scripts/_tmp-*`)
- [x] Work_log·knowledge·컨텍스트 노트 갱신
- [x] 항목별 커밋 (푸시 금지 — 메인이 검증 후 머지)
## 안 한 것(의도 · 기록만)
- [ ] `InfoHint` (i) 아이콘 대비 2.20:1 — 정본 컴포넌트 29곳 파급, 운영자 결정
- [ ] `DashboardClient:1392` 축 칩 `납부일 기준` — 같은 축 두 이름, 어휘 정본화는 별건
- [ ] `RoomsClient:1670` 라벨 `납부일`(실제 payDate) — 형제 수납 폼 전부와 함께 갈 일
- [ ] `InventoryClient:4170` 점검일 — 320px 잘림 + `rounded-xl`(§12 6px 이탈). 이번 손댄 자리 아님
- [ ] `InventoryClient:3034` 수령 확정일시 — `rounded-xl` 이탈만, 잘림 0
- [ ] `getMonthPaymentAggregates` 의 `isBillingAdjust` 미제외 — 오늘은 전부 0원이라 무해, 집계 무수정 원칙 우선
- [ ] `DatePicker` 트리거 44px 터치 타겟 — className 으로 불가(크롬·히트 분리 필요), 정본 후속
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
- [x] `MANUAL_PAY_METHODS` 정본 신설(이름 없는 부분집합 사본 넷 수렴)

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

# 현금영수증 합계 축 정정 + 발행일 입력 (신고 8b9b6c43 재판정, 2026-08-24)

## 축 정정
- [x] `getMonthPaymentAggregates` 현금영수증 집계를 `cashReceiptIssuedAt` KST 달 기준으로
- [x] `lib/kstDate` 에 타임스탬프 월 창 정본 신설 — `kstMonthTsRange` · `kstMonthKey`
- [x] 카드는 `payDate` 축 유지(매출전표가 결제 시점에 성립) — 전 기간 값 무변동 확인
- [x] 축·버킷 판정을 `lib/cashReceipt` 순수 함수로 — 카드 우선 배타가 구조로 보장
- [x] 컷오프를 발행일에 건다(발행자 사업자번호 귀속) · `isPrevOwner: false` 유지
- [x] 기대값 대조 — 2026-08 7,640,000원 18건 · 2026-07 5,660,000원 14건

## 문안
- [x] 한 줄에 축이 둘이라 줄을 갈랐다 — `발행일 기준 현금영수증` / `입금일 기준 카드 수납`
- [x] 한정어를 숫자 바로 앞에(뒤에 붙이면 좁은 폭에서 숫자와 갈라져 다른 줄로 떨어진다)
- [x] InfoHint 첫 두 절을 축 설명으로 재작성 — 네 앵커 유지

## 발행일 입력
- [x] 값 결정을 `resolveCashReceiptIssuedAt` 정본 하나로 — 다섯 저장 경로 전수
- [x] 기본 오늘(KST) · 고른 날짜가 이긴다 · 기존 값 보존 · 미래만 차단
- [x] 세 화면에 DatePicker(수납 폼 정본·예약금 · 입주자 상세 · 수납 내역 수정)
- [x] 껍데기를 각 폼 형제 날짜 칸과 맞춤 — `check-datepicker-shell` 0건
- [x] 원터치 토글은 오늘로 켜고 수정 폼에서 고친다 — 새 인터랙션 신설 없음
- [x] 발행일 != 입금일일 때만 행 배지에 날짜 병기

## 감지망
- [x] 규칙 20 재작성 — 두 줄 한정어 · 축 혼입 · InfoHint 네 앵커 · 두 창 · KST 창 · 버킷 정본
- [x] "'납부일'은 약정 지급일이라 축 이름 금지" 판정 유지
- [x] 규칙 20-b 신설 — 직접 `new Date()` · 정본 호출 5곳 · 기존 값 보존 · 미래 가드 · 입력칸
- [x] 규칙 5 를 구조 기반으로(문자열 매칭은 함수 추출에 무력)
- [x] `scripts/test-cash-receipt.ts` 26 케이스 — KST 자정 경계 포함, verify:fast 등재
- [x] 역주입 13건 전부 발화 확인 후 복원

## 게이트
- [x] tsc 0
- [x] `npm run verify:fast` exit 0 — `test-money` 200 통과 무변동
- [x] `npm run verify:db` 기지 예외(서류 표시값 소재지 3건)에서만 정지 — `[돈 정합] 위반 0건`
- [x] 프로덕션 빌드 exit 0
- [x] eslint 491 유지(신규 0)
- [x] 320/360/390 × 라이트·다크 6조합 넘침 0 · 날짜 잘림 0
- [x] DB 쓰기 0
- [x] 배포 전 디자이너 패스 — 패널 회신이 안 와 직접 수행(아래 컨텍스트 노트)

## 안 한 것(의도)
- [ ] 발행 표시를 켤 때 발행일이 입금일과 다르다는 경고 — 정상 업무라 안 만든다(운영자 확정)
- [ ] 소급 입력 상한 — 없다. 막는 것은 미래 하나뿐(운영자 확정)
- [ ] `getMonthPaymentAggregates` 의 `isBillingAdjust`·`isDeposit` 필터 — 범위 밖(기록만)
- [ ] `ExtraIncome.cashReceiptIssuedAt` — 스키마 변경, 운영자·세무 확인 대기
- [ ] 과거 데이터 정정 — 필요 없다(취소분은 소프트삭제로 이미 제외)
