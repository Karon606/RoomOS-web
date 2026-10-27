// 품명별 지난 기록 규격(장부 파생)을 읽어 영수증 인식 품목을 지난 기록 표기에 맞추는 서버 도우미 — 지출 등록·홈 찍어올리기 공용
//
// 왜 한 자리인가(2026-10-27 운영자 승인, 영수증 규격 표기 기억 1단계). 영수증을 읽는 자리가 둘이다(지출 등록 폼의
// analyzeReceiptWithGemini, 홈 찍어올리기 pendingReceipt). 한쪽만 고치면 다른 쪽이 또 AI 글자를 그대로 넣는다.
// 지난 기록은 **장부(Expense)에서 파생한다.** 품목 세부스펙 사전(ItemSpecOption)은 저장 때 쌓기만 하고 장부와 갈렸다
// (장판 표기 셋 중 '폭183cm' 은 장부에 없다). 판정은 순수층 lib/specNotation 이 한다. 여기는 읽기와 붙이기만 한다.
import 'server-only'
import prisma from '@/lib/prisma'
import { reconcileSpecWithHistory, type SpecHistoryRow, type SpecNote } from '@/lib/specNotation'

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
