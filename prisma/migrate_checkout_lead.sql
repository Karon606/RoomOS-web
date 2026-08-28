-- 퇴실 예정 자동 전환의 리드 설정 — 영업장별.
-- 단기(한 달 이하 거주)는 일 단위, 그 밖은 달력 개월. 기본값은 앱 기본과 같다(7일 / 1개월).
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "checkoutLeadShortDays" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "checkoutLeadMonths" INTEGER NOT NULL DEFAULT 1;
