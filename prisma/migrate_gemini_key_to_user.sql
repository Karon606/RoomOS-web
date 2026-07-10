-- 제미나이 키를 영업장 → 소유 관리자(User) 단위로 이전 (운영자 결정 2026-07-11)
-- 같은 관리자가 운영하는 모든 영업장이 자동으로 같은 키를 쓴다.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "geminiApiKey" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "geminiModel" TEXT;
UPDATE "users" u SET
  "geminiApiKey" = COALESCE(u."geminiApiKey", p."geminiApiKey"),
  "geminiModel"  = COALESCE(u."geminiModel",  p."geminiModel")
FROM "properties" p
WHERE p."ownerId" = u."id" AND p."geminiApiKey" IS NOT NULL;
ALTER TABLE "properties" DROP COLUMN IF EXISTS "geminiApiKey";
ALTER TABLE "properties" DROP COLUMN IF EXISTS "geminiModel";
