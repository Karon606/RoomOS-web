-- 예비비(ReserveTransaction) 테이블 추가
-- Supabase SQL Editor에서 실행 후 npx prisma generate 실행
--
-- type 값:
--   'DEPOSIT'                — 자금 → 예비비 적립
--   'WITHDRAW_DIRECT'        — 예비비 직접 지출 (별도 Expense 없음)
--   'WITHDRAW_FROM_EXPENSE'  — 일반 지출 사후정산 (expenseId 연결)
-- 잔고 = SUM(amount where type='DEPOSIT') - SUM(amount where type LIKE 'WITHDRAW%')

CREATE TABLE "reserve_transactions" (
    "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
    "type"        TEXT         NOT NULL,
    "amount"      INTEGER      NOT NULL,
    "date"        DATE         NOT NULL,
    "category"    TEXT,
    "memo"        TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    "propertyId"  UUID NOT NULL,
    "expenseId"   UUID,

    CONSTRAINT "reserve_transactions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reserve_transactions_propertyId_date_idx"
  ON "reserve_transactions" ("propertyId", "date");

CREATE INDEX "reserve_transactions_propertyId_type_idx"
  ON "reserve_transactions" ("propertyId", "type");

ALTER TABLE "reserve_transactions"
  ADD CONSTRAINT "reserve_transactions_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "properties"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reserve_transactions"
  ADD CONSTRAINT "reserve_transactions_expenseId_fkey"
  FOREIGN KEY ("expenseId") REFERENCES "expenses"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
