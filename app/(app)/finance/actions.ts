'use server'

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { canReadScope } from '@/lib/auth/routeScope'
import { expenseAccountKey } from '@/lib/expenseExport'
import { consumeGeminiAccess } from '@/lib/geminiKey'
import { normalizeItemName, captureItemNameAliasPairs } from '@/lib/itemNameAlias'
import { computeSetHint } from '@/lib/setHint'
import { ITEM_PRESETS } from '@/lib/itemPresets'
import { randomUUID } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireEdit } from '@/lib/role'
import { uploadToDrive } from '@/lib/google-drive'
import type { Prisma, SettleStatus } from '@prisma/client'
import { FINANCE_DETAIL_SUGGESTIONS_LIMIT } from '@/lib/appConfig'
import { getInventoryCategoryConfig } from '@/app/(app)/inventory/categoryConfig'
import { getExpenseCategories } from '@/app/(app)/settings/actions'
import { seedTrackedItemsFromExpenses } from '@/app/(app)/inventory/actions'
import { buildReceiptOcrPrompt, fetchGeminiOcr, parseReceiptOcrText, type ReceiptOcrItem, type ReceiptOcrResult } from '@/lib/receiptOcr'
import { normalizeBizNo } from '@/lib/bizNo'

async function getPropertyId() {
  const { propertyId } = await requirePropertyAccess()
  return propertyId
}

function parseAmount(raw: FormDataEntryValue | null): number {
  return Number(String(raw ?? '').replace(/[^0-9]/g, '')) || 0
}

// 재고에서 추적하는 지출 카테고리(부식·소모품·폐기물 등). 이 카테고리의 '물품 구매'는 소모품이고,
// 이 외 카테고리의 물품은 '비품·자재'(내구재)라 수령 후 비품 탭에서 방·공용부에 배정한다.
export async function getTrackedCategories(): Promise<string[]> {
  const propertyId = await getPropertyId()
  return (await getInventoryCategoryConfig(propertyId)).map(c => c.cat)
}

export async function getExpenseCategoryTotals(targetMonth: string): Promise<{ category: string; total: number }[]> {
  const propertyId = await getPropertyId()
  const [yyyy, mm] = targetMonth.split('-').map(Number)
  const rows = await prisma.expense.findMany({
    where: {
      propertyId,
      date: { gte: new Date(yyyy, mm - 1, 1), lte: new Date(yyyy, mm, 0) },
    },
    select: { category: true, amount: true },
  })
  const map: Record<string, number> = {}
  for (const r of rows) map[r.category] = (map[r.category] ?? 0) + r.amount
  return Object.entries(map).map(([category, total]) => ({ category, total }))
}

// 지출 엑셀 내보내기 모달용 옵션 — 지출이 있는 월(YYYY-MM 내림차순)과 카드·계좌별 건수·금액 합(금액 내림차순).
// 읽기 전용. 금액 정보를 담으므로 money 읽기 게이트(제한 스태프 차단). 그룹 키는 API 엑셀과 같은 공용 함수를 쓴다.
export async function getExpenseExportOptions(): Promise<{
  months: string[]
  accounts: { key: string; count: number; sum: number }[]
}> {
  const { propertyId, role } = await requirePropertyAccess()
  if (!canReadScope(role, 'money')) throw new Error('권한이 없습니다.')
  const rows = await prisma.expense.findMany({
    where: { propertyId },
    select: {
      date: true, amount: true, payMethod: true, financeName: true,
      financialAccount: { select: { brand: true, alias: true } },
    },
  })
  // 월 목록 — 지출이 존재하는 YYYY-MM(로컬 기준, API expenseMonthKey 와 동일 산식) 내림차순.
  const monthSet = new Set<string>()
  for (const r of rows) {
    monthSet.add(`${r.date.getFullYear()}-${String(r.date.getMonth() + 1).padStart(2, '0')}`)
  }
  const months = [...monthSet].sort((a, b) => (a < b ? 1 : -1))
  // 카드·계좌 키별 건수·금액 합 — 금액 합 내림차순(엑셀 시트 배치 순서와 통일).
  const acc = new Map<string, { count: number; sum: number }>()
  for (const r of rows) {
    const key = expenseAccountKey(r)
    const cur = acc.get(key) ?? { count: 0, sum: 0 }
    cur.count += 1
    cur.sum += r.amount
    acc.set(key, cur)
  }
  const accounts = [...acc.entries()]
    .map(([key, v]) => ({ key, count: v.count, sum: v.sum }))
    .sort((a, b) => b.sum - a.sum)
  return { months, accounts }
}

export async function getRoomList() {
  const propertyId = await getPropertyId()
  return prisma.room.findMany({
    where: { propertyId },
    select: { id: true, roomNo: true },
    orderBy: { roomNo: 'asc' },
  })
}

// ── 지출 ────────────────────────────────────────────────────────

export async function getExpenses(targetMonth: string) {
  const propertyId = await getPropertyId()
  const [yyyy, mm] = targetMonth.split('-').map(Number)
  return prisma.expense.findMany({
    where: {
      propertyId,
      date: { gte: new Date(yyyy, mm - 1, 1), lte: new Date(yyyy, mm, 0) },
    },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    include: {
      financialAccount: { select: { brand: true, alias: true } },
      room: { select: { id: true, roomNo: true } },
      recurringExpense: { select: { isVariable: true } },
      order: { select: { id: true, code: true, externalOrderNo: true, shippingType: true, shippingMemo: true } },
    },
  })
}

// 과거 구매내역 검색 — 월 한정인 지출 화면과 달리 '전 기간'을 품목명·세부·판매처·메모·카테고리로 검색.
export type ExpenseSearchResult = {
  id: string
  date: Date
  amount: number
  category: string
  detail: string | null
  itemLabel: string | null
  vendor: string | null
  memo: string | null
  specValue: number | null
  specUnit: string | null
  qtyValue: number | null
  qtyUnit: string | null
  roomNo: string | null
}

export async function searchExpenses(query: string): Promise<ExpenseSearchResult[]> {
  const propertyId = await getPropertyId()
  const q = query.trim()
  if (q.length < 1) return []
  const rows = await prisma.expense.findMany({
    where: {
      propertyId,
      OR: [
        { itemLabel: { contains: q, mode: 'insensitive' } },
        { detail:    { contains: q, mode: 'insensitive' } },
        { vendor:    { contains: q, mode: 'insensitive' } },
        { memo:      { contains: q, mode: 'insensitive' } },
        { category:  { contains: q, mode: 'insensitive' } },
      ],
    },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    take: 300,
    include: { room: { select: { roomNo: true } } },
  })
  return rows.map(r => ({
    id: r.id,
    date: r.date,
    amount: r.amount,
    category: r.category,
    detail: r.detail,
    itemLabel: r.itemLabel,
    vendor: r.vendor,
    memo: r.memo,
    specValue: r.specValue,
    specUnit: r.specUnit,
    qtyValue: r.qtyValue,
    qtyUnit: r.qtyUnit,
    roomNo: r.room?.roomNo ?? null,
  }))
}

export async function getUnsettledExpenses() {
  const propertyId = await getPropertyId()
  return prisma.expense.findMany({
    where: { propertyId, settleStatus: 'UNSETTLED' },
    orderBy: { date: 'asc' },
    include: {
      financialAccount: {
        select: {
          id: true, brand: true, alias: true,
          cutOffDay: true, payDay: true,
          linkedAccount: { select: { brand: true, alias: true } },
        },
      },
    },
  })
}

export async function getSettledCardExpenses(targetMonth?: string) {
  const propertyId = await getPropertyId()
  // targetMonth가 있으면 해당 월 ±2달 범위, 없으면 최근 4달
  const since = new Date()
  if (targetMonth) {
    const [y, m] = targetMonth.split('-').map(Number)
    since.setFullYear(y, m - 3, 1)
  } else {
    since.setMonth(since.getMonth() - 4)
  }
  return prisma.expense.findMany({
    where: {
      propertyId,
      settleStatus: 'SETTLED',
      payMethod: { in: ['신용카드', '체크카드'] },
      date: { gte: since },
    },
    orderBy: { date: 'asc' },
    include: {
      financialAccount: {
        select: {
          id: true, brand: true, alias: true,
          cutOffDay: true, payDay: true,
          linkedAccount: { select: { brand: true, alias: true } },
        },
      },
    },
  })
}

export async function uploadExpenseReceipt(formData: FormData): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const file = formData.get('receipt') as File
    if (!file || file.size === 0) return { ok: false, error: '파일이 없습니다.' }
    if (!file.type.startsWith('image/')) return { ok: false, error: '이미지 파일만 업로드 가능합니다.' }
    if (file.size > 10 * 1024 * 1024) return { ok: false, error: '파일 크기는 10MB 이하여야 합니다.' }
    const buffer = Buffer.from(await file.arrayBuffer())
    const ext = file.name.split('.').pop() ?? 'jpg'
    const fileName = `receipt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { thumbnailUrl } = await uploadToDrive(buffer, fileName, file.type)
    return { ok: true, url: thumbnailUrl }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 품목 선택 시 직전 구매 컨텍스트 전체를 불러온다(운영자 요청 2026-07-06):
// 단위뿐 아니라 규격 값·서술 규격·수량·단가 기준·단가까지 — "장판을 고르면 지난번 183cm x 10m 규격과
// 그때의 단가 기준(10m당 등)이 그대로" 재현되어, 규격을 품명에 섞어 새 품목을 만들 이유를 없앤다.
export type LastItemContext = {
  specUnit: string | null; qtyUnit: string | null; trackUnit: string | null
  specOptions: string[]               // 품목 세부스펙 사전 (색상·사이즈·치수 칩 — 신고 ba9feb6b)
  specValue: string | null            // 직전 규격 값 (예: '20')
  specText: string | null             // 직전 서술 규격 (예: '183cm x 10m x 1.8T')
  unitBasis: 'spec' | 'qty' | null    // 직전 단가 기준 — 규격당/완제품당 유지
  qtyValue: string | null             // 직전 수량
  unitPrice: number | null            // 직전 단가 (금액 ÷ 기준수량 역산)
  trackedCategories: string[]         // 이 품목명이 재고 품목으로 등록된 카테고리들 — 착오 등록 경고용(신고 1f99d83c)
}

export async function getLastItemUnits(itemLabel: string): Promise<LastItemContext | null> {
  const propertyId = await getPropertyId()
  const sel = { specValue: true, specUnit: true, specText: true, unitBasis: true, qtyValue: true, qtyUnit: true, amount: true } as const
  const [row, priceRow, tracked] = await Promise.all([
    prisma.expense.findFirst({
      where: { propertyId, itemLabel },
      select: sel,
      orderBy: { createdAt: 'desc' },
    }),
    // 단가 이력은 유상 구매만 — 무상입수(0원) 행이 최신이면 단가가 비어버리는 것 방지(하수구트랩 사례 2026-07-06)
    prisma.expense.findFirst({
      where: { propertyId, itemLabel, amount: { gt: 0 } },
      select: sel,
      orderBy: { createdAt: 'desc' },
    }),
    // 품목의 재고 추적 단위 — '수량' 품목(종량제봉투 등)은 개당 단가가 기본이 되도록(오류신고 c7cf6180)
    // 카테고리 목록 포함 — 다른 카테고리로 잘못 등록하면 같은 품목이 하나 더 생기므로 폼에서 경고
    prisma.trackedItem.findMany({ where: { propertyId, label: itemLabel, isArchived: false }, select: { trackUnit: true, category: true } }),
  ])
  const specOptions = await prisma.itemSpecOption.findMany({
    where: { propertyId, itemLabel },
    orderBy: { createdAt: 'asc' },
    take: 20,
    select: { label: true },
  }).then(rows => rows.map(r => r.label)).catch(() => [] as string[])
  if (!row && tracked.length === 0 && specOptions.length === 0) return null
  // 단가 역산 — 입력 폼과 동일 산식: 기준수량 = 수량 × (규격당 기준이면 규격 값).
  // unitBasis 미기록(구 데이터)이면 규격 값이 있을 때 'spec'(폼 기본값과 동일 관례).
  const basis: 'spec' | 'qty' | null = row
    ? ((row.unitBasis === 'spec' || row.unitBasis === 'qty') ? row.unitBasis : (row.specValue ? 'spec' : 'qty'))
    : null
  let unitPrice: number | null = null
  if (priceRow && priceRow.amount > 0) {
    const pBasis: 'spec' | 'qty' = (priceRow.unitBasis === 'spec' || priceRow.unitBasis === 'qty')
      ? priceRow.unitBasis : (priceRow.specValue ? 'spec' : 'qty')
    const q = (priceRow.qtyValue ?? 1) * (pBasis === 'spec' ? (priceRow.specValue ?? 1) : 1)
    if (q > 0) unitPrice = Math.round(priceRow.amount / q)
  }
  return {
    specUnit: row?.specUnit ?? null,
    qtyUnit: row?.qtyUnit ?? null,
    trackUnit: tracked[0]?.trackUnit ?? null,
    specOptions,
    specValue: row?.specValue != null ? String(row.specValue) : null,
    specText: row?.specText ?? null,
    unitBasis: basis,
    qtyValue: row?.qtyValue != null ? String(row.qtyValue) : null,
    unitPrice,
    trackedCategories: tracked.map(t => t.category),
  }
}

type ItemPick = {
  label: string
  ocrRaw?: string   // OCR 인식 원문 — 최종 label 과 다르면 별칭 학습(다음 영수증 자동 치환)
  specValue?: string; specUnit?: string
  specText?: string          // 서술형 규격(계산 비관여, 표시·자재 구분용)
  unitBasis?: 'spec' | 'qty' // 입력 당시 단가 기준 — 재열람 시 보존
  qtyValue?: string;  qtyUnit?: string
  amount?: number
  // 방별 분배 (선택) — 있으면 이 품목을 방별 행으로 분할(금액은 수량 비례, 마지막 행이 잔여 흡수)
  allocations?: { roomId: string; qty: string }[]
}

// 품목 목록 → 실제 지출 행으로 확장. 방별 분배(allocations)가 있으면 방별로 쪼개고,
// 배정 안 한 나머지 수량은 '방 미지정' 행으로 남긴다(예: 6개 중 2개만 방 배정, 4개 예비).
// 금액은 수량 비례 배분(반올림 잔여는 마지막 행이 흡수). allocations 없으면 폼 전체 방(formRoomId) 1행.
type ExpandedRow = { it: ItemPick; amount: number; qtyValue: string | undefined; roomId: string | null; groupId: string | null }
function expandExpenseRows(items: ItemPick[], formRoomId: string | null): ExpandedRow[] {
  const rows: ExpandedRow[] = []
  for (const it of items) {
    const itAmount = Number(it.amount) || 0
    const itemQty = Number(it.qtyValue) || 0
    const allocs = (Array.isArray(it.allocations) ? it.allocations : []).filter(a => a && (a.roomId || a.qty))
    if (allocs.length === 0) {
      rows.push({ it, amount: itAmount, qtyValue: it.qtyValue, roomId: formRoomId, groupId: null })
      continue
    }
    // 한 품목이 방별로 여러 행으로 쪼개지면 공통 묶음 ID 부여 → 목록에서 한 줄로 묶어 표시.
    const groupId = randomUUID()
    const startLen = rows.length
    const allocSum = allocs.reduce((s, a) => s + (Number(a.qty) || 0), 0)
    const denom = Math.max(itemQty, allocSum) || allocs.length
    let usedAmt = 0
    for (const a of allocs) {
      const aq = Number(a.qty) || 0
      const amt = Math.round(itAmount * (aq / denom))
      usedAmt += amt
      rows.push({ it, amount: amt, qtyValue: String(aq), roomId: a.roomId || null, groupId })
    }
    const remQty = denom - allocSum
    if (remQty > 0.001) {
      // 배정 안 한 나머지 — 방 미지정 행
      rows.push({ it, amount: itAmount - usedAmt, qtyValue: String(Math.round(remQty * 100) / 100), roomId: null, groupId })
    } else if (rows.length > 0) {
      // 반올림 잔여는 마지막 행에 흡수
      rows[rows.length - 1].amount += (itAmount - usedAmt)
    }
    // 결과적으로 한 행뿐이면 묶을 필요 없음 → groupId 제거
    if (rows.length - startLen <= 1) for (let i = startLen; i < rows.length; i++) rows[i].groupId = null
  }
  return rows
}

// ── 합배송 주문번호 자동 생성 'YYMMDD-NNN' (propertyId·일자별 순번) ──
const SHIPPING_TYPES = ['선불', '착불', '신용'] as const
async function genOrderCode(propertyId: string): Promise<string> {
  // KST 기준 오늘 날짜로 prefix. 같은 prefix 개수 +1 = 순번.
  const now = new Date(Date.now() + 9 * 3600000)
  const yy = String(now.getUTCFullYear()).slice(2)
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(now.getUTCDate()).padStart(2, '0')
  const prefix = `${yy}${mm}${dd}`
  const used = await prisma.expenseOrder.count({ where: { propertyId, code: { startsWith: prefix } } })
  return `${prefix}-${String(used + 1).padStart(3, '0')}`
}

// ── 품명 정규화 (별칭 매칭 키) ─────────────────────────────────────
// 영수증 OCR 학습·자동완성·병합이 공유하는 키. 공백 정리 + 소문자 → 사소한 변형 흡수.
// ('use server' 파일이라 export 불가 — 공유 필요 시 별도 util로 분리 예정)
// normalizeItemName·별칭 upsert 는 lib/itemNameAlias 로 이동(홈 찍어올리기 승인과 학습 경로 공유)

// ── 영수증 OCR (Gemini Vision) ────────────────────────────────────
// 정밀 프롬프트·응답 파싱·타입은 lib/receiptOcr 로 공유(홈 찍어올리기와 동일 인식). 여기선 vocab·별칭·setHint 결합.
export type { ReceiptOcrItem, ReceiptOcrResult } from '@/lib/receiptOcr'

export async function analyzeReceiptWithGemini(imageBase64: string, mimeType: string): Promise<{ ok: true; data: ReceiptOcrResult } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const ocrPropertyId = await getPropertyId()
    if (!imageBase64) return { ok: false, error: '이미지 데이터가 비어있습니다.' }
    const ai = await consumeGeminiAccess()
    if (!ai.ok) return { ok: false, error: ai.error }
    const apiKey = ai.apiKey

    // 이 사업장 품목 사전 — 과거 입력(사용자가 수정해 확정한 최종명)과 관행 단위를 프롬프트에 제공해
    // 인식 결과가 운영자가 쓰는 이름·단위로 수렴하게 함(수정할수록 정확해지는 튜닝 루프 — 오류신고 4e2ffe04).
    // 품목명 치환은 별칭 학습(itemNameAlias)이 정확 일치를 담당하고, 이 사전은 근사 표기를 흡수한다.
    // 재고 추적품목 라벨을 항상 앞에 — 최근 지출만 쓰면 오래 안 산 품목이 컷에 밀려 AI가 존재를 모르고
    // 상표명으로 새 품목을 제안한다(모나리자 키친타올 사건, 운영자 보고 2026-07-21).
    let vocabBlock = ''
    try {
      const [tracked, rows] = await Promise.all([
        prisma.trackedItem.findMany({
          where: { propertyId: ocrPropertyId, isArchived: false },
          select: { label: true, specUnit: true, qtyUnit: true },
        }),
        prisma.expense.findMany({
          where: { propertyId: ocrPropertyId, itemLabel: { not: null } },
          select: { itemLabel: true, specUnit: true, qtyUnit: true },
          orderBy: { createdAt: 'desc' },
          take: 300,
        }),
      ])
      const seen = new Map<string, { spec: string | null; qty: string | null }>()
      for (const t of tracked) {
        const k = t.label.trim()
        if (k && !seen.has(k)) seen.set(k, { spec: t.specUnit, qty: t.qtyUnit })
      }
      for (const r of rows) {
        const k = (r.itemLabel ?? '').trim()
        if (k && !seen.has(k)) seen.set(k, { spec: r.specUnit, qty: r.qtyUnit })
      }
      const vocab = [...seen.entries()].slice(0, Math.max(60, tracked.length)).map(([label, u]) =>
        `${label}${u.spec || u.qty ? ` (규격단위 ${u.spec ?? '—'} · 수량단위 ${u.qty ?? '—'})` : ''}`)
      if (vocab.length) vocabBlock = `

