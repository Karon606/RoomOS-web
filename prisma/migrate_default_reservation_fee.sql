-- 영업장 기본 예약금 (2026-10-10, 운영자 승인).
--
-- 예약금을 보증금과 다른 금액으로 받는 영업장이 있다(예: 보증금 5만, 예약금 10만 — 10만 중 5만은 보증금,
-- 나머지는 입주월 이용료로 충당). 예약금 폼은 그동안 남은 보증금을 미리 채워서 매번 고쳐 써야 했다.
-- NULL = 미설정(종전대로 남은 보증금을 채운다). 기존 행은 전부 NULL 이라 화면이 1비트도 안 바뀐다.
-- 물리 테이블명은 properties(@@map). 되돌림은 칼럼 DROP 하나.
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "defaultReservationFee" INTEGER;
