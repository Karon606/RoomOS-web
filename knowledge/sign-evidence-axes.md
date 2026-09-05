# 서명 증거의 두 축 — 링크 행과 계약 이미지

계약서 서명이 있었는지를 앱은 **두 곳**에서 읽는다. 둘은 다른 물음의 답인데
화면들이 섞어 쓰고 있다. 2026-09-06 실측에서 드러났다.

## 두 축

**링크 축** — `ContractShareLink.signedAt` · `disposalSignedAt`
그 링크에서 서명이 벌어진 시각이다. 링크마다 따로 적히고 **누적되지 않는다.**
한 계약에 링크를 두 번 발급하면 첫 링크에서 받은 서명은 둘째 링크 행에 없다.
발급 사건의 영속 기록이라 나중에 지워지지 않는다.

**계약 축** — `LeaseTerm.signatureImageUrl` · `disposalSignatureImageUrl`
(그리고 짝인 `signatureSignedAt` · `disposalSignatureSignedAt`)
지금 발급하면 종이에 실제로 찍힐 서명 이미지다. 링크를 몇 번을 발급하든
**한 계약에 누적된다.** 다만 영속이 아니다 — 재서명 때 함께 null 이 된다
(`signedContractSnapshot` 주석 참조, prisma/schema.prisma 서명 네 칸).

## 어느 자리가 무엇을 읽는가 (2026-09-06 현재)

| 자리 | 축 |
|---|---|
| 발급 대기 `app/(app)/contracts/actions.ts` `sigState` | 계약 축 |
| 홈 알림 `app/(app)/dashboard/alerts.ts` | 링크 축 |
| 계약서 패널 배지 `components/entity-modal/widgets/ContractFilesPanel.tsx` | 링크 축 |
| 서명 화면 `app/contract/[tenantId]/ContractView.tsx` | 화면 상태(그 화면에서 받은 서명) |

## 실측 (운영 DB, 2026-09-06)

링크 37건 중 두 축의 `signStage` 판정이 갈리는 것 **15건**. 방향이 둘이다.

- 링크축 partial·none / 계약축 complete — 12건. 서명을 두 링크에 나눠 받은 경우다.
  팜 까오 끄엉은 9/3 링크에서 동의서만, 9/4 링크에서 계약서만 서명했는데
  계약에는 양쪽 이미지가 다 있다. 홍은주·박정후도 같다. 이 계약들은 실제로
  양쪽 서명이 찍힌다.
- 링크축 complete / 계약축 none — 3건(지한 모하마드 이스맘 호세인·한희규·김상혁).
  셋 다 발급본은 있는데 계약의 서명 이미지가 비어 있고 격리본도 없다.
  **어느 경로에서 비워지는지는 아직 확인 못 했다.**

지금 홈 화면에 뜨는 서명 알림은 0건이라 **눈에 보이는 거짓말은 없다.** 전부
발급이 끝났거나 링크가 살아 있어 `signAlertDue` 가 침묵시킨다. 잠복이다.

## 왜 중요한가

홈 알림의 '반쪽 서명'과 패널 배지의 '계약서만 서명됨'은 **계약에 대한 주장**인데
링크를 읽는다. 링크를 두 번 발급한 계약은 실제로 서명이 다 있어도 반쪽이라고
말하게 된다. 반대 방향은 더 위험하다 — 링크가 완료라고 적혀 있는데 계약에
이미지가 없으면 서명란이 빈 종이가 나간다(2026-09-03 사고와 같은 결과).

제3 서류(D2)가 붙으면 이 분열이 그대로 N배가 된다. `documentSignatures`(계약 쪽)와
`docSignedAt`(링크 쪽)을 둘 다 두는 원안이 정확히 이 두 축을 다시 만드는 모양이다.

## 아직 안 정한 것

- 화면마다 어느 축이 맞는지. 물음이 다르면 정본 함수도 물음별로 나뉘어야 한다.
- 갈리는 15건을 백필할 것인지. 데이터 수정은 운영자 승인 건만 한다.
- `check-sign-progress-axis.mjs` 의 ⓖ 는 세 자리가 `templateSnapshot` 을 읽는지만 보고
  **서명 출처가 같은지는 안 본다.** 그 그물을 세울 수 있는지.

관련: [[domain-contracts]], [[domain-contract-archive]]
