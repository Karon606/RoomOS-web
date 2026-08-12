export const runtime = 'edge'

import { streamText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: Request) {
  // 인증 게이트 — 로그인 사용자만. 외부의 무단 호출로 유료 API(Gemini) 비용이 소진되는 것 방지.
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getClaims()
  if (!auth?.claims) return new Response('Unauthorized', { status: 401 })

  // edge 런타임 — DB(카운터) 접근 불가라 공용 키 직접 사용(월 10회 카운트 제외, 저빈도)
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return new Response('GEMINI_API_KEY 미설정', { status: 500 })

  const body = await req.json() as {
    data: {
      totalRevenue: number; paidRevenue: number
      totalExpense: number; netProfit: number; totalDeposit: number
      paidCount: number; unpaidCount: number; upcomingCount?: number
      awaitingCount?: number; paymentRate?: number
      unpaidAmount: number; overdueAmount?: number; upcomingAmount?: number
      totalRooms: number; occupiedRooms: number; vacantRooms: number
      statusCounts: { active: number; reserved: number; checkout: number }
      // amount·percent 는 예상 지출 축이다(기록분 + 미기록 고정 지출 예정분, 홈 도넛과 같은 값).
      categoryBreakdown: { category: string; amount: number; percent: number }[]
      trend: { month: string; revenue: number; expense: number; profit: number }[]
    }
    targetMonth: string
  }
  const { data, targetMonth } = body

  // 도래·미회수와 미도래·미회수 분리 — overdueAmount가 진짜 회수 지연 채권
  const overdueAmount = data.overdueAmount ?? data.unpaidAmount
  const upcomingAmount = data.upcomingAmount ?? 0
  const upcomingCount = data.upcomingCount ?? 0

  // 수납률은 서버 정본(dashboard/page.tsx paymentRate)이 보낸 값만 쓴다. 여기서 다시 나누던 시절엔
  // 분모에 수납예정이 빠져 화면 도넛이 61% 인 달에 프롬프트가 100% 라고 적었다(2026-08).
  // 안 실려 오면 0 으로 때우지 않고 그 줄을 통째로 안 적는다 — 0% 는 없는 값이 아니라 틀린 값이다.
  const paymentLine = data.paymentRate == null
    ? `완납 ${data.paidCount}건, 미납 ${data.unpaidCount}건`
    : `수납률 ${data.paymentRate}% (완납 ${data.paidCount}건, 수납예정 ${data.awaitingCount ?? 0}건, 미납 ${data.unpaidCount}건)`
  const occupancyRate = data.totalRooms > 0
    ? Math.round((data.occupiedRooms / data.totalRooms) * 100)
    : 0

  const topCategories = data.categoryBreakdown.slice(0, 3)
    .map(c => `${c.category} ${(c.amount / 10000).toFixed(0)}만원(${c.percent}%)`)
    .join(', ')

  const recentTrend = data.trend.slice(-3)
    .map(t => `${t.month} 순수익 ${(t.profit / 10000).toFixed(0)}만원`)
    .join(' / ')

  const google = createGoogleGenerativeAI({ apiKey })

  const result = streamText({
    model: google('gemini-2.5-flash'),
    providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
    system: `당신은 한국 임대업 재무 분석가입니다. 반드시 순수 한국어 일반 텍스트로만 답변하세요. #, ##, ###, **, *, -, \` 등 마크다운 기호를 절대로 사용하지 마세요.

이 시스템은 발생주의(accrual basis) 회계를 사용하며 미수령 금액을 두 분류로 구분합니다:
- 누적 미납(overdue): dueDay가 이미 도래했는데 받지 못한 회수 지연 채권. 운영 리스크.
- 납부 예정(upcoming): dueDay가 아직 도래하지 않은 정상 청구분. 곧 들어올 정상 매출.

분석 시 두 항목을 절대 합쳐 부르지 말고, '회수 지연'은 누적 미납만을 의미하도록 작성하세요.`,
    prompt: `${targetMonth} 운영 데이터 (발생주의 기준):
매출 ${(data.totalRevenue / 10000).toFixed(0)}만원, 지출 ${(data.totalExpense / 10000).toFixed(0)}만원, 순이익 ${(data.netProfit / 10000).toFixed(0)}만원
${paymentLine}
누적 미납(회수 지연): ${(overdueAmount / 10000).toFixed(0)}만원 (${data.unpaidCount}건)
납부 예정(미도래·정상): ${(upcomingAmount / 10000).toFixed(0)}만원 (${upcomingCount}건)
입주율 ${occupancyRate}% (${data.occupiedRooms}/${data.totalRooms}실)
주요 지출 (예상 지출 기준): ${topCategories || '없음'}
최근 3개월 추이: ${recentTrend || '데이터 없음'}

다음 3가지를 각 2문장 이내로 작성하세요. 번호와 제목만 사용하고 마크다운 기호 금지. '미수금'이라는 단어를 쓸 때는 반드시 누적 미납(회수 지연) 금액만 가리키며, 납부 예정과 합쳐 부르지 마세요:

1. 이달 재무 총평
2. 수납 현황 진단 (누적 미납과 납부 예정을 구분해 분석)
3. 핵심 개선 포인트`,
    maxOutputTokens: 700,
    temperature: 0.7,
  })

  return new Response(result.textStream.pipeThrough(new TextEncoderStream()), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
