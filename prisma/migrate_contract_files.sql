-- ContractFile — 입실자 서명된 계약서 PDF / 스캔 본 보관 (Drive 파일 ID + 메타)
-- Supabase SQL Editor에서 실행
--
-- source 구분:
--   GENERATED — 앱에서 서명패드로 받아 자동 생성된 PDF
--   UPLOADED  — 종이로 출력해 사인 후 스캔 업로드한 파일

CREATE TYPE "ContractFileSource" AS ENUM ('GENERATED', 'UPLOADED');

CREATE TABLE "contract_files" (
  "id"          UUID                NOT NULL DEFAULT gen_random_uuid(),
  "source"      "ContractFileSource" NOT NULL DEFAULT 'GENERATED',
  "driveFileId" TEXT                NOT NULL,
  "fileName"    TEXT                NOT NULL,
  "signedAt"    TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"   TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  "tenantId"    UUID                NOT NULL,
  "leaseTermId" UUID,
  "propertyId"  UUID                NOT NULL,

  CONSTRAINT "contract_files_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "contract_files"
  ADD CONSTRAINT "contract_files_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contract_files"
  ADD CONSTRAINT "contract_files_leaseTermId_fkey"
  FOREIGN KEY ("leaseTermId") REFERENCES "lease_terms"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "contract_files"
  ADD CONSTRAINT "contract_files_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "properties"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "contract_files_tenantId_createdAt_idx"
  ON "contract_files" ("tenantId", "createdAt" DESC);

CREATE INDEX "contract_files_propertyId_createdAt_idx"
  ON "contract_files" ("propertyId", "createdAt" DESC);
