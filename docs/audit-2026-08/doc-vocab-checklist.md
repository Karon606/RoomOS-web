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

**'사진 저장' 유지 확정(운영자 2026-08-01).** 디자이너는 보내기의 사진 경로와 뷰어 다운로드로
두 번 덮인다고 봤으나 운영자가 목적이 다르다고 판정했다.
> "보내기는 말그대로 전송의 역할인데 사진으로 할지 pdf로 할지이고 사진 저장은 저장해서 바로
> 사진함에 넣는거니까 목적이 달라. 5개 버튼이라도 괜찮은 것 같아"

즉 **보내기는 목적지가 상대방, 사진 저장은 목적지가 내 사진함**이다. 형식(사진/PDF)이 겹칠 뿐
목적어가 다르다. 버튼 수를 줄이려고 합치면 사진함에 넣는 경로가 공유 시트 뒤로 숨는다.
[[doc-vocabulary]] 에 정본으로 적립.
잔존: `viewUrl`(드라이브 URL)이 4개 액션·3개 API 에서 여전히 생성되나 UI 소비처가 없다. 제거는 별건.

## 3단계 — 상태 기반 화면 (완료)

- [x] `lib/contractIssue.ts` 신설 — '서명 받았는데 발급 전' 판정 정본. 홈 알림과 패널이 같은 규칙을 쓴다
- [x] `dashboard/alerts.ts` 를 정본 호출로 교체(규칙 중복 제거)
- [x] `getContractShareState` 가 `needsIssue` 를 내려준다(화면에서 재계산 금지)
- [x] 단계별 주 버튼 하나: S0 작성 / S1 서명 요청 다시 보내기(만료·잠김 포함) / S2 작성(발급 안내) / S3 없음
- [x] 배지·알림 해제는 단계 분기 밖 — 503호 재발 방지
- [x] 디자이너 패스 6건 반영(아래)

**정정 하나.** 전문가는 "알림은 GENERATED 로만 해소된다"고 했으나 **틀렸다.**
실제 쿼리는 `source: { in: ['GENERATED','UPLOADED'] }` 라 스캔본으로도 꺼진다. 종이 계약 운영에서
알림이 영원히 안 꺼지는 것을 막으려는 의도된 설계다. 따라서 S2 에서 스캔본 올리기를 감출 이유가 없다.

**디자이너 패스 반영**
- 안내 문구를 액션 행 **아래**로 — 위에 두니 로딩 후 나타나며 버튼 행이 통째로 밀렸다(§17)
- 조회 실패 시 폴백 + 토스트 — 종전에는 주 버튼도 안내도 없는 회색 화면으로 굳었다
- **라벨 고정으로 되돌림.** S2 에서 '계약서 발급'으로 바꿨다가 취소했다. 그 링크는 입력 화면으로 가고
  발급은 거기서 한 단계 더 들어가야 일어난다. 방금 세운 동사 정의를 라벨이 스스로 어기는 셈이었다
- 빈 상태 문구 — 안내가 있으면 지시절을 걷는다(S2 에서 "서명을 받았습니다" 밑에 "서명을 받으세요"가 붙었다)
- 만료·잠김 링크를 S1 계열로 편입 — 종전에는 S0 로 흘러 방금 보냈다는 사실이 화면에서 지워졌다
- '알림 해제' 문구를 `needsIssue` 에 물림 — 서명 없이 만료된 링크에도 '없는 알림이 사라진다'고 단언했다

## 4단계 — 계약서 사진 송부 (완료)

- [x] `lib/pdfToPng.ts` 에 `pdfToPngBlobs` 신설. 기존 1페이지 함수는 시그니처·동작 그대로 유지
      (`lib/docShareQueue.ts` 의 다건 큐가 그걸 쓴다 — 영수증 일괄 보내기 무영향)
- [x] `SendDocButton` 다페이지화. 1장이면 파일명·첨부 개수·문구가 종전과 완전히 동일하고,
      2장 이상일 때만 `_1`·`_2` 접미가 붙는다
- [x] 형식 선택창에 "서류가 여러 장이면 사진도 장수만큼 함께 보냅니다" 추가
- [x] 계약서 2곳(모달 파일 행·계약서 목록)을 `SendDocButton` 으로 교체
- [x] `ShareDocButton` 삭제 — 위 교체로 호출부가 0이 됐다. '보내기' 구현이 둘 남아 있으면
      또 갈린다(이번 세션의 발단이 정확히 그 사고)
- [x] `fetchDocBytes` 를 `lib/docBytes.ts` 정본으로. 목록 3화면에 똑같이 복사돼 있던 것
- [x] 다운로드 폴백을 여러 장 순차 처리로(연속 `a.click()` 차단 회피)

**실물 검증.** 보관된 계약서 6건의 실제 페이지 수를 PDF 바이트로 셌다. **전부 2쪽이고 김태란 건은 3쪽.**
예전 1페이지 변환기로 보냈으면 1~2장이 통째로 유실됐다. 금지 주석이 옳았고, 이제 그 제약이 풀렸다.

**남긴 것.** 다건 선택 보내기는 PDF 고정. png 로 열려면 `docShareQueue` 의 `Map<string, Blob>` 을
배열로 넓혀야 하고 그러면 영수증 다건 경로까지 건드린다. 운영자 지적은 단건 형식 선택지였다.
