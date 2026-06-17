-- 비품·자재 공용부 배정 — Expense 에 배정 위치(StorageLocation) FK 추가. 방(roomId)과 상호배타.
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "assignedLocationId" UUID;

DO $$ BEGIN
  ALTER TABLE "expenses"
    ADD CONSTRAINT "expenses_assignedLocationId_fkey"
    FOREIGN KEY ("assignedLocationId") REFERENCES "storage_locations"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "expenses_assignedLocationId_idx" ON "expenses" ("assignedLocationId");
