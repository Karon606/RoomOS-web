-- 규격·단가 모델 확장 (knowledge/spec-model-design.md 권고안, 오류신고 89f5cacc)
-- specText: 서술형 규격(예: '1200x600x720mm') — 표시·자재 카드 구분에만 참여, 재고 계산 비관여.
-- unitBasis: 입력 당시 단가 기준('spec' 규격당 | 'qty' 개당) — 재열람 시 기준 보존.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS "specText" TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS "unitBasis" TEXT;
