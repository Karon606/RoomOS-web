# 도메인: 계약서 / 동의서

핵심: `app/contract/[tenantId]/{ContractView.tsx, actions.ts}`, `lib/contract.ts`, `lib/contractPrintHtml.ts`, `app/api/contract/generate/route.ts`.

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
계약서 1 + 동의서 옵션 1)보다 많으면 한 장에 맞을 때까지 `page.pdf({ scale })` 단계적 축소(하한 0.78).
동의서는 `page-break-before` 로 항상 별도 장이라 '서류별 한 장'이 목표(전체 1장 강제 아님).
**여백 상하좌우 14mm 대칭**(헤더/푸터 간격·좌우 동일). 좌우 14mm 는 표 우측 테두리 잘림 방지.
주의: 화면(ContractView)·브라우저인쇄(@media print)·PDF(contractPrintHtml) 가 **CSS 3벌**이라 픽셀 동일은 아님 — 출력 기준은 PDF(발급).

### 조항 2단 = 화면=PDF 동일 (2026-06-29)
**CSS 멀티컬럼(`column-count:2`)은 Chrome 인쇄(고정 페이지)에서 1단으로 흐른다**(화면=무한높이라 2단, PDF=1단 → 세로 길어져 다음 장). 그래서 화면·PDF **둘 다 명시적 2단(flex)**: `lib/contract` `splitClauseColumns` + `.clauses{display:flex;gap:7mm} .clause-col{flex:1;min-width:0}`. flex 는 인쇄에서도 2단 유지.
- ⚠️ **조항 순서 절대 불변**: `splitClauseColumns` 는 **문서 순서 보존 분할**(앞에서부터 순서대로, 누적 절반 지점에서만 좌→우). 항목수 그리디로 분배하면 순서가 뒤섞임(좌 1·3/우 2·4) — 절대 금지. 왼쪽 단 위→아래, 오른쪽 단 위→아래로 읽으면 1,2,3,4 그대로여야 함.
- **계약서 레이아웃 바꿀 때 두 파일(ContractView·contractPrintHtml) CSS·구조를 항상 같이 수정**(드리프트 주의).

### 인쇄/PDF 버튼 동작 (Safari 제약 반영, 2026-06-29 최종)
**Safari 제약**: ① JS 로 PDF(iframe/새탭)를 `print()` 불가 — iframe 뷰어의 인쇄 버튼이 Safari 서 안 먹음(Chrome 만 됨). ② `window.print → 'PDF로 저장'`은 백지(WebKit PDF export 버그). Safari 가 허용하는 건 **HTML `window.print()`** 와 **파일 다운로드**뿐.
→ ContractView 버튼 2개로 분리:
- **🖨 인쇄 = `window.print()`** (화면 HTML 직접 인쇄). Safari 인쇄창 즉시 표시·내용 2단 정상. 물리 프린터용. (이 경로의 'PDF로 저장'은 Safari 백지라 PDF 는 아래 버튼 사용.)
- **⬇ PDF 저장 = 서버 puppeteer PDF(preview 모드) 파일 다운로드**. 백지 없음. 파일에서 인쇄/보관.
- **계약서 저장(발급)** = 서버 PDF 를 Drive 저장 + ContractFile 기록(공식 보관). preview 모드(`body.preview`)는 Drive/DB 미접촉.
- 서명 없이도 생성 허용(서명란 '(서명)' 자리표시). 빈 서명은 저장된 서명 안 지움.
- ⚠️ window.print 경로는 `@media print` CSS(ContractView), PDF 다운로드/발급은 contractPrintHtml CSS — **두 CSS 동기화 필수**.
