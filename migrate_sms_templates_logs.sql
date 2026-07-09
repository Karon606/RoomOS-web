-- 미납 안내 문자 Phase 1 (2026-07-09, /docs/stayeum_payment_spec.md)
-- 템플릿·발송 시도 이력 + payment_records에 Phase 2(CODEF) 대비 컬럼
CREATE TABLE IF NOT EXISTS "sms_templates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "propertyId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sms_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sms_templates_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "sms_templates_propertyId_sortOrder_idx" ON "sms_templates"("propertyId", "sortOrder");

CREATE TABLE IF NOT EXISTS "sms_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "propertyId" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "leaseTermId" UUID,
  "templateId" UUID,
  "renderedBody" TEXT NOT NULL,
  "overdueAmount" INTEGER,
  "overdueDays" INTEGER,
  "paymentCheckConfirmedAt" TIMESTAMP(3),
  "sentVia" TEXT NOT NULL DEFAULT 'manual_sms',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sms_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sms_logs_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "sms_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "sms_logs_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "sms_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "sms_logs_propertyId_createdAt_idx" ON "sms_logs"("propertyId", "createdAt");
CREATE INDEX IF NOT EXISTS "sms_logs_tenantId_createdAt_idx" ON "sms_logs"("tenantId", "createdAt");

ALTER TABLE "payment_records" ADD COLUMN IF NOT EXISTS "paymentConfirmedAt" TIMESTAMP(3);
ALTER TABLE "payment_records" ADD COLUMN IF NOT EXISTS "paymentConfirmedBy" TEXT;
ALTER TABLE "payment_records" ADD COLUMN IF NOT EXISTS "bankTxRef" TEXT;
