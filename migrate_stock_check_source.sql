-- StockCheck.sourceExpenseId 추가
-- confirmReceipt가 자동 생성한 점검을 원본 지출(=구매)과 연결.
-- 수령일 수정 시 자동 점검 date 동기화 / 수령 취소(receivedAt=null) 시 자동 점검 삭제에 사용.
ALTER TABLE "stock_checks"
  ADD COLUMN IF NOT EXISTS "sourceExpenseId" uuid;

ALTER TABLE "stock_checks"
  ADD CONSTRAINT "stock_checks_sourceExpenseId_fkey"
  FOREIGN KEY ("sourceExpenseId") REFERENCES "expenses"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "stock_checks_sourceExpenseId_idx"
  ON "stock_checks"("sourceExpenseId");
