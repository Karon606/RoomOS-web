# 도메인: 계약서 / 동의서

핵심: `app/contract/[tenantId]/{ContractView.tsx, actions.ts}`, `lib/contract.ts`, `lib/contractPrintHtml.ts`, `app/api/contract/generate/route.ts`.

## 결정: 동의서 수신인 '○○ 대표 귀하' 유지 (2026-07-01)
잔여 소지품 임의처분 동의서 하단 "○○ 대표 귀하"(contractPrintHtml:153·ContractView:724)는 **의도된 표준 서식**. 이 동의서는 입주자가 작성·서명해 대표(운영자)에게 제출하는 서류라, '귀하'는 시스템이 운영자를 높이는 게 아니라 제출자(입주자)가 수신인을 높이는 것 — 유지 결정(오류신고 88c2f268). 존칭 규칙: 개인=귀하, 기관=귀중.

## 서명 저장
- 입실계약서 서명: `LeaseTerm.signatureImageUrl`(dataURL). 출력 에디터가 불러와 재표시.
- 동의서(잔여 소지품 임의처분) 서명: `LeaseTerm.disposalSignatureImageUrl`(2026-06-29 추가). generate route가 best-effort 저장(컬럼 미적용 시에도 PDF 안 깨짐).

## 환불 조항
계약서 `{{환불규정}}` 변수 = 환경설정 환불정책으로 자동 생성(`buildRefundClause`). 토글로 표시 on/off. 공정위 고정문구 모드.

## 주소
입주자 주소 = 영업장 주소 + 방번호(별도 필드 없음). [[goshiwon-tenant-address]]

## 인쇄 = 한 장 맞춤 (2026-06-29 해결)
화면 미리보기(ContractView)는 `transform: scale()` + `min-height:297mm`로 한 장처럼 보이지만,
PDF(`lib/contractPrintHtml.ts`)는 별도 CSS·원본 크기라 가용높이 초과 시 다음 장으로 넘쳤음.
**해결: `app/api/contract/generate/route.ts` 에서 shrink-to-fit** — 의도 페이지 수(html의 `.paper` 개수:
계약서 1 + 동의서 옵션 1)보다 많으면 한 장에 맞을 때까지 `page.pdf({ scale })` 단계적 축소(**하한 0.88 = 가독성 바닥**, 최대 12% 축소).
**축소(≥88%)로도 못 맞추면 = 내용이 매우 많음 → 원본(100%)으로 되돌려 '읽기 좋은 크기 + 다중 페이지'로 출력**(미세글자화 방지, 2026-06-29). 즉 글씨는 절대 88% 미만으로 작아지지 않음.
동의서는 `page-break-before` 로 항상 별도 장이라 '서류별 한 장'이 목표(전체 1장 강제 아님).
**여백 상하좌우 14mm 대칭**(헤더/푸터 간격·좌우 동일). 좌우 14mm 는 표 우측 테두리 잘림 방지.
주의: 화면(ContractView)·브라우저인쇄(@media print)·PDF(contractPrintHtml) 가 **CSS 3벌**이라 픽셀 동일은 아님 — 출력 기준은 PDF(발급).

### 조항 2단 = 화면=PDF 동일 (2026-06-29)
**CSS 멀티컬럼(`column-count:2`)은 Chrome 인쇄(고정 페이지)에서 1단으로 흐른다**(화면=무한높이라 2단, PDF=1단 → 세로 길어져 다음 장). 그래서 화면·PDF **둘 다 명시적 2단(flex)**: `lib/contract` `splitClauseColumns` + `.clauses{display:flex;gap:7mm} .clause-col{flex:1;min-width:0}`. flex 는 인쇄에서도 2단 유지.
- ⚠️ **조항 순서 절대 불변**: `splitClauseColumns` 는 **문서 순서 보존 분할**(앞에서부터 순서대로, 누적 절반 지점에서만 좌→우). 항목수 그리디로 분배하면 순서가 뒤섞임(좌 1·3/우 2·4) — 절대 금지. 왼쪽 단 위→아래, 오른쪽 단 위→아래로 읽으면 1,2,3,4 그대로여야 함.
- **계약서 레이아웃 바꿀 때 두 파일(ContractView·contractPrintHtml) CSS·구조를 항상 같이 수정**(드리프트 주의).

