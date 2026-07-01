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
