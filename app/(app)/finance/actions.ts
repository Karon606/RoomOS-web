'use server'

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireEdit } from '@/lib/role'
import { uploadToDrive } from '@/lib/google-drive'
import type { SettleStatus } from '@prisma/client'
import { FINANCE_DETAIL_SUGGESTIONS_LIMIT } from '@/lib/appConfig'

async function getPropertyId() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const cookieStore = await cookies()
  const propertyId = cookieStore.get('selected_property_id')?.value
  if (!propertyId) redirect('/property-select')
  return propertyId
}

function parseAmount(raw: FormDataEntryValue | null): number {
  return Number(String(raw ?? '').replace(/[^0-9]/g, '')) || 0
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
    },
  })
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

export async function getLastItemUnits(
  itemLabel: string,
): Promise<{ specUnit: string | null; qtyUnit: string | null } | null> {
  const propertyId = await getPropertyId()
  const row = await prisma.expense.findFirst({
    where: { propertyId, itemLabel },
    select: { specUnit: true, qtyUnit: true },
    orderBy: { createdAt: 'desc' },
  })
  return row ?? null
}

type ItemPick = {
  label: string
  specValue?: string; specUnit?: string
  qtyValue?: string;  qtyUnit?: string
  amount?: number
}

// ── 영수증 OCR (Gemini Vision) ────────────────────────────────────
export type ReceiptOcrItem = {
  label: string
  specValue?: string; specUnit?: string
  qtyValue?: string;  qtyUnit?: string
  amount: number
}
export type ReceiptOcrResult = {
  date?: string         // YYYY-MM-DD
  vendor?: string
  totalAmount?: number
  items: ReceiptOcrItem[]
  category?: string     // AI 추천 카테고리 (보수적)
}

