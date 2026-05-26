-- #1 고정지출 '관리비' 부모 + 세부항목 재설계 (2026-05-26)
-- 프로덕션(Supabase) SQL 에디터에서 1회 실행. 추가 전용(기존 데이터 무손실).

-- 1) 지출에 세부 내역(JSON) 보관 컬럼 — 관리비 1줄(합계) 안에 세부항목 표시용
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "breakdownJson" TEXT;

-- 2) 고정지출 세부항목 테이블 — 부모(recurring_expenses) 아래 청소관리비·수도요금 등
CREATE TABLE IF NOT EXISTS "recurring_expense_items" (
  "id"                 UUID         NOT NULL DEFAULT gen_random_uuid(),
  "recurringExpenseId" UUID         NOT NULL,
  "name"               TEXT         NOT NULL,
  "amount"             INTEGER      NOT NULL DEFAULT 0,
  "isVariable"         BOOLEAN      NOT NULL DEFAULT false,
  "sortOrder"          INTEGER      NOT NULL DEFAULT 0,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recurring_expense_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recurring_expense_items_recurringExpenseId_fkey"
    FOREIGN KEY ("recurringExpenseId") REFERENCES "recurring_expenses"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "recurring_expense_items_recurringExpenseId_idx"
  ON "recurring_expense_items"("recurringExpenseId");
