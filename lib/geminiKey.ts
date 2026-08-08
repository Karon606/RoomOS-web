// AI(제미나이) 호출 키·무료 한도 결정 — 서버 전용 모듈.
// 정책(운영자 확정 2026-07-10): 영업장 본인 키(BYOK)가 있으면 그 키로 무제한(본인 한도).
// 없으면 앱 공용 키로 "월 10회 무료 체험"(영수증·계약서·신분증 OCR, 문자 다듬기,
// 대시보드·보고서 재무분석, 배치도 인식 등 모든 AI 호출 통합 카운트). 초과 시 본인 키 등록 안내.

import prisma from '@/lib/prisma'
import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { kstMonthStr } from '@/lib/kstDate'

export const FREE_MONTHLY_AI_LIMIT = 10

export type GeminiAccess =
  | { ok: true; apiKey: string; own: boolean; remaining: number | null }  // remaining: 공용 키일 때 이번 달 잔여(소모 후)
  | { ok: false; error: string }

const QUOTA_ERROR =
  `이번 달 무료 AI 사용량(월 ${FREE_MONTHLY_AI_LIMIT}회)을 모두 사용했습니다. ` +
  `환경설정의 AI 설정에서 본인 API 키를 등록하면 제한 없이 사용할 수 있습니다. ` +
  `키는 aistudio.google.com에서 구독과 무관하게 무료 발급됩니다.`

/** 키 결정 + 공용 키면 월 사용량 1회 소모. 호출 직전에 부른다. */
export async function consumeGeminiAccess(): Promise<GeminiAccess> {
  let propertyId: string | null = null
  try {
    propertyId = (await requirePropertyAccess()).propertyId
  } catch { /* 세션 밖(크론 등) — 공용 키·카운트 없이 */ }

  if (propertyId) {
    // 키는 영업장 소유 관리자(User) 소유 — 같은 관리자의 모든 영업장이 공유, 직원이 실행해도 소유자 키
    const p = await prisma.property.findUnique({ where: { id: propertyId }, select: { owner: { select: { geminiApiKey: true } } } })
    const own = p?.owner?.geminiApiKey?.trim()
    if (own) return { ok: true, apiKey: own, own: true, remaining: null }
  }

  const shared = process.env.GEMINI_API_KEY
  if (!shared) return { ok: false, error: 'AI 기능이 아직 설정되지 않았습니다. 환경설정의 AI 설정에서 본인 API 키를 등록해 주세요.' }
  if (!propertyId) return { ok: true, apiKey: shared, own: false, remaining: null }

  // 월 버킷은 KST 기준 — UTC 로 자르면 매월 1일 KST 00~09 시에 새 달로 일찍 넘어가
  // 그 9시간 동안 한도가 리셋된다(사용 현황을 보여주는 settings/actions 두 자리와 같은 기준이어야 한다).
  const month = kstMonthStr()
  const row = await prisma.aiUsage.upsert({
    where: { propertyId_month: { propertyId, month } },
    create: { propertyId, month, count: 1 },
    update: { count: { increment: 1 } },
    select: { count: true },
  })
  if (row.count > FREE_MONTHLY_AI_LIMIT) return { ok: false, error: QUOTA_ERROR }
  return { ok: true, apiKey: shared, own: false, remaining: FREE_MONTHLY_AI_LIMIT - row.count }
}

/** 이전 호환 — 키만 필요한 자리(카운트 없이). 새 코드는 consumeGeminiAccess를 쓸 것. */
export async function getGeminiApiKey(): Promise<string | null> {
  try {
    const { propertyId } = await requirePropertyAccess()
    const p = await prisma.property.findUnique({ where: { id: propertyId }, select: { owner: { select: { geminiApiKey: true } } } })
    if (p?.owner?.geminiApiKey?.trim()) return p.owner.geminiApiKey.trim()
  } catch { /* 세션 밖에서는 공용 키로 */ }
  return process.env.GEMINI_API_KEY || null
}
