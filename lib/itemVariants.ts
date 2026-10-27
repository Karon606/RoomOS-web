// 품명별 지난 기록 규격(장부 파생)을 읽어 영수증 인식 품목을 지난 기록 표기에 맞추는 서버 도우미 — 지출 등록·홈 찍어올리기 공용
//
// 왜 한 자리인가(2026-10-27 운영자 승인, 영수증 규격 표기 기억 1단계). 영수증을 읽는 자리가 둘이다(지출 등록 폼의
// analyzeReceiptWithGemini, 홈 찍어올리기 pendingReceipt). 한쪽만 고치면 다른 쪽이 또 AI 글자를 그대로 넣는다.
// 지난 기록은 **장부(Expense)에서 파생한다.** 품목 세부스펙 사전(ItemSpecOption)은 저장 때 쌓기만 하고 장부와 갈렸다
// (장판 표기 셋 중 '폭183cm' 은 장부에 없다). 판정은 순수층 lib/specNotation 이 한다. 여기는 읽기와 붙이기만 한다.
import 'server-only'
import prisma from '@/lib/prisma'
import { reconcileSpecWithHistory, specKeyOf, type SpecHistoryRow, type SpecNote } from '@/lib/specNotation'
import { resolveUnitBasis, storedUnitBasis, type UnitBasis } from '@/lib/unitBasis'
import { kstYmdStr } from '@/lib/kstDate'

/** 품명마다 지난 기록 규격 조합과 건수(배송비 행 제외). */
export async function loadSpecHistory(propertyId: string, labels: string[]): Promise<Map<string, SpecHistoryRow[]>> {
  const names = [...new Set(labels.map(l => l.trim()).filter(Boolean))]
  const out = new Map<string, SpecHistoryRow[]>()
  if (!names.length) return out
  const rows = await prisma.expense.groupBy({
    by: ['itemLabel', 'specValue', 'specUnit', 'specText'],
    where: { propertyId, itemLabel: { in: names }, isShipping: false },
    _count: { _all: true },
  })
  for (const r of rows) {
    const k = r.itemLabel ?? ''
    const list = out.get(k) ?? []
    list.push({ specValue: r.specValue, specUnit: r.specUnit, specText: r.specText, count: r._count._all })
    out.set(k, list)
  }
  return out
}

type SpecCarrier = { label: string; specValue?: string; specUnit?: string; specText?: string; specNote?: SpecNote }

/**
 * 영수증 인식 품목을 지난 기록에 맞춘다. 규칙은 lib/specNotation reconcileSpecWithHistory.
 * 이미 맞춘 품목(specNote 가 있는 것)은 다시 보지 않는다 — 홈에서 맞춘 결과를 지출 등록 딥링크가 또 맞추면 영수증 원문이 사라진다.
 * 실패해도 인식 결과는 그대로 돌려준다(best-effort).
 */
export async function reconcileOcrItemsWithHistory<T extends SpecCarrier>(propertyId: string, items: T[]): Promise<T[]> {
  try {
    const todo = items.filter(it => !it.specNote && it.label?.trim())
    if (!todo.length) return items
    const hist = await loadSpecHistory(propertyId, todo.map(it => it.label))
    return items.map(it => {
      if (it.specNote || !it.label?.trim()) return it
      const rows = hist.get(it.label.trim())
      if (!rows?.length) return it
      const r = reconcileSpecWithHistory({ specValue: it.specValue, specUnit: it.specUnit, specText: it.specText }, rows)
      if (!r.note) return it
      return { ...it, specValue: r.spec.specValue, specUnit: r.spec.specUnit, specText: r.spec.specText, specNote: r.note }
    })
  } catch {
    return items
  }
}

