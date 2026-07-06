-- 방 특성: 전입신고 불가 + 비거주 공실 표시 여부 (2026-07-06)
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "noMoveInReport" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "nonResidentVacant" BOOLEAN NOT NULL DEFAULT true;
