'use server'

import type { DashboardData } from './DashboardClient'

export async function analyzeDashboardWithGemini(
  data: DashboardData,
  targetMonth: string
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.')

  const paymentRate = (data.paidCount + data.unpaidCount) > 0
    ? Math.round((data.paidCount / (data.paidCount + data.unpaidCount)) * 100)
    : 0
  const occupancyRate = data.totalRooms > 0
    ? Math.round((data.occupiedRooms / data.totalRooms) * 100)
    : 0

  const trendText = data.trend.map(t =>
    `  ${t.month}: 수입 ${(t.revenue / 10000).toFixed(0)}만원 / 지출 ${(t.expense / 10000).toFixed(0)}만원 / 순수익 ${(t.profit / 10000).toFixed(0)}만원`
  ).join('\n')

  const categoryText = data.categoryBreakdown.length > 0
    ? data.categoryBreakdown.map(c =>
        `  ${c.category}: ${(c.amount / 10000).toFixed(0)}만원 (${c.percent}%)`
      ).join('\n')
    : '  지출 없음'

  const prompt = `
당신은 부동산 임대업 전문 재무 분석가입니다.
아래는 숙박업소(원룸/게스트하우스) 운영 현황 데이터입니다. 한국어로 간결하고 실용적인 재무 분석을 작성해주세요.

[분석 대상 월: ${targetMonth}]

■ 이달 재무 요약
- 총 수입: ${(data.totalRevenue / 10000).toFixed(1)}만원 (순수 이용료 ${(data.paidRevenue / 10000).toFixed(1)}만원)
- 총 지출: ${(data.totalExpense / 10000).toFixed(1)}만원
- 순수익: ${(data.netProfit / 10000).toFixed(1)}만원
- 보유 보증금: ${(data.totalDeposit / 10000).toFixed(0)}만원

■ 수납 현황
- 완납: ${data.paidCount}건 / 미납: ${data.unpaidCount}건 (수납률 ${paymentRate}%)

■ 지출 카테고리
${categoryText}

■ 6개월 트렌드
${trendText}

■ 입주 현황
- 전체 호실: ${data.totalRooms}실 / 입주중: ${data.occupiedRooms}실 / 공실: ${data.vacantRooms}실 (입주율 ${occupancyRate}%)
- 거주중: ${data.statusCounts.active}명 / 입실예정: ${data.statusCounts.reserved}명 / 퇴실예정: ${data.statusCounts.checkout}명

아래 항목을 포함해 분석해주세요:
1. 이달 재무 상태 총평 (수익성, 지출 적정성)
2. 수납 현황 진단 (미납 리스크)
3. 트렌드 기반 주목할 변화
4. 공실/입주율 관련 운영 리스크
5. 개선 포인트 1~2가지 (구체적이고 실행 가능한 제안)

분석 결과는 항목별 소제목을 사용하되, 각 항목을 2~3문장으로 간결하게 작성해주세요.
`.trim()

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
      }),
    }
  )

  if (!res.ok) throw new Error(`Gemini API 오류: ${res.status}`)
  const json = await res.json()
  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? '분석 결과를 가져올 수 없습니다.'
}
