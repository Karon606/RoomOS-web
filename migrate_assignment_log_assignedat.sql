-- 배정 이력에 배정일 기록 (2026-07-09) — 이력 표시가 실행 시각(createdAt)만 보여 운영자 혼동
ALTER TABLE "asset_assignment_log" ADD COLUMN IF NOT EXISTS "assignedAt" TIMESTAMP(3);
