-- 서류 메일 발송 이력 (2026-08-25 운영자 승인, 커밋 6/7) — sms_logs 와 같은 격리 문법.
-- 실발송 성공만 적는다. 본문은 안 남긴다(제목·첨부 파일명·수신 주소까지가 근거의 전부).
CREATE TABLE IF NOT EXISTS "mail_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "propertyId" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "toEmail" TEXT NOT NULL,
  "replyTo" TEXT,
  "subject" TEXT NOT NULL,
  "docTitles" TEXT NOT NULL,
  "attachmentNames" JSONB NOT NULL,
  "attachmentCount" INTEGER NOT NULL,
  "totalBytes" INTEGER NOT NULL,
  "resendId" TEXT,
  "sentBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mail_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mail_logs_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mail_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "mail_logs_propertyId_createdAt_idx" ON "mail_logs"("propertyId", "createdAt");
CREATE INDEX IF NOT EXISTS "mail_logs_tenantId_createdAt_idx" ON "mail_logs"("tenantId", "createdAt");
