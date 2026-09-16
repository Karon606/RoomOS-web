-- 자재 폐기·분실 두 칸 — expenses 에 disposedAt·disposalReason 추가.
-- Supabase SQL 편집기에서 1회 실행.
--
-- 왜 지출 행에 붙나. 축이 둘이다 — 돈의 축(방에 들어간 누적 금액, 절대 안 줄어든다)과
-- 물건의 축(우리가 사서 넣은 것 중 살아 있는 개수). 별도 이벤트 표로 빼면 뺄셈이 되어
-- 음수가 열리고 게이트를 여섯 곳에 매달아야 한다(김치·쌀 사건 구조). 행에 표식을 두면
-- 금액은 손대지 않은 채 수량만 갈라진다.
--
-- ⚠ 컬럼명은 camelCase + 큰따옴표로. 이 프로젝트는 컬럼명을 Prisma 필드명 그대로 쓴다 —
--    따옴표 없이 만들면 Postgres 가 소문자로 접어버려 Prisma("disposedAt")와 불일치.
-- ⚠ `prisma db push` 로 적용하지 않는다 — 스키마 밖에 사는 부분 유니크 인덱스가 날아간다.
-- 인덱스는 만들지 않는다. 이 두 칸은 이미 (propertyId, date) 로 좁혀진 목록 안에서만 읽힌다.

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS "disposedAt" date,
  ADD COLUMN IF NOT EXISTS "disposalReason" text;

-- 백필은 하지 않는다(운영자 확정 2026-09-16). 숫자만으로는 정상인 방과 초과 설치된 방을
-- 구별할 수 없고(502호 밸브 3개 = 511호 밸브 3개), 배정일도 설치일이 아니다.
-- 대신 확인 요청 명부만 낸다 — scripts/check-asset-overinstall.ts.
