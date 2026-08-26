-- 조기 입실 (2026-08-26 운영자 승인) — 본 계약 방이 비기 전 임시 방에서 먼저 입실한 사실.
-- roomId·moveInDate 는 본계약의 진실로 그대로 두고 이 두 칸이 전사만 담는다.
-- 전건 null 이라 기존 동작 무변동. 되돌림: 두 칼럼 DROP 으로 충분.
ALTER TABLE "lease_terms" ADD COLUMN IF NOT EXISTS "earlyCheckInDate" DATE;
ALTER TABLE "lease_terms" ADD COLUMN IF NOT EXISTS "earlyCheckInRoomId" UUID;
DO $$ BEGIN
  ALTER TABLE "lease_terms" ADD CONSTRAINT "lease_terms_earlyCheckInRoomId_fkey"
    FOREIGN KEY ("earlyCheckInRoomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
