# 스테이음 작업 로그

마지막 업데이트: 2026-07-02
브랜치: main

## 2026-07-02 — 디자인 감사 Phase 1 (기계 스캔) + 즉시 수정
가이드 §09~§23 대조 grep 전수 스캔. 즉시 수정: 푸시 이모지 2곳 제거, EmptyState 이중 구현 통합(FinanceClient 로컬 label판 삭제→공용 §16 정본, 카드 안 4곳 무배경). 보류(판단 필요): StatusBadge 공용 틴트 리터럴(의도 주석)·Badge pale-green 쌍 고정·입력 radius 12곳+·z-index 리터럴 44곳+·인라인 로딩 10곳·제목 3종·손말이 모달 4파일·Inventory/Dashboard 색 리터럴. 상세: [[design-audit-2026-07]]. Phase 2(페이지 대조)·3(UX 흐름)은 후속.

## 2026-07-02 — 수납관리 상단 수납 진행 스트립 [표시 전용]
운영자 제안 → UX 판단 후 '진행바+만실 참고치+탭 합계' 안으로 확정(3지표 카드는 모바일 목록 밀림·max는 용량 지표라 카드 반대).
- **스트립**: `수납 N원 / 예상 N원 (%)` + 얇은 진행바. 예상=화면 행들의 Σ expected(공실 제외·무청구 퇴실월 0·퇴실 일할 반영 — **운영자의 '퇴실예정 제외' 가정은 도메인상 '무청구 월만 제외'로 정정**, 청구 있는 퇴실예정자는 포함). 수납=예상−이번 달 미수(balance<0, expected 캡). 만실 시=예상+공실 baseRent 합(회색 꼬리, 참고치).
- **부가수익 미리보기**: 탭 라벨에 `부가수익 (+N만)` — /finance 탭 합계 관례 재사용, 클릭 없이 확인.
- 표시 전용: 서버 계산값(getRoomPaymentStatus) 합산만, §4 재계산 없음. 상단 숫자=아래 목록 합(검산 가능).

## 2026-07-02 — 부가수익을 수납관리로 이동 + 입주자 연결 [SQL 필요]
운영자 제안·승인("기타수익을 수납관리에 넣는 게 로직에 맞다"): 실데이터 5건 전부 수납 파생(보증금 미반환 2·과납 2·현금차액 1).
- **스키마**: `ExtraIncome.tenantId`·`leaseTermId`(nullable FK, `migrate_extra_income_tenant_link.sql`). 백필 4/5건(서민준 418·변세진 409·심원재 405·김영일 512), 현금차액은 무연결(의도).
- **화면**: /rooms에 수납/부가수익 탭(RoomsClient viewTab + `IncomeSection.tsx` — /finance income 탭 이식 + 입주자 열·연결 셀렉트). /finance에선 탭 제거(약 300줄), 요약 위젯 '부가 수익 합계'는 유지·클릭 시 `/rooms?tab=income`. FinTab에서 'income' 제거.
- **자동 등록 연결**: 퇴실 보증금 미반환분(tenants/actions)·과납 기타수익(PaymentEntryForm) 생성 시 tenantId·leaseTermId 저장.
- **불변**: 서버액션·손익 합산(대시보드·리포트 발생주의)은 finance/actions 그대로. 수납 완납 계산에 부가수익 안 섞임(별도 탭). [[decisions]]

## 2026-07-02 — 오류신고 7건 처리
### 표시·라벨 (3건)
- **[eacfbaad] 하단 탭 '지출'→'지출/수익'** (988f2ca): 화면명(지출/기타수익)과 불일치 해소.
- **[71c4283e] 부가수익 합계 위젯 클릭→'부가 수익' 탭** (e628d00): 위젯 버튼화 + '내역 보기 →'. (부가수익 수납관리 이동 시 링크 목적지 조정 필요)
- **[7c8c5fcd] 납부일 임시 조정 문구** (7221889): 이동찬(516) 매월 2일→7월만 10일 조정인데 수납 탭이 '매월 10일'로 표시. settlement.dueDay=override 반영값이라 override 활성 달엔 "이번 달만 10일 (임시 조정)"으로. full date형도 M/D 처리.
### OCR 금액 버그 (1건)
- **[ba364142] 부가세 빠진 과세금액 입력** (b10baf8): 프롬프트에 totalAmount=부가세 포함 최종 결제금액 강제(공급가액 금지, items도 포함가). 클라 보정: 품목합이 totalAmount보다 딱 부가세만큼(비율 1.07~1.13) 작을 때만 비례 배분(마지막 품목 잔여 흡수). 할인·배송비 차이는 무개입.
### 기능 (3건)
- **[a3a4bac7] OCR 직후 유사 품목 확인** (4dad4dc): 수동 추가와 동일 규칙(findSimilarItemName)을 OCR 경로에 — 품목별 "OO로/새 품목으로". 승인 시 ocrRaw 보존→별칭 학습.
- **[4f9fb398] 같은 주문번호 자동 묶기 + 영수증 여러 장** (972eda4): findOrderByExternalNo + 등록 시 확인("같은 주문으로 묶기/따로 등록")→attachOrderId로 기존 주문 합류. 판매점별 영수증 = 지출별 receiptUrl → 한 주문 다영수증 자연 지원. 풀기는 기존 해제 그대로.
- **[4e2ffe04] OCR 튜닝 + 완제품 단가**: ① 프롬프트에 사업장 품목 사전(최근 300행→고유 40개: 최종 품목명+관행 규격/수량 단위) 주입 — 수정할수록 다음 인식이 그 표기로 수렴(별칭 학습은 정확 일치, 사전은 근사 표기 흡수). ② 단가 기준 토글 'spec'(규격당)↔'qty'(완제품 1개당): ItemPickState.unitBasis, 단가 라벨 클릭으로 전환, 규격 단위가 치수(cm·mm·m·인치)면 기본 개당(장판 183cm×10M 1롤당 135,000원 × 2롤 = 270,000원). 금액(amount)은 항상 원본 그대로 — 단가 해석만 전환.

## 2026-07-01 — 오류신고 처리 (진행 중)
### 월 전환·과거월 표시 페이지 범위 조정 [표시/데이터 스코프]
운영자: 월 넘나드는 페이지엔 상단 월 전환+눈에 띄는 표시가 있어야(고객관리 등 불필요 페이지 제외). MONTH_PAGES = dashboard·finance·rooms·**inventory·card-settlement·requests**(tenants 제거). /inventory/assets(내구재)는 배너 제외.
- **재고관리**: 상단 `MonthSelector` 추가(데이터는 이미 월 필터). 
- **카드정산**: page가 ?month= 읽음. 미정산은 월 무관 전체 유지, **정산 완료 내역만 선택한 달 '청구월(billMonth)'분**으로 필터(빈 달은 안내). 헤더에 MonthSelector.
- **요청·컴플레인**: page가 ?month= 읽음. **미처리(open)는 월 무관 항상 노출(활성 큐)**, **처리됨은 그 달 resolvedAt(KST) 해결분만**. 헤더에 MonthSelector + "처리됨은 N월 해결분" 안내.
- 실데이터 확인: 정산완료 카드지출 4~6월 다수, 요청 해결분 4월2·5월5·6월1건 → 월 뷰에 내용 있음.
### 과거월 배너 제거 — MonthSelector로 통일 (중복 해소)
운영자: 상단 배너 "2026년 6월 (지난달) 오늘"이 바로 아래 월 셀렉터와 중복이라 복잡. → **PastMonthBanner 삭제**(AppShell). MonthSelector가 이미 과거월일 때 amber+'지난달' 배지+'오늘'을 겸하므로 셀렉터 하나로 통일. (2026-06-30 배너 도입은 '코너 회색 알약이 안 보임' 때문이었으나, 지금 셀렉터는 amber라 충분히 눈에 띔 → 역전.) 모든 월-페이지에 MonthSelector 있음(위 항목에서 재고·카드정산·요청 추가 완료), tenants는 월표시 불필요라 무영향.
  - (중간 단계였던 배너 컴팩트화는 이 제거로 대체됨.)
### 홈 '납입 완료' 피드 — 귀속월·선납/지연 뱃지 [표시 전용, SQL 불필요]
운영자 지적: 피드가 payDate(그 달에 낸 것)만 보여줘 6월에 낸 7월 선납이 6월분처럼 뜨고, 7월 화면엔 안 뜸 → "몇 월분을 언제 냈는지"가 안 보임. **핵심: 매출·완납 계산(§4)은 이미 발생주의(targetMonth)로 정상 — 이건 피드 표시만 문제**.
- 피드 범위를 **(payDate∈그달) ∪ (targetMonth=그달)** 합집합으로([page.tsx:273](app/(app)/dashboard/page.tsx#L273), take 40). → 7월 선납은 6월·7월 양쪽에 뜸.
- 각 줄에 뱃지(귀속월+상태): T=V·P<V '선납 완료', T=V·P>V '지연 완료', T>V 'N월 선납분', T<V 'N월분 지연', 당월 정상 뱃지 없음. 선납=info(파랑)·지연=warning(주황). 서브라인=실제 납부일(M/D 납부).
- 실데이터 검증: 420 오병용·513 민경진·522 이경호 = 6/29~30 납부·귀속 2026-07 → 7월 화면 '선납 완료', 6월 화면 '7월 선납분'. [[domain-billing]]
### 지출 목록 해당일 합계 표시 (오류신고 f7b0292a) [표시 전용, SQL 불필요]
"해당일 지출 합계·주문번호별 합계도 보이면 좋겠다". → 날짜별 합계(dayTotals, 실제 지출만·예정 제외)를 계산해 **모바일 날짜 그룹 헤더 우측 '합계 N원'**, **데스크톱 표에 날짜 그룹 소계 행(colSpan)** 추가. 주문번호별 합계는 이미 '주문별' 뷰에서 같은 주문(orderId)을 배송비 포함 한 줄로 병합해 총액으로 표시(2330) → 별도 추가 불필요. FinanceClient 지출 목록.
### 지출등록 단가×수량 입력 (오류신고 407567e6) [표시/입력, SQL 불필요]
"합계만 입력 가능해 단가만 알 때 불편(합계 넣고 추가 후 단가 다시 입력)". ItemSelector 품목 '추가' 서브폼엔 금액칸만 있었음(등록된 행엔 이미 단가↔금액 양방향 존재). → 추가 폼에 **단가 입력칸 신설**(단가·금액 2열), priceMode(마지막 입력한 쪽 기준) + effect로 수량·규격 바뀌어도 자동 재계산. 기준수량=수량×규격. 저장 데이터(amount 합계) 불변, unitPrice 종전대로 파생. FinanceClient ItemSelector.
### 비품·자재 재고 뷰 개선 — 수량 강조 + 배정일(assignedAt) [SQL 필요]
운영자 검토: 재고 관리인데 금액이 메인처럼 보임(우측 큰 값). 비품·자재는 소모품이 아니라 '몇 개가 어디 있고 언제·어디서 샀나(하자 대응)'가 핵심.
- **카드 재구성(583e904)**: 우측 큰 값 = **수량**(품목명은 제목으로), meta 순서 = `구매일 · 구매처 · 배정일 · 카테고리 · 금액`(truncate라 좁으면 금액부터 잘림 = 부차). 방별 건수·총액(섹션)·금액 데이터 전부 보존.
- **배정일 기능(§4 스키마 — 운영자 승인 '전용 필드 + 카드 표시')**: `Expense.assignedAt DATE`(`migrate_expense_assigned_at.sql`) 신설. 배정 시 기본=지금(assignAggregateToTarget), 배정 해제 시 null. 상세 모달에 날짜 입력·비우기(setAssetAssignedAt). 카드엔 '배정 YY.MM.DD'.
- **기존 배정분 백필**: 배정 이력 로그(asset_assignment_log)의 최근 배정 시각(KST)으로 채움 — 방 23 + 공용부 7 = 30/109건(로그 이전 배정 79건은 미상/공백, 예정대로). 방 toLabel 은 placeLabel 규칙상 숫자+'호'라 조인에 반영.
- 발견: 배정 시각은 이미 로그에 자동 기록·상세에 노출 중이었음 → '지금까지 배정한 것 활용'은 백필로 실현.

### 용어 통일 '월세'→'월 이용료' (b2e6a3f)
할인 위젯·수납 토스트·캘린더·입실료확인서 등 UI 6곳. (사용자 지적: 다른 곳은 다 '월 이용료')
### #2 재고 이월분 이중계산 [표시 전용] (오류신고 4353892a, b390971)
음식물봉투 상세 이월분이 '점검 20 + 입수 20 = 40' 부풀림(최신 점검값은 정상). 원인: 이월분이 점검 date(자정) 기준으로 이후 수령 합산 → 같은날 점검보다 먼저 수령한 구매(6/16 13:53 수령→14:08 점검)를 이중. 수정: 서버 effTime(같은날=createdAt)과 동일 기준. 10L 40→20, 5L 42→32. 재고 데이터 무변경. done.
### #3 대시보드 카테고리 묶음 완전 목록 (오류신고 a9112143, cca8f8b)
긴급인 퇴실예정(리수야오)이 '긴급'에만 뜨고 '퇴실 예정' 묶음엔 빠짐. 운영자 승인('모든 카테고리 완전하게')으로 카테고리 그룹을 restItems(긴급 제외)→withU(전체)로. 긴급=하이라이트, 카테고리=전체 목록(중복 표시). done.
### #5 동의서 '대표 귀하' [판단] (오류신고 88c2f268)
입주자가 대표에게 제출하는 서류라 '대표 귀하'는 표준 서식(제출자가 수신인 높임) → **유지 결정**. done. [[domain-contracts]]
### #1 508호 할인 데이터 꼬임 [⚠️ 결제데이터] (오류신고 6b771374)
증상: 리스트 38만/상세 39만 불일치·"수정 안 됨". 원인: 세 값이 따로 — room.baseRent 39만 / lease.rentAmount 38만 / 숨은 할인 2만 → 실제 청구 36만(의도 38만과 다름). 리스트는 rentAmount(38만), 상세는 room.baseRent(39만) 표시라 달라 보임. **정정(운영자 승인)**: rentAmount 380k→390k(정가), 할인 20k→10k(1만) → 유효 380k(38만). 검증 트랜잭션. done. 원칙: 정가 유지+할인 별도([[discount-vs-contract-price]]).

## 2026-06-30 — 오류신고 추가 3건 (월표시 강조 · React#418 · 과납 기타수익)
### 과거 월 뷰 강조 (오류신고 103b27fc, 6e5d722→6c72488→6fcf611)
523호 5월 잔액 0=실제 완납(버그 아님), 과거 월 화면 혼동. 공용 MonthSelector 에 '이번 달 아님' 강조(amber 테두리·배지 + persimmon '오늘' 버튼). brand 토큰 의미 정합(amber=주의/persimmon=CTA). ⚠️ 6c72488 에서 JSX 내 /* */ 주석으로 build 깨짐 → 6fcf611 즉시 수정(교훈: build 통과 후 커밋). done.
### React #418 hydration (오류신고 4ff2d332-a, 9baf110)
/tenants 거주기간·D-day 를 렌더 중 new Date()로 계산 → 서버(UTC)/클라(KST) 다른 날일 때 텍스트 불일치(#418). 서버 KST today prop 주입 + fmtDDay 를 Date.UTC 일수차로(TZ 무관). done.
### 과납분 '기타 수익' 처리 (오류신고 4ff2d332-b, 4450737)
수납 시 추천액 초과분에 [기타수익 처리] 체크 → 이용료는 완납만(이월X) + 초과분 ExtraIncome('기타 임대수입'). 폼 레벨 분기(savePayment 무변경). ⏳ 운영자 확인 후 done.

## 2026-06-30 — 오류신고 2건 처리 (지출 날짜 · 420호 귀속월)
### 지출 입력 날짜 invalid date (오류신고 98c234aa, 2c5a9fa)
변동성 고정지출(가스 등) 기록 시 날짜 'invalid date'. 원인: 반복지출 dateStr=`${targetMonth}-${dueDay}` 가 납부일>그달일수(말일/31일+30일달)면 invalid. 수정: dateStr 그 달 말일 클램프 + 기록 모달 날짜 기본값 오늘(kstYmdStr). done.
### 420호 귀속월 한 달 밀림 [⚠️ 결제데이터 보정] (오류신고 22cae889)
오병용(2017 입주, dueDay=말일이나 실제 1일 결제를 말일에 선납). record 3건 중 최근(6/30→2026-07)은 이미 정확, 앞 2건이 한 달 일찍 라벨(6월 매출 비어 있었음). **운영자 선택='record 귀속월만 이동'(dueDay 말일 유지)**. 검증 트랜잭션: 2026-05(04-27,38만)→2026-06, 2026-04(04-27... 정정: 04-27분)→2026-05 (충돌 방지 위해 5월→6월 먼저). 결과 5월38만·6월38만·7월47만, 4월=0(인수 전). 총액 무변동, 메모 '귀속월 보정' 기록. done. ⚠️ 4·6월 월매출 표시 변동(운영자 인지). 같은 패턴(말일표기=실제1일선납) 타 입주자는 운영자 신고 시 개별 처리.

## 2026-06-30 — 예약 인상/인하 '적용일 누락 고아' 버그 (오류신고 ede8e3f8) [⚠️ 결제데이터 보정]
**증상(오류신고)**: 522호(이경호) 7/1 인상(390k→470k)을 미리 납부했는데 옛 금액 390k로 처리돼 80k가 8월로 과납 이월.
**진단(실데이터)**: 7/1 일괄 가격변경 35개 방 중 **502·522호만 `rentUpdateDate=null`**(예약금액만 있고 적용일 없음). `effectiveBaseRent`·적용 스케줄러 둘 다 적용일을 요구 → 인상/인하 영구 미적용. 502호는 인하(470k→440k)도 미적용.
**근본원인(코드)**: ① `room-manage/actions.ts` `updateRoom`이 scheduledRent/rentUpdateDate 독립 저장(검증 없음) ② 일괄편집(batch) 모달·`batchUpdateRooms`에 적용일 입력 자체가 없어 batch 로 예약설정 시 무조건 고아.
**수정(9dd546b)**: 두 경로 모두 '예약금액↔적용일 동시입력 강제'(XOR 차단, 예약삭제 시 적용일도 제거). 일괄편집 모달에 적용 예정일 DatePicker 추가. `updateRoom` 반환 {ok,error}로 전환·handleUpdate 검증 표시.
**데이터 보정(검증 트랜잭션, before/after 확인)**: 502·522 `rentUpdateDate`=2026-07-01. 522 7월기록 exp/act 390k→470k 완납, 8월 과납기록(80k) 삭제 → 총액 470k 보존. 오류신고 done 처리(open 0). 검증: 소스 tsc 클린·build exit 0. [[domain-billing]]

### 추천 납입액·귀속월 금액 인상 반영 (74a9ef5)
**증상**: 적용일을 고쳐도 수납폼 '추천금액'이 여전히 인상 전. **원인**: ① `getTargetMonthOptions`가 모든 달을 `lease.rentAmount`(옛값·할인/인상 무시) 평면 계산(billForLeaseMonth 미사용) ② 폼 추천액이 현재월만 보고 '다음에 낼 달'을 안 봄. **수정**: getTargetMonthOptions→billForLeaseMonth 단일규칙(+퇴실월 이후 isAfterMoveOutMonth 제외), 폼 추천액→자동(FIFO) 시 '가장 이른 미완납 달'(인상 전 완납되면 다음부터 인상가 자동). savePayment 무변경(이미 서버 재계산). 충돌 검토: 일반/미수/할인/락인/퇴실 시나리오 이상 0. 실데이터 시뮬 510·411·502·522 6월 옛값·7월 인상값 확인.

## 2026-06-29 — 계약서 인쇄/PDF 후속 (서명없음 허용 · 인쇄·저장 통일 · 모바일 · 가독성)
### 서명 없이도 계약서 생성/인쇄 허용 (e025f80)
서명 미입력 시 '서명 이미지가 비어 있습니다'로 막던 검증 제거 — 서명란은 '(서명)' 자리표시로 출력(contractPrintHtml 기존 처리). 출력 후 직접 서명받아 스캔·첨부하는 흐름 지원. 서명 영구저장은 유효 이미지일 때만(빈 서명이 기존 서명 안 지움).
### 인쇄·PDF저장·발급을 '서버 PDF 단일 소스'로 통일 + 기기별 전달 (6fabd45)
**문제**: 인쇄(window.print 화면인쇄)와 PDF저장(서버 puppeteer) 결과물이 달랐음 — 계약서 1장 vs 2장, 비상연락망 칸·계약번호 유무 차이(CSS 2벌 드리프트 + 화면인쇄는 한장맞춤 못 따라감). **해결**: window.print 경로 폐기, 출력은 항상 contractPrintHtml 단일 → 인쇄=저장=발급 100% 동일. 전달만 분기: 모바일(터치)=navigator.share 공유 시트(프린트·파일저장·메일) 버튼 1개 / 데스크톱=인쇄(새 탭 PDF→Cmd+P)·PDF 저장(다운로드) 버튼 2개. Safari 는 JS 로 PDF 직접 인쇄 불가라 새 탭/공유가 최선(운영자 합의). 이모지 라벨 제거.
### 자동 축소 가독성 바닥 (6fabd45)
shrink-to-fit 이 하한 88%로도 한 장에 못 맞추면(내용 과다) 미세글자화 대신 **원본 100%로 되돌려 다중 페이지** 출력 → 글씨 절대 88% 미만으로 안 작아짐. 검증: tsc·build exit 0(서버 puppeteer PDF 픽셀은 로컬 렌더 불가 → 기기 테스트 권장). [[domain-contracts]]

## 2026-06-29 — 사용자 6건 중 #1a·#6 완료 (#1b·#3·#4·#5 후속)
### #6 예약 인상 '그 달 이용료부터' 반영 [SQL 0 · 데이터 보정 1건] (943326b)
**증상**: 7/1 인상(scheduledRent+rentUpdateDate=7/1)이 적용일에 baseRent로 옮겨지기 전엔 월 청구가 현재 `lease.rentAmount`(옛 금액)만 봐서, 6월에 7월 이용료를 미리 내면 옛 금액으로 청구·락인. 513호: 35만 납부했는데 7월 28만 완납 + 7만 '8월 과납 이월'로 처리됨.
**원인 확정(실데이터)**: [billing.ts](lib/billing.ts) `billForLeaseMonth` 와 수납 `expected`([rooms/actions.ts:137](app/(app)/rooms/actions.ts))이 방의 예약 인상을 안 봄.
**수정(전 계약 적용 — 7/1 자동적용과 동일, 사용자 승인)**: `billForLeaseMonth` 가 `l.room.{scheduledRent,rentUpdateDate}` 를 읽어 대상월 ≥ 인상적용월이면 scheduledRent 로 청구(미전달 시 rentAmount, 회귀 0). 연결: 수납 표시·락인(billForMonth) · savePayment/serverBillForMonth/findFirstUnpaidMonth(선납 락인) · 대시보드 예상매출(page.tsx)·미납(unpaid.ts). 각 lease 쿼리에 room {scheduledRent,rentUpdateDate} select 추가.
**데이터 보정(513호)**: 7월 record expected/actual 28만→35만(완납), 8월 과납이월 7만 record 삭제. (상태 일치 확인 후 트랜잭션, 읽기검증 완료.)
**검증**: tsc·build exit 0. §4 결제 로직이라 사용자 사전 승인(전 계약 적용) 후 진행.

### #1a 동의서 서명 영구 저장 [⚠️ SQL 1건] (410237d)
`LeaseTerm.disposalSignatureImageUrl` 추가 — 입실계약서 서명처럼 동의서 서명도 시스템에 저장·재표시. generate route best-effort 저장(컬럼 미적용 시에도 PDF·계약서 서명 안 깨짐). **SQL**: `ALTER TABLE lease_terms ADD COLUMN "disposalSignatureImageUrl" TEXT;`

### #4 미정산 카드 예정/확정 구분 [SQL 0] (8433ec8)
`SettleGroup.isFinalized`(청구 마감일 cutOffDay 기준, 없으면 말일) — 미정산을 '확정(마감·출금 대상)'·'예정(진행 중·마감 전)' 두 섹션으로 분리. 예정은 '미리 정산 처리' 버튼 + 금액 증가 안내.
### #3 카드 정산 독립 페이지 분리 [SQL 0] (4aa35b4)
`/card-settlement` 신규 페이지([page.tsx](app/(app)/card-settlement/page.tsx)·[CardSettlementClient.tsx](app/(app)/card-settlement/CardSettlementClient.tsx)) + 사이드바 '수익/지출' 메뉴. FinanceClient 에서 settle 탭·타입·헬퍼·핸들러·props 제거(원자적 스크립트, 잔존 0 검증). #4 분리 규칙 그대로 적용. tsc·build·신규 lint 0.

### #1b 계약서 인쇄 한 장 맞춤 [SQL 0] (7037079)
화면(scale 축소·min-height 297mm)과 PDF(원본크기·별도 CSS)가 달라 출력 시 하단 잘림. generate route 에 **shrink-to-fit** — 의도 페이지 수(.paper 개수)보다 넘치면 한 장에 맞게 `page.pdf({scale})` 단계 축소(하한 0.78). 동의서는 page-break-before 별도 장이라 '서류별 한 장' 목표. **여백 상하좌우 14mm 대칭**(사용자 요청). ⏳ 실제 발급 1회 시각 확인 권장(로컬 puppeteer 렌더 불가). 완전 WYSIWYG(CSS 3벌 통일)은 후속.

### (신규 인프라) Obsidian '제2의 두뇌' — C안 구축 완료 (216017d)
세션 재시작 추론손실 해결. 자동메모리(핵심) + 저장소 `knowledge/` Vault(전체, 버전관리·Obsidian) + AGENTS.md 세션시작 규칙. `knowledge/{INDEX,domain-billing,domain-inventory,domain-contracts,decisions,glossary,open-issues}.md`. 메모리에 핵심 결정 2건 시드.

### #5 오류신고 버튼 + 세션시작 확인 [SQL 적용됨] (26f0589)
오류 발생 즉시 신고(직전 동작 자취 + 자동 캡처 에러 + 메모). `ErrorReport`(error_reports) 모델 + [lib/errorBreadcrumbs.ts](lib/errorBreadcrumbs.ts)(이동·JS에러 링버퍼) + [BreadcrumbTracker](components/BreadcrumbTracker.tsx)(셸 마운트) + 우하단 플로팅 [ErrorReportButton](components/ErrorReportButton.tsx) + `submitErrorReport` 서버액션. **세션시작 확인**: `scripts/check-error-reports.mjs`(읽기전용 + done/dismiss) + AGENTS.md 규칙(세션 시작 시 open 건 확인→운영자 보고). 버튼 위치·클릭/서버액션 자취는 후속.

### ✅ 이번 묶음 6건(+#6,+Obsidian,+여백대칭) 전부 완료. 남은 확인: #1b 발급 PDF 시각 확인(실기기).


## 2026-06-27 (이어서) — 재고: 위치별 점검 저장 더블클릭 → 보충 중복적용(허브 2배 차감) [SQL 0]
**증상(사용자)**: 위치별 재고확인에서 저장을 2번 연달아 클릭 → 점검 2건 저장 + 보충(창고→위치 이동) 중복. 대상 위치는 '보충 후' 절대값이라 그대로인데 **허브만 2배 차감**돼 재고가 틀어짐.
**원인**: 저장 버튼 disabled 가 `setPending`/`useTransition`(리렌더 후 반영)에 의존 → 빠른 더블클릭이 리렌더 전 핸들러를 2번 실행. `locationPatch` 는 서버가 직전 점검을 base로 읽어 **상대 패치**(허브 −보충, 대상=절대)를 적용하므로, 2번째가 1번째 결과를 base로 다시 빼 허브 재차감.
**수정(동기 가드)**: [InventoryClient](app/(app)/inventory/InventoryClient.tsx) `LocationBatchCheckModal.doSave`·`CheckForm.handleSubmit` 에 `useRef`(savingRef/submittingRef) 재진입 차단 — 진행 중이면 두 번째 제출 무시, 완료/오류 시 해제. (전체 보정은 절대값 리셋이라 더블클릭해도 무해 → 대상 외.) `useRef` import 추가.
**검증**: tsc·build exit 0. 커밋 6cee87c. 읽기전용 스캔(.env.local)으로 과거 중복 8쌍 확인 — 모두 2026-06-13 14:22~23 한 번의 일괄저장에서 발생(라면 81→71·키친타월 9→8 은 허브 2배차감 흔적, 나머지는 동일값 무해). **이후 절대값 재점검들이 덮어써 현재 잔량 영향 없음**(overview dedupSameDay 가 같은날 최신만 채택). 과거 중복 레코드 삭제는 보류(현재 무영향·삭제는 데이터 변경, §4).
**서버 멱등 추가**(ffdb9a9): 클라 가드에 더해 `createStockCheck`/`updateStockCheck` 의 locationPatch 경로에 멱등 — 같은 patch(점검위치=보충후·같은 보충량)가 20초 내(생성)·현재(병합)에 이미 반영돼 있으면 재적용 안 함. 다중 탭·재시도까지 허브 2배차감 차단.
**과거 중복 정리는 보류(결정)**: 자동 삭제 안 함 — 8쌍 중 일부는 버그 중복이 아니라 정상 정정(예: 세탁조크리너 6→5, 18초·보충없음 = 값 수정 재입력)이라 휴리스틱 삭제는 정상 데이터 손실 위험. 또 06-13 중복들은 이후 절대값 재점검에 덮여 현재 잔량 무영향. 특정 점검 삭제는 타임라인의 점검 삭제 버튼으로 개별 처리 가능.

## 2026-06-27 (이어서·정정) — 재고 잔량 누락 진짜 원인: 위치 미지정 수령 미배치 [SQL 0]
**앞선 qtyUnit 가설은 틀림**(라면 item.qtyUnit=null 이라 무관). **실데이터 진단**으로 진짜 원인 확정:
- 쌀(정상): 수령확정 시 **창고(위치) 지정** → `receivedLocationId` 설정 → confirmReceipt 가 자동 점검 생성·배치 → 잔량 반영.
- 라면(누락): 06-25 구매 120개(3박스×40)를 **위치 미지정**(`receivedLocationId=NULL`)으로 수령 → 자동 점검 미생성·**어느 위치에도 미배치**. 이후 '위치별 점검(4층 주방)'이 그 위로 지나가며, 미배치 입고분이 위치내역에도·점검이후 입고에도 안 잡혀 **증발**(잔량=마지막 점검값 19 그대로). 물티슈·키친타월(롤) 동일.
- UI 경로: 상단 '수령 대기'의 인라인 **'수령 완료'**([InventoryClient](app/(app)/inventory/InventoryClient.tsx):177 handleQuickReceive)가 `confirmReceipt(id)`를 **위치 없이** 호출 → 미배치. 타임라인엔 '위치 미지정으로 수령' 버튼도 존재.
**수정**([actions.ts](app/(app)/inventory/actions.ts) confirmReceipt):
- 위치 미지정으로 받아도 **품목 허브(hubLocationId→영업장 기본 창고→첫 위치)에 자동 배치 + 점검 생성**. 위치 없는 단일 버킷 품목은 종전대로(총량 점검이라 무손실). 직전 점검이 위치내역 없이 총량만이면 그 총량을 허브에 보존.
- `handleQuickReceive` 일괄수령을 `Promise.all`→**순차**로 — 동시 실행 시 같은 직전점검을 baseline 으로 읽어 입고분이 덮어써지는 경합 방지.
**검증**: tsc exit 0 · build exit 0. 커밋 8674fda. 진단은 `.env.local` 로 prisma 읽기전용 조회(쓰기 0).
**⚠️ 과거 데이터**: 이미 미배치로 수령된 분(라면 120 등)은 **코드만으론 복구 불가**(소모분과 분실분을 시스템이 구분 못 함) → 운영자 **창고 실측 1회** 필요(또는 실수치 받아 보정 점검 1회). §4 데이터 보정이라 운영자 확인 후 진행.

## 2026-06-27 (이어서) — 재고: 수령확정한 구매가 잔량에 안 더해지던 버그 (qtyUnit 매칭 통일) [SQL 0]
**증상**: 라면 120개 구매·수령확정했는데 잔량이 그 전 값 그대로. 물티슈·키친타월(롤)도 동일, 쌀만 정상.
**근본 원인**: `TrackedItem` 은 `@@unique([propertyId, category, label])` 로 유일한데(=qtyUnit 은 식별자 아님), 재고 '계산' 쿼리들만 `qtyUnit` **완전일치**를 추가로 요구. 반면 수령확정(`confirmAllPending`)·수령대기 표시(`pendingPurchases`)·상세(`getInventoryItemDetail`)는 **느슨 매칭**(`한쪽이 null 이거나 같으면 일치`). → 단위 미입력(null) 수령분이 **대기엔 뜨고 확정도 되지만 잔량엔 통째로 누락**. 쌀은 단위가 우연히 맞아 정상이던 것(단서).
**수정(전 경로를 정본=느슨 매칭으로 통일)**: [overview.ts](app/(app)/inventory/overview.ts) `sumPurchases`(잔량·소모·월소모) · 단일점검 `firstPurchase` · 단가 `recentPurchases` / [actions.ts](app/(app)/inventory/actions.ts) `getMonthlyInflow` · `getPriceHistory` · `getStockAsOf` · 라벨변경 전파(`updateTrackedItem`) · `changeTrackedItemUnit` unitless 카운트(AND 래퍼로 specUnit OR 와 키충돌 회피). `confirmReceipt` 자동점검 품목조회는 (category,label) 유일이라 `qtyUnit` 조건 **제거**(단위 달라 품목 못 찾아 자동점검 누락되던 것도 해소). 쓰기측 merge/seed 는 범위 외(별도).
**효과**: 이미 수령확정된 null-단위 구매도 **다음 로드부터 잔량에 자동 반영 — 데이터 수정 불필요**.
**검증(loop.md)**: tsc exit 0 · `npm run build` exit 0 · 변경 2파일 신규 lint 에러 0(기존 no-explicit-any 부채만). SQL 0(읽기 쿼리 매칭 조건만 완화). §4 비해당(스키마·결제 무변경, 계산식은 누락 복원이라 손실 없음).
**남은 권장(실데이터 확인)**: 배포 후 라면·물티슈·키친타월(롤) 잔량이 +수령량으로 올라오는지 1회 확인.

### (사이트) 제기역점 랜딩 갤러리·문구 — 이번 세션 함께 처리
- 418호 추가(360 408호 위 배치)·408호 사진 교체·416호 제거, 캡션 부여 (dbd4c4a). 미사용 이미지 6종 정리(eb73b19·02899c4). '원룸 외창·실속형' 설명 미니룸 오인 표현 정정 (6d18766).

## 2026-06-27 — 사용자 보고 3건: 호실 재수정 튕김·찍어올리기 업로드·과거 구매내역 검색 [SQL 0]
- **#1 호실 사진 수정 후 재수정 '튕김'**(4887dca): 저장/닫기 후에도 URL `?roomId&edit=1` 가 남아, 같은 방을 EntityModal 에서 다시 [수정]하면 `router.push` 가 '동일 URL' 이라 무시되고 `handledOpenRef` 도 그대로라 `openEdit` 미호출 → 셸만 닫히고 편집 폼 안 열려 목록으로 튕겨나옴(첫 수정은 정상, 두 번째부터 발생). `closeEdit` 에서 `clearRoomUrlParams()`(roomId·edit 삭제, `router.replace`)로 정리 — 고객관리 `clearTenantUrlParams` 와 동일 패턴. (360 이미지는 우연, 사진 종류 무관.)
- **#2 찍어올리기·OCR 갤러리/파일 업로드 차단**(03d1cd7): file input `capture="environment"` 가 모바일에서 카메라 촬영만 강제 → 기존 사진 업로드 불가. capture 제거로 OS 선택기가 '사진 찍기/앨범/파일' 모두 제공. 홈 [찍어올리기](components/dashboard/PendingReceiptSection.tsx) + 입주자 계약서·신분증 [OcrToolbar](app/(app)/tenants/OcrToolbar.tsx) 동일 적용(촬영은 그대로 가능, 업로드만 추가 — additive).
- **#3 과거 구매내역 검색**(0679326): 월 한정이던 지출 화면에 '과거 내역 검색' 모달 신설. 신규 서버액션 `searchExpenses(query)`([finance/actions.ts](app/(app)/finance/actions.ts)) — 품목명·세부·판매처·메모·카테고리를 **전 기간**에서 contains(insensitive) 검색(date desc, 최근 300건, room 포함). 모달([FinanceClient.tsx](app/(app)/finance/FinanceClient.tsx))은 입력 디바운스 300ms → 월별 그룹·건수·합계로 표시, 월 헤더 클릭 시 `/finance?tab=expense&month=` 로 해당 달 이동. 기존 월간 목록·그룹핑 로직 무접점(별도 모달).
**검증(loop.md)**: tsc --noEmit exit 0 · `npm run build` exit 0 · 변경 5파일 eslint 신규에러 0(기존 no-explicit-any 부채만). SQL 0(읽기전용 쿼리 추가). §4 비해당(스키마·인증·결제·기획 무변경).

## 2026-06-22 — 홈 위젯 다듬기 + 품명(품목명) 관리 시스템 [SQL 2건·적용완료]
### 홈 위젯 다듬기
- **주문별 판매처**(96bc42d): 같은 주문번호여도 판매처 다를 수 있음(쿠팡 직접/중개) → 묶음서 대표행으로 통일 말고 '○○ 외 N' 표기(펼치면 개별 판매처 그대로).
- **예상 매출 위젯**(aef6b6a): 완료/예정/미납 건수·금액 한 줄 + '기타수익 Y 포함' 명시(재무탭과 차이 인지).
- **월 지출 → 예상 지출 위젯**(ca3d02f→e1e8279→dfcbffb): 통제가능성 3단계 스택 막대 — 고정(정액)=임대료 등(ink-2)·고정(변동)=공과금 등(warm-mid)·수시=비고정(coral). 캡션 '현재까지 X + 남은 고정비 Y'. **전월·전년동월 대비 비율**(더 쓰면 tc·덜 쓰면 success, 전년동월은 trend 6개월 밖이라 신규 aggregate). 용어는 AI 추천 중 사용자 채택(고정(정액)/고정(변동)/수시).
- **캡션 순서 통일**(e1e8279): 예상 매출·순이익 위젯 모두 금액 → 비율 → 비고.
- **'이달 손익 현황' 패널 제거**(d9422c7): 상단 위젯이 중복 + 패널의 순이익 달성률이 부정확(수납 월초집중·지출 月내내 → 100% 고정)이라 정합적으로 삭제.

### 품명 관리 시스템 (공통 백본 ItemNameAlias)
- **#1 OCR 인식 품목→품목 선택**(2217f9c): ITEM_PRESETS 게이트 제거(이전엔 프리셋 카테고리만, 나머진 세부항목 텍스트로 빠짐).
- **#2 OCR 품명 학습**(21465f0)[SQL]: ItemNameAlias(정규화원문→선호명). OCR이 인식 후 별칭 치환·rawLabel 보존, 저장 시 ocrRaw≠label이면 별칭 upsert → 다음 같은 영수증 자동 치환.
- **C 자동완성 통일**(c8034ad): getExpenseDetailSuggestions가 별칭 반영 — 병합된 옛명칭 제외·통일명 제안.
- **B 유사명 확인**(28f3228): ItemSelector.confirmAdd에서 입력 품명을 기존명과 문자열 유사도(정규화+포함관계+levenshtein) 비교 → 유사하면 '같은 품목?' 확인(다른 제품 보호). OCR 자동입력은 #2가 담당하므로 수동 입력만.
- **A 환경설정 AI 품명 병합**(d3c5728)[SQL]: 데이터·도구 탭 '품명 병합' → Gemini가 저장 품명 유사끼리 클러스터·대표명 추천 → 통일. 지출 itemLabel·소모품 카드 라벨 일괄 변경 + 별칭 생성. **완전 적용취소**: ItemNameMergeRun(affected JSON·newAliasKeys)으로 지출·소모품 이름 원복 + 이 병합이 만든 별칭만 삭제.
**SQL(둘 다 적용완료)**: `item_name_aliases`, `item_name_merge_runs`. (미적용 시 try/catch로 기존 기능 영향 0)
**검증**: 각 단계 tsc·build 통과.

## 2026-06-21 — 재고/계약서 데이터 점검·정정 + 재고·지출·홈 위젯 UI 정리 [SQL 0]
이번 세션 — 데이터 정합성 점검·정정 + UI/UX 통일. (계약서서 흡연 변경 시 입실자 저장 adf5cb7 포함)
- **계단 논슬립 14개**(데이터, 버그 아님): 명칭 재정리로 별개 3건(6/5·6/18·6/19)이 같은 이름으로 합산(6+4+4). 읽기전용 진단 후 6/5·6/18=10개를 수령완료(receivedAt=구매일)로 정정→수령대기서 미배정으로, 6/19=대기 4개 유지. 회계는 구매일(`date`) 기준(createdAt 아님)·자동 증식 없음 확인.
- **분배 수령완료 유실 버그**(e4ae8b4): updateExpense 방별 분배 시 새 조각이 `receivedAt` 미상속→수령대기 복귀. existing에 receivedAt 추가해 상속. 이름변경 3경로(지출 전파·재고 카드·직접 수정)는 itemLabel만 바꿔 수령·배정·날짜 보존 확인.
- **서민준 거주중 오분류**(875c7f4): 업로드 계약서가 lease 미연결(`leaseTermId` NULL)→status null→거주중·호실 빈칸. 입주자 대표 lease(거주성 우선, 없으면 최신=퇴실)로 폴백 판정(`effectiveLease`). 계약서 없는 사람은 목록 미노출, null은 거주중(퇴실 오분류 안 함).
- **#3 레이아웃**(요약바+날짜그룹+합산접기 방향): 비품·자재 '합산 N건 ▸ 펼치기'(개별 구매 일자·수량, ec0b2d3) · 지출 모바일 '날짜 그룹' 헤더(69cd84b, 데스크톱 테이블 구분은 후속).
- **#2 비품↔소모품 통일**: 소모품 상단 '수령 대기' 섹션+인라인 수령완료(6f2a2b3)→비품과 동일 '합산 N건 ▸ 펼치기'+한번에 수령(8461a7e)→헤더 비품 스타일·h1 통일(84a309c). 본질 차이(소모품=점검/잔량, 비품=배정)·카테고리 색점은 유지.
- **#4 순이익 위젯**: '현재 순이익' 단일표시→예상 매출 위젯 방식(예상+달성도, f184bc0). 이후 달성율(현재/예상)이 100%에 박히는 문제(수납 월초 집중·지출 月내내) → '지출 반영률'(실제÷예상 지출) bar로 교체, '현재 장부 +X · 남은 예상 지출 −Y 반영 시 확정' 표기(e9aa95d).
**검증**: 각 단계 tsc·build 통과. 데이터 정정은 읽기전용 진단(before/after) 후 해당 행만 보정.

## 2026-06-20 (이어서) — 동의서 화면 겹침 수정 + 흡연 여부 고객관리 항목화 [⚠️ SQL 1건]
- **동의서 화면 겹침**(913a5d4): 계약서·동의서 두 종이가 한 `paper-cage`에 모두 `position:absolute top:0`이라 화면에서 겹쳐 계약서가 안 보임(단일 페이지 전제 설계). 동의서를 자체 cage(자체 측정 높이 `disposalHeight`)로 분리해 계약서 아래 배치. 간격은 `.disposal-cage margin-top`. 인쇄는 기존대로(cage `display:contents`+`page-break-before`).
- **흡연 여부 고객관리 항목화**(bd965eb)[⚠️SQL]: #4가 계약서 안에서만 이동했던 것 보완 — `Tenant.smoking Boolean` 추가. 입실자 등록/수정 폼에 '흡연 여부' 셀렉터, 상세 기본정보 표시, create/update 저장. 계약서 흡연란 기본값을 입실자 설정에서 자동(`ContractData.tenant.smoking`→ContractView init). **SQL**: `ALTER TABLE tenants ADD COLUMN "smoking" BOOLEAN NOT NULL DEFAULT false;`

## 2026-06-20 (이어서) — 계약서/동의서 보정·흡연란 이동·환불 공정위化·환경설정 정리 (7건) [SQL 0]
사용자 7개 요청 일괄 처리. 3개 커밋(2b812a7·37d53ec·428cb27).
- **#1 동의서 출력 시 계약서 누락 버그**: 계약서 `.paper`가 `display:flex` 컨테이너라 동의서가 붙어 2페이지가 되면 인쇄 분할에서 본문이 통째로 클리핑됨 → 일반 블록 흐름으로([contractPrintHtml](lib/contractPrintHtml.ts)). 동의서 break에 `break-before:page` 병행.
- **#2 동의서 별도 서명패드**: '(서명 또는 인)' 자리 클릭→서명패드. 같은 모달을 `signTarget`('contract'|'disposal')으로 재사용([ContractView](app/contract/[tenantId]/ContractView.tsx)). PDF dc-sign에 이미지 렌더, POST 바디·route·PrintContractData에 `disposalSignatureImageDataUrl` 추가. (영구 저장은 안 함 — 매 출력 시 캡처.)
- **#3 퇴실예정 호실 빈칸**: 계약서/동의서 lease 조회 `status in (ACTIVE,RESERVED)` → CHECKOUT_PENDING 포함(actions·route).
- **#4 흡연 여부 위치**: 상단 툴바 셀렉터 제거 → '입실자 정보' 표 항목에 인라인 셀렉터(화면)·값(인쇄).
- **#6 임의 환불 설정 제거**: 위약금율·기간은 법적으로 임의설정 불가 → 환경설정 입력 4종 제거(토글만 유지), 계약서 `{{환불규정}}`을 공정위 고정문구로(`buildRefundClause()` 무인자). RefundPolicyValues 플러밍 전부 제거. **DB 컬럼은 보존(미사용, SQL 없음)**.
- **#7 공정위 환불식 + 모드**: `calcCheckoutRefund` 재작성 — 환불 = 총결제액 − 사용분(월÷30×이용일수) − 위약금. **법정(공정위)=위약금 10% / 선의(일할)=0**. 퇴실 위젯([CheckoutProrationWidget](components/entity-modal/widgets/CheckoutProrationWidget.tsx))에 정산방식 토글(기본=법정). 적용 금액(퇴실월 청구)=사용분+위약금, 환불=총결제액−적용금액. 사용분은 일할 청구(floor)와 동일하게 맞춰 매출 정합.
- **#5 환경설정 탭 재분류**: 과밀한 기본정보 → 새 '데이터·도구' 탭(알림·캘린더·데이터점검·엑셀·백업 5카드 이동) + 기본정보 폼에 '계약·서류' 소제목 그룹. (폼 저장 경로 불변 — 무위험)
**검증**: tsc·build 통과. §4(결제·DB·기획) 해당 #6·#7은 사전 운영자 확인(2026-06-20: 컬럼 보존·1일요금 월÷30·기본 법정) 후 구현.

## 2026-06-20 (이어서) — 홈 '예상 매출' 위젯 (당월 매출 자리 교체) + 신규 예약확정 매출 반영 [SQL 0]
고시원 특성상(유지되면 매출이 거의 안 늚) **'현재까지'보다 '예상 매출 대비 수납 달성도'가 유효** → KPI 카드 **'당월 매출' → '예상 매출 + 달성도'로 교체**.
- 위젯([DashboardClient.tsx](app/(app)/dashboard/DashboardClient.tsx)): 큰 숫자=예상 매출(projectedRevenue), 달성도 막대(수납완료/예상 %), 캡션 "수납 X · 달성 N% · 예정 Y". 미사용된 `revChange/prev/cur` 정리.
- **신규 입실자(예약확정 RESERVED 이상)를 예상 매출에 전액 반영**([page.tsx](app/(app)/dashboard/page.tsx)) — 사용자 결정: 일할 아닌 **그 달 전액**(할인 반영, `billForLeaseMonth(l, mon, null)`). 입주 예정월이 대상월 이내인 RESERVED만(`billableInTargetMonth`). RESERVED는 미입주라 수납완료엔 안 잡히고 → 자동으로 '수납 예정'으로 들어감. projectedRevenue→예상 순이익까지 일관 반영.
- 더블카운트 없음(RESERVED는 activeLeases·paid 합산 대상 아님). 퇴실예정 방은 기존대로 일할/0.
**검증**: tsc·build 통과.

## 2026-06-20 (이어서) — 잔여 소지품 임의처분 동의서 (계약서와 함께 출력) [⚠️ SQL 1건]
새 별도 서류 — **계약서 PDF 뒤에 이어 출력**(enabled 시). 환경설정에서 편집, 입실자 정보·날짜·서명란 자동. (옵션 미지정분은 추천대로: 본문 textarea 편집 + 계약서와 한 PDF, 서명은 동의서 전용 별도 서명란 '___ (서명 또는 인)'.)
- Property `disposalConsentTemplate Json?` = `{ enabled, days, title, body }`. [lib/contract](lib/contract.ts) 타입·기본값(보내준 문구 시드)·`resolveDisposalConsent`.
- 환경설정 카드(출력 토글·미납 기준일·제목·본문 textarea). 본문 변수: `{{성명}} {{호실}} {{연락처}} {{미납일수}} {{영업장명}} {{대표}}`.
- 렌더: [contractPrintHtml](lib/contractPrintHtml.ts) 동의서 페이지(`page-break-before: always`) + [ContractView](app/contract/[tenantId]/ContractView.tsx) 화면 미리보기. 입실자 정보표·동의 내용(변수 치환·문단)·날짜·동의자 서명란.
- 데이터: ContractData·PrintContractData·contract actions·generate route 전 경로.
**⚠️ SQL**: `ALTER TABLE properties ADD COLUMN "disposalConsentTemplate" JSONB;`
**검증**: prisma generate·tsc·build 통과. (기본 `enabled=false` — 환경설정에서 켜야 출력됨.)

## 2026-06-20 — 계약서에 '매월 납부일' 항목 추가 [SQL 0]
입실계약서 헤더에 **'매월 납부일'** 행 추가(입실료 행 아래, colspan으로 한 줄 차지). `lease.dueDay` → '매월 14일'/'매월 말일'/'—'. ContractData·PrintContractData 타입 + contract actions·generate route 데이터 + ContractView·contractPrintHtml 렌더 — 화면·PDF 전 경로. (dueDay는 lease `include`라 추가 쿼리 없음.) 검증: tsc·build 통과.

## 2026-06-20 — 예상 지출: 홈·지출 화면 추정식 통일 [SQL 0]
**증상**: 홈(대시보드) 예상 지출과 지출/기타수익 화면의 '전체 예상 지출'이 달랐음(사용자: 1,005만 vs 988만, 차 174,995원).
**원인**: 둘 다 '발생 지출 + 미발생(미기록) 고정지출' 구조인데, **미발생 고정지출 추정값**이 달랐음 — 홈은 `pendingAmount(임시조정) ?? amount`, 지출 화면은 `historicalAvg(과거평균) ?? amount`. 변동성 고정지출(공과금 등)에서 갈림.
**수정**: 둘 다 **`pendingAmount ?? historicalAvg ?? amount`**(임시조정 → 과거평균 → 기본액)로 통일. 대시보드가 `getRecurringExpensesWithStatus(targetMonth)`를 재사용해 지출 화면과 **같은 데이터·식**을 쓰도록([page.tsx](app/(app)/dashboard/page.tsx) 996행, [FinanceClient.tsx:1909](app/(app)/finance/FinanceClient.tsx#L1909)) → 금액 일치.
**검증**: tsc·build 통과.

## 2026-06-19 (이어서) — 계약서 환불 조항 표시 토글 [⚠️ SQL 1건]
**환경설정 환불 규정 카드에 '계약서에 환불 규정 자동 표시' 토글(기본 ON)** — 계산용 규정과 계약서 표시를 분리(규정으로 계산은 하되 계약서엔 안 넣을 수 있게). 끄면 `{{환불규정}}` 변수가 빈 값으로 치환돼 조항이 사라짐. (전체 커스텀은 계약서 자유편집으로 이미 가능 — 토글은 자동 조항 끄기용.)
- Property `refundClauseInContract Boolean @default(true)`. settings/actions·SettingsForm 토글 연결.
- 화면·PDF vars: `refundClauseInContract`면 `' '+buildRefundClause(정책)`, 아니면 `''`. ContractData·PrintContractData·contract actions·generate route 전 경로 전달.
- 기본 템플릿 환불 줄을 `'…불가합니다.{{환불규정}}'`로(ON시 앞 공백+조항 이어붙고, OFF시 깔끔히 사라짐 — 빈 괄호/빈 줄 없음).
**⚠️ SQL**:
```sql
ALTER TABLE properties ADD COLUMN "refundClauseInContract" BOOLEAN NOT NULL DEFAULT true;
```
**검증**: prisma generate·tsc·build 통과.

## 2026-06-19 (이어서) — 계약서에 환불 조항 자동 생성 ({{환불규정}} 변수) [SQL 0]
**설정값으로 계약서 환불 조항 자동 동기화** — 환경설정 '퇴실 환불 규정'을 계약서 `{{환불규정}}` 변수로 노출 → 설정값으로 문구 생성, **화면·PDF 모두 반영**. 한 곳(설정) 수정으로 계산·계약서가 항상 일치.
- [lib/contract.ts](lib/contract.ts): `buildRefundClause`(정책→문구), `renderContractText` 정규식을 한글 키 허용(`[^}]+` trim)으로 확장. 기본 템플릿 '2. 퇴실 및 환불'의 하드코딩 환불 줄 → `{{환불규정}}`.
- 전 경로에 refundPolicy 전달: contract actions(ContractData)·[ContractView](app/contract/[tenantId]/ContractView.tsx)(vars)·[contractPrintHtml](lib/contractPrintHtml.ts)(PrintContractData·vars)·[generate route](app/api/contract/generate/route.ts)(printData). 화면·PDF 동일 문구.
- 문구: 위약금(N일·P%) 있으면 "입실 후 N일 이내 퇴실 시 잔 입실료 P% 위약금과 1일당 D원 입실료[ 및 청소비] 차감 후 환불". 1일당 비면 '월 이용료의 30분의 1', 위약금 없으면 간략형.
**주의**: 기본 템플릿(미커스텀) 영업장은 자동 반영. **이미 계약서를 편집·저장한 영업장은 계약서 편집에서 환불 줄을 `{{환불규정}}`으로 바꿔야** 동기화됨.
**검증**: tsc·build 통과.

## 2026-06-19 (이어서) — 2단계: 퇴실 환불 미리보기 위젯 통합 [SQL 0]
**퇴실 정산 위젯(CheckoutProrationWidget)에 환불 미리보기 추가** — 퇴실일 선택 시 `previewCheckoutRefund`로 산출:
- 선납액 = 퇴실 달 수납액(보증금·양도인 제외, PaymentRecord 합) · 사용분 = 일할 daysUsed × 1일당 · 위약금(입주 후 N일 이내면 잔액×P%) · 청소비(옵션).
- 항목별 내역(선납−사용−위약금−청소비=환불액) 표시. 환불 규정 미설정이면 '월÷30 기준' 안내. **참고용**(보증금 환불에서 함께 정산).
- 신규 서버 액션 `previewCheckoutRefund`([tenants/actions.ts](app/(app)/tenants/actions.ts)) — 일할 미리보기와 병렬 호출.
**검증**: tsc·build 통과. (선납액=퇴실 달 targetMonth 수납 기준 — 선납 귀속이 다른 케이스는 운영자가 금액 확인. 다음 개선 여지.)

## 2026-06-19 (이어서) — 2단계: 퇴실 환불 규정 (환경설정) [⚠️ SQL 4건 — 적용 후 배포]
**환경설정에 '퇴실 환불 규정' 카드 신설** — 조기 퇴실 환불액 산정 파라미터(영업장별). (사용자 결정: 1일당=고정액 입력·비면 월÷30, 설계대로 진행)
- **Property 4필드**: `refundPenaltyWithinDays`(입주 후 N일 이내 퇴실 시 위약금)·`refundPenaltyPct`(잔 입실료의 P%)·`refundDailyRate`(1일당 고정, 비면 월÷30)·`refundDeductCleaning`(청소비 차감).
- [SettingsForm](app/(app)/settings/SettingsForm.tsx) 카드(N일·P%·1일당·청소비차감) + [settings/actions](app/(app)/settings/actions.ts) select·저장 연결.
- **환불 계산 순수 함수** [lib/prorate.ts](lib/prorate.ts) `calcCheckoutRefund`: 잔 입실료=선납액−사용액(일수×1일당), 위약금=(N일 이내면) 잔액×P%, 환불=max(0, 잔액−위약금−청소비). 데이터(선납액·사용일수·경과일·청소비)는 호출부에서 모아 넘김.
**⚠️ SQL (적용 후 배포 — 안 하면 설정 페이지 조회 오류)**:
```sql
ALTER TABLE properties ADD COLUMN "refundPenaltyWithinDays" INTEGER;
ALTER TABLE properties ADD COLUMN "refundPenaltyPct" INTEGER;
ALTER TABLE properties ADD COLUMN "refundDailyRate" INTEGER;
ALTER TABLE properties ADD COLUMN "refundDeductCleaning" BOOLEAN NOT NULL DEFAULT false;
```
**검증**: prisma generate·tsc·build 통과.
**다음(증분, SQL 적용 후)**: 퇴실 정산 위젯에 환불 미리보기 통합 — 선납액·사용일수를 수납기록·입주일에서 산출 → `calcCheckoutRefund` 내역(잔액·위약금·청소비) 표시 + '적용 금액' 연동.

## 2026-06-19 (이어서) — 캘린더 퇴실월 이용료 일정 정합 [SQL 0]
**증상**: 503호처럼 퇴실 예정인데 캘린더에 그 달 '이용료 납부예정'이 풀로 그대로 떠(퇴실 예정과 둘 다).
**원인**: 캘린더 피드만 청구 규칙을 안 태우고 `discountedRent`(풀 월세)만 사용 — 알림·예상매출과 달리 isCheckoutNoBillingMonth·일할 정산 미반영.
**수정([route.ts](app/api/calendar/[token]/route.ts))**: 이용료 루프에 ① `isCheckoutNoBillingMonth`(퇴실일 ≤ 납부일 = 청구 0)면 그 달 일정 생략 ② `checkoutProratedAmount`(그 달 적용분) 우선 ③ 금액 0이면 생략. select에 checkoutProratedAmount/Month 추가. → 퇴실일이 납부일 이전이면 이용료 일정 사라지고, 이후면 일할(위젯서 0 설정 시 사라짐) 반영. **알림·예상매출과 동일 규칙.** (단 기존 503호는 일할 미적용이면 풀 표시 — 퇴실 정산 1회 적용 필요)
**검증**: tsc·build 통과.

## 2026-06-19 (이어서) — 지출 품목명 변경 → 재고 전파 [SQL 0]
**증상(사용자)**: 지출에서 소모품 품목명을 바꿔도('공구엔 코발트 드릴비트 일자'→'코발트 드릴비트') 재고에 반영 안 됨.
**원인**: 재고 TrackedItem은 `(카테고리+label)` 문자열로 지출과 연결(FK 없음) → 지출 라벨만 바꾸면 카드와 어긋남. 정식 경로는 재고관리 `updateTrackedItem`(라벨 + 매칭 지출 동시 변경)뿐이었음.
**수정**: `updateExpense` 단일 경로에서 품목명이 바뀌면(카테고리 동일) `propagateItemLabelRename`으로 **재고 카드 label + 형제 지출 itemLabel을 함께 변경**(updateTrackedItem과 동일 규칙). 새 이름이 같은 카테고리의 다른 기존 카드와 겹치면 전파 안 함(병합 필요 상황). 추적 품목 아니면 무동작. 전파 실패는 지출 저장을 막지 않음(best-effort, 재고관리서 수동 정리 가능).
**검증**: tsc 클린·build ✓·lint 신규에러 0. multiItems(다품목 한 지출) 내 개별 라벨 변경은 대상 아님 — 단일 품목 케이스.

## 2026-06-19 (이어서) — 퇴실 일할 정산 '자동 적용' (1단계 나머지) [SQL 0]
퇴실 예정으로 전환/편집하면 일할 정산을 **자동 적용**(이전엔 위젯서 수동 적용해야 해 503호처럼 풀 청구로 남던 문제 해소).
- `prorationDataForChange`에 **autoApply** 파라미터 추가 — 미적용 상태라도 'CHECKOUT_PENDING으로 설정'일 때 자동 계산·적용(undo 스냅샷 포함). 거주중 납입일 변경(changeDueDay)은 autoApply=false(이미 적용분만 재계산).
- 3경로 연결: `applyStatusTransition`(toStatus===CHECKOUT_PENDING), `updateTenant`(status===CHECKOUT_PENDING & 퇴실일/납부일 변경 시), `changeDueDay`(false).
- **수동 조정 보존**: 퇴실일·납부일이 안 바뀐 저장은 재계산 안 함 → 위젯에서 조정한 금액(봐주기 등) 유지.
- 알림·예상매출·예상순이익은 `billForLeaseMonth` 한 엔진 공유 → 자동 적용분이 셋에 동시 반영.
**주의**: ① 기존 CHECKOUT_PENDING(이미 퇴실예정인 503호 등)은 **소급 자동적용 안 됨** — 퇴실 전환 재저장 또는 위젯 1회 적용 필요. ② 자동 적용분 적용취소는 '적용 직전(거주중)'으로 복원(ConfirmDialog 문구에 명시됨). **2단계 남음**: 환경설정 환불규정.
**검증(loop.md 1)**: tsc 클린·build ✓·lint 신규에러 0. 적대적 정적추적 10개 시나리오 청구 정확성 이상 0. ⚠️결제 핵심이라 실기기 검증 권장.

## 2026-06-19 (이어서) — 퇴실 정산 수동 조정 + 캘린더 '이용료'·만단위 표기 [SQL 0]
사용자 보고: 503호 오늘 퇴실인데 '퇴실 예정'·'월세 미납' 알림이 동시에 뜨고 예상매출에도 잡힘.
**원인 진단(버그 아님, 모델 빈틈)**: 선납+일할 모델([lib/prorate.ts](lib/prorate.ts)·[lib/billing.ts](lib/billing.ts)). 퇴실일이 그 달 납부일 **이전/같음**→`isCheckoutNoBillingMonth`로 자동 0(알림·예상매출 제외 이미 동작). 퇴실일이 납부일 **이후**면 일할 정산(`checkoutProratedAmount`)이 적용돼야 하나 **자동이 아니라 위젯에서 수동 적용**해야 함 → 미적용이면 한 달치 풀로 잡힘(503호). 알림·예상매출·예상순이익은 `billForLeaseMonth` 한 엔진을 공유해 정산값이 셋에 동시 반영됨.
**이번 반영(사용자 결정: 1단계 = 자동 일할 + 수동 조정 중 '수동 조정' 우선 구현)**:
- **퇴실 정산 수동 조정**: `setCheckoutProration(leaseTermId, date, manualAmount?)` — 자동 일할액 위에 운영자가 금액 직접 수정(하루 더 봐주기·위약금·청소비 차감 등). **0으로 두면 퇴실월 면제**(청구 0). `undo.appliedAmount`도 적용값 기준이라 적용취소·수동수정 감지 정합 유지. [CheckoutProrationWidget](components/entity-modal/widgets/CheckoutProrationWidget.tsx)에 '적용 금액' 편집칸(자동 일할 기본값) 추가.
- **503호 즉시 처치**: 퇴실 정산 위젯에서 적용(자동/수정/0) → 알림·예상매출·예상순이익 즉시 반영.
- **캘린더(.ics)**: 납부 예정 제목 '월세'→**'이용료'**, 금액 '1,503,500원'→**'150만3500원'**(만/억 단위 `manWon`). UID 동일 → 재구독 없이 다음 동기화 때 제목 자동 갱신. ([route.ts](app/api/calendar/[token]/route.ts))
**검증**: tsc 클린·build ✓·변경분 lint 신규에러 0.
**[해결됨 — 89184ab]** ~~남은 1단계 — 퇴실일 지정 시 일할 자동 적용~~ → 완료: `prorationDataForChange(autoApply)` 로 퇴실 예정 전환(applyStatusTransition)·편집 폼(updateTenant) 시 자동 적용, 퇴실일/납부일 변경 시 재계산, 거주중 복귀 시 자동 해제, undo 스냅샷 포함. **2단계(환불규정 다양화)**: 위약금율·기간은 법적으로 임의 설정 불가 → 공정거래위원회 기준 고정으로 결정(설정에서 법정/선의 모드만 선택). 추가 작업 없음.

## 2026-06-19 — 지출 방별 분배 묶음: 미배정을 '방'으로 세던 버그 [SQL 0]
**증상(사용자 스크린샷)**: 의자 4개를 418호 1개 + 미배정 3개로 나눴는데 카드가 '방 2개'로 표시. 미배정(roomId=null) 행을 방 1개로 카운트하던 문제. 펼침 팝업도 미배정 행을 품목 detail('[의자] x 3개')로 보여 줌.
**수정(FinanceClient.tsx)**:
- '방 N개' 칩 = **실제 배정된 방만 distinct 카운트**(roomChipText 신설) → '방 1개'.
- roomsLabel이 **미배정을 수량과 함께** 표기 → '418호·미배정 3개'(기존 '미지정'은 수량 없음·행수 기반).
- 묶음 펼침 팝업의 미배정 행을 품목 detail 대신 **'미배정'**(allocationGroupId 있는 분배 묶음에 한해 — 주문 묶음은 품목명 유지).
- 용어 '미지정'→'미배정' 통일(분배 에디터 '나머지 N개 미배정' 포함). 대표 제목 'x 4개'(합계)는 불변.
**검증**: tsc 클린·build ✓. 변경분 lint 신규에러 0(직전 커밋서 들어온 따옴표 unescaped 2건도 정리).

## 2026-06-18 (이어서) — 서비스·무형 = 품목 모듈(세부내역)로 전환 + 단일 '대상 호실' 부활 [SQL 0]
**배경(직전 208fa1e 정정)**: 서비스·무형 '세부항목 필수'를 단순 텍스트로 구현했으나, 사용자 의도는 **물품 구매의 품목 모듈(항목·규격·수량·금액)** 로 한 서비스를 세부 내역으로 쪼개 방별 투자금을 보는 것. 예) 도배장판 305호 21만 = 장판 시공 5만(1회) + 도배(도배지 포함) 14만 + 하리 추가 2만.
**변경(FinanceClient.tsx · finance/actions.ts)**:
- **서비스·무형도 ItemSelector 공유** — 항목별 금액·규격·수량으로 내역 쪼개기. 서비스 항목은 `excludeFromInventory=true`로 저장 → 재고/비품 탭엔 안 잡히되 방 상세 '이 방에 든 지출'엔 내역 표시. 구 서비스 금액분배(serviceAllocsJson·addSvcAllocs) UI·서버 경로 제거(품목 분배로 일원화).
- **단일 '대상 호실' 부활** — 비-비품(서비스·소모품)에 한해. 한 서비스를 한 방에 통째 배정 → 세부 항목들이 그 방에 귀속(도배장판=305호 한 번에). 여러 방은 항목별 '방별로 나누기'. 비품(내구재)은 여전히 폼에서 제외(수령 후 비품탭 배정).
- **규격 단위에 '회' 추가**(콤보박스라 다른 단위도 선택·직접입력 가능).
- **검증 규칙**: 물품=품목 필수(기존). 서비스 비-면제 카테고리=세부 항목 1개+ 필수. 면제(공과금·관리비·임대료·세금/수수료·보증금 반환)=금액만 OK.
- **수정 경로 정합**: `editIsDurable`에 `!excludeFromInventory` 추가(서비스 항목이 비품으로 오분류돼 방배정 UI가 숨던 버그 차단). `updateExpense`가 firstRow·restRows·단일행 모두에 `excludeFromInventory` 전파(서비스를 다항목으로 수정 시 새 분할 행이 재고에 새지 않게).
**검증(loop.md 1)**: tsc 클린(.next/types 노이즈만)·build 통과. 자체수정 1건(`setAddSvcAllocs` 잔존 참조 1곳 → 제거 후 재통과). lint 신규에러 0(기존 부채 32 only). 적대적 정적추적 9개 시나리오(서비스 단일/다항목 1방/멀티룸·면제·비품·소모품·서비스 수정 시 전파·방상세 표시) 결함 0.
**⏳ 실기기 스모크(남은 게이트)**: ① 서비스 유형에서 항목 여러 개+규격 '회' → 단일 대상 호실 → 저장 → 목록 펼침에 내역·방 상세에 방별 합계·비품탭엔 미표시 ② 면제 카테고리(공과금)는 항목 없이 금액만 저장 ③ 기존 물품/서비스 회귀.

## 2026-06-18 (이어서) — 지출 방배정 단순화·세부항목 필수·임시조정 표시정리 (사용자 4건) [SQL 0]
사용자 요청 4건. 각각 "이슈 점검" 후 결정 반영(AskUser 2건: 세부항목 필수범위·임시조정 숨김규칙 모두 추천안).
- **#2 지출 등록 폼 단일 '대상 호실' 드롭다운 제거**: 구매 단계 선배정이 실제 배정과 중복되는 혼란 → 등록 폼에선 단일 방 지정 UI 삭제. 방 배정은 ⓐ 물품=품목별 '방별로 나누기' ⓑ 서비스=서비스 '방별로 나누기' ⓒ 비품=수령 후 비품탭 으로 일원화. **수정(EDIT) 폼 드롭다운은 개별 행 사후 재배정용으로 유지**. (점검: 한 조사가 "방 상세 '이 방에 든 지출'이 빈다"고 했으나 **오판** — `getRoomExpenses`는 roomId 필터인데 방별 분배 행도 roomId가 붙으므로 그대로 잡힘. `targetRoomId`는 미사용 dead 필드.) FinanceClient ADD 폼 방 구간 재구성 + 핸들러.
- **#1+#3 세부항목 필수화**: 물품은 품목이 곧 세부항목(이미 클라 필수). **서비스·무형도 세부항목 필수**(방별 분배 행이 `detail`을 갖게 해 '이 방에 무슨 돈이 들어갔는지' 표시 — actions.ts 서비스분배 `detail: detail||null`, getRoomExpenses가 detail 표시). **면제 카테고리**(무형, 강제 시 등록 막힘) = 공과금·관리비·임대료·세금/수수료·보증금 반환 → `DETAIL_OPTIONAL_CATEGORIES`. add/edit 핸들러 양쪽 클라 검증(기존 '품목 필수'도 클라 전용이라 패턴 통일). 서버 미강제(운영자 전용 앱·일관성).
- **#4 납부일 임시조정 잔존**: 원인 = 수납 위젯 `isActive`가 `!!overrideDueDay && !!overrideDueDayMonth`뿐이라 대상 월 경과·납부 여부를 무시하고 해제 전까지 계속 노출(DueDayTempAdjustWidget:54). 4월 조정이 6월에도 남던 이유. **수정**: `과거 달 + 납부 완료(미납목록에서 빠짐)`일 때만 숨김 — `ovrMonth < nowMonth && (!firstUnpaidMonth || ovrMonth < firstUnpaidMonth)`. **현재·미래 사전조정/과거라도 연체분은 계속 표시**, 데이터·계산(effectiveDueDayForMonth)·금액 불변(표시만). 호실 필터·입주자 뱃지는 이미 `=== targetMonth` 게이트라 손 안 댐.
- **규격 cm·mm**: (앞 항목에서 반영 완료)
**검증(loop.md)**: tsc --noEmit 클린 · `npm run build` 성공 · eslint 변경파일 신규에러 0(따옴표 `react/no-unescaped-entities` 4건은 `<strong>`으로 치환해 해소, 잔여 3건=기존 부채 1538 any·3402 EDIT폼 따옴표). SQL 0. **남은 게이트=실기기 스모크**: 서비스 세부항목 필수·서비스 분배 detail 방별 표시·등록폼 방드롭다운 제거·임시조정 4월분 숨김·면제 카테고리 등록 통과.

## 2026-06-18 (이어서) — loop.md 작업 검증 기준 도입 + 오늘 지출 변경 loop 검증 [SQL 0]
**loop.md 신설**(`ba1f35b`): 프로젝트 루트 `loop.md` = 모든 개발 작업의 최종 검증·운영 루프 기준. ① 필수통과(build/TS/Lint·보안·DB무결성·핵심운영로직) ② 측정(API에러로그·성능·런타임) ③ 1~5점 평가+근거+액션(아키텍처·사용자흐름·작업범위) ④ 인간호출(DB스키마·인증/RLS·결제/데이터손실·기획충돌) ⑤ 증거보고서. AGENTS.md에 '작업 검증 규칙' 추가 → CLAUDE.md가 @AGENTS.md 로드하므로 **매 세션 자동 참고**.
**오늘 지출 변경(`f9480fe`)을 loop.md로 검증 — 1~4번 정적 통과**:
- 필수통과: `npm run build` exit0(Compiled OK) · `tsc --noEmit` 클린(iCloud `.next/types` 노이즈만) · diff 시크릿/env/키 0건 · 스키마 변경 0(SQL불필요, 기존 roomId/allocationGroupId/assignedLocationId 재사용) · 핵심로직(임대료 일할계산 lib/billing·계약기간·방상태) 무접점.
- Lint: 저장소 **기존 부채** 32 errors(`no-explicit-any`, 주로 catch 블록)·경고 11 — **오늘 diff는 any 추가 0 → 신규 에러 0**(page.tsx 0건). 변경은 lint-중립이나 전역 'Lint 통과'는 기존 부채로 미달.
- 자체수정 2건(구현 반영 완료): ① 비품 수정 시 roomId='' 제출로 기존 배정이 지워지던 위험 → 드롭다운만 숨기고 기존값 보존 ② 소모품→비품 카테고리 전환 시 allocations 누수 → itemsJson에서 allocations 제거 가드.
- 적대적 정적추적(서비스 분배 묶음의 목록 대표행·펼침팝업·개별수정): itemLabel null이어도 그룹 repDetail이 detail로 폴백, 펼침은 방번호/금액·수량은 qtyValue 있을 때만, `updateExpense` 단일경로가 allocationGroupId·assignedLocationId·isCommonAsset 미터치 → **결함 0**.
**⏳ 남은 머지 게이트(미완) — 실기기 스모크 테스트**(앱이 Supabase 인증+영업장 선택 요구 → AI 자동 대행 불가, 운영자 확인 필요). 다음 세션/사용자 확인용 체크리스트:
- **A 규격**: 물품구매 품목 규격 단위 드롭다운에 cm·mm 노출.
- **B 비품(재고 비추적 카테고리 물품, 예: 수선유지비)**: 폼에서 '방별로 나누기'·'대상 호실' 사라지고 "수령 후 재고>비품·자재에서 배정" 안내 → 저장 후 비품탭에 미배정으로 뜸 → 방 배정 → 그 비품 지출을 수정해도 배정 보존(공용부 배정 포함).
- **C 소모품(부식/소모품/폐기물 카테고리)**: 기존대로 방별 나누기·대상 호실 정상(회귀 확인).
- **D 서비스·무형**: 대상 호실 옆 '방별로 나누기' 토글 → {방,금액} 행, "방 배정 X / 전체 Y · 나머지 미지정" 표시, 합계 초과 시 빨강 경고+저장 차단 → 목록 '방 N개' 묶음+서비스명, 펼침에 방별 금액, 개별 수정·삭제, 단일 방+전액은 묶음 없이 단일 행.
- **E 회귀**: 기존 품목 방별 분배·합배송 묶음 정상 표시.
**잔여 백로그**: ① lint 부채 32건(no-explicit-any) 별도 정리 태스크 ② 품목/서비스 분배 로직(expandExpenseRows ↔ addExpense 서비스 분기) 공용 헬퍼화.

## 2026-06-18 (이어서) — 지출↔재고 방별 배정 정리 + 서비스 방별 분배 + 규격 cm·mm [SQL 0]
**배경**: 지출 등록/수정 폼(대상 호실·품목 방별 나누기)과 재고 비품·자재 탭(방 배정)이 같은 `Expense.roomId`를 따로 건드려 꼬임. 특히 `updateExpense`가 `roomId`만 덮고 `assignedLocationId`(공용부)·`isCommonAsset`(공용자재)은 안 건드려, 공용부 배정 비품을 지출 폼에서 방 지정하면 방+공용부 동시 설정(상호배타 위반)되던 구조. 분할/병합 엔진도 폼(`expandExpenseRows`)·비품탭(`assignAggregateToTarget`+`mergeUnassignedGroup`) 두 벌.
**결정(사용자)**: 비품은 "수령 후 비품 탭에서 배정"이 맞음 — 구매 단계 선배정은 실제 배정 때 중복 위험. → 지출 폼에서 **비품(재고 비추적 카테고리의 물품)** 방 배정 UI 제거. 소모품·서비스는 폼 배정 유지.
**변경**:
- 추적 카테고리(`getTrackedCategories` 신설) → page.tsx Promise.all → FinanceClient `trackedCategories` prop. `addIsDurable`/`editIsDurable` = 물품 & 비추적 카테고리.
- 비품: 등록·수정 폼에서 대상호실 드롭다운·품목 방별 나누기(ItemSelector rooms=[]) 숨김 + "수령 후 재고>비품·자재에서 배정" 안내. itemsJson에서 allocations 제거(누수 차단). **수정 시 기존 roomId·공용부·공용자재 배정 보존**(드롭다운만 숨김, 값 그대로 제출 / updateExpense가 assign 필드 미터치).
- **서비스·무형 방별 분배 추가**: 대상호실 옆 '방별로 나누기' 토글 → {방, 금액} 행. 서버 addExpense `serviceAllocsJson` 파싱 → 금액 합계 검증(초과 차단) 후 방별 N행 + 미지정 나머지(roomId=null), `allocationGroupId`로 묶음. 단일 방·전액이면 묶음 없이 1행. 목록 그룹 표시는 itemLabel 없으면 detail로 대표명(기존 로직 호환).
- **규격 단위에 cm·mm 추가**(SPEC_UNITS — 등록·수정 공유).
**파일**: app/(app)/finance/{FinanceClient.tsx, actions.ts, page.tsx}. tsc·build 통과. **SQL 불필요**(기존 roomId/allocationGroupId 재사용).
**남은 것**: 분할/병합 엔진 완전 통합(공용 위젯화)은 추후 — 이번엔 폼에서 비품 배정을 빼 충돌 원천 제거하는 선까지.

## 2026-06-18 (이어서) — 지출 방별 분배 묶음 대표 수량 합산 [SQL 0]
**증상**: 같은 품목을 방별로 나눠 묶었을 때(예: 506호 1개 + 미지정 3개 = 총 4개), 지출 카드 대표 제목이 대표 행 하나의 수량만 가져와 `[하수구 트랩] x 1개`로 표시됨. 묶음 상세 팝업 제목도 동일.
**원인**: FinanceClient `groupedExpenseRows` 의 **주문별(order)** 분기에는 같은 품목 수량 합산 로직이 있었으나, **방별(room, allocationGroupId)** 분기는 `{ ...e, amount: total }`로 대표 행 detail을 그대로 써서 수량 미합산.
**수정**: 방별 분기도 `rows`(방배정분+미지정분) 전체의 `qtyValue` 합산 → `[품목] (스펙) x 합계수량단위`로 repDetail 재구성. 카드·상세 팝업 제목 모두 `x 4개`로 표기. 팝업 안 개별 방 내역(개별 수정·삭제)은 그대로.
**파일**: app/(app)/finance/FinanceClient.tsx. tsc·build 통과.

## 2026-06-18 (이어서) — 캘린더 피드 후속 수정 (이모지 제거·캐시) [SQL 0]
- **이모지 제거**: 일정 제목의 💰·🚪 삭제 → `101호 홍길동 월세 450,000원` / `101호 홍길동 퇴실 예정`. UID 동일이라 다음 동기화 때 기존 일정 제목도 자동 갱신.
- **CDN 캐시 제거**: 피드 응답 `Cache-Control`을 `public, max-age=3600` → `no-store, no-cache, must-revalidate, max-age=0`. 1시간 캐시 때문에 **구독 취소 후 재구독해도 캐시된 옛 복사본(이모지 포함)**이 내려오던 문제 해결. 이제 가져갈 때마다 최신본.
- **파일**: app/api/calendar/[token]/route.ts.
- **⚠️ 캘린더 연동 SQL 적용 완료**(아래 6/18 캘린더 연동 항목의 SQL 1건은 사용자가 Supabase에 반영함).

## 2026-06-18 — 캘린더 연동(.ics 구독 피드) [SQL 1건 — 적용 완료]
구글·애플·아웃룩 캘린더에서 구독하면 **월세 납부 예정일·퇴실 예정일**이 자동 동기화(읽기전용).
**구조**: 영업장별 비밀 토큰(`Property.calendarToken`) → 공개 .ics 엔드포인트 `/api/calendar/[token]`. 캘린더 앱은 쿠키 없이 가져가므로 토큰이 곧 보안. 유출 시 재발급으로 무효화.
**피드 내용**(KST 기준): ① 납부 예정일 — ACTIVE·CHECKOUT_PENDING·NON_RESIDENT 계약 중 rentAmount>0 & dueDay 있는 건, 이번 달부터 6개월(퇴실 달 이후 제외), 금액은 `discountedRent`로 할인 반영(`101호 홍길동 월세 450,000원`). dueDay '말' → 그 달 말일. ② 퇴실 예정일 — CHECKOUT_PENDING & expectedMoveOut(`101호 홍길동 퇴실 예정`). 모두 종일(VALUE=DATE) 이벤트. (이모지·캐시 후속 수정은 위 6/18 항목 참고)
**설정 UI**(환경설정 기본정보 탭, '알림(푸시)' 아래): '캘린더 연동(구독)' 카드 — 구독 주소 만들기 → 주소 복사 / 구글 캘린더에 추가 / 애플 캘린더에 추가(webcal://) / 주소 재발급 + 플랫폼별 구독 방법 안내(details).
**신규 파일**: prisma/migrate_property_calendar_token.sql · app/api/calendar/[token]/route.ts · app/(app)/settings/CalendarSubscribeCard.tsx. **수정**: prisma/schema.prisma(Property.calendarToken @unique) · settings/actions.ts(getOrCreateCalendarToken·resetCalendarToken) · settings/SettingsForm.tsx.
**검증**: tsc·build 통과.
**SQL (적용 완료 ✅)**:
```sql
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "calendarToken" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "properties_calendarToken_key" ON "properties" ("calendarToken");
```

## 2026-06-15 (이어서) — 실거주 확인서 발급 기능 (서류 메뉴 1탄) [⚠️ SQL 2건 적용 후 배포]
입실자 서류 작성·발급 트랙의 첫 실물 기능. 계약서 시스템을 본떠 자동채움 + 도장 + Drive 저장 + 발급 이력.
**메뉴 구조**: 사이드바 '운영'에서 계약서를 빼고 **'관련 서류' 그룹** 신설 → [계약서, 실거주 확인서].
**핵심 결정(고시원 도메인)**: 임차인 주소 = 영업장 주소 + 방번호 (별도 필드 불필요·SQL 0). 면적 = 호실 areaM2 우선 → 환경설정 기본면적(defaultAreaM2) fallback. 도장 = 기존 `Property.stampDriveFileId` 재사용. 임대료 줄 보증금 = 보증금 금액만(청소비 합성 X). 제출처 = ' 서울특별시장 귀하' 고정(지역별 분기는 추후 영업장 주소 기반).
**라우트**(계약서 contract/contracts 패턴 모방 — 충돌 회피): 목록 `/residence-certs`((app) 셸), 작성·발급 `/residence-cert/[tenantId]`(standalone, 셸 밖·인쇄용), API `/api/residence-cert/generate`(puppeteer A4 PDF).
**작성 화면**(ResidenceCertView): PDF와 동일 정부양식 A4. **모든 칸 편집 가능**(자동 채움 + 직접 수정), 작성일 date, '자동값으로'(undo) · '인쇄'(window.print) · '발급(PDF 저장)'. 도장은 임대인 성명줄 (인) 옆 합성.
**발급 흐름**: POST → 서버가 도장 URL을 DB 기준으로 재결정(주입 방지) → buildResidenceCertPrintHtml → puppeteer PDF → Drive 업로드 → ResidenceCertFile 레코드 → 목록으로.
**목록**(/residence-certs): 상단 '새 발급'(거주중 입실자 칩 → 작성화면) + 하단 '발급 이력'(보기·재발급·삭제, Drive 원본 동반삭제).
**입주자 모달**: '실거주 확인서' 버튼 추가(계약서 출력 옆, flex-wrap).
**환경설정**: '기본 전용면적(㎡)' 입력란 추가(호실 면적 우선·비면 이 값).
**신규 파일**: prisma(ResidenceCertFile, Property.defaultAreaM2) · lib/residenceCertPrintHtml.ts · app/residence-cert/[tenantId]/{page,ResidenceCertView,actions} · app/api/residence-cert/generate/route · app/(app)/residence-certs/{page,ResidenceCertClient,actions}. 수정: Sidebar · settings(actions·SettingsForm) · EntityModal.
**검증**: tsc·build 통과, 3개 라우트 정상 등록(충돌 없음).
**⚠️ SQL (적용 후 배포)**:
```sql
ALTER TABLE properties ADD COLUMN "defaultAreaM2" DOUBLE PRECISION;
CREATE TABLE residence_cert_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "driveFileId" TEXT NOT NULL, "fileName" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT now(), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "tenantId" UUID NOT NULL, "leaseTermId" UUID, "propertyId" UUID NOT NULL,
  CONSTRAINT "residence_cert_files_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "residence_cert_files_leaseTermId_fkey" FOREIGN KEY ("leaseTermId") REFERENCES lease_terms(id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "residence_cert_files_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES properties(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "residence_cert_files_tenantId_createdAt_idx" ON residence_cert_files ("tenantId", "createdAt");
CREATE INDEX "residence_cert_files_propertyId_createdAt_idx" ON residence_cert_files ("propertyId", "createdAt");
```
**남은 것**: 지역별 제출처 분기(서울 외), 임차인 주소를 영업장+방번호로 자동 — 사용자 실측 검증 후 레이아웃 미세조정.

### 후속 — 실거주 확인서: 원본 양식 위 overlay 방식으로 전환 [SQL 불필요]
"양식을 최대한 원본 그대로(폰트까지)" 요청 → HTML 재현(puppeteer) 대신 **원본 빈 양식 PDF 위에 데이터·도장만 좌표로 얹는** 방식으로 발급 경로 교체. 양식·선·라벨·폰트가 100% 원본.
- **원본 폰트** = HCR돋움·한컴돋움(고딕). 채우는 글자는 무료 **나눔고딕 TTF** 런타임 fetch+캐시(woff2는 fontkit 임베드 불가) + subset 임베드.
- **좌표맵**: pdfjs로 원본(A4 595×842pt)의 모든 라벨 baseline 추출 → 데이터 위치 매핑([residenceCertOverlay.ts](lib/residenceCertOverlay.ts)). 거주기간·작성일은 인쇄된 빈칸 채움(작성일)·흰 박스로 덮고 재기입(거주기간). 임대료/보증금은 인쇄된 '원' 앞 우측정렬. **도장은 (인) 위에 흰 박스+이미지로 덮음**(원본 PNG 바이트 다운로드로 투명도 보존 — google-drive downloadDriveBytes 신설).
- **검증**: 샘플 발급 PDF의 텍스트 좌표를 pdfjs로 역추출 → 모든 값이 해당 라벨 baseline에 정확히 안착 확인(자동). 시각 미세조정(특히 도장)은 사용자 발급 후.
- 발급 경로: puppeteer/HTML 제거 → pdf-lib overlay(가볍고 빠름, maxDuration 60→30). **인쇄** 버튼은 화면 HTML 대신 실제 overlay PDF를 preview 모드(?preview)로 받아 새 탭에서 인쇄. 화면은 입력용 미리보기로 명시.
- 양식 추가 시: `public/forms/<form>.pdf` + base64 임베드 + 좌표맵 한 쌍만 추가. 원본: [public/forms/residence-cert-seoul.pdf](public/forms/residence-cert-seoul.pdf).
- deps: pdf-lib·@pdf-lib/fontkit(런타임), pdfjs-dist(dev, 좌표 측정용). 구 [lib/residenceCertPrintHtml.ts] 삭제.

### 후속 — 발급 confirm 무반응 + 보증금 환불 UX 2건 [SQL 불필요]
- **실거주확인서 발급 버튼 모바일 무반응**: standalone 라우트(app/residence-cert/[tenantId])에 layout 이 없어 ConfirmHost/SaveFeedback 미마운트 → confirmDialog 가 큐에만 쌓여 안 뜨다가 다른 페이지에서 뒤늦게 노출. **app/residence-cert/[tenantId]/layout.tsx 신설**(ConfirmHost+SaveFeedback). (계약서는 이미 자체 layout 보유)
- **보증금 환불(TenantStatusTransitions·퇴실)**: ① '환불 안 함' 버튼 추가(환불액 0). ② 기본 환불액 = 보증금 − 청소비(설정 입주자는 자동 차감, 미설정이면 청소비 0→전액). ③ 일부 환불 안내문구('일부만 환불하려면 금액 입력, 환불 안 하려면 환불 안 함'). ④ 환불 0 이어도 recordDepositReturn 호출하도록 조건 완화(`depositAmount>0 && transRefund!=null`) → 미반환 전액이 보증금 수익(extraIncome)으로 기록. lease.cleaningFee 를 TenantBody→위젯으로 전달(getTenantDetail 이미 select).

### 후속 — 실거주 확인서 원본 양식 100% 보존(overlay) + WYSIWYG 편집기 [SQL 불필요]
**발급 PDF = 원본 그대로**: puppeteer HTML 재현 폐기 → 원본 빈 양식 PDF(base64 임베드, lib/residenceCertTemplateSeoul.ts) 위에 pdf-lib 로 데이터·도장만 좌표로 얹음. 양식·선·라벨·폰트 100% 원본. 채우는 글자는 원본 폰트(돋움)에 맞춰 **나눔고딕** 임베드(`subset:false` — subset 시 글리프 깨짐). 도장은 인쇄된 '(인)' 을 흰 박스로 덮고 그 자리에 원본 PNG 합성(Drive 원본 바이트 다운로드 `downloadDriveBytes`, 투명 보존). 좌표는 pdfjs 로 라벨 baseline 추출해 매핑.
**좌표 단일 소스** `lib/residenceCertLayout.ts` — overlay(서버 PDF)와 편집 화면이 공유. 양식 바뀌면 이 파일만 갱신.
**WYSIWYG 편집기**: ResidenceCertView 를 '원본 양식 이미지(public/forms/residence-cert-seoul-bg.png, qlmanage 렌더) 배경 + 좌표 투명 입력칸' 으로 재작성. 폰트는 출력과 같은 나눔고딕(웹폰트). 화면=출력 일치. '미리보기·인쇄'는 서버에서 overlay PDF(preview 모드, Drive 저장 없이 바이트 반환)를 새 탭으로 열어 인쇄.
**검증 방법 확립**: macOS `qlmanage -t` 로 PDF·HTML 을 PNG 로 렌더해 **배포 전 시각 확인**(앞서 폰트깨짐을 미확인 배포한 실수 재발 방지). 편집기도 동일 좌표로 정적 HTML 만들어 렌더 검증.
**필드 정리**: 임대인 생년월일/사업자등록번호 → 단일 `landlordIdNo`(개인=생년월일·사업자=등록번호, '생 년 월 일 :' 줄에 표기). 임차인 값 x=252 들여쓰기.
**신규 deps**: pdf-lib·@pdf-lib/fontkit(런타임), pdfjs-dist(좌표측정).

### 후속 — 실거주 확인서 사용자 피드백 4건 [SQL 불필요]
- **Made with 스테이음 제거**: 공문서라 브랜딩 X — 화면·PDF 양쪽 워드마크 삭제.
- **주소 호수 미부착**: 소재지·임차인 주소를 영업장 주소 하나로 통일(4·5층 뒤 호수 부착 어색). 필요시 화면에서 수동 수정.
- **면적 = 영업장 전용면적**: 호실별 areaM2 fallback 제거 → 환경설정 defaultAreaM2 만 사용(영업장 기준). 환경설정 라벨 '기본 전용면적'→'영업장 전용면적', 입력 시 ㎡ 접미사 자동 표시(controlled).
- **도장이 (인) 덮음**: 도장 있으면 (인) `visibility:hidden` + 도장을 그 자리(seal 16mm 박스)에 절대배치로 중앙 합성 → (인) 안 보임. 화면·PDF 동일.

### 후속 — 입주자 이메일 필드 [⚠️ SQL 1건 적용 후 배포]
입주자 정보에 이메일이 없어 추가. `Tenant.email String?` 신설(ContactType enum엔 EMAIL 없어 전용 필드가 깔끔). 고객 폼 연락처 섹션에 이메일 입력칸(type=email), createTenant·updateTenant 저장, getTenantDetail select 에 email 추가, TenantBasicInfo 표시(있을 때만). getTenants 는 include 라 자동 포함. **SQL**: `ALTER TABLE tenants ADD COLUMN email TEXT;`

## 2026-06-17 — 입실료 납부 확인서: Claude Design A5 시안 + Pretendard 폰트 적용
시안(HTML) 그대로 레이아웃 정밀화(제목 좌측·헤더 2줄·납부금액 박스·확인문구·서명/도장·님 제거).
**폰트 Pretendard 적용** — public/fonts/Pretendard-Regular/Bold.ttf 임베드(진짜 Bold, faux-bold 제거).
교훈/주의(다음에 폰트 추가 시):
- Pretendard 표준 .otf(CFF)는 pdf-lib 임베드 불가 → otf2ttf 모듈(`from otf2ttf import main`)로 TTF 변환.
- 변환 직후 하이픈/물결 폭이 깨짐(계좌·전화 `123- 45- 67890`). 원인=post format2의 `cidXXXX` 글리프명을 pdf-lib이 CID 폰트로 오인. **해결=fontTools로 GSUB/GPOS/GDEF 삭제 + post.formatType=3.0** 후 저장.
- 검증은 qlmanage(QuickLook) 부정확 → **pdfjs-dist + @napi-rs/canvas**(브라우저와 동일 엔진)로 렌더해 확인.
- next.config outputFileTracingIncludes에 `/api/rent-receipt/generate: ['./public/fonts/**']` 추가해야 Vercel 함수에 폰트 포함됨.

## 2026-06-16 (이어서) — 월세 영수증 §20 전면 반영 + 계좌번호 [⚠️ SQL: properties.bankAccount]
브랜드 가이드 §20(인쇄 서류) 신설 반영. 영수증을 §20.10(a) 입실료 납부확인서 스펙으로 재작성:
**A5 세로** + 인쇄전용 토큰(--p-*: ink/muted/tc/label-bg/rule). 헤더(로고12mm+영업장명+사업자등록번호·대표+주소·전화 + No.·발행일 + 테라코타 룰 1.6pt) · 제목 · 키값표1(성명/호실/거주기간/납부대상월) · 금액박스(영수금액 라벨 + 한글병기 '금 ○○원정' + ₩ 우측 14pt 테라코타) · 키값표2(납부일/납부방법/비고) · 영수확인문구 · 서명(임대인 대표 ○○○)+도장(이름 좌측·도장 우측 비간섭) · made with stayeum 워드마크.
**발행번호** = `YYYYMMDD-NNN`(영업장별 일련 = RentReceiptFile count+1, §20.8). **계좌번호** Property.bankAccount 신설 → 환경설정 입력 → 영수증 납부방법('계좌이체 · {계좌}') 자동. **비고** 기본='다음 납부 예정일 {nextDue}'(추천값). **납부 대상월**='YYYY년 M월분', **거주기간**=1달 선납 주기. 부제(외국인등록증) 제거. 모든 칸 편집 가능. 폰트는 Pretendard 정적TTF 미가용(LFS)이라 §20.1 폴백 나눔고딕 유지. 로컬 qlmanage 렌더 검증. **SQL**: `ALTER TABLE properties ADD COLUMN "bankAccount" TEXT;`

## 2026-06-16 — 지출 방배정 묶기·비품자재·월세영수증 (①②③)
**① 지출 방별 분배 묶기 + 호실 품목명 [SQL: expenses.allocationGroupId UUID]**: 한 품목을 방별로 나눠 등록하면 목록 행이 쪼개지던 것을, 저장 시 분배 행에 공통 allocationGroupId 부여 → 목록에서 한 줄(금액합산·'방 N개'·방목록)로 묶고 누르면 방별 펼침 모달(개별 수정). DB 행은 그대로라 방별 지출·집계 동일. 호실 상세 '이 방에 든 지출'에 품목명(detail/itemLabel) 표시.
**② 비품·자재 탭(/inventory/assets) [SQL 불필요]**: 소모품 재고와 별개로 내구재(소모품 카테고리·배송비 제외 품목 지출)를 방별/미배정(여분)으로. 미배정에 '방 배정' 버튼 → Expense.roomId 설정(그 호실 지출로 이동, Req4). 재고관리 헤더에 진입 버튼.
**③ 월세 영수증(외국인등록증 신청용) [SQL: rent_receipt_files 테이블]**: 자체 양식 pdf-lib 직접 그림(buildRentReceiptPdf — 제목·발행일·표[이름(호실)·거주기간·금액·수령인 이름/서명·연락처]·도장). 실거주 확인서 구조 미러: /rent-receipt/[tenantId] 작성(standalone+layout 호스트), /api/rent-receipt/generate(Drive+preview), /rent-receipts 목록(거주중 선택+이력), RentReceiptFile 모델. 사이드바 '관련 서류'에 추가 + 입주자 모달 + **수납관리(payment 모달) 푸터**에 '월세 영수증 발급' 버튼. 로컬 qlmanage 렌더 검증 완료.

## 2026-06-15 — 사용자 요청 6건: 호실저장 토스트·재고보충·지출 [SQL 불필요]
호실 수정 저장 글리치 + 재고 보충 UX 재설계 + 지출 3건.
- **#1 호실 수정 저장(RoomManageClient)**: 저장 후 토스트(초록) 안 뜨고 메인→수정팝업 되돌아오던 글리치. 원인=`window.location.reload()` 전체 새로고침이 ⓐ pushToast 직후 토스트를 날리고 ⓑ ref(handledOpenRef) 초기화로 URL `?roomId&edit=1` 가 effect 재오픈을 유발. 해결=soft `router.refresh()` 로 교체(토스트 유지·ref 보존→재오픈 차단). handleAdd 도 동일 교체.
- **#2 재고 현재 잔량 빈칸(InventoryClient)**: 위치별 점검(LocationBatchCheckModal)도 현재 잔량(보충 전) 직전값 prefill 제거 → 빈칸 시작(CheckForm 과 통일). 미리 채운 값 수정 번거로움 해소.
- **#3 '직전값 유지'→'보충 없음' 재설계**: 기존 버튼이 보충 전·후 **모두** 직전값으로 덮어써 사용자가 센(소모된) 값이 사라지던 문제. 의미 정정="추가 보충 없이 센 값 그대로 확정" → 보충 후=현재 잔량(센 값 보존), 현재 잔량 비었을 때만 직전값으로 채움. 버튼 위치=품명 우측→입력칸 아래로, 명칭='보충 없음'. CheckForm·LocationBatch·아이템편집폼 3곳 통일. 저장 로직: 현재 잔량만 입력해도 저장(finalN=후 ?? 전, entered=전||후), 보충 후만 입력 시 직전 잔량 기준 보충량 산출(허브 미차감 방지).
- **#4 지출 품목명 자동완성(FinanceClient·actions)**: 구매처처럼 과거 이력 datalist. `getExpenseDetailSuggestions` 를 합성 detail→깔끔한 `Expense.itemLabel` distinct(최신순)로 변경, ItemSelector '직접 입력' 품목명 input 에 연결. 미사용이던 detailSuggestions prop 활용.
- **#5 합배송 배송비 자동 정산완료 버그(actions)**: 카드결제인데 배송비만 정산완료되던 문제. 원인=배송비 settleStatus 가 결제수단 무시하고 배송구분(선불/착불/신용)만 봄. 수정=`payMethod==='신용카드' || 배송구분==='신용' → 미정산`. createExpense(주문모드)·attachShippingToOrder(사후묶기, 대표지출 payMethod 기준) 2곳. updateExpense 는 기존 보존 로직 유지(수동 정산취소 안 뒤집힘).
- **#6 '임박하지 않은 고정' 줄 간격(FinanceClient)**: 토글 줄 `-mb-1`(음수 마진)이 아래 내역 카드를 끌어올려 겹침 → 제거, space-y-4 기본 1rem 간격 복원.
**검증**: 변경 파일 tsc 통과(잔여 에러는 iCloud `.next/types/… 3.ts` 중복뿐). SQL 불필요.

### 후속 — 지출 품목 수량 미입력 시 "x N개" 누락 (사용자 보고)
- 증상: 품목명을 '직접 입력'으로 다시 넣으며 수량 칸을 비우면 detail 이 `[라벨]`(x N개 없음)로 저장돼 목록에서 수량 표시 사라짐. (에러 아님 — 금액·분류는 정상, 표시만 누락)
- 결정(사용자=A): **수량 미입력 품목은 자동 1개**로 채움. confirmAdd 에서 수량 비면 `1`/단위 비면 `개`, 수정폼 로드 시도 동일 규칙(qtyValue null → '1', 단위 null → '개')으로 재저장 시 "x 1개" 일관 표기. 기존 누락 행은 한 번 재저장하면 정상화.

## 2026-06-14 (이어서) — 후속 수정 5건 [전부 배포, SQL 불필요]
- **인트로 로고 획 두 번 그어짐(`171db30`)**: 콜드부트 시 SplashStatic(loading.tsx, SSR)이 1회 + 하이드레이션 후 SplashIntro 가 1회 → 두 번. 정적 스플래시가 파싱 시점 인라인스크립트로 `window.__sySplashStatic` 플래그 설정, SplashIntro `skipDraw` prop(=플래그)이면 재드로잉·EN 재등장 생략하고 이어받아 EN→KO 만. no-suspend 경로(정적 미표시)는 정상 1회.
- **재고 보충 입력 개선(`a56433f`)**: 현재 잔량(보충 전) 빈칸 기본 시작(미리 채운 값 수정 번거로움 해소). '직전값 유지'=현재 잔량·보충 후 모두 직전값으로 채움. 안전망: 보충 후만 입력+현재 잔량 빈칸이면 직전 잔량 기준 보충량 산출(허브 미차감·총량 변동 버그 방지). §19 페어 토큰 `--tc-text`(라이트 #A03C2E·다크 #C9614C) 신설→유지버튼 다크 저대비 해소.
- **로고 설정 개편(`6e00231`)**: 순서·중요도 교체(영업장 로고=앱·원형 먼저, 계약서용 로고=투명 나중). 명칭 정리('앱 로고'→'영업장 로고', 기존 영업장 로고→'계약서용 로고'). 설명 수정(투명=계약서 전용). 신규 [ImageCropModal](components/ui/ImageCropModal.tsx) — 인스타·페북식 원형 크롭(드래그 위치·슬라이더/휠/핀치 확대축소·원형 마스크 미리보기→정사각 512 PNG).
- **방문 분석 유니크 방문자 카드 다크(`879fff7`)**: --ink-2 배경이 다크에서 크림으로 뒤집혀 sand 글자 대비 붕괴 → 페어 토큰 --np-card-bg 로 교체(라이트 불변·다크만 d-card).
- (앞서) #7 앱 로고·#4 섹션 체류시간 SQL 2건 적용 후 배포 완료.

## 2026-06-14 — 사용자 요청 7건: 방문분석 개편·재고보충 UX·앱로고·섹션체류 [배포 완료, SQL 2건 적용됨]
사용자 7개 요청. 조사(Explore 3병렬) 후 결정: 마케팅="방문 분석"(공개 안내페이지 방문자 분석, PageView 테이블 자체수집), 차트색·dotColor 제외, 양도인은 별개. AskUser 4결정: 메뉴명=방문 분석, 앱로고=1개(헤더 원형크롭), #4=섹션 전체구현, #6=2칸+참고줄.
**SQL-불필요 (즉시 배포)**:
- #1·2·3·5 방문 분석(`dbb0f25`): 메뉴 '마케팅'→'방문 분석' · 특정 날짜 DatePicker(그날 0~24시, gte/lt) · 도시에 상위 시·도 병행(region ISO 3166-2→한국시도명, 예 suseong-gu·대구) · 추이·시간대 차트 막대 **탭-툴팁**(모바일 대응, hover 유지).
- #6 재고 보충(`2fce5e5`): 2칸(현재잔량/보충후) 유지 + 입력 중에도 '직전 잔량·지난 보충+N·이번 보충+N' **참고줄 상시표시**(작은 우측텍스트→틴트 줄 승격). prevRestockedMap 노출, CheckForm·LocationBatchCheckModal 양쪽.
**SQL-필요 (적용 후 배포)**:
- #7 앱 로고(`9f2df49`): `Property.appLogoDriveFileId`(배경 있는 일반 로고, 기존 투명·계약서용과 별개). 설정 업로드(원형 미리보기) + 헤더 영업장명 앞·스위처 목록 원형. layout.tsx properties 에 appLogoUrl 동봉. **SQL**: `ALTER TABLE properties ADD COLUMN "appLogoDriveFileId" TEXT;`
- #4 섹션 체류시간(`ebe6e67`): `PageView.sectionDwellMs Json`. 공개페이지 추적스크립트가 1초마다 뷰포트 중앙 섹션에 적립(탭숨김·공백 제외)→closeup 동봉. 섹션=기존 `<section id>`. closeup API 검증(키 화이트리스트·max20·0~24h). 방문분석에 '섹션별 평균 체류시간' 패널(1위 🏆). **SQL**: `ALTER TABLE page_views ADD COLUMN "sectionDwellMs" JSONB;` · ⚠️과거 소급 불가, 지금부터 데이터 쌓임.
**검증**: 전 항목 tsc·build 통과, 4커밋 배포 Ready, 공개페이지 섹션스크립트 반영 확인(캐시우회), 로그인 200.


## 2026-06-13 (이어서) — §14.4 무지개색 디톡스 (Claude Design 핸드오프 반영) [⚠️ 로컬 커밋, 미푸시 — 시각 검토 후 배포]
Claude Design `claude-code-handoff-semantic-colors.md` + 가이드 §14.4 정본 반영. raw Tailwind 무지개 ~604건 + 인라인 hex/rgba ~40건을 의미 토큰으로 일괄 치환.
**커밋 6개**: ① §1 토큰 선언+별칭(`a8e7b23`) — danger/success/warning/info/deposit/reserve/overdue/neutral 의 fg/bg/ring/solid 를 :root+html.dark 선언, status/badge/accent 별칭 재배선. solid 는 양모드 깊은값 고정(다크 흰글자 대비 붕괴 차단). ② red→danger(`139866c`) ③ amber→warning, **양도인→info**(`76ab883`) ④ green→success(`c423414`) ⑤ blue→info·purple→deposit·teal→reserve·gray→neutral(`4000617`) ⑥ 인라인 hex/rgba(`ec4cbcc`).
**판단 기록**: ⒜ 차트(StatsClient·dashboard/page.tsx)·ReportClient 팔레트 배열은 §14 viz 소관 → **제외**. ⒝ 양도인 record 마커는 §14.4 결정#5대로 info(블루), 양도인 정산 **버튼**은 caution 액션이라 warning 유지. ⒞ 솔리드 삭제버튼 → soft(danger). 솔리드 액션버튼 → -solid+cream. ⒟ accent-deposit 보라→카멜·reserve teal→토프(라이트값도 교체, 결정#4). ⒠ gray 음영별 warm 매핑. ⒡ Google 로그인 버튼·dashboard alert dotColor(hexToRgba JS소비)·DatePicker 주말색은 정당 제외/유지.
**버그·교훈**: perl `(?:50|100|200)`에 `\b` 누락 → `bg-purple-500`의 `50` 부분매칭으로 `]0` 손상 4건 발생, 전수검색으로 즉시 정정. 클래스 sed는 **항상 `\d{2,3}` 전체매칭 또는 `\b`** 사용할 것.
**Acceptance**: in-scope 무지개 0(클래스·인라인 모두), solid 양모드 동일 확인, build·tsc 통과. ⚠️ **미푸시** — 앱 전역 시각 변경(빨강→테라코타·보라→카멜 등)이라 사용자 시각 검토 후 배포 예정. 잔여 viz 팔레트(차트·dotColor) 토큰화는 별도 §14 작업.

## 2026-06-13 (이어서) — §14.1 raw hex "안전·확실" 분석 + Badge 올리브 토큰화 [배포, SQL 불필요]
**방법**: hex→토큰 치환을 **그 토큰이 다크에서 재정의되지 않는 경우(= 양쪽 모드 픽셀 동일)에만** 적용 — 회귀가 구조적으로 불가능한 집합만.
**핵심 발견 — §14.1 백로그는 대부분 허수였음**: raw hex 275곳을 분석하니 ⓐ **브랜드색 hex는 이미 `var(--persimmon, #a03c2e)` 폴백 문법**으로 토큰화돼 있음(#a03c2e 10·#7c2d26 1 전부 폴백) ⓑ 나머지 대량은 **Tailwind 무지개색**(#ef4444 빨강·#22c55e 초록·#3b82f6 파랑·#a855f7 보라) — 브랜드엔 대응색이 없어(danger=테라코타≠빨강) 토큰화=색 변경=**디자인 판단** ⓒ 차트 팔레트(StatsClient·dashboard 차트 → viz 시맨틱) ⓓ 정당한 리터럴(계약서 인쇄·OLED 트루블랙). → **"안전·확실"로 고칠 진짜 raw hex는 Badge.tsx 올리브 `#7a9a52` 3곳뿐**, `--viz-3`(다크 미재정의)으로 픽셀 동일 치환. 다크 함정 주의: `--success`/`--status-paid-*`는 다크에서 `--d-success`(#A3BF7B 밝은올리브)로 뒤집혀 흰 글자 대비 붕괴 → 그 토큰들은 의도적으로 미사용, viz-3 선택.
**결론**: §14.1 "raw hex ~190곳" 항목은 **사실상 종료** — 안전 치환분 소진, 잔여는 디자인 결정(무지개 디톡스) 또는 정당 리터럴. 무지개 디톡스는 Claude Design 팔레트 확정 후 별도 진행 권장.

## 2026-06-13 (이어서) — §13.2 dirty 정책 + 수제 모달 공용 Modal 이주 (`f79d2af`~) [배포, SQL 불필요]
**공용 Modal `dirty` prop 신설**: true 면 배경클릭 무시 + Esc·X 는 "작성 중인 내용이 있습니다. 닫을까요?" 확인 1회(확인 중 Esc 연타 중첩 가드). §13.2 입력 유실 방지를 모든 모달이 공유.
**이주 완료 17개**: 트랜치1(`f79d2af`) — 체크리스트 추가·편집·점검(2), 경쟁업체 폼(1, raw z-50 교정), 데이터 가져오기 충돌·결과·내보내기(3), 상태전환 미니폼·퇴실정산(2, z-confirm 오용·z-310 raw 교정), AI 도면 인식(1). 2a 대시보드(`(미커밋→포함)`) — 보증금환불·알림상세·고정지출·수납관리·입주자빠른정보(6). 2b 재고 병합확인(1). 폼 모달엔 초기값 대비 dirty 산출.
**의도적 제외(이주 안 함, 사유 명시)**: ⒜ 모바일 바텀시트(`items-end sm:items-center`+`rounded-t-2xl`) — 재고 점검·보정 입력 시트, finance 일부. 공용 Modal(중앙정렬)로 옮기면 모바일 슬라이드업 UX 손실 → 패턴 자체가 다름. ⒝ 라이트박스(`z-lightbox bg-black/90`) — 사진·영수증 전체화면 뷰어. ⒞ **Finance/Tenant 대형 view/edit 복합 폼**(지출 상세·수정 415·528줄, 수납 관리 973줄 등) — 푸터가 모드 분기 안에 고정돼 공용 Modal 흡수 시 레이아웃 재작업 필요. **이미 z 토큰 사용(§12 충족)이라 기계적 흡수는 재작업 원칙 위반 → 보류**. ⒟ 드롭다운 백드롭(`z-10`/`z-40`/`z-[60]`) — 모달 아님.
**잔여(이어서)**: raw button 439곳→Btn · §15 금액 유틸 단일화 · §14.1 raw hex 토큰화(Fable 5 활성화 후 — 디자인 판단 동반).

## 2026-06-13 — 수령대기 배지 버그 + UI/UX 백로그 1차 소진 (`2c90ba0`~) [배포, SQL 불필요]
**① 수령대기 배지 버그 (`2c90ba0`)**: 세탁조크리너처럼 **수량 미입력 구매**(qtyValue·qtyUnit null)가 알림엔 뜨는데 재고 배지·타임라인·일괄확인엔 안 보이던 불일치. 원인 = overview allPending 의 `qtyValue>0` 필터 + 단위 엄격 일치. 수령 대기 판정을 알림과 동일 기준(라벨+카테고리, 단위는 양쪽 있을 때만 비교)으로 통일, 수량 0 구매는 타임라인 '수량 미기록' 표시. 소모량·단가 수학의 qtyValue 필터는 유지.
**② 백로그 소진 (효율 순서 = 재작업 없음 원칙: 구조 변경이 hex·문구 사용처를 소거하므로 스타일 패스는 맨 뒤)**:
- 퀵윈(`511342c`): BrandLoader.tsx 죽은 코드 삭제 · 대시보드 미수납 7일+ 칩 raw `#fff`(순백 §19 위반) → `--badge-overdue` 토큰 + '연체 D+N' 표기(§14.2 호실 탭과 통일).
- **confirm() 전량 전환 완결**(`25f57b7`): 잔여 62곳/16파일 → confirmDialog. 위험도 분류(기록·전환=normal/되돌리기 가능=caution/영구 삭제=danger), 라벨 동사화, 제목=질문·본문=결과. 영수증 스캔 분기는 confirmLabel/cancelLabel 선택지로. **app/contract 레이아웃(셸 밖)에 ConfirmHost 직접 마운트** — 셸 밖 신규 화면은 이 마운트 필요. 네이티브 confirm() 0건.
- §10 적용취소 완결(`6420392`): '병합 해제'·'다시 포함' → '적용취소' 용어 통일 + 구매 재고 제외 직후 토스트에 적용취소 액션(§10-1 즉시 회수).
**잔여 백로그(다음 세션, 순서 고정)**: ① 수제 모달 17파일 → 공용 Modal 흡수 + §13.2 dirty prop 동시 설계(모달 먼저 하면 dirty 재작업 없음) ② raw button 439곳 → Btn ③ §15 금액 유틸 단일화 ④ §14.1 raw hex ~190곳 토큰화(①②가 사용처 자동 소거 후 잔여분만) ⑤ 라이트모드 당월매출 -N%(coral solid 위 --viz-4, 대비≈1.6:1) — Claude Design 결정 대기(의뢰 프롬프트 전달됨).

## 2026-06-12 (이어서) — 브랜드 v1.3.3 정정: 다크모드 트루 블랙 [배포, SQL 불필요]
Claude Design 정정 반영. 교체값 4종 — --d-page #2A1A10→**#000000**(OLED 절전·번인), --cold-bg-dark #2A1A10→#000000(FOUC 인라인 CSS·theme-color 다크 메타 포함), --d-card #36251A→**#1A130E**(웜 니어블랙), --d-card-2 #412E20→#261C14. 적용 파일: globals.css(토큰+주석), layout.tsx(인라인 FOUC+themeColor), 스플래시 3종(SplashScreen/SplashStatic/SplashIntro 의 var() 폴백), docs/brand-guide-v1.3.md(§18.2·§18.4·§19 동기화). 원칙 변경: 순흑 금지는 **다크 페이지 배경에 한해 해제**, 순백 텍스트는 여전히 금지(--d-ink 유지). 구 hex 전수 검색 0건 확인(워크로그 과거 기록 2줄은 역사 보존 차원에서 유지 — 이 항목이 정정을 명시). 다크 페어 토큰(--np-* 등)은 --d-* 참조라 자동 반영.

## 2026-06-12 (이어서) — 세탁조크리너 수령대기 알림 해소(데이터) + 계약서 탭 거주중/퇴실 필터 [배포, SQL 불필요]
**① 수령대기 알림 재발 (버그 아님, 데이터)**: 5/31 코스트코 세탁조크리너 12,990원 Expense 가 `receivedAt=null`(수령 미확정)로 남아 있었음. 알림은 설계상 "해소될 때까지 매일" + 벨 클릭 읽음은 '오늘만 숨김'(localStorage per-day)이라 매일 재등장한 것. 수령 확정 UI 는 재고관리 품목 행("N건 수령대기" 배지 → 수령 확인)에 있는데 알림이 /inventory 로만 보내 발견 못 함. **조치**: receivedAt = 구매일(5/31)로 직접 채움 — 6/8 점검(잔량 3) 기준선 이전이라 잔량 이중계산 없음. 되돌리기: `UPDATE "Expense" SET "receivedAt" = NULL WHERE id = 'fe71f7c2-fcd6-4b0e-a578-549c520d95b6';`
**② 계약서 탭 거주중/퇴실 구분**: [ContractsClient](app/(app)/contracts/ContractsClient.tsx) 에 거주 상태 SegmentedControl 추가(거주중·퇴실·전체, 기본 **거주중**). 퇴실 그룹 = CHECKED_OUT+CANCELLED, 연결 계약 없는 파일(status null)은 거주중 쪽. 부제에 거주중/퇴실 건수 표기. 적용취소 = '전체' 선택.

## 2026-06-12 (이어서) — v1.3 §19 다크모드 가독성 (`6136217`) [배포, SQL 불필요]
Claude Design 지시서 반영. ① html.dark 전면 재작성 — 웜 브라운 §19 팔레트(--d-page #2A1A10 = §18 정합, 구 near-black 퇴출), 기존 alias 재매핑으로 다크 전 화면 적용 ② 상태 5단계 다크 변형(OVERDUE solid 배지는 --tc+cream 유지) ③ 적발 6건 — 핵심은 현재 순이익 위젯이 --ink 를 배경으로 써서 다크에서 크림 카드로 뒤집히던 것 → 페어 토큰(--np-*, 라이트=현행/다크=§19)으로 교정, 좌측 3px 팁은 inset shadow(라이트 레이아웃 불변) ④ 보고 2건: 라이트모드 당월매출 -N% 도 동일 저대비(픽셀 불변 원칙으로 미수정 — 디자인 결정 필요) · 모드 공용 raw hex ~190곳/25파일은 §14.1 백로그(다크 분기 아님)로 분류.

## 2026-06-11 (이어서) — v1.3.1 §18 콜드 스타트 로딩 체계 반영 (`a24f90f`) + 재고 carry-over 입수 증발 버그 (`c79e18c`) [둘 다 배포, SQL 불필요]
**§3b 인트로 실기기 디버깅 5건(2026-06-12, `e64b04d`~`9751b12`)**: 사용자 실기기 보고 기반 연쇄 수정. ① 인트로 미발동 — loading.tsx 가 suspend 없으면 안 떠서 Gate 신호만으론 영영 안 뜸 → Host 하이드레이션 자가 발동(`e64b04d`) ② 껌뻑임·말미 컨투어 잔상 — loading.tsx 의 구형 루프 스플래시 직접 렌더 + 리디렉트 체인 홉 사이 신호 단절 → 표시 주체 Host 단일화 + OFF_GRACE 400ms 갭 연결(`fa87d25`) ③ SSR 대기 빈 다크 화면 회귀 → 서버 렌더 SplashStatic 복원(`8cdbfa7`) ④ OAuth 복귀 구간 '과거 로고'(가는 컨투어 루프) → 일반 스플래시를 정적 락업으로(`270fa4e`) → 모션 0 피드백 → **전 스플래시 1회성 드로잉→락업**(인트로 첫 1.4s 와 동일 모션, 루프 잔상 구조적 불가)(`4a40ece`) ⑤ 앱 껐다 재접속 시 인트로 미재생 — iOS 가 sessionStorage 를 세션째 복원 → **활동 공백 게이트**(localStorage 하트비트, 공백>10s=재접속 재생, 새로고침~2s=생략, OAuth 는 마커 제외)(`9751b12`). ⑦ 컨투어의 최종 원인 — 가이드의 draw 는 외곽선(ARCH_PATH)이 아니라 **중심선 한 획+stroke 20**: 레퍼런스 'stayeum Splash Intro.html' 이 stayeum Design 폴더(저장소 밖)에 있어 그간 잘못된 패스로 구현했었음. 레퍼런스 그대로 이식(`6989dcd`, pathLength=1·이징·모바일 세로스택), 헤드리스 캡처로 두꺼운 아치 드로잉→EN 락업 일치 확인. 임시 와이프 리빌 폐기. ⑥ 멈춘 듯한 화면·잔류 컨투어의 근본 원인 — '/' 페이지 redirect()가 셸 flush 후라 200+meta-refresh 로 내려가 문서 로드 3번 체인이 되고, 떠나는 문서의 드로잉이 중간 프레임에서 얼어붙은 채 잔류 → proxy(미들웨어)에서 진짜 307 fast-path(`79b8f60`, 프로덕션 curl 로 307 확인). 교훈: 콜드 부트 시각은 ①SSR 스트리밍(서버 CSS-only) ②하이드레이션 후(Host) 두 구간을 모두 설계해야 함.
**§3b 인트로 + v1.3.2 숫자 서체(2026-06-12, `c308b8d`)**: 개정 지시서 반영. ① 신규 [SplashIntro](components/brand/SplashIntro.tsx) — 콜드 부트 1회성 인트로(draw→EN→KO, 3200ms **완주 보장**·세션당 1회 sessionStorage `sy-intro-seen`·대기 연장 시 KO↔EN 교차·모바일 세로 스택·reduced-motion 정적 락업). 표시 지연/최소 유지 규칙은 인트로에 미적용(유일 예외). ② **DM Mono 제품 UI 전면 제거**(웹폰트 로드 삭제) — `.num` 유틸(tnum) 신설, `.mono`·`--font-mono`는 Pretendard 재매핑, font-mono 클래스 전수 교체. ⚠️ **레퍼런스 'stayeum Splash Intro.html' 리포에 미존재**(지시서엔 제공이라 명시) — 아치 마크업은 기존 ARCH_PATH 재사용, 타이밍·시퀀스는 §3b 표 그대로. 파일 받으면 마크업만 교체.
**§18 완결(2026-06-12, `e547a03`+`f292856`)**: 작업 지시서 수령 → 보류 2건 해소. ① 신규 [SplashController](components/brand/SplashController.tsx)(Gate/Host 분리) — loading.tsx 즉시 언마운트 한계를 우회해 **최소 유지 1000ms + 400ms 크로스페이드**(빈 화면 프레임 없음) 구현 ② 소셜(Google) 리디렉트 대기 스플래시 + 인증 실패 인라인 에러(이전엔 console 만) ③ prefers-reduced-motion 전역 규칙(v1.2 §08 규정인데 미구현이었음 — 발견·보강) ④ 스플래시 마크 높이 §18.2 스펙(48px)으로(lg arch 120→65). acceptance 전 항목 충족.
**§18 (Claude Design 추보 수령 → [docs/brand-guide-v1.3.md](docs/brand-guide-v1.3.md)에 §18 추가)**: 판정 기준 "셸이 살아있으면 스켈레톤, 없으면 브랜드 로더 — 동시 금지". ① AppShell 의 라우트 전환 브랜드 로더 오버레이(PageLoadingOverlay) **폐지**(이중 발동 제거) ② 스플래시 §18.2 스펙(배경 --cold-bg=page·다크 #2A1A10·-8% 시각중심·5s 느린연결 캡션·10s 재시도) ③ `.delayed-fallback`(300ms 표시 지연 — 스플래시·스켈레톤) ④ FOUC 인라인 CSS + theme-color 라이트/다크 분기 ⑤ 로그인 버튼 스피너. **보류**: 퇴장 크로스페이드 400ms·최소 유지 1000ms(전환 오케스트레이션 필요), 소셜 리디렉트 스플래시.
**재고 버그(사용자 발견, 쌀 +30kg 증발)**: 위치별/부분 점검 carry-over 가 미실측 위치를 '직전 점검 값 그대로' 복사 → 그 사이 무상 입수가 새 기준선에서 증발 + 사용량 계산에선 가짜 소모("2일간 37kg"·소진임박 오경보). additionsSinceCheckByLocation 신설(경계=overview 현재고 계산과 동일), createStockCheck 2경로+updateStockCheck 머지에 반영(실측 위치는 실측 우선). 쌀 6/11 점검 교정 적용 완료(창고 43.2→73.2, 총 52.2→82.2, [scripts/fix-rice-0611-check.ts](scripts/fix-rice-0611-check.ts)). 구매는 [수령 자동] 점검이 있어 무관 — 무상 입수만 해당이었음.

## 2026-06-11 (이어서) — 브랜드가이드 v1.3 (인터랙션 확장판) 1차 반영 [SQL 불필요]
Claude Design 의뢰([docs/design-brief-v1.3-request.md](docs/design-brief-v1.3-request.md)) → 결과 가이드 [docs/brand-guide-v1.3.md](docs/brand-guide-v1.3.md) 수령·저장. 마이그레이션 우선순위(§9→§12→§11→§13→§14) 1차 반영. tsc·build 통과.
- **토큰**: globals.css 에 v1.3 전체 토큰 추가 — z 위계 11종(--z-sticky 100~--z-loader 500)·confirm·toast·input·viz-1~8·progress.
- **§9 ConfirmDialog**: 신규 [components/ui/ConfirmDialog.tsx](components/ui/ConfirmDialog.tsx) — 3단계 위험도(normal/caution/danger)·영향 고지형(impact 목록+건수 DM Mono)·임퍼러티브 `confirmDialog()` Promise API(모듈 pub/sub, Provider 불필요)·Esc=취소·취소 초기포커스·배경클릭은 normal만. ConfirmHost 를 AppShell+admin layout 마운트. **전환 완료 8곳**: 호실 삭제·고객 삭제(영향 고지형, confirm 2연타 폐지)·예정가 적용·지출 삭제/기록취소·병합 적용취소·상태전환 확인. **잔여 confirm() ~60곳은 점진 교체** (API 준비됨 — `if (!(await confirmDialog({...}))) return` 패턴).
- **§11 토스트 v2**: saveStatus(4종 success/error/info/urgent + detail/action/duration) + SaveFeedback 재작성 — 하단 중앙 스택(최대 3, 最古 퇴장), 동일 메시지 ×N 카운트, hover 타이머 일시정지, error 수동 닫기 상시, 장문 2줄 구조, [적용취소] 액션 버튼 지원(인프라 — 개별 undo 연결은 점진).
- **§12 z 토큰화**: Modal(200/260/280 prop→토큰 매핑), 수제 모달 z-[200~290] 30+곳, 알림벨 드롭다운(z-50→dropdown), 사이드바 드로어, 라이트박스(room-manage·PhotoStrip), DatePicker(400→lightbox+1), 스플래시(→loader). 페이지 내 z-10~40(표 헤더 등)은 잔존 — DOM 순서 정리 필요해 보류.
- **§13 입력 radius**: `rounded-xl px-3 py-2.5` 입력 시그니처 54곳 → rounded-sm(6px, Tailwind 테마가 이미 6px 오버라이드) — 총 138곳 단일화. **보류**: §13.2 dirty 폼 배경클릭 무시/닫기 확인 정책(공용 Modal dirty prop 설계 필요), 상호배타 체크박스→세그먼트 전환.
- **§14 viz 팔레트**: [lib/chartColors.ts](lib/chartColors.ts) 전면 viz 토큰화(CHART/EXPENSE_CATEGORY/GENDER/STATUS), DashboardClient 자체 hex 21종→토큰(red→--tc, amber→--viz-4, green→--success, slate→--ink-m, purple KPI→--ink 등), NotificationBell 카테고리 점 색 토큰화. '#1e40af'(AWAIT 상태값)·'#fff'(흰 텍스트)만 의도적 잔존.
- **§10 용어**: '병합 해제'→'적용취소' 1곳 적용. **보류 목록**: ① confirm() 잔여 ~60곳 ② 수제 모달 17파일 공용 Modal 흡수 ③ §10 적용취소 토스트 액션 연결·용어 잔여('해제'/'다시 포함') ④ §14.2 대시보드 OVERDUE(7일+) 단계 ⑤ §15 금액 유틸 단일화(인라인 수백 곳) ⑥ §17 카드/표 매핑 ⑦ raw button 439곳 Btn 전환.

## 2026-06-11 — 전수 점검(43건 확정) 후 충돌·혼란 수정 6단계 일괄 [코드 완료·로컬 커밋, ⚠️미푸시·SQL 불필요]
**점검**: 멀티에이전트 감사(8개 차원 → 적대적 검증)로 43건 확정 — 전체 상세 [docs/audit-ux-conflicts-2026-06-11.md](docs/audit-ux-conflicts-2026-06-11.md). 재작업 방지 순서(헬퍼 추출→쓰기 측→폼 통합→표시층)로 수정.
**커밋 6개**: `8ef6705`(청구) `89d5323`(퇴실정산) `c517382`(배송비) `38294ed`(재고) `040fb5b`(삭제안전망·라벨) `e289e69`(모달·네비). 전부 tsc·build 통과. **스키마 변경 없음 — SQL 불필요, 바로 배포 가능.**
- **청구 코어(`8ef6705`)**: 신규 [lib/billing.ts](lib/billing.ts) — 일할→락인→할인 우선순위·퇴실월 컷·checkoutNoBilling·만기 환산을 단일 헬퍼로. rooms·dashboard page·unpaid.ts 3엔진 + **쓰기 경로**(savePayment가 클라 원금 대신 서버 계산 청구액을 락인 — 할인 입주자 영구 미납 버그 근본 수정) + updatePayment/deletePayment/보증금 초과분 재계산 동일 규칙. 수납 CRUD에 revalidatePath 추가. 시작월 2000-01 폭주 → viewMonth 폴백.
  ✅ **과거 데이터 교정 완료(2026-06-11, 사용자 확인)**: 421호 이종현 — 약정은 '2달치 일괄 납입 시 월 1만 할인'(사용자 확인). 실데이터 까보니 ① 같은 할인(1만, 4~5월)이 **중복 등록**(5/31+6/7)돼 엔진이 2만 할인으로 오계산 ② 6/7에 옛 락인 버그(원금 43만)가 미납 2만을 만들어 1만+1만 추가 수납됨. 조치: 중복 할인 1건 삭제(id 45e033eb, 6/7 생성분) + 4·5월 record expected 43만→**42만** 교정([scripts/fix-discount-locked-expected.ts](scripts/fix-discount-locked-expected.ts) --apply). 결과: 4·5월 청구 42만·납부 43만 = **이월 선납 +2만** → 7월 청구에서 자동 상쇄(41만 받으면 완납). 되돌리기: 할인 재등록(1만, 04~05) + record 2건(4월#2·5월#2) expected 420000→430000.
- **퇴실 정산 일원화(`89d5323`)**: prorationDataForChange 헬퍼 — updateTenant 폼/전환 버튼/changeDueDay 모두 퇴실일·납부일 변경 시 적용된 정산을 **재계산**(불가하면 해제+notice 토스트). 거주중 복귀 시 정리 동일화. 적용취소는 적용 후 수동 수정 감지(undo.applied*) 시 일할만 제거. 교차월 퇴실 오류문구 명확화(그 달 자동 0원).
- **배송비(`c517382`)**: 신규 폼필드 shippingIncluded — '품목 2개+ + 배송비 포함' 항상 저장 실패 버그 근본 수정(다중 품목은 배송비 별도 행으로 분리 → 단가 왜곡 제거). 수정 프리필이 detail의 '배송비 N원' 복원(이중 합산·표기 소실 해소). isShipping 라인 수정 가드(오류+반쪽 저장·settleStatus 뒤집힘 방지). **신규 detachShippingFromOrder**(묶기 해제=적용취소) + deleteExpense 주문 고아 정리. 등록 폼을 수정 폼과 동일한 단일 배송비 섹션으로 통일(기본 선불).
- **재고(`38294ed`)**: 점검 폼 명시적 0 입력이 carryOver로 되살아나던 버그(entered 플래그). CheckEditForm 빈 보충전→허브 전액 차감(생성 폼과 null-규칙 통일). dedupSameDay가 같은 날 전체 보정을 무효화(승계). 6h 자동 머지가 과거 점검일(백필) 무시(머지 제외). 단위 변환 시 단위 없는 영수증 경고. 병합 해제 confirm에 위치 유실 경고. **신규 includeExpenseInInventory**(재고 제외 적용취소+버튼). '/expenses' revalidate 오타→'/finance'.
- **삭제 안전망·라벨(`040fb5b`)**: deleteRoom/deleteTenant — 이력 있으면 계약·수납 건수 보여주는 **2차 동의(force) 후에만** 영구 삭제. batchUpdateRooms가 협의 임대료 덮어쓰지 않음(기준가 동일 계약만 동기화+건너뜀 안내). room-manage edit=1 handledOpenRef 가드(재오픈 레이스). RESERVED 라벨 '예약' 통일(호실관리·대시보드 4곳). finance 보증금 탭 합계를 대시보드 기준(ACTIVE·CHECKOUT_PENDING)으로. '월세 수납됨'→'월 이용료 수납됨'.
- **모달·네비(`e289e69`)**: 알림벨 같은 페이지 무반응(push+refresh). 페이지 이동 시 전역 모달 정리(뒤로가기 잔존·스크롤 점프). openCheckoutProration 시드 1회성. 공용 Modal Esc 닫기(중첩 시 최상단만). useUrlState 스테일 params 레이스. accrual-check 귀속월 이동 revalidate.
- **보류(다음 작업 후보)**: ① [미납][퇴실 예정] 2뱃지 C안을 호실관리·대시보드 방현황에 확산(수납 상태 데이터 파이프 필요) ② 대시보드 상태색 hex → StatusBadge 토큰 통일(차트 연동 검토) ③ 이종현 락인 교정 실행 여부 ④ 감사 보고서의 나머지 low 항목.

## 2026-06-10 (이어서) — 모바일 연결(전화/문자/메일) + 서류 공유(파일 첨부) [main 배포, SQL 불필요]
- **#2A 연락처 바로 연결**: 고객 상세 연락처에 전화(tel)/문자(sms)/메일(mailto) 바로가기 버튼([TenantContactInfo](components/entity-modal/widgets/TenantContactInfo.tsx), email prop 추가), 입주자 목록 카드 전화번호 탭→전화.
- **#2B 서류 공유(첨부)**: 저장된 서류 PDF를 모바일 '공유'로 메일/메시지에 **파일 첨부** 전송(자동발송 X). 신규 [api/doc-file](app/api/doc-file/route.ts)(Drive 바이트 같은도메인 스트리밍, 영업장 소유 검증) + [ShareDocButton](components/ui/ShareDocButton.tsx)(navigator.share files, 미지원 시 다운로드 폴백). 계약서 파일 패널·입실료 확인서·실거주 확인서 목록에 '공유' 버튼. (PNG 옵션은 추후 — PDF만)
- tsc·build 통과. (#3 캘린더 연동 다음)

## 2026-06-10 (이어서) — 비품·자재 수령대기 기능 [main 배포, SQL 불필요]
사용자: 비품도 (온라인 주문 등) 수령대기 필요. 모델 `Expense.receivedAt`(null=대기) 이미 있으나 assets 뷰가 무시했음(실데이터 비품 대기 37·완료 47 혼재).
- getDurableItems: `receivedAt` 반영 — **수령 대기(null) 최우선 버킷**으로 분리, 나머지(방/공용부/공용/미배정)는 수령완료만. AssetsData에 `pending`/`pendingTotal`.
- 신규 `setAssetReceived(ids, received)` — 비품은 재고추적 아니라 자동점검 없이 receivedAt만. 
- AssetsClient: 맨 위 '수령 대기' 섹션 + '수령 완료' 버튼. 수령완료 항목엔 '수령대기로'(적용취소). 신규 비품은 기본 수령대기(addExpense가 receivedAt 미설정)→도착 시 완료 처리.
- tsc·build 통과. (#2 모바일 연결·#3 캘린더 연동은 답변 후 진행)

## 2026-06-10 (이어서) — 지출 꾹눌러 다중선택 → 한번에 묶기 + 주문 대표라벨 수량합산 [main 배포, SQL 불필요]
- **다중선택 묶기**: 지출내역 카드/행을 **꾹 누르면(450ms) 선택 모드** 진입·하이라이트, 탭으로 추가 선택(주문/방 묶음 행은 멤버 전체 선택), 하단 바 '한 주문으로 묶기'로 한번에. `mergeExpensesIntoOrder(ids)` 신설(이미 다른 주문이면 가장 오래된 주문 재사용·이동, 비워진 주문은 배송비 라인 이전 후 삭제). 롱프레스 후 클릭 오작동 방지(lpFired 가드). 모바일 카드·데스크톱 행 공통.
- **주문 대표 라벨 수량합산**: 주문별 보기에서 대표 행이 같은 품목 수량 합산('매트리스 커버 x 2개'), 다른 품목 섞이면 '... 외'.
- tsc·build 통과.

## 2026-06-10 (이어서) — 기존 지출 수동 '주문으로 묶기'(배송비 0 허용) [main 배포, SQL 불필요]
사용자: 매트리스커버처럼 같은 주문인데 별개 등록돼 안 묶인 건을 직접 묶고 싶음. 기존 수동묶기는 합배송(배송비>0)뿐이었음.
- `attachShippingToOrder` 배송비 필수(>0) 제거 → **배송비 0이면 배송비 라인 없이 '주문으로만 묶기'**(2건 이상 선택 시). 0 초과면 기존대로 배송비 라인도 생성. 재사용 주문은 0일 때 배송메타 보존.
- 편집 모달 '별도 지출로 묶기' → **'다른 지출과 한 주문으로 묶기'**로 라벨 변경, 배송비 비워두면 묶기만. handleUpdateExp가 editShipSeparate면 amount 0이어도 호출.
- 방법: 지출내역에서 묶을 지출 하나 열기 → '다른 지출과 한 주문으로 묶기' 체크 → 같은 날 형제 목록에서 선택 → (배송비 있으면 입력) 저장. 주문별 보기에서 한 묶음.
- tsc·build 통과.

## 2026-06-10 (이어서) — 보류분 마무리: 공용 자재 + 외부 주문번호(OCR) [⚠️SQL 2건 선적용]
보류했던 2건 구현.
- **#4-2 공용 자재**(SQL: `migrate_expense_common_asset.sql`): `Expense.isCommonAsset`. 비품·자재에 '공용 자재' 섹션(페인트·공구 등 방/공용부 배분 안 함, 미배정과 구분). 미배정/공용자재 행에 '공용 자재로'/'공용 해제' 토글(`setCommonAsset`), 배정 시 자동 해제. 집계 키에 isCommon 포함(공용/일반 분리).
- **#1-외부주문번호**(SQL: `migrate_expense_order_external_no.sql`): `ExpenseOrder.externalOrderNo`. 영수증 OCR(analyzeReceiptWithGemini 프롬프트에 orderNo 추가)이 쿠팡 등 주문번호 추출→지출 등록 폼 '쇼핑몰 주문번호' 칸 자동입력(수동 수정 가능). 앱번호(YYMMDD-NNN)는 묶음 기준, 외부번호는 보조(진위·재주문 참조). 외부번호 입력 시 단일품목도 주문 생성. 주문별 보기/상세/모달에 '쇼핑몰 {번호}' 표기.
- tsc·build 통과. ⚠️ 두 SQL 모두 Supabase 적용 후 배포.

## 2026-06-10 (이어서) — 지출내역 '주문별/아이템별' 보기 토글 [main 배포, SQL 불필요]
사용자 #1 후속 아이디어: 쇼핑몰 주문내역처럼 같은 주문끼리(배송비 포함) 묶어보기 ↔ 아이템별로 보기 토글.
- **토대**: [finance/actions.ts](app/(app)/finance/actions.ts) addExpense — 다품목 구매(multiItems≥2)면 합배송이 아니어도 **ExpenseOrder 자동 생성**(앱 번호 YYMMDD-NNN, genOrderCode)해 모든 라인에 orderId 부여. 단일 품목은 미부여. (외부 쇼핑몰 번호는 추후 OCR 메모 보조 — 미착수)
- **UI**: [FinanceClient.tsx](app/(app)/finance/FinanceClient.tsx) 지출내역 상단 SegmentedControl '아이템별'(기본)/'주문별'(localStorage 기억). 주문별이면 같은 orderId 행을 한 줄로(대표=비배송 최대금액, 금액=배송 포함 합계, '주문 N품목'·주문코드·'배송비 포함' 표기), 주문 없으면 기존 allocationGroup 병합. 클릭 시 groupDetail 모달이 품목/배송비 나열(모달 일반화: 제목 주문코드, 행 라벨 배송비/방/품목).
- 아이템별은 기존 동작 그대로(회귀 없음). 과거 데이터(orderId 없음)는 주문별에서도 개별 표시(신규 구매부터 묶임). tsc·build 통과.

## 2026-06-10 (이어서) — 지출 유형 토글(물품/서비스·무형) [main 배포, SQL 불필요]
- **#2**: 지출 등록 폼에 '유형' 토글 — **물품 구매**(기본, 품목 필수 → 재고/비품 누락 방지) ↔ **서비스·무형**(시공·인건비 등, 품목 없이 금액만). 서비스 선택 시 품목·배송비 섹션 숨김+초기화. 물품인데 품목 0개면 저장 차단(안내). [FinanceClient.tsx](app/(app)/finance/FinanceClient.tsx) handleAddExp 검증 + addIsService 상태.
- 논의 정리: **#4** 페인트류=공용 자재로 **방 배분 안 함**(운영자가 비품·자재 화면에서 미배정/공용부로 둠 — 자동판정·전용 플래그 없음, 기존 기능으로 충분). **#1 후속(아이디어)**: 지출내역 '주문별 묶음/아이템별' 보기 토글 + 주문번호 — 기존 ExpenseOrder(앱생성 YYMMDD-NNN) 재사용 권장, 외부 쇼핑몰 주문번호는 OCR로 메모 보조. (미착수)

## 2026-06-10 (이어서) — 비품 동일품목 합산 표시 + 규격없음 단위 디폴트 [main 배포, SQL 불필요]
- **#1 동일 품목 합산**: 비품·자재에서 같은 품목이 별개 구매로 각각(예: 매트리스커버 1개×2줄) 뜨던 것 → 각 버킷(미배정/방/공용부) 안에서 **라벨·규격·단위·카테고리 동일하면 한 줄로 합산**(수량·금액 합계, '구매 N건 합산' 표기). **장부(Expense)는 개별 구매 기록 그대로 — 화면만 집계**(서로 다른 날짜·단가 보존). [assets/actions.ts](app/(app)/inventory/assets/actions.ts) `aggregateAssets`, AssetItem 에 `ids[]`·`count`.
  - 배정 액션 통합 `assignAggregateToTarget(expenseIds, target, qty)`: 묶음에 분배(수량 큰 행부터 통째 소진, 마지막만 분할). 해제(none)=묶음 전체 미배정 + 분할 재병합. (기존 단일 assignExpenseToTarget/PartialToTarget 대체)
- **#3 규격없음 단위 디폴트**: 지출 등록서 '규격 없음' 체크 시 수량 단위가 비어있으면 **'개'** 자동(여전히 수정 가능). [FinanceClient.tsx](app/(app)/finance/FinanceClient.tsx).
- tsc·build 통과. (#2 품목 필수·무형 처리, #4 페인트/장판 분배는 논의 후 진행)

## 2026-06-10 (이어서) — 비품 배정에 공용부(위치) 추가 [코드 완료, ⚠️SQL 선적용 후 배포]
사용자: 비품을 방뿐 아니라 공용부(4·5층 주방·공용화장실·복도 등)에도 배정해야 함. 공용부는 재고관리>위치 관리(StorageLocation)에 이미 있으니 활용.
- **⚠️ 배포 전 필수**: `prisma/migrate_expense_assigned_location.sql` Supabase 실행(없으면 getDurableItems 의 assignedLocation select 런타임 에러).
- **스키마**: `Expense.assignedLocationId`(FK StorageLocation, onDelete SetNull, roomId와 상호배타). 관계 충돌로 receivedLocation 관계에 이름 부여(`ExpenseReceivedLocation`) + 신규 `ExpenseAssignedLocation`. StorageLocation 역관계 2개.
- **액션 일반화** [assets/actions.ts](app/(app)/inventory/assets/actions.ts): `assignExpenseToRoom`/`...PartialToRoom` → `assignExpenseToTarget`/`assignExpensePartialToTarget`(target = none|room|location). `getDurableItems` 가 방·공용부·미배정 3그룹 반환. 신규 `getAssignableLocations`(위치 중 허브=창고 제외 = 공용부). mergeUnassignedGroup 미배정 조건 = roomId·assignedLocationId 모두 null.
- **UI** [AssetsClient.tsx](app/(app)/inventory/assets/AssetsClient.tsx): 배정 select 를 optgroup(방 / 공용부)로. 공용부별 섹션 표시. 수량 분할·재병합(적용취소)은 방·공용부 동일.
- 공용부 등록은 기존 '위치 관리' 재사용(신규 UI 없음). tsc·build 통과.

## 2026-06-10 — 비품·자재 방배정 수량 분할 [main 배포, SQL 불필요]
사용자: 비품·자재(assets)에서 수량 2개 이상 품목을 방배정하면 **전량**이 그 방으로 가버림. 몇 개 배정할지 물어보게(기본 1) + 나머지는 여분 유지.
- 기존 `assignExpenseToRoom`은 `expense.roomId`만 바꿔 통째 이동. → 신규 **`assignExpensePartialToRoom(expenseId, roomId, qty)`**([assets/actions.ts](app/(app)/inventory/assets/actions.ts)): qty<전체면 분할 — 배정분은 새 Expense 행(금액 수량비례, roomId=그 방), 나머지는 원본 유지(roomId 그대로). 같은 `allocationGroupId`로 묶음(finance 목록서 한 줄 표시·재사용). qty≥전체/수량없음이면 통째 이동.
- **적용취소**(사용자 원칙): `assignExpenseToRoom` 배정해제(roomId=null) 시 `mergeUnassignedGroup` — 같은 묶음의 미배정 행들을 자동 재병합(6→[2방][4여분]에서 2 해제하면 다시 [6여분], 배정행 없으면 groupId 정리·단독 복귀).
- **UI**([AssetsClient.tsx](app/(app)/inventory/assets/AssetsClient.tsx)): 방 선택 후 수량 2↑이면 인라인 수량 입력(기본 1, max=전체수량, Enter 확정) + '배정'. 1개·수량없음이면 바로 통째. 미배정 선택은 기존대로 해제(+재병합).
- detail 재구성 `buildAssetDetail`(addExpense 포맷). tsc·build 통과.

## 2026-06-10 (이어서) — 계약서 화면/인쇄(ContractView)도 §20로 통일 [main 배포, SQL 불필요]
배포 후 사용자: "예전 양식으로 나오는데?" → 원인: 계약서 출력 경로가 **둘**. PDF '발급'(=contractPrintHtml, §20 적용됨)과 **화면+'인쇄' 버튼(=ContractView.tsx, 옛 양식 그대로)**. 1차엔 PDF만 바꿔서 화면/인쇄는 옛날 그대로였음.
- **[ContractView.tsx](app/contract/[tenantId]/ContractView.tsx) 전면 §20 재작성**: contractPrintHtml 과 동일 클래스·토큰(`--p-*`, doc-header/tc-rule/info/emerg/clauses 2단/pledge/sign-grid/doc-footer/wordmark). 편집(섹션 인라인·서약 input)·서명패드·흡연·비상연락 입력·모바일 scale·인쇄 CSS 전부 보존. 조항 항목 `renderClauseItem`(글머리 제거 + **강조**→hl).
- **화면엔 계약번호 미표시**(발급 시 부여) — 작성일만. 발급 PDF는 계약번호 포함.
- [actions.ts](app/contract/[tenantId]/actions.ts) ContractData에 `phone` 추가(헤더/푸터 메타, property.phone).
- 결과: **화면·인쇄·발급 PDF 3경로 모두 동일한 §20 디자인**. tsc·build 통과. ⚠️ 화면 React 렌더라 로컬 정적검증 불가 → 배포 후 화면+인쇄 육안확인 필요.

## 2026-06-10 — 계약서 인쇄 템플릿 §20 전면 재디자인 (이전 세션 미완 → 마무리·배포) [main 배포, SQL 불필요]
이전 세션에 `lib/contractPrintHtml.ts`(§20 A4 디자인)·`docs/brand-guide-v1.3.md`(§20 390줄) 작업하다 **호출부 미연결로 빌드 실패 상태로 멈춰 미커밋**이던 것을 마무리.
- **블로커 해소**: 새 `PrintContractData`가 요구하는 `phone`·`contractNo`를 [route.ts](app/api/contract/generate/route.ts)가 미공급 → 타입에러. `phone=property.phone`, `contractNo=YYYYMMDD(signDate)-NNN`(=ContractFile 건수+1, 입실료확인서 §20.8 동일 패턴) 공급.
- **이중번호 수정**: 실제 섹션 제목이 이미 `"1. 입실 계약"`이라, 레퍼런스 mock의 자동번호(`i+1 ·`)를 넣으면 `"1 · 1. ..."` → 자동번호 제거(제목 그대로).
- **A4 페이지 정책(§20.10b)**: 계약서는 **다중 페이지** 서류(조항 적으면 1p). 기본 템플릿=2p 실측. → route에 **2-pass 렌더**: 1차 페이지수 판정 → **2장 이상일 때만** 꼬리말(좌 `1/2` 페이지번호 §20.9 + 우 영업장명 §20.10b). 단일 페이지는 페이지번호 생략. @sparticuz chromium 한글폰트 없어 **꼬리말에도 Pretendard base64 임베드**.
- **디자인**: §20 레퍼런스(`stayeum 입실계약서 템플릿.html`) 그대로 — 헤더(로고·사업자정보·계약번호/작성일)·테라코타 룰·정보표(국/영 라벨 4열)·2단 조항(column-count:2)·서약 박스·서명(임차인/임대인·서명img·도장)·푸터 워드마크(stay**eum**). 인쇄전용 토큰 `--p-*`.
- **유지(사용자 지시)**: 입력 구조(환경설정 `template.sections`/`oathText`) + 출력 파이프라인(puppeteer→PDF→Drive→ContractFile) 그대로. 데이터 2필드·2-pass만 보강.
- **검증**: 시스템 Chrome puppeteer 로 2-pass·꼬리말 실렌더(최종 2p PDF). tsc·build(타입체크 포함) 통과. ⚠️배포 후 실입주자 1명 발급해 꼬리말 페이지번호·한글 정상 최종확인 권장.

## 2026-06-10 — 퇴실 일할 정산 (퇴실일 세팅 → 마지막 달 청구 일할) [main 배포·SQL 적용·검증 완료]
**커밋**: `4ef9676`(코어) · `a727252`(뱃지 B안) · `3dcc2f2`(뱃지 C안) · `4b1d420`(고객관리 팝업) · `46b4186`(팝업 트리거 +1달). 모두 main 푸시·Vercel 배포됨. `migrate_checkout_proration.sql` Supabase 적용 완료(사용자 확인). 서민준 실데이터 검증 완료.
사용자 사례: 418호 서민준(납부일 매월 8일, 선납). 6/8 미납 상태에서 6월말 퇴실 통보 → 선납 시스템이라 "퇴실 날짜에 맞춰 일할만 납부"하겠다는 케이스. 6/26 퇴실이면 6/8~6/26 = **19일치**만 청구. 앱엔 납부일 변경(일할)은 있어도 **퇴실일로 인한 청구액 변경**이 없었음.
- **⚠️ 배포 전 필수(완료됨)**: `prisma/migrate_checkout_proration.sql`(checkoutProratedAmount INT · checkoutProratedMonth TEXT · checkoutProrationUndo JSONB) 을 **Supabase SQL Editor 에서 먼저 실행** — 이미 적용함. 안 하면 청구 엔진 select 가 런타임 에러.
- **스키마**: `LeaseTerm.checkoutProratedAmount Int?`(확정 일할액) + `checkoutProratedMonth String?`('YYYY-MM') + `checkoutProrationUndo Json?`(적용취소 스냅샷). 설정 시 청구 엔진이 그 달 청구를 이 값으로 덮어씀.
- **일할 헬퍼** [lib/prorate.ts](lib/prorate.ts) `calcCheckoutProration(monthlyRent, dueDay, expectedMoveOut)`: 선납 = dueDay가 기간 시작일. 일수 = 퇴실일 − 납부일 + 1(**양끝 포함**, 1~30 클램프), 금액 = floor(월 × 일수 / 30). 퇴실일 < 납부일이면 null(그 기간 미사용 = 청구 0, rooms `checkoutNoBilling` 영역). 사용자 확정: 19일=양끝포함, ÷30 기준.
- **서버액션** [tenants/actions.ts](app/(app)/tenants/actions.ts): `previewCheckoutProration`(읽기, 할인 반영 미리보기) · `setCheckoutProration`(확정·기록 lock + status=CHECKOUT_PENDING + expectedMoveOut + 상태로그, **적용 직전 스냅샷 저장**) · `clearCheckoutProration`(**적용취소=완전 롤백**: 스냅샷으로 status·expectedMoveOut·일할액 한 번에 복원, 스냅샷 없으면 일할액만 제거 폴백). `applyStatusTransition`: →ACTIVE(퇴실예정취소) 또는 expectedMoveOut 변경 시 일할 정산+스냅샷 자동 정리.
- **롤백 보장**(사용자 원칙): 적용은 상태전환+퇴실일+일할 3개를 한 번에 바꾸므로, '적용취소' 1클릭으로 적용 직전(거주중 등) 원상태까지 복원. 재정산 시 최초 스냅샷 유지 → 여러 번 재정산해도 한 번에 거주중으로.
- **수납 상태 뱃지** (B안→C안 변천): 처음 B안(미납 뱃지 1개 + 보조줄에 퇴실정보 합침) 배포했다가, 사용자가 뱃지 2개를 원해 **C안 확정** — 미납인데 퇴실 예정이면 `[미납][퇴실 예정]` 뱃지 **나란히** + 보조줄 `N일 초과 · 6/13 퇴실 D-3`. [StatusBadge](components/ui/StatusBadge.tsx)에 `secondary` prop 추가, RoomManage/RoomsClient `checkoutSubText` 헬퍼. 완납하면 퇴실예정 단독. (모바일 카드·데스크톱 표 동일)
- **고객관리 진입 팝업**: 퇴실예정처리/퇴실일변경(신규 전환)으로 expectedMoveOut 입력 시 정산은 자동 적용 안 함. 단 `shouldOfferCheckoutProration`(일할 부분기간 + 퇴실일이 '오늘+1달' 달력 기준 이내 — 6/2입력→7/2까지(6월30일), 5/2입력→6/2까지(5월31일), 고정일수 아님)이면 '퇴실 정산?' 팝업 → 예: `entityModal.open({openCheckoutProration})`로 수납 모달 full+위젯 자동펼침·날짜 프리필·미리보기 / 아니오: 날짜만. (Seed→PrismShellView→PaymentBody→Widget autoOpen 스루) 늦은정산·선납환불 둘 다 커버.
- **청구 엔진 3곳 동기화**(저장 일할액 최우선): rooms `getRoomPaymentStatus`(expected·billForMonth override + RoomRow 필드), dashboard `unpaid.ts`(billForMonth), dashboard `page.tsx`(billThisMonth·billForMonth). 셋 다 `checkoutProratedMonth===mon`이면 `checkoutProratedAmount` 반환 → 실제 납부 record의 expectedAmount와 무관하게 일할액 고정.
- **UI 위젯** [CheckoutProrationWidget](components/entity-modal/widgets/CheckoutProrationWidget.tsx): 수납 모달 full 모드(ACTIVE/CHECKOUT_PENDING만). 퇴실일 선택→서버 미리보기(19일치·감액 표시)→'정산 적용'으로 확정. 적용됨 상태 요약 + '해제'/'다시 정산'.
- **검증** [scripts/check-checkout-proration.ts](scripts/check-checkout-proration.ts): 서민준 실데이터 = rent 400,000·납부일 8. 설계 예시(6/26 퇴실)=19일치 **253,333원**(감액 146,667). 실제 적용은 사용자가 퇴실일 **6/13**으로 설정 → 6일치 **80,000원**(화면 월이용료 8만·잔액 -8만 확인). 신규 3컬럼 DB 존재 확인. lib/prorate 단위계산 케이스 7종 통과.
- 설계 결정: **확인 후 적용(정산 위젯)** 방식 — 월세 변경에도 안 흔들리게 절대액 lock(자동 일할 대신). 한계: 퇴실 완료(CHECKED_OUT) 후 매출은 실제 record(actualAmount) 기반이라 lease 필드 불필요(자동 무관).
- 팝업 트리거 확정: 고정 31일이 아니라 **'오늘 + 1달'(달력 기준)** — 입력일 6/2면 7/2까지(6월 30일), 5/2면 6/2까지(5월 31일). `shouldOfferCheckoutProration`. 사용자 기준 그대로.

## 2026-06-10 — 호실 360° 사진 뷰어 [main 배포, SQL 불필요]
**커밋**: `722c8fa`(Panorama360 + 편집폼 lightbox) · `f461c97`(공용 PhotoStrip 적용).
사용자: 408호에 360 이미지(room-360-408.jpg) 업로드했는데 호실관리에선 그냥 넓은 평면 이미지로만 보임 → 360으로 보고 싶음. (홈페이지 정적 index.html 은 이미 pannellum 360 사용 중)
- **신규 [components/Panorama360.tsx](components/Panorama360.tsx)**: pannellum@2.5.6 CDN 동적 로드(CSS+JS, idempotent) 래퍼. `pannellum.viewer(el, {type:'equirectangular', autoRotate:-2, crossOrigin:'anonymous', showZoom/Fullscreen, ...})`. 언마운트 시 destroy.
- **이미지 URL(핵심)**: 저장본 storageUrl 은 `buildDriveThumbnailUrl(id,400)`(drive.google.com/thumbnail) — 302 리디렉트 + 저해상이라 WebGL 텍스처(360)에 부적합. 360/큰사진은 **`https://lh3.googleusercontent.com/d/{fileId}=w2048`** 사용. 실측(408 실파일 curl): 리디렉트 없이 `access-control-allow-origin: *` + 고해상. CSP 없음(jsdelivr 허용). 공용 유틸 [lib/driveImage.ts](lib/driveImage.ts) `driveImageUrl`·`looksLike360`(클라 안전, googleapis 미의존). 서버용은 lib/google-drive `buildDriveImageUrl`.
- **두 군데 적용**:
  - ① **호실 상세(주 뷰어)** [PhotoStrip](components/entity-modal/widgets/PhotoStrip.tsx) — 호실 카드 클릭 → entity-modal RoomBody → PhotoStrip 라이트박스. **여기가 사용자가 실제 사진 보는 곳**(처음 ② 편집폼에만 붙였다가 못 봐서 추가). 360 사진이면 기본 360 ON, 상단 '360°로 보기/일반' 토글, 360 중 스와이프·화살표 비활성(pannellum 시점이동 양보), Esc 닫기, 썸네일 360° 배지. 평면 img 도 lh3 로 통일.
  - ② **편집 폼** [RoomManageClient](app/(app)/room-manage/RoomManageClient.tsx) `PhotoLightbox` — 사진 썸네일 클릭 → 풀스크린, 360 토글 + 2:1 종횡비 자동감지.
- **360 판정**: ① 파일명 `/360|파노라마|pano|equirect/`(기본·배지) ② 2:1 종횡비 자동(편집폼) ③ 수동 토글. 스키마 변경 없음(DB 플래그 불필요).
- tsc·build 통과. ⚠️ iCloud 동기화가 `.next/types/* 2.ts` 중복 생성 → tsc 거짓 에러, `find .next -name '* 2.ts' -delete`로 정리.

## 2026-06-10 — 배송비 입력 UX 통합 (편집 폼 단일 장소) [배포, SQL 불필요]
사용자 혼란: 배송비 합산형('배송비 포함')은 수정 폼, 합배송 별도묶기는 상세 모달 — 비슷한데 위치가 흩어져 헷갈림. 결정: 두 방식 유지 + 한 곳(수정 폼)에 모아 라벨 명확화.
- **수정 폼**에 '배송비' 단일 섹션: ① **이 지출 금액에 합산**(기존 editHasShipping) ② **별도 지출로 묶기(합배송)**(amount·선불/착불/신용·메모·같은날 다중선택) 두 체크박스 상호배타. 저장 시 ②면 updateExpense 후 attachShippingToOrder 호출.
- **편집 진입 시 프리필**: detailExp.order 있으면 ② 모드로 + 기존 배송비 라인 금액/결제구분/메모 채움.
- **상세 읽기뷰**: 인라인 '배송비 묶기' 폼 제거 → '주문 묶음' 상태 행 + "배송비는 [수정]에서 관리" 안내만. (handleAttachShip·showAttachShip dead code 제거)
- **사후 묶기 정렬 fix(c14f150)**: 배송비 라인 createdAt 을 묶인 항목 최신+1s 로 → 목록 맨 위로 안 뜨고 주문 바로 위.
- tsc·build 통과. 등록 폼은 기존 2-토글(배송비 포함/합배송) 유지(이미 상호배타) — 차후 동일 3-way 통일 여지.

## 2026-06-09 (이어서) — 합배송 Phase 2: 기존 지출에 배송비 묶기 [배포, SQL 불필요]
사용자 사례: 6/8 이미 등록한 의자 3개에 착불 배송비 8000원을 사후에 묶어야 함 → 등록시점 묶기(Phase 1)만으론 불가.
- **신규 액션 `attachShippingToOrder({expenseIds, amount, shippingType, shippingMemo})`** (finance/actions.ts): 기존 주문 있으면 재사용(메타 갱신)·없으면 새로 생성(genOrderCode), 지출들을 orderId로 연결, 배송비 별도 라인 생성(주문에 이미 있으면 갱신). 신용=미정산. 배송 라인 category·date·vendor는 대표(최대금액) 지출 기준.
- **UI(FinanceClient 상세 모달)**: 지출 상세에 '주문 묶음' 행(라벨·결제구분·코드) + '+ 배송비 묶기(합배송)' 인라인 폼(금액·선불/착불/신용·메모). 이미 묶였으면 '배송비 수정·다시 묶기'. 배송비 라인 자체엔 폼 미노출. 상세 열기/닫기 시 폼 리셋.
- Phase 1 스키마 그대로 사용 → **SQL 불필요, 바로 배포**. tsc·build 통과.
- 남은 것: 여러 기존 지출 동시 선택 묶기(현재 1건씩), 배송비 라인 결제구분 단독 인라인 편집.

## 2026-06-09 (이어서) — 지출 합배송/주문묶음 Phase 1 [코드 완료, ⚠️SQL 선적용 후 배포 → 적용·배포 완료]
[[project_expense_order_grouping]] 설계대로 구현. 여러 지출이 한 주문번호로 묶이고 배송비는 별도 지출(선불/착불/신용)로.
- **⚠️ 배포 전 필수**: `prisma/migrate_expense_order.sql` 을 **Supabase SQL Editor 에서 먼저 실행**. 안 하면 getExpenses 의 `order` 관계 조회가 런타임 에러(테이블/컬럼 없음). 단위작업과 달리 SQL 선적용 필수.
- **스키마**: 신규 `ExpenseOrder`(code 자동 'YYMMDD-NNN', shippingType, shippingMemo) + `Expense.orderId`(FK, onDelete SetNull) + `Expense.isShipping`. prisma generate 완료.
- **등록(addExpense)**: 합배송 필드(orderShipping·Type·Memo) 받으면 주문 생성→모든 품목 라인에 orderId 부여 + 배송비 별도 라인(isShipping, excludeFromInventory, 신용=미정산) 생성. 전부 한 트랜잭션. amount=품목합(배송 미포함). 품목합 검증을 주문생성 전으로(고아 주문 방지). `genOrderCode`(propertyId·일자별 순번).
- **표시(FinanceClient)**: getExpenses 에 order include. 주문별 요약(대표=비배송 최대금액 라인, "○○ 외 N건")·결제구분 칩을 모바일 카드+데스크톱 표 행에 표시. title 에 주문코드·메모.
- **폼 UI**: 추가 지출 폼에 '합배송(배송비 별도)' 토글 — 금액+결제구분(선불/착불/신용 버튼)+메모. 기존 '배송비 포함'(합산형)과 상호 배타. 리셋 처리 추가.
- tsc·build 통과. **남은 것(Phase 2)**: 기존 지출 사후 묶기(소급)·일괄 편집/삭제, 배송비 결제구분 인라인 편집, 주문 상세 그룹뷰.

## 2026-06-09 (이어서) — 재고 단위 자동 환산 (L↔ml·kg↔g 등) [main 배포 완료 e910722]
사용자: 주방세제 단위가 ml인데 새 영수증은 L 표기. OCR로 지출등록→재고 병합했더니 L/ml 구분 못함. 같은 차원(부피·무게·길이) 다른 표기는 자동 환산, 나중에 원하는 단위로 변경(예: 핸드워시 L→ml)도 가능하게.
- **신규 [lib/units.ts](lib/units.ts)** — 단위 변환 코어. 3차원: 부피(ml·cc·L·oz) / 무게(mg·g·kg·t·oz) / 길이(mm·cm·m·km·inch·ft). 한글·영문·기호 별칭 정규화(리터·밀리리터·인치·"·피트 등). `convertUnit`·`unitFactor`·`areUnitsCompatible`·`isConvertibleUnit`·`convertSpecValue`(계산 폴백)·`listCompatibleUnits`. **oz는 부피(29.57ml)·무게(28.35g) 양쪽 — 대상 단위 차원 보고 자동 선택**. 단위 12케이스 자동 테스트 통과.
- **A. 계산 시점 환산(핵심)** — 구매 영수증 specUnit이 품목 specUnit과 다르면 품목 단위로 환산 후 합산. 단위 비었/비호환이면 원값 유지(회귀 0). 적용: overview.ts(`sumPurchases`+itemUnit 인자, 단가루프), actions.ts(getMonthlyInflow·getPriceHistory·getStockAsOf·confirmReceipt 자동점검), InventoryClient.tsx(carryover·타임라인 입고표시는 환산값+원포장 병기). **→ 이미 병합된 주방세제 케이스는 재병합 없이 이 변경만으로 교정됨**(L 영수증이 ml로 자동환산).
- **B. 병합 시 자동 환산** — `mergeTrackedItems`: source·target 둘 다 규격추적+호환단위면 이전된 점검·위치잔량·입수량에 배율 적용(`scaleStockValues`). **차원 다르면(kg↔L) 병합 차단+안내**. 병합해제(undo) payload에 `unitFactor` 기록 → `unmergeTrackedItem`이 역배율(1/f)로 원복.
- **C. 단위 변경 옵션** — 신규 액션 `changeTrackedItemUnit(id, newUnit)`: 같은 차원 호환단위만, 저장된 점검·위치·입수값 배율 환산 후 specUnit 갱신(영수증은 그대로—계산서 자동환산). SettingsForm(품목 편집)에 '표시 단위 변환' 섹션(규격추적+환산가능 단위일 때만 노출): 현재단위 → select(호환단위) → 변환 버튼 + 배율 미리보기 + confirm.
- **스키마 변경 없음. tsc·build·units 테스트 통과.** ⚠️ 배포 후 검증 권장: 주방세제 현재고/사용량이 ml 기준으로 정상인지, L 영수증 입고 표시, 단위 변경 동작, 비호환 병합 차단.
- **📌 큐(다음)**: 지출 배송비 — 합배송(여러 품목 묶음배송) 처리 방법 + 수정 시 처리 방법 고민 필요(사용자 요청, 미착수).

## 2026-06-06 — 금융 청구 정확성 2건 (main 배포, 사용자 화면 검증 권장)
**#4 비거주(이원빈) 이월액 거주자요율 소급 버그 — [저장 청구액 우선]으로 수정**
- 증상: 사무실 비거주 이원빈(현 월세 100k)이 거주자 시절 4월 납부(360k)가 있어 "+이월액 230,000"으로 떠 미납처럼 보임. "이번달에 바꿨는데 왜 5월이 영향받냐" = 청구 계산이 과거 모든 달을 **현재 월세로 소급 재계산**하기 때문.
- 근본 수정: 과거월 청구 = 그 달 PaymentRecord에 락인된 `expectedAmount` 우선(같은 달 여러 record면 최대=정규 월청구), record 없는 달만 현재 월세(할인 반영) fallback. 월세 변경이 과거에 소급되지 않음.
- 적용 3곳(동기화 필수): `rooms/actions.ts` getRoomPaymentStatus(billedBeforeSum·cumExpected), `dashboard/unpaid.ts`(billForMonth+select expectedAmount), `dashboard/page.tsx`(billForMonth+select expectedAmount). 각 파일에 per-lease `lockedExpected(ByLeaseMonth)` 맵 추가.
- 검증: 스크립트로 이원빈 carryOver = **−30,000**(5월 100k중 70k납부 미수) 확인. 기존 +230,000 유령 크레딧 제거됨.
- 주의/트레이드오프: 소급 할인(retroactive #14 discount)은 record 생성 후 적용 시 반영 안 됨(생성 시점 expected 락인). 일반 케이스는 영향 없음(생성 시 expected=요율). **실데이터 화면(수납·대시보드·🔔) 회귀 권장**.

**신규 — 손익 현황 "수납 예정" 음수·예상순이익 불일치 수정**
- 증상: 수납예정 −25만(음수)로 뜨고, 예상순이익(820만)이 현재순이익(698만)+수납예정과 안 맞음(gap 122만).
- 원인: 예상매출/예상순이익=발생주의(이번달 청구 전액, 도래 전 포함), 현재순이익=현금주의(이번달 수령), 수납예정=accrual-net 미납(과거 누적·선납 상쇄)로 **기준 3개가 달라** 합산 불성립.
- 수정: `pendingRevenue = max(0, projectedRevenue − totalRevenue)` 신설 → 수납예정으로 표기. 이제 **예상매출=수납완료+수납예정**, **예상순이익=현재순이익+수납예정−예정고정지출** 정확히 성립. 위젯은 `+{pendingRevenue}`(중립색)로 표시. (`page.tsx` 반환 + `DashboardClient.tsx` 타입·표기)
- 검증 권장: 화면에서 예상매출=수납완료+수납예정, 예상순이익=현재순이익+수납예정 맞는지.

**신규(추가) — 예상매출 과대계상: 다음달 입주자가 이번달 매출에 잡힘**
- 사용자 직감("미납 그렇게 크지 않을텐데")이 정확. 5월 gap 1,230,000 까보니 507(먀 야다나 모에)·509(탄 타르 누 아예)가 **입주일 2026-06-05인데 ACTIVE**라 5월 예상매출에 470k씩(합 940k) 잘못 포함. 실제 5월 미납은 조원섭25만+이종현1만+이원빈3만=**약 29만**.
- 원인: `dashboard/page.tsx` totalExpected(=billableLeases)가 status·rentAmount만 보고 **moveInDate/expectedMoveOut 미확인**. (수납페이지·unpaid.ts·unpaidMap은 이미 입주월>대상월 제외 → 대시보드 totalExpected만 누락)
- 수정: activeLeases select에 moveInDate·expectedMoveOut 추가, `billableInTargetMonth(l)`(입주월≤대상월≤퇴실월) 필터를 billableLeases에 적용. paidCount·totalExpected·projectedRevenue·pendingRevenue 모두 자동 교정.
- 검증: 5월 totalExpected 15,910,000→14,970,000, 수납예정 290,000(=실제미납)로 일치. 예상순이익 ~94만 하향(820만→~726만, 상단 자막 723만과 부합).

## 2026-06-06 (이어서) — #5 보증금 실수납 기록 + 보유보증금 분해 (main 배포)
사용자 방향 확정: (1) 보유 보증금 = 총액 유지 + 실수납/미기록 분해, (2) 받음 기록 진입점 둘 다.
- **대시보드 '보유 보증금'**: 계약 기준 총액 유지 + 아래 '실수납 X · 미기록 Y(전 원장)' 분해. page.tsx에 depositRecorded(active 리스 isDeposit 합)·depositUnrecorded(=총액−실수납) 추가, DashboardClient KPI 카드 sub-line.
- **recordDepositReceived 액션**(rooms/actions.ts): 전 원장 등으로 받았으나 기록 없는 보증금을 계약액 기준 실수납 record(isDeposit)로 백필. 미기록분(계약−기존입금)만 채움. targetMonth=입주월. requireEdit + revalidate(finance/rooms/dashboard/).
- **finance 보증금 요약**: '입금 거래 기록 없음' 항목에 '받음으로 기록' 버튼(DepositTab). 클릭→백필→refresh.
- **입주자/예약 폼**: 보증금>0이면 '보증금 실제로 받음' 체크박스(TenantClient FormFields). addTenant/updateTenant가 depositReceived 읽어 recordDepositReceived 호출(이미 기록됐으면 무시).
- 안전성: 백필은 effectiveIn 폴백(계약액)을 실제 기록으로 전환 → 총액·잔고 불변, 미기록→실수납 이동만. 커밋 8ef9b0a(1·2) + 후속(3).
- 검증 권장: finance에서 '받음으로 기록' 누른 뒤 대시보드 분해(실수납↑·미기록↓) 반영, 예약 확정 시 체크박스로 보증금 기록 생성 확인.

## 2026-06-06 (이어서) — 재고 병합 해제(되돌리기) + 거절메모리 발견성 (main 배포 / ⚠️ SQL 적용 필요)
사용자 요청: (1) 잘못 병합 시 되돌리기 없음, (2) '병합 안함' 한번 고르면 영구 고정 + 메모리 삭제 기능 원함.
확인: 거절(MUTE) 되돌리기·메모리 삭제는 **이미 '병합 규칙' 버튼(MergeRulesModal)에 존재**('다시 추천 받기'). 버튼이 툴바에 묻혀 못 찾으신 것. 병합 해제(데이터 복원)만 없었음.
방향 확정: (1) 앞으로 병합 완전 되돌리기, (2) 메모리 관리 발견성 개선.
- **새 테이블 `tracked_item_merge_undos`** (schema + prisma/migrate_tracked_item_merge_undo.sql, RLS enable). ⚠️ **Supabase SQL Editor에서 이 파일 실행 필요** — 적용 전엔 병합 해제 목록 비어있음(병합 자체는 try/catch로 정상 동작).
- 병합 시 복원정보 기록: `applyMergeDecision`(IMPORT: 지출 라벨만 이전) + `mergeTrackedItems`(CARD: source 카드 삭제 — 스냅샷+이전 id 저장). 둘 다 try/catch(테이블 미적용 방어).
- `unmergeTrackedItem(undoId)`: IMPORT=지출 라벨 원복+카드 복구+LINK 삭제 / CARD=source 카드 재생성+지출·점검·입수 원복+대상 qtyUnit 원복+LINK 삭제. `getMergeUndos()` 목록.
- UI: 버튼 '병합 규칙' → '**병합 해제·규칙**'. MergeRulesModal 상단에 '되돌릴 수 있는 병합' 섹션 + '병합 해제' 버튼. 제목/부제 갱신.
- 한계: CARD 병합 복원 시 TrackedItemLocation(위치 재고)은 카드 삭제로 유실 → 위치만 재설정 필요(드묾). 과거(이번 작업 전) 병합은 복원정보 없어 되돌리기 불가(수동 재등록).
- 검증 권장: SQL 적용 후 → 자동등록에서 병합 → '병합 해제·규칙'에서 '병합 해제' → 원래 품목으로 분리되는지.

## 2026-06-06 (이어서) — 지출 등록 폼/OCR 개선 4건 (main 배포)
- **배송비**: 지출 등록에 '배송비 포함' 체크박스(기본 무료) + 금액 입력. name=amount 는 항상 (품목합계|입력금액)+배송비 단일 제출. 세부항목에 '· 배송비 N원' 표기. (스키마 변경 없음, 총액 합산형)
- **카테고리 변경 시 입력 유지**: category select onChange 의 `setAddItems([])` 제거 → OCR 자동입력 내용이 카테고리 바꿔도 보존.
- **규격 없음(수량만)**: ItemSelector 픽커에 '규격 없음' 토글 — 켜면 규격 입력 숨기고 specValue/specUnit 비움(빈칸 혼동 제거).
- **스캔 후 자동 분석 팝업**: handleScanConfirm 에서 지출 폼(add) 대상이면 '분석할까요?' confirm → 예: OCR 자동입력+첨부 / 아니오: 첨부만. (핸들러를 uploadCropped/ocrCropped 코어 + 버튼 래퍼로 리팩터. 편집 폼은 기존 수동 버튼 유지)
- 파일: app/(app)/finance/FinanceClient.tsx 단일. tsc 통과.

## 2026-06-09 — 재고 타임라인 정렬·보정 끼워넣기 가드 (main 배포)
- **점검 수정 폼에 전체 위치 표시**: CheckEditForm locationSources = 아이템 현재 위치 union(+orphan). 나중에 추가된 위치도 과거 점검 수정에서 입력 가능(기존 보유분 보정). handleSave는 허브·원래있던·값입력 위치만 저장(0오염 방지).
- **백필 타임라인 정렬**: getInventoryItemDetail effTime — 백필(createdAt일≠date일)을 date자정 대신 'date KST자정 + createdAt 하루중경과시간'으로 → 표시 시각과 정렬 위치 일치(6/1 20:10 보정이 15:30 위로).
- **사용량 계산 정렬 동기화**: overview.ts effTime 도 동일 규칙으로 통일. 같은날 자동수령 점검(createdAt일==date일)은 createdAt 그대로 → 중복입고 방지 보호 로직 영향 없음. 오히려 백필 보정 이전 같은날 수령의 중복가산 여지 감소.
- **보정 끼워넣기 가드**: TimelineReconcileForm 에 existingCheckDays prop. 고른 날짜에 이미 점검 있으면 인라인 경고 배너 + 저장 시 confirm("그 점검 [수정]이 정확, 그래도 추가?"). 같은 날 중복 보정 방지.
- 전부 tsc 통과. 사용량 숫자 변동은 백필 항목 한정이라 일반 케이스 영향 미미하나, 화면 수치 한번 확인 권장.

## ⏳ 사용자 화면 검증 대기 (2026-06-02 작업, 전부 main 배포·SQL 적용 완료)
오늘 재고·수납 9건 배포(커밋 `0a3ea71`~`eb1a717`). 실데이터 스크립트론 검증했고, 아래는 **실기기/프로덕션 화면 최종 확인**만 남음:
- **재고 월별 사용량 그래프** — 수세미 5월 0, 라면 5월 115·6월 66, 주방세제 6270 등 현실적 수치로 뜨는지. (입고가 사용량으로 둔갑하던 버그·실제 시각 정렬·effTime 적용)
- **전체 재고 보정** — 헤더 '전체 재고 보정' 모달(보충완료 게이트) + **품목별 점검 폼 '전체 보정으로 기록' 토글**. 보정분이 사용량에 안 잡히는지.
- **재고 점검 수정 폼** — 보충 전이 사라지지 않고(2개 유지) 창고 과차감 없는지.
- **미납 유예(최명윤 517호)** — 🔔알림·대시보드 미수·**수납 페이지** 모두에서 "19일 경과" 아니라 **납부예정(6/3)**으로 뜨는지. (수납 페이지는 스크립트 검증 불가)
- **재고 카테고리 설정** — '카테고리 설정' 버튼, 헤더 별칭(식료품/소모품/폐기물 처리용품), 수선유지비 추가·이름 변경.
- **데이터 정리(사용자 직접)** — 5/28에 일괄 백필된 5/12 점검들 중 충돌 건(라면 49 vs 135 등) 검토·정리. 텔레스코핑이 월합은 상쇄하나 타임라인엔 잔존.

## 완료된 것

### 2026-06-05 세션 20부 — 운영 피드백 5건(#1·#2·#5a·#5b 배포 / #3·#4 정보대기)
- **#2 만실 방 맞바꾸기(`fbb2fb2`)**: 예약확정 입주예정도 '수정' 시 호실 비우기 허용(서버 검증·폼 required 완화, RESERVED 한정). 둘이 잠시 미지정으로 파킹→재지정. 신규등록은 호실 필수 유지.
- **#5a 보증금 수납 노출(`fbb2fb2`)**: PaymentEntryForm의 작은 텍스트 토글 → 또렷한 '보증금 수납하기' 버튼.
- **#1 수납 최근 납부일(`4e90823`)**: getRoomPaymentStatus lastPayDate(현 원장 최신 payDate) → 수납 표 총납부액 셀(데스크탑·모바일)에 '납부 MM/DD'.
- **#5b 보유 보증금(`fcb03d4`)**: 계약 보증금액을 ACTIVE·**RESERVED**·CHECKOUT_PENDING 합산 → 입실 전 예약확정 보증금까지 잡힘. ACTIVE·CHECKOUT_PENDING(거주중)만 합산으로 수정(입주하면 자동 포함).
- **#5 남은 것(사용자 답 기반 후속)**: ①RESERVED 입주자 보증금 '실수납 완료' 기록 수단(현재 active만 가능) ②보유 보증금 '실수납 + 미수납(계약상)' 별도 표시(전 원장 보증금 누락 방지). 큰 작업, 별도 진행.
- **#3 계약서 출력 잘림(대기)**: ContractView 인쇄 CSS는 1장 기준+page-break avoid. 잘림은 브라우저/내용길이별 → 출력 PDF·브라우저 정보 필요.
- **#4 비거주→거주→비거주 이월 미납(대기)**: NON_RESIDENT 인데 이월액이 거주자 rentAmount 기준 미납으로 계산됨(추정: 청구가 월별 당시 status 무시하고 현 rentAmount·기간으로 계산). 재현할 호실 정보 필요.

### 2026-06-05 세션 19부 — 고객 정보 수정 저장 후 폼 깜빡임·2중·옛내용 버그 fix (2단계, 배포 `f2c2243`)
사용자: 저장하면 팝업이 깜빡이며 유지, 2개 겹친 느낌, 수정 전 내용이 보이다가 다 끄면 반영됨.
- **1차(`8123a40`)**: 저장 시 URL `?edit=1`·`?tenantId` 미정리 → 재오픈. `clearTenantUrlParams()` 헬퍼로 저장 경로(일반·보증금환불)·closeEdit 정리. (부분 효과)
- **2차(진짜 원인)**: edit=1 감지 useEffect 가 deps 에 `detailEditMode` 포함 → 저장 시 detailEditMode=false 되는 순간 재실행되는데, URL replace 가 아직 반영 안 돼 edit=1 잔존 → 폼을 **옛 데이터로 재오픈**(레이스). 깜빡·2중·수정전 내용의 정체. → `handledEditRef` 로 **한 edit 요청당 1회만** 오픈, edit 사라지면 리셋. deps 에서 detailEditMode/detailTenant.id 제거.
- 셸(entityModal)은 순수 state라 [수정] 시 close()로 닫힘 — 2중의 원인 아님(편집폼 재오픈이 원인).
- tsc·build 통과. SQL 불필요.

### 2026-06-05 세션 18부 — 지출 총액 자동합산(수정 단일품목) + 방별분배 시 대상호실 숨김 (배포 `3448240`)
- **대상 호실 숨김(중복 방지)**: 품목 '방별로 나누기' 켜지면 폼 전체 '대상 호실' 드롭다운 숨기고 안내문구로(roomId 빈값 전송). add/edit 양쪽. (배포 `2272f90`)
- **총액 자동 합산**: ADD는 품목 1개+면 총액=품목합 자동(기존). EDIT은 2개+에서만 자동, 단일 품목 수정 시 수동이라 수량·단가 바꿔도 총액 안 변함 → `editItems.length > 1` → `>= 1` 로 단일 품목도 자동 합산. 품목 합계(수량×단가) 변경이 상단 총액에 바로 반영.
- tsc·build 통과. SQL 불필요.

### 2026-06-05 세션 17부 — 방별 분배: 부분 배정(미지정 나머지) + 수정 폼에서도 분배 (배포 `04a7a9d`)
사용자: 고압호스 6개 중 2개만 방 배정, 나머지 4개는 예비로 방 미지정인 경우도 돼야 함. + 수정에서도 방별 분배 돼야 함.
- **부분 배정 + 미지정 나머지**: 공통 헬퍼 `expandExpenseRows(items, formRoomId)` 신설(actions). 방별 분배 있으면 방별 행 + (배정 안 한 나머지 수량 = 방 미지정 행). 금액은 수량 비례(denom=max(전체수량, 배정합)), 반올림 잔여 흡수. addExpense·updateExpense 양쪽 이 헬퍼 사용.
- **수정 폼 방별 분배**: 편집 ItemSelector 에 `rooms` 전달 → 방별로 나누기 토글 등장. updateExpense 가 allocations(또는 품목 2개+) 있으면 분할: 첫 행은 현재 row update, 나머지(방별·미지정)는 새 row 생성(1행→N행). 예: 6개 13,500 → 방A 2개(4,500)+미지정 4개(9,000).
- **카드 힌트**: '불일치 ⚠' → 초과 배정만 경고, 부분 배정은 "나머지 N개 미지정" 안내.
- tsc·build 통과. SQL 불필요. ⚠️ 결제 핵심 — 런타임 검증(분할 금액·방별 반영) 권장.

### 2026-06-05 세션 16부 — 구매처 관리 + 단가 0원 복원 버그 fix (배포 `06cf35f`)
- **구매처 관리(정리)**: 이력 자동완성(B)에 쌓인 오타·중복 정돈. 지출 탭 '구매처 관리' 버튼 → VendorManageModal(구매처 목록+사용건수, 이름변경=일괄 변경/같은이름이면 합치기/비우면 제거). 신규 액션 `getVendorUsage`(groupBy vendor), `renameVendor`(updateMany).
- **단가 0원 버그 fix**: 품목 지출 저장 후 수정 들어가면 단가가 0 으로 뜸(저장엔 단가 없음, editItems 복원 시 unitPrice 미설정). → `unitPrice = round(amount / (qty||1))` 로 복원(편집 init + OCR/드래프트 addItems 매핑 양쪽).
- tsc·build 통과. SQL 불필요.
- **남은 논의(미구현)**: '대상 호실'을 수량만큼 멀티 선택 — 현재 방별 분배는 등록(ADD) 폼 옵트인만. 수정 폼·대상호실 멀티는 별도 설계 필요(수정=1행 분할 이슈).

### 2026-06-03 세션 15부 — 품목/수량 전 카테고리 허용 + 방별지출 드릴다운 + 구매처 자동완성 (배포 `5255596`)
- **방별 지출 드릴다운**: 지출 페이지 '방별 지출'이 방별 합계만 보여 항목 확인 불가 → 방 행을 펼치면(nested details) 그 방 지출 내역(날짜·세부·금액) 표시. (방 상세 위젯은 원래 펼침 내역 있음)
- **품목/수량 전 카테고리 허용**: ITEM_PRESETS 있는 3개 카테고리에만 품목 UI 떴음 → 사용자 요청(품목·수량은 옵션이고 카테고리 커스터마이징되니 다 있어야). ItemSelector `if(!presets) return null` 제거 + `presets ?? []`, add/edit 폼의 `{ITEM_PRESETS[cat] && ...}` 게이트 제거 → 모든 카테고리에서 '직접 입력'으로 품목·수량·단가·금액·(add는 방분배) 추가 가능.
- **구매처(vendor) 자동완성**: 과거 입력한 구매처를 datalist 로 타이핑 자동완성. 신규 `getExpenseVendorSuggestions()`(distinct vendor 최근순 400) → page.tsx 전달 → add/edit 구매처 input 에 `list=`+datalist. 별도 관리 불필요(이력 기반).
- tsc·build 통과. SQL 불필요.

### 2026-06-03 세션 14부 — 지출폼 다품목 단가↔금액 자동계산 + 선택적 방별 분배 (배포 `f5bac24`) [SQL 불필요, ⚠️런타임검증]
사용자: 다품목 각각 수량·단가, 단가↔금액 자동(둘 중 하나 입력→나머지 계산), 같은 품목 여러 방 쪼개기. **단, 방은 선택 — 수량 입력≠방분할(옵트인)**.
- **ItemPickState** += `unitPrice?`·`allocations?[{roomId,qty}]`. ItemSelector 에 `rooms` prop.
- **품목 카드 UI**: 칩→카드. 수량×단가=금액 입력칸(자동계산: 금액입력→단가=÷수량, 단가입력→금액=×수량, 수량변경→재계산). **'방별로 나누기(선택)' 토글** — 켤 때만 방별 {방·수량} 행 편집(분배합/수량 불일치 ⚠ 표시). 안 켜면 방 분할 없음.
- **저장(addExpense)**: itemsJson 에 allocations 포함. 분할 경로 조건 = 품목 2개+ OR allocations 있음(단일 품목도 방분배면 분할). 품목→행 확장: allocations 있으면 방별 행(금액=수량 비례, 마지막 잔여 흡수, roomId=방), 없으면 1행(폼 방). 단일·무분배는 기존 단일 생성 경로 유지(breakdownJson 등 보존).
- 편집 폼은 rooms 미전달 → 방분배 UI 없음(기존 동작). tsc·build 통과.
- ⚠️ **결제/장부 핵심 — 사용자 런타임 검증 필수**: ①다품목 단가↔금액 자동 ②단일품목 금액→단가 ③방별 분배(예: 4개를 방2·방2)로 행 분할·금액 비례·방별 지출 반영 ④방 미사용 시 기존처럼 동작.

### 2026-06-03 세션 13부 — 방별 지출 보기 (방 상세 + 지출 페이지, 배포 `e50e566`) [SQL 불필요]
사용자: 지출에 '대상 호실' 배정한 게 각 지출 상세에만 보여 — 어떤 방에 총 얼마 들어갔는지 모아 볼 곳이 없음. 두 곳에 추가.
- **방 상세(Prism)**: 신규 위젯 [RoomExpenses.tsx](components/entity-modal/widgets/RoomExpenses.tsx) — 그 방 누적 지출(전체 기간) 합계 + 접이식 내역. 신규 액션 [rooms/actions.ts](app/(app)/rooms/actions.ts) `getRoomExpenses(roomId)`(Expense.roomId 기준). RoomBody 에 추가.
- **지출 페이지(finance)**: 지출 탭에 '방별 지출 (이번 달)' `<details>` 섹션 — 로드된 expenses(이번 달, room 포함)를 방별 합산·정렬. 상태 없이 native details.
- tsc·build 통과. SQL 불필요(Expense.roomId 기존 필드).

### 2026-06-03 세션 12부 — 품목별 창고(허브) [SQL 적용됨, 배포 `5fa7a2c`] · 11부 전역 허브 롤백
사용자: 일괄(전역) 허브는 무의미 — 김치=5층 김치냉장고, 라면=415호 창고처럼 품목마다 허브가 달라야 함. 11부 전역 허브 칩 롤백 + 품목별 재구성.
- **스키마**: `TrackedItem.hubLocationId String?` + `migrate_tracked_item_hub.sql`. **프로덕션 적용 완료**, generate.
- **핵심 통찰**: 허브는 곳곳에서 `item.locations[].isHub`로 결정됨(batch doSave 도 `r.locations.find(l=>l.isHub)`로 이미 품목별). → **locations[].isHub 를 품목 허브로 채우면 51곳 로직이 자동 품목별**. `isHub = hubLocationId ? l.id===hubLocationId : (영업장 기본 허브 폴백)`. overview.ts·getInventoryDetail·getStockAsOf 3곳 적용.
- **신규 액션** `setItemHub(itemId, locationId|null)` (그 품목 연결 위치만 지정 가능, null=기본 허브 폴백).
- **UI**: 품목 상세에 "이 품목 창고(허브): [이름] ▾" picker(그 품목 위치 중 선택 + '영업장 기본 창고 사용'). batch modal 전역 `isHubLocation` → 행별 `rowIsHub`(선택 위치가 그 품목 허브인지). 위치관리 토글은 '기본 창고'(폴백)로 라벨 변경.
- **11부 롤백**: 재고 헤더 전역 허브 칩 + 상태 제거(setStorageHub 액션은 미사용으로 잔존, 무해).
- **회귀 0**: 모든 hubLocationId=null → 폴백이 기존 전역 허브와 동일. 사용자가 품목별 지정 시 적용. tsc·build 통과.

### 2026-06-02 세션 11부 — 재고 UX 3건 (허브 노출 / 무의미 합계 제거 / 스켈레톤 로더, 배포 `5ca6b21`)
1. **창고(허브) 메인 노출·전환**: 허브 지정이 '위치 관리' 모달 깊숙이 있어 안 보였음 → 재고 헤더에 "창고(허브): [이름] ▾" 칩 + 드롭다운으로 즉시 전환. 신규 액션 [actions.ts](app/(app)/inventory/actions.ts) `setStorageHub(id)`(트랜잭션 — 선택 위치 허브 ON·나머지 OFF, 단일 허브 보장). InventoryClient 헤더에 getStorageLocations 로드 + 피커.
2. **위치별 일괄점검 '이동 합계' 제거**: LocationBatchCheckModal 하단 "창고 → 이동 합계 +N"은 여러 품목(단위 제각각) 합이라 무의미 → 숫자 빼고 "보충한 만큼 각 품목의 창고 잔량에서 자동 차감됩니다" 안내만.
3. **스켈레톤 로더**: 페이지 이동 시 작은 BrandLoader(60vh 중앙)라 안 보여 답답 → [components/ui/Skeleton.tsx](components/ui/Skeleton.tsx) 신규(animate-pulse, cream-3 톤) + [app/(app)/loading.tsx](app/(app)/loading.tsx)를 제목·칩·카드6 스켈레톤 화면으로 교체. (app) 라우트 이동 시 본문이 깜빡이는 placeholder 로. SplashScreen(최초 진입)은 그대로.
- tsc·build 통과. SQL 불필요.

### 2026-06-02 세션 10부 — 전체 재고 보정 v2: 타임라인 보정 끼워넣기 (배포 `5de0617`·`7ae3738`)
v1은 과거 날짜 보정 가능했으나 발견·UX가 약함. v2 = 품목 상세 타임라인에서 특정 시점에 보정을 끼워넣고, 그 시점 예상 재고를 미리 보여줌. 사용자 선택(타임라인 끼워넣기).
- **신규 서버액션** [actions.ts](app/(app)/inventory/actions.ts) `getStockAsOf(trackedItemId, date)`: 그 날짜 시점 예상 재고(직전 ≤date 점검 잔량 + 그 사이 입고[구매 receivedAt·무상] 합산, 허브에 증감 귀속) → {total, byLoc}. 저장은 `saveFullReconcile` 단일 품목 재사용(carryOver 없는 plain isReconcile 생성 — createStockCheck 의 carryOver 는 '최신 점검'에서 채워 과거 삽입 시 미래값 끌어올 위험이라 회피).
- **UI** DetailModal: mode 에 'reconcile' 추가, 푸터 '보정 끼워넣기' 버튼 → 신규 `TimelineReconcileForm`(날짜 피커 → getStockAsOf 로 위치별 예상 프리필 → 실측 입력 → 차이 표시 → 사유 → 저장). 위치 없는 품목은 총량 입력.
- v1 자산(isReconcile·overview skip·saveFullReconcile) 그대로 재사용. **스키마 변경 없음.** tsc·build 통과.
- ⚠️ getStockAsOf 는 쿠키/인증 게이트라 스크립트 검증 불가 → 화면 확인 권장(과거 날짜 고를 때 예상 재고·차이 표시·삽입 후 타임라인 위치·사용량 영향).

### 2026-06-02 세션 9부 — 재고관리 카테고리 커스터마이징 (선택+별칭) [SQL 적용됨, 배포 `eb1a717`]
사용자 요청: 재고관리에서 'xx비'(지출 용어)는 안 어울림. ①재고에 보일 카테고리 선택 ②기본 표시명 제안 ③직접 수정. 지출 카테고리/로직은 안 건드리게.
- **스키마**: `Property.inventoryCategories String?`(JSON `[{cat,alias}]`) + `migrate_inventory_categories.sql`. **프로덕션 적용 완료**, prisma generate.
- **하드코딩 상수 동적화**: `TRACKED_CATEGORIES`(부식비·소모품비·폐기물 처리비 고정)를 쓰던 **서버 로직 4곳**(overview.ts·alerts.ts·actions.ts seed×2)을 `getTrackedCategories(propertyId)`로 대체 → 영업장별 카테고리(수선유지비 등 추가) 추적 가능. [categoryConfig.ts](app/(app)/inventory/categoryConfig.ts) 신규(parse+default), [constants.ts](app/(app)/inventory/constants.ts) 에 DEFAULT_INVENTORY_CATEGORIES·SUGGESTED_INVENTORY_ALIAS·suggestInventoryAlias(순수, 클라 공유).
- **표시명(별칭)은 화면 전용** — 부식비→식료품, 소모품비→소모품, 폐기물 처리비→폐기물 처리용품(기본). 지출/장부엔 영향 0.
- **UI**: page.tsx 가 categories·allExpenseCategories 전달. InventoryClient 그룹화/헤더/AddItemModal/FullReconcileModal 가 별칭 표시(`aliasOf`), 설정 밖 카테고리(과거 등록분)는 뒤에 자체 표시. `tintOf`(미등록 카테고리 폴백 색). 헤더 '카테고리 설정' 버튼 → `InventoryCategorySettingsModal`(선택·순서(▲▼)·별칭 편집·추가/제거). 액션 `getInventoryCategorySettings`/`setInventoryCategories`.
- **검증**: 설정 null→기본 3개 별칭 정상, trackedCats 정상. tsc·build 통과.

### 2026-06-02 세션 8부 — 납부일 임시조정 UI: 기본 대상=미납월 (근본 해결, 배포 `5427eb1`)
7부는 잘못 태깅된 override를 '유예'로 해석하는 보정. 8부는 **애초에 올바른 월에 태깅**하도록 UI 개선(근본).
- **원인(근본)**: `DueDayTempAdjustWidget`이 override를 항상 '보고 있던 달(targetMonth)'에 태깅 → 미납월과 어긋남.
- **수정**: 위젯이 `firstUnpaidMonth`(이미 RoomRow/settlement에 있음, PaymentBody가 전달)를 받아 **기본 조정 대상 = 미납월**. "밀린 N월분을 [날짜]로 미루기"로 표시. **'다른 달' 옵션**(월 칩 선택: 미납월·보는 달·향후 2개월)으로 완납 상태에서 미래 달 조정도 가능. 저장 시 override를 그 대상 월에 태깅(다음 달로 미루면 완전한 날짜로 저장) → 기존 정확-월 매칭이 그대로 경과일 정확.
- isActive 판정을 targetMonth 종속 → override 존재 여부로 일반화. 표시에 "[N월]분" 명시. setDueDayOverride(lease, overrideMonth, val).
- 7부 유예 보정 로직은 과거 잘못 태깅 데이터 + 안전망으로 유지. 결제 금액 영향 없음(태깅 월만 개선). tsc·build 통과.

### 2026-06-02 세션 7부 — 납부일 임시조정으로 미납 유예 시 경과일 계산 (배포 `167c2d6`)
사용자 보고: 최명윤 517호 "미납 19일 경과"로 뜨는데, 5월 미납분을 6/1로 납부일 임시변경(유예)했으니 19일 경과가 아님.
- **원인**: 임시조정 위젯이 override를 '보고 있던 월(targetMonth)'에 붙임([DueDayTempAdjustWidget.tsx:103](components/entity-modal/widgets/DueDayTempAdjustWidget.tsx#L103) `setDueDayOverride(leaseTermId, targetMonth, ...)`). 오늘이 6월이라 override가 **2026-06**(day 3)에 붙음. 그런데 미납 채무는 **2026-05** → `overrideDueDayMonth===monthStr` 정확 매칭만 보던 경과일 계산이 5월엔 원래 납부일(14일) 적용 → 5/14 기준 19일.
- **수정(유예날짜 기준 — 사용자 선택)**: override 가 미납 월과 같거나 **이후** 월에 걸려 있고 그 유예 날짜가 원래 납부일보다 **늦으면**(=채무를 뒤로 미룬 것) 유예 절대날짜 기준으로 경과일 계산. `overrideAbsDate`(override를 절대 Date로 해석) + `daysOverdueForMonth` 헬퍼.
  · [unpaid.ts](app/(app)/dashboard/unpaid.ts)(🔔알림·푸시 — computeUnpaidStatus) · [dashboard/page.tsx](app/(app)/dashboard/page.tsx)(대시보드 미수 위젯) · [rooms/actions.ts](app/(app)/rooms/actions.ts) getRoomPaymentStatus effDueDateForMonth(수납 페이지) **3곳 동기화**. 정확-월 override 는 무조건 적용(기존 동작 보존), 교차-월은 '뒤로 미루기'만(`>= origDate` 가드).
- **검증**: computeUnpaidStatus 실데이터 — 최명윤이 미납(긴급) 목록에서 빠지고(6/3 유예 < 오늘 6/2 → 미도래=납부예정), 타 미납자(이재인 2일 등) 영향 없음. tsc·build 통과. SQL 불필요.
- ⚠️ 수납 페이지는 쿠키/인증 게이트라 스크립트 런타임검증 불가 → 사용자 화면 최종 확인 권장(unpaid.ts와 동일 규칙).

### 2026-06-02 세션 6부 — 재고 보정 후속(사용자 피드백 4건)
1. **수세미 사용량 0 안 됨 → effTime 도입(overview.ts)**: 수령 즉시 자동 생성되는 점검(sourceExpenseId)이 그 구매를 이미 반영하는데, 구매를 점검 date(자정) 기준 귀속하면 같은 날 자동점검이 baseline 인데도 구매가 다음 구간에 또 입고로 더해져 사용량 부풀림(수세미: 사서 분산만 했는데 10 소모). 입고/소모 구간 경계를 date→**effTime**(입력 당일이면 createdAt, 백필이면 date — 타임라인과 동일 규칙)으로 변경. 검증: 수세미 5월 10→**0**, currentStock 10 유지. 라면 6월 26→66(6/1 입고 +40 이 자정경계로 누락됐다가 정상 계산된 것 — 개선).
2. **벌크 모달 배경 투명 → 통일(#1)**: `--surface` 미정의(투명)였음 → 다른 모달과 동일하게 `bg-[var(--cream)] border shadow-lift`.
3. **문구(#2)**: '세면'(세면대 연상) 제거 → "보충이 끝나기 전(입주자가 아직 쓰는 중)에 점검하면 …".
4. **아이템별 보정(#3)**: 한번에 전체보정은 임시저장 안 되고 미입력 픽스 우려 → **CheckForm(품목별 점검 폼)에 '전체 보정으로 기록' 체크 토글** 추가(createStockCheck isReconcile 파라미터). 품목별 점검은 드래프트 지원 → 임시저장 가능. 벌크 모달도 유지(차이 있는 품목만 저장 = 미입력 픽스 안 됨).
- tsc·build 통과.

### 2026-06-01 세션 5부 — 전체 재고 보정(총점검) 기능 구현 [SQL 적용됨, 코드 배포 대기]
[[project_inventory_full_reconcile]] 설계대로 v1 구현. 계산/입력 오차로 실제 수량과 차이 날 때 전 품목을 한 번에 보정.
- **스키마**: `StockCheck.isReconcile Boolean @default(false)` + `migrate_stock_check_reconcile.sql`(추가전용). **프로덕션 적용 완료**(idempotent ALTER), prisma generate 완료.
- **보정 점검 = 실측 리셋, 차이는 사용량 아님**: [overview.ts](app/(app)/inventory/overview.ts) 월별 사용량 루프에서 `curr.isReconcile`면 그 구간 소모 합산 skip(차이=분실·오차, 소모 아님). curr 는 다음 구간 기준선으론 그대로. lastPeriodConsumption(평균소모율)도 보정이면 제외. allChecksForUsage select 에 isReconcile 추가.
- **서버액션** [actions.ts](app/(app)/inventory/actions.ts) `saveFullReconcile({date, items[]})`: 차이 0 아닌 품목만 isReconcile 점검 생성(위치 있으면 위치별, 없으면 총량). 트랜잭션·소유권 검증. 읽기는 기존 rows 재사용(별도 액션 X).
- **타임라인**: getItemTimeline 에 isReconcile 전파 + TimelineEntry 타입 + 점검 렌더에 '보정' 뱃지/'전체 보정' 라벨.
- **UI** [InventoryClient.tsx](app/(app)/inventory/InventoryClient.tsx) `FullReconcileModal`: 헤더 '전체 재고 보정' 버튼 → 모달(날짜 DatePicker + **'창고→방 보충 완료' 체크 게이트**(통과해야 입력 활성) + 카테고리별 전 품목 위치별 실측 입력(예상치 프리필: 직전점검 위치별+현재고차이를 허브 가산) + 품목별 '예상/실측/차이' 표시 + 차이 있는 N품목만 저장).
- **E2E 검증(실데이터, 생성→측정→삭제)**: 수세미에 차이 −3 보정 점검 → isReconcile=true 면 6월 사용량 0 유지·currentStock 7 리셋 / 대조(false)면 6월 +3 소모로 잡힘. 정확히 동작. tsc·build 통과.
- **참고/한계**: 과거 달(예: 5월) 오염은 그 시점 백필 데이터 정리 or **과거 날짜로 보정 점검**(DatePicker 로 backdate 가능)해야 교정됨. 완전 2단계 '플로팅 후 끼워넣기'는 v2.

### 2026-06-01 세션 4부 — 재고 점검 '수정' 폼에서 보충 전 사라지고 창고 과차감되던 버그 (배포 `63eb124`)
사용자 보고: 수정 폼 열면 4층 주방 보충 전이 0 으로 뜸("분명 2개 입력했는데"). "이런 식으로 보충 전이 계속 사라지는 거 아냐?"
- **원인([InventoryClient.tsx](app/(app)/inventory/InventoryClient.tsx) CheckEditForm 보충 전 역산)**: `before = restocked > 0 ? qty - restocked : 0`. **보충(창고→이동) 없이 그냥 센 위치는 restockedQty=0** 이라 보충 전이 0 으로 복원됨(=사라진 것처럼). 그 상태로 저장하면 `restock = 보충후 − 0 = 보충후 전체` → 창고(허브)가 그만큼 또 차감 → 열고 저장할 때마다 누적 드리프트(자기강화 버그).
- **수정**: 조건 제거하고 항상 `before = max(0, 보충후 − restocked)` 로 역산 → 보충 없는 위치는 보충 전=보충 후 → 재저장 시 restock 0 (과차감 없음).
- **확인**: 새 점검 폼(CheckForm)은 안전(빈칸 보충 전을 null 로 처리해 과차감 방지 — actions `carryOverFromLastCheck`/null 핸들링). 원래 4층이 restock=12 로 저장됐던 건 이전에 이 버그난 수정 폼을 거치며 박힌 것으로 추정. 실데이터 현재값은 사용자가 재입력해 정상(4층 보충후12·restock10·보충전2).
- tsc·build 통과. SQL 불필요.

### 2026-06-01 세션 3부 — 재고 타임라인 정렬을 '실제 발생 시각' 단일 기준으로 (배포 `646690c`)
사용자 스샷 피드백: 라면 5/13 수령확정 15:11 인데 5/13 점검 16:46 → 흐름상 수령(+160) 먼저, 점검(207) 나중인데 타임라인엔 수령이 점검 **위(더 최신)**로 떠 거꾸로. "항상 실제 시각에 맞춰 순서가 정해져야 한다."
- **원인([actions.ts](app/(app)/inventory/actions.ts) getItemTimeline 정렬)**: 1차 정렬키가 점검=`date`(자정 00:00), 구매=`receivedAt`(시각 포함)으로 **해상도 불일치** → 같은 날 안에서 수령(15:11)이 그 뒤 점검(자정으로 취급)보다 위로.
- **수정**: 모든 entry 를 단일 `effTime`(실제 발생 시각, 시:분)으로 정렬. 구매=`receivedAt ?? date`, 점검·입수=입력 당일(KST)이면 `createdAt`(실제 점검 시각) / 과거 보정 입력(백필, createdAt 의 KST 날짜≠점검일)이면 `date`(백필이 순서 안 깨게). 동률 시 type 우선(점검>입수>구매) 유지.
- **검증**: 실데이터 라면 타임라인 — 6/01 점검 15:23 이 6/01 구매(수령 14:45) **위**로 정상화. 5/13 동일 로직. tsc·build 통과. SQL 불필요.

### 2026-06-01 세션 2부 — 재고 월별 사용량 계산 버그 (입고가 소모량으로 둔갑) fix [배포됨 `0a3ea71`]
사용자 1순위: "월별 사용량 그래프가 합계만 보이고 그 양도 틀림. 입고/이월이 소모량으로 잡히는 것 아닌지."
- **진단(스크립트로 실데이터 추적, 더스테이 제기)**: 그래프는 이미 월별 막대로 그려짐(`599d256`) — 점검 기록이 5월부터만 있어 1~4월이 0이고 5월만 거대해 "합계처럼" 보였던 것. **수치 오류는 진짜 코드 버그**:
  · 소모량 구간 계산이 구매 입고를 `createdAt`(입력시각) 기준으로 배정 → 사용자가 과거 점검을 나중에 보정 입력하면 createdAt 이 며칠~수주 밀려 인접 구간과 겹쳐 **같은 입고를 중복/오배정**.
  · 더 큰 원인: 구간 `consumed ≤ 0` 이면 **건너뛰기(skip)** 했는데, 입고로 재고가 점프한 구간(−)을 건너뛰면 그 입고분이 타이밍 차로 **다음 구간에 +로 더해져 '입고=가짜 사용량'** 으로 부풀려짐. 예) 주방세제 5/15 입고 6080 → 5/14→5/15 −3470 skip + 5/15→5/18 +6680. 라면 입고 160 → 165 소모로 둔갑.
- **수정([overview.ts](app/(app)/inventory/overview.ts))**:
  · 소모량 구간의 구매 입고 기준 `createdAt` → **`date`** 로 통일(additions 와 동일, 구간 겹침 제거). `lastPeriodConsumption`·월별 루프 양쪽.
  · 월별 루프: **음수 구간 건너뛰기 제거 → 부호 그대로 월별 합산(telescoping)** + 월 단위 합이 음수면 0 클램프. 같은 입고의 +/− 가 같은 달에서 상쇄 → 물리적 정답(시작잔량+입고−월말잔량)에 수렴. **백필된 잘못된 점검값에도 자동 면역**(인접 두 구간 +/− 상쇄).
  · `currentStock` 계산은 의도 달라(실사 후 승인 구매 제외) 그대로 둠 — 영향 없음 확인.
- **검증(before→after, 실데이터)**: 라면 5월 187→**115**(=85+입고160−130 ✓), 쌀 159→**77**(=60+입고70−53 ✓), 주방세제 6270(우연히 맞던 값 유지, =3570+6080−3380 ✓), 김치 56.5→18, 세탁세제 25→6, 키친타월 16→9. 전부 물리적 정답과 일치. `npx tsc --noEmit` 통과, `npm run build` 확인.
- **데이터 진단(코드로 자동보정 불가, 사용자 확인 필요)**: 2026-05-28 에 여러 품목 5/12 점검을 일괄 백필함. 그중 **라면 5/12 는 실시간값 49 vs 백필값 135 충돌** → dedup('최신 입력 우선')이 잘못된 135 채택(텔레스코핑이 월합은 상쇄하나 타임라인·현재고 표시엔 잔존). 그 외 같은날 충돌: 김치 5/14(10 vs 19.5), 키친타월 6/01(2 vs 14 — 최신일이라 현재고에 영향). → 화면에서 직접 검토·삭제 권장. (선택) 라면 135 정리 스크립트 별도 가능.
- ⚠️ **남은 것**: 사용자 화면 확인 후 배포(`overview.ts` 단독 변경, SQL 불필요). dedup '최신입력 우선' 규칙이 백필 오류를 선호하는 구조적 약점은 차후 검토.

### 2026-05-27 세션 (#19 할인 기간 입력 UI + #14 후속 할인 미수 3중 반영, 둘 다 배포)
- **#19 월세 할인 '일시(기간)' 입력 수정 (`332dffb`)**: `<input type="month">`가 모달 밖으로 튀어나가고
  입력 방식이 불명확하던 문제([[feedback_date_input]] 위반) → **DatePicker에 `monthOnly` 모드 추가**:
  월 뷰에서 시작, 월 클릭 시 `'YYYY-MM-01'` 반환·닫힘, 표시는 연·월만, 월 뷰에 초기화(무기한) 버튼.
  RoomsClient 할인폼은 scope 셀렉트 전체폭 분리 + 기간 피커를 그 아래 전체폭 행으로 스택(오버플로 해소).
  discStart/discEnd는 'YYYY-MM' 유지 → 피커엔 `+'-01'`/`slice(0,7)`로 변환. (스키마-프리)
- **#14 후속 — 할인을 발생주의 3곳 전부에 반영 (`52b881d`)**: 지금까지 할인은 수납 페이지(getRoomPaymentStatus)
  에만 반영됐고 대시보드·푸시는 정가로 계산해, **할인 입주자가 완납해도 영구 미납으로 잡혀 매일 푸시가 가던** 문제 해결.
  · `dashboard/page.tsx`: 수납현황 위젯(완납 판정·예상 수입)=이달 할인가(billThisMonth), 발생주의 미수 블록=월별
    billForMonth(=discountedRent)로 총예상·FIFO충당·도래/미도래 분리 전부. activeLeases·unpaidLeasesRaw에 discounts select.
  · `dashboard/unpaid.ts`(푸시 cron): 동일하게 billForMonth — 대시보드 건수와 일치 유지.
  · 세 곳 모두 단위테스트된 `lib/rentDiscount.discountedRent` 단일 헬퍼. **할인 없는 계약은 동작 불변**(billForMonth===rentAmount, /tmp 시뮬 검증).
- 검증: `npm run build` 통과. ⚠️ 실데이터(할인 적용 입주자)에서 대시보드 미수납·수납현황·다음날 푸시 일치 최종 확인 권장.
- **#20 재고 점검 '수정' 모달 창고(허브) 처리 일치 + '창고→' 이동 용어 (`074580a`)**: 사용자 캡처 — 수정
  모달에서 **창고(허브) '보충 전'이 0**으로 뜨고 창고 '보충 후'를 직접 입력해야 했음. "보충 +5"가 신규 구매처럼 읽힘.
  · 원인: 수정 모달(CheckEditForm)이 창고를 일반 위치와 동일하게 보충전/후로 다뤄 저장된 `restockedQty`에서 '전'을
    역산 → 창고는 차감되는 쪽이라 restockedQty 없음 → 빈칸(0). 새 점검 모달(CheckForm)은 이미 올바르게 처리 중이었음.
  · 수정: 수정 모달 창고 행을 새 점검 모달과 동일하게 — **이전 잔량**(= 저장된 창고잔량 + 이 점검의 원래 보충합계로
    역산, 캡처 기준 120+15=135) 표시 + **자동 차감 후** 자동계산(직접 입력 불필요, 보정은 가능). 총량 보존.
  · 용어(사용자 결정 — "창고 →" + 보충 라벨 유지): 위치 증가 배지 "보충 +N"→**"창고 → +N"**, 합계 "보충 합계"→
    **"창고 → 이동 합계"**. CheckForm·CheckEditForm·LocationBatchCheckModal·점검 이력 카드 전반 통일. 입력칸 '보충 전/후' 라벨 유지.
  · 빌드 통과. ⚠️ 실데이터 점검 수정 시퀀스(특히 연속 위치점검 머지)에서 창고 이전/차감 표시 최종 확인 권장.
- **작은 후속 정리 (사용자 "작은 후속부터 정리" 선택):**
  · **#1 후속 — 고정지출 관리폼 세부항목 직접 편집 (`811a35d`)**: 서버(items 파라미터)는 이미 준비됐고 settings 폼에
    UI만 없었음 → 세부항목 추가/이름·금액·변동 편집/삭제 UI 추가. 항목 있으면 부모 금액=합계·변동=자동파생(금액칸은 합계
    표시, 변동 체크박스 자동·비활성). 다 지우면 items:[]로 단순지출 복귀(수동금액 유지). 목록에 '묶음 N' 배지·세부요약.
    서버 semantics: items 배열=교체+파생, []=클리어(amount 수동값), undefined=미변경. 저장 후 getRecurringExpenses 재조회.
  · **재고 이월분 정확도 (`fea5c4d`)**: 직전 월 마지막 점검 잔량만 보이던 '이월분'에 **점검 이후~월초 입수**(구매수령·무상)
    합산. 변환은 월별입수(actions.ts)와 동일(구매=qtyValue×spec, 무상=addedQty). '점검 100 + 입수 50 / 잔량 150'처럼
    내역 표시(추정 근거 투명). 점검↔월초 소모는 데이터로 알 수 없어 미반영(본질적 추정). 표시 전용.

### 2026-05-26 운영 피드백 마라톤 (#1~#18, 전부 배포 또는 병합 완료)
사용자가 실사용 중 연속으로 던진 18건. 스키마-프리는 main 즉시 배포, 스키마성 3건은 통합 브랜치
`feat/schema-batch`에 모아 SQL 일괄 적용 후 main 병합(`640e296`). **SQL 3개 프로덕션 적용 완료**
(recurring_expense_items, lease_terms.signatureImageUrl, rent_discounts + expenses.breakdownJson).

**main 배포 (커밋)**
- #2·#4·#5·#6·#7 (`89c2bf3`): 고정지출 기록 버튼 명확화 / 위치점검 창닫힘 / 수납 납부방법 입주자별 /
  고정지출 지난달 방식·계좌 / '이번 달 기록 취소' 라벨.
- #9 (`7a941f7`): 하단바 6탭(홈/방/입주자/수납/지출/재고)+전체. 모바일 '전체' 전체화면 그리드 메뉴.
- #10 (`5deedd7`): 🔔 알림 클릭 딥링크 이동(/tenants?tenantId 등) + localStorage 날짜별 읽음처리·'모두 확인'.
  (원인: 종이 EntityModalProvider 밖이라 useEntityModal no-op)
- #11 (`6c212d2`): 보증금 수납 시 입력금액이 보증금액으로 덮어써져 월세 누락 → 보증금+이용료 전체 프리필.
- #12 (`8cfa9c8`): 방 관리 예약가격 '즉시 적용' 미반영 → rooms useState(initialRooms) 캡처 제거(prop 직접).
- #13 (`188b51d`): 공실 카드 표시정보 선택(창문/방향/층 등, 모바일 칩 최대4) + 방향 옵션 추가.
- #15·#16 (`aab543f`): 체크리스트 → 스테이음 Lab 이동·대시보드 알림 제거 / '지금 급함'→'긴급'.
- #17 (`311d36c`): 재고 알림 단위 박스→kg(specUnit) + 라벨 '입주자 관리'→'재고 관리에서 보기'.
- #18 (`acb593e`): 안드로이드 뒤로가기 반복 로그아웃 완화 — /callback 재진입 가드(이미 인증이면 code 재교환 skip)
  + 로그인 후 window.location.replace. ⚠️ Android 실기기 테스트 필요(잔존 시 refresh-token 회전 레이스 의심).
- #3 (`6f6ae07`): 위치별 재고 점검 허브 과다차감 — 클라가 stale props로 계산하던 것을 서버권위로 전환.
  lib/stockCheckMerge.ts applyLocationCheck(단위테스트). create/updateStockCheck에 locationPatch 모드
  (DB 현재/직전 잔량 base) + 머지 시 시각 갱신. ⚠️ 실데이터 점검 시퀀스 검증 권장.

**스키마 3건 (`feat/schema-batch`→main `640e296`)**
- #8 계약서 출력 서명: LeaseTerm.signatureImageUrl — 서명 시 dataURL 저장, getContractData 반환,
  ContractView 초기값 로드 → 재출력 시 서명 표시.
- #1 관리비 부모+세부항목: RecurringExpenseItem + Expense.breakdownJson. 묶기 UI(기존 항목→부모 전환),
  기록 모달 세부항목(변동 편집)·합계, 지출 상세 breakdown. (남은 것: 관리폼에서 부모 세부항목 직접 편집 — 후속)
- #14 월세 할인: RentDiscount(입주자별·여러개·금액/%·영구/일시). lib/rentDiscount.ts(단위테스트 10/10).
  **수납 관리 미수에 완전 반영**(getRoomPaymentStatus expected·이월·firstUnpaid 월별 할인). 수납 모달 할인 관리 UI.

**남은 것 (검증/후속)**
- ~~#14 후속: 대시보드 미수납 위젯 + 푸시 미수에 할인 미반영~~ → ✅ **완료 (2026-05-27, `52b881d`)** — 위 세션 참고.
- 사용자 라이브 검증 대기: #1 묶기·기록 / #8 계약서 서명 / #14 할인 미수(수납+대시보드+푸시) / #3 재고 점검 시퀀스 / #18 Android.
- #12 보충: 509호처럼 '이미 공실'인데 예약인상이 안 걸린 경우는 즉시적용 버튼으로 처리(즉시적용 자체는 #12로 수정됨).

### 2026-05-26 세션 2부 (운영 피드백 수정 — 고정지출·수납·재고, main `89c2bf3` 배포됨)
사용자 운영 중 발견 버그 7건 중 **명확·저위험 5건 처리·배포**. #3(재고)·#1(재설계)은 아래 '할 일'에 설계/계획 남김.
- **#4 재고 위치별 점검 최종저장 후 창 안 닫힘**: `LocationBatchCheckModal.doSave` 성공 후 `onClose()` 호출 추가.
- **#5 수납 납부방법 입주자별**: 기존엔 localStorage 전역("마지막 쓴 방법", 입주자 무관)이었음 → `getPaymentsByLease`가
  `lastPayMethod`(해당 lease 최근 납부방법) 반환, 모달 열 때 그 값으로 기본 세팅. select에 `key`(lease+method)로 fetch 도착 반영.
  RoomsClient·DashboardClient 둘 다.
- **#6 고정지출 기록 시 지난달 방식·계좌 자동 대기**: `getRecurringExpensesWithStatus`에 `lastPayMethod`/`lastFinancialAccountId`
  (가장 최근 실제 기록 Expense 기준) 추가 → 기록 모달 기본값으로(템플릿값 대신 우선).
- **#2 고정지출 기록 버튼 명확화**: '기록 저장'→'지출로 기록 (정산 완료)', '예약 저장'→'💾 금액만 저장 (정산 안 함 · 나중에 납부)'
  + 안내문. (사용자가 '기록 저장'을 금액만 저장으로 오해 → 정산돼버린 문제.)
- **#7 고정지출 기록 취소 ≠ 항목 삭제**: 지출 상세에서 `recurringExpenseId` 있으면 삭제 버튼 라벨 '이번 달 기록 취소' +
  확인 문구로 "고정지출 항목 자체는 유지" 명시. (handleDeleteExp가 Expense 객체 받도록 변경.)
- 검증: 빌드 통과, 신규 5건 lint 클린(기존 무관 에러만 잔존). UI 시각확인은 iCloud dev 한계로 실기기 권장.

### 2026-05-26 세션 (대시보드 알림 긴급/예정 2존, 배포됨)
- **대시보드 알림 긴급/예정 2존** (main `7e2fb77`, 배포됨): 알림이 고정 카테고리 순서라 급한 걸 놓치는 문제 해결(L 완료).
  · 사용자 선택: UX=긴급/예정 2존, 긴급기준=경과(음수) or D-2 이내(appConfig `ALERT_URGENT_WITHIN_DAYS=2`).
  · **'지금 급함'** 존 — urgencyDays ≤ 2 항목을 카테고리 무관 최상단·긴급순·항상 펼침. **'예정'** — 나머지 카테고리 그룹, 기본 접힘.
  · urgencyDays는 **클라에서 timeLabel 파싱**(urgencyDaysOf)으로 도출 → page.tsx(1900줄 금융 빌더) 미수정, 리스크 최소.
  · DashboardClient AlertsStrip만 변경(+ AlertRow 추출). 종(L-2)은 numeric urgency로 이미 정렬돼 별개. (상세: 할 일 L)
  · 검증: 빌드 통과, urgencyDaysOf 단위테스트 18/18. 2존 시각확인은 iCloud dev 한계로 실기기 권장.

### 2026-05-25 세션 (레이아웃 마무리 + 인앱 알림센터, 둘 다 배포됨)
- **월 셀렉터를 페이지 콘텐츠 상단으로 이동** (main `d948453`, 배포됨): 헤더 스위처 옆 월 네비(◀5월▶)가
  복잡해 보여 각 월-페이지 콘텐츠 상단 우측으로 분리. 헤더는 `[좌] 스위처 … [우] 🔔`로 단순화.
  · MonthSelector(신규, 보이는 컨트롤) + MonthSync(신규, 안 보이는 자동 새로고침 effect 3개, 셸 상주) +
    NavigationContext(신규, AppShell useTransition을 페이지로 공급) 로 ①컨트롤/②자동새로고침 분리.
  · Header에서 월 UI·effect·MonthPicker·MONTH_PAGES 전부 제거. 배치는 ?month 실사용처(dashboard·rooms·finance)만
    — report는 자체 연도 셀렉터, stats는 redirect라 제외. (상세: 할 일 M Phase 1-3)
- **🔔 인앱 알림센터** (main `2138242`, 배포됨): 헤더 종 placeholder → 실제 알림센터. "오늘 챙길 일"
  (미납·오늘 퇴실/투어/입주·재고 소진·수령 대기)을 드롭다운 목록으로, 클릭 시 입주자=EntityModal 제자리·재고=/inventory.
  · **computeAlerts(propertyId) 단일 소스**(app/(app)/dashboard/alerts.ts) — cron(푸시)+종이 공유 → 뱃지 일치.
    cron 리팩터(인라인 countAlerts 제거), getMyAlerts() 서버액션, NotificationBell(신규). (상세: 할 일 L-2)
  · 런타임 검증: 실제 DB로 무에러 완주, 당일 정책 정상(오늘 0건 = 원천 대조 확인). 종 시각확인은 실기기 권장.
- ⚠️ 이 환경 한계 확인: **iCloud Drive라 dev 서버가 상시 Fast Refresh 스래싱** → dev 인터랙티브(클릭→팝오버/드롭다운)
  검증 불가. SSR 스크린샷·서버 런타임은 OK. (메모리 reference_gui_verify 갱신)

### 2026-05-23 세션 (2부 — 푸시 알림·정리·계약서)
- **#5 계약서 통합 페이지 (/contracts)** (feat/contracts-page, 배포 예정): 영업장 전체 계약서를 한곳에서.
  · contracts/actions.ts getAllContractFiles(전체 + 입주자·호실·상태 조인), page.tsx → ContractsClient
    (검색 이름·호실·파일명 / 출처 필터 전체·앱서명·스캔 / 정렬 최신순·입실자별 / 보기(Drive)·삭제 / 입주자 클릭→통합 모달).
  · Sidebar 운영 그룹 '계약서'(IcoContract) 메뉴. 삭제는 tenants deleteContractFile 재사용.
- **푸시 알림 2차 (Vercel Cron 실제 알림)** (feat/push-cron, 배포 예정): 매일 09:00 KST(00:00 UTC) Cron이
  구독 사용자별로 영업장 알림을 web-push 발송 + 뱃지 갱신.
  · app/api/cron/push-alerts/route.ts — CRON_SECRET 인증(Authorization: Bearer, ?secret= 도 허용),
    구독자→영업장(owned+roles) 해소 → countAlerts(영업장,윈도우) 합산 → total>0이면 1건 push("오늘 챙길 일 N건").
  · 알림: 퇴실예정(CHECKOUT_PENDING·expectedMoveOut)·투어예정(WAITING_TOUR·tourDate)·입주예정(RESERVED·moveInDate)·
    수령대기(미수령 tracked 지출) + 재고 소진 임박(computeInventoryOverview 재사용). 윈도우 = appConfig 7일전~30일후.
  · vercel.json crons + CRON_SECRET env(prod/dev) 등록. 만료 구독(410/404) 자동 정리.
  · 재고소진은 inventory/overview.ts(비-server 모듈)로 compute 안전 추출해 cron이 재사용.
  · ⏳ v2b 남은 것: 납부예정(발생주의 getRoomPaymentStatus) — 동일 추출 후 연결, 금융 정확성 런타임 검증 필요.
  · 테스트: 배포 후 `GET /api/cron/push-alerts?secret=<CRON_SECRET>` 로 수동 실행 가능(구독·알림 없으면 sent:0).
- **푸시 알림 1차 (PWA Web Push + 홈화면 뱃지)** (2c32170): 설정→'알림(푸시)'에서 알림 받기/끄기/테스트.
  · public/sw.js(push→showNotification+setAppBadge, notificationclick→딥링크), PushSubscription 모델 +
    migrate_push_subscriptions.sql(프로덕션 적용 완료), settings/pushActions(save/delete/sendTestPush, web-push),
    settings/PushToggle(권한·구독·테스트), next.config serverExternalPackages에 web-push.
  · VAPID 키: .env.local + Vercel env(prod/dev) 등록(NEXT_PUBLIC_VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT).
  · iOS는 홈화면 설치 PWA에서만(16.4+), 권한 1회 허용 필요. 사용자 폰 테스트 미완(차차).
  · 2차(Cron 실제 알림)는 할 일 K 참조.
- **고객 폼 입주희망일 위치 개선 + 통합모달 죽은코드 정리** (feat/quick-polish, 배포 예정):
  · TenantForm: 입주 희망일을 청소비 행 → 상태 클러스터(상태 바로 아래)로. roomIsOptional(투어/예약/취소)이면
    클러스터에 '입주 희망일', 거주단계면 청소비 행에 '입주일'(상호배타 렌더, name=moveInDate 중복 없음).
  · 통합 EntityModal 도입 후 안 쓰이게 된 죽은 서브모달 제거: RoomsClient(TenantInfoModal/RoomInfoModal/
    InfoCol/STATUS_LABEL_RC 꼬리 truncate), RoomManageClient(RoomMgr*Modal/RmInfoCol/STATUS_LABEL_RM 꼬리 truncate),
    TenantClient(SettlementInfoModal/RoomInfoSimpleModal 중간블록 삭제) + 죽은 state·렌더·import 정리.
  · 동작 변화 없음(죽은 코드만 제거). 빌드·정적생성 통과.

### 2026-05-23 세션 1부 (9건, 전부 배포·정상)
- **점검 임시저장(드래프트) UI** (4f72b91): 백엔드(#2 StockCheckDraft)에 UI 연결 — 아이템별/위치별
  점검에 임시저장 버튼·복원·'점검 중' 배지·완료 시 자동 삭제.
- **임시저장 cross-mode 공유** (835c2b7): 아이템별↔위치별 드래프트 상호 반영(savedAt 우선 병합),
  완료/비우기 시 정리. getLocationDrafts 병합 + deleteItemDrafts.
- **재고관리 토글 위치 고정** (b0f6a87): 아이템별/위치별 토글을 제목 옆 우측 상단 고정(모드 전환 점프 방지),
  액션 버튼은 아래 별도 줄.
- **재고 상세 타임라인 월별 끊기** (843f793): 전역 월(?month=) 기준 그 달만 표시. 컷오프 — 점검·무상입수=날짜,
  구매=수령확정(receivedAt, 미수령은 현재 월 이월). 매월 1일자 '이월분' 줄 + 타임라인 월 네비.
- **영수증→재고 병합 확인 기능** (36fe44b): 자동등록 시 라벨 변형 카드 난립 해결. 별칭(LINK)+유사라벨
  후보 제시 → 확인 후 병합(조용히 흡수 X). MergeDecisionModal + MergeRulesModal(거절 되돌리기) + '병합 규칙'
  버튼. TrackedItemMergeRule 모델·마이그레이션 적용됨. (상세: memory project_merge_confirm)
- **고객 명시적 상태 전환** (00afefd): 상세 모달 상단에 상태별 '다음 단계' 버튼(투어완료·예약전환·입실처리·
  퇴실예정·퇴실·비거주/거주전환·입실취소) + 필요값만 묻는 미니폼 → applyStatusTransition(호실·이력 자동,
  퇴실 시 보증금 환불 동시).
- **고객 폼 동적 배치** (00afefd): 연락처를 기본정보 뒤로(이름→연락처 인접), 상태별 단계정보(문의일시·
  투어예정일·예약확정)를 상태 선택 바로 아래로 클러스터링.
- **호실·고객·수납 통합 상세 모달 1·2단계** (56bfbda, 917414f): 전역 공유 모달(components/entity-modal)
  — 어느 페이지든 배경 유지한 채 [호실][고객][수납] 제자리 넘나듦. 수납 뷰에 이번 달 납부 내역(읽기).
  (상세·2b 명세: memory project_entity_modal)
- **Vercel 일시 빌드오류 복구**: 1:30am 배포가 'modifyConfig' 단계에서 일시 실패 → 재배포로 정상화
  (코드 문제 아님, 빌드 캐시/플랫폼 일시 오류).

### 이전 세션 (요약)
- **리브랜딩 1~4단계 완료** (~2026-05-22): Terracotta 팔레트·Arch 로고/파비콘·BrandLoader, 컴포넌트 정합
  (버튼 73개 공유 Btn화, 입력 6px·터치타겟 44px·카드 14px·그림자 shadow-lift·backdrop black/70). 검증 완료.
- **재고 점검 시스템 정비** (2026-05-19~21): 아이템별/위치별 점검, 보충 전·후 입력, 허브 자동 차감,
  '보충 전' 미입력 버그 수정.
- **#4 요청·컴플레인 통합 페이지** 재구현 완료.
- **이메일/인증 인프라** (2026-05-18): stayeum.com 도메인·SSL, Resend 발송·도메인 인증, Supabase 커스텀 SMTP,
  인증 메일 템플릿 5종, 회원가입 폼 개선, 308 리다이렉트.
- **성능** (2026-05-18): 풀스크린 스플래시 제거(경량 스피너+상단 진행바), getClaims 인증, Vercel 리전 서울(icn1).
- 도면 편집기, 재무, 고객/입주자 관리, M7 디자인 시스템 등 — git log 참고.

---

## 할 일 (남은 것)

### ★ 신규 요청 배치 (2026-05-28 사용자) — 1차 완료, 2·3차 남음

**✅ 1차 완료 (코드·로컬, 푸시 전 SQL 적용 필요):**
- **#2 재고 점검 '유지' 버튼** — `app/(app)/inventory/InventoryClient.tsx` 3폼(CheckForm·CheckEditForm·LocationBatchCheckModal) 비허브 행 헤더에 작은 '유지' 버튼 추가. 클릭 → 보충 후 = 보충 전(or 이전 잔량) 자동 채움. LocationBatchCheckModal은 허브 케이스도 잔량 = prev로 채움. [[project_inventory_check_consistency]] 통일 준수.
- **#1e 재고 구매 링크** — `TrackedItem.purchaseUrl String?` 신규(스키마+`migrate_tracked_item_purchase_url.sql` 추가전용). constants/overview/actions 전파, SettingsForm 입력칸 추가(발주 메모 아래), 인벤토리 카드에 '구매 페이지 열기' 외부링크 버튼(외부링크 아이콘+target=_blank+stopPropagation). 향후 제휴 링크 수익모델 활용 여지.
- 빌드·새 코드 lint 클린. ⚠️ **푸시 전 SQL 적용 필요**: `migrate_tracked_item_purchase_url.sql` (ALTER TABLE tracked_items ADD COLUMN IF NOT EXISTS "purchaseUrl" TEXT). SQL 없이 배포하면 인벤토리 페이지 Prisma 쿼리 실패.

**✅ 2차 완료 (코드·로컬, 푸시 전 SQL 적용 필요):**
- **#1c 환경설정 "등급" 옵션 + #1d 호실관리 등급 필터** — 용어 = **"등급"** (DB: `Room.tier`/`Property.roomTierOptions`).
  · 스키마: `Property.roomTierOptions String?` + `Room.tier String?` + `migrate_room_tier.sql` 추가 전용.
  · 환경설정 백엔드: `getRoomTierOptions·addRoomTierOption·deleteRoomTierOption` + 제네릭 `ReorderableField` 에 `'roomTierOptions'` 등록(rename·reorder·reset·revalidate 자동 합류). 기본값 `'스탠다드,실속형'`.
  · 환경설정 UI(`SettingsForm.tsx`): 방타입 OptionSection 바로 아래 **'등급 관리'** OptionSection 추가(설명·placeholder 별도).
  · 호실관리 페이지: `getRoomTierOptions()` fetch 추가 → `RoomManageClient`에 `roomTiers` prop 전파.
  · `room-manage/actions.ts`: `addRoom`/`updateRoom`이 `tier` 폼필드 읽어 저장, `batchUpdateRooms` data 타입에 `tier?` 추가.
  · `RoomManageClient.tsx`: ① Room 타입에 `tier` 추가, ② `filterTier` 상태·리셋·activeCount·필터로직 동기화, ③ 필터 UI에 등급 드롭다운(방 타입 옆), ④ `TierSection` 컴포넌트(등록·수정 폼 둘 다), ⑤ 카드에 등급 칩 표시, ⑥ 상세 모달에 등급 DetailRow, ⑦ `BatchEditRoomsModal`에 등급 미변경/선택 chip 그룹 + state + apply 합류.
- 빌드 통과. ⚠️ **푸시 전 SQL 적용 필요**: `migrate_room_tier.sql` (ALTER TABLE properties/rooms ADD COLUMN). 없이 푸시하면 환경설정·호실관리 페이지 Prisma 쿼리 실패.

**✅ 3차 완료 (코드, SQL 불필요 — 스키마 변경 없음):**
- **#1a + #1b 대시보드 다차원 그룹화** — 사용자 의도는 *기존 '방 현황' 호실 카드의 묶음 단위를 차원 조합으로 바꾸는 것*이었음(개별 통계 위젯 X). 1차 시도 별도 RoomDistribution 위젯은 의도 오해 → 폐기·재작업.
  · **재작업(2026-05-28)**: 별도 위젯 제거(`RoomDistribution.tsx` 삭제, import 제거). 기존 **방 현황 그리드 헤더 아래에 차원 칩 5개**(층·등급·창문·방향·방타입). 다중 선택 + **순서 보존**(앞=상위 묶음). 디폴트 [층] = 기존 동작 유지. 선택 상태 localStorage 보존.
  · 그룹화 = 선택 차원 값들의 카르테시안 곱(빈 그룹 자동 숨김). 라벨은 ' · ' 조인(예: "4층 · 스탠다드"). 정렬은 차원 순서대로 dim별 sortKey 적용(층=숫자, 그 외=사전순, '미지정'은 뒤).
  · 각 그룹 안엔 기존 호실 카드(renderCell) 그대로(상태색·이름·이용료). 차원 0개 선택 시 헤더 없이 한 덩어리(전체) 표시.
  · dashboard/page.tsx rooms select에 `tier:true` + roomsData map에 `tier` 추가(2차 SQL 의존 — `rooms.tier` 컬럼 필요). DashboardData.rooms 타입에 `tier`.
- 빌드 통과. **SQL 변경 없음** (2차 `rooms.tier` 컬럼은 별도 — 이미 필수).

**남은 작업:**
   - 환경설정에 옵션 등록(roomTypeOptions 패턴 미러링: `Property.roomTierOptions` 같은 콤마구분 컬럼 추가).
   - `Room.tier` 필드 신규 + 마이그레이션 SQL.
   - 호실관리에 이 타입 **필터** 추가.
   - **대시보드에 층별 + 타입조합 그룹화 표시** — 예: "4층 + 내창 + 스탠다드", "내창 + 실속형 + 북향" 등 사용자가 차원 조합(층·창문·등급·방향)을 골라 그룹별 카드/숫자로 표시. UX는 다차원 그룹 빌더(드롭다운/칩 다중선택) 형태로 설계 합의 필요.
2. **(재고 구매 링크)** — `TrackedItem.purchaseUrl` 필드 추가 + 인벤토리 카드에서 새 탭으로 바로 열기(target=_blank rel=noopener). 향후 수익모델(아마존 어소시에이트·쿠팡 파트너스 등 제휴 링크) 활용 여지.
3. **(재고 점검 '유지' 버튼)** — 점검 시 보충 전 그대로 유지하는 케이스가 많음 → 보충 후=보충 전을 한 클릭으로 채우는 버튼. 3폼([[project_inventory_check_consistency]] — CheckForm·CheckEditForm·LocationBatchCheckModal) 동기화 필수.

### ★ 운영 피드백 후속 (2026-05-26 — 사용자 확인 대기)

#### ✅ #3. 재고 점검 허브 자동 차감 과다 (위치별 연속 점검 시) — 완료·배포 (`6f6ae07` + `074580a`), 라이브 검증만 대기
> ✅ **해결(2026-05-26~27)**: 클라 stale-props 계산 → **서버 권위**로 전환(`6f6ae07`, `lib/stockCheckMerge.ts applyLocationCheck` 단위테스트) + 수정모달 창고 처리 일치(`074580a`). 아래는 당시 분석 기록(보존). **남은 건 사용자 실데이터 점검 시퀀스 최종 확인뿐.**
- **증상**: 5/22 잔량 155(창고135·4층10·5층10)에서, 5/26 4층 +5 보충·5층 +10 보충 + 실측(4층9·5층11) 하면
  **기대 최종 140**(창고 120+9+11)인데 **135**로 나옴(과다 차감). 또 두 위치 보충이 한 기록에 같이 안 보이고 점검시각도 09:23 고정.
- **원인**: `InventoryClient.tsx` LocationBatchCheckModal `doSave`(1894~)가 허브 차감·타위치 이월을 **props의
  `r.lastCheckLocationBreakdown`(직전 점검값)** 으로 계산. 6h 내 연속 위치점검을 머지(updateStockCheck)할 때 이 값이
  stale하면 앞 점검을 덮어쓰고 허브를 잘못된 기준에서 다시 빼서 과다 차감. (서버 액션 createStockCheck/updateStockCheck는
  받은 locationQtys를 그대로 저장만 함 — 허브 차감이 UI 계산이라 staleness에 취약. actions.ts:452 주석 참고.)
- **수정 방향(예정)**: 허브 차감·이월을 **서버에서 현재 persisted 상태 기준으로 트랜잭션 내 계산**하도록 이전(또는
  클라가 머지 직전 최신 breakdown 재조회). + 머지 시 두 위치 보충 누적 표시 + **점검 시각을 마지막 점검 시각으로 갱신**.
- **검증 제약**: 프로덕션 재고 데이터를 변경(쓰기)하며 테스트할 수 없음 → **계산 로직을 순수함수로 추출해 단위테스트**로
  검증 + **사용자 실제 점검 시퀀스로 최종 확인** 후 배포. (착수 전 이 방식 OK인지 확인)

#### ✅ #1. 고정지출 '관리비' 부모 + 세부항목 재설계 — 완료·배포 (스키마 `640e296` + 후속 `811a35d`), 라이브 검증만 대기
- **맥락**: 관리비를 청소관리비·공용전기비·공과금(기타)·전기안전검사·상하수도요금 등 여러 고정지출로 따로 등록 중.
  한 번에 납부(고지서 1장)인데 영수증을 지출 수정 화면에서 첨부 → 번거로움. "임대관리비 부모 1건 + 세부항목(고정/변동 혼재)".
- **확정 설계(2026-05-26 사용자 답)**:
  ① 장부엔 **관리비 1줄(합계)** + 그 안에 세부항목 내역. ② 세부항목별 고정/변동: **수도요금=변동, 나머지=고정** → 합계는 변동.
  ③ 기존 고정지출을 **'묶기' UI로 선택→부모로 전환**(마이그레이션). ④ 영수증은 그 1줄(Expense)에 첨부.
- **구현 완료(main 병합·배포됨 — 스키마배치 `640e296` + 후속 `811a35d`, 구 작업브랜치 `feat/recurring-expense-items` 병합 완료)**:
  · ✅ 스키마: `RecurringExpenseItem{ recurringExpenseId, name, amount, isVariable, sortOrder }` + `Expense.breakdownJson` + `RecurringExpense.items`.
    `migrate_recurring_expense_items.sql` **프로덕션 적용 완료**. `prisma generate` 완료.
  · ✅ 서버: `getRecurringExpensesWithStatus` items 포함, `recordRecurringExpense` breakdown 받아 합계 기록+breakdownJson.
  · ✅ UI 전부 완료: settings `RecurringExpenseRow.items` + add/update items 수용 + **`groupRecurringExpenses`(묶기)** +
    고정지출 관리 모달 **세부항목 직접 편집**(`811a35d`, 5/27) + 기록 모달 변동항목 금액 편집·합계 + 지출 상세 breakdown 표시.
- **배포 순서(완료)**: SQL 3건은 프로덕션 적용 완료 → 코드 main 병합·배포 완료(`640e296`·`811a35d`). 더 이상 미배포 브랜치 없음.
- **⚠️ 남은 것 = 라이브 검증뿐**: 재무 데이터라 iCloud dev 런타임 검증 불가 → 기록 합계·breakdown·묶기는 **사용자와 함께 실데이터로 확인** 후 신뢰.
- 메모리: 금융 정확성 민감([[project_push_alert_policy]]).

### A. 우선순위 높음 — 운영자(슈퍼관리자) 대시보드 + 베타 접근 관리 ✅ 코드 완료(2026-05-27, 로컬·미푸시) — 활성화 대기
- 앱 안 운영자 전용 영역(/admin 또는 (admin) 그룹). 슈퍼관리자 역할 신규 필요(현재는 영업장 단위 UserPropertyRole만).
- 담을 것: 전체 가입자 조회(실명·이메일·전화·주소), 가입 승인/거절, 영업장 현황·통계.
- 베타 게이팅(당장 필요 — 제한된 테스터만): 가입해도 운영자 승인해야 기능 해제. 쿠폰·초대 코드(선착순 N명 무료).
- 결제·구독(PG)은 추후(쿠폰·승인이 임시 운영 수단): 포트원·토스페이먼츠, 플랜·7일 체험·쿠폰·웹훅·기능 게이팅.

**확정 설계(2026-05-27 사용자 답):** ① 운영자 식별 = **env `SUPER_ADMIN_EMAILS`(부트스트랩·잠김방지) + `User.isSuperAdmin`(DB)** 병행.
② 1차 범위 = **초대코드/쿠폰까지** 포함. ③ 신규 가입 = **전부 PENDING(승인 대기)**, 기존 사용자는 마이그레이션에서 APPROVED 백필.

**스키마 변경(추가 전용):** `enum AccessStatus{PENDING/APPROVED/REJECTED}`, `User.{status(@default PENDING)·isSuperAdmin·approvedAt·approvedBy·inviteCode}`,
`InviteCode{code·note·maxUses·usedCount·autoApprove·isActive·expiresAt·createdBy}`. → **`migrate_admin_beta_gating.sql`**(루트, 추가전용+기존 APPROVED 백필).
⚠️ **배포 순서**: SQL 먼저 적용 → 코드 배포(신규 컬럼/테이블 사용, #1과 동일 제약). 현재 로컬만, 미푸시(다음 작업과 묶어 푸시 예정).

**✅ 체크포인트 1 — 토대 완료(빌드·lint 통과):**
  · schema.prisma 변경 + `prisma generate` 완료. `migrate_admin_beta_gating.sql` 작성.
  · **`lib/auth/access.ts`(신규)**: `isSuperAdminEmail()`(env), `getAccessContext()`(claims+DB, 슈퍼관리자는 status 무관 APPROVED 간주), `requireSuperAdmin()` 가드.
  · **게이트**: `app/(app)/layout.tsx` — claims 확인 직후 `me.status!==APPROVED && !isSuperAdmin → redirect('/pending')`. 앱 전체 단일 게이트.
  · **`app/pending/page.tsx`(신규)**: 승인 대기/거절 안내(브랜드 StayeumWordmark·Terracotta), 로그아웃. 승인됨/운영자면 /dashboard 리다이렉트.
**✅ 체크포인트 2 — 운영자 영역(`app/admin/`, (app) 셸 밖·자체 `requireSuperAdmin()` 가드):**
  · `app/admin/layout.tsx`(헤더+`AdminNav` 탭: 가입자/영업장/초대코드, '앱으로→' 링크) · `app/admin/page.tsx`(→ /admin/users 리다이렉트).
  · **가입자**(`users/page.tsx`+`UsersClient.tsx`): 실명·이메일·전화·주소·상태·가입일·소유/참여수 목록 + 상태필터(기본 '승인 대기') + **승인/거절/대기로** + **운영자 지정/해제**(본인 제외). `actions.getSignups·setUserStatus·setSuperAdmin`.
  · **영업장**(`properties/page.tsx`): 전체 Property + 소유자·방수·입주자수·구성원수·개설일 + 총계. `getPropertiesOverview`.
**✅ 체크포인트 3 — 초대코드/쿠폰:**
  · 운영자(`invites/page.tsx`+`InvitesClient.tsx`): 코드 발급(코드 비우면 STAY-XXXXXX 자동생성)·메모·사용인원(0=무제한)·만료일(**DatePicker**, [[feedback_date_input]] 준수)·자동승인 토글, 목록·활성화/비활성·삭제. `getInviteCodes·createInviteCode·toggleInviteCode·deleteInviteCode`.
  · 가입 연동: `EmailLoginForm` 회원가입에 **초대코드 입력칸** + signUp `options.data`에 real_name·phone·address·invite_code 적재(이메일 인증 ON이면 signUp 직후 세션 없음 → 첫 로그인 때 `syncUserToDB`가 user_metadata에서 회수). `syncUserToDB`에 `redeemInviteCode`(트랜잭션, 선착순 usedCount<maxUses·미만료·active·autoApprove면 status=APPROVED). ⚠️ **Google OAuth 가입은 코드 입력 없음 → PENDING(수동 승인)**.
**✅ 체크포인트 4 — Sidebar 진입점:** layout→AppShell→Sidebar로 `isSuperAdmin` 전달 → 계정 섹션(데스크톱 NavContent + 모바일 MobileMenu)에 슈퍼관리자만 보이는 '운영자'(/admin) 링크.
- **검증**: `npm run build` 성공(/admin·/admin/users·/admin/properties·/admin/invites·/pending 생성), 신규/변경 파일 ESLint 클린(Sidebar의 IcoLab·<img> 경고는 기존). GUI 인터랙티브는 iCloud dev 한계로 실기기/프로덕션 권장.

**⚠️ 활성화에 필요(배포 전/시):**
  1. **`migrate_admin_beta_gating.sql` 을 Supabase에 먼저 적용**(기존 사용자 APPROVED 백필 포함) → 그 다음 코드 배포.
  2. **env `SUPER_ADMIN_EMAILS`** 설정 — 로컬 `.env.local`(적용됨: `stayeum2026@gmail.com,gunwoo80@gmail.com`) + **Vercel(prod) 설정 필요**. (미설정 시 DB `isSuperAdmin`만으로 식별. 미가입 주소는 env만 가능, 가입 후엔 DB 플래그도 가능.)

**✅ 배포됨 (2026-05-27→28):** `990d10c`(A 본체) + `727179f`(게이트 누수 수정) + `3560186`(영업장 0개 운영자 크래시 수정). SQL(`migrate_admin_beta_gating.sql`) 프로덕션 적용 완료. stayeum2026 운영자 셋업 완료(DB 플래그).
- **영업장 0개 크래시 수정(`3560186`)**: 순수 운영자(stayeum2026, 소속 영업장 없음)가 /dashboard 가면 빈 영업장 컨텍스트로 로드 실패("this page couldn't load"). → (app) 레이아웃에서 properties 0개면 운영자→/admin·그외→/property-select 리다이렉트. 운영자 헤더 '앱으로'는 /property-select로 + 영업장 보유 운영자에게만 표시.
- **게이트 누수 수정(`727179f`)**: 게이트가 `(app)/*`만 막아 **`/property-select` 진입점이 무방비**였음(미승인자도 영업장 개설 가능 → 베타 게이팅 무력화). → property-select 페이지·`createProperty` 액션에 승인 가드 추가, **운영자는 소속 영업장 없으면 `/admin`으로 라우팅**(+property-select에 '운영자 페이지' 링크, /pending도 운영자는 /admin으로).
- 운영자 계정 셋업: stayeum2026@gmail.com(주력·영구) 구글 로그인 → 행 생성 후 `UPDATE users SET isSuperAdmin=true,status='APPROVED'` 로 즉시 운영자. gunwoo80은 임시(나중 제거 가능, env에만 두면 한 곳 수정으로 제거).
- ⚠️ Google OAuth 가입은 초대코드 입력 없음 → PENDING(수동 승인). 신규 가입자 관리하려면 운영자 계정으로 /admin에서 승인.

### B. 통합 상세 모달 2b — 수납 '쓰기' 제자리 확장 (신중 작업)
- 수납 등록·납부일 임시/영구조정을 공유 모달 제자리 전체기능으로. RoomsClient 수납 모달(~750줄:
  deposit/cleaning/prev-owner settle/prorate/dueDay override 얽힘)을 페이지 비종속 공유 컴포넌트로 추출 필요.
- **결제 정확성 리스크 큼 → 블라인드 복제 금지, 런타임 검증 가능한 세션에서.** 현재는 '수납 관리에서 열기' 딥링크로 처리.
- 상세: memory project_entity_modal

### ✅ C. #5 계약서 통합 페이지 (/contracts) — 완료 (2026-05-23, feat/contracts-page)
- contracts/actions.ts getAllContractFiles(): 영업장 전체 ContractFile + 입주자·호실·상태 조인, viewUrl(Drive).
- contracts/page.tsx(서버 조회) → ContractsClient: 검색(이름·호실·파일명) + 출처 필터(전체/앱 서명/스캔) +
  정렬(최신순/입실자별) + 목록(보기 Drive 링크·삭제). 입주자 클릭 시 통합 EntityModal(고객 뷰)로 연결.
- Sidebar "운영" 그룹에 '계약서'(IcoContract) 메뉴 추가. 삭제는 tenants/actions deleteContractFile 재사용(Drive 원본도 삭제).
- 남은 개선 여지: 계약서 직접 업로드/생성 진입은 기존 고객 상세(ContractFilesPanel) 유지 — 통합 페이지는 조회·관리 중심.

### ✅ D. 영업장 구성원 초대·참여 (2026-05-28, 코드·로컬 — SQL 적용 후 푸시)
**구현(두 흐름 다 지원):**
- **흐름 A — 이메일 직접 초대**: 기존 settings/actions.ts 의 `inviteMember/updateMemberRole/removeMember`가 이미 동작(기존 UI 그대로 유지, 변경 없음).
- **흐름 B — 참여 코드 (신규)**: 운영자가 6자 참여 코드 발급/재발급 → 공유 → 받은 사람이 영업장 선택 화면에서 입력하면 PENDING 요청 생성 → 운영자가 settings에서 승인/거절 → 승인 시 UserPropertyRole 생성.
- **스키마**: `Property.joinCode String? @unique` + `JoinRequest{propertyId·userId·status·role·message·createdAt·decidedAt·decidedBy}` + `JoinRequestStatus enum(PENDING/APPROVED/REJECTED)`. (영업장,사용자) unique → 거절 후 재요청 시 동일 record를 PENDING으로 갱신.
- **`migrate_join_requests.sql`** 추가 전용. **SQL 적용 후** 코드 푸시 필요.
- **신규 서버 액션** `settings/memberActions.ts`: `getJoinCode·regenerateJoinCode·listJoinRequests·approveJoinRequest·rejectJoinRequest`. 권한: 읽기=requireEdit, 쓰기=requireOwner.
- **사용자 측** `property-select/actions.ts`에 `requestJoinByCode(code, message?)` — getAccessContext 가드(미승인은 차단), 코드로 영업장 찾기, 본인 소유/이미 구성원 검사, JoinRequest upsert(같은 쌍 1개).
- **UI 운영자(settings 멤버 관리 탭)**: 신규 '참여 코드' 박스(발급/재발급/복사) + 신규 '참여 요청' 박스(이름·연락처·메시지·역할 select·승인/거절). 기존 멤버 목록·이메일 초대 박스는 그대로 유지.
- **UI 사용자(property-select)**: '참여 코드로 영업장 참여' 입구(빈 상태/리스트 상태 둘 다). 새 영업장 개설 옆에 점선 보더 버튼. 코드+선택 메시지 입력 → 성공 시 안내.
- 빌드 통과. lint는 기존 CreateForm 인라인 패턴과 동종 4건(기존 컨벤션 유지).

⚠️ **활성화**: 1) `migrate_join_requests.sql` 적용. 2) 그 다음 코드 푸시 → Vercel 배포.

### D. 영업장 구성원 초대·참여 — 미구현 (두 흐름 다 지원, 2026-05-18 결정) — 위 ✅로 대체
- 모델 A: 운영자가 이메일 입력 → 초대 발송. 모델 B: 사용자가 참여 코드 입력 → 운영자 승인/거절.
- 운영자용 "구성원·요청 관리" 화면. 참여 코드는 영업장 개설 시 자동 생성·재발급 가능.
- 신규 초대 = Supabase inviteUserByEmail(admin API), 기존 계정 = UserPropertyRole 행 추가. 초대 템플릿 등록됨.

### E. 이미지 업로드 → 자동 입력 (OCR/AI)
- 이미지 읽어 자동 입력 + 확인 후 반영. 케이스1: 입금 계좌 캡처 → 이름·방번호 → 수납 업데이트.
  케이스2: 영수증 → 지출 자동 입력. 영수증 스캔 일부 구현됨(51b8eb8). Gemini(@ai-sdk/google) 사용 중.

### F. 엑셀 내보내기/가져오기 개선
- 내보내기: 모든 최신 내용 누락 없이. 가져오기: 덮어쓰기/추가/중복선택 방식 사용자 선택.
- 기존: app/api/export, app/api/import, import/preview.

### G. 영업장 랜딩 페이지 + 유입 트래킹
- **공개 페이지 라우트 = `/members/<slug>`** ([[project_public_listing_page]] 정설). 초기 `/stay/<slug>` 시도는 폐기.
- **✅ 1단계 완료**: 첫 영업장(더스테이 제기) 정적 HTML 라이브 — `public/members/thestayjegi/index.html` (배포됨, 3차례 다듬음). 360° 객실 라벨 포함.
- **✅ 유입 트래킹(2026-05-28)**: `@vercel/analytics` 설치 + 루트 layout에 `<Analytics />`(앱 전체) + 정적 랜딩 head에 `/_vercel/insights/script.js`(공개 페이지) → 페이지뷰·referrer·국가 등 자동 수집. **Vercel 대시보드 → Analytics 탭**에서 확인. 무료 한도(2,500/월 hobby, 250k/월 pro) 충분.
- **✅ 정리**: 구버전 `public/stay/thestay-jegi/` 제거 (5/18 1회 커밋 후 방치된 잔재).
- **비전 남은 것**:
  · 2단계 — **회원이 직접 페이지 편집** = 인앱 편집기(Property.slug 필드 + 콘텐츠 저장 구조 + UI). 큰 작업, 별도 세션 권장.
  · 유입 트래킹 **인앱 대시보드 위젯** (Vercel API 또는 자체 events 테이블로 페이지뷰/referrer를 운영자 대시보드에 표시). Vercel Analytics가 외부 대시보드에 있어 1차 가치는 충족 — 인앱 노출은 데이터 쌓인 뒤 자체 트래킹으로 별도 작업.

### H. #6 국가 서류·양식 페이지 (별도 세션 권장)
- DocumentTemplate 모델 신규. 카테고리·태그 + 다운로드 링크/파일 업로드 + 안내 링크.

### I. 작은 개선 (자투리)
- ✅ 고객 폼: 입주희망일을 상태 클러스터로 이동 (2026-05-23 완료, feat/quick-polish).
- ✅ 통합모달 도입 후 죽은 서브모달 코드 정리 (2026-05-23 완료).
- ✅ 재고 이월분: 점검 후 입수분 반영 완료 (2026-05-27, `fea5c4d`). 점검 잔량 + 점검 이후~월초 입수(구매수령·무상) 합산, 내역 표시.

### 보안 점검 (권장 — 2026-05-28 Supabase 메일 계기로 발견)
- **public 테이블 Data API 노출 / RLS 점검**: 이 앱은 데이터 접근을 **Prisma 직결로만** 하고 Supabase는 인증(auth)에만 씀
  (`.from()` 테이블 호출 0건 — 전수 확인). 그런데 Supabase 기본값상 public 스키마 테이블이 Data API(PostgREST)에 노출돼
  있고 RLS가 꺼져 있으면, 브라우저에 노출되는 `anon` 키로 **고객 PII(users.realName·phone·address, tenants 등)가 외부에서
  읽힐 수 있음.** → Supabase 대시보드 **Security Advisor**로 노출 테이블 확인 후 Data API 비활성화 또는 RLS 적용으로 잠글 것.
  (참고: Supabase 2026-05-30 "Data API 기본값 변경"은 **신규 프로젝트만**, 기존은 2026-10-30까지 현행 → 앱 기능 영향 없음. 보안만 별개로 챙기면 됨.)

### J. 나중에 (낮은 우선순위)
- **@stayeum.com 이메일 수신**: 현재 발송만 가능. Cloudflare Email Routing(무료)으로 → Gmail 포워딩.
- **구글 로그인 supabase.co 노출 제거**: 리다이렉트 중 잠깐 노출. 완전 제거는 Custom Domain(유료, Pro). 체감 짧음.
- **이메일 템플릿 디자인 재작업**: 현재 임시(퍼시몬). 로고·브랜드 확정 후 docs/email-templates/ 수정 →
  Supabase 재반영. 같은 트리거로 앱 내 "RoomOS" 텍스트 잔재 정리.

### K. 푸시 알림 (PWA Web Push + 홈화면 뱃지)
- ✅ **1차 완료 (2026-05-23, main 2c32170)**: 서비스워커(public/sw.js, push→알림+setAppBadge, 클릭→딥링크),
  PushSubscription 모델+마이그레이션(적용됨), settings/pushActions(구독 저장/삭제/테스트 발송, web-push),
  설정 '알림(푸시)' 섹션 PushToggle(권한·구독·테스트 푸시). VAPID 키 Vercel env(prod/dev) + .env.local 등록.
  next.config web-push 외부패키지.
  · iOS는 홈화면 설치 PWA에서만(16.4+). 권한 1회 허용 필요.
- ✅ **2차 완료 (2026-05-23, feat/push-cron)**: Vercel Cron 매일 09:00 KST → /api/cron/push-alerts
  (CRON_SECRET 인증) → 구독자→영업장 해소 → 일정기반 알림 카운트 발송 + 뱃지. vercel.json crons + CRON_SECRET env.
  · 알림: 퇴실예정·투어예정·입주예정·수령대기 (윈도우 7일전~30일후) + **재고 소진 임박**. 만료 구독 자동정리.
- ✅ **2b 재고 소진 추가 (2026-05-23, feat/push-v2b-inventory)**: getInventoryOverview 의 compute 로직을
  app/(app)/inventory/overview.ts (비-'use server' 모듈)로 안전 추출 → computeInventoryOverview(propertyId).
  actions.ts는 얇은 래퍼. cron이 이를 재사용해 lowStock(daysUntilEmpty ≤ alertThresholdDays) 카운트 추가.
  (보안: 'use server'에 propertyId 인자 추가 시 타 영업장 조회 우려 → 모듈 분리로 회피.)
- ✅ **2c 알림 정책 변경 + 미납 추가 (2026-05-24)** — 사용자 요청("당일에 있을 일만, 미납만 완납까지 매일"):
  · **일정 기반(퇴실·투어·입주) → '당일'만**: cron 윈도우를 [오늘 00:00, 내일 00:00)로 변경
    (`expectedMoveOut/tourDate/moveInDate: { gte: today, lt: tomorrow }`). 2~3일 후·경과 건은 더 이상 알림 X.
    메시지 라벨도 "오늘 퇴실/투어/입주"로. (기존 ALERT_WINDOW_BEFORE/AFTER 상수 사용 제거)
  · **진행 중 상태 → 해소될 때까지 매일 유지**: 재고 소진 임박·수령 대기(기존) + **미납(신규)**.
  · **미납 신규**: app/(app)/dashboard/unpaid.ts 에 computeUnpaidStatus(propertyId) 추가(비-'use server').
    대시보드 getDashboardData 의 '누적 미납 발생주의' 블록을 **그대로 복제** → 도래·미회수(overduePortion>0)
    건수 = 대시보드 '이달 미수납' 위젯과 동일. cron 이 매일 카운트 발송(완납 시 자동 0). targetMonth=오늘 월.
  · ⚠️ unpaid.ts 는 대시보드 로직 복제본 — 한쪽 수정 시 양쪽 동기화 필수(파일 상단 경고 주석). 장기적으로 단일화 권장.
  · 검증: 빌드 통과. 런타임 건수 일치(푸시 미납 N = 대시보드 이달 미수납 N)는 다음 기회에 확인 권장
    (참고: /accrual-check 라우트 존재). 납부예정(미도래·upcoming)은 정책상 알리지 않음(당일/미납만).

### ✅ L. 대시보드 동적 알림 센터 — 긴급/예정 2존으로 완료·배포 (2026-05-26, main `7e2fb77`)
- **결정(사용자 선택)**: UX = **긴급/예정 2존**, 긴급 기준 = **경과(음수) or D-2 이내**(appConfig `ALERT_URGENT_WITHIN_DAYS=2`, 조정 가능).
- **구현(대시보드 AlertsStrip만 — DashboardClient.tsx)**:
  · **urgencyDays 도출은 클라이언트에서 `timeLabel` 파싱**(`urgencyDaysOf`) — page.tsx(1900줄 금융 빌더) 미수정으로 리스크 최소.
    경과→음수, 오늘/임박/필요→0, "N일 남음"→N, 날짜없음(후보·연락·미정·미처리)→9999(긴급아님). 라벨 바뀌면 9999로 graceful.
  · **'지금 급함' 존**: urgencyDays ≤ 2 항목을 **카테고리 무관** 최상단에 긴급순 정렬 + **항상 펼침**(빨간 헤더).
  · **'예정'**: 나머지를 기존 카테고리 그룹으로, **기본 접힘**(수동 토글). 단 긴급이 0건이면 옛 동작(≤3개 펼침)으로 폴백.
  · AlertRow 컴포넌트로 행 렌더 공유. CATEGORY_ORDER/META 유지.
- **검증**: build 통과, ESLint 신규코드 클린(769 set-state-in-effect는 기존 FinanceTab 이슈·무관),
  urgencyDaysOf 단위테스트 18/18 통과(모든 실제 라벨 형식). ⚠️ 2존 시각/인터랙티브 확인은 iCloud dev Fast Refresh로 불가 → 프로덕션/실기기 권장.
- **종(L-2)과의 관계**: 종은 computeAlerts의 numeric `urgency`로 이미 정렬됨(별개 서브시스템). L은 대시보드 AlertsStrip 전용.
- **남은 여지**: ~~카테고리별 차등 임계값~~ → ✅ 적용(2026-05-28, L 후속). 긴급 항목 within-group 부분펼침(B안 요소)은 필요 시.

#### L 후속 폴리시 ✅ (2026-05-28) — 카테고리별 '지금 급함' 임계값
- 기존: 전역 `ALERT_URGENT_WITHIN_DAYS = 2`로 모든 카테고리 동일 임계값. 미납은 도래 즉시 급하고 재고는 며칠 전부터 급한데 동일 잣대였음.
- 변경: `lib/appConfig.ts` 에 `ALERT_URGENT_CATEGORY_DAYS` 맵 신규. 카테고리별 오버라이드(없으면 전역값 폴백).
  · unpaid 0(도래 즉시) · upcoming 2 · moveout 3 · movein 3 · tour 1 · wish −1(절대 긴급 X) · request 0 · recurring 2 · inventory 5.
- DashboardClient `AlertsStrip`의 urgent 분리 로직: 전역 비교 → `thresholdFor(category)` 호출로 항목별 임계값 비교. `restItems` 도 동일 기준.
- 결과: 진짜 급한 것만 '지금 급함' 존에, 카테고리 본연의 시간 감각 반영. 사업장별 튜닝이 필요해지면 Property 컬럼으로 이전.
- 빌드 통과, 신규 코드 lint 클린. SQL 불필요. 즉시 배포 가능.

#### L(원안). 대시보드 동적 알림 센터 (Dynamic Notification Center) — 2026-05-23 제안
- **문제**: 대시보드 알림이 많다 보니(납부 예정·퇴실 예정·투어 예정·희망호실 조건 매칭 등) 정해진 고정 순서라
  정작 급한 알림을 놓침. 어떤 건 열려있고 어떤 건 닫혀있는데 긴급도와 무관.
- **아이디어**: 도래가 임박한(급한) 것부터 **위로 정렬 + 펼침**, 시간 여유 있는 건 **아래로 + 닫힘/숨김**.
  같은 카테고리 안에서도 급한 항목만 펼치고 나머지는 닫힌 채 유지.
- **예시**: 고정지출이 '내일' 나갈 건이면(지금은 뒤에서 2번째) → 최상단으로 올라오고 그 항목만 펼쳐져 내일 나갈
  것만 표시. 그 아래 칸엔 내일 있을 투어 예정 알림이 펼쳐지고, 투어 알림 중 다음 주 건은 여전히 닫힘.
  → 사실상 **카테고리를 2단(그룹 + 긴급도) 으로 펼치는** 구조.
- **미정(논의 필요)**: ① 알림 종류별 '긴급' 판정 로직(D-N 임계값 등 알림마다 다름) ② UI/UX 방식
  (자동 펼침/접힘이 과한지, 수동 토글과 어떻게 공존할지). 착수 전 함께 설계.
- 연계: K(푸시 알림)의 긴급도 판정과 로직 공유 가능.

#### ✅ L-2. 헤더 우측 🔔 인앱 알림 센터 — (A) 접근으로 완료·배포 (2026-05-25, main `2138242`)
- **구현 요지**: 헤더 🔔 placeholder를 실제 알림센터로 교체. "오늘 챙길 일"(미납·오늘 퇴실/투어/입주·재고 소진·수령 대기)을
  드롭다운 목록으로. 뱃지 숫자 = 항목 수 = 홈화면 푸시 뱃지(구조적 일치).
- **핵심: 단일 소스 `computeAlerts(propertyId)`** (`app/(app)/dashboard/alerts.ts`, 비-'use server') 신규:
  · 미납 = 기존 `computeUnpaidStatus().unpaidLeases` 재사용(로직 변경 없음 → 새 금융 리스크 없음).
  · 오늘 퇴실/투어/입주 = cron과 같은 당일 [00:00,내일) 윈도우 + tenant·room 상세.
  · 재고 소진 = `computeInventoryOverview()` lowStock 필터. 수령 대기 = 미수령 tracked 지출.
  · 각 AlertItem: category·title·subtitle·tenantId(또는 href)·urgency(정렬). `summarizeAlerts()`로 cron 메시지 카운트 생성.
- **cron 리팩터**(`api/cron/push-alerts/route.ts`): 인라인 countAlerts 제거 → `computeAlerts`+`summarizeAlerts` 사용.
  메시지 라벨·순서 동일(미납→오늘퇴실→오늘투어→오늘입주→재고소진→수령대기). **cron·종이 같은 소스 → 카운트 불일치 원천 차단.**
- **`getMyAlerts()` 서버액션**(`alertActions.ts`): 쿠키 영업장+getClaims 인증 → computeAlerts. propertyId 클라 인자 안 받음(타 영업장 차단).
- **NotificationBell.tsx**(클라): 마운트·영업장전환·페이지이동 시 lazy fetch(재고계산 무거워 네비 비블로킹). 빨간 뱃지(99+),
  드롭다운 목록(긴급도순), 항목 클릭 → tenantId는 전역 EntityModal(고객뷰) 제자리, 재고·수령은 /inventory. 빈 상태 문구. 자체 외부클릭 닫기.
- **검증**: build 통과(TS+번들, 서버/클라 경계 OK), ESLint 신규 5파일 클린. **런타임**: 임시 라우트로 실제 DB 호출 →
  computeAlerts 에러 없이 완주, 오늘 0건이 정상임을 원천 대조로 확인(퇴실 3·투어 2·예약 1 존재하나 당일=0, 미납·재고·수령 0).
  ⚠️ 종 드롭다운 **시각/인터랙티브 확인은 iCloud dev Fast Refresh로 불가** → 실기기/프로덕션에서 확인 권장(비어있지 않을 때 목록·딥링크).
- **범위 밖(별도)**: 대시보드 넓은 AlertsStrip·동적 정렬(L)은 그대로. 미납 unpaid.ts↔대시보드 중복 통합은 금융검증 세션에서.
- **남은 것**: (B) 푸시 내역 히스토리 테이블은 미구현(필요 시). L 동적 정렬은 urgency 필드 이미 부여해둠 → 차후 펼침/정렬 UI에 재사용.

#### L-2(원안). 헤더 우측 🔔 인앱 알림 센터 (2026-05-24 제안 — 푸시 UX 논의 중 도출)
- **문제(맥락)**: 현재 푸시 알림은 OS 알림센터(아이폰 알림함)에만 쌓이고, **앱 안에는 알림 내역을 볼 곳이 없다.**
  홈화면 뱃지 숫자만 뜨고(예: "1") 그 숫자가 무슨 알림인지 앱에서 확인할 방법이 없음. 또 앱을 켜둔(포그라운드)
  상태에서 받은 푸시는 iOS가 배너를 숨겨서 뱃지만 올라가, 사용자가 "이유 없이 숫자만 뜬다"고 느낌.
- **아이디어**: 일반 앱처럼 **헤더 우측 상단에 종 모양(🔔) 아이콘 + 안 읽은 개수 뱃지**를 두고, 누르면 알림
  목록(드롭다운/시트)이 뜨고, 항목을 누르면 해당 상세(EntityModal·해당 페이지)로 딥링크. 뱃지 숫자는 홈화면
  앱 뱃지 숫자와 **일치**시킨다(같은 카운트 로직 공유).
- **두 가지 접근**:
  - **(A) 살아있는 알림(현재 챙길 일) 집계 — 추천.** 별도 저장 없이, cron/대시보드가 쓰는 카운트 로직
    (퇴실예정·투어예정·입주예정·수령대기·재고소진+나중에 납부예정)을 그대로 종 안에 모아 보여줌. 일이 해소되면
    목록에서 사라짐 → 뱃지 숫자와 자연히 일치. **L(동적 알림센터)의 인앱 표면(surface)** 으로 딱 맞음.
  - **(B) 받은 푸시 내역 저장(테이블).** Notification 모델 새로 만들어 발송한 푸시를 row로 적재 → 읽음/안읽음
    관리. 진짜 '알림함' 히스토리지만 스키마·발송 시 적재·읽음처리 로직이 추가로 필요. (A)와 병행도 가능.
- **권장 순서**: 먼저 (A)를 L 본체와 함께 설계·구현(긴급도 정렬·펼침 로직을 종 목록에 재사용) → 필요 시 (B) 히스토리 추가.
- 연계: 알림 계산 로직은 **K(cron) · 대시보드 · 🔔 종** 3곳이 공유 → 한 모듈(예: computeAlerts(propertyId))로
  추출해 단일 소스화하면 카운트 불일치 방지(재고 추출 때 쓴 비-'use server' 모듈 분리 패턴과 동일).

### M. 앱 레이아웃 IA 재정리 (2026-05-24 논의·확정) — 익숙함 + 영업장 전환 차별점 + 멀티플랫폼
- **원칙**: 독창성보다 **타 앱(토스·신한SOL·하나카드·애플지갑)과의 익숙함**을 이어가되, 이 앱의 차별점
  (영업장 넘나들기, 사무실 데스크탑 상주 + 모바일 현장 사용 = 멀티앱)은 살린다.
- **현재 셸 문제**(components/layout: AppShell·Header·BottomNav·Sidebar 기준):
  ① 영업장 전환이 우측 아바타 드롭다운 안에 숨음(차별점인데 2단계 진입) ② 🔔 종 없음(L-2 진입점 부재)
  ③ 월 네비(◀5월▶)가 헤더 좌측 주인공 — '월' 무관 페이지(재고·입주자·계약서)에선 노이즈
  ④ 모바일 햄버거+하단 6탭 중복, 6탭은 HIG(≤5) 초과로 빽빽.
- **확정 방향**(사용자 선택): 모바일 **하단 4+'전체'(햄버거 제거)**, 월 네비 **맥락형**.
- **목표 공통 헤더**: `[좌] 영업장 스위처 ▾ … [우] 🔔  프로필`. 데스크탑은 좌측 사이드바 유지.
- **재사용 자산**: getMyProperties()/selectProperty(id)(app/property-select/actions.ts) → 스위처 즉시 활용.
  모바일 '전체' 탭 = 기존 Sidebar 드로어 그대로 열기(이미 전체 NAV_GROUPS 포함, 새 컴포넌트 불필요).
- **단계**: Phase 1 = 헤더(영업장 스위처+🔔+프로필) + 월 네비 맥락형 + 하단 4+전체(햄버거 제거).
  Phase 2 = 🔔 알림센터 내용(L-2) + 대시보드 동적 알림(L). 기존 기능은 **삭제 없이 이동만**.
- ✅ **Phase 1 완료 (2026-05-24, feat/layout-ia-phase1)**:
  · layout.tsx — claims.sub로 영업장 목록(id·name) 직접 조회(getUser 왕복 회피) → AppShell→Header 전달.
  · Header.tsx 재구성 — [좌] 영업장 스위처(selectProperty 재사용, 전환 후 /dashboard) + 맥락형 월 네비
    (MONTH_PAGES=dashboard·rooms·finance·report·stats에서만), [우] 🔔(셸; 내용은 L-2) + 프로필(영업장 관리/로그아웃).
    햄버거 제거. 월 자동 새로고침 로직·MonthPicker 그대로 보존.
  · BottomNav.tsx — 핵심 4탭(홈/방/입주자/수납) + '전체'(버튼) → 기존 Sidebar 드로어 재사용(전체 메뉴).
  · AppShell.tsx — Header에 properties/currentPropertyId 전달, BottomNav onMenuOpen=드로어 열기.
  · 데스크탑 좌측 사이드바 유지. 빌드 통과. (남은 점검: 모바일 헤더 폭 — 영업장명 truncate로 방어, 실기기 확인 권장)
- ✅ **Phase 1 정리 (2026-05-24, 사용자 피드백 "복잡해보임")**:
  · 프로필/계정(이메일·영업장 관리·로그아웃)을 헤더 우측 → **전체 메뉴(Sidebar 하단)** 로 이동.
    헤더 우측은 🔔만 남김. Sidebar에 user prop 추가(AppShell→Sidebar), 데스크탑/모바일 드로어 공통 하단 계정 섹션.
  · 대시보드 상단 **영업장명 배너(h1) 제거**(스위처와 중복) + DataButtons 제거. property findUnique·Suspense·import 정리.
  · **엑셀 가져오기/내보내기(DataButtons) → 환경설정 기본정보 탭** '엑셀 가져오기·내보내기' 카드로 이동(데이터 백업 위).
- ✅ **Phase 1-3: 월 셀렉터 위치 재배치 — (A) 페이지 콘텐츠 상단으로 완료 (2026-05-25, 사용자 (A) 선택)**:
  · **결정**: 헤더의 월 네비(◀ 5월 ▶)가 영업장 스위처 옆에 붙어 "복잡해 보임" → **각 월-페이지 콘텐츠 상단 우측**으로 이동.
    헤더는 이제 `[좌] 스위처 … [우] 🔔`로 깔끔. '기간 선택은 데이터 옆에' 관례 부합.
  · **구현(①/② 분리)**:
    - **components/layout/MonthSelector.tsx (신규)** — 보이는 컨트롤 ◀ label ▶ + MonthPicker 팝오버(우측 정렬 right-0,
      화면밖 방지) + ?month URL push(디바운스 350ms) + 낙관적 localMonth. cream pill+border, 이번달이면 ▶ disabled.
      URL↔로컬 동기화는 **렌더 중 상태조정 패턴**(useEffect 아님; react-hooks/set-state-in-effect 회피),
      ref 동기화만 작은 effect.
    - **components/layout/MonthSync.tsx (신규)** — 안 보이는 자동 새로고침 effect 3개(자정 롤오버·자정 타이머·재진입)만.
      셸(AppShell)에 **항상 마운트**(Suspense fallback=null). useSearchParams 사용.
    - **components/layout/NavigationContext.tsx (신규)** — AppShell useTransition(startNavigation)을 페이지 트리로 공급.
      MonthSelector가 페이지로 내려가며 prop이 끊겨서, 컨텍스트로 전환 로딩 오버레이(BrandLoader) 공유. Provider 밖이면 직접 navigate 폴백.
    - **Header.tsx** — 월 UI·월 effect·MonthPicker·MONTH_PAGES·usePathname/useSearchParams **전부 제거**(244→약 160줄).
      스위처·🔔만 유지. 영업장 스위처 max-w 42vw→60vw(공간 여유).
    - **AppShell.tsx** — <MonthSync/>(Suspense) 마운트 + <main> children을 <NavigationProvider>로 감쌈.
  · **배치 페이지(3곳, ?month 실제 사용처만)**: dashboard(상단 우측정렬 행), rooms(기존 제목옆 정적 {targetMonth} 텍스트를 교체),
    finance(제목과 한 행 justify-between). **report·stats는 제외** — report는 자체 `?year=` 셀렉터(ReportClient) 보유,
    stats는 /dashboard로 redirect만. (기존 헤더 월 네비는 이 둘에선 무동작 노이즈였음 → 제거가 개선).
  · **검증**: `npm run build` 통과(TypeScript·정적생성, 5개 월-페이지 ƒ 동적). ESLint 신규/변경 5파일 클린.
    MonthSelector 모바일 390px 렌더·우측정렬·pill·▶disabled 스크린샷 확인.
  · ⚠️ **GUI 인터랙티브 검증은 불가**(iCloud 환경): 프로젝트가 iCloud Drive라 dev 서버가 거의 상시 Fast Refresh 재빌드 상태
    (클릭 없이도 버튼수 4→0 유지). 팝오버 열림 등 일시상태가 매번 리셋돼 dev 자동검증 불가 — **코드 버그 아님, 프로덕션엔 Fast Refresh 없음**.
    실기기/프로덕션에서 ◀▶·달력 팝오버 동작·모바일 폭 최종 확인 권장. (메모리 reference_gui_verify 의 iCloud 빌드 이슈와 동일 계열)
  · ✅ 배포됨 (main `d948453`).
- 참고: Brand Guide v1.1/v1.2 리스킨([[project_status_colors_pending]])과 색·radius는 별개로 진행 가능(IA 우선).

### N. Prism(프리즘) 본질화 — Phase 1: 공통 하단 네비 통일 (2026-05-30)

- **맥락**: 회전 애니메이션 시도(3D rotateY) 했으나 "휙휙 도는 느낌 전혀 안 남" → 폐기. 본질 재정의:
  Prism = 어디 페이지서 상세 팝업을 열든 **하단에 같은 자리·같은 모양·같은 순서의 3버튼**(호실/고객/수납),
  현재 면은 Terracotta 강조, 연결 대상 없으면 비활성. 안드로이드 시스템 바처럼 어딜 가나 유지.
  스샷에서 확인된 격차: 고객=[삭제][수납정보][호실정보][계약서출력][수정], 호실=[삭제][입주자정보][수납정보][수정],
  수납=[양도인메뉴][입주자정보][호실정보][양도인정산][수납등록] — 라벨·순서·강조·위치 다 다름.
- **Phase 1 (UI 통일만, 클릭 동작은 기존 entityModal.open() 유지)**:
  · 신규 [components/entity-modal/PrismNavBar.tsx](components/entity-modal/PrismNavBar.tsx) — 3버튼 공통(호실/고객/수납),
    `current`·`links`(roomId/tenantId/leaseTermId) prop. 현재 면 disabled+Terracotta, 비활성 면 disabled+opacity-40.
  · [TenantClient.tsx:2123-2150](app/(app)/tenants/TenantClient.tsx#L2123-L2150) — 푸터 2줄(액션[삭제·계약서출력·수정] + PrismNavBar current="tenant").
    useEntityModal 직접 호출 제거(PrismNavBar 내부에서 처리).
  · [RoomManageClient.tsx:897-919](app/(app)/room-manage/RoomManageClient.tsx#L897-L919) — 푸터 2줄(액션[삭제·수정] + PrismNavBar current="room").
  · [RoomsClient.tsx:1836-1905](app/(app)/rooms/RoomsClient.tsx#L1836-L1905) — 푸터 2줄(액션[양도인메뉴·양도인정산·수납등록] + PrismNavBar current="payment").
  · EntityModal 자체 내부 navBtn은 시각 동일(같은 클래스·순서) — `setKind` 인플레이스 전환이라 PrismNavBar로 치환하면 매 클릭 재페치 회귀.
    Phase 1에선 시각 통일만 목표라 그대로 두고, Phase 2 풀팝업 추출 단계에서 자연 정리.
  · 타입체크 클린(npx tsc --noEmit, .next 자동생성 제외).
- **남은 격차(Phase 2/3 — 본질의 본질)**:
  사용자 비전 = 클릭 시 그 면의 **진짜 풀 팝업**이 그 자리에 뜸(현재처럼 미니 요약 EntityModal이 아니라).
  뒷 배경은 처음 들어온 페이지 유지(닫으면 그 페이지로). 이를 위해서는 각 페이지의 풀 상세 팝업
  (Tenant 상세 ~510줄·Room 상세 ~127줄·Payment 상세 ~660줄)을 페이지 비종속 공유 컴포넌트로 추출 필요.
  Payment는 결제 정확성·양도인 정산·임시조정 등 얽힘 커서 [[project_entity_modal]]의 "2b 고위험" 그대로 — 신중한 세션에서.
  Tenant/Room부터 단계 분할 가능.
- **GUI 확인 미수행**: 세션 dev 서버 미가동, 실기기 또는 다음 세션에서 세 페이지 모두 동일 하단바인지 시각 확인 필요.

### N-2. Prism Phase 2.1 — 호실 풀팝업 본문 통일 (2026-05-30)

- **목표**: Phase 1의 "버튼만 통일"을 넘어 본질 — **면 클릭 = 그 entity의 진짜 풀팝업 본문이 그 자리에 뜸**. 호실(저위험·~127줄)부터 진행. 고객·수납은 차후.
- **공유 데이터**: [rooms/actions.ts](app/(app)/rooms/actions.ts) 신규 `getRoomDetail(roomId)` — quickInfo 대비 tier·floor·비거주 가격·areaPyeong/M2·풀 leaseTerms 포함, 상태 라벨/뱃지(`{label, badge:{tone,label}|null}`)까지 서버에서 계산해 돌려줌.
- **공유 컴포넌트**: 신규 [components/entity-modal/RoomDetailBody.tsx](components/entity-modal/RoomDetailBody.tsx) — 자체 fetch + 내부 Lightbox(키보드·스와이프·Drive 원본). props: `roomId`, optional `onApplyScheduledNow`(room-manage 페이지에서만 전달 → 버튼 표시).
- **EntityModal 정리**: [EntityModal.tsx](components/entity-modal/EntityModal.tsx) — 미니 `RoomView`(요약 6필드) 삭제 → `<RoomDetailBody roomId={...} />` 사용. `getRoomQuickInfo` import 제거.
- **RoomManageClient 정리**: [RoomManageClient.tsx](app/(app)/room-manage/RoomManageClient.tsx) — 인라인 상세 팝업의 본문(사진 슬라이더 + 정보행, ~70줄) 제거 → `<RoomDetailBody roomId={r.id} onApplyScheduledNow={...} />`. 부수 정리:
  · `lightboxPhotos/lightboxIndex` state 제거 + Lightbox render 제거 (이제 RoomDetailBody 내부)
  · 로컬 `Lightbox` 함수 정의(~155줄) 제거
  · 로컬 `DetailRow` 함수(~7줄) 제거 — RoomDetailBody 내부로 이동
  · IIFE 안 unused `const tenant` 제거
  · 결과: RoomManageClient 1618 → 1368줄 (-250). EntityModal 230 → 209줄. RoomDetailBody +290줄. 순증 미미, 로직 통일.
- **검증**: `npx tsc --noEmit` 통과(.next 자동생성 제외 0 에러).
- **사이드 효과**: room-manage 페이지에서 상세 팝업 열 때 잠깐 "불러오는 중…" 플리커 가능 — RoomDetailBody가 서버 액션 재fetch. 데이터 신선도는 +1(편집 후 즉시 반영), UX 살짝 -1. 거슬리면 `initial` prop 추가하는 후속 가능.
- **남은 격차**: 헤더(호실번호+상태 뱃지)와 푸터(삭제·수정·PrismNavBar)는 여전히 페이지마다 직접 그림 — 본문만 통일. 다음 단계로 헤더/푸터까지 흡수하면 RoomDetailFull 카드 통째로 공유 가능. 수정·삭제 액션을 callback prop 으로 받는 패턴이면 EntityModal에서도 동일 풀팝업 가능.

### N-2b. Prism Phase 2.2 — 위젯 모델 + PrismShell + room-manage 마이그레이션 (2026-05-30)

- **멘탈 모델 전환**: "페이지 종속 팝업" → "데이터 조합으로 발현되는 뷰". 원자 단위 위젯(InfoRow·PhotoStrip 등)을 entity·view 별로 조합. 페이지가 데이터 소유 X.
- **2중 스택 해소(부분)**: PrismShell 안 PrismNavBar 클릭이 **인플레이스 body 교체** → 같은 셸 안에서 면만 바뀜. room-manage 카드 클릭 진입 → 셸이 곧장 뜸(자체 모달 없음). Phase 2.3/2.4 에서 tenant·rooms 도 셸로 이주하면 2중 스택 완전 제거.
- **신규 위젯 (components/entity-modal/widgets/)**:
  · `InfoRow` — 모든 entity 공유 표시 한 줄
  · `PhotoStrip` — 사진 가로 스트립 + 풀스크린 Lightbox(키보드·스와이프·Drive 원본). 호실 외 entity 사진도 재사용 가능
  · `RoomBasicInfo` — 상태·입주자·타입·등급·기본/예약/비거주 이용료 + 예정 즉시 적용 버튼 (콜백 prop)
  · `RoomSpatialInfo` — 층·창문·방향·면적
  · `MemoSection` — 메모(빈 값 시 미렌더)
- **신규 body (components/entity-modal/bodies/)**: `RoomBody` — 호실 위젯들의 조합. 자체 getRoomDetail fetch.
- **PrismNavBar 확장**: `onSelect` 옵셔널 prop. 셸 내부에선 인플레이스 전환, 페이지 자체 팝업 안에선 entityModal.open() 폴백.
- **EntityModal → PrismShellView 패턴**: kind 라우팅 + footer 액션 행([삭제][수정] for room) + PrismNavBar(onSelect={setKind}). 호실 액션은 셸이 직접 처리 — 삭제(deleteRoom + router.refresh), 예정 즉시 적용(applyScheduledRentNow + router.refresh), 수정(`/room-manage?roomId=X&edit=1` 로 push + close). Tenant/Payment 면은 기존 미니 요약 + 딥링크 유지(Phase 2.3/2.4 에서 위젯화).
- **RoomManageClient 마이그레이션**:
  · 인라인 상세 모달 JSX 완전 제거(~50줄)
  · `detailRoom` state, `closeDetail`, `handleDelete`, `handleApplyScheduledNow` 함수 제거
  · 카드 클릭 → `entityModal.open({kind:'room', roomId})`
  · URL `?roomId=X` → 셸 열림, `?roomId=X&edit=1` → `openEdit(found)` 직접 (편집 폼은 페이지 종속 잔존)
  · deleteRoom/applyScheduledRentNow import 제거 (셸이 사용)
  · 1368 → 1297줄 (-71)
- **RoomDetailBody.tsx 삭제** — 위젯 조합(RoomBody)로 대체.
- **검증**: `npx tsc --noEmit` 통과.
- **사용자 시점 변화**: 호실 관리 카드 클릭 → 동일한 콘텐츠가 PrismShell 로 뜸(헤더·푸터 통일됨). 인플레이스 [고객][수납] 전환 시 새 모달 안 뜨고 같은 셸의 body 만 부드럽게 갈아끼움(2중 스택 X). 수정 누르면 `/room-manage?roomId=X&edit=1` 로 push → 편집 폼 자동 열림(같은 페이지면 무이동, 다른 페이지면 일시 배경 전환 — Phase 2.5 에서 위젯 편집 모드로 흡수 예정).
- **남은 한계**: tenant·rooms 페이지의 자체 팝업 안에서 PrismNavBar 클릭은 여전히 셸을 그 위에 띄움(2중 스택 잔존). Phase 2.3/2.4 가 해소.

### N-3a. Prism Phase 2.3a — 2중 스택 즉시 해소 (2026-05-30)
- **증상**: 고객 관리 페이지에서 상세 팝업 후 [호실] 클릭 시 셸이 그 위에 떠 2중 스택. 수납 팝업도 동일.
- **수정**: TenantClient / RoomsClient 의 PrismNavBar 에 커스텀 onSelect 박아 다른 면 클릭 시 자기 팝업을 먼저 닫고 entityModal.open() 호출. 시각상 2개 모달이 겹치는 순간이 사라짐.
- **`getTenantDetail` 서버 액션 미리 추가** — 2.3b 본문 추출 대비.
- main `c05a47f`.

### N-3b. Prism Phase 2.3b — 고객 본문 위젯화 + 셸의 [고객] 면 풀 콘텐츠 (2026-05-30)
- **목표**: 셸 [고객] 면이 이전엔 미니 요약(6필드) → 이제 진짜 풀 콘텐츠. 어디서 들어오든(대시보드·셸 안 전환·페이지) 동일한 본문.
- **신규 위젯 (components/entity-modal/widgets/)**:
  · `Section` + `Grid` + `Item` (제목 + 2열 표) — 모든 entity 표시 공유 원자
  · `TenantBasicInfo` (이름·호실·영어이름·성별·국적+국기·직업·생년월일·기초수급자)
  · `TenantContactInfo` (주/비상/본국 연락처)
  · `TenantContractInfo` (월이용료·보증금·청소비·납부일·납부방식·입주일·거주기간·퇴실예정·문의일시) — 읽기 전용 (납입일 변경 인라인 폼은 페이지로 위임)
  · `TenantAdditionalInfo` (전입신고·결제수단·현금영수증·방문경로·희망 이동 호실·계약서 URL)
  · `ContractFilesPanel` — TenantClient 의 ~80줄 그대로 이주 (출력/서명·스캔 본 업로드·삭제)
- **신규 body**: `bodies/TenantBody.tsx` — 자체 fetch + 위젯 한 화면 스크롤 조합:
  · 상태 칩 → BasicInfo → Contact → ContractInfo → AdditionalInfo → 메모 → ContractFilesPanel → 수납 요약 카드 3개 + AI 분석 버튼 → "고객 관리에서 더 보기" 딥링크
- **PrismShell 와이어링** ([EntityModal.tsx](components/entity-modal/EntityModal.tsx)):
  · kind='tenant' body = `TenantBody` (이전 미니 `TenantView` 제거)
  · 액션 행 추가 — [삭제] + [계약서 출력] + [수정]. 삭제는 `deleteTenant` 직접, 수정은 `/tenants?tenantId=X&edit=1` push (TenantClient 가 ?edit=1 감지 → 자동 편집 모드)
  · STATUS_LABEL·getTenantQuickInfo import 정리
- **TenantClient URL 핸들링 확장**: `?tenantId=X&edit=1` → 상세 + 편집 모드 자동 진입 (셸에서 [수정] 누르면 페이지로 점프)
- **남은 격차 (Phase 2.3c+)**:
  · 상태 전환 버튼(퇴실예정·비거주 등) — 셸엔 아직 X, 페이지 진입 필요
  · 요청·컴플레인 CRUD — 셸엔 X (페이지에서)
  · 납입일 변경 인라인 폼 — 셸엔 X
  · TenantClient 자체 모달은 그대로 유지 (페이지 진입 + 풀 CRUD/편집 전담)
- **검증**: `npx tsc --noEmit` 통과.

### N-4a. Prism Phase 2.4a — 수납 위젯화 1차 + 셸 in-place 풀모드 (2026-05-30)

- **사용자 비전 확정**: "수납 관리에서 열기" 클릭해도 **배경은 처음 접속한 페이지 그대로**, 프리즘 모듈만 풀팝업으로 in-place 전환. router.push 제거.
- **추출 전략**: 결제 정확성 위험 단계별 분할. 한 세션에 8개 통째 X. 이번 = 저~중 위험 4개. 다음 세션(2.4b) = 고위험 4개.
- **신규 위젯 (components/entity-modal/widgets/)**:
  · `PaymentSummaryCards` — 총수납·잔액·이월액 3카드. settlement prop 만 받음. 읽기 전용.
  · `DiscountWidget` — 월세 할인 추가/삭제. 자체 fetch (getRentDiscounts) + onChange 콜백. 위젯 내부 state.
  · `DueDayTempAdjustWidget` — 납부일 임시 조정. 입력 변환 로직(같은 월 = 숫자/말일, 다른 월 = full date) 그대로 이주. 위젯에 room override prop 필요.
  · `DueDayPermanentChangeWidget` — 영구 변경 + 일할 정산. calcProRata 결과 실시간 표시(extra/refund/none).
- **신규 body**: `bodies/PaymentBody.tsx` — 2 sub-mode:
  · **summary**: SummaryCards + 월 이용료·납부일 + 이번 달 납부 내역(읽기) + "수납 관리에서 자세히 ▼" 버튼
  · **full**: SummaryCards + 월 이용료·납부일 + DiscountWidget + DueDayPermanentChangeWidget + 고급 기능 딥링크
  · 토글: 같은 셸 안에서 in-place body 교체. 배경 안 바뀜. 사용자 비전 본질.
- **PrismShell wiring** ([EntityModal.tsx](components/entity-modal/EntityModal.tsx)):
  · kind='payment' body = `PaymentBody` (이전 `PaymentView` 미니 요약 제거)
  · '수납 관리에서 열기' 푸터 딥링크 **제거** — PaymentBody 내부 모드 토글로 대체
  · 사용 안 되는 getLeaseSettlementInfo·getPaymentsByLease·fmtWon·Loading·Row 정리
- **남은 격차 (Phase 2.4b — 고위험·다음 세션)**:
  · **PaymentRecordList** (편집·삭제) — 귀속월 변경 회귀 위험
  · **PaymentEntryForm** (FIFO 자동 충당) — 알고리즘 정확성
  · **PrevOwnerSettleWidget** — 매출/미납 집계 영향
  · **DepositCleaningSplit** — 분리 저장 로직
  · DueDayTempAdjustWidget 도 만들었지만 PaymentBody 에 wiring 안 함 — override 정보 fetch 추가 필요 (다음 세션)
- **남은 격차 (Phase 2.4c)**: RoomsClient 자체 모달을 셸로 마이그레이션 → 2중 스택 완전 제거.
- **검증**: `npx tsc --noEmit` 통과.

### N-4b. Prism Phase 2.4b — 수납 위젯화 2차: 고위험 4개 + temp adjust wiring (2026-05-30)

- **목표**: 셸의 [수납] 면 full 모드에서 **모든 수납 기능**을 in-place 처리. "수납 관리 페이지로 이동" 딥링크 제거.
- **확인**: `getLeaseSettlementInfo` 가 반환하는 RoomRow 에 이미 `overrideDueDay/Month/Reason`·`depositAmount`·`cleaningFee`·`moveInDate`·`tenantId` 가 다 있음 → 추가 fetch 불필요.
- **신규 위젯 (고위험 3개)**:
  · `PaymentEntryForm` — 일반 수납 등록 (FIFO 자동 충당) + 보증금/청소비 분리 모드 통합. RoomsClient `handleSavePayment` 그대로 이주(savePayment·saveDepositPayment 호출, allocations 결과 토스트, lastPayMethod localStorage). 폼 자체는 위젯 안에서 관리, 저장 후 onSaved 콜백.
  · `PaymentRecordList` — 납부 내역 + 편집 + 삭제. 자체 fetch (getPaymentsByLease). 편집 가능: 금액·납부일·납부방법·메모·**귀속월**(보증금 제외). updatePayment/deletePayment 호출 후 자체 reload + onChange 콜백. 양도인 record 색·뱃지 그대로.
  · `PrevOwnerSettleWidget` — 양도인 메뉴(auto/show/hide) + 양도인 정산 버튼. getPrevOwnerSettleState 로딩 후 canSettle 시에만 버튼 표시. savePrevOwnerSettle 은 한 번만 호출(서버에서 중복 체크), confirm 다이얼로그.
- **DueDayTempAdjustWidget wiring** — Phase 2.4a 에서 만들었지만 안 박았던 위젯을 PaymentBody full 모드에 추가. settlement 의 override 정보 사용.
- **PaymentBody full 모드 확장**:
  · PaymentRecordList
  · "+ 수납 등록" 버튼(접힘) → 클릭 시 PaymentEntryForm 펼침 → 저장 후 자동 접힘 + refresh
  · DiscountWidget · DueDayTempAdjustWidget · DueDayPermanentChangeWidget · PrevOwnerSettleWidget
  · **"수납 관리 페이지에서" 딥링크 완전 제거** — 모든 기능 in-place
- **결제 정확성 보호**:
  · 추출은 UI/state 만 이동, 서버액션은 그대로 호출 (FIFO·일할·정산 알고리즘 변경 X)
  · 각 위젯이 `onChange` 콜백으로 부모(PaymentBody)의 settlement 재fetch 트리거 → 카드/잔액 즉시 갱신
  · confirm 다이얼로그 그대로 (삭제·양도인 정산)
- **검증**: `npx tsc --noEmit` 통과.
- **남은 격차 (Phase 2.4c)**:
  · RoomsClient 자체 수납 모달은 그대로 (페이지 진입 + 풀 CRUD 양쪽 가능)
  · RoomsClient 의 자체 수납 모달도 PaymentBody 위젯들 사용하도록 마이그레이션하면 코드 중복 제거 + 2중 스택 완전 종료
  · 이번 세션은 셸에 풀 기능 추가까지만 (RoomsClient 통합은 별도 세션)
- **회귀 시나리오 (사용자가 프로덕션에서 확인해야 할 것)**:
  · 셸 → [수납] → "수납 관리에서 자세히 ▼" → full 모드 진입 → 카드 + 위젯 다 보임
  · 일반 수납 등록 (예: 미수 있는 월에 2만 입력) → FIFO 자동 분배 토스트
  · 보증금 + 이용료 동시 입력 → 분리 저장
  · 납부 내역 → 수정 → 금액 변경 → 저장 → 카드 재계산
  · 납부 내역 → 귀속월 변경 → 저장 → 미납 상태 재산정
  · 할인 추가 → 잔액 변경 반영
  · 임시 조정 → 그 달만 적용 / 해제
  · 영구 변경 → 일할 정산 → 다음달부터 적용
  · 양도인 정산 → confirm → 미납 집계에서 제외 / 한 번만 가능

### N-3c. Prism Phase 2.3c — TenantClient 셸 마이그레이션 (2026-05-30)

- **고객 관리 페이지 카드 클릭 / URL `?tenantId=X`** → 전역 셸(`TenantBody`) 직행. 자체 인라인 상세 모달 통째 제거.
- **편집 모드만 페이지에 잔존**: 셸 [수정] 버튼이 `?tenantId=X&edit=1` push → TenantClient 가 편집 폼 모달만 띄움. 편집 폼 자체 위젯화는 Phase 2.5 (장기).
- **신규 위젯**:
  · `TenantStatusTransitions` — 상태 전환 버튼(투어/예약/입실/퇴실 예정/비거주/거주 등) + 미니폼 모달 (z=300, 셸 위). transitionsFor() 정의 그대로 이주. applyStatusTransition·recordDepositReturn 호출.
  · `TenantRequestsTab` — 요청·컴플레인 CRUD. 자체 fetch (getTenantRequests). 생성·완료·삭제 + 처리 이력 펼침.
- **TenantBody 확장**: 상태 칩 → 상태 전환 행 → BasicInfo/Contact/Contract/Additional/Memo/ContractFiles → TenantRequestsTab → 수납 분석+AI. reloadKey 패턴으로 status transition 후 재fetch.
- **TenantClient 인라인 상세 팝업 삭제** (~580줄). 편집 모달만 z=260 으로 잔존 (셸 z=280 보다 위).
- **TS 통과**. TenantClient 3817 → 3268 줄(-549).
- **남은 격차**:
  · 납입일 변경 인라인 폼 (계약정보 안) — 셸엔 X, 편집 모드 사용해야
  · 편집 폼 자체 위젯화 — 페이지 종속 잔존 (Phase 2.5)
- **2중 스택 완전 종료**: 호실·고객·수납 세 페이지 모두 셸 진입. 어디서 들어오든 같은 컨테이너.

### N-4c. Prism Phase 2.4c — RoomsClient 셸 마이그레이션 (2026-05-30)

- **카드 클릭 / URL ?roomNo=X 진입** → `entityModal.open({kind:'payment', leaseTermId, roomId, tenantId})` → 전역 셸(PaymentBody)이 모든 수납 기능 in-place 처리.
- **자체 인라인 수납 모달 JSX 통째 제거** (~810줄): 헤더·요약·납부 내역·할인·임시 조정·영구 변경·양도인 정산·수납 등록 폼 — 전부 PaymentBody 위젯들이 대체.
- **2중 스택 완전 종료**: 어디서 들어오든 셸 한 컨테이너만 뜸 (대시보드·고객 페이지에서 [수납] 전환·수납 관리 페이지 카드 클릭 모두 동일).
- **결제 정확성 불변**: 서버액션(savePayment·saveDepositPayment·updatePayment·deletePayment·addRentDiscount·deleteRentDiscount·setDueDayOverride·clearDueDayOverride·changeDueDay·setPrevOwnerSettleMenu·savePrevOwnerSettle) 그대로. UI/state 만 셸로 이동.
- **TS 통과**. RoomsClient 1903 → 1216 줄(-687).
- **후속 청소**: RoomsClient 안에 dead state·핸들러(handleSavePayment 등) + 사용 안 되는 import 잔존 — 기능 영향 0, 별도 정리 세션에서 제거 가능.
- TenantClient 상세 팝업 ~510줄. 탭 3개(상세/요청·컴플레인/AI), 편집 모드, 퇴실예정·비거주 전환 액션.
- RoomDetailBody 패턴 그대로 — TenantDetailBody에 fetch+탭+읽기 표시. 편집은 callback prop.
- 위험: 폼 상태 동기화, 회귀 가능. 데이터는 안 깨짐.

### N-4. Prism Phase 2.3 — 수납(Payment) 풀팝업 추출 (별도 세션 권장)
- RoomsClient 수납 상세 ~660줄. 결제 정확성·양도인 정산·임시조정·FIFO 귀속 얽힘.
- 회귀 테스트 시나리오 통과 후에만 머지(수납 등록·할인·임시조정·양도인 정산 각 1회).
- 메모리 [[project_entity_modal]] "2b 고위험" 그대로.

### O. 호실 셸 enum 라벨 매핑 fix (2026-05-30, b340ad2)
- **증상**: 호실 셸의 창문 타입에 `OUTER`, 방향에 `SOUTH` 등 raw enum 값 그대로 노출.
- **원인**: Phase 2.2 의 `components/entity-modal/widgets/RoomSpatialInfo.tsx` 가 소문자 키(`exterior`/`south`)로 매핑 표를 만들어 매칭이 일어나지 않아 fallback(`val`)이 표시됨.
- **수정**: DB 실제 값은 대문자 enum(`OUTER`/`INNER`, `NORTH`/`NORTH_EAST`/.../`NORTH_WEST`). `RoomManageClient` 의 기존 매핑(대문자)과 일치시키고 소문자도 호환 유지. settings 폼 기준.

### P. 수납 UX 회귀 6건 (2026-05-30, b370207)
사용자 회귀 발견 → 한 번에 6건 잡음.

1. **PaymentEntryForm 금액 자동 프리필** — 미수 있으면(`balance<0`) 그 절댓값(보충액), 없으면 `expected`. `room` 데이터 바뀌면 useEffect 로 재프리필. settlement 에 `balance` 노출.
2. **보증금/청소비 분리 모드 체크박스 숨김** — 기본 숨김 + "보증금·청소비 함께 수납 ▾" 토글로 노출. 첫 달 외엔 거의 안 쓰여서.
3. **PrevOwnerSettleWidget 설명 명확화** — "메뉴 모드"(언제든 변경 가능) vs "양도인 정산 버튼"(계약당 1회) 구분 명시. 모호한 '한 번만' 제거.
4. **PaymentRecordList 레이아웃 재구성** — 줄1=회차·날짜·방법 + 금액(우측, nowrap), 줄2=뱃지(보증금/양도인/귀속월)+메모+액션. 셸 좁은 폭에서도 "귀속 5월" 안 잘리고 270,000원 안 줄바뀜.
5. **공실 '열 설정' 버튼 위치** — 페이지 하단(공실 섹션 헤더) → 상단 필터 행. 공실 0실에도 항상 노출. 라벨도 "공실 표시" 로 변경(메인 표 열 설정과 구분).
6. **StatusBadge sub 가독성** — "8일 초과" 등 색을 흰색(badge fg) → tone별 진한 톤(overdue=coral, unpaid=amber bg, ...)으로. `SUB_FG` 맵 추가. 옅은 행 틴트에서 가독성 회복.

### Q. 계약서 워드마크 색 fix (2026-05-30, 187cb6f)
- **증상**: 계약서 출력 페이지의 'made with 스테이음' 워드마크의 'eum'·Arch 가 브랜드 Terracotta(`#a03c2e`)가 아니라 다른 주황(`#e84a1a`)으로 노출. 메모리 `feedback_brand_wordmark` 위반.
- **수정**: `.made-with` 가 `--persimmon` 까지 오버라이드하던 거 제거. `'stay'` 만 톤 다운한 회색(`--ink: #4a4a4a`)으로 유지하고 `'eum'`·Arch 는 브랜드 색 그대로.

### R. A2 — Dead code 청소 (2026-05-30, 2e50e62) — 합계 −460줄
Phase 2.4c 와 2.3c 의 셸 마이그레이션 후 잔존한 페이지 내 잡동사니 정리. 기능 영향 0.

- **RoomsClient 1216 → 959 (−257줄)**
  · payment 모달 state 다수(`selectedRoom`·`paymentHistory`·`payDiscounts`·`prevOwner*`·`override*`·`payAmount`·`isDeposit*`·`edit*` 등)
  · 핸들러: `handleSavePayment`, `handle*Discount`, `handle*Payment`
  · 미사용 actions/lib imports(`savePayment`·`updatePayment`·`addRentDiscount`·`getPrevOwnerSettleState` 등 + `calcProRata`·`PRORATE_BASE_DAYS`·`fmtKorMoney` 등 UI 헬퍼)
- **TenantClient 3268 → 3073 (−195줄)**
  · 요청·컴플레인 탭 state, AI 분석 state, 상태 전환 미니폼 state
  · 핸들러: `transitionsFor()`, `startTransitionAction`, `runTransition`, `submitTransition`, `handleChangeDueDayAction`
  · 상태 전환 미니폼 JSX 블록
  · 미사용 imports(`analyzeTenantWithGemini`·`applyStatusTransition`·`*TenantRequest` 등)
- **RoomManageClient 1297 → 1289 (−8줄)** — 잔여 주석·미사용 imports(`Loading`/`Badge`/`kstMonthStr`/`withSave`)

**KEEP**: 페이지 자체 카드/필터/정렬/검색·편집 폼·일괄 편집·새 등록 모달.

### S. NotificationBell 청소 (2026-05-30, 37ee518)
- **메모 기록상**: 종 본문·딥링크 미구현. 실제 코드 점검 결과 `NotificationBell` 은 이미 완성됨(`computeAlerts()` 단일 소스, dropdown, 점 색, 딥링크, 읽음 처리 localStorage, "모두 확인", "대시보드에서 보기").
- **잔재만 청소**: 딥링크 URL 의 옛 `&tab=info` 파라미터 제거. Phase 2.3c 후 탭 시스템 사라져서 무용. 셸 진입 정상.

### T. B 잔여 — 푸시 발송 내역 히스토리 (2026-05-30, 18f451c)
- **신규 model `PushHistory`** — `userId`·`source`('cron-daily'|'test')·`title`·`body`·`url`·`badge`·`tag`·`endpointCount`·`successCount`·`sentAt`. 인덱스 `(userId, sentAt DESC)`.
- **`migrate_push_history.sql`** — 테이블 + 인덱스 + FK(`auth.users` cascade) + RLS.
- **cron `/api/cron/push-alerts`** — webpush 발송 후 `prisma.pushHistory.create({source:'cron-daily', endpointCount, successCount})`. 실패해도 푸시 자체엔 영향 X.
- **`sendTestPush`** — 동일하게 `source: 'test'` 로 row 적재.
- **server action `getMyPushHistory(limit=20)`** — 본인 앞 발송 row.
- **신규 `PushHistoryList`** 컴포넌트 — 펼침/접힘, 소스 라벨링(매일 알림/테스트), 상대시간(`방금/분/시간/일 전`), 성공/시도 카운트. 설정 페이지의 `PushToggle` 안에 통합.
- ⚠️ **푸시 전 SQL 적용 필요**: `migrate_push_history.sql`.

### U. #18 후속 — 안드로이드 뒤로가기 google.com/accounts 노출 회귀 (2026-05-30, 2ed5529)
- **증상**: 로그인 후 안드로이드 시스템 백 누르면 google.com/accounts 가 노출됨. 이전 fix(`acb593e`)는 `/callback` 재진입만 막았고 Google OAuth 페이지 자체가 히스토리에 남는 건 그대로였음.
- **수정 2단계**:
  1. `LoginButton` — `skipBrowserRedirect: true` + `window.location.replace(data.url)` 로 Google 이동 → `/login` 이 history 에서 제거.
  2. `/callback` 의 redirect URL 에 `?_fa=1` 부착 → 신규 `AuthBackTrap` 컴포넌트가 첫 popstate 1회 만 소비(`replaceState` 로 `_fa` 제거 + `pushState` 더미 + `popstate` 핸들러 1회 후 해제).
- **마운트**: `AuthBackTrap` 을 root `app/layout.tsx` 에 단일 마운트. `_fa=1` 없으면 no-op 이라 다른 페이지 영향 0.

### V. OCR 트랙 — "찍어 올리기" 패러다임 (2026-05-30~05-31)

**V-1. OCR MVP** (2026-05-30, a2253ba)
- **사용자 비전**: 영수증/물품 사진 찍어 올리면 앱이 분류·요약하고 사용자 검토 후 승인. 직접 입력 패러다임의 대안.
- **신규 model `PendingReceipt`** — `propertyId`·`uploaderId`·`imageUrl`·`driveFileId`·`status`(pending/approved/rejected)·`inferredKind`/`Vendor`/`Date`/`Amount`/`Category`·`parsedJson`·`linkedExpenseId`·`createdAt`·`reviewedAt`.
- **`migrate_pending_receipts.sql`** — 테이블·인덱스·FK·RLS.
- **server actions `app/(app)/dashboard/pendingReceipt.ts`**:
  · `uploadPendingReceipt` — Drive 업로드 + Gemini 2.5-flash 분류('expense'/'inventory'/'unknown') + 필드 추출. AI 실패해도 row 적재(수동 처리 가능).
  · `getPendingReceipts` — 현재 영업장 pending 리스트.
  · `approvePendingReceipt(id, final)` — Expense 생성 + `status='approved'` + `linkedExpenseId`.
  · `rejectPendingReceipt(id)` — `status='rejected'`.
- **`PendingReceiptSection`** — 📸 사진 올리기(camera capture) + 대기 카드 리스트(썸네일·AI 분류 뱃지·요약·등록/거절). 등록 시 인라인 폼(날짜·금액·카테고리·상호·메모) 프리필 후 확인.
- 마운트: `DashboardClient` 의 `AlertsStrip` 다음 행.
- ⚠️ **푸시 전 SQL 적용 필요**: `migrate_pending_receipts.sql`.

**V-2. 재고 분류 케이스 처리** (2026-05-30, f334bef)
- 이전엔 `'inventory'` 분류된 사진은 거절 후 재고 페이지 수동 이동만 가능.
- **AI 프롬프트 확장** — `itemLabel`·`specValue/Unit`·`qtyValue/Unit` 도 추출 ('신라면', '300ml', '6봉지').
- **`approvePendingReceipt` 시그니처 확장** — optional `itemLabel`·`spec*`·`qty*`. 그대로 Expense row 에 저장 → 재고 모듈이 `TRACKED_CATEGORIES`(부식비/소모품비/폐기물 처리비) + `itemLabel` 패턴으로 자동 인식. `revalidatePath('/inventory')` 추가.
- **UI 분기** — 카드에 [지출 등록] + [재고 등록] + [거절] 3액션. AI 추론에 맞춰 강조 색(지출=coral, 재고=green). `editingMode = 'expense' | 'inventory'`. 재고 모드면 폼에 품목명·규격·수량 필드 + 카테고리는 추적 가능 3개로 제한.

**V-3. 영수증 모서리 돋보기 + 계약서/신분증 OCR** (2026-05-31, 14ec148)

1. **CornerLoupe (영수증 모서리 확대경)** — `FinanceClient` 의 `ReceiptScanModal`:
   - 드래그 시작 시 활성 코너 위(공간 부족 시 아래) 120px 원형 확대경 표시.
   - 원본 비트맵에서 코너 중심 영역 잘라 2.8× 확대 + 십자선·중심점.
   - 손가락이 코너 가려도 픽셀 단위 정밀 조정 — 모바일 필수 UX.
   - `CornerHandle` 에 `onStart`/`onEnd` 콜백 추가, `activeCorner` state 로 토글.

2. **계약서 OCR — `analyzeContractWithGemini`** (tenants/actions):
   - 추출 필드: 이름·영문이름·성별·국적·생년월일·직업·주연락처·비상연락처·관계·호실·월세·보증금·청소비·납부일·입주일·계약만료.

3. **신분증/외국인등록증 OCR — `analyzeIdCardWithGemini`** (tenants/actions):
   - 추출: 이름·영문이름·성별·생년월일·국적.
   - 주민번호 앞 7번째 숫자로 19YY/20YY 변환 가이드(내·외국인 5/6/7/8 포함).

4. **`OcrToolbar`** — 입주자 등록·편집 폼 최상단 마운트:
   - 버튼 [📄 계약서] / [🪪 신분증] + camera capture.
   - controlled state(`rentAmount`/`depositAmountVal`/`cleaningFeeVal`/`selectedRoomId`/`applyDueDay`)는 직접 setter.
   - uncontrolled `<input name="X">` 들은 React 네이티브 value setter 트릭(`Object.getOwnPropertyDescriptor(...).set.call(el, value)` + `input`/`change` 이벤트 dispatch)으로 채워서 onChange 가 정상 트리거.
   - 호실은 `roomNo` 정규화 매칭으로 select 옵션 자동 선택.
- ⚠️ **사용자 안내**: 추출 결과 자동 입력. 한글 이름이 영문 칸에 들어가거나 호실 매칭 실패 등 오인 가능 → 반드시 확인 후 저장.

### V-2 (2026-05-31, W 전). 매출 인식 일관성 + 단기·중도퇴실 lease 매출 누락 fix

**버그**: dashboard `totalExpected` / `totalRevenue` 가 ACTIVE/CHECKOUT_PENDING/NON_RESIDENT lease 만 합산. CHECKED_OUT 단기 입주(예: 422호 파트쿨리나 5월 262,500) + 거주 중 중도퇴실(예: 507호 정종학 5/1 5월 귀속 370,000) 매출이 KPI 카드·손익 현황에서 누락.

**원인**: status 필터링이 50+ 곳에 산재. 같은 "매출 인식 대상" 의도인데 곳마다 다른 status 조합. 새 케이스 추가 시 모든 곳을 수동 업데이트 필요.

**조치**:
- `app/(app)/dashboard/page.tsx` totalExpected 에 CHECKED_OUT 의 그 달 귀속 paymentRecord 합 추가 (`a25d6c9`)
- 같은 정책으로 totalRevenue 에도 CHECKED_OUT 입금 인식 (`e0c7cb3`)
- 회귀 방지: `lib/leaseStatus.ts` 신설 — `BILLABLE_STATUSES`, `CURRENT_OCCUPANCY_STATUSES`, `TENANT_LIST_STATUSES`, `CLOSED_STATUSES` 상수화 + `getCheckedOutLeasesWithRevenue()`, `getCheckedOutRecognizedRevenue()` 헬퍼. dashboard 인라인 쿼리 2곳 → 헬퍼 호출로 교체.

**확인된 안전 지점**: dashboard 6개월 trend 는 paymentRecord 기반이라 영향 없음.
**아직 미정정 (영향 작음)**: report 결산 보고서의 미수·임대료 분포 — ACTIVE/CHECKOUT_PENDING 만 기준이지만 통계 용도라 단기 미수 사례에서만 의미 있음. 필요 시 별도 작업.

### V-3 (2026-05-31). 그 외 작업
- /tenants 퇴실자 클릭 → Prism 수납 face (getLeaseSettlementInfo fallback) — `c5019f4`
- Prism [수정] 클릭 시 편집 폼 안 열리는 버그 (useEffect deps 비어있음) — `a1c266a`
- 수납 관리 필터 '임시 조정' 탭 추가 — `976c092`
- PaymentRecordList 회차 표시: DB seqNo(귀속월 기준) → 화면 순(payDate asc index) — `c5019f4`
- StatusBadge sub 가독성: badge-bg(옅음) → badge-fg(진함) — `c5019f4`
- 재고 월별 사용량 막대 + 숨김 UX + 김치 수령일 자동 동기화 (StockCheck.sourceExpenseId) — `5853921`

### V-4 (2026-06-01). 결산보고서 매출 통일 + UI 다듬기 + 재고 사용량 정확성

**결산보고서 매출 dashboard 통일 (`13df2a7`)**: 호실 단위 baseRent 기반 → lease 단위 BILLABLE_STATUSES + CHECKED_OUT recognized 정책으로 통일. 5월 expectedRevenue 14,720,000 → 15,592,500 = dashboard `totalExpected` 와 완전 일치. `lib/leaseStatus.ts` 헬퍼 재사용.

**하단바 즉각 피드백 + 확대경 경계 fix (`04d6e94`)**:
- BottomNav: pendingHref state + useTransition. 클릭 즉시 그 탭 색이 coral 로 + 옅은 배경. pathname 변경 시 자동 해제. active:bg 잔물결.
- CornerLoupe (영수증 OCR 모서리 확대경): source 사각형이 bitmap 밖으로 벗어날 때 destination 위치를 같은 비율로 이동해 핸들 위치가 캔버스 중앙에 유지되게. 잘려 나간 부분은 fillRect 의 흰색 반투명으로.

**Prism 수정 폼 + OCR 토글 + 스크롤 복원 + 계약서 출력 모달 (`c33430c`, `1475282`)**:
- TenantForm 수정 모드에 `ContractFilesPanel` 추가 — 뷰어와 동일 UX 로 스캔본 첨부·삭제 가능.
- '계약서 링크' → '외부 계약서 링크 (Google Drive·Dropbox 등, 선택)'.
- OcrToolbar 기본 접힘 + 펼치기 토글, '(선택)' 명시. 신분증 사진 강요 느낌 완화.
- EntityModalProvider 가 open 직전 `window.scrollY` 저장 → close 시 RAF + 150ms 후 두 번 복원. router.refresh() 의 상단 리셋 회피.
- 계약서 출력: 스캔본 있으면 3-버튼 모달 (`스캔본 출력` / `시스템 계약서 새로 출력` / `취소`). confirm() 의 [확인]/[취소] 패턴이 사용자 의도와 안 맞아 분리.

**모바일 카드 customize + 라벨 명확화 (`c33d0a9`, `a5d60cb`, `7c4c92e`)**:
- 수납 관리 헤더 버튼 라벨 명확화: `공실 표시` → `공실 카드 항목`, `열 설정` → `표시 항목`.
- 모바일에서 `표시 항목` 노출 (이전 hidden sm:block 제거).
- 모바일 입주 카드에 `colVis` 적용 — 타입·연락처·월이용료·미수/예정·납부일·보증금·총납부액 토글 가능. `type` defaultOn true 로 회귀 방지.
- `공실 표시` 드롭다운이 모바일에서 좌측으로 잘리던 문제: 두 버튼을 ml-auto flex 그룹으로 묶어 wrap 새 줄에서도 우측 정렬.

**고정지출 silent fail (`cdefb2e`)**:
- 고정지출 저장 시 액션 응답 ok/error 미체크 → DB 변경 안 됐는데 폼 닫히거나 사용자 재시도로 중복 등록.
- `handleSaveRec` / `handleDeleteRec` / `handleToggleRec` 에 try/catch + ok 체크 + showToast + router.refresh().

**재고 위치별 점검 carryOver + 데이터 보정 (`e206764`)**:
- 품목별 점검 폼 (`CheckForm`) 에서 위치 일부만 입력하면 나머지가 0 으로 처리되어 다음 점검에서 "큰 소모" 로 오인되던 문제.
- `createStockCheck` 에 `carryOverFromLastCheck` 옵션 추가 — 입력 안 한 위치는 직전 점검에서 자동 보존. CheckForm 이 그 옵션으로 호출.
- `scripts/fix-stockcheck-carryover.ts` 로 과거 손상 데이터 보정 (적용): 주방세제 +2670 / 김치 +4 / 세탁세제 +19 / 수세미 +1. 라면·쌀은 위치 누락 없음 — 별개 이슈.

**같은 날 여러 점검 dedup (`9cebcc1`)**:
- `overview.ts` 에 `dedupSameDay` 헬퍼 — 같은 UTC 날짜 점검 중 가장 늦은 createdAt 만 유효.
- `it.stockChecks` (take 2→10) + `allChecksForUsage` 양쪽 적용.
- 사용자가 같은 날 임시 점검 후 확정 점검을 다시 할 때 두 점검 사이 잔량 jump 가 사용량으로 누적되던 문제 fix.

**타임라인 정렬 receivedAt 기준 + 세탁조크리너 정리 (`13d568b`)**:
- 구매(purchase) entry 의 시간 기준이 createdAt(=입력 시각)이라 과거 수령분을 늦게 입력하면 위치가 어긋남.
- 정렬 키 변경: purchase 는 receivedAt 우선 → date/createdAt fallback. 동률 시 type 우선순위 check > addition > purchase (점검이 수령 위).
- 세탁조크리너 데이터: 부식비 → 소모품비 카드 이전 + Expense itemLabel null 채움.

**월별 사용량 막대 숫자 노출 (`599d256`)**:
- '월별 사용량' 인데 합계만 보이고 막대만 있어서 각 월 사용량을 알기 어려움.
- 각 막대 위에 그 달 사용량 숫자 표시 (1000+ k 축약). 합계는 우측 상단 작게.

**📌 라면 187·쌀 159 같은 큰 값의 진짜 원인**:
- 위치 누락(3)·같은 날 dedup(4)·정렬(5,6) fix 후에도 잔존.
- 원인: 점검 잔량 또는 구매 수량 자체의 입력 오류 (예: 라면 5/12 135 → 5/13 207 = +72 점프 + 같은 시점 구매 160. 기대 135+160=295 vs 실제 207 → 88 차이가 가짜 "사용량" 으로 누적).
- 코드로 자동 보정 불가. 사용자가 화면에서 직접 점검·구매 데이터 검토·수정 필요.

**월별 사용량 계산이 단순 차이가 아닌 이유 (사용자 설명 요청)**:
9가지 변수가 섞임: ① 구매(+) ② 무상입수(+) ③ 위치 여러 곳 ④ 같은 날 여러 점검 ⑤ 수령일≠입력일 ⑥ 자동 점검 vs 사용자 점검 시각 일치 ⑦ 점검 잔량 입력 오류 ⑧ "보충 전/후" 잔량 의미 혼재 ⑨ 자동 vs 수동 점검 신뢰도. 오늘 fix 들이 ①③④⑤⑥ 을 잡음.

### W. 남은 트랙 (다음 세션)
- **OCR 후속**: 보증금 반환·수익 분류 케이스, 더 다양한 분류(예: 임대료 영수증)
- **공실 안내 페이지 2단계** — 인앱 편집기 (큰)
- **Brand Guide v1.2 잔여 점검** — 상태색·radius 누락 부위 훑기 (작)
- **국가 서류 (H)** — 외국인 입주자 신고·신원 서류 (큰)
- **Phase 2.5 — 편집 모드 위젯화** — 호실/고객 편집 폼 → 셸에서 in-place 편집 (큰)
- **납입일 변경 인라인 폼** — Tenant 계약 정보 안 dueDay 변경 위젯 (작)

### W-검증. 사용자가 직접 돌려야 할 회귀 (2026-05-31 기준 미완료)
- **결제 정확성 회귀** — Phase 2.4 의 9개 시나리오(FIFO·할인·임시조정·영구변경·양도인정산·보증금분리·내역편집·삭제·납부).
- **OCR MVP 검증** — SQL 적용 후 영수증/물품/계약서/신분증 사진 올려서 분류·등록 흐름.
- **#18 뒤로가기 fix 검증** — 안드로이드에서 로그인 후 시스템 백 → google.com/accounts 안 뜨는지.

---

## 참고 / 주의사항
- AGENTS.md 세션 시작 규칙 — 매 세션 이 파일을 먼저 읽고 이어갈 것.
- 컨텍스트가 차오르면 /compact 또는 새 세션으로.
- rewind는 코드를 되돌리니 신중하게 — 컨텍스트 줄이는 용도로 쓰지 말 것.
- 배포: main push → Vercel 자동 배포. 일시 빌드 실패 시 재배포(`vercel redeploy <url>`)로 대개 복구.