export async function analyzeReceiptWithGemini(imageBase64: string, mimeType: string): Promise<{ ok: true; data: ReceiptOcrResult } | { ok: false; error: string }> {
  try {
    await requireEdit()
    await getPropertyId()
    if (!imageBase64) return { ok: false, error: '이미지 데이터가 비어있습니다.' }
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return { ok: false, error: 'GEMINI_API_KEY가 설정되지 않았습니다.' }

    const prompt = `이 영수증 이미지를 분석해 다음 JSON 스키마로만 응답하세요. 다른 설명, 마크다운, 코드 블록 없이 순수 JSON만 출력:

{
  "date": "YYYY-MM-DD",          // 결제일. 안 보이면 생략
  "vendor": "상호명",              // 안 보이면 생략
  "totalAmount": 12345,           // 합계 금액 (정수, 원)
  "category": "부식비|소모품비|폐기물 처리비|수선유지비|공과금|마케팅/광고비|인건비|청소용역비|관리비|임대료|통신/렌탈/보험료|세금/수수료|보증금 반환",  // 가장 적합한 1개. 애매하면 생략
  "items": [
    {
      "label": "품목명",
      "specValue": "300",         // 용량/규격 숫자 (선택)
      "specUnit": "ml",           // 용량 단위 (선택)
      "qtyValue": "2",            // 개수 (선택)
      "qtyUnit": "개",             // 개수 단위 (선택)
      "amount": 5000              // 이 품목 가격 (정수)
    }
  ]
}

규칙:
- 부가세/할인/포인트 등 메타 행은 items에 넣지 마세요
- 한국어 영수증 우선. 가격은 숫자만 (콤마 제거)
- 품목 가격 합계가 totalAmount와 약간 달라도 OK
- 영수증으로 보이지 않는 이미지면: { "items": [] } 만 반환`

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } },
            ],
          }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 1500, responseMimeType: 'application/json' },
        }),
      }
    )

    if (!res.ok) {
      const errTxt = await res.text()
      return { ok: false, error: `Gemini API 오류 (${res.status}): ${errTxt.slice(0, 200)}` }
    }
    const json = await res.json()
    const text: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    if (!text) return { ok: false, error: 'AI 응답이 비어있습니다.' }

    // JSON 파싱 (간혹 코드블록으로 감싸서 오는 경우 대비)
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    let parsed: any
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      return { ok: false, error: 'AI 응답을 JSON으로 해석하지 못했습니다.' }
    }

    const items: ReceiptOcrItem[] = Array.isArray(parsed.items) ? parsed.items
      .filter((it: any) => it && typeof it.label === 'string' && it.label.trim())
      .map((it: any) => ({
        label: String(it.label).trim(),
        specValue: it.specValue ? String(it.specValue) : undefined,
        specUnit:  it.specUnit  ? String(it.specUnit)  : undefined,
        qtyValue:  it.qtyValue  ? String(it.qtyValue)  : undefined,
        qtyUnit:   it.qtyUnit   ? String(it.qtyUnit)   : undefined,
        amount:    Number(it.amount) || 0,
      }))
    : []

    return {
      ok: true,
      data: {
        date:        typeof parsed.date === 'string' ? parsed.date : undefined,
        vendor:      typeof parsed.vendor === 'string' ? parsed.vendor : undefined,
        totalAmount: typeof parsed.totalAmount === 'number' ? parsed.totalAmount : undefined,
        category:    typeof parsed.category === 'string' ? parsed.category : undefined,
        items,
      },
    }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function addExpense(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const date      = formData.get('date') as string
    const amount    = parseAmount(formData.get('amount'))
    const category  = formData.get('category') as string
    const detail    = formData.get('detail') as string
    const vendor    = formData.get('vendor') as string
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
    const itemsJsonRaw = formData.get('itemsJson') as string

    if (!date || !amount || !category) return { ok: false, error: '날짜, 금액, 카테고리는 필수입니다.' }

    // 다중 품목: itemsJson 파싱해 N개 행으로 분할
    let multiItems: ItemPick[] | null = null
    if (itemsJsonRaw) {
      try {
        const parsed = JSON.parse(itemsJsonRaw)
        if (Array.isArray(parsed) && parsed.length >= 2) multiItems = parsed
      } catch { /* fallthrough → 단일 row */ }
    }

    const baseSettleStatus: SettleStatus = payMethod === '신용카드' ? 'UNSETTLED' : 'SETTLED'
    const baseRow = {
      propertyId,
      date:               new Date(date),
      category,
      vendor:             vendor || null,
      memo:               memo || null,
      payMethod:          payMethod || '계좌이체',
      financialAccountId: financialAccountId || null,
      financeName:        financeName || null,
      receiptUrl:         receiptUrl || null,
      settleStatus:       baseSettleStatus,
      roomId:             roomId || null,
    }

    if (multiItems) {
      // 각 품목 amount 합 = 총 amount 검증 (반올림 1원 허용)
      const sum = multiItems.reduce((s, it) => s + (Number(it.amount) || 0), 0)
      if (Math.abs(sum - amount) > 1) return { ok: false, error: `품목 금액 합계(${sum.toLocaleString()}원)와 총 금액(${amount.toLocaleString()}원)이 일치하지 않습니다.` }
      await prisma.$transaction(multiItems.map(it => prisma.expense.create({
        data: {
          ...baseRow,
          amount:    Number(it.amount) || 0,
          detail:    `[${it.label}]${it.specValue ? ` ${it.specValue}${it.specUnit ?? ''}` : ''}${it.qtyValue ? ` x ${it.qtyValue}${it.qtyUnit ?? ''}` : ''}`,
          itemLabel: it.label,
          specUnit:  it.specUnit || null,
          qtyUnit:   it.qtyUnit  || null,
          specValue: it.specValue ? parseFloat(it.specValue) : null,
          qtyValue:  it.qtyValue  ? parseFloat(it.qtyValue)  : null,
        },
      })))
      revalidatePath('/finance')
      return { ok: true }
    }

    await prisma.expense.create({
      data: {
        ...baseRow,
        amount,
        detail:             detail || null,
        itemLabel:          itemLabel || null,
        specUnit:           specUnit || null,
        qtyUnit:            qtyUnit || null,
        specValue:          specValueRaw ? parseFloat(specValueRaw) : null,
        qtyValue:           qtyValueRaw  ? parseFloat(qtyValueRaw)  : null,
      },
    })
    revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function updateExpense(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const id        = formData.get('id') as string
    const date      = formData.get('date') as string
    const amount    = parseAmount(formData.get('amount'))
    const category  = formData.get('category') as string
    const detail    = formData.get('detail') as string
    const vendor    = formData.get('vendor') as string
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
    const itemsJsonRaw = formData.get('itemsJson') as string

    if (!date || !amount || !category) return { ok: false, error: '날짜, 금액, 카테고리는 필수입니다.' }

    const baseSettleStatus: SettleStatus = payMethod === '신용카드' ? 'UNSETTLED' : 'SETTLED'

    // 다중 품목 편집: 첫 항목은 현재 row 업데이트, 나머지는 sibling row로 새로 만듦
    let multiItems: ItemPick[] | null = null
    if (itemsJsonRaw) {
      try {
        const parsed = JSON.parse(itemsJsonRaw)
        if (Array.isArray(parsed) && parsed.length >= 2) multiItems = parsed
      } catch { /* fallthrough */ }
    }

    if (multiItems) {
      const sum = multiItems.reduce((s, it) => s + (Number(it.amount) || 0), 0)
      if (Math.abs(sum - amount) > 1) return { ok: false, error: `품목 금액 합계(${sum.toLocaleString()}원)와 총 금액(${amount.toLocaleString()}원)이 일치하지 않습니다.` }

      const first = multiItems[0]
      const rest  = multiItems.slice(1)

      await prisma.$transaction([
        prisma.expense.update({
          where: { id },
          data: {
            date:               new Date(date),
            amount: Number(first.amount) || 0,
            category,
            detail:    `[${first.label}]${first.specValue ? ` ${first.specValue}${first.specUnit ?? ''}` : ''}${first.qtyValue ? ` x ${first.qtyValue}${first.qtyUnit ?? ''}` : ''}`,
            vendor:             vendor || null,
            memo:               memo || null,
            payMethod:          payMethod || '계좌이체',
            financialAccountId: financialAccountId || null,
            financeName:        financeName || null,
            settleStatus:       baseSettleStatus,
            roomId:             roomId || null,
            itemLabel: first.label,
            specUnit:  first.specUnit || null,
            qtyUnit:   first.qtyUnit  || null,
            specValue: first.specValue ? parseFloat(first.specValue) : null,
            qtyValue:  first.qtyValue  ? parseFloat(first.qtyValue)  : null,
            ...(receiptUrl !== null && receiptUrl !== undefined ? { receiptUrl: receiptUrl || null } : {}),
          },
        }),
        ...rest.map(it => prisma.expense.create({
          data: {
            propertyId,
            date:               new Date(date),
            amount:    Number(it.amount) || 0,
            category,
            detail:    `[${it.label}]${it.specValue ? ` ${it.specValue}${it.specUnit ?? ''}` : ''}${it.qtyValue ? ` x ${it.qtyValue}${it.qtyUnit ?? ''}` : ''}`,
            vendor:             vendor || null,
            memo:               memo || null,
            payMethod:          payMethod || '계좌이체',
            financialAccountId: financialAccountId || null,
            financeName:        financeName || null,
            receiptUrl:         receiptUrl || null,
            settleStatus:       baseSettleStatus,
            roomId:             roomId || null,
            itemLabel: it.label,
            specUnit:  it.specUnit || null,
            qtyUnit:   it.qtyUnit  || null,
            specValue: it.specValue ? parseFloat(it.specValue) : null,
            qtyValue:  it.qtyValue  ? parseFloat(it.qtyValue)  : null,
          },
        })),
      ])
      revalidatePath('/finance')
      return { ok: true }
    }

    await prisma.expense.update({
      where: { id },
      data: {
        date:               new Date(date),
        amount, category,
        detail:             detail || null,
        vendor:             vendor || null,
        memo:               memo || null,
        payMethod:          payMethod || '계좌이체',
        financialAccountId: financialAccountId || null,
        financeName:        financeName || null,
        settleStatus:       baseSettleStatus,
        roomId:             roomId || null,
        itemLabel:          itemLabel || null,
        specUnit:           specUnit || null,
        qtyUnit:            qtyUnit || null,
        specValue:          specValueRaw ? parseFloat(specValueRaw) : null,
        qtyValue:           qtyValueRaw  ? parseFloat(qtyValueRaw)  : null,
        ...(receiptUrl !== null && receiptUrl !== undefined ? { receiptUrl: receiptUrl || null } : {}),
      },
    })
    revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function deleteExpense(id: string) {
  await requireEdit()
  await prisma.expense.delete({ where: { id } })
  revalidatePath('/finance')
}

export async function getExpenseDetailSuggestions(): Promise<string[]> {
  const propertyId = await getPropertyId()
  const rows = await prisma.expense.findMany({
    where: { propertyId, detail: { not: null } },
    select: { detail: true },
    orderBy: { createdAt: 'desc' },
    take: FINANCE_DETAIL_SUGGESTIONS_LIMIT,
  })
  const seen = new Set<string>()
  const result: string[] = []
  for (const r of rows) {
    if (r.detail && !seen.has(r.detail)) { seen.add(r.detail); result.push(r.detail) }
  }
  return result
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
    include: { financialAccount: { select: { brand: true, alias: true } } },
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
      },
    })
    revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function updateExtraIncome(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const id        = formData.get('id') as string
    const date      = formData.get('date') as string
    const amount    = parseAmount(formData.get('amount'))
    const category  = formData.get('category') as string
    const detail    = formData.get('detail') as string
    const memo      = formData.get('memo') as string
    const payMethod = formData.get('payMethod') as string
    const financialAccountId = formData.get('financialAccountId') as string

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
      },
    })
    revalidatePath('/finance')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function deleteExtraIncome(id: string) {
  await requireEdit()
  await prisma.extraIncome.delete({ where: { id } })
  revalidatePath('/finance')
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
    }),
    prisma.expense.findMany({
      where: { propertyId, recurringExpenseId: { not: null }, date: { gte: startDate, lte: endDate } },
      select: { id: true, recurringExpenseId: true, amount: true, date: true },
    }),
  ])

  // activeSince: 이번 달 마지막 날보다 미래면 isPending=true (목록엔 표시하되 기록 불가)
  const recurringList = allRecurring

  const recordedMap = new Map(recordedThisMonth.map(e => [e.recurringExpenseId!, e]))

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
    }
  })
}

