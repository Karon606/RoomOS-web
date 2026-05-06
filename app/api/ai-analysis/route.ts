export const runtime = 'edge'

import { streamText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'

export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return new Response('GEMINI_API_KEY 미설정', { status: 500 })

  const body = await req.json() as {
    data: {
      totalRevenue: number; paidRevenue: number
      totalExpense: number; netProfit: number; totalDeposit: number
      paidCount: number; unpaidCount: number; upcomingCount?: number
      unpaidAmount: number; overdueAmount?: number; upcomingAmount?: number
      totalRooms: number; occupiedRooms: number; vacantRooms: number
      statusCounts: { active: number; reserved: number; checkout: number }
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

  const paymentRate = (data.paidCount + data.unpaidCount) > 0
    ? Math.round((data.paidCount / (data.paidCount + data.unpaidCount)) * 100)
    : 0
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
수납률 ${paymentRate}% (완납 ${data.paidCount}건, 미납 ${data.unpaidCount}건)
누적 미납(회수 지연): ${(overdueAmount / 10000).toFixed(0)}만원 (${data.unpaidCount}건)
납부 예정(미도래·정상): ${(upcomingAmount / 10000).toFixed(0)}만원 (${upcomingCount}건)
입주율 ${occupancyRate}% (${data.occupiedRooms}/${data.totalRooms}실)
주요 지출: ${topCategories || '없음'}
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
