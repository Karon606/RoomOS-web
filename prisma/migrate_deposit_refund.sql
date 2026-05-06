-- 보증금 환불(DepositRefund) 테이블 추가
-- Supabase SQL Editor에서 실행 후 npx prisma generate 실행
--
-- 입금은 기존 PaymentRecord(isDeposit=true)에 기록되어 있고,
-- 환불은 이 테이블에서 명시 추적.
-- returnedAmount + withheldAmount = 처리한 보증금 총액 (보통 LeaseTerm.depositAmount).
-- withheldAmount(미반환분)은 ExtraIncome(category='보증금')으로도 동시 기록되어 매출에 잡힘.

CREATE TABLE "deposit_refunds" (
    "id"              UUID         NOT NULL DEFAULT gen_random_uuid(),
    "date"            DATE         NOT NULL,
    "returnedAmount"  INTEGER      NOT NULL DEFAULT 0,
    "withheldAmount"  INTEGER      NOT NULL DEFAULT 0,
    "reason"          TEXT,
    "memo"            TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    "propertyId"      UUID NOT NULL,
    "tenantId"        UUID NOT NULL,
    "leaseTermId"     UUID NOT NULL,

    CONSTRAINT "deposit_refunds_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "deposit_refunds_propertyId_date_idx"
  ON "deposit_refunds" ("propertyId", "date");

CREATE INDEX "deposit_refunds_leaseTermId_idx"
  ON "deposit_refunds" ("leaseTermId");

ALTER TABLE "deposit_refunds"
  ADD CONSTRAINT "deposit_refunds_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "properties"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "deposit_refunds"
  ADD CONSTRAINT "deposit_refunds_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "deposit_refunds"
  ADD CONSTRAINT "deposit_refunds_leaseTermId_fkey"
  FOREIGN KEY ("leaseTermId") REFERENCES "lease_terms"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