이 사업장에서 쓰는 품목명·단위 목록 (인식한 품목이 이 중 하나와 같은 물건이면, 상표명·표기가 달라도 반드시 이 이름과 단위 표기를 그대로 쓰세요. 예: '모나리자 키친타올'도 목록에 '키친타월 (롤타입)'이 있으면 그 이름으로):
- ${vocab.join('\n- ')}`
    } catch { /* 사전 조회 실패해도 OCR 자체는 정상 동작 */ }

    // 카테고리 후보는 영업장 설정에서 — 기본 13종을 하드코딩하면 커스텀 카테고리가 OCR 분류에서 배제된다(멀티테넌트, 운영자 승인 2026-07-14)
    const ocrCategories = (await getExpenseCategories()).join('|')

    const prompt = buildReceiptOcrPrompt({ categories: ocrCategories, vocabBlock })

    const fetched = await fetchGeminiOcr({ apiKey, imageBase64, mimeType, prompt, maxOutputTokens: 4096 })
    if (!fetched.ok) {
      if (fetched.status === 200) return { ok: false, error: fetched.errorText }   // 절단 안내(fetchGeminiOcr가 문구 생성)
      console.error('[receiptOcr] API 오류', fetched.status, fetched.errorText)
      return { ok: false, error: `인식 서비스 연결에 실패했습니다. 잠시 후 다시 시도해 주세요. (오류 ${fetched.status})` }
    }
    const parsedRes = parseReceiptOcrText(fetched.text)
    if (!parsedRes.ok) return { ok: false, error: parsedRes.error }
    const data = parsedRes.data

    // 학습된 별칭 적용 — 정규화 원문이 별칭에 있으면 선호명으로 치환(원문은 rawLabel 로 보존해 저장 시 재학습 판단).
    let aliasMap = new Map<string, string>()
    try {
      const aliasRows = await prisma.itemNameAlias.findMany({ where: { propertyId: ocrPropertyId }, select: { aliasKey: true, preferredLabel: true } })
      aliasMap = new Map(aliasRows.map(a => [a.aliasKey, a.preferredLabel]))
    } catch { /* 별칭 테이블 미적용(SQL 전)이어도 OCR 자체는 정상 동작 */ }
    const aliasedItems: ReceiptOcrItem[] = data.items.map(it => {
      const pref = aliasMap.get(normalizeItemName(it.label))
      return { ...it, rawLabel: it.label, label: pref ?? it.label }
    })

    // 세트 상품 의심 감지 — 온라인 영수증은 품목당 합계 위주라 실물 수량이 안 보임(운영자 2026-07-06).
    // 라벨 'N개입' 표기 또는 과거 개당 단가의 정확한 N배면 힌트를 붙여 클라이언트가 되묻게 한다.
    try {
      const hints = await Promise.all(aliasedItems.map(it => computeSetHint(ocrPropertyId, it)))
      hints.forEach((h, i) => { if (h) aliasedItems[i].setHint = h })
    } catch { /* 힌트 실패해도 OCR 결과는 정상 반환 */ }

    return {
      ok: true,
      data: { ...data, items: aliasedItems },
    }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 저장 시 품명 학습 — itemsJson 품목 중 OCR 원문(ocrRaw)과 사용자 최종 입력 label 이 다르면 별칭 upsert.
// → 다음 영수증에서 같은 원문이 인식되면 자동으로 선호명으로 치환됨. (best-effort — 실패해도 저장 유지)
async function captureItemNameAliases(propertyId: string, items: ItemPick[]): Promise<void> {
  await captureItemNameAliasPairs(propertyId, items.map(it => ({ raw: it.ocrRaw, label: it.label })))
}

// 저장 시 세부스펙 적립(신고 ba9feb6b) — 품목별 사전(item_spec_options)에 upsert.
// 한 번 입력한 색상·사이즈·치수는 다음 입력에서 칩으로 재사용, 설정에서 수정·삭제. best-effort.
async function captureItemSpecOptions(propertyId: string, items: ItemPick[]): Promise<void> {
  for (const it of items) {
    const label = it.label?.trim()
    const spec = it.specText?.trim()
    if (!label || !spec) continue
    await prisma.itemSpecOption.upsert({
      where: { propertyId_itemLabel_label: { propertyId, itemLabel: label, label: spec } },
      update: {},
      create: { propertyId, itemLabel: label, label: spec },
    }).catch(() => {})
  }
}

// 사업자등록번호 소급 보정 — 같은 구매처의 과거 지출 중 번호가 비어(NULL) 있는 행에만 이 번호를 채운다.
// 항목 신설로 과거 누락분을 새 인식이 들어올 때마다 소급 보정 — 과거 이력이 정리되면 제거 가능(운영자 2026-07-23).
// 이미 다른 번호가 있는 행은 덮어쓰지 않는다(NULL 만 채움 — 잘못된 전파 방지). best-effort(실패해도 저장은 유지).
async function backfillVendorBizNo(propertyId: string, vendor: string | null, bizNo: string | null): Promise<number> {
  if (!vendor || !bizNo) return 0
  try {
    const r = await prisma.expense.updateMany({
      where: { propertyId, vendor, vendorBizNo: null },
      data: { vendorBizNo: bizNo },
    })
    return r.count
  } catch {
    return 0
  }
}

export async function addExpense(formData: FormData): Promise<{ ok: true; backfilled?: number } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const date      = formData.get('date') as string
    const amount    = parseAmount(formData.get('amount'))
    const category  = formData.get('category') as string
    const detail    = formData.get('detail') as string
    const vendor    = formData.get('vendor') as string
    const vendorBizNo = normalizeBizNo(formData.get('vendorBizNo') as string)   // 빈 값·잘못된 길이면 null
    const memo      = formData.get('memo') as string
    const payMethod = formData.get('payMethod') as string
    const financialAccountId = formData.get('financialAccountId') as string
    const financeName        = formData.get('financeName') as string
    const roomId             = formData.get('roomId') as string
    const receiptUrl         = formData.get('receiptUrl') as string
    const itemLabel = formData.get('itemLabel') as string
    const specUnit  = formData.get('specUnit') as string
    const qtyUnit   = formData.get('qtyUnit') as string
    const specValueRaw = formData.get('specValue') as string
    const specTextRaw  = formData.get('specText') as string
    const qtyValueRaw  = formData.get('qtyValue') as string
    const itemsJsonRaw = formData.get('itemsJson') as string
    // 품명 학습용 — itemsJson 품목 전체(단일/다품목 무관). 저장 후 ocrRaw≠label 인 것만 별칭 upsert.
    const ocrCaptureItems: ItemPick[] = (() => {
      if (!itemsJsonRaw) return []
      try { const p = JSON.parse(itemsJsonRaw); return Array.isArray(p) ? p : [] } catch { return [] }
    })()
    const excludeFromInventory = formData.get('excludeFromInventory') === '1'  // 서비스·무형 = 재고/비품 제외
    // 합배송(주문 묶음 + 배송비 별도 지출) 필드
    const orderShipping     = parseAmount(formData.get('orderShipping'))
    const orderShippingType = (formData.get('orderShippingType') as string) || null
    const orderShippingMemo = (formData.get('orderShippingMemo') as string) || null
    const externalOrderNo   = ((formData.get('externalOrderNo') as string) || '').trim() || null
    // 같은 쇼핑몰 주문번호의 기존 주문에 합류(클라이언트에서 확인 후 전달) — 오류신고 4f9fb398
    const attachOrderId     = ((formData.get('attachOrderId') as string) || '').trim() || null
    const isOrderMode       = !!orderShipping && orderShipping > 0
    // 합산형 배송비('배송비 포함') — amount 에 이미 더해져 제출됨. 품목합 검증 시 이만큼 차감.
    // (이전엔 이 필드가 없어 '품목 2개+ + 배송비 포함' 조합이 합계 불일치로 항상 저장 실패)
    const shippingIncluded  = parseAmount(formData.get('shippingIncluded')) || 0

    if (!date || !amount || !category) return { ok: false, error: '날짜, 금액, 카테고리는 필수입니다.' }

    // 다중 품목/방별 분배: itemsJson 파싱해 N개 행으로 분할.
    // 품목 2개 이상이거나, 한 품목이라도 방별 분배(allocations)가 있으면 분할 경로.
    let multiItems: ItemPick[] | null = null
    if (itemsJsonRaw) {
      try {
        const parsed = JSON.parse(itemsJsonRaw)
        if (Array.isArray(parsed) && parsed.length >= 1) {
          const hasAlloc = parsed.some((it: ItemPick) => Array.isArray(it.allocations) && it.allocations.length > 0)
          if (parsed.length >= 2 || hasAlloc) multiItems = parsed
        }
      } catch { /* fallthrough → 단일 row */ }
    }

    const baseSettleStatus: SettleStatus = payMethod === '신용카드' ? 'UNSETTLED' : 'SETTLED'

    // 품목 합계 검증을 주문 생성보다 먼저 — 실패 시 고아 주문 방지 (합산형 배송비는 차감 후 비교)
    if (multiItems) {
      const sum = multiItems.reduce((s, it) => s + (Number(it.amount) || 0), 0)
      if (Math.abs(sum + shippingIncluded - amount) > 1) {
        return { ok: false, error: `품목 금액 합계(${sum.toLocaleString()}원${shippingIncluded ? ` + 배송비 ${shippingIncluded.toLocaleString()}원` : ''})와 총 금액(${amount.toLocaleString()}원)이 일치하지 않습니다.` }
      }
    }

    // 주문(ExpenseOrder) 부여:
    //  - 합배송(isOrderMode): 배송비 결제구분 포함 주문 생성.
    //  - 그 외 다품목 구매(multiItems ≥ 2): 배송비 없는 주문 자동 생성 → 지출내역 '주문별 보기'에서 한 묶음.
    //  (단일 품목은 주문 불필요 — 그 자체가 한 건)
    let orderId: string | null = null
    // 기존 주문 합류 — 같은 주문번호로 이미 만든 주문에 이 지출을 묶음(판매점별 영수증 여러 장 대응).
    if (attachOrderId) {
      const existing = await prisma.expenseOrder.findFirst({ where: { id: attachOrderId, propertyId }, select: { id: true } })
      if (existing) orderId = existing.id
    }
    if (!orderId) {
      if (isOrderMode) {
        const shipType = orderShippingType && (SHIPPING_TYPES as readonly string[]).includes(orderShippingType)
          ? orderShippingType : null
        const order = await prisma.expenseOrder.create({
          data: { propertyId, code: await genOrderCode(propertyId), externalOrderNo, shippingType: shipType, shippingMemo: orderShippingMemo },
        })
        orderId = order.id
      } else if ((multiItems && multiItems.length > 1) || externalOrderNo) {
        const order = await prisma.expenseOrder.create({
          data: { propertyId, code: await genOrderCode(propertyId), externalOrderNo, shippingType: null, shippingMemo: null },
        })
        orderId = order.id
      }
    }

    const baseRow = {
      propertyId,
      date:               new Date(date),
      category,
      vendor:             vendor || null,
      vendorBizNo:        vendorBizNo,
      memo:               memo || null,
      payMethod:          payMethod || '계좌이체',
      financialAccountId: financialAccountId || null,
      financeName:        financeName || null,
      receiptUrl:         receiptUrl || null,
      settleStatus:       baseSettleStatus,
      roomId:             roomId || null,
      excludeFromInventory,
      orderId,
    }

    // 배송비 별도 지출 라인(합배송) — 주문에 연결, 재고 계산 제외.
    //   카드결제(신용카드)면 본 지출과 동일하게 미정산, 배송비 자체가 후불('신용')이어도 미정산.
    //   (예전엔 배송 구분만 보고 카드결제인데도 자동 정산완료되던 버그)
    const shippingSettle: SettleStatus =
      (payMethod === '신용카드' || orderShippingType === '신용') ? 'UNSETTLED' : 'SETTLED'
    const shippingCreate = isOrderMode
      ? prisma.expense.create({
          data: {
            propertyId,
            date:               new Date(date),
            category,
            amount:             orderShipping,
            detail:             `배송비${orderShippingType ? ` (${orderShippingType})` : ''}`,
            vendor:             vendor || null,
            vendorBizNo:        vendorBizNo,
            memo:               orderShippingMemo || null,
            payMethod:          payMethod || '계좌이체',
            financialAccountId: financialAccountId || null,
            financeName:        financeName || null,
            settleStatus:       shippingSettle,
            orderId,
            isShipping:         true,
            excludeFromInventory: true,
          },
        })
      : null

    if (multiItems) {
      // (합배송이어도 amount=품목합. 배송비는 shippingCreate 별도 라인.)
      // 품목 → 행 확장(방별 분배·미지정 나머지 처리).
      const rows = expandExpenseRows(multiItems, roomId || null)
      const itemCreates = rows.map(r => prisma.expense.create({
        data: {
          ...baseRow,
          roomId:    r.roomId,
          amount:    r.amount,
          detail:    `[${r.it.label}]${r.it.specText ? ` ${r.it.specText}` : r.it.specValue ? ` ${r.it.specValue}${r.it.specUnit ?? ''}` : ''}${r.qtyValue ? ` x ${r.qtyValue}${r.it.qtyUnit ?? ''}` : ''}`,
          itemLabel: r.it.label,
          specUnit:  r.it.specUnit || null,
          qtyUnit:   r.it.qtyUnit  || null,
          specValue: r.it.specValue ? parseFloat(r.it.specValue) : null,
          specText:  r.it.specText || null,
          unitBasis: r.it.unitBasis || null,
          qtyValue:  r.qtyValue ? parseFloat(r.qtyValue) : null,
          allocationGroupId: r.groupId,
        },
      }))
      const ops = [...itemCreates]
      if (shippingCreate) ops.push(shippingCreate)
      // 합산형 배송비 — 품목 행으로 흡수하면 단가가 왜곡되므로 별도 행(재고 제외)으로 분리
      if (shippingIncluded > 0) ops.push(prisma.expense.create({
        data: { ...baseRow, amount: shippingIncluded, detail: '배송비', isShipping: true, excludeFromInventory: true },
      }))
      await prisma.$transaction(ops)
      await captureItemNameAliases(propertyId, ocrCaptureItems).catch(() => {})
      await captureItemSpecOptions(propertyId, ocrCaptureItems).catch(() => {})
      // 재고 카드 자동 생성 — 추적 카테고리 품목이면 버튼 없이 바로 재고에 잡히게(신고 269baf9f)
      await seedTrackedItemsFromExpenses(ocrCaptureItems.map(it => it.label).filter(Boolean)).catch(() => {})
      const backfilled = await backfillVendorBizNo(propertyId, vendor || null, vendorBizNo)
      revalidatePath('/finance')
      return { ok: true, backfilled }
    }

    const singleCreate = prisma.expense.create({
      data: {
        ...baseRow,
        amount,
        detail:             detail || null,
        itemLabel:          itemLabel || null,
        specUnit:           specUnit || null,
        qtyUnit:            qtyUnit || null,
        specValue:          specValueRaw ? parseFloat(specValueRaw) : null,
        // 서술형 규격(색상·사이즈) — 다품목 경로만 저장하고 단일 품목은 유실되던 버그(오류신고 48376868)
        specText:           specTextRaw || null,
        qtyValue:           qtyValueRaw  ? parseFloat(qtyValueRaw)  : null,
      },
    })
    const ops = [singleCreate]
    if (shippingCreate) ops.push(shippingCreate)
    await prisma.$transaction(ops)
    await captureItemNameAliases(propertyId, ocrCaptureItems).catch(() => {})
    await captureItemSpecOptions(propertyId, ocrCaptureItems).catch(() => {})
    // 재고 카드 자동 등록 — 다품목 경로와 동일(운영자 요청 2026-07-10: 일일이 불러오기 제거).
    // 추적 카테고리·물품 여부는 seed 내부에서 판별, 서비스(excludeFromInventory)는 제외됨.
    if (itemLabel) await seedTrackedItemsFromExpenses([itemLabel]).catch(() => {})
    const backfilled = await backfillVendorBizNo(propertyId, vendor || null, vendorBizNo)
    revalidatePath('/finance')
    return { ok: true, backfilled }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 지출에서 품목명을 바꾸면 재고 품목(TrackedItem) 카드·형제 지출의 itemLabel까지 함께 바꾼다(진짜 이름변경).
// 새 이름이 같은 카테고리의 다른 기존 품목과 겹치면 전파하지 않음(병합이 필요한 상황) → false.
// (재고관리 쪽 updateTrackedItem 의 라벨 전파와 동일 규칙 — 지출 편집에서도 동기화되게)
async function propagateItemLabelRename(
  propertyId: string, category: string, oldLabel: string, newLabel: string,
): Promise<boolean> {
  if (!oldLabel || !newLabel || oldLabel === newLabel) return false
  const tracked = await prisma.trackedItem.findUnique({
    where: { propertyId_category_label: { propertyId, category, label: oldLabel } },
    select: { id: true, qtyUnit: true },
  })
  if (!tracked) return false   // 추적 품목 아님 — 바꿀 재고 카드 없음
  const dup = await prisma.trackedItem.findUnique({
    where: { propertyId_category_label: { propertyId, category, label: newLabel } },
    select: { id: true },
  })
  if (dup && dup.id !== tracked.id) return false   // 새 이름이 이미 다른 카드 — 전파 안 함(병합 필요)
  await prisma.$transaction([
    prisma.trackedItem.update({ where: { id: tracked.id }, data: { label: newLabel } }),
    prisma.expense.updateMany({
      where: { propertyId, category, itemLabel: oldLabel, ...(tracked.qtyUnit ? { qtyUnit: tracked.qtyUnit } : {}) },
      data: { itemLabel: newLabel },
    }),
  ])
  return true
}

export async function updateExpense(formData: FormData): Promise<{ ok: true; backfilled?: number } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const id        = formData.get('id') as string
    const date      = formData.get('date') as string
    const amount    = parseAmount(formData.get('amount'))
    const category  = formData.get('category') as string
    const detail    = formData.get('detail') as string
    const vendor    = formData.get('vendor') as string
    const vendorBizNo = normalizeBizNo(formData.get('vendorBizNo') as string)   // 빈 값·잘못된 길이면 null
    const memo      = formData.get('memo') as string
    const payMethod = formData.get('payMethod') as string
    const financialAccountId = formData.get('financialAccountId') as string
    const financeName        = formData.get('financeName') as string
    const roomId             = formData.get('roomId') as string
    const receiptUrl         = formData.get('receiptUrl') as string
    const itemLabel = formData.get('itemLabel') as string
    const specUnit  = formData.get('specUnit') as string
    const qtyUnit   = formData.get('qtyUnit') as string
    const specValueRaw = formData.get('specValue') as string
    const qtyValueRaw  = formData.get('qtyValue') as string
    const specTextRaw  = formData.get('specText') as string
    const unitBasisRaw = formData.get('unitBasis') as string
    const itemsJsonRaw = formData.get('itemsJson') as string
    // 합산형 배송비('배송비 포함') — amount 에 이미 더해져 제출됨 (addExpense 와 동일)
    const shippingIncluded = parseAmount(formData.get('shippingIncluded')) || 0
    const excludeFromInventory = formData.get('excludeFromInventory') === '1'  // 서비스·무형 = 재고/비품 제외 (수정 시 보존, 새 분할 행에도 전파)

    if (!date || !amount || !category) return { ok: false, error: '날짜, 금액, 카테고리는 필수입니다.' }

    const existing = await prisma.expense.findUnique({
      where: { id },
      // receivedAt: 방별 분배로 갈라지는 새 조각이 '수령완료'를 물려받게(미수령으로 되돌아가는 것 방지)
      select: { isShipping: true, settleStatus: true, itemLabel: true, category: true, receivedAt: true },
    })
    // 배송비 라인은 결제구분(선불/착불/신용)에 따라 settleStatus 가 별도 관리됨 —
    // 일반 수정 저장이 payMethod 기준으로 재계산해 '신용(미정산)'을 조용히 정산완료로 뒤집지 않게 보존.
    const baseSettleStatus: SettleStatus = existing?.isShipping
      ? existing.settleStatus
      : (payMethod === '신용카드' ? 'UNSETTLED' : 'SETTLED')

    // 다중 품목/방별 분배 편집: 품목 2개+ 또는 방별 분배 있으면 분할.
    // 첫 행은 현재 row 업데이트, 나머지(추가 품목·방별 행·미지정 나머지)는 새 row.
    let multiItems: ItemPick[] | null = null
    if (itemsJsonRaw) {
      try {
        const parsed = JSON.parse(itemsJsonRaw)
        if (Array.isArray(parsed) && parsed.length >= 1) {
          const hasAlloc = parsed.some((it: ItemPick) => Array.isArray(it.allocations) && it.allocations.length > 0)
          if (parsed.length >= 2 || hasAlloc) multiItems = parsed
        }
      } catch { /* fallthrough */ }
    }

    if (multiItems) {
      const sum = multiItems.reduce((s, it) => s + (Number(it.amount) || 0), 0)
      if (Math.abs(sum + shippingIncluded - amount) > 1) {
        return { ok: false, error: `품목 금액 합계(${sum.toLocaleString()}원${shippingIncluded ? ` + 배송비 ${shippingIncluded.toLocaleString()}원` : ''})와 총 금액(${amount.toLocaleString()}원)이 일치하지 않습니다.` }
      }

      const rows = expandExpenseRows(multiItems, roomId || null)
      const firstRow = rows[0]
      const restRows = rows.slice(1)
      const detailOf = (r: ExpandedRow) => `[${r.it.label}]${r.it.specText ? ` ${r.it.specText}` : r.it.specValue ? ` ${r.it.specValue}${r.it.specUnit ?? ''}` : ''}${r.qtyValue ? ` x ${r.qtyValue}${r.it.qtyUnit ?? ''}` : ''}`

      await prisma.$transaction([
        prisma.expense.update({
          where: { id },
          data: {
            date:               new Date(date),
            amount: firstRow.amount,
            category,
            detail:    detailOf(firstRow),
            vendor:             vendor || null,
            vendorBizNo:        vendorBizNo,
            memo:               memo || null,
            payMethod:          payMethod || '계좌이체',
            financialAccountId: financialAccountId || null,
            financeName:        financeName || null,
            settleStatus:       baseSettleStatus,
            roomId:             firstRow.roomId,
            itemLabel: firstRow.it.label,
            specUnit:  firstRow.it.specUnit || null,
            qtyUnit:   firstRow.it.qtyUnit  || null,
            specValue: firstRow.it.specValue ? parseFloat(firstRow.it.specValue) : null,
            specText:  firstRow.it.specText || null,
            unitBasis: firstRow.it.unitBasis || null,
            qtyValue:  firstRow.qtyValue  ? parseFloat(firstRow.qtyValue)  : null,
            allocationGroupId: firstRow.groupId,
            excludeFromInventory,
            ...(receiptUrl !== null && receiptUrl !== undefined ? { receiptUrl: receiptUrl || null } : {}),
          },
        }),
        ...restRows.map(r => prisma.expense.create({
          data: {
            propertyId,
            date:               new Date(date),
            amount:    r.amount,
            category,
            detail:    detailOf(r),
            vendor:             vendor || null,
            vendorBizNo:        vendorBizNo,
            memo:               memo || null,
            payMethod:          payMethod || '계좌이체',
            financialAccountId: financialAccountId || null,
            financeName:        financeName || null,
            receiptUrl:         receiptUrl || null,
            settleStatus:       baseSettleStatus,
            roomId:             r.roomId,
            itemLabel: r.it.label,
            specUnit:  r.it.specUnit || null,
            qtyUnit:   r.it.qtyUnit  || null,
            specValue: r.it.specValue ? parseFloat(r.it.specValue) : null,
            specText:  r.it.specText || null,
            unitBasis: r.it.unitBasis || null,
            qtyValue:  r.qtyValue  ? parseFloat(r.qtyValue)  : null,
            allocationGroupId: r.groupId,
            excludeFromInventory,
            receivedAt:         existing?.receivedAt ?? null,   // 원본이 수령완료면 분배 조각도 수령완료 유지
          },
        })),
        // 합산형 배송비 — 품목 단가 왜곡 방지를 위해 별도 행(재고 제외)으로 분리 (addExpense 와 동일)
        ...(shippingIncluded > 0 ? [prisma.expense.create({
          data: {
            propertyId,
            date:               new Date(date),
            amount:             shippingIncluded,
            category,
            detail:             '배송비',
            vendor:             vendor || null,
            vendorBizNo:        vendorBizNo,
            payMethod:          payMethod || '계좌이체',
            financialAccountId: financialAccountId || null,
            financeName:        financeName || null,
            settleStatus:       baseSettleStatus,
            isShipping:         true,
            excludeFromInventory: true,
          },
        })] : []),
      ])
      await captureItemSpecOptions(propertyId, multiItems).catch(() => {})
      const backfilled = await backfillVendorBizNo(propertyId, vendor || null, vendorBizNo)
      revalidatePath('/finance')
      return { ok: true, backfilled }
    }

    await prisma.expense.update({
      where: { id },
      data: {
        date:               new Date(date),
        amount, category,
        detail:             detail || null,
        vendor:             vendor || null,
        vendorBizNo:        vendorBizNo,
        memo:               memo || null,
        payMethod:          payMethod || '계좌이체',
        financialAccountId: financialAccountId || null,
        financeName:        financeName || null,
        settleStatus:       baseSettleStatus,
        roomId:             roomId || null,
        excludeFromInventory,
        // 폼이 품목 필드를 아예 안 보낸 편집(카테고리만 수정 등)에서는 기존 값 보존 —
        // null 덮어쓰기로 품목 연결이 끊겨 재고에서 증발하던 버그(종량제봉투 2026-07-10)
        ...(formData.has('itemLabel') ? { itemLabel: itemLabel || null } : {}),
        ...(formData.has('specUnit') ? { specUnit: specUnit || null } : {}),
        ...(formData.has('qtyUnit') ? { qtyUnit: qtyUnit || null } : {}),
        ...(formData.has('specValue') ? { specValue: specValueRaw ? parseFloat(specValueRaw) : null } : {}),
        ...(formData.has('qtyValue') ? { qtyValue: qtyValueRaw ? parseFloat(qtyValueRaw) : null } : {}),
        // 서술형 규격·단가 기준 — 미전송 편집(카테고리만 수정 등)에선 기존 값 보존(위 5필드와 동일 가드)
        ...(formData.has('specText') ? { specText: specTextRaw || null } : {}),
        ...(formData.has('unitBasis') ? { unitBasis: unitBasisRaw === 'spec' || unitBasisRaw === 'qty' ? unitBasisRaw : null } : {}),
        ...(receiptUrl !== null && receiptUrl !== undefined ? { receiptUrl: receiptUrl || null } : {}),
      },
    })
    // 세부스펙 적립 — 수정 저장으로 들어온 서술형 규격도 품목 사전에 upsert(best-effort)
    if (formData.has('specText') && specTextRaw && itemLabel) {
      await captureItemSpecOptions(propertyId, [{ label: itemLabel, specText: specTextRaw }]).catch(() => {})
    }
    // 추적 소모품(부식·소모품·폐기물)의 품목명을 바꾸면 재고 카드·형제 지출까지 함께 변경(진짜 이름변경).
    // 카테고리가 그대로일 때만. 전파 실패는 지출 저장을 막지 않음(재고관리에서 수동 정리 가능).
    if (itemLabel && existing?.itemLabel && existing.category === category && itemLabel !== existing.itemLabel) {
      try {
        if (await propagateItemLabelRename(propertyId, category, existing.itemLabel, itemLabel)) revalidatePath('/inventory')
      } catch { /* 재고 전파 실패 무시 — 지출 저장은 이미 완료 */ }
    }
    const backfilled = await backfillVendorBizNo(propertyId, vendor || null, vendorBizNo)
    revalidatePath('/finance')
    return { ok: true, backfilled }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// ── 지출 일괄 편집 — 여러 지출의 공통 필드를 한 번에 수정(적용취소 포함)
// 스킵 규칙: 배송비 라인(전 필드) / 날짜 변경 시 고정지출 기록 / 카테고리·세부항목 변경 시 품목 등록 지출.
// settleStatus 는 updateExpense 규칙 그대로 행별 재계산(신용카드=UNSETTLED, 그 외 SETTLED).
export type BatchExpensesUndo = {
  rows: { id: string; fields: Record<string, unknown> }[]
}

export async function batchUpdateExpenses(
  expenseIds: string[],
  data: {
    payMethod?: string
    financialAccountId?: string | null
    financeName?: string | null
    date?: string
    category?: string
    detail?: string | null
    memo?: string | null
  },
): Promise<{ ok: true; updated: number; skipped: { reason: string; count: number }[]; undo: BatchExpensesUndo } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    if (expenseIds.length === 0) return { ok: false, error: '선택된 지출이 없습니다.' }

    const wantsPayMethod = data.payMethod != null && data.payMethod !== ''
    const changingDate   = data.date != null && data.date !== ''
    const changingCategory = data.category != null && data.category !== ''
    const changingDetail = 'detail' in data
    const changingMemo   = 'memo' in data
    const changingCatOrDetail = changingCategory || changingDetail

    if (!wantsPayMethod && !changingDate && !changingCategory && !changingDetail && !changingMemo) {
      return { ok: false, error: '변경할 항목이 없습니다.' }
    }
    // 결제수단 변경 시 계좌·카드(선불) 정보 동반 필수 — 미지정이면 stale 계좌가 남는다
    if (wantsPayMethod && (!('financialAccountId' in data) || !('financeName' in data))) {
      return { ok: false, error: '결제수단을 변경하려면 계좌·카드 정보가 함께 필요합니다.' }
    }

    // 대상 스냅샷 겸 스킵 판정 — 변경 필드 원값도 함께 캡처(적용취소용)
    const targets = await prisma.expense.findMany({
      where: { id: { in: expenseIds }, propertyId },
      select: {
        id: true, isShipping: true, settleStatus: true, itemLabel: true,
        recurringExpenseId: true, category: true,
        payMethod: true, financialAccountId: true, financeName: true,
        date: true, detail: true, memo: true,
      },
    })

    const skippedCounts: Record<string, number> = {}
    const bump = (reason: string) => { skippedCounts[reason] = (skippedCounts[reason] ?? 0) + 1 }

    const eligible: typeof targets = []
    for (const t of targets) {
      if (t.isShipping) { bump('배송비 지출'); continue }
      if (changingDate && t.recurringExpenseId) { bump('고정지출 기록'); continue }
      if (changingCatOrDetail && t.itemLabel) { bump('품목 등록 지출'); continue }
      eligible.push(t)
    }

    // 되돌리기 스냅샷 — 덮어쓰기 전 원값(정산완료 이력 왕복 보존: settleStatus 필수 포함)
    const undo: BatchExpensesUndo = { rows: [] }
    for (const t of eligible) {
      const fields: Record<string, unknown> = {}
      if (wantsPayMethod) {
        fields.payMethod = t.payMethod
        fields.financialAccountId = t.financialAccountId
        fields.financeName = t.financeName
        fields.settleStatus = t.settleStatus
      }
      if (changingDate) fields.date = t.date
      if (changingCategory) fields.category = t.category
      if (changingDetail) fields.detail = t.detail
      if (changingMemo) fields.memo = t.memo
      undo.rows.push({ id: t.id, fields })
    }

    // 결제수단 외 공통 필드 — 적격 행 전체에 동일 적용
    const commonData: Record<string, unknown> = {}
    if (changingDate) commonData.date = new Date(data.date as string)
    if (changingCategory) commonData.category = data.category
    if (changingDetail) commonData.detail = data.detail || null
    if (changingMemo) commonData.memo = data.memo || null

    if (eligible.length > 0) {
      const ops: Prisma.PrismaPromise<unknown>[] = []
      if (wantsPayMethod) {
        // settleStatus 행별 재계산 후 갈래별 updateMany — payMethod 가 균일하므로 실제론 한 갈래
        const byStatus = new Map<SettleStatus, string[]>()
        for (const t of eligible) {
          const s: SettleStatus = data.payMethod === '신용카드' ? 'UNSETTLED' : 'SETTLED'
          const arr = byStatus.get(s) ?? []; arr.push(t.id); byStatus.set(s, arr)
        }
        for (const [s, ids] of byStatus) {
          ops.push(prisma.expense.updateMany({
            where: { id: { in: ids }, propertyId },
            data: { ...commonData, payMethod: data.payMethod, financialAccountId: data.financialAccountId ?? null, financeName: data.financeName ?? null, settleStatus: s },
          }))
        }
      } else {
        ops.push(prisma.expense.updateMany({
          where: { id: { in: eligible.map(e => e.id) }, propertyId },
          data: commonData,
        }))
      }
      await prisma.$transaction(ops)
    }

    revalidatePath('/finance')
    if (changingCategory) revalidatePath('/inventory')
    return {
      ok: true,
      updated: eligible.length,
      skipped: Object.entries(skippedCounts).map(([reason, count]) => ({ reason, count })),
      undo,
    }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 지출 일괄 편집 적용취소 — 행별 원값 복원(batchUpdateTenants/undoBatchUpdateTenants 패턴)
export async function undoBatchUpdateExpenses(u: BatchExpensesUndo): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    await prisma.$transaction(u.rows.map(x => prisma.expense.updateMany({ where: { id: x.id, propertyId }, data: x.fields as never })))
    revalidatePath('/finance'); revalidatePath('/inventory')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '되돌리기에 실패했습니다.' }
  }
}

// 지출 삭제 적용취소 페이로드 — 삭제 직전 전체 스냅샷(§4 설계+적대검증 2026-07-14).
// 클라이언트가 토스트 수명 동안만 보유(StockCheckUndo 선례). 새로고침 후에는 복구 불가.
export type ExpenseDeleteUndo = {
  expense: Record<string, unknown>          // 삭제된 행 전체(id·createdAt 포함 재생성)
  order: Record<string, unknown> | null     // 소속 주문 전체 — 정리 여부와 무관하게 항상 캡처(그 사이 병합·해제가 주문을 지울 수 있음)
  shippingRows: Record<string, unknown>[]   // 주문 정리로 함께 지워진 배송비 라인들
  freedSiblingIds: string[]                 // 주문 정리로 orderId가 해제된 형제 지출 id
  stockCheckIds: string[]                   // SetNull된 수령 자동 점검 — 복원 시 재링크
  reserveTxIds: string[]                    // SetNull된 예비비 정산 — 복원 시 재링크
}

export async function deleteExpense(id: string): Promise<{ ok: true; undo: ExpenseDeleteUndo } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()   // 영업장 스코프 — 기존 누락 보강(멀티테넌트, §4 2026-07-14)
    const undo = await prisma.$transaction(async tx => {
      const target = await tx.expense.findFirst({ where: { id, propertyId } })
      if (!target) throw new Error('지출을 찾을 수 없습니다.')
      const order = target.orderId ? await tx.expenseOrder.findFirst({ where: { id: target.orderId } }) : null
      const [checks, reserves] = await Promise.all([
        tx.stockCheck.findMany({ where: { sourceExpenseId: id }, select: { id: true } }),
        tx.reserveTransaction.findMany({ where: { expenseId: id }, select: { id: true } }),
      ])
      let shippingRows: Record<string, unknown>[] = []
      let freedSiblingIds: string[] = []
      await tx.expense.delete({ where: { id } })
      // 주문 묶음 고아 정리 — 품목을 다 지워 배송비 라인만 남으면 배송비·주문도 정리,
      // 행이 하나만 남으면 묶음 의미가 없으므로 연결 해제 후 빈 주문 삭제.
      // (cleanupOrderIfOrphan과 동일 분기 — 스냅샷과 함께 한 트랜잭션으로 수행)
      if (target.orderId) {
        const rows = await tx.expense.findMany({ where: { orderId: target.orderId }, select: { id: true, isShipping: true } })
        const items = rows.filter(r => !r.isShipping)
        if (items.length === 0) {
          shippingRows = await tx.expense.findMany({ where: { orderId: target.orderId, isShipping: true } })
          await tx.expense.deleteMany({ where: { orderId: target.orderId, isShipping: true } })
          await tx.expenseOrder.deleteMany({ where: { id: target.orderId } })
        } else if (rows.length === 1) {
          freedSiblingIds = rows.map(r => r.id)
          await tx.expense.updateMany({ where: { orderId: target.orderId }, data: { orderId: null } })
          await tx.expenseOrder.deleteMany({ where: { id: target.orderId } })
        }
      }
      return {
        expense: target as unknown as Record<string, unknown>,
        order: order as unknown as Record<string, unknown> | null,
        shippingRows, freedSiblingIds,
        stockCheckIds: checks.map(c => c.id),
        reserveTxIds: reserves.map(r => r.id),
      }
    })
    revalidatePath('/finance')
    if (undo.stockCheckIds.length > 0) revalidatePath('/inventory')
    return { ok: true, undo }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '삭제에 실패했습니다.' }
  }
}

// 지출 삭제 적용취소 — 스냅샷으로 주문·지출·배송비 라인을 재생성하고 링크를 재연결.
// 적대검증 필수 4건 반영: 주문 항상 스냅샷 복원, 사라진 부모 FK null 강등,
// 형제 orderId 조건부 복원, 고정지출 재기록 후 복원 시 이중 집계 차단.
export async function undoDeleteExpense(undo: ExpenseDeleteUndo): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    type ExpenseRowSnap = Prisma.ExpenseUncheckedCreateInput & { id: string; updatedAt?: string | Date }
    const data = { ...undo.expense } as ExpenseRowSnap
    delete data.updatedAt   // @updatedAt은 재생성 시 자동
    if (data.propertyId !== propertyId) return { ok: false, error: '다른 영업장의 기록입니다.' }
    // 멱등 — 이미 복원돼 있으면 성공
    if (await prisma.expense.findFirst({ where: { id: data.id }, select: { id: true } })) return { ok: true }
    // 고정지출 이중 기록 차단 — 삭제로 '기록 대기'가 된 사이 같은 달을 다시 기록했으면 복원 거부
    if (data.recurringExpenseId) {
      const dt = new Date(data.date)
      const from = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1))
      const to = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1))
      const dup = await prisma.expense.findFirst({
        where: { propertyId, recurringExpenseId: data.recurringExpenseId, date: { gte: from, lt: to } },
        select: { id: true },
      })
      if (dup) return { ok: false, error: '그 사이 같은 달 고정지출이 다시 기록되어 복원하면 중복됩니다. 기존 기록을 확인해 주세요.' }
    }
    // 옵셔널 FK 부모 소실 시 null 강등 — 부재 부모로 create가 통째로 실패하는 것을 막는다
    const fkFinders = {
      recurringExpenseId: (fk: string) => prisma.recurringExpense.findFirst({ where: { id: fk, propertyId }, select: { id: true } }),
      financialAccountId: (fk: string) => prisma.financialAccount.findFirst({ where: { id: fk, propertyId }, select: { id: true } }),
      roomId: (fk: string) => prisma.room.findFirst({ where: { id: fk, propertyId }, select: { id: true } }),
      receivedLocationId: (fk: string) => prisma.storageLocation.findFirst({ where: { id: fk, propertyId }, select: { id: true } }),
      assignedLocationId: (fk: string) => prisma.storageLocation.findFirst({ where: { id: fk, propertyId }, select: { id: true } }),
    } as const
    for (const key of Object.keys(fkFinders) as (keyof typeof fkFinders)[]) {
      const fk = data[key]
      if (fk && !(await fkFinders[key](fk))) data[key] = null
    }
    const orderSnap = undo.order as (Prisma.ExpenseOrderUncheckedCreateInput & { id: string; updatedAt?: string | Date }) | null
    await prisma.$transaction(async tx => {
      // 주문 복원 — 삭제됐으면 스냅샷으로 재생성, 스냅샷이 없거나 다른 주문이면 orderId 강등
      if (data.orderId) {
        const oe = await tx.expenseOrder.findFirst({ where: { id: data.orderId }, select: { id: true } })
        if (!oe) {
          if (orderSnap && orderSnap.id === data.orderId && orderSnap.propertyId === propertyId) {
            const snap = { ...orderSnap }
            delete snap.updatedAt
            await tx.expenseOrder.create({ data: snap })
          } else data.orderId = null
        }
      }
      await tx.expense.create({ data })
      // 주문 정리로 함께 지워진 배송비 라인 복원(이미 있으면 건너뜀)
      for (const s of undo.shippingRows) {
        const row = { ...s } as ExpenseRowSnap
        delete row.updatedAt
        if (await tx.expense.findFirst({ where: { id: row.id }, select: { id: true } })) continue
        if (row.orderId && !(await tx.expenseOrder.findFirst({ where: { id: row.orderId }, select: { id: true } }))) row.orderId = null
        await tx.expense.create({ data: row })
      }
      // 형제 orderId 조건부 복원 — 그 사이 다른 주문에 묶였으면 그 병합을 존중(orderId null인 것만)
      if (undo.freedSiblingIds.length > 0 && data.orderId) {
        await tx.expense.updateMany({
          where: { id: { in: undo.freedSiblingIds }, propertyId, orderId: null },
          data: { orderId: data.orderId },
        })
      }
      // 수령 자동 점검·예비비 정산 재링크 — 그 사이 지워진 행은 no-op
      if (undo.stockCheckIds.length > 0) {
        await tx.stockCheck.updateMany({ where: { id: { in: undo.stockCheckIds } }, data: { sourceExpenseId: data.id } })
      }
      if (undo.reserveTxIds.length > 0) {
        await tx.reserveTransaction.updateMany({ where: { id: { in: undo.reserveTxIds } }, data: { expenseId: data.id } })
      }
    })
    revalidatePath('/finance')
    if (undo.stockCheckIds.length > 0) revalidatePath('/inventory')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '복원에 실패했습니다.' }
  }
}

// 같은 쇼핑몰 주문번호의 기존 주문 조회 — 지출 등록 시 '같은 주문으로 묶을까요?' 확인용(오류신고 4f9fb398).
export async function findOrderByExternalNo(externalOrderNo: string): Promise<{ id: string; code: string; count: number; total: number } | null> {
  const propertyId = await getPropertyId()
  const no = externalOrderNo.trim()
  if (!no) return null
  const order = await prisma.expenseOrder.findFirst({
    where: { propertyId, externalOrderNo: no },
    orderBy: { createdAt: 'desc' },
    select: { id: true, code: true, expenses: { select: { amount: true, isShipping: true } } },
  })
  if (!order) return null
  return {
    id: order.id,
    code: order.code,
    count: order.expenses.filter(e => !e.isShipping).length,
    total: order.expenses.reduce((s, e) => s + e.amount, 0),
  }
}

// 합배송 묶기 해제 — attachShippingToOrder 의 역방향(적용취소).
// 해당 지출을 주문에서 분리하고, 주문에 비배송 품목이 안 남으면 배송비 라인·주문도 삭제.
export async function detachShippingFromOrder(expenseId: string): Promise<{ ok: true; notice: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const exp = await prisma.expense.findFirst({
      where: { id: expenseId, propertyId },
      select: { orderId: true, isShipping: true },
    })
    if (!exp?.orderId) return { ok: false, error: '주문에 묶여 있지 않은 지출입니다.' }
    if (exp.isShipping) return { ok: false, error: '배송비 라인은 품목 지출에서 해제해주세요.' }

    await prisma.expense.update({ where: { id: expenseId }, data: { orderId: null } })
    const remaining = await prisma.expense.findMany({
      where: { orderId: exp.orderId },
      select: { id: true, isShipping: true },
    })
    const remainingItems = remaining.filter(r => !r.isShipping)
    let notice: string
    if (remainingItems.length === 0) {
      await prisma.expense.deleteMany({ where: { orderId: exp.orderId, isShipping: true } })
      await prisma.expenseOrder.delete({ where: { id: exp.orderId } }).catch(() => {})
      notice = '합배송 묶음을 해제했습니다. 마지막 품목이라 배송비 라인과 주문도 정리했습니다.'
    } else {
      notice = `합배송 묶음에서 분리했습니다. 주문에 남은 품목 ${remainingItems.length}건과 배송비는 유지됩니다.`
    }
    revalidatePath('/finance')
    return { ok: true, notice }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 다중선택 병합 — 선택한 지출들을 한 주문으로 묶기(꾹 눌러 선택 UX용).
// 이미 다른 주문에 속한 것도 대상 주문으로 이동, 비워진 주문은 배송비 라인을 옮긴 뒤 삭제.
export async function mergeExpensesIntoOrder(expenseIds: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const ids = [...new Set((expenseIds ?? []).filter(Boolean))]
    if (ids.length < 2) return { ok: false, error: '묶을 지출을 2건 이상 선택해주세요.' }
    const selected = await prisma.expense.findMany({ where: { id: { in: ids }, propertyId, isShipping: false } })
    if (selected.length < 2) return { ok: false, error: '묶을 지출을 2건 이상 선택해주세요.' }

    const sourceOrderIds = [...new Set(selected.map(e => e.orderId).filter(Boolean) as string[])]
    let targetOrderId: string
    if (sourceOrderIds.length > 0) {
      const orders = await prisma.expenseOrder.findMany({ where: { id: { in: sourceOrderIds }, propertyId }, orderBy: { createdAt: 'asc' }, select: { id: true } })
      targetOrderId = orders[0]?.id ?? sourceOrderIds[0]
    } else {
      const order = await prisma.expenseOrder.create({ data: { propertyId, code: await genOrderCode(propertyId), shippingType: null, shippingMemo: null } })
      targetOrderId = order.id
    }

    await prisma.expense.updateMany({ where: { id: { in: selected.map(e => e.id) }, propertyId }, data: { orderId: targetOrderId } })

    // 비워진 source 주문 정리(배송비 라인은 대상으로 이동 후 빈 주문 삭제)
    for (const oid of sourceOrderIds) {
      if (oid === targetOrderId) continue
      const remain = await prisma.expense.count({ where: { orderId: oid, isShipping: false, propertyId } })
      if (remain === 0) {
        await prisma.expense.updateMany({ where: { orderId: oid, isShipping: true, propertyId }, data: { orderId: targetOrderId } })
        await prisma.expenseOrder.delete({ where: { id: oid } }).catch(() => {})
      }
    }
    revalidatePath('/finance'); revalidatePath('/inventory')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '묶기에 실패했습니다.' }
  }
}

// ── 합배송 Phase 2: 기존 지출(들)에 배송비를 묶기 ──
//  주문(ExpenseOrder)을 만들거나 기존 주문을 재사용해 expenseIds 를 묶고,
//  배송비 별도 지출 라인을 생성(또는 그 주문에 이미 있으면 갱신).
export async function attachShippingToOrder(input: {
  expenseIds: string[]
  amount: number
  shippingType: '선불' | '착불' | '신용' | null
  shippingMemo?: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const ids = (input.expenseIds ?? []).filter(Boolean)
    if (ids.length === 0) return { ok: false, error: '묶을 지출을 선택해주세요.' }
    // 배송비 0(또는 음수→0)이면 배송비 라인 없이 '주문으로만 묶기'. 0 초과면 배송비 라인도 생성.
    const amount = Math.max(0, Math.round(input.amount || 0))
    if (ids.length < 2 && amount === 0) return { ok: false, error: '묶을 지출을 2건 이상 선택하거나 배송비를 입력해주세요.' }
    const shipType = input.shippingType && (SHIPPING_TYPES as readonly string[]).includes(input.shippingType)
      ? input.shippingType : null

    const expenses = await prisma.expense.findMany({
      where: { id: { in: ids }, propertyId, isShipping: false },
      orderBy: { amount: 'desc' },
    })
    if (expenses.length === 0) return { ok: false, error: '지출을 찾을 수 없습니다.' }

    // 기존 주문 재사용(이미 묶인 게 있으면) 또는 새 주문 생성
    const existingOrderId = expenses.find(e => e.orderId)?.orderId ?? null
    let orderId: string
    if (existingOrderId) {
      orderId = existingOrderId
      // 배송비가 있을 때만 배송 메타 갱신(0=묶기만이면 기존 배송정보 보존)
      if (amount > 0) {
        await prisma.expenseOrder.update({
          where: { id: orderId },
          data: { shippingType: shipType, shippingMemo: input.shippingMemo || null },
        })
      }
    } else {
      const order = await prisma.expenseOrder.create({
        data: { propertyId, code: await genOrderCode(propertyId), shippingType: amount > 0 ? shipType : null, shippingMemo: amount > 0 ? (input.shippingMemo || null) : null },
      })
      orderId = order.id
    }

    // 선택된 지출들을 주문에 연결(아직 연결 안 된 것만)
    await prisma.expense.updateMany({
      where: { id: { in: expenses.map(e => e.id) }, propertyId, orderId: null },
      data: { orderId },
    })

    // 배송비(>0)일 때만 배송비 라인 생성/갱신. 0이면 위 updateMany로 '묶기'만 완료.
    if (amount > 0) {
      // 대표(최대 금액) 지출 기준으로 배송비 라인 메타 결정
      const rep = expenses[0]
      // 배송비 라인을 주문 항목 '바로 위'에 정렬되도록 — 목록은 date desc, createdAt desc 순.
      //   사후 묶기는 배송비 createdAt 이 '지금'이라 목록 맨 위로 떠버림 → 주문 항목들의
      //   최신 createdAt 보다 1초 뒤로 맞춰 그 주문 묶음 바로 위에 붙게 한다(2026-06-10 사용자 보고).
      const anchorMs = expenses.reduce((m, e) => Math.max(m, new Date(e.createdAt).getTime()), 0)
      const shipCreatedAt = new Date(anchorMs + 1000)
      const shipData = {
        amount,
        detail:             `배송비${shipType ? ` (${shipType})` : ''}`,
        // 배송비는 대표 지출의 결제수단을 따름 — 카드결제(신용카드)면 미정산, 후불('신용')이어도 미정산.
        settleStatus:       ((rep.payMethod === '신용카드' || shipType === '신용') ? 'UNSETTLED' : 'SETTLED') as SettleStatus,
        shippingMemo:       input.shippingMemo || null,
      }
      // 주문에 이미 배송비 라인이 있으면 갱신, 없으면 생성
      const existingShip = await prisma.expense.findFirst({ where: { orderId, isShipping: true, propertyId } })
      if (existingShip) {
        await prisma.expense.update({
          where: { id: existingShip.id },
          data: { amount: shipData.amount, detail: shipData.detail, settleStatus: shipData.settleStatus, memo: shipData.shippingMemo, category: rep.category, date: rep.date, createdAt: shipCreatedAt },
        })
      } else {
        await prisma.expense.create({
          data: {
            propertyId,
            date:               rep.date,
            category:           rep.category,
            amount:             shipData.amount,
            detail:             shipData.detail,
            vendor:             rep.vendor,
            memo:               shipData.shippingMemo,
            payMethod:          rep.payMethod || '계좌이체',
            financialAccountId: rep.financialAccountId,
            financeName:        rep.financeName,
            settleStatus:       shipData.settleStatus,
            orderId,
            isShipping:         true,
            excludeFromInventory: true,
            createdAt:          shipCreatedAt,
          },
        })
      }
    }

    revalidatePath('/finance')
    revalidatePath('/inventory')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function getExpenseDetailSuggestions(): Promise<string[]> {
  const propertyId = await getPropertyId()
  // 품목명 자동완성 — 과거 지출의 깔끔한 품목 라벨(itemLabel)을 최신순 distinct 로.
  // (detail 은 '[고추장] 500g x 2 · 배송비…' 처럼 합성 문자열이라 품목명 입력엔 부적합)
  const rows = await prisma.expense.findMany({
    where: { propertyId, itemLabel: { not: null } },
    select: { itemLabel: true },
    orderBy: { createdAt: 'desc' },
    take: FINANCE_DETAIL_SUGGESTIONS_LIMIT,
  })
  // 별칭(통일) 반영 (#C) — 병합/통일된 옛 명칭은 제안에서 빼고 통일명으로 치환.
  // 통일명 자체도 제안에 포함(아직 그 이름의 지출이 없어도 선택 가능).
  let aliasMap = new Map<string, string>()
  try {
    const aliasRows = await prisma.itemNameAlias.findMany({ where: { propertyId }, select: { aliasKey: true, preferredLabel: true } })
    aliasMap = new Map(aliasRows.map(a => [a.aliasKey, a.preferredLabel]))
  } catch { /* 별칭 테이블 미적용 시 그냥 원본 제안 */ }
  const seen = new Set<string>()
  const result: string[] = []
  for (const r of rows) {
    const v = r.itemLabel?.trim()
    if (!v) continue
    const canon = aliasMap.get(normalizeItemName(v)) ?? v   // 옛 명칭 → 통일명
    if (!seen.has(canon)) { seen.add(canon); result.push(canon) }
  }
  for (const pref of aliasMap.values()) {
    if (!seen.has(pref)) { seen.add(pref); result.push(pref) }
  }
  return result
}

// ── AI 품명 병합 (환경설정) (A) ───────────────────────────────────
export type ItemNameCluster = { canonical: string; members: string[] }

// 저장된 품목명(지출 itemLabel 전체)을 AI로 유사끼리 묶어 대표명 추천. 2개 이상 그룹만 반환.
export async function clusterItemNamesWithAI(): Promise<{ ok: true; clusters: ItemNameCluster[] } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const rows = await prisma.expense.findMany({
      where: { propertyId, itemLabel: { not: null }, isShipping: false },
      select: { itemLabel: true }, distinct: ['itemLabel'],
    })
    const names = [...new Set(rows.map(r => (r.itemLabel ?? '').trim()).filter(Boolean))]
    if (names.length < 2) return { ok: true, clusters: [] }
    const ai = await consumeGeminiAccess()
    if (!ai.ok) return { ok: false, error: ai.error }
    const apiKey = ai.apiKey
    const prompt = `다음은 한 매장 지출 품목명 목록입니다. 같은 물건을 가리키는 것으로 보이는 이름끼리 그룹으로 묶고 각 그룹 대표명을 추천하세요.
