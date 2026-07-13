-- 전역 통합 검색용 읽기 인덱스 2건 — 데이터 변경 없음(읽기 최적화 전용).
-- Postgres는 FK에 자동 인덱스를 만들지 않아 tenant/tenant_contacts 조인·스코프 조회가 풀스캔이었음.
-- CONCURRENTLY: 운영 중 테이블 잠금 없이 생성(트랜잭션 밖에서 실행해야 함).
CREATE INDEX CONCURRENTLY IF NOT EXISTS tenants_property_id_idx ON tenants ("propertyId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS tenant_contacts_tenant_id_idx ON tenant_contacts ("tenantId");
