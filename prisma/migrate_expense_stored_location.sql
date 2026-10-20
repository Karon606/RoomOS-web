-- 미배정 비품의 보관 위치 — Expense 에 보관 위치(StorageLocation) FK 추가 (2026-10-19 운영자 승인, 신고 195e05c8·09ec10aa).
--
-- 배정(roomId·assignedLocationId·isCommonAsset = 설치·배치)과 다른 축이다. 받은 + 안 놓인 비품 행에만 값이 선다.
-- 기존 행은 전부 NULL(= 보관 위치 미기록)이고 백필하지 않는다. 위치를 지우면 NULL 로 끊긴다(ON DELETE SET NULL).
-- 물리 테이블명은 expenses·storage_locations(@@map). 멱등(IF NOT EXISTS · duplicate_object 무시)이라 두 번 실행해도 같다.
--
-- 적용 순서: 이 SQL 을 운영 DB 에 먼저 적용한 뒤 코드를 배포한다. 새 코드의 Prisma 클라이언트는 지출을 읽을 때 이 칸을
-- 함께 고르므로, 칸 없이 배포하면 지출 조회가 'column does not exist' 로 실패한다. 칸만 먼저 생기는 것은 옛 코드에 무해하다.
--
-- 되돌리기(코드를 먼저 되돌린 뒤):
--   DROP INDEX IF EXISTS "expenses_storedLocationId_idx";
--   ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_storedLocationId_fkey";
--   ALTER TABLE "expenses" DROP COLUMN IF EXISTS "storedLocationId";
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "storedLocationId" UUID;

DO $$ BEGIN
  ALTER TABLE "expenses"
    ADD CONSTRAINT "expenses_storedLocationId_fkey"
    FOREIGN KEY ("storedLocationId") REFERENCES "storage_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "expenses_storedLocationId_idx" ON "expenses" ("storedLocationId");
