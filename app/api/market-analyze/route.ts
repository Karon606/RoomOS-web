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

    const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']

    let geminiRes: Response | null = null
    let usedModel = models[0]

    for (const model of models) {
      usedModel = model
      // 2.5 모델만 thinking 비활성화 지원 — TPM 절감 목적
      const generationConfig: Record<string, unknown> = {
        temperature: 0.7,
        maxOutputTokens: 2000,
      }
      if (model.startsWith('gemini-2.5')) {
        generationConfig.thinkingConfig = { thinkingBudget: 0 }
      }
      const requestBody = JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig,
      })
      geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: requestBody },
      )
      if (geminiRes.ok) break
      // 일시적 장애(503) 또는 분당 한도(429)면 다음 모델로 폴백
      if (geminiRes.status !== 503 && geminiRes.status !== 429) break
    }

    if (!geminiRes!.ok) {
      const errText = await geminiRes!.text()
      let friendlyMsg: string
      try {
        const errJson = JSON.parse(errText) as { error?: { message?: string; status?: string } }
        const status = geminiRes!.status
        const apiMsg = errJson.error?.message ?? ''
        if (status === 503) {
          friendlyMsg = 'AI 서버가 일시적으로 과부하 상태입니다. 잠시 후 다시 시도해주세요.'
        } else if (status === 429) {
          // RPD(일일) vs RPM(분당) 구분 — message에 'per day' 포함이면 일일 한도
          if (/per day|daily|RPD/i.test(apiMsg)) {
            friendlyMsg = 'Gemini 무료 티어 일일 한도에 도달했습니다. 자정(PT) 이후 다시 시도해주세요.'
          } else {
            friendlyMsg = 'AI 요청 한도에 도달했습니다. 1분 후 다시 시도해주세요. (Gemini 무료 티어는 분당 약 10회 제한)'
          }
        } else if (status === 400) {
          friendlyMsg = `요청 형식 오류: ${apiMsg || '알 수 없는 오류'}`
        } else {
          friendlyMsg = apiMsg || `AI 분석 오류 (${status})`
        }
      } catch {
        friendlyMsg = `AI 분석 오류 (${geminiRes!.status})`
      }
      return NextResponse.json({ error: friendlyMsg }, { status: 502 })
    }

    const geminiJson = await geminiRes!.json()
    const text: string = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text ?? 'AI 분석 결과를 가져올 수 없습니다.'

    return NextResponse.json({ result: text, model: usedModel })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message ?? '오류가 발생했습니다.' }, { status: 500 })
  }
}
