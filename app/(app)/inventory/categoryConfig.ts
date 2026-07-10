// 재고관리 카테고리 설정 해석 — 'use server' 아님(propertyId 명시 호출용).
// overview.ts(개요·cron)·alerts.ts·actions.ts 등 서버 모듈에서 공유.
import prisma from '@/lib/prisma'
import { DEFAULT_INVENTORY_CATEGORIES, suggestInventoryAlias, type InventoryCategory } from './constants'

// Property.inventoryCategories(JSON) 를 파싱해 [{cat, alias}] 반환. 없으면 기본값.
export async function getInventoryCategoryConfig(propertyId: string): Promise<InventoryCategory[]> {
  const p = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { inventoryCategories: true },
  })
  return parseInventoryCategories(p?.inventoryCategories ?? null)
}

export function parseInventoryCategories(raw: string | null): InventoryCategory[] {
  if (!raw) return DEFAULT_INVENTORY_CATEGORIES
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return DEFAULT_INVENTORY_CATEGORIES
    const out: InventoryCategory[] = []
    for (const e of arr) {
      const cat = typeof e?.cat === 'string' ? e.cat.trim() : ''
      if (!cat) continue
      const alias = typeof e?.alias === 'string' && e.alias.trim() ? e.alias.trim() : suggestInventoryAlias(cat)
      out.push({ cat, alias })
    }
    return out.length > 0 ? out : DEFAULT_INVENTORY_CATEGORIES
  } catch {
    return DEFAULT_INVENTORY_CATEGORIES
  }
}

// prisma 필터용 — 추적 대상 지출 카테고리 문자열 목록.
export async function getTrackedCategories(propertyId: string): Promise<string[]> {
  return (await getInventoryCategoryConfig(propertyId)).map(c => c.cat)
}


// 품목 추적 단위 기본값 — '폐기물 처리비' 완전일치 하드코딩을 대체(상용화 감사 A3, 2026-07-10).
// 카테고리를 개명해도 폐기물·봉투류는 개수(qty) 추적이 기본이 되도록 키워드 휴리스틱.
export function defaultTrackUnitForCategory(cat: string): 'spec' | 'qty' {
  return /폐기물|봉투|쓰레기/.test(cat) ? 'qty' : 'spec'
}
