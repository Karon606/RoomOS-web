-- 소진임박 기본 임계 3일에서 7일로 (운영자 승인 2026-08-06).
-- 기본값 그대로였던 카드(3)만 7로 승격 — 수기로 바꾼 값은 보존. 멱등.
-- 롤백: ALTER TABLE "tracked_items" ALTER COLUMN "alertThresholdDays" SET DEFAULT 3;
--       UPDATE "tracked_items" SET "alertThresholdDays" = 3 WHERE "alertThresholdDays" = 7;
ALTER TABLE "tracked_items" ALTER COLUMN "alertThresholdDays" SET DEFAULT 7;
UPDATE "tracked_items" SET "alertThresholdDays" = 7 WHERE "alertThresholdDays" = 3;
