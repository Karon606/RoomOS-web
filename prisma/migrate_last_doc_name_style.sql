-- 이 계약에서 마지막으로 쓴 서류 성명 표기 (2026-08-29 운영자 요구) — 다음 서류의 기본값이 된다.
-- 'ko' | 'en' | 'native'. NULL 이면 아직 아무 서류도 안 뽑았다는 뜻이라 종전 거동 그대로다.
-- 되돌림은 칼럼 DROP 하나로 끝난다(서류에 실제로 찍히는 표기는 각 서류가 제 자리에 따로 갖는다).
ALTER TABLE "lease_terms" ADD COLUMN IF NOT EXISTS "lastDocNameStyle" TEXT;
