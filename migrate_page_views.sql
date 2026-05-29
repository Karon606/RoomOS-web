-- G 인앱 트래킹 — 공개 랜딩 페이지(/members/<slug>) 페이지뷰 (2026-05-29)
-- 프로덕션(Supabase) SQL 에디터에서 1회 실행. 추가 전용·무손실.

-- 1) Property 에 공개 슬러그 컬럼 (트래픽 매칭 + 향후 G 2단계 인앱 편집기에서 재사용)
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "publicSlug" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "properties_publicSlug_key" ON "properties"("publicSlug");

-- 2) 페이지뷰 이벤트 테이블
CREATE TABLE IF NOT EXISTS "page_views" (
  "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
  "slug"         TEXT         NOT NULL,
  "path"         TEXT         NOT NULL,
  "occurredAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "referrer"     TEXT,
  "referrerHost" TEXT,
  "utmSource"    TEXT,
  "utmMedium"    TEXT,
  "utmCampaign"  TEXT,
  "userAgent"    TEXT,
  "isMobile"     BOOLEAN      NOT NULL DEFAULT false,
  "visitorHash"  TEXT,
  "isBot"        BOOLEAN      NOT NULL DEFAULT false,
  CONSTRAINT "page_views_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "page_views_slug_occurredAt_idx" ON "page_views"("slug", "occurredAt");
CREATE INDEX IF NOT EXISTS "page_views_slug_isBot_occurredAt_idx" ON "page_views"("slug", "isBot", "occurredAt");
