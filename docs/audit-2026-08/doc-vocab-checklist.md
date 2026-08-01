# 서류 용어·계약서 접점 정리 체크리스트 (2026-08-01)

운영자 승인(2026-08-01, 4건 전부): a 전체 범위 / b `TenantContractInfo` 바로 다음으로 이동 /
c 화면에서만 제거(컬럼 유지) / d 1·2단계 먼저 하고 확인 후 3~5단계.

## 1단계 — 이름 통일 (근원 봉합)

정본 동사 5개. 발급(공식본 생성·보관·이력) · 보내기(입주자에게 전달) · 저장(내 기기) · 보기(열람만) · 작성(입력 화면 진입).

### 1-1 기본 라벨을 정본으로, 호출부 이름표 제거
- [x] `components/ui/ShareDocButton.tsx:11` `label = '공유'` → `'보내기'`
- [x] `components/entity-modal/widgets/ContractFilesPanel.tsx:183` `label="공유"` prop 삭제
- [x] `app/(app)/contracts/ContractsClient.tsx:224` `label="보내기"` prop 삭제

### 1-2 계약서 발급 용어 정렬 (영수증·확인서와 같은 말로)
- [x] `app/contract/[tenantId]/ContractView.tsx:582` "계약서 저장 (Drive 보관)" → "계약서 발급"
- [x] `ContractView.tsx:357` 확인창 title·confirmLabel 을 발급 문형으로
- [x] `ContractView.tsx:582` 대기 "저장 중…" → "발급 중…"
- [x] `ContractView.tsx:596` 본문 편집 저장은 그대로 둔다(목적어가 템플릿)

### 1-3 발급 오용 제거
- [x] `ContractFilesPanel.tsx:147` "계약서 보내기"/"다시 보내기" → "서명 요청 보내기"/"서명 요청 다시 보내기", "발급 중…" → "준비 중…"
- [x] `app/(app)/rent-receipts/RentReceiptsClient.tsx:266` "재발급" → "다시 작성"
- [x] `app/(app)/residence-certs/ResidenceCertClient.tsx:252` "재발급" → "다시 작성"
- [x] `ResidenceCertClient.tsx:127` "새 확인서 발급" → "새 확인서 작성"

### 1-4 출력 오용 제거
- [x] `ContractFilesPanel.tsx:143` "출력 / 서명 받기" → "계약서 작성·서명"
- [x] `components/entity-modal/EntityModal.tsx:281` "계약서 출력" → "계약서 작성·서명" (2단계에서 제거 예정이나 우선 정합)
- [x] `EntityModal.tsx:230,232,233` 다이얼로그 문구를 열기 계열로

### 1-5 개발·외부 서비스 용어 제거
- [x] `ContractsClient.tsx:229` · `RentReceiptsClient.tsx:262` · `ResidenceCertClient.tsx:248` "Drive 보기" → "원본 보기"
- [x] `ShareDocButton.tsx:27` · `SaveDocImageButton.tsx:30` · `SendDocButton.tsx:73` 폴백 토스트에서 '공유 시트' 제거
- [x] `ShareDocButton.tsx:29` "공유에 실패했습니다." → "보내기에 실패했습니다."

### 1-6 미리보기 표기 통일
- [x] `ContractView.tsx:572` "미리보기 (인쇄·PDF)" → "미리보기·인쇄"
- [x] `ContractView.tsx:576` "미리보기 인쇄" → "미리보기·인쇄"
- [x] `ContractView.tsx:577` "미리보기 PDF" → "PDF로 저장"

### 1-7 스캔본 라벨·토스트 일치
- [x] `ContractFilesPanel.tsx:150` "스캔 본 첨부" → "스캔본 올리기"
- [x] `ContractFilesPanel.tsx:168` 빈 상태 안내를 바뀐 라벨에 맞춤

### 1-8 대기 문구 5종을 3종으로
- [x] `ShareDocButton.tsx:38` "여는 중…" → "준비 중…"
- [x] `SendDocButton.tsx:79` · `SaveDocImageButton.tsx:41` "변환 중…" → "준비 중…"
- [x] `ContractView.tsx:572,576,577` "생성 중…" → "여는 중…"

