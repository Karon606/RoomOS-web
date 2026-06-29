# 도메인: 계약서 / 동의서

핵심: `app/contract/[tenantId]/{ContractView.tsx, actions.ts}`, `lib/contract.ts`, `lib/contractPrintHtml.ts`, `app/api/contract/generate/route.ts`.

## 서명 저장
- 입실계약서 서명: `LeaseTerm.signatureImageUrl`(dataURL). 출력 에디터가 불러와 재표시.
- 동의서(잔여 소지품 임의처분) 서명: `LeaseTerm.disposalSignatureImageUrl`(2026-06-29 추가). generate route가 best-effort 저장(컬럼 미적용 시에도 PDF 안 깨짐).

## 환불 조항
계약서 `{{환불규정}}` 변수 = 환경설정 환불정책으로 자동 생성(`buildRefundClause`). 토글로 표시 on/off. 공정위 고정문구 모드.

## 주소
입주자 주소 = 영업장 주소 + 방번호(별도 필드 없음). [[goshiwon-tenant-address]]

## 인쇄 = 한 장 이슈 (미해결, [[open-issues]] #1b)
화면 미리보기는 `transform: scale()` + `min-height:297mm`로 한 장처럼 보이지만, 인쇄는 `@media print`에서 scale 제거 → 원본 크기라 콘텐츠가 A4 가용높이 초과 시 2페이지로 넘침. 화면(174×275mm 여백)과 인쇄(182×273mm)도 다름.
→ 목표: 한 장에 맞추거나(여백·폰트·줄간격 압축) 화면도 실제 페이지대로 보이게(WYSIWYG). **인쇄 PNG 렌더(qlmanage) 반복 검증 필요.**
