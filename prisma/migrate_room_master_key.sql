-- 도어락 마스터키 저장 칸과 열람 기록 (2026-10-08, 운영자 승인: 소유자 전용·열람 기록·프리즘 안에서만 입력).
--
-- 호실 정보에서 소유자만 보고 고치는 값이다. 담되 평문으로는 담지 않는다. 값은 AES-256-GCM 암호문이고
-- (`v1:<iv>:<tag>:<ct>`, lib/pii), AAD 로 rooms.id 를 묶어 암호문을 다른 방 행에 옮겨 붙이면 복호가 실패한다.
-- 외국인등록번호(migrate_foreign_reg_no.sql)와 같은 축이다.
--
-- 기존 행은 전부 NULL 로 시작한다. 백필도 변환도 없다. 물리 테이블명은 rooms 다(@@map). 컬럼은 camelCase 그대로.
-- 되돌림은 칼럼 DROP 과 테이블 DROP.
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "doorMasterKeyEnc" TEXT;

-- 평문 열람 기록. 호실 프리즘의 revealRoomMasterKey 서버 액션이 유일한 평문 경로이고,
-- 그 문을 지날 때마다 누가 언제 어느 방의 코드를 봤는지 한 줄이 남는다.
CREATE TABLE IF NOT EXISTS "room_master_key_views" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "viewedAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "roomId"     UUID NOT NULL REFERENCES "rooms"("id") ON DELETE CASCADE,
  "propertyId" UUID NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
  "viewedById" UUID REFERENCES "users"("id")
);
CREATE INDEX IF NOT EXISTS "room_master_key_views_room_idx"     ON "room_master_key_views"("roomId", "viewedAt");
CREATE INDEX IF NOT EXISTS "room_master_key_views_property_idx" ON "room_master_key_views"("propertyId", "viewedAt");
