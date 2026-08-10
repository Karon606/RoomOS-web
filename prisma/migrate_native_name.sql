-- 현지 표기 이름 칸 (2026-08-11, 운영자 승인).
--
-- 그 나라 이름의 발음은 그 나라 표기법이 가장 정확하다. Nguyen 과 Nguyễn 은 다른 이름이고,
-- 중국 이름은 영문 표기만으로는 한자를 되짚을 수 없다. 영문 이름(englishName) 하나로는
-- 그 사실을 담지 못해 칸을 따로 둔다.
--
-- 기존 103행은 전부 NULL 로 시작한다. 백필도 변환도 없고, 값이 없는 입주자의 화면·서류는
-- 이 칸이 생기기 전과 완전히 같다.
-- 물리 테이블명은 tenants 다(@@map). 컬럼은 @map 이 없어 camelCase 그대로다.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "nativeName" TEXT;
