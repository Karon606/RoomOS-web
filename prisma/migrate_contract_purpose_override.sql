-- 계약서 발급 목적 번복 (2026-08-26 운영자 승인, 긴급 신고 419호).
-- issuePurpose(발급 시점 증거)는 불변으로 두고 '현재 용도'를 따로 든다. 판정은 override ?? issuePurpose.
-- 백필 없음 — null 이 곧 '번복 없음'이다. 되돌림: 두 칼럼 DROP(추가만 있음).
ALTER TABLE "contract_files" ADD COLUMN IF NOT EXISTS "purposeOverride" TEXT;
ALTER TABLE "contract_files" ADD COLUMN IF NOT EXISTS "purposeLog" JSONB;
