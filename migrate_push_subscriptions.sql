-- 웹 푸시(PWA) 구독 저장 — 기기별 1행. Supabase SQL 편집기에서 1회 실행.
-- 컬럼명 camelCase + 큰따옴표 (Prisma 필드명 그대로), 테이블명 snake_case.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  "id"        uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"    uuid          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "endpoint"  text          NOT NULL,
  "p256dh"    text          NOT NULL,
  "auth"      text          NOT NULL,
  "userAgent" text,
  "createdAt" timestamp(3)  NOT NULL DEFAULT now(),
  "updatedAt" timestamp(3)  NOT NULL DEFAULT now()
);

-- endpoint 당 1행 (같은 기기 재구독 시 upsert)
CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_key" ON push_subscriptions ("endpoint");
CREATE INDEX IF NOT EXISTS "push_subscriptions_userId_idx" ON push_subscriptions ("userId");
