-- #8 계약서 앱서명 재사용 (2026-05-26)
-- 프로덕션(Supabase) SQL 에디터에서 1회 실행. 추가 전용(기존 데이터 무손실).
-- 마지막으로 받은 서명 이미지(dataURL)를 입주자 계약(lease_terms)에 저장 →
-- 계약서 출력 에디터를 다시 열면 이 서명을 불러와 표시(출력 시 (인) 대신 서명).

ALTER TABLE "lease_terms" ADD COLUMN IF NOT EXISTS "signatureImageUrl" TEXT;
