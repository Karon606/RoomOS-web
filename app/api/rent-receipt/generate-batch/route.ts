// 입실료 납부 확인서 여러 달 묶음 발급 API — 관문·요청 읽기만 하고 본체는 issueRentReceiptBatch(정본)가 한다.
//
// 왜 묶음인가(신고 2026-10-19). "최근 3개월치를 달라"는 요청에 한 장씩 왕복했고, 그사이 발행일을 손으로 소급하다
// 입금보다 앞선 날짜가 찍혔다(423호 8월분). 영수증 한 장 = 한 귀속월은 그대로 두고(스키마 무변경), 달마다 한 장을 한 번에 낸다.
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { requireEdit } from '@/lib/role'
import { issueRentReceiptBatch, type RentReceiptBatchBody } from '@/app/rent-receipt/[tenantId]/issueBatch'

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  // 함수 시간 상한(maxDuration 60초)보다 앞선 마감 — 본체가 트랜잭션 시간 제한을 여기에 맞춘다.
  const deadlineAt = Date.now() + 55_000
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: '인증이 필요합니다.' }, { status: 401 })
    const cookieStore = await cookies()
    const propertyId = cookieStore.get('selected_property_id')?.value
    if (!propertyId) return NextResponse.json({ ok: false, error: '영업장이 선택되지 않았습니다.' }, { status: 400 })
    await requireEdit()

    const body = (await req.json()) as RentReceiptBatchBody
    const res = await issueRentReceiptBatch(propertyId, body, deadlineAt)
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: res.status })
    return NextResponse.json(res)
  } catch (err) {
    console.error('[/api/rent-receipt/generate-batch] failed:', err)
    const msg = (err as Error)?.message
    return NextResponse.json(
      { ok: false, error: msg && /[가-힣]/.test(msg) ? msg : '여러 달 발급에 실패했습니다.' },
      { status: 500 },
    )
  }
}
