-- 단기 자동 퇴실 예정 전환 기록 — 재전환 방지(수동 되돌림 존중) + 전환일 추적 (운영자 승인 2026-07-11)
ALTER TABLE "lease_terms" ADD COLUMN IF NOT EXISTS "autoCheckoutAt" TIMESTAMPTZ;