### 인쇄/PDF 버튼 동작 (서버 PDF 단일 소스로 통일, 2026-06-29 최종)
**핵심: 인쇄·저장·발급 모두 같은 '서버 puppeteer PDF'(contractPrintHtml) 하나만 쓴다** → 결과물(레이아웃·페이지 수) 100% 동일.
- **window.print(화면 직접 인쇄)는 폐기**. 이유: 브라우저가 배율·페이지나눔을 제어해 서버 PDF 의 한장맞춤(shrink-to-fit)을 못 따라가 페이지 수·레이아웃이 달라짐(실제 비교 결과 계약서 1장 vs 2장, 비상연락망 칸·계약번호 유무 차이). CSS 2벌 드리프트의 근본 원인이라 화면인쇄 경로 자체를 제거.
- **전달 방식만 기기별 분기**(결과 PDF 는 동일):
  - **모바일(터치 기기)**: `navigator.share({files:[pdf]})` 네이티브 공유 시트 — 프린트·파일에 저장·메일이 한 곳에. 버튼 1개('인쇄 / PDF'). 감지: `maxTouchPoints>0 || /Android|iPhone|iPad|iPod/` && `navigator.canShare`.
  - **데스크톱**: 버튼 2개 — **인쇄**(서버 PDF 를 새 탭에 열어 Cmd+P) / **PDF 저장**(blob 다운로드).
- **계약서 저장(발급)** = 서버 PDF 를 Drive 저장 + ContractFile 기록(공식 보관). preview 모드(`body.preview`)는 Drive/DB·서명영구저장 미접촉.
- 서명 없이도 생성 허용(서명란 '(서명)' 자리표시). 빈 서명은 저장된 서명 안 지움.
- ⚠️ 이모지 금지(운영자 지시) — 버튼 라벨에 아이콘 문자 쓰지 말 것.
- ⚠️ 화면 미리보기(ContractView @media screen)와 출력(contractPrintHtml)은 여전히 CSS 2벌이지만, **출력은 항상 contractPrintHtml 단일**이라 인쇄=저장=발급이 같음(미리보기만 근사).

### 표시값 오버라이드 = 발급물 전용, 수납 무접점 (2026-08-05, 운영자 승인)
관 제출용처럼 **실계약과 표기가 다른 계약서**가 필요할 때(홍은주 비거주 건), 실계약(LeaseTerm 원천 컬럼)은 그대로 두고 `LeaseTerm.contractFieldOverrides`(sparse Json)에 표시값만 저장한다. '조건부 할인은 계약서=정가, 수납만 할인' 규칙의 연장.
- 정본은 `lib/contractFieldOverrides.ts`(파싱·검증·병합 한 벌). 소비처는 `buildContractData` 와 generate route 두 곳뿐 — **청구·수납 엔진은 이 컬럼을 모른다.**
- 편집 대상 8필드: 입실료·보증금·청소비·입실일·퇴실예정일·매월 납부일·호실·전입신고 표기. **신원 4종(성명·연락처·생년월일·성별)은 고객정보가 정본이라 안 연다.**
- UI 는 계약서 보기 정보 표 인라인 입력(§30 규칙 3). no-print 입력 + only-print 텍스트 쌍이라 종이엔 안 나간다. 서명 확정 후엔 bodyLocked 파생으로 함께 잠긴다.
- 저장·본문편집·복귀 시 **미서명 활성 링크를 자동으로 닫는다**(낡은 스냅샷으로 서명받는 사고 봉합). 제출된 링크는 닫지 않는다 — 발급 리마인더가 closedAt:null 조건(2026-07-23 결정).
- generate API body 로 금액을 받지 않는다 — 값은 DB 단일 출처(API 직접 호출로 임의 금액 발급 방지).
- 감지망: check-contract-override-lock G5 축(서명 후 표시값 편집 대조).

