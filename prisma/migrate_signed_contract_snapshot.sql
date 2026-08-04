-- 서명 시점 본문 격리 칸 (2026-08-04, 운영자 승인).
-- 영업장 공통 계약서 본문을 고치면 서명이 끝난 계약서 내용이 소급해서 바뀌었다.
-- 실측으로 원격 서명 5건 전부가 2026-08-03 청소비 조항 변수화로 서명 당시와 달라져 있었다.
-- 물리 테이블명은 lease_terms 다(@@map). 컬럼은 @map 이 없어 camelCase 그대로다.
ALTER TABLE "lease_terms" ADD COLUMN IF NOT EXISTS "signedContractSnapshot" JSONB;
