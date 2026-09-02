# 서류 성명 표기 사람 단위 기본값 (2026-09-03, 운영자 "전부 권고대로")

요청. 외국인(등록번호 보유 또는 국적 비한국)은 발급 서류 이름이 영문 기본.
다만 사람 단위로 "이 사람은 한글" 을 못박을 수 있어야 한다.

## 0 fix(고객정보): 외국인 판정을 정본 하나로 모은다
- [x] TenantClient 의 `natVal !== '대한민국'` 세 자리를 정본 판정으로(현지 표기·등록번호·해외 연락처)
- [x] 서류 정본 isKoreanNationality 와 같은 답을 내는지 확인('한국'·'Korea'·'KR')

## 1 feat(서류성명): 사람 단위 기본 표기를 정본이 받는다
- [x] lib/documentName: DocNameStyleContext 에 tenant 축, 서열은 saved > siblings > tenant > 국적 > ko
- [x] 외국인 판정 정본 함수(국적 비한국 OR 외국인등록번호 보유)
- [x] scripts/test-doc-name-style 케이스 다섯(국적 추정을 이김·저장값과 형제에는 짐·NULL 은 종전·
      후보에서 빠진 값은 무시·화이트리스트 밖은 버림)

## 2 chore(스키마): Tenant.docNameStyle
- [x] 칼럼 String? + 대칭 주석(카드는 이 값을 절대 읽지 않는다 / 서류는 displayNameStyle 을 안 읽는다)
- [x] 마이그레이션. 백필 없음, NULL = 자동

## 3 feat(고객정보): 서류 성명 표기 칸
- [ ] actions.ts has 가드 patch(칸 부재는 보존)
- [ ] TenantClient 폼에 SelectField '서류 성명 표기'(자동·한글·영문·현지), 외국인에게만
- [ ] 영문 이름 없는 사람 안내, 진행 중 계약에 다른 표기 힌트가 있으면 안내 한 줄
- [ ] 내국인 93명 화면 무변화 대조

## 4 feat(발급): 세 서류가 사람 단위 값을 읽는다
- [x] lib/contractData · residence-cert/actions · rent-receipt/actions 에 tenant 값 전달
- [x] 세 View 초기값만 달라지고 기존 셀렉트·되묻기는 그대로

## 5 chore(감지망): 두 축 침범 금지
- [x] scripts/check-doc-name-axis.mjs(서류 경로에 displayNameStyle 금지, 카드 경로에 docNameStyle
      금지, resolveDocNameStyle 호출부 전원이 tenant 축을 넘김) + verify:fast + 역주입

## 게이트 (커밋마다)
- [ ] tsc 0 · verify:fast · eslint 신규 0 · 감지망 역주입 · 빌드(마지막) · iCloud 사본 · push
- [ ] 웹디자이너 패스: 3번 폼 칸

## 문서
- [ ] Work_log · knowledge(domain-document-name 또는 기존 노트) · INDEX
