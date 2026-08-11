-- 열람 언어 추적 — 공개 페이지에서 실제로 어떤 언어로 봤나 + 중간에 바꾼 이력 (2026-08-11)
-- 프로덕션(Supabase) SQL 에디터에서 1회 실행. 추가 전용·무손실, 기존 행은 NULL(집계 제외).

ALTER TABLE "page_views" ADD COLUMN IF NOT EXISTS "viewedLanguage" TEXT;
ALTER TABLE "page_views" ADD COLUMN IF NOT EXISTS "languageTrail"  TEXT;
