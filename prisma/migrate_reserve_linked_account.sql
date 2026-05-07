-- ReserveTransaction에 linkedAccountId 컬럼 추가
-- Supabase SQL Editor에서 실행 후 npx prisma generate 실행
--
-- 예비비를 별도 계좌로 옮겨 관리하는 운용 패턴 추적용.
-- DEPOSIT: 적립금이 들어간 계좌 (예: 예비비 전용 통장)
-- WITHDRAW_DIRECT: 예비비를 인출해 사용한 계좌
-- WITHDRAW_FROM_EXPENSE: 보통 NULL — 원 Expense.financialAccountId 사용

ALTER TABLE "reserve_transactions"
  ADD COLUMN "linkedAccountId" UUID;

ALTER TABLE "reserve_transactions"
  ADD CONSTRAINT "reserve_transactions_linkedAccountId_fkey"
  FOREIGN KEY ("linkedAccountId") REFERENCES "financial_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
