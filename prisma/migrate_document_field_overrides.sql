-- 발급 서류 표시값 오버라이드 테이블 (운영자 승인 2026-08-08).
-- Supabase SQL Editor 에서 실행 후 `npx prisma generate` (배포 빌드시 자동 실행됨).
--
-- 세 서류(계약서·납부확인서·실거주확인서)는 서로 다른 사실을 말한다 — 계약서=약정 정가,
-- 납부확인서=실수납, 실거주확인서=거주 사실 + 운영자 재량. 그래서 계약서 칸
-- (lease_terms."contractFieldOverrides")을 나눠 쓰지 않고 서류별 **행**으로 분리한다.
-- 칼럼 하나에 서류별 JSON 을 모으면 두 서류를 잇달아 저장할 때 lost update 가 나고,
-- 서류별 updatedAt 이 없어 "언제 저장한 값인가"를 끝내 말해 줄 수 없다.
--
-- fields(JSONB) 는 sparse 다. 존재하는 키만 자동값을 덮고, 자동값과 같아진 키는 저장에서 빠진다
-- (lib/documentFieldOverrides 가 유일한 진입점).
--   docType='RESIDENCE_CERT': { siteAddress?, tenantAddress?, periodText?, rentAmount?, depositAmount? }
CREATE TABLE IF NOT EXISTS "document_field_overrides" (
  "id"          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "leaseTermId" UUID         NOT NULL REFERENCES "lease_terms"("id") ON DELETE CASCADE,
  "propertyId"  UUID         NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
  "docType"     TEXT         NOT NULL,
  "fields"      JSONB        NOT NULL,
  "updatedBy"   UUID,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 계약 하나에 서류 하나 = 행 하나. 동시 저장 경합을 DB 가 막는다.
CREATE UNIQUE INDEX IF NOT EXISTS "document_field_overrides_leaseTermId_docType_key"
  ON "document_field_overrides" ("leaseTermId", "docType");

CREATE INDEX IF NOT EXISTS "document_field_overrides_propertyId_docType_idx"
  ON "document_field_overrides" ("propertyId", "docType");

-- 보안: RLS 활성화(정책 없음 = anon 전부 차단). 앱은 postgres 롤(Prisma)로 우회.
ALTER TABLE "document_field_overrides" ENABLE ROW LEVEL SECURITY;
