-- 외국인등록번호 저장 칸과 열람 기록 (2026-08-11, 운영자 승인).
--
-- 계약서에 외국인등록번호를 찍어야 하는 입주자가 있는데 담아 둘 자리가 없어 사람이 손으로 적고 있었다.
-- 담되 평문으로는 담지 않는다. 값은 AES-256-GCM 암호문이고(`v1:<iv>:<tag>:<ct>`, lib/pii),
-- AAD 로 tenants.id 를 묶어 암호문을 다른 행에 옮겨 붙이면 복호가 실패한다.
--
-- 기존 103행은 전부 NULL 로 시작한다. 백필도 변환도 없다.
-- 물리 테이블명은 tenants 다(@@map). 컬럼은 @map 이 없어 camelCase 그대로다.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "foreignRegNoEnc" TEXT;

-- 평문 열람 기록. 고객 화면의 revealForeignRegNo 서버 액션이 유일한 평문 경로이고,
-- 그 문을 지날 때마다 누가 언제 어느 입주자의 번호를 봤는지 한 줄이 남는다.
CREATE TABLE IF NOT EXISTS "foreign_reg_no_views" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "viewedAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "tenantId"   UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "propertyId" UUID NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
  "viewedById" UUID REFERENCES "users"("id")
);
CREATE INDEX IF NOT EXISTS "foreign_reg_no_views_tenant_idx" ON "foreign_reg_no_views"("tenantId", "viewedAt");
CREATE INDEX IF NOT EXISTS "foreign_reg_no_views_property_idx" ON "foreign_reg_no_views"("propertyId", "viewedAt");
