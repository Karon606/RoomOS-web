'use server'

// "찍어 올리고 분류는 AI 가" 패러다임의 백엔드.
// 1) 사용자가 사진 업로드 → Drive 보관 + Gemini 분석(영수증/재고 등 분류 + 핵심 필드 추출)
// 2) PendingReceipt row 적재 (status='pending')
// 3) 대시보드에서 사용자가 검토 → 승인(Expense 등록) 또는 거절

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { captureItemNameAliasPairs, normalizeItemName } from '@/lib/itemNameAlias'
import { computeSetHint, type SetHint } from '@/lib/setHint'
import { seedTrackedItemsFromExpenses } from '@/app/(app)/inventory/actions'
import prisma from '@/lib/prisma'
import { uploadToDrive } from '@/lib/google-drive'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'

const COOKIE_PROPERTY = 'selected_property_id'

async function getUserId(): Promise<string> {
  const { userId } = await requirePropertyAccess()
  return userId
}

async function getPropertyId(): Promise<string> {
  const { propertyId } = await requirePropertyAccess()
  return propertyId
}

// Gemini 분류·추출 — '이게 뭐다' 판단 + 가능한 필드 추출.
type GeminiResult = {
  kind: 'expense' | 'inventory' | 'unknown'
  vendor?: string
  date?: string
  amount?: number
  category?: string
  notes?: string
  // 재고용 필드 (kind='inventory' 일 때 유의미)
  itemLabel?: string
  specValue?: string
  specUnit?: string
  qtyValue?: string
  qtyUnit?: string
}

