-- 발급본 박제 칸 (2026-08-11, 운영자 승인).
-- 발급본은 증거인데 그 증거가 lease 의 서명 네 칸에 얹혀 있었다. 서명을 지우면 이미 발급한
-- 계약서의 서명 기록까지 함께 사라진다 — 502호에서 8/6 서명 이미지가 실제로 소실됐다.
-- 발급 시점의 인쇄 사실(printedFacts 15축)·서명 2장·서명 시각 2개·본문 출처·링크 id 를 여기 박제한다.
-- 쓰기는 발급 트랜잭션 한 번뿐이다. 어떤 경로도 이 값을 갱신하지 않는다.
-- 물리 테이블명은 contract_files 다(@@map). 컬럼은 @map 이 없어 camelCase 그대로다.
ALTER TABLE "contract_files" ADD COLUMN IF NOT EXISTS "issuedSnapshot" JSONB;
