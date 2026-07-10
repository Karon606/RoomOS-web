-- 영업장별 제미나이 API 키(BYOK)·모델 — 공지 AI 다듬기는 본인 키 등록 시 사용 가능 (운영자 결정 2026-07-10)
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "geminiApiKey" TEXT;
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "geminiModel" TEXT;