async function analyzeImage(imageBase64: string, mimeType: string): Promise<GeminiResult> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY 미설정')

  const prompt = `이 사진이 무엇인지 판단하고 핵심 정보를 JSON 으로만 응답하세요.

분류 (kind):
- "expense": 영수증·계산서·결제내역 사진 → 지출 등록 후보
- "inventory": 재고·물품 사진(라면/세제/소모품 등) → 재고 항목 등록/보충 후보
- "unknown": 위 둘 다 아님

JSON 스키마:
{
  "kind": "expense" | "inventory" | "unknown",
  "vendor": "상호명 또는 브랜드 (있으면)",
  "date": "YYYY-MM-DD (영수증 결제일, 있으면)",
  "amount": 12345,                            // 정수 원 (영수증 합계, 있으면)
  "category": "부식비|소모품비|폐기물 처리비|수선유지비|공과금|마케팅/광고비|인건비|청소용역비|관리비|임대료|통신/렌탈/보험료|세금/수수료",  // 영수증·재고 모두 적합한 1개
  "notes": "한 줄 요약 (예: '롯데마트 라면+세제 32,500원' 또는 '4층 주방 라면 6봉지')",

  // ↓ kind='inventory' 일 때만 채움 (영수증이어도 단일 품목이면 채워도 OK)
  "itemLabel": "품목명 (예: '신라면', '세탁세제', '두루마리 휴지')",
  "specValue": "300",                         // 용량/규격 숫자 (선택)
  "specUnit":  "ml",                          // 용량 단위 (ml/L/g/kg/장/매 등, 선택)
  "qtyValue":  "6",                           // 개수 (선택)
  "qtyUnit":   "봉지"                          // 개수 단위 (봉지/개/팩/박스 등, 선택)
}

응답은 순수 JSON 만. 마크다운·코드블록 X.`

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
        generationConfig: { temperature: 0.1, maxOutputTokens: 800, responseMimeType: 'application/json' },
      }),
    }
  )
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 120)}`)
  const json = await res.json()
  const text: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  if (!text) throw new Error('AI 응답 비어있음')
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const parsed = JSON.parse(cleaned)
  return {
    kind: ['expense', 'inventory', 'unknown'].includes(parsed.kind) ? parsed.kind : 'unknown',
    vendor: typeof parsed.vendor === 'string' ? parsed.vendor : undefined,
    date: typeof parsed.date === 'string' ? parsed.date : undefined,
    amount: typeof parsed.amount === 'number' ? Math.round(parsed.amount) : undefined,
    category: typeof parsed.category === 'string' ? parsed.category : undefined,
    notes: typeof parsed.notes === 'string' ? parsed.notes : undefined,
    itemLabel: typeof parsed.itemLabel === 'string' ? parsed.itemLabel : undefined,
    specValue: parsed.specValue != null ? String(parsed.specValue) : undefined,
    specUnit:  typeof parsed.specUnit  === 'string' ? parsed.specUnit  : undefined,
    qtyValue:  parsed.qtyValue != null ? String(parsed.qtyValue) : undefined,
    qtyUnit:   typeof parsed.qtyUnit   === 'string' ? parsed.qtyUnit   : undefined,
  }
}

// 사진 업로드 → Drive 보관 + AI 분류 → pending row.
export async function uploadPendingReceipt(formData: FormData): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const userId = await getUserId()
    const propertyId = await getPropertyId()
    const file = formData.get('image') as File
    if (!file || file.size === 0) return { ok: false, error: '파일이 없습니다.' }
    if (!file.type.startsWith('image/')) return { ok: false, error: '이미지만 업로드 가능합니다.' }
    if (file.size > 10 * 1024 * 1024) return { ok: false, error: '파일 크기는 10MB 이하여야 합니다.' }

    const buffer = Buffer.from(await file.arrayBuffer())
    const ext = file.name.split('.').pop() ?? 'jpg'
    const fileName = `pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`

    // 1) Drive 보관 (썸네일 URL 즉시 표시)
    const { fileId, thumbnailUrl } = await uploadToDrive(buffer, fileName, file.type)

    // 2) AI 분류·추출 (실패해도 row 적재는 진행 — 사용자가 수동 처리 가능)
    let inferred: GeminiResult | null = null
    try {
      inferred = await analyzeImage(buffer.toString('base64'), file.type)
    } catch {
      inferred = { kind: 'unknown' }
    }

    // 2.5) 학습된 별칭 적용 — 과거에 사용자가 고쳐 확정한 품목명이 있으면 추론 결과를 선호명으로 치환.
    //      지출 등록 OCR 과 동일 학습 경로(lib/itemNameAlias). 원문은 rawItemLabel 로 보존(승인 시 재학습 판단용).
    if (inferred?.itemLabel) {
      try {
        const alias = await prisma.itemNameAlias.findUnique({
          where: { propertyId_aliasKey: { propertyId, aliasKey: normalizeItemName(inferred.itemLabel) } },
          select: { preferredLabel: true },
        })
        if (alias && alias.preferredLabel !== inferred.itemLabel) {
          ;(inferred as GeminiResult & { rawItemLabel?: string }).rawItemLabel = inferred.itemLabel
          inferred = { ...inferred, itemLabel: alias.preferredLabel }
        }
      } catch { /* 별칭 미적용이어도 업로드는 정상 */ }
    }

    // 3) row 적재
    const row = await prisma.pendingReceipt.create({
      data: {
        propertyId,
        uploaderId: userId,
        imageUrl: thumbnailUrl,
        driveFileId: fileId,
        inferredKind: inferred.kind,
        inferredVendor: inferred.vendor ?? null,
        inferredDate: inferred.date ?? null,
        inferredAmount: inferred.amount ?? null,
        inferredCategory: inferred.category ?? null,
        parsedJson: inferred as unknown as object,
      },
      select: { id: true },
    })
    revalidatePath('/dashboard')
    return { ok: true, id: row.id }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 현재 영업장의 대기 목록 (최신 N건)
export type PendingReceiptRow = {
  id: string
  imageUrl: string
  inferredKind: string | null
  inferredVendor: string | null
  inferredDate: string | null
  inferredAmount: number | null
  inferredCategory: string | null
  notes: string | null
  itemLabel: string | null
  rawItemLabel: string | null   // OCR 원문 품명 — 세트 의심 감지('N개입' 표기) 근거용
  specValue: string | null
  specUnit:  string | null
  qtyValue:  string | null
  qtyUnit:   string | null
  createdAt: Date
}
export async function getPendingReceipts(limit = 20): Promise<PendingReceiptRow[]> {
  try {
    const propertyId = await getPropertyId()
    const rows = await prisma.pendingReceipt.findMany({
      where: { propertyId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
      take: Math.min(50, Math.max(1, limit)),
      select: {
        id: true, imageUrl: true,
        inferredKind: true, inferredVendor: true, inferredDate: true,
        inferredAmount: true, inferredCategory: true, parsedJson: true,
        createdAt: true,
      },
    })
    return rows.map(r => {
      const parsed = (r.parsedJson as { notes?: string; itemLabel?: string; rawItemLabel?: string; specValue?: string; specUnit?: string; qtyValue?: string; qtyUnit?: string } | null) ?? null
      return {
        id: r.id,
        imageUrl: r.imageUrl,
        inferredKind: r.inferredKind,
        inferredVendor: r.inferredVendor,
        inferredDate: r.inferredDate,
        inferredAmount: r.inferredAmount,
        inferredCategory: r.inferredCategory,
        notes: parsed?.notes ?? null,
        itemLabel: parsed?.itemLabel ?? null,
        rawItemLabel: parsed?.rawItemLabel ?? null,
        specValue: parsed?.specValue ?? null,
        specUnit:  parsed?.specUnit  ?? null,
        qtyValue:  parsed?.qtyValue  ?? null,
        qtyUnit:   parsed?.qtyUnit   ?? null,
        createdAt: r.createdAt,
      }
    })
  } catch {
    return []
  }
}

// 세트 상품 의심 확인 — 승인 폼에서 "1세트에 몇 개?" 되묻기 근거(운영자 2026-07-06, 쿠팡 주문서 사례)
export async function checkSetHint(input: {
  label: string; rawLabel?: string; amount: number; qtyValue?: string; specValue?: string
}): Promise<SetHint | null> {
  try {
    const propertyId = await getPropertyId()
    return await computeSetHint(propertyId, input)
  } catch { return null }
}

// 승인 → Expense 등록. final 에 itemLabel·spec·qty 포함되면 그 expense 가 곧 재고 보충 이벤트가 됨
// (재고 모듈이 TRACKED_CATEGORIES + itemLabel 이 있는 expense 를 자동 인식).
export async function approvePendingReceipt(
  id: string,
  final: {
    date: string; amount: number; category: string
    vendor?: string; memo?: string
    // 재고용 — 있으면 inventory 보충으로도 잡힘
    itemLabel?: string
    specValue?: string; specUnit?: string
    specText?: string          // 치수·용도 서술(계산 비관여)
    qtyValue?: string;  qtyUnit?: string
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await getUserId()
    const propertyId = await getPropertyId()
    if (!final.date || final.amount == null || !final.category) {
      return { ok: false, error: '날짜·금액·카테고리는 필수입니다.' }
    }
    const row = await prisma.pendingReceipt.findFirst({
      where: { id, propertyId, status: 'pending' },
      select: { id: true, imageUrl: true, parsedJson: true },
    })
    if (!row) return { ok: false, error: '대기 항목을 찾을 수 없습니다.' }

    // 품명 학습 — AI 추론 원문과 사용자가 고쳐 승인한 최종명이 다르면 별칭 저장.
    // 지출 등록 OCR 학습과 같은 경로(lib/itemNameAlias) — 다음 인식부터 자동 치환. best-effort.
    const parsedForAlias = row.parsedJson as { itemLabel?: string; rawItemLabel?: string } | null
    const inferredLabel = parsedForAlias?.rawItemLabel ?? parsedForAlias?.itemLabel
    if (final.itemLabel && inferredLabel) {
      await captureItemNameAliasPairs(propertyId, [{ raw: inferredLabel, label: final.itemLabel }]).catch(() => {})
    }
    // 재고 카드 자동 생성 — 승인 즉시 재고에 잡히게(신고 269baf9f)
    if (final.itemLabel) await seedTrackedItemsFromExpenses([final.itemLabel]).catch(() => {})

    const exp = await prisma.expense.create({
      data: {
        propertyId,
        date: new Date(final.date),
        amount: final.amount,
        category: final.category,
        vendor: final.vendor ?? null,
        memo: final.memo ?? null,
        payMethod: '계좌이체',
        receiptUrl: row.imageUrl,
        settleStatus: 'SETTLED',
        itemLabel: final.itemLabel || null,
        specUnit:  final.specUnit  || null,
        qtyUnit:   final.qtyUnit   || null,
        specValue: final.specValue ? parseFloat(final.specValue) : null,
        specText:  final.specText?.trim() || null,
        qtyValue:  final.qtyValue  ? parseFloat(final.qtyValue)  : null,
      },
      select: { id: true },
    })
    await prisma.pendingReceipt.update({
      where: { id },
      data: { status: 'approved', reviewedAt: new Date(), linkedExpenseId: exp.id },
    })
    revalidatePath('/dashboard')
    revalidatePath('/finance')
    revalidatePath('/inventory')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function rejectPendingReceipt(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await getUserId()
    const propertyId = await getPropertyId()
    await prisma.pendingReceipt.updateMany({
      where: { id, propertyId, status: 'pending' },
      data: { status: 'rejected', reviewedAt: new Date() },
    })
    revalidatePath('/dashboard')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}
