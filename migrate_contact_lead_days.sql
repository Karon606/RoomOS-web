-- 잠재고객 연락 알림 리드타임 영업장 설정 (2026-07-10, 기본 14일)
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "contactLeadDays" INTEGER NOT NULL DEFAULT 14;
