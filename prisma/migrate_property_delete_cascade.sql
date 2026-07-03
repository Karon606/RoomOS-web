-- 영업장 영구 삭제 시 연쇄 삭제 — 나머지 21개 관계는 이미 Cascade, 이 4개만 RESTRICT였음.
-- 영업장 삭제(오너 전용, 이름 확인 후)가 FK 제약으로 막히던 것을 해소.
-- 모두 영업장 스코프 데이터라 영업장이 사라지면 함께 삭제되는 것이 의미상 맞다.
ALTER TABLE lease_terms        DROP CONSTRAINT "lease_terms_propertyId_fkey",
  ADD CONSTRAINT "lease_terms_propertyId_fkey"        FOREIGN KEY ("propertyId") REFERENCES properties(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE payment_records     DROP CONSTRAINT "payment_records_propertyId_fkey",
  ADD CONSTRAINT "payment_records_propertyId_fkey"     FOREIGN KEY ("propertyId") REFERENCES properties(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE tenant_status_logs  DROP CONSTRAINT "tenant_status_logs_propertyId_fkey",
  ADD CONSTRAINT "tenant_status_logs_propertyId_fkey"  FOREIGN KEY ("propertyId") REFERENCES properties(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE tenant_requests     DROP CONSTRAINT "tenant_requests_propertyId_fkey",
  ADD CONSTRAINT "tenant_requests_propertyId_fkey"     FOREIGN KEY ("propertyId") REFERENCES properties(id) ON DELETE CASCADE ON UPDATE CASCADE;
