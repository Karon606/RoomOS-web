-- 푸시 발송 내역 테이블 — 사용자별 1행/발송 이벤트.
-- cron 매일 알림 / 테스트 / 추후 카테고리들이 남는다.

CREATE TABLE IF NOT EXISTS push_history (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"         UUID NOT NULL,
  source           TEXT NOT NULL,         -- 'cron-daily' | 'test'
  title            TEXT NOT NULL,
  body             TEXT NOT NULL,
  url              TEXT,
  badge            INTEGER,
  tag              TEXT,
  "endpointCount"  INTEGER NOT NULL DEFAULT 0,
  "successCount"   INTEGER NOT NULL DEFAULT 0,
  "sentAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS push_history_user_sent_idx
  ON push_history ("userId", "sentAt" DESC);

-- FK 부여 (사용자 삭제 시 cascade)
ALTER TABLE push_history
  DROP CONSTRAINT IF EXISTS push_history_user_fk;
ALTER TABLE push_history
  ADD CONSTRAINT push_history_user_fk
  FOREIGN KEY ("userId") REFERENCES auth.users(id) ON DELETE CASCADE;

-- RLS (Prisma 는 postgres 롤로 우회). anon 키 접근 차단.
ALTER TABLE push_history ENABLE ROW LEVEL SECURITY;