규칙:
- 표기·띄어쓰기·줄임말·용량표기 차이로 같은 물건이면 한 그룹 (예: "코카콜라 500","코카콜라500ml","코크500" → 한 그룹)
- 확실히 다른 물건은 묶지 말 것(애매하면 묶지 않음)
- 2개 이상 묶이는 그룹만 출력(혼자인 이름 제외)
- canonical(대표명)은 목록의 이름 중 하나 또는 더 표준적인 이름
순수 JSON만 출력: {"clusters":[{"canonical":"대표명","members":["이름1","이름2"]}]}

목록:
${names.map(n => `- ${n}`).join('\n')}`
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 4000, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } } }),   // 사고 토큰 잠식 방지(신고 4b1f59e2 계열)
    })
    if (!res.ok) return { ok: false, error: `AI 오류 (${res.status})` }
    const json = await res.json()
    const text: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    let parsed: any
    try { parsed = JSON.parse(cleaned) } catch { return { ok: false, error: 'AI 응답을 해석하지 못했습니다.' } }
    const nameSet = new Set(names)
    const clusters: ItemNameCluster[] = Array.isArray(parsed.clusters) ? parsed.clusters
      .map((c: any) => ({
        canonical: String(c?.canonical ?? '').trim(),
        members: Array.isArray(c?.members) ? [...new Set((c.members as any[]).map(m => String(m).trim()).filter((m: string) => nameSet.has(m)))] as string[] : [],
      }))
      .filter((c: ItemNameCluster) => c.canonical && c.members.length >= 2)
    : []
    return { ok: true, clusters }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? 'AI 분류에 실패했습니다.' }
  }
}

// 한 그룹 병합 — members(옛명) 지출·소모품 카드 라벨을 canonical 로 변경 + 별칭 생성 + 이력 저장(undo용).
export async function mergeItemNames(canonical: string, members: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const canon = canonical.trim()
    if (!canon) return { ok: false, error: '대표명이 비어 있습니다.' }
    const olds = [...new Set(members.map(m => m.trim()).filter(m => m && m !== canon))]
    if (olds.length === 0) return { ok: false, error: '병합할 이름이 없습니다.' }

    // 되돌리기용 — 변경 전 지출/소모품 라벨 기록
    const affExp = await prisma.expense.findMany({ where: { propertyId, itemLabel: { in: olds } }, select: { id: true, itemLabel: true } })
    const trackedToRename: { id: string; oldLabel: string }[] = []
    for (const old of olds) {
      const t = await prisma.trackedItem.findFirst({ where: { propertyId, label: old }, select: { id: true, category: true } })
      if (t) {
        const conflict = await prisma.trackedItem.findUnique({ where: { propertyId_category_label: { propertyId, category: t.category, label: canon } }, select: { id: true } })
        if (!conflict) trackedToRename.push({ id: t.id, oldLabel: old })  // 충돌 시 카드 병합은 재고관리 병합 사용
      }
    }
    // 새로 만들 별칭(기존에 없던 키만 — undo 때만 삭제, 기존 별칭은 보존)
    const newAliasKeys: string[] = []
    for (const old of olds) {
      const key = normalizeItemName(old)
      const ex = await prisma.itemNameAlias.findUnique({ where: { propertyId_aliasKey: { propertyId, aliasKey: key } }, select: { id: true } })
      if (!ex && !newAliasKeys.includes(key)) newAliasKeys.push(key)
    }

    await prisma.$transaction(async (tx) => {
      await tx.expense.updateMany({ where: { propertyId, itemLabel: { in: olds } }, data: { itemLabel: canon } })
      for (const t of trackedToRename) await tx.trackedItem.update({ where: { id: t.id }, data: { label: canon } })
      for (const old of olds) {
        const key = normalizeItemName(old)
        await tx.itemNameAlias.upsert({
          where: { propertyId_aliasKey: { propertyId, aliasKey: key } },
          update: { preferredLabel: canon, aliasLabel: old, source: 'merge' },
          create: { propertyId, aliasKey: key, aliasLabel: old, preferredLabel: canon, source: 'merge', hitCount: 0 },
        })
      }
      await tx.itemNameMergeRun.create({
        data: {
          propertyId, canonical: canon, memberCount: olds.length, newAliasKeys,
          affected: { expenses: affExp.map(e => ({ id: e.id, oldLabel: e.itemLabel })), tracked: trackedToRename },
        },
      })
    })
    revalidatePath('/finance'); revalidatePath('/inventory'); revalidatePath('/settings')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '병합에 실패했습니다.' }
  }
}

export type ItemNameMergeRunRow = { id: string; canonical: string; memberCount: number; createdAt: Date }
export async function getItemNameMergeRuns(): Promise<ItemNameMergeRunRow[]> {
  const propertyId = await getPropertyId()
  try {
    return await prisma.itemNameMergeRun.findMany({
      where: { propertyId, undoneAt: null },
      orderBy: { createdAt: 'desc' }, take: 30,
      select: { id: true, canonical: true, memberCount: true, createdAt: true },
    })
  } catch { return [] }
}

// 병합 1건 적용취소 — 지출·소모품 라벨을 옛명으로 원복 + 이 병합이 새로 만든 별칭만 삭제.
export async function undoItemNameMerge(runId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const run = await prisma.itemNameMergeRun.findFirst({ where: { id: runId, propertyId, undoneAt: null } })
    if (!run) return { ok: false, error: '되돌릴 병합을 찾을 수 없습니다.' }
    const aff = run.affected as {
      expenses?: { id: string; oldLabel: string }[]
      tracked?: { id: string; oldLabel: string }[]
      assets?: { id: string; oldLabel: string | null; oldSpecValue: number | null; oldSpecUnit: string | null; oldSpecText?: string | null; oldQtyValue?: number | null; oldQtyUnit: string | null; oldDetail: string | null }[]
    } | null
    await prisma.$transaction(async (tx) => {
      for (const e of aff?.expenses ?? []) { try { await tx.expense.update({ where: { id: e.id }, data: { itemLabel: e.oldLabel } }) } catch { /* 삭제된 행 무시 */ } }
      for (const t of aff?.tracked ?? []) { try { await tx.trackedItem.update({ where: { id: t.id }, data: { label: t.oldLabel } }) } catch { /* skip */ } }
      // 비품 합치기(combineAssets) 원복 — 이름·사양·단위·detail 통째 복구.
      // specText·qtyValue 는 신규 이력에만 있는 필드(하위호환) — 있을 때만 원복(옛 이력은 종전대로).
      for (const a of aff?.assets ?? []) { try { await tx.expense.update({ where: { id: a.id }, data: { itemLabel: a.oldLabel, specValue: a.oldSpecValue, specUnit: a.oldSpecUnit, qtyUnit: a.oldQtyUnit, detail: a.oldDetail, ...(a.oldSpecText !== undefined ? { specText: a.oldSpecText } : {}), ...(a.oldQtyValue !== undefined ? { qtyValue: a.oldQtyValue } : {}) } }) } catch { /* skip */ } }
      if (run.newAliasKeys.length) await tx.itemNameAlias.deleteMany({ where: { propertyId, aliasKey: { in: run.newAliasKeys } } })
      await tx.itemNameMergeRun.update({ where: { id: run.id }, data: { undoneAt: new Date() } })
    })
    revalidatePath('/finance'); revalidatePath('/inventory'); revalidatePath('/inventory/assets'); revalidatePath('/settings')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '적용취소에 실패했습니다.' }
  }
}

export async function settleCardExpenses(ids: string[]) {
  await requireEdit()
  await prisma.expense.updateMany({
    where: { id: { in: ids }, settleStatus: 'UNSETTLED' },
    data: { settleStatus: 'SETTLED' },
  })
  revalidatePath('/finance')
}

export async function unsettleExpenses(ids: string[]) {
  await requireEdit()
  await prisma.expense.updateMany({
    where: { id: { in: ids } },
    data: { settleStatus: 'UNSETTLED' },
  })
  revalidatePath('/finance')
}

// ── 부가 수익 ────────────────────────────────────────────────────

export async function getExtraIncomes(targetMonth: string) {
  const propertyId = await getPropertyId()
  const [yyyy, mm] = targetMonth.split('-').map(Number)
  return prisma.extraIncome.findMany({
    where: {
      propertyId,
      date: { gte: new Date(yyyy, mm - 1, 1), lte: new Date(yyyy, mm, 0) },
    },
    orderBy: { date: 'desc' },
    include: {
      financialAccount: { select: { brand: true, alias: true } },
      // 입주자 연결(선택) — 과납분·보증금 미반환분 등 수납 파생 수익 표시용
      tenant: { select: { id: true, name: true } },
      leaseTerm: { select: { id: true, room: { select: { roomNo: true } } } },
    },
  })
}

export async function addExtraIncome(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const date      = formData.get('date') as string
    const amount    = parseAmount(formData.get('amount'))
    const category  = formData.get('category') as string
    const detail    = formData.get('detail') as string
    const memo      = formData.get('memo') as string
    const payMethod = formData.get('payMethod') as string
    const financialAccountId = formData.get('financialAccountId') as string
    // 입주자 연결(선택) — leaseTermId만 와도 tenantId를 계약에서 보충
    const leaseTermId = ((formData.get('leaseTermId') as string) || '').trim() || null
    let tenantId      = ((formData.get('tenantId') as string) || '').trim() || null
    if (leaseTermId && !tenantId) {
      const lt = await prisma.leaseTerm.findFirst({ where: { id: leaseTermId, propertyId }, select: { tenantId: true } })
      tenantId = lt?.tenantId ?? null
    }

    if (!date || !amount || !category) return { ok: false, error: '날짜, 금액, 카테고리는 필수입니다.' }

    await prisma.extraIncome.create({
      data: {
        propertyId,
        date: new Date(date),
        amount, category,
        detail:             detail || null,
        memo:               memo || null,
        payMethod:          payMethod || '계좌이체',
        financialAccountId: financialAccountId || null,
        tenantId, leaseTermId,
      },
    })
    revalidatePath('/finance'); revalidatePath('/rooms')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function updateExtraIncome(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const id        = formData.get('id') as string
    const date      = formData.get('date') as string
    const amount    = parseAmount(formData.get('amount'))
    const category  = formData.get('category') as string
    const detail    = formData.get('detail') as string
    const memo      = formData.get('memo') as string
    const payMethod = formData.get('payMethod') as string
    const financialAccountId = formData.get('financialAccountId') as string
    const leaseTermId = ((formData.get('leaseTermId') as string) || '').trim() || null
    let tenantId      = ((formData.get('tenantId') as string) || '').trim() || null
    if (leaseTermId && !tenantId) {
      const lt = await prisma.leaseTerm.findFirst({ where: { id: leaseTermId, propertyId }, select: { tenantId: true } })
      tenantId = lt?.tenantId ?? null
    }

    if (!date || !amount || !category) return { ok: false, error: '날짜, 금액, 카테고리는 필수입니다.' }

    await prisma.extraIncome.update({
      where: { id },
      data: {
        date: new Date(date),
        amount, category,
        detail:             detail || null,
        memo:               memo || null,
        payMethod:          payMethod || '계좌이체',
        financialAccountId: financialAccountId || null,
        tenantId, leaseTermId,
      },
    })
    revalidatePath('/finance'); revalidatePath('/rooms')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function deleteExtraIncome(id: string) {
  await requireEdit()
  // 소프트삭제 — 조회 익스텐션이 자동 제외(수익 합산·리포트에서 빠짐). 적용취소는 restoreExtraIncome.
  await prisma.extraIncome.update({ where: { id }, data: { deletedAt: new Date() } })
  revalidatePath('/finance'); revalidatePath('/rooms')
}

export async function restoreExtraIncome(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    await prisma.extraIncome.update({ where: { id }, data: { deletedAt: null } })
    revalidatePath('/finance'); revalidatePath('/rooms')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// ── 자산 ─────────────────────────────────────────────────────────

export async function getFinancialAccounts() {
  const propertyId = await getPropertyId()
  return prisma.financialAccount.findMany({
    where: { propertyId, isActive: true },
    orderBy: { createdAt: 'asc' },
    include: {
      linkedAccount: { select: { id: true, brand: true, alias: true } },
    },
  })
}

export async function saveFinancialAccount(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const id   = formData.get('id') as string
    const type = formData.get('type') as string
    const brand = formData.get('brand') as string
    const alias      = formData.get('alias') as string
    const identifier = formData.get('identifier') as string
    const owner      = formData.get('owner') as string
    const payDayRaw    = formData.get('payDay') as string
    const cutOffDayRaw = formData.get('cutOffDay') as string
    const linkedAccountId = formData.get('linkedAccountId') as string

    if (!brand) return { ok: false, error: '금융사명은 필수입니다.' }

    const parseDay = (raw: string) => {
      if (!raw) return null
      if (raw.includes('말')) return 31
      const n = parseInt(raw.replace(/[^0-9]/g, ''))
      return isNaN(n) ? null : n
    }

    const data = {
      type:             type as any,
      brand,
      alias:            alias || null,
      identifier:       identifier || null,
      owner:            owner || null,
      payDay:           parseDay(payDayRaw),
      cutOffDay:        parseDay(cutOffDayRaw),
      linkedAccountId:  linkedAccountId || null,
    }

    if (id) {
      await prisma.financialAccount.update({ where: { id }, data })
    } else {
      await prisma.financialAccount.create({ data: { ...data, propertyId } })
    }
    revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function deleteFinancialAccount(id: string) {
  await requireEdit()
  await prisma.financialAccount.delete({ where: { id } })
  revalidatePath('/finance')
}

export async function deactivateFinancialAccount(id: string) {
  await requireEdit()
  await prisma.financialAccount.update({ where: { id }, data: { isActive: false } })
  revalidatePath('/finance')
}

// ── 고정 지출 현황 ───────────────────────────────────────────────

export type RecurringExpenseWithStatus = {
  id: string
  title: string
  amount: number
  category: string
  dueDay: number
  payMethod: string | null
  financialAccountId: string | null
  isAutoDebit: boolean
  isVariable: boolean
  alertDaysBefore: number
  activeSince: string | null
  isPending: boolean        // activeSince가 이번 달 이후 → 아직 활성화 전
  memo: string | null
  // 이번 달 기록 여부
  recordedExpenseId: string | null
  recordedAmount: number | null
  recordedDate: string | null
  // 변동 항목 과거 평균
  historicalAvg: number | null
  // 미리 입력된 예약 금액 — 결제일 모달에서 prefill될 값. 기록 시 자동 클리어
  pendingAmount: number | null
  // #6: 가장 최근 실제 기록의 결제수단·계좌 — 기록 모달 기본값으로 사용(지난달 처리 방식 자동 대기). 없으면 null
  lastPayMethod: string | null
  lastFinancialAccountId: string | null
  // #1: 세부항목(있으면 '관리비 묶음' 부모). 합계 = 세부 amount 합, 변동 = 하나라도 변동.
  items: { id: string; name: string; amount: number; isVariable: boolean; sortOrder: number }[]
}

export async function getRecurringExpensesWithStatus(month: string): Promise<RecurringExpenseWithStatus[]> {
  const propertyId = await getPropertyId()
  const [year, m] = month.split('-').map(Number)
  const startDate = new Date(year, m - 1, 1)
  const endDate   = new Date(year, m, 0)

  const [allRecurring, recordedThisMonth] = await Promise.all([
    prisma.recurringExpense.findMany({
      where: { propertyId, isActive: true },
      orderBy: { dueDay: 'asc' },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    }),
    prisma.expense.findMany({
      where: { propertyId, recurringExpenseId: { not: null }, date: { gte: startDate, lte: endDate } },
      select: { id: true, recurringExpenseId: true, amount: true, date: true },
    }),
  ])

  // activeSince: 이번 달 마지막 날보다 미래면 isPending=true (목록엔 표시하되 기록 불가)
  const recurringList = allRecurring

  const recordedMap = new Map(recordedThisMonth.map(e => [e.recurringExpenseId!, e]))

  // #6: 각 고정지출의 '가장 최근 실제 기록'의 결제수단·계좌 — 기록 모달 기본값(지난달 처리 방식 자동 대기)
  const recurringIds = recurringList.map(re => re.id)
  const lastRecords = recurringIds.length > 0
    ? await prisma.expense.findMany({
        where: { propertyId, recurringExpenseId: { in: recurringIds } },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        select: { recurringExpenseId: true, payMethod: true, financialAccountId: true },
      })
    : []
  const lastRecordMap = new Map<string, { payMethod: string | null; financialAccountId: string | null }>()
  for (const e of lastRecords) {
    const id = e.recurringExpenseId!
    if (!lastRecordMap.has(id)) lastRecordMap.set(id, { payMethod: e.payMethod, financialAccountId: e.financialAccountId })
  }

  // 변동 항목 최근 3개월 평균 + 전년동월 수치 (isPending 항목 제외)
  const variableIds = recurringList.filter(re => (re as any).isVariable && !(new Date((re as any).activeSince ?? 0) > endDate)).map(re => re.id)
  const threeMonthsAgo = new Date(year, m - 4, 1) // 3개월 전 1일
  const pastExpenses = variableIds.length > 0
    ? await prisma.expense.findMany({
        where: { propertyId, recurringExpenseId: { in: variableIds }, date: { gte: threeMonthsAgo, lt: startDate } },
        select: { recurringExpenseId: true, amount: true },
      })
    : []

  const varSum: Record<string, number> = {}
  const varCnt: Record<string, number> = {}
  for (const e of pastExpenses) {
    const id = e.recurringExpenseId!
    varSum[id] = (varSum[id] ?? 0) + e.amount
    varCnt[id] = (varCnt[id] ?? 0) + 1
  }

  return recurringList.map(re => {
    const recorded = recordedMap.get(re.id)
    const isVar = (re as any).isVariable as boolean
    const priorYearAmt = (re as any).priorYearAmount as number | null
    const recentCnt = varCnt[re.id] ?? 0
    const recentSum = varSum[re.id] ?? 0
    let historicalAvgVal: number | null = null
    if (isVar) {
      const dataPoints: number[] = []
      if (recentCnt >= 1) dataPoints.push(Math.round(recentSum / recentCnt))
      if (priorYearAmt) dataPoints.push(priorYearAmt)
      if (dataPoints.length >= 1) {
        historicalAvgVal = Math.round(dataPoints.reduce((s, v) => s + v, 0) / dataPoints.length)
      }
    }
    const as = (re as any).activeSince as Date | null
    const isPending = !!(as && new Date(as) > endDate)
    return {
      id:                re.id,
      title:             re.title,
      amount:            re.amount,
      category:          re.category,
      dueDay:            re.dueDay,
      payMethod:         re.payMethod,
      financialAccountId: re.financialAccountId,
      isAutoDebit:       re.isAutoDebit,
      isVariable:        isVar,
      alertDaysBefore:   re.alertDaysBefore,
      activeSince:       as ? new Date(as).toISOString().slice(0, 10) : null,
      isPending,
      memo:              re.memo,
      recordedExpenseId: isPending ? null : (recorded?.id ?? null),
      recordedAmount:    isPending ? null : (recorded?.amount ?? null),
      recordedDate:      isPending ? null : (recorded ? new Date(recorded.date).toISOString().slice(0, 10) : null),
      historicalAvg:     historicalAvgVal,
      pendingAmount:     (re as any).pendingAmount ?? null,
      lastPayMethod:        lastRecordMap.get(re.id)?.payMethod ?? null,
      lastFinancialAccountId: lastRecordMap.get(re.id)?.financialAccountId ?? null,
      items: ((re as any).items ?? []).map((it: { id: string; name: string; amount: number; isVariable: boolean; sortOrder: number }) => ({
        id: it.id, name: it.name, amount: it.amount, isVariable: it.isVariable, sortOrder: it.sortOrder,
      })),
    }
  })
}

// ── 고정 지출 기록 ───────────────────────────────────────────────

export async function recordRecurringExpense(data: {
  recurringExpenseId: string
  amount: number
  date: string
  payMethod?: string
  financialAccountId?: string
  memo?: string
  // #1 관리비 묶음: 세부항목별 실제 금액. 있으면 amount는 무시하고 합계로 기록 + breakdown 보관.
  breakdown?: { name: string; amount: number; isVariable: boolean }[]
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const recurring = await prisma.recurringExpense.findUnique({
      where: { id: data.recurringExpenseId },
      select: { category: true, title: true, payMethod: true, financialAccountId: true, vendor: true },
    })
    if (!recurring) return { ok: false, error: '고정 지출 항목을 찾을 수 없습니다.' }

    const resolvedAccountId = data.financialAccountId ?? recurring.financialAccountId ?? null

    // #1: 세부항목이 있으면 합계로 기록하고 내역을 breakdownJson 에 보관(장부엔 1줄)
    const hasBreakdown = Array.isArray(data.breakdown) && data.breakdown.length > 0
    const recordedAmount = hasBreakdown
      ? data.breakdown!.reduce((s, it) => s + (Number(it.amount) || 0), 0)
      : data.amount

    await prisma.$transaction([
      prisma.expense.create({
        data: {
          propertyId,
          date:                new Date(data.date),
          amount:              recordedAmount,
          category:            recurring.category,
          detail:              recurring.title,
          vendor:              recurring.vendor ?? null,
          payMethod:           data.payMethod ?? recurring.payMethod ?? '계좌이체',
          financialAccountId:  resolvedAccountId,
          memo:                data.memo ?? null,
          settleStatus:        (data.payMethod ?? recurring.payMethod) === '신용카드' ? 'UNSETTLED' : 'SETTLED',
          recurringExpenseId:  data.recurringExpenseId,
          breakdownJson:       hasBreakdown ? JSON.stringify(data.breakdown) : null,
        },
      }),
      // 예약 금액 자동 클리어 — 같은 트랜잭션으로 처리해 부분 실패 방지
      prisma.recurringExpense.update({
        where: { id: data.recurringExpenseId },
        data:  { pendingAmount: null },
      }),
    ])
    revalidatePath('/finance')
    revalidatePath('/dashboard')
    return { ok: true }
  } catch (e) {
    if ((e as any)?.digest?.startsWith('NEXT_REDIRECT')) throw e
    return { ok: false, error: (e as Error).message }
  }
}

// 예약 금액 저장 — 변동 고정지출 금액을 미리 알았을 때.
// Expense는 만들지 않고 RecurringExpense.pendingAmount만 갱신.
export async function setRecurringPendingAmount(input: {
  recurringExpenseId: string
  amount: number
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    if (input.amount <= 0) return { ok: false, error: '금액은 0보다 커야 합니다.' }
    const found = await prisma.recurringExpense.findFirst({
      where: { id: input.recurringExpenseId, propertyId },
      select: { id: true },
    })
    if (!found) return { ok: false, error: '고정 지출 항목을 찾을 수 없습니다.' }
    await prisma.recurringExpense.update({
      where: { id: input.recurringExpenseId },
      data:  { pendingAmount: input.amount },
    })
    revalidatePath('/finance')
    revalidatePath('/dashboard')
    return { ok: true }
  } catch (e) {
    if ((e as any)?.digest?.startsWith('NEXT_REDIRECT')) throw e
    return { ok: false, error: (e as Error).message }
  }
}

export async function clearRecurringPendingAmount(input: {
  recurringExpenseId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const found = await prisma.recurringExpense.findFirst({
      where: { id: input.recurringExpenseId, propertyId },
      select: { id: true },
    })
    if (!found) return { ok: false, error: '고정 지출 항목을 찾을 수 없습니다.' }
    await prisma.recurringExpense.update({
      where: { id: input.recurringExpenseId },
      data:  { pendingAmount: null },
    })
    revalidatePath('/finance')
    revalidatePath('/dashboard')
    return { ok: true }
  } catch (e) {
    if ((e as any)?.digest?.startsWith('NEXT_REDIRECT')) throw e
    return { ok: false, error: (e as Error).message }
  }
}

// ============================================================
// 예비비 (ReserveTransaction)
// type: DEPOSIT(적립) | WITHDRAW_DIRECT(직접 인출, 별도 Expense 없음)
//     | WITHDRAW_FROM_EXPENSE(일반 지출 사후정산, expenseId 연결)
// 잔고 = SUM(DEPOSIT) - SUM(WITHDRAW_*)
// ============================================================

export type ReserveTxn = {
  id: string
  type: 'DEPOSIT' | 'WITHDRAW_DIRECT' | 'WITHDRAW_FROM_EXPENSE'
  amount: number
  date: Date
  sourceMonth: string | null
  category: string | null
  memo: string | null
  expenseId: string | null
  expense: { id: string; date: Date; amount: number; category: string; detail: string | null } | null
  linkedAccountId: string | null
  linkedAccount: { id: string; type: string; brand: string; alias: string | null } | null
}

export async function getReserveBalance(): Promise<number> {
  const propertyId = await getPropertyId()
  const rows = await prisma.reserveTransaction.findMany({
    where: { propertyId },
    select: { type: true, amount: true },
  })
  let bal = 0
  for (const r of rows) {
    if (r.type === 'DEPOSIT') bal += r.amount
    else bal -= r.amount
  }
  return bal
}

export async function getReserveMonthlySummary(targetMonth: string): Promise<{
  deposit: number             // 이 달에 일어난 적립 거래 합계 (date 기준)
  withdraw: number            // 이 달에 일어난 사용 거래 합계 (date 기준)
  depositFromThisMonthRevenue: number  // 출처가 이 달 매출인 적립 합계 (sourceMonth 기준, date 무관)
}> {
  const propertyId = await getPropertyId()
  const [yyyy, mm] = targetMonth.split('-').map(Number)
  const [byDate, bySourceAgg] = await Promise.all([
    prisma.reserveTransaction.findMany({
      where: {
        propertyId,
        date: { gte: new Date(yyyy, mm - 1, 1), lte: new Date(yyyy, mm, 0) },
      },
      select: { type: true, amount: true },
    }),
    prisma.reserveTransaction.aggregate({
      where: { propertyId, type: 'DEPOSIT', sourceMonth: targetMonth },
      _sum: { amount: true },
    }),
  ])
  let deposit = 0
  let withdraw = 0
  for (const r of byDate) {
    if (r.type === 'DEPOSIT') deposit += r.amount
    else withdraw += r.amount
  }
  return {
    deposit,
    withdraw,
    depositFromThisMonthRevenue: bySourceAgg._sum.amount ?? 0,
  }
}

export async function getReserveTransactions(targetMonth: string): Promise<ReserveTxn[]> {
  const propertyId = await getPropertyId()
  const [yyyy, mm] = targetMonth.split('-').map(Number)
  const rows = await prisma.reserveTransaction.findMany({
    where: {
      propertyId,
      date: { gte: new Date(yyyy, mm - 1, 1), lte: new Date(yyyy, mm, 0) },
    },
    include: {
      expense: { select: { id: true, date: true, amount: true, category: true, detail: true } },
      linkedAccount: { select: { id: true, type: true, brand: true, alias: true } },
    },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  })
  return rows.map(r => ({
    id: r.id,
    type: r.type as ReserveTxn['type'],
    amount: r.amount,
    date: r.date,
    sourceMonth: r.sourceMonth,
    category: r.category,
    memo: r.memo,
    expenseId: r.expenseId,
    expense: r.expense,
    linkedAccountId: r.linkedAccountId,
    linkedAccount: r.linkedAccount,
  }))
}

export async function addReserveDeposit(input: { amount: number; date: string; sourceMonth?: string; linkedAccountId?: string; memo?: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    if (input.amount <= 0) return { ok: false, error: '금액은 0보다 커야 합니다.' }
    // sourceMonth 형식 검증 — "YYYY-MM"
    if (input.sourceMonth && !/^\d{4}-\d{2}$/.test(input.sourceMonth)) {
      return { ok: false, error: '출처 월 형식이 잘못되었습니다 (YYYY-MM).' }
    }
    await prisma.reserveTransaction.create({
      data: {
        propertyId,
        type: 'DEPOSIT',
        amount: input.amount,
        date: new Date(input.date),
        sourceMonth: input.sourceMonth || null,
        linkedAccountId: input.linkedAccountId || null,
        memo: input.memo || null,
      },
    })
    revalidatePath('/finance')
    revalidatePath('/dashboard')
    return { ok: true }
  } catch (e) {
    if ((e as any)?.digest?.startsWith('NEXT_REDIRECT')) throw e
    return { ok: false, error: (e as Error).message }
  }
}

export async function addReserveWithdrawDirect(input: { amount: number; date: string; category?: string; linkedAccountId?: string; memo?: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    if (input.amount <= 0) return { ok: false, error: '금액은 0보다 커야 합니다.' }
    const balance = await getReserveBalance()
    if (input.amount > balance) return { ok: false, error: `잔고 부족 · 현재 예비비 ${balance.toLocaleString()}원` }
    await prisma.reserveTransaction.create({
      data: {
        propertyId,
        type: 'WITHDRAW_DIRECT',
        amount: input.amount,
        date: new Date(input.date),
        category: input.category || null,
        linkedAccountId: input.linkedAccountId || null,
        memo: input.memo || null,
      },
    })
    revalidatePath('/finance')
    revalidatePath('/dashboard')
    return { ok: true }
  } catch (e) {
    if ((e as any)?.digest?.startsWith('NEXT_REDIRECT')) throw e
    return { ok: false, error: (e as Error).message }
  }
}

export async function settleReserveFromExpense(input: { expenseId: string; amount?: number; memo?: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const expense = await prisma.expense.findFirst({
      where: { id: input.expenseId, propertyId },
      select: { id: true, amount: true, date: true, category: true, detail: true },
    })
    if (!expense) return { ok: false, error: '지출을 찾을 수 없습니다.' }

    // 이미 정산된 금액 합산 — 동일 지출에 중복 정산 방지
    const existing = await prisma.reserveTransaction.aggregate({
      where: { propertyId, type: 'WITHDRAW_FROM_EXPENSE', expenseId: input.expenseId },
      _sum: { amount: true },
    })
    const alreadySettled = existing._sum.amount ?? 0
    const remaining = expense.amount - alreadySettled
    if (remaining <= 0) return { ok: false, error: '이미 전액 정산된 지출입니다.' }

    const settleAmount = input.amount ?? remaining
    if (settleAmount <= 0) return { ok: false, error: '정산 금액은 0보다 커야 합니다.' }
    if (settleAmount > remaining) return { ok: false, error: `정산 가능 금액 초과 · 잔여 ${remaining.toLocaleString()}원` }

    const balance = await getReserveBalance()
    if (settleAmount > balance) return { ok: false, error: `잔고 부족 · 현재 예비비 ${balance.toLocaleString()}원` }

    await prisma.reserveTransaction.create({
      data: {
        propertyId,
        type: 'WITHDRAW_FROM_EXPENSE',
        amount: settleAmount,
        date: expense.date,
        category: expense.category,
        memo: input.memo || null,
        expenseId: expense.id,
      },
    })
    revalidatePath('/finance')
    revalidatePath('/dashboard')
    return { ok: true }
  } catch (e) {
    if ((e as any)?.digest?.startsWith('NEXT_REDIRECT')) throw e
    return { ok: false, error: (e as Error).message }
  }
}

export async function deleteReserveTransaction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const found = await prisma.reserveTransaction.findFirst({ where: { id, propertyId } })
    if (!found) return { ok: false, error: '거래를 찾을 수 없습니다.' }
    await prisma.reserveTransaction.delete({ where: { id } })
    revalidatePath('/finance')
    revalidatePath('/dashboard')
    return { ok: true }
  } catch (e) {
    if ((e as any)?.digest?.startsWith('NEXT_REDIRECT')) throw e
    return { ok: false, error: (e as Error).message }
  }
}

// ============================================================
// 보증금 (Deposit)
// 입금: PaymentRecord(isDeposit=true)
// 환불: DepositRefund(returnedAmount, withheldAmount)
// 입주자별 잔고 = SUM(deposit 입금) - SUM(returned + withheld)
// ============================================================

export type DepositLedgerEntry = {
  type: 'IN' | 'REFUND'
  date: Date
  createdAt?: Date
  amount: number          // IN은 입금액, REFUND는 returned + withheld
  returnedAmount?: number // REFUND 전용
  withheldAmount?: number // REFUND 전용
  reason?: string | null  // REFUND 전용
  memo: string | null
  tenantId: string
  tenantName: string
  roomNo: string | null
  leaseTermId: string
}

export type DepositPerTenant = {
  leaseTermId: string
  tenantId: string
  tenantName: string
  roomNo: string | null
  status: string  // LeaseStatus
  contractDeposit: number  // 계약상 보증금 (LeaseTerm.depositAmount)
  totalIn: number          // 실제 입금 합계
  totalReturned: number    // 환불된 금액
  totalWithheld: number    // 미반환 처리 금액
  balance: number          // 보유 보증금 (퇴실=0, 그 외 효정 입금-환불)
  hasNoInRecord: boolean   // 입금 거래 기록 없이 계약상 보증금만 있는 경우
}

// 모든 입주자별 보증금 잔고/내역 — 잔고 큰 순으로 정렬
export async function getDepositSummaryByTenant(): Promise<DepositPerTenant[]> {
  const propertyId = await getPropertyId()
  const leases = await prisma.leaseTerm.findMany({
    where: { propertyId },
    select: {
      id: true,
      depositAmount: true,
      status: true,
      tenant: { select: { id: true, name: true } },
      room: { select: { roomNo: true } },
    },
  })
  if (leases.length === 0) return []

  const leaseIds = leases.map(l => l.id)
  const [paymentSums, refundSums] = await Promise.all([
    prisma.paymentRecord.groupBy({
      by: ['leaseTermId'],
      where: { propertyId, isDeposit: true, leaseTermId: { in: leaseIds } },
      _sum: { actualAmount: true },
    }),
    prisma.depositRefund.groupBy({
      by: ['leaseTermId'],
      where: { propertyId, leaseTermId: { in: leaseIds } },
      _sum: { returnedAmount: true, withheldAmount: true },
    }),
  ])
  const inMap: Record<string, number> = {}
  for (const p of paymentSums) inMap[p.leaseTermId] = p._sum.actualAmount ?? 0
  const returnedMap: Record<string, number> = {}
  const withheldMap: Record<string, number> = {}
  for (const r of refundSums) {
    returnedMap[r.leaseTermId] = r._sum.returnedAmount ?? 0
    withheldMap[r.leaseTermId] = r._sum.withheldAmount ?? 0
  }

  return leases
    .map(l => {
      const totalIn       = inMap[l.id] ?? 0
      const totalReturned = returnedMap[l.id] ?? 0
      const totalWithheld = withheldMap[l.id] ?? 0
      const isCheckedOut  = l.status === 'CHECKED_OUT'
      // 입금 거래 기록 없어도 계약상 보증금이 있으면 그것을 입금으로 간주
      // (옛 데이터: PaymentRecord 거래 없이 LeaseTerm만 임포트된 케이스 호환)
      const effectiveIn   = totalIn > 0 ? totalIn : l.depositAmount
      // 퇴실(CHECKED_OUT) — 옛 흐름은 ExtraIncome으로만 환불 처리해서
      // DepositRefund가 없는 경우가 있음. 회계상 보증금 정리 완료로 보고 0.
      const balance       = isCheckedOut ? 0 : Math.max(0, effectiveIn - totalReturned - totalWithheld)
      return {
        leaseTermId: l.id,
        tenantId:    l.tenant.id,
        tenantName:  l.tenant.name,
        roomNo:      l.room?.roomNo ?? null,
        status:      l.status,
        contractDeposit: l.depositAmount,
        totalIn, totalReturned, totalWithheld, balance,
        hasNoInRecord: totalIn === 0 && l.depositAmount > 0,
      }
    })
    // 입금 흔적 또는 환불 흔적 또는 계약상 보증금이 있는 케이스 모두 노출
    .filter(d => d.totalIn > 0 || d.totalReturned > 0 || d.totalWithheld > 0 || d.contractDeposit > 0)
    .sort((a, b) => b.balance - a.balance || a.tenantName.localeCompare(b.tenantName))
}

// 거래 이력 (입금 + 환불 통합) — 날짜 역순
export async function getDepositLedger(targetMonth?: string): Promise<DepositLedgerEntry[]> {
  const propertyId = await getPropertyId()
  const monthFilter = targetMonth
    ? (() => {
        const [yyyy, mm] = targetMonth.split('-').map(Number)
        return { gte: new Date(yyyy, mm - 1, 1), lte: new Date(yyyy, mm, 0) }
      })()
    : undefined

  const [deposits, refunds] = await Promise.all([
    prisma.paymentRecord.findMany({
      where: {
        propertyId,
        isDeposit: true,
        ...(monthFilter ? { payDate: monthFilter } : {}),
      },
      select: {
        id: true, payDate: true, createdAt: true, actualAmount: true, memo: true, leaseTermId: true,
        tenant: { select: { id: true, name: true } },
        leaseTerm: { select: { room: { select: { roomNo: true } } } },
      },
    }),
    prisma.depositRefund.findMany({
      where: {
        propertyId,
        ...(monthFilter ? { date: monthFilter } : {}),
      },
      select: {
        id: true, date: true, createdAt: true, returnedAmount: true, withheldAmount: true,
        reason: true, memo: true, leaseTermId: true,
        tenant: { select: { id: true, name: true } },
        leaseTerm: { select: { room: { select: { roomNo: true } } } },
      },
    }),
  ])

  const ins: DepositLedgerEntry[] = deposits.map(d => ({
    type: 'IN',
    date: d.payDate,
    createdAt: d.createdAt,
    amount: d.actualAmount,
    memo: d.memo,
    tenantId: d.tenant.id,
    tenantName: d.tenant.name,
    roomNo: d.leaseTerm.room?.roomNo ?? null,
    leaseTermId: d.leaseTermId,
  }))
  const outs: DepositLedgerEntry[] = refunds.map(r => ({
    type: 'REFUND',
    date: r.date,
    createdAt: r.createdAt,
    amount: r.returnedAmount + r.withheldAmount,
    returnedAmount: r.returnedAmount,
    withheldAmount: r.withheldAmount,
    reason: r.reason,
    memo: r.memo,
    tenantId: r.tenant.id,
    tenantName: r.tenant.name,
    roomNo: r.leaseTerm.room?.roomNo ?? null,
    leaseTermId: r.leaseTermId,
  }))

  return [...ins, ...outs].sort((a, b) => b.date.getTime() - a.date.getTime() || (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
}

// 사후정산용 — 해당 월 지출 중 아직 미정산 잔여가 있는 것만 (정산 가능 후보)
export async function getSettleableExpenses(targetMonth: string): Promise<{ id: string; date: Date; amount: number; category: string; detail: string | null; settledSum: number; remaining: number }[]> {
  const propertyId = await getPropertyId()
  const [yyyy, mm] = targetMonth.split('-').map(Number)
  const expenses = await prisma.expense.findMany({
    where: {
      propertyId,
      date: { gte: new Date(yyyy, mm - 1, 1), lte: new Date(yyyy, mm, 0) },
    },
    select: { id: true, date: true, amount: true, category: true, detail: true },
    orderBy: { date: 'desc' },
  })
  if (expenses.length === 0) return []

  const settles = await prisma.reserveTransaction.groupBy({
    by: ['expenseId'],
    where: { propertyId, type: 'WITHDRAW_FROM_EXPENSE', expenseId: { in: expenses.map(e => e.id) } },
    _sum: { amount: true },
  })
  const settleMap: Record<string, number> = {}
  for (const s of settles) if (s.expenseId) settleMap[s.expenseId] = s._sum.amount ?? 0

  return expenses
    .map(e => ({
      ...e,
      settledSum: settleMap[e.id] ?? 0,
      remaining: e.amount - (settleMap[e.id] ?? 0),
    }))
    .filter(e => e.remaining > 0)
}

// 구매처(vendor) 자동완성 — 과거 입력한 구매처 중복 제거(최근순). datalist 제안용.
export async function getExpenseVendorSuggestions(): Promise<string[]> {
  const propertyId = await getPropertyId()
  const rows = await prisma.expense.findMany({
    where: { propertyId, vendor: { not: null } },
    select: { vendor: true },
    orderBy: { createdAt: 'desc' },
    take: 400,
  })
  const seen = new Set<string>()
  const result: string[] = []
  for (const r of rows) {
    const v = r.vendor?.trim()
    if (v && !seen.has(v)) { seen.add(v); result.push(v) }
  }
  return result
}

// 구매처 정리 — 사용 중인 구매처 목록(사용 건수). 오타·중복 정돈용.
export async function getVendorUsage(): Promise<{ vendor: string; count: number }[]> {
  const propertyId = await getPropertyId()
  const rows = await prisma.expense.groupBy({
    by: ['vendor'],
    where: { propertyId, vendor: { not: null } },
    _count: { _all: true },
  })
  return rows
    .map(r => ({ vendor: (r.vendor ?? '').trim(), count: r._count._all }))
    .filter(r => r.vendor)
    .sort((a, b) => b.count - a.count || a.vendor.localeCompare(b.vendor))
}

// 구매처 이름 변경/합치기/비우기 — 해당 구매처의 모든 지출을 일괄 변경.
// newName 이 기존 구매처와 같으면 자연히 합쳐짐. 빈 값이면 구매처 제거(null).
export async function renameVendor(oldName: string, newName: string): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const target = newName.trim()
    if (!oldName) return { ok: false, error: '대상 구매처가 없습니다.' }
    if (target === oldName) return { ok: true, updated: 0 }
    const res = await prisma.expense.updateMany({
      where: { propertyId, vendor: oldName },
      data: { vendor: target || null },
    })
    revalidatePath('/finance')
    return { ok: true, updated: res.count }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}


// 품목 빠른 선택 — 실사용 이력 기반(운영자 지시 2026-07-06).
// 최근 등록 5개 + 선택(등록) 횟수순으로 채워 항상 10개. 이력이 부족하면 기본 프리셋으로 보충 —
// 수선유지비·서비스 등 '선택할 품목 0개' 상황 방지. 한 번도 안 쓴 프리셋은 이력이 쌓이면 자연히 밀려남.
// 품목 빠른선택 — 입력이 진행될수록 좁아지는 계층 추천(신고 6b79c725·99c30054, 운영자 확정 2026-07-08):
// ① 유형(물품/서비스·무형)별 이력만 ② 카테고리 선택 시 그 카테고리 이력으로 좁힘.
// 각 단계에서 후보가 10개 미만이면 바로 위 단계(유형 전체) 이력으로 부족분만 보충 — 항상 10개 유지.
// 서비스·무형은 서비스로 등록된 항목(도배·시공 등)만 추천된다(물품과 완전 분리).
export async function getItemQuickPicks(category: string, opts?: { service?: boolean }): Promise<string[]> {
  const propertyId = await getPropertyId()
  const service = !!opts?.service
  const rank = (rows: { itemLabel: string | null; _count: { _all: number }; _max: { date: Date | null } }[]) => {
    const labels = rows.filter(r => r.itemLabel)
    const byRecent = [...labels].sort((a, b) => (b._max.date?.getTime() ?? 0) - (a._max.date?.getTime() ?? 0))
    const byCount  = [...labels].sort((a, b) => b._count._all - a._count._all)
    return { byRecent, byCount }
  }
  const picks: string[] = []
  const push = (l: string | null | undefined) => { if (l && !picks.includes(l) && picks.length < 10) picks.push(l) }

  // 1단계: 유형 + 카테고리
  const catRows = await prisma.expense.groupBy({
    by: ['itemLabel'],
    where: { propertyId, category, itemLabel: { not: null }, isShipping: false, excludeFromInventory: service },
    _count: { _all: true },
    _max: { date: true },
  })
  const cat = rank(catRows)
  cat.byRecent.slice(0, 5).forEach(r => push(r.itemLabel))
  cat.byCount.forEach(r => push(r.itemLabel))

  // 2단계 보충: 부족하면 유형 전체 이력에서 채움(카테고리 무관)
  if (picks.length < 10) {
    const allRows = await prisma.expense.groupBy({
      by: ['itemLabel'],
      where: { propertyId, itemLabel: { not: null }, isShipping: false, excludeFromInventory: service },
      _count: { _all: true },
      _max: { date: true },
    })
    const all = rank(allRows)
    all.byRecent.slice(0, 5).forEach(r => push(r.itemLabel))
    all.byCount.forEach(r => push(r.itemLabel))
  }

  // 3단계 보충: 물품이면 카테고리 기본 프리셋(서비스는 이력만)
  if (!service) for (const p of (ITEM_PRESETS[category] ?? [])) push(p)
  return picks
}


// 지출 등록 폼 결제 기본값 — 직전 지출의 결제수단·계좌를 프리필(운영자 지시 2026-07-06).
export async function getLastPayDefaults(): Promise<{ payMethod: string | null; financialAccountId: string | null; financeName: string | null } | null> {
  const propertyId = await getPropertyId()
  const row = await prisma.expense.findFirst({
    where: { propertyId, isShipping: false },
    orderBy: { createdAt: 'desc' },
    select: { payMethod: true, financialAccountId: true, financeName: true },
  })
  return row ?? null
}
