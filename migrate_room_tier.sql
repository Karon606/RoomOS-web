-- 호실 등급(스탠다드/실속형 등) 시스템 추가 (2026-05-28, 2차 #1c+#1d)
-- 프로덕션(Supabase) SQL 에디터에서 1회 실행. 추가 전용·무손실.
-- 방 타입(원룸/미니룸/복층)과 별개 차원의 등급/패키지 개념.

-- 영업장 단위: 등급 옵션 목록 (콤마 구분, 환경설정에서 편집)
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "roomTierOptions" TEXT;

-- 호실 단위: 선택된 등급 (Property.roomTierOptions 중 하나)
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "tier" TEXT;