// ── 고정 지출 기록 ───────────────────────────────────────────────

export async function recordRecurringExpense(data: {
  recurringExpenseId: string
  amount: number
  date: string
  payMethod?: string
  memo?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const recurring = await prisma.recurringExpense.findUnique({
      where: { id: data.recurringExpenseId },
      select: { category: true, title: true, payMethod: true },
    })
    if (!recurring) return { ok: false, error: '고정 지출 항목을 찾을 수 없습니다.' }

    await prisma.expense.create({
      data: {
        propertyId,
        date:                new Date(data.date),
        amount:              data.amount,
        category:            recurring.category,
        detail:              recurring.title,
        payMethod:           data.payMethod ?? recurring.payMethod ?? '계좌이체',
        memo:                data.memo ?? null,
        settleStatus:        (data.payMethod ?? recurring.payMethod) === '신용카드' ? 'UNSETTLED' : 'SETTLED',
        recurringExpenseId:  data.recurringExpenseId,
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
  category: string | null
  memo: string | null
  expenseId: string | null
  expense: { id: string; date: Date; amount: number; category: string; detail: string | null } | null
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

export async function getReserveMonthlySummary(targetMonth: string): Promise<{ deposit: number; withdraw: number }> {
  const propertyId = await getPropertyId()
  const [yyyy, mm] = targetMonth.split('-').map(Number)
  const rows = await prisma.reserveTransaction.findMany({
    where: {
      propertyId,
      date: { gte: new Date(yyyy, mm - 1, 1), lte: new Date(yyyy, mm, 0) },
    },
    select: { type: true, amount: true },
  })
  let deposit = 0
  let withdraw = 0
  for (const r of rows) {
    if (r.type === 'DEPOSIT') deposit += r.amount
    else withdraw += r.amount
  }
  return { deposit, withdraw }
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
    },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  })
  return rows.map(r => ({
    id: r.id,
    type: r.type as ReserveTxn['type'],
    amount: r.amount,
    date: r.date,
    category: r.category,
    memo: r.memo,
    expenseId: r.expenseId,
    expense: r.expense,
  }))
}

export async function addReserveDeposit(input: { amount: number; date: string; memo?: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    if (input.amount <= 0) return { ok: false, error: '금액은 0보다 커야 합니다.' }
    await prisma.reserveTransaction.create({
      data: {
        propertyId,
        type: 'DEPOSIT',
        amount: input.amount,
        date: new Date(input.date),
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

export async function addReserveWithdrawDirect(input: { amount: number; date: string; category?: string; memo?: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    if (input.amount <= 0) return { ok: false, error: '금액은 0보다 커야 합니다.' }
    const balance = await getReserveBalance()
    if (input.amount > balance) return { ok: false, error: `잔고 부족 — 현재 예비비 ${balance.toLocaleString()}원` }
    await prisma.reserveTransaction.create({
      data: {
        propertyId,
        type: 'WITHDRAW_DIRECT',
        amount: input.amount,
        date: new Date(input.date),
        category: input.category || null,
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
    if (settleAmount > remaining) return { ok: false, error: `정산 가능 금액 초과 — 잔여 ${remaining.toLocaleString()}원` }

    const balance = await getReserveBalance()
    if (settleAmount > balance) return { ok: false, error: `잔고 부족 — 현재 예비비 ${balance.toLocaleString()}원` }

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
