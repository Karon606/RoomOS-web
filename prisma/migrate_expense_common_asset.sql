-- 공용 자재 — 페인트·공구처럼 두고두고 공용으로 쓰는 비품(방/공용부 배분 안 함, 미배정과 구분)
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "isCommonAsset" BOOLEAN NOT NULL DEFAULT false;
