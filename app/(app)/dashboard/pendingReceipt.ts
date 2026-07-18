'use server'

// "찍어 올리고 분류는 AI 가" 패러다임의 백엔드.
// 1) 사용자가 사진 업로드 → Drive 보관 + Gemini 분석(영수증/재고 등 분류 + 핵심 필드 추출)
// 2) PendingReceipt row 적재 (status='pending')
// 3) 대시보드에서 사용자가 검토 → 승인(Expense 등록) 또는 거절

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { requireEdit } from '@/lib/role'
import { consumeGeminiAccess } from '@/lib/geminiKey'
import { captureItemNameAliasPairs, normalizeItemName } from '@/lib/itemNameAlias'
import { computeSetHint, type SetHint } from '@/lib/setHint'
import { getExpenseCategories } from '@/app/(app)/settings/actions'
import { seedTrackedItemsFromExpenses } from '@/app/(app)/inventory/actions'
import prisma from '@/lib/prisma'
import { buildReceiptOcrPrompt, fetchGeminiOcr, parseReceiptOcrText, type ReceiptOcrItem, type ReceiptOcrResult } from '@/lib/receiptOcr'
import { uploadToDrive, downloadDriveBytes } from '@/lib/google-drive'
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

// Gemini 분류·추출 결과. 지출 등록의 정밀 OCR(lib/receiptOcr)과 동일 스키마 + kind 분류.
// items[] 전체를 보존해 딥링크 지출 폼이 재-OCR 없이 프리필. inferred* 요약은 items[0] 기준.
type GeminiResult = {
  kind: 'expense' | 'inventory' | 'unknown'
  vendor?: string
  date?: string
  amount?: number
  category?: string
  notes?: string
  // 재고용 요약 필드 (items[0] 기준)
  itemLabel?: string
  rawItemLabel?: string   // 별칭 적용 전 원문 — 승인 시 재학습 판단용
  specValue?: string
  specUnit?: string
  qtyValue?: string
  qtyUnit?: string
  orderNo?: string
  items?: ReceiptOcrItem[]        // 정밀 라인아이템 — 딥링크 폼 프리필용
  _meta?: { mime?: string }       // 원본 업로드 mime (재-OCR·다운로드 시 실제 값 사용)
  _error?: string                 // 인식 실패 사유 (사용자용 한 줄) — 카드가 '인식 실패' 표시
}

async function analyzeImage(imageBase64: string, mimeType: string): Promise<GeminiResult> {
  const ai = await consumeGeminiAccess()
  if (!ai.ok) throw new Error(ai.error)
  const apiKey = ai.apiKey

  // 카테고리 후보는 영업장 설정에서(커스텀 카테고리 지원, 멀티테넌트). 보증금 반환은 사진 분류 대상이 아니라 제외.
  const catList = (await getExpenseCategories()).filter(c => c !== '보증금 반환').join('|')

  // 지출 등록과 동일한 정밀 프롬프트 + kind 분류(withKind). maxOutputTokens 도 동일 수준(1500). 호출은 1회.
  const prompt = buildReceiptOcrPrompt({ categories: catList, withKind: true })
  const fetched = await fetchGeminiOcr({ apiKey, imageBase64, mimeType, prompt, maxOutputTokens: 1500 })
  if (!fetched.ok) throw new Error(`Gemini ${fetched.status}: ${fetched.errorText}`)
  const parsedRes = parseReceiptOcrText(fetched.text, { withKind: true })
  if (!parsedRes.ok) throw new Error(parsedRes.error)
  const d = parsedRes.data
  const first = d.items[0]
  return {
    kind: d.kind ?? (d.items.length > 0 ? 'expense' : 'unknown'),
    vendor: d.vendor,
    date: d.date,
    amount: d.totalAmount != null ? Math.round(d.totalAmount) : undefined,
    category: d.category,
    notes: d.notes,
    itemLabel: first?.label,
    specValue: first?.specValue,
    specUnit:  first?.specUnit,
    qtyValue:  first?.qtyValue,
    qtyUnit:   first?.qtyUnit,
    orderNo: d.orderNo,
    items: d.items,
  }
}

