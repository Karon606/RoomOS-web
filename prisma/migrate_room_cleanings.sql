-- 방 청소 이력 (2026-08-05, 신고 b21e4e98).
-- 회계에 접점이 없다. 돈은 ExtraIncome·Expense 가 계속 만들고 여기는 가리키기만 한다.
CREATE TABLE IF NOT EXISTS "room_cleanings" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "propertyId" UUID NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
  "roomId" UUID NOT NULL REFERENCES "rooms"("id") ON DELETE CASCADE,
  "leaseTermId" UUID REFERENCES "lease_terms"("id") ON DELETE SET NULL,
  "reason" TEXT NOT NULL DEFAULT 'CHECKOUT',
  "status" TEXT NOT NULL DEFAULT 'PLANNED',
  "scheduledDate" DATE,
  "doneDate" DATE,
  "performer" TEXT,
  "performerName" TEXT,
  "expenseId" UUID,
  "fromCleaningFund" BOOLEAN NOT NULL DEFAULT false,
  "memo" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "room_cleanings_propertyId_status_idx" ON "room_cleanings"("propertyId", "status");
CREATE INDEX IF NOT EXISTS "room_cleanings_roomId_doneDate_idx" ON "room_cleanings"("roomId", "doneDate");
CREATE INDEX IF NOT EXISTS "room_cleanings_leaseTermId_idx" ON "room_cleanings"("leaseTermId");
