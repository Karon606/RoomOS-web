-- 합배송 주문 묶음 — expense_orders 테이블 + expenses 에 orderId·isShipping 추가
-- Supabase SQL Editor 에서 실행 후 `npx prisma generate` (배포 빌드시 자동 실행됨)
--
-- 한 주문(ExpenseOrder)에 여러 지출(품목별·방별 분할 포함)이 orderId 로 묶인다.
-- 배송비는 그 주문에 연결된 별도 지출(isShipping=true, shippingType 은 주문에 보관).

CREATE TABLE IF NOT EXISTS "expense_orders" (
    "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
    "propertyId"   UUID         NOT NULL,
    "code"         TEXT         NOT NULL,
    "shippingType" TEXT,
    "shippingMemo" TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_orders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "expense_orders_propertyId_createdAt_idx"
  ON "expense_orders" ("propertyId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'expense_orders_propertyId_fkey'
  ) THEN
    ALTER TABLE "expense_orders"
      ADD CONSTRAINT "expense_orders_propertyId_fkey"
      FOREIGN KEY ("propertyId") REFERENCES "properties"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 보안: RLS 활성화(정책 없음 = anon 전부 차단). 앱은 postgres 롤(Prisma)로 우회.
ALTER TABLE "expense_orders" ENABLE ROW LEVEL SECURITY;

-- expenses 컬럼 추가
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "orderId" UUID;
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "isShipping" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "expenses_orderId_idx" ON "expenses" ("orderId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'expenses_orderId_fkey'
  ) THEN
    ALTER TABLE "expenses"
      ADD CONSTRAINT "expenses_orderId_fkey"
      FOREIGN KEY ("orderId") REFERENCES "expense_orders"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
