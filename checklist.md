# A-4 사진 인식 서버 액션 한도 봉합 (2026-09-03, 운영자 승인 "본체 + 곁가지 전부")

원인. 서버 액션 인자를 되읽는 React 직렬화기(decodeReply)가 인자 전체의 직렬화 슬롯을
1,000,000 개로 제한한다. 문자열은 1자가 1슬롯이라 base64 사진은 정확히 1,000,000 자,
원본으로 약 730KB 에서 "Maximum array nesting exceeded" 로 터진다. 실측 999,023 통과 /
1,000,000 실패. FormData 에 실은 File 은 슬롯을 그렇게 안 먹어 6MB 도 통과.

## A 본체 — 이미지 바이트는 문자열 인자로 싣지 않는다
- [ ] A1 lib/ocrImage: 반환 {b64,mime} -> {file,mime}, toDataURL -> toBlob, ocrForm() 신설
- [ ] A2 lib/ocrImageServer 신설(readOcrImageForm, 'use server' 붙이지 않음)
- [ ] A3 액션 4개 시그니처 FormData 로(tenants 2, floor-plan 1, finance 1)
- [ ] A4 호출부 4곳 교체(OcrToolbar 2, FloorPlanEditor 1, FinanceClient 1)
- [ ] A5 서명 상한 1_400_000 -> 900_000(프레임워크 문보다 낮춰 사람 말 오류 보장)
- [ ] A6 fileToOcrImage catch 범위 축소(createImageBitmap 실패만 폴백으로)
- [ ] A7 폴백 mime 확장자 추정(빈 file.type 이 HEIC 를 image/jpeg 로 라벨링하는 것 차단)

## B 영어 유출 봉합 — 다섯 자리
- [ ] B1 humanError() 한 벌(lib/saveStatus, 한글 음절 판정)
- [ ] B2 적용 5곳(OcrToolbar 2, FloorPlanEditor 1, FinanceClient 1, PendingReceiptSection 1)
- [ ] B3 withSave catch 도 같은 문(전 앱으로 새던 자리)

## C 곁가지 (운영자 승인)
- [ ] C1 FinanceClient 모순 토스트 쌍 + 첨부 안 된 사진 미리보기 잔류
- [ ] C2 OcrToolbar 버튼 스피너 + 너비 고정(가이드 §10)
- [ ] C3 FloorPlanEditor 문구 둘(§29 "~해보세요" · 구어체)

## D 감지망
- [ ] D1 check-upload-hygiene 프롱 ⓓ 서버 시그니처 base64:string 금지
- [ ] D2 프롱 ⓔ 호출부 첫 인자 ocrForm( 강제
- [ ] D3 프롱 ⓕ lib/ocrImage 에 toDataURL·readAsDataURL 금지
- [ ] D4 역주입 3종 exit 1 과 걸린 건수까지 확인
- [ ] D5 test-ocr-image 핀 4개 추가

## E 주석 정정 (사실 오류)
- [ ] E1 lib/ocrImage 머리 주석("10MB 가 원인" -> 슬롯 1,000,000)
- [ ] E2 OCR_FALLBACK_MAX_BYTES 근거 문장
- [ ] E3 PendingReceiptSection:86 주석

## 게이트 (커밋마다)
- [ ] tsc 0 · verify:fast · eslint 신규 0 · 빌드 · iCloud 사본 · push

## 다음 (승인됨, 이번 작업 뒤)
- [ ] A-2 계약서 nameStyle 태그 백필 예행 후 보고
