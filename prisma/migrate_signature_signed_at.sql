-- 서명 이미지를 받은 시각 두 칸 (2026-08-04, 운영자 승인).
-- 없으면 계약일이 발급 시점의 '오늘'로 찍혀 실제 서명일과 갈린다.
-- 원격 서명은 ContractShareLink.signedAt 에 시각이 있었지만 대면 서명은 기록 자체가 없었다.
-- 물리 테이블명은 lease_terms 다(@@map). 컬럼은 @map 이 없어 camelCase 그대로다.
ALTER TABLE "lease_terms" ADD COLUMN IF NOT EXISTS "signatureSignedAt" TIMESTAMP(3);
ALTER TABLE "lease_terms" ADD COLUMN IF NOT EXISTS "disposalSignatureSignedAt" TIMESTAMP(3);
