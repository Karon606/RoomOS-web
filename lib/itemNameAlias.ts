// 품목명 별칭 학습 — OCR/AI 인식 원문(raw)과 사용자 최종 입력(label)이 다르면 별칭 upsert.
// 다음 인식부터 자동으로 선호명 치환됨. 지출 등록 OCR 저장·홈 찍어올리기 승인이 같은 경로를 쓴다.
import prisma from '@/lib/prisma'

export function normalizeItemName(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase()
}

// best-effort — 실패해도 호출부 저장은 유지(호출부에서 catch)
export async function captureItemNameAliasPairs(propertyId: string, pairs: { raw?: string | null; label?: string | null }[]): Promise<void> {
  for (const p of pairs) {
    const raw = (p.raw ?? '').trim()
    const label = (p.label ?? '').trim()
    if (!raw || !label) continue
    const key = normalizeItemName(raw)
    if (key === normalizeItemName(label)) continue   // 안 고쳤거나 같은 이름 — 학습 불필요
    await prisma.itemNameAlias.upsert({
      where: { propertyId_aliasKey: { propertyId, aliasKey: key } },
      update: { preferredLabel: label, aliasLabel: raw, hitCount: { increment: 1 } },
      create: { propertyId, aliasKey: key, aliasLabel: raw, preferredLabel: label, source: 'ocr', hitCount: 1 },
    })
  }
}
