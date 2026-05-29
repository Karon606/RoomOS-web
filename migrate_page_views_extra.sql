-- G 트래픽 분석 강화 — 지역/디바이스/검색엔진/참여도 (2026-05-29)
-- 프로덕션(Supabase) SQL 에디터에서 1회 실행. 추가 전용·무손실.

-- 검색엔진 분류 + 카테고리
ALTER TABLE "page_views" ADD COLUMN IF NOT EXISTS "searchEngine"     TEXT;
ALTER TABLE "page_views" ADD COLUMN IF NOT EXISTS "referrerCategory" TEXT;

-- 위치 (Vercel 헤더에서)
ALTER TABLE "page_views" ADD COLUMN IF NOT EXISTS "country" TEXT;
ALTER TABLE "page_views" ADD COLUMN IF NOT EXISTS "region"  TEXT;
ALTER TABLE "page_views" ADD COLUMN IF NOT EXISTS "city"    TEXT;

-- 디바이스/브라우저 (UA 파싱)
ALTER TABLE "page_views" ADD COLUMN IF NOT EXISTS "os"             TEXT;
ALTER TABLE "page_views" ADD COLUMN IF NOT EXISTS "osVersion"      TEXT;
ALTER TABLE "page_views" ADD COLUMN IF NOT EXISTS "browser"        TEXT;
ALTER TABLE "page_views" ADD COLUMN IF NOT EXISTS "browserVersion" TEXT;
ALTER TABLE "page_views" ADD COLUMN IF NOT EXISTS "deviceType"     TEXT;

-- 화면 (클라이언트 JS)
ALTER TABLE "page_views" ADD COLUMN IF NOT EXISTS "screenWidth"    INTEGER;
ALTER TABLE "page_views" ADD COLUMN IF NOT EXISTS "screenHeight"   INTEGER;
ALTER TABLE "page_views" ADD COLUMN IF NOT EXISTS "viewportWidth"  INTEGER;
ALTER TABLE "page_views" ADD COLUMN IF NOT EXISTS "viewportHeight" INTEGER;
ALTER TABLE "page_views" ADD COLUMN IF NOT EXISTS "language"       TEXT;

-- 참여도 (페이지 닫을 때 업데이트)
ALTER TABLE "page_views" ADD COLUMN IF NOT EXISTS "durationMs"     INTEGER;
ALTER TABLE "page_views" ADD COLUMN IF NOT EXISTS "scrollDepthPct" INTEGER;

CREATE INDEX IF NOT EXISTS "page_views_slug_country_occurredAt_idx" ON "page_views"("slug", "country", "occurredAt");
