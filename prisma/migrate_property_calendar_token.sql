-- 캘린더 구독(.ics) 피드 비밀 토큰 — 납부예정·퇴실예정 자동 동기화
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "calendarToken" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "properties_calendarToken_key" ON "properties" ("calendarToken");
