# 추가 서류(제3 서류) — 영업장이 만드는 서명 서류

계약서·임의처분 동의서 말고, 영업장이 직접 만들어 서명을 받는 서류(제목 + 문단 + 서명란 1개).
2026-09-06 운영자 오더로 만들었고 같은 날 4단계로 배포됐다.

## 저장 자리 셋

| 칸 | 무엇 | 축 |
|---|---|---|
| `Property.signDocuments` | 서류 정의 [{key, title, body, createdAt, retiredAt?}] | 라이브 설정 |
| `LeaseTerm.documentSignatures` | 계약에 쌓인 서명 {key: {image, signedAt}} | 계약 축 |
| `ContractShareLink.docSignedAt` | 그 링크에서 받은 서명 시각 {key: ISO} | 링크 축 |

**갈림을 아는 곳은 `lib/signDocuments.ts` 하나다.** 화면·알림·발급은 슬롯 배열만 본다.
계약서·동의서는 종전 전용 칸 그대로다(이주 안 함 — 폐기 이력·박제·감지망이 물고 있다).

## 불변 규칙

- **key 는 서버 발급 무의미 난수, 생성 시 한 번, 이후 불변.** 제목이 바뀌어도 서명이 안 끊긴다.
  제목 slug 금지 — 재발급 유혹 한 번이 서명 전부를 고아로 만든다.
- **삭제 경로가 없다.** `mergeSignDocuments` 에 삭제가 아예 없고(저장본에 있는데 payload 에
  없는 항목은 남는다), 화면에도 삭제 버튼이 없다. 중지(retiredAt)가 요구를 전부 덮는다.
- **중지해도 이미 나간 종이에는 계속 실린다.** 새 계약서에만 안 붙는다(스냅샷 축).
  그래서 되돌리기(다시 사용)가 완전하다.
- **종이의 서류 목록은 스냅샷이 정한다**(`paperDocsOf`). 라이브 설정을 읽으면 서류를 켜는
  순간 과거 계약 전부가 소급 반쪽이 된다. 서명 동결·발급 박제·printedFacts 에 전부 담긴다.
  **박제에 칸이 없으면 빈 배열이다** — 서명 끝난 계약서에 새 서류를 소급해 끼우지 않는다.
- 커스텀 서명은 계약서·동의서와 **같은 등급의 증거**다. 잠금·폐기 이력·복원·서명본 진입·
  재발급 가드 전부가 센다. 그 판정 타입들의 `documentSignatures` 는 **필수 칸**이다 —
  옵셔널로 바꾸면 select 누락이 침묵하고 증거가 이력 없이 지워진다.
- 원격 서명 화면은 **이 링크에 자국이 있는 key 만** 저장된 서명을 얹는다(링크 축).
- 옛 링크 스냅샷에는 `signDocuments` 칸 자체가 없다. 원본 `.map` 금지 — 정규화
  (`parseSignDocuments`)를 지나야 한다.

## 지키는 것들

진리표 셋(test-sign-documents 59 · test-print-companion 28 · test-contract-void 108)과
그물 `check-sign-documents-axis.mjs`(동결·화이트리스트·폐기 비움·복원·승계·병합 저장).
축 통일의 배경은 [[sign-evidence-axes]], 화면 문법은 [[domain-contracts]] 체크리스트 A.
