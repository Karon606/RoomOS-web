-- pro 한도 도달로 flash 전환된 사용자의 '고급 복귀 제안' 예약 (운영자 설계 2026-07-11)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "geminiRestoreModel" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "geminiRestoreAt" TIMESTAMPTZ;
