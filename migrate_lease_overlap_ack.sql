-- 확인된 겹침 (겹침 판정 개정, 2026-08-19 운영자 확정)
-- 프로덕션(Supabase) SQL 에디터에서 1회 실행. 추가 전용(기존 데이터 무손실 — 새 테이블 하나뿐).
-- 한 방의 두 계약이 하루 이상 포개지는 것을 운영자가 '의도된 겹침'으로 확인한 기록.
-- 구간(overlapFrom~overlapTo)은 확인 시점 스냅샷이라 벗어나면 자동 실효된다(lib/roomAssignment findOverlapAck).
-- 해제는 소프트삭제("deletedAt"), 재확인은 새 행.

CREATE TABLE IF NOT EXISTS "lease_overlap_acks" (
  "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
  "propertyId"       UUID         NOT NULL,
  "roomId"           UUID         NOT NULL,
  "frontLeaseTermId" UUID         NOT NULL,   -- 입주일이 이른 쪽
  "backLeaseTermId"  UUID         NOT NULL,
  "overlapFrom"      TEXT         NOT NULL,   -- 'YYYY-MM-DD' (사전순 비교 = 날짜 비교)
  "overlapTo"        TEXT         NOT NULL,   -- 'YYYY-MM-DD'
  "memo"             TEXT,
  "ackedById"        UUID,                    -- 확인한 사용자(users.id)
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"        TIMESTAMP(3),            -- null = 유효한 확인, 값 = 해제 시각
  CONSTRAINT "lease_overlap_acks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lease_overlap_acks_propertyId_fkey"
    FOREIGN KEY ("propertyId") REFERENCES "properties"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "lease_overlap_acks_roomId_fkey"
    FOREIGN KEY ("roomId") REFERENCES "rooms"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "lease_overlap_acks_frontLeaseTermId_fkey"
    FOREIGN KEY ("frontLeaseTermId") REFERENCES "lease_terms"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "lease_overlap_acks_backLeaseTermId_fkey"
    FOREIGN KEY ("backLeaseTermId") REFERENCES "lease_terms"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "lease_overlap_acks_ackedById_fkey"
    FOREIGN KEY ("ackedById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "lease_overlap_acks_propertyId_deletedAt_idx"
  ON "lease_overlap_acks"("propertyId", "deletedAt");
CREATE INDEX IF NOT EXISTS "lease_overlap_acks_frontLeaseTermId_idx"
  ON "lease_overlap_acks"("frontLeaseTermId");
CREATE INDEX IF NOT EXISTS "lease_overlap_acks_backLeaseTermId_idx"
  ON "lease_overlap_acks"("backLeaseTermId");