// 학습된 별칭 적용 — itemLabel(요약)·items[0] 를 선호명으로 치환하고 원문 보존(다음 인식부터 자동 치환).
// 지출 등록 OCR 과 동일 학습 경로(lib/itemNameAlias). best-effort.
async function applyLearnedItemAlias(propertyId: string, inferred: GeminiResult): Promise<GeminiResult> {
  if (!inferred.itemLabel) return inferred
  try {
    const alias = await prisma.itemNameAlias.findUnique({
      where: { propertyId_aliasKey: { propertyId, aliasKey: normalizeItemName(inferred.itemLabel) } },
      select: { preferredLabel: true },
    })
    if (alias && alias.preferredLabel !== inferred.itemLabel) {
      const raw = inferred.itemLabel
      const items = inferred.items?.map((it, i) =>
        i === 0 ? { ...it, rawLabel: it.rawLabel ?? it.label, label: alias.preferredLabel } : it)
      return { ...inferred, rawItemLabel: raw, itemLabel: alias.preferredLabel, items }
    }
  } catch { /* 별칭 미적용이어도 진행 */ }
  return inferred
}

// 사진 업로드 → Drive 보관 + AI 분류 → pending row.
export async function uploadPendingReceipt(formData: FormData): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    await requireEdit()   // 권한 비대칭 보강(2026-07-19 패널 검증) — 같은 파일 retry·finalize와 동일 기준
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

    // 2) AI 분류·추출 (실패해도 row 적재는 진행 — 사용자가 수동 처리 가능).
    //    실패를 삼키지 말고 _error 로 남겨 카드가 '인식 실패'를 보이고 [다시 인식]을 띄우게 한다.
    let inferred: GeminiResult
    try {
      inferred = await analyzeImage(buffer.toString('base64'), file.type)
    } catch {
      inferred = { kind: 'unknown', _error: '영수증을 자동 인식하지 못했습니다. 다시 인식하거나 직접 입력해 주세요.' }
    }
    inferred._meta = { mime: file.type }   // 실제 업로드 mime — HEIC/PNG 재-OCR·다운로드 시 사용

    // 2.5) 학습된 별칭 적용 — 과거에 사용자가 고쳐 확정한 품목명이 있으면 추론 결과를 선호명으로 치환.
    inferred = await applyLearnedItemAlias(propertyId, inferred)

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
  specText:  string | null   // 서술형 규격(색상·사이즈 등) — 재고 등록 인라인 프리필용
  qtyValue:  string | null
  qtyUnit:   string | null
  errorMsg:  string | null   // AI 인식 실패 사유(있으면 카드가 '인식 실패' + [다시 인식])
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
      const parsed = (r.parsedJson as { notes?: string; itemLabel?: string; rawItemLabel?: string; specValue?: string; specUnit?: string; qtyValue?: string; qtyUnit?: string; _error?: string; items?: { specText?: string }[] } | null) ?? null
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
        specText:  parsed?.items?.[0]?.specText ?? null,
        qtyValue:  parsed?.qtyValue  ?? null,
        qtyUnit:   parsed?.qtyUnit   ?? null,
        errorMsg:  parsed?._error    ?? null,
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
    await requireEdit()   // 권한 비대칭 보강(2026-07-19 패널 검증) — 승인 = 지출 생성이라 편집 권한 필수
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

    // ⚠️ 상태 전이를 조건부로 '선점'한 뒤 지출을 만든다.
    //   종전엔 위 findFirst 로 pending 을 확인하고 그 뒤에 expense.create 를 해서, 동시 요청 2건이
    //   모두 검사를 통과한 뒤 지출을 2건 만들 수 있었다(TOCTOU). 그 달 지출이 이중 계상된다.
    //   조건부 updateMany 가 행 잠금을 잡아 직렬화하므로 뒤늦은 요청은 count 0 으로 걸러진다.
    //   같은 파일 finalizePendingReceipt 가 이미 쓰는 문법('중복 등록 방어')과 통일 — 승인만 빠져 있었다.
    //   한 트랜잭션이라 지출 생성이 실패하면 상태 전이도 함께 롤백된다('승인됐는데 지출 없음' 방지).
    const exp = await prisma.$transaction(async tx => {
      const claim = await tx.pendingReceipt.updateMany({
        where: { id, propertyId, status: 'pending' },
        data: { status: 'approved', reviewedAt: new Date() },
      })
      if (claim.count === 0) return null   // 다른 요청이 이미 선점 — 아무것도 만들지 않는다
      const e = await tx.expense.create({
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
      await tx.pendingReceipt.update({ where: { id }, data: { linkedExpenseId: e.id } })
      return e
    })
    if (!exp) return { ok: false, error: '이미 처리된 영수증입니다.' }
    revalidatePath('/dashboard')
    revalidatePath('/finance')
    revalidatePath('/inventory')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 홈 큐 영수증을 지출 등록 폼의 정식 OCR로 넘기기 위한 원본 이미지(오류신고 bb7b7cb4).
// 영업장 스코프 + 편집 권한 필수 — 누락 시 타 영업장 영수증 열람 경로가 됨(영향검증 필수1).
// ocr: 업로드 시 저장된 정밀 인식 결과 — 딥링크 지출 폼이 재-OCR 없이 프리필(호출 1회 절약).
//      items 가 비면(구 데이터·인식 실패) 클라이언트가 기존 재-OCR 폴백을 쓴다.
export async function getPendingReceiptImage(id: string): Promise<{ ok: true; base64: string; mime: string; imageUrl: string; ocr: ReceiptOcrResult; ocrError: string | null } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const row = await prisma.pendingReceipt.findFirst({
      where: { id, propertyId, status: 'pending' },
      select: { driveFileId: true, imageUrl: true, parsedJson: true },
    })
    if (!row?.driveFileId) return { ok: false, error: '대기 항목을 찾을 수 없습니다.' }
    const parsed = (row.parsedJson as GeminiResult | null) ?? null
    const mime = parsed?._meta?.mime ?? 'image/jpeg'
    const buf = await downloadDriveBytes(row.driveFileId)
    const ocr: ReceiptOcrResult = {
      date: parsed?.date,
      vendor: parsed?.vendor,
      totalAmount: parsed?.amount,
      category: parsed?.category,
      orderNo: parsed?.orderNo,
      items: parsed?.items ?? [],
    }
    return { ok: true, base64: buf.toString('base64'), mime, imageUrl: row.imageUrl, ocr, ocrError: parsed?._error ?? null }
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? '이미지를 불러오지 못했습니다.' }
  }
}