// ── 지난 기록 변형 목록(이력 제안 패널, 2026-10-27 4단계) ─────────────────────────────────
// 품명 하나 안에서 규격이 같은(표기만 다른 것 포함, lib/specNotation specKeyOf) 구매를 한 변형으로 묶는다. 행을 누르면
// 그 변형 전체(규격·단위·단가 기준·단가·브랜드)로 폼을 채운다. 장부에서만 파생한다(사전 ItemSpecOption 은 안 본다).
export type ItemVariant = {
  itemLabel: string
  key: string                       // specKeyOf — 같은 키 = 같은 변형
  specValue: string; specUnit: string; specText: string | null   // 대표 표기(그 변형에서 가장 많이 쓴 조합)
  raws: { specValue: number | null; specUnit: string | null; specText: string | null }[]   // 그 변형의 모든 원문 조합(저장 게이트 판정용)
  qtyUnit: string | null
  unitBasis: UnitBasis | null       // 그 변형 최신 행에 **기록된** 기준만(날조 금지, lib/unitBasis)
  unitPrice: number | null          // 그 변형 유상 최신 행의 단가(금액 ÷ 기준수량)
  basisUnit: string | null          // 단가가 무엇 1개당인가(규격당이면 규격 단위, 개당이면 수량 단위)
  brand: string | null; productName: string | null
  vendor: string | null
  lastDate: string                  // 최근 구매일 YYYY-MM-DD(KST)
  count: number                     // 구매 건수
}

export async function loadItemVariants(propertyId: string, labels: string[]): Promise<ItemVariant[]> {
  const names = [...new Set(labels.map(l => l.trim()).filter(Boolean))].slice(0, 8)
  if (!names.length) return []
  const [rows, tracked] = await Promise.all([
    prisma.expense.findMany({
      where: { propertyId, itemLabel: { in: names }, isShipping: false },
      select: { itemLabel: true, date: true, amount: true, vendor: true, brand: true, productName: true, specValue: true, specUnit: true, specText: true, qtyValue: true, qtyUnit: true, unitBasis: true },
      orderBy: { createdAt: 'desc' },
      take: 800,
    }),
    prisma.trackedItem.findMany({ where: { propertyId, label: { in: names }, isArchived: false }, select: { label: true, trackUnit: true } }),
  ])
  const trackOf = new Map(tracked.map(t => [t.label, t.trackUnit]))
  type Row = (typeof rows)[number]
  const groups = new Map<string, Row[]>()
  for (const r of rows) {
    const k = `${r.itemLabel}␟${specKeyOf(r)}`
    const list = groups.get(k) ?? []
    list.push(r)
    groups.set(k, list)
  }
  const out: ItemVariant[] = []
  for (const [k, list] of groups) {
    const label = list[0].itemLabel ?? ''
    const combos = new Map<string, { row: Row; count: number }>()
    for (const r of list) {
      const ck = `${r.specValue ?? ''}␟${r.specUnit ?? ''}␟${r.specText ?? ''}`
      const c = combos.get(ck)
      if (c) c.count++; else combos.set(ck, { row: r, count: 1 })
    }
    const rep = [...combos.values()].sort((a, b) => b.count - a.count)[0].row   // 같으면 먼저 온 것(최신)
    const latest = list[0]
    const priced = list.find(r => r.amount > 0)
    let unitPrice: number | null = null
    let basisUnit: string | null = null
    if (priced) {
      const basis = resolveUnitBasis({ recorded: priced.unitBasis, specUnit: priced.specUnit, qtyUnit: priced.qtyUnit, specText: priced.specText, trackUnit: trackOf.get(label) })
      const q = (priced.qtyValue ?? 1) * (basis === 'spec' ? (priced.specValue ?? 1) : 1)
      if (q > 0) unitPrice = Math.round(priced.amount / q)
      basisUnit = basis === 'spec' && priced.specValue ? (priced.specUnit || null) : (priced.qtyUnit || null)
    }
    out.push({
      itemLabel: label,
      key: k.split('␟').slice(1).join('␟'),
      specValue: rep.specValue != null && rep.specValue > 0 ? String(rep.specValue) : '',
      specUnit: rep.specValue != null && rep.specValue > 0 ? (rep.specUnit ?? '') : '',
      specText: (rep.specText ?? '').trim() || null,
      raws: [...combos.values()].map(c => ({ specValue: c.row.specValue, specUnit: c.row.specUnit, specText: c.row.specText })),
      qtyUnit: latest.qtyUnit,
      unitBasis: storedUnitBasis(latest.unitBasis),
      unitPrice, basisUnit,
      brand: latest.brand, productName: latest.productName,
      vendor: latest.vendor,
      lastDate: kstYmdStr(latest.date),
      count: list.length,
    })
  }
  // 품명은 부른 순서(가까운 이름 먼저), 한 품명 안에서는 최근 구매 먼저
  const order = new Map(names.map((n, i) => [n, i]))
  return out.sort((a, b) => (order.get(a.itemLabel)! - order.get(b.itemLabel)!) || b.lastDate.localeCompare(a.lastDate) || b.count - a.count)
}
