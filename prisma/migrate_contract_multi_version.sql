-- 계약서 다중 버전 (2026-08-20, 운영자 결정 5건 승인분).
--
-- 한 계약에 판본이 여럿 필요한 실무가 있다(성명 표기가 다른 판본, 관 제출용, 번역본).
-- 종전에는 서명이 들어오면 본문·표시값이 잠기고, 그 잠금을 푸는 문이 폐기 하나뿐이라
-- '이전 판본을 살려 둔 채 다음 판본을 쓰는' 상태 자체가 없었다.
--
-- 세 칸 다 additive 이고 기존 행은 기본값으로 남는다 — 행 데이터를 고치지 않는다.
--   contract_files.supersededAt   : 이 발급본이 만들어진 뒤 그 계약의 서명이 다음 판본으로
--                                   교체됐다는 사실. 폐기(voidedAt)와 다르다 — 그때 그 종이는
--                                   여전히 유효한 판본이고, 다만 '지금 서명'의 주인이 아니다.
--                                   계약일 정합 검사(축 1)가 이 값을 보고 구버전을 제외한다.
--   contract_files.issuePurpose   : 발급 목적. NULL 이 곧 '실계약'이다 — 기존 발급본은 전부
--                                   실계약이므로 백필이 필요 없고, 기본값을 문자열로 박아 두면
--                                   '아직 안 고른 것'과 '실계약을 골랐다'가 구분되지 않는다.
--                                   값은 lib/contractPurpose 화이트리스트뿐이고 발급 때 한 번만 쓴다.
--   properties.multiContractVersions : 다중 계약서 작성 허용 토글(영업장 단위). 기본 꺼짐.
--                                   꺼져 있으면 1인당 계약서 1개이고 목적 입력 자체가 화면에 없다.
--                                   껐을 때 기존 파생 판본은 **숨김**이지 삭제가 아니다.
--
-- 물리 테이블명은 @@map 이고 컬럼은 @map 이 없어 camelCase 그대로다(기존 마이그레이션과 동일).
ALTER TABLE "contract_files" ADD COLUMN IF NOT EXISTS "supersededAt" TIMESTAMP(3);
ALTER TABLE "contract_files" ADD COLUMN IF NOT EXISTS "issuePurpose" TEXT;
ALTER TABLE "properties"     ADD COLUMN IF NOT EXISTS "multiContractVersions" BOOLEAN NOT NULL DEFAULT false;