// 저장된 이미지로 AI 인식 재실행 후 row 갱신 — 카드 [다시 인식] 버튼(사용자 명시 클릭이라 호출 1회 허용).
// 편집 권한 + 영업장 스코프 필수(타 영업장 영수증 조작 차단).
export async function retryPendingReceiptAnalyze(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const row = await prisma.pendingReceipt.findFirst({
      where: { id, propertyId, status: 'pending' },
      select: { driveFileId: true, parsedJson: true },
    })
    if (!row?.driveFileId) return { ok: false, error: '대기 항목을 찾을 수 없습니다.' }
    const mime = (row.parsedJson as GeminiResult | null)?._meta?.mime ?? 'image/jpeg'
    const buf = await downloadDriveBytes(row.driveFileId)
    let inferred: GeminiResult
    try {
      inferred = await analyzeImage(buf.toString('base64'), mime)
    } catch {
      return { ok: false, error: '다시 인식하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
    }
    inferred._meta = { mime }
    inferred = await applyLearnedItemAlias(propertyId, inferred)
    await prisma.pendingReceipt.update({
      where: { id },
      data: {
        inferredKind: inferred.kind,
        inferredVendor: inferred.vendor ?? null,
        inferredDate: inferred.date ?? null,
        inferredAmount: inferred.amount ?? null,
        inferredCategory: inferred.category ?? null,
        parsedJson: inferred as unknown as object,
      },
    })
    revalidatePath('/dashboard')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? '오류가 발생했습니다.' }
  }
}

// 지출 등록 폼 저장 성공 후 대기 항목 마감 — status 조건부 updateMany(중복 등록 방어, 영향검증 필수2)
export async function finalizePendingReceipt(id: string): Promise<{ ok: boolean }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const r = await prisma.pendingReceipt.updateMany({
      where: { id, propertyId, status: 'pending' },
      data: { status: 'approved', reviewedAt: new Date() },
    })
    revalidatePath('/dashboard')
    return { ok: r.count > 0 }
  } catch { return { ok: false } }
}

export async function rejectPendingReceipt(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()   // 권한 비대칭 보강(2026-07-19 패널 검증)
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
