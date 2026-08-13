-- 다호실 종속 계약 2단계 (2026-08-13, 운영자 승인 — 509호 거주에 딸린 601호 옥탑 창고).
--
-- 왜 두 칸인가.
--   · lease_terms.parentLeaseTermId — 이 계약이 어느 계약에 딸려 있는가. NULL = 단독 계약이다.
--     기존 계약 전건이 NULL 이므로 이 마이그레이션만으로는 앱 동작이 한 글자도 안 바뀐다.
--   · rooms.standaloneLeaseAllowed — 이 방만으로 계약이 되는가. 기본 true(전건 종전 그대로).
--     false 로 둔 방은 부모 계약 지목 없이 계약을 저장할 수 없다(lib/roomAssignment 정본 판정).
--
-- 청구·수납은 이 두 칸을 모른다. 계약은 여전히 각자 청구되고 각자 충당된다(1단계 설계 판정 유지 —
-- 한 계약 = 상태 하나). 바뀌는 것은 서류와 표기다: 계약서 합본 인쇄, 종속분 단독 발급 차단,
-- 목록·호실 칸이 부모로 모임.
--
-- ON DELETE SET NULL 인 이유. 부모 계약을 지우는 일이 딸린 창고 계약까지 지우면 안 된다 —
-- 그 계약은 여전히 돈을 받는 관계다. 끊긴 종속은 감지망 두 축이 잡는다
-- (scripts/check-lease-subordination.mjs — 부모 부재·사망, 단독 불가 방의 부모 없는 계약).

ALTER TABLE "lease_terms" ADD COLUMN IF NOT EXISTS "parentLeaseTermId" UUID;

DO $$ BEGIN
  ALTER TABLE "lease_terms"
    ADD CONSTRAINT "lease_terms_parentLeaseTermId_fkey"
    FOREIGN KEY ("parentLeaseTermId") REFERENCES "lease_terms"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "lease_terms_parentLeaseTermId_idx" ON "lease_terms" ("parentLeaseTermId");

ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "standaloneLeaseAllowed" BOOLEAN NOT NULL DEFAULT true;

-- 데이터 백필은 여기 없다. 김상혁 601호 계약을 509호에 딸리게 하는 것과 601호를 단독 불가로
-- 두는 것은 운영자 실기다(어느 계약에 딸리는지·601 이 실제로 비거주 전환됐는지는 실물 확인 사항).
-- 자동으로 추측해 채우면 그것이 데이터 땜빵이다.