### 서명 지우기 = 서버 저장 서명도 X 버튼으로 (2026-08-05, 운영자 요청)
원격 링크 서명은 **서명 순간 서버에 저장**된다(제출 전이라도). 잘못 서명하면 지울 길이 없었다(홍은주 동의서 사건). `clearContractSignature(leaseTermId, 'contract'|'disposal')` 가 해당 서명 두 칸을 지우고, **서명 네 칸이 전부 비면 signedContractSnapshot 도 함께 지운다**(생사 동일 원칙). 열린 링크(미제출)는 함께 닫는다 — 지운 서명의 출처가 열려 있으면 되살아난 것처럼 보인다.
- ⚠️ Prisma 7 에서 Json 칸 비우기는 `Prisma.DbNull`. `{ set: null }` 은 컬럼에 문자 그대로 `{"set": null}` 값이 저장된다(실측). resetContractOverride 가 이 방식이어서 '공통 템플릿으로'가 본문을 그 객체로 만들 뻔했다 — 세 곳 모두 DbNull 로 통일(2026-08-05 봉합).
- X 버튼은 서버 서명이 있으면 danger 확인창 후 삭제, 화면 임시 서명만 있으면 즉시 로컬 삭제. 삭제 시 capturedAt 로컬 상태도 함께 비운다(안 비우면 파생 잠금이 잠긴 채 남는다).

### 버전 폐기 = 증거를 남기고 잠금만 푸는 유일한 문 (2026-08-19, 신고 63cd1049)
발급본 삭제(`ContractFile.deletedAt`)는 **잠금 사슬의 어느 고리도 아니다.** 서명 네 칸이 그대로라 계약서는 여전히 잠겨 있고, 오히려 마지막 부를 지우면 `/contracts` 발급 대기가 되살아나 옛 스냅샷으로 재발급을 권한다(501호 실측 — 한글 이름 계약서를 지우고 다시 발급했더니 같은 한글 이름이 또 나왔다).
- **폐기 = 서명 네 칸·격리본·오버라이드 사본을 `LeaseTerm.contractVersionArchive`(append-only Json)로 옮기고, lease 의 그 칸들만 비운다.** 발급본과 `issuedSnapshot` 은 손대지 않고 `ContractFile.voidedAt` 도장만 찍는다. 살아 있는 서명 링크는 전부 닫는다(발급 대기·종 알림 동시 해소).
- 정본은 `lib/contractVersion.ts` + `voidContractVersion`. **결과가 '서명 0' 이 되는 갈래는 전부 이 문을 지난다** — 전량 삭제('all')도 마지막 한 장 삭제도. 그러지 않으면 증거 파괴 경로가 하나 남는다.
- 적용취소(`restoreContractVersion`)는 폐기 직전 상태를 그대로 복원하되, 그 사이 새 서명이 들어왔으면 거부한다.
- **폐기 후에는 재서명이 필요하다.** 이름 표기가 잘못된 계약서는 정정본에 다시 서명받는 것이 계약 실무의 정석이고, '서명은 A 에 했는데 B 를 발급하지 않는다'(2026-08-03)와 같은 자리다.
- 잠금 안내 세 곳(표시값·본문·계약일)이 이 버튼을 가리킨다. 종전 문구 "서명란의 X 버튼으로 지우면"은 잠금이 네 칸 OR 인데 단수로 말해 거짓이었다(서명 둘이면 X 하나로 안 풀린다).
- 감지망: G7(폐기 이력 증거 결손) 신설, 계약일 정합 축 1 에서 폐기본 제외, G1·G5 대조 대상을 `isCurrentSignatureLink`(지금 서명을 만든 링크)로 한정. 드리프트 비교도 같은 정본을 쓴다 — 안 그러면 폐기 후 재작성이 허위 경고를 만들고 그 경고의 '재서명 받기'가 방금 받은 서명을 다시 폐기한다.
