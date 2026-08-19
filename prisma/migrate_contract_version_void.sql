-- 계약서 버전 폐기 (긴급 신고 63cd1049, 2026-08-19 · 운영자 오더로 additive 승인).
--
-- 운영자가 한 일은 '발급본 한 부 삭제'인데 하려던 일은 '이 버전을 폐기'였다. 앱에는 후자라는
-- 개념이 없어, 이름이 잘못 찍힌 계약서를 폐기하고 다시 작성할 길이 닫혀 있었다.
-- 유일한 해제 수단이 서명 삭제(증거 파괴)뿐이었던 것이 사고의 뿌리다.
--
-- 두 칸 다 additive 이고 기존 행은 NULL 로 남는다 — 행 데이터를 고치지 않는다.
--   lease_terms.contractVersionArchive : 폐기된 버전의 서명 원본·격리본·오버라이드 사본(append-only)
--   contract_files.voidedAt            : 폐기된 버전의 발급본이라는 도장(삭제 아님, 파일은 그대로)
-- 물리 테이블명은 @@map 이고 컬럼은 @map 이 없어 camelCase 그대로다(기존 마이그레이션과 동일).
ALTER TABLE "lease_terms"    ADD COLUMN IF NOT EXISTS "contractVersionArchive" JSONB;
ALTER TABLE "contract_files" ADD COLUMN IF NOT EXISTS "voidedAt" TIMESTAMP(3);
