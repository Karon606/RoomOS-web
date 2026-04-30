export const runtime = 'edge'

import { generateText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'

export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return Response.json({ error: 'GEMINI_API_KEY 미설정' }, { status: 500 })

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

  const prompt = `부동산 임대업 재무 분석가입니다. ${targetMonth} 데이터를 분석하세요.

수입 ${(data.totalRevenue / 10000).toFixed(0)}만원 / 지출 ${(data.totalExpense / 10000).toFixed(0)}만원 / 순수익 ${(data.netProfit / 10000).toFixed(0)}만원
수납률 ${paymentRate}% (완납 ${data.paidCount}건, 미납 ${data.unpaidCount}건, 미납액 ${(data.unpaidAmount / 10000).toFixed(0)}만원)
입주율 ${occupancyRate}% (${data.occupiedRooms}/${data.totalRooms}실)
주요 지출: ${topCategories || '없음'}
최근 3개월 추이: ${recentTrend || '데이터 없음'}

마크다운 기호(#, **, *, - 등) 절대 사용 금지. 일반 텍스트로만 작성.
아래 3가지를 각 2문장 이내로, 번호와 제목 포함하여 간결하게 작성하세요:

1. 이달 재무 총평
2. 수납 현황 진단
3. 핵심 개선 포인트`.trim()

  const google = createGoogleGenerativeAI({ apiKey })

  const { text } = await generateText({
    model: google('gemini-2.5-flash'),
    prompt,
    maxOutputTokens: 400,
    temperature: 0.4,
  })

  return Response.json({ text })
}
