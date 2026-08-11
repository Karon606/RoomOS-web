-- 고객 별칭과 카드 표시 이름 선택 (2026-08-11, 운영자 지시).
--
-- 홈 방 현황 타일은 좁아서 이름을 줄여 부르는데, 줄이는 규칙이 '성 이름' 두 토큰짜리
-- 한국식 표기를 가정하고 있었다(두 번째 토큰만 집기). 띄어쓰기가 여럿인 베트남 이름은
-- 중간 토큰 하나('티')만 남는다. 실제 운영은 그 사람을 부르는 말이 따로 있다 — 별칭
-- '안아', 'Maruf'. 그 사실을 적을 칸이 없어서 생긴 요구다.
--
-- nickname: 별칭. 부르는 이름 그대로, 언어 제약 없다. NULL = 별칭 없음.
-- displayNameStyle: 카드(홈 타일 등)에 어떤 이름을 보여줄지 — 'nickname' | 'en'.
--   NULL = 기본(한글 이름). 백필도 기본값도 없다 — 기존 행 전부 NULL 로 시작해
--   이 칸이 생기기 전과 같이 한글 이름이 표시된다. 서류(계약서·확인서)의 성명 표기는
--   lib/documentName 의 별도 정본이고 이 칸의 영향을 받지 않는다.
-- 물리 테이블명은 tenants(@@map). 컬럼은 @map 이 없어 camelCase 그대로다.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "nickname" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "displayNameStyle" TEXT;
