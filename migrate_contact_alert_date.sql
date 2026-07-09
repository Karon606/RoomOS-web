-- 고객별 연락 알림 시작일 (2026-07-10) — 비우면 영업장 기본(contactLeadDays)
ALTER TABLE "lease_terms" ADD COLUMN IF NOT EXISTS "contactAlertDate" TIMESTAMP(3);
