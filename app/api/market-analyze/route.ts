import { NextRequest, NextResponse } from 'next/server'

type RoomType = { type: string; avgPrice: number; count: number }
type CompetitorPrice = { type: string; price: number; memo?: string }
type Competitor = { name: string; address: string; roomPrices: CompetitorPrice[] }

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'Gemini API 키가 설정되지 않았습니다.' }, { status: 500 })
    }

    const body = await req.json() as {
      property: { name: string; address?: string | null }
      competitors: Competitor[]
      strategy: string
      roomTypes: RoomType[]
    }

    const { property, competitors, strategy, roomTypes } = body

    const roomTypesText = roomTypes.length > 0
      ? roomTypes.map(r => `  - ${r.type}: 평균 ${r.avgPrice.toLocaleString()}원 (${r.count}개 호실)`).join('\n')
      : '  - 방타입 정보 없음'

    const competitorsText = competitors.length > 0
      ? competitors.map((c, i) => {
          const prices = c.roomPrices.length > 0
            ? c.roomPrices.map(p => `    · ${p.type}: ${p.price.toLocaleString()}원${p.memo ? ` (${p.memo})` : ''}`).join('\n')
            : '    · 가격 정보 없음'
          return `${i + 1}. ${c.name} (${c.address})\n${prices}`
        }).join('\n\n')
      : '  - 등록된 경쟁업체 없음'

    const prompt = `당신은 고시원/원룸 숙박업 전문 컨설턴트입니다.

[내 영업장]
이름: ${property.name}
주소: ${property.address ?? '주소 미등록'}
방타입별 현재 단가:
${roomTypesText}

[주변 경쟁업체]
${competitorsText}

[목표 전략]: ${strategy}
- 실속형: 주변보다 저렴하게 공실 최소화
- 시세형: 주변 평균과 비슷하게 안정적 운영
- 프리미엄형: 차별화된 서비스로 주변보다 고가 유지

다음을 분석해주세요:
1. 내 영업장의 강점과 경쟁 포지션 (3-5줄)
2. 경쟁업체 대비 가격 포지셔닝 현황
3. ${strategy} 전략 기준 방타입별 권장 단가 (JSON 형식으로도 포함)
4. 실행 가능한 개선 제안 2-3가지

응답은 한국어로, 실용적이고 구체적으로 해주세요.
JSON 권장 단가는 다음 형식: {"권장단가": [{"type": "방타입", "price": 숫자, "reason": "이유"}]}`

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    )

    if (!geminiRes.ok) {
      const errText = await geminiRes.text()
      return NextResponse.json({ error: `Gemini API 오류: ${geminiRes.status} ${errText}` }, { status: 502 })
    }

    const geminiJson = await geminiRes.json()
    const text: string = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text ?? 'AI 분석 결과를 가져올 수 없습니다.'

    return NextResponse.json({ result: text })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message ?? '오류가 발생했습니다.' }, { status: 500 })
  }
}
