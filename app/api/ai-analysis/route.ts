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
      paidCount: number; unpaidCount: number; unpaidAmount: number
      totalRooms: number; occupiedRooms: number; vacantRooms: number
      statusCounts: { active: number; reserved: number; checkout: number }
      categoryBreakdown: { category: string; amount: number; percent: number }[]
      trend: { month: string; revenue: number; expense: number; profit: number }[]
    }
    targetMonth: string
  }
  const { data, targetMonth } = body

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
    model: google('gemini-2.0-flash'),
    system: '당신은 한국 임대업 재무 분석가입니다. 반드시 순수 한국어 일반 텍스트로만 답변하세요. #, ##, ###, **, *, -, ` 등 마크다운 기호를 절대로 사용하지 마세요.',
    prompt: `${targetMonth} 운영 데이터:
수입 ${(data.totalRevenue / 10000).toFixed(0)}만원, 지출 ${(data.totalExpense / 10000).toFixed(0)}만원, 순수익 ${(data.netProfit / 10000).toFixed(0)}만원
수납률 ${paymentRate}% (완납 ${data.paidCount}건, 미납 ${data.unpaidCount}건, 미납액 ${(data.unpaidAmount / 10000).toFixed(0)}만원)
입주율 ${occupancyRate}% (${data.occupiedRooms}/${data.totalRooms}실)
주요 지출: ${topCategories || '없음'}
최근 추이: ${recentTrend || '데이터 없음'}

다음 3가지를 각 2문장 이내로 작성하세요. 번호와 제목만 사용하고 마크다운 기호 금지:

1. 이달 재무 총평
2. 수납 현황 진단
3. 핵심 개선 포인트`,
    maxTokens: 700,
    temperature: 0.4,
    abortSignal: req.signal,
  })

  return result.toTextStreamResponse()
}