## 2단계 — 계약서 접점 8개를 4개로

- [x] `EntityModal.tsx:218-237` `handlePrintContract` 제거 + 하단 버튼 제거 (독자 기능 0, 표기 버그 동반)
- [x] `widgets/TenantAdditionalInfo.tsx:53-58` 레거시 contractUrl 표시 제거 (DB 0건)
- [x] `app/(app)/tenants/TenantClient.tsx:3663` 외부 계약서 링크 입력 필드 제거 (컬럼·액션은 유지)
- [x] `TenantClient.tsx:3811` 로컬 복제 ContractFilesPanel 제거 후 정본 import (수정 폼에서는 서명 요청 숨김 prop)
- [x] `bodies/TenantBody.tsx` 계약서 파일 섹션을 `TenantContractInfo` 다음으로 이동 (운영자 확정)
- [x] 고아 import 정리 (`ContractFileRow`, `createContractScanUploadSession`, `finalizeContractScan`, `uploadFileToDriveSession`, `deleteContractFile`, `restoreContractFile`)

## 검증 (loop.md §1)

- [x] `find .next -name "* [0-9].*" -delete`
- [x] `npx tsc --noEmit`
- [x] `npx tsx scripts/test-money.ts` (99 통과)
- [x] `npx next build`
- [x] 형제 페이지 대조: contracts · rent-receipts · residence-certs 세 목록의 라벨이 동일한지 육안 확인
- [x] 남은 '공유'·'Drive'·'출력' 문자열 전수 grep 으로 잔존 확인

## 2.5단계 — 인쇄 경로 + 버튼 위계 (운영자 지적으로 앞당김, 완료)

운영자: "실제 프린터에서 출력하는 것은 여기서 안 되는 것 같은데. 계약서 메뉴로 별도 접속 안 하고는 방법이 없을까?"
디자이너 판정: 인쇄는 6번째 동사를 만들지 않는다. **'보기'(앱 안 PDF 뷰어)를 열면 인쇄·저장·확대가 거기서 다 된다.**
발견 실패의 원인은 인쇄 버튼 부재가 아니라 **앱 안에서 문서를 여는 컨트롤 자체의 부재**였다.

- [x] `components/ui/ViewDocButton.tsx` 신설 — `/api/doc-file?id=` 새 탭, 라벨 '보기' 고정(label prop 없음)
- [x] `components/ui/Btn.tsx` 에 `btnClass()`·`BtnLink` 추가 — 토큰 단일 출처(손복사 방지)
- [x] 4개 화면 행을 공통 구성으로: 보기(solid) · 보내기 · [사진 저장] · [다시 작성] · 삭제(ghost danger)
- [x] 드라이브 외부 링크 제거 — 파일명 링크 겸용도 해제하고 '보기'가 전담
- [x] `canShare` 게이트 제거(행 액션만). 다중 선택 바의 게이트는 그대로 둔다
- [x] 터치 타겟 44px 통일 — 계약서 목록만 30px 이던 드리프트 해소
- [x] `ContractFilesPanel` 상단 행 위계: 계약서 작성·서명(primary) · 서명 요청 보내기(secondary) · 스캔본 올리기(ghost)

미결: **'사진 저장' 유지 여부**(영수증·확인서 행이 5개로 붐빔). 디자이너는 보내기의 사진 경로와
뷰어 다운로드로 이미 두 번 덮인다고 봤으나 기능 제거라 운영자 확인 필요. 일단 **유지**했다.
잔존: `viewUrl`(드라이브 URL)이 4개 액션·3개 API 에서 여전히 생성되나 UI 소비처가 없다. 제거는 별건.

## 3~4단계 (남음)

- [ ] 3단계 상태 기반 화면 (S0 없음 / S1 요청함 / S2 서명받음 / S3 보관됨)
- [ ] 4단계 계약서 사진 송부 (다페이지 PNG)
