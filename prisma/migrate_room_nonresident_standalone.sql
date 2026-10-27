-- 단독 계약 불가 방의 비거주 단독 계약 허용 칸 (2026-10-27, 운영자 승인 — 601~604호).
--
-- 왜 한 칸 더인가. 601~604호는 거주 계약을 혼자 맺을 수 없는 방(메인 계약에 묶어야 하는 방)인데,
-- 비거주 계약은 그 방 하나로 맺을 수 있어야 한다. 종전에는 standaloneLeaseAllowed 하나라 방법이
-- 체크를 끄는 것뿐이었고, 그러면 거주 계약도 혼자 들어갔다(602호 임시 조치).
--   · rooms.nonResidentStandaloneAllowed — standaloneLeaseAllowed=false 인 방에서 비거주 계약만은
--     메인 계약 없이 저장할 수 있는가. 기본 false 라 이 마이그레이션만으로는 앱 동작이 바뀌지 않는다.
--
-- 판정 정본은 lib/roomAssignment 의 leaseSubordinationDenial · roomAssignmentBlockReason 이다.
-- 멱등이다(IF NOT EXISTS). 데이터 백필은 없다 — 어느 방을 '비거주 계약만'으로 둘지는 운영자가
-- 호실 관리 편집에서 고른다(602호를 되돌리는 것도 그 화면에서 한다).

ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "nonResidentStandaloneAllowed" BOOLEAN NOT NULL DEFAULT false;
