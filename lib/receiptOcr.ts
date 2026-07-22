// 영수증 정밀 OCR 공유 헬퍼 — 프롬프트 생성·Gemini 호출·응답 파싱·타입(홈 찍어올리기 / 지출등록 공유)
// 'use server' 아님. 서버 전용(fetch·apiKey 사용) 순수 헬퍼 — 서버 액션에서 호출한다.

import type { SetHint } from '@/lib/setHint'
import { normalizeBizNo } from '@/lib/bizNo'

// 영수증 한 줄 품목. specText 는 색상·사이즈 등 서술형 규격(계산 비관여, 숫자 규격 specValue/specUnit 과 별개).
export type ReceiptOcrItem = {
  label: string
  rawLabel?: string   // 별칭 적용 전 원문(사용자 수정 학습 캡처용) — 호출부에서 채움
  specValue?: string; specUnit?: string
  specText?: string   // 서술형 규격(예: '싱글/그레이', '1200x600mm'). 없으면 undefined
  qtyValue?: string;  qtyUnit?: string
  amount: number
  setHint?: SetHint   // 세트 상품 의심(주문 1=실물 N) — 호출부에서 채움
}
export type ReceiptOcrResult = {
  date?: string         // YYYY-MM-DD
  vendor?: string
  vendorBizNo?: string  // 구매처 사업자등록번호(000-00-00000) — 안 보이면 undefined
  totalAmount?: number
  items: ReceiptOcrItem[]
  category?: string     // AI 추천 카테고리 (보수적)
  orderNo?: string      // 쇼핑몰 주문번호(쿠팡 등) — 보이면 추출
  kind?: 'expense' | 'inventory' | 'unknown'   // 홈 격상 경로에서만 요청(withKind)
  notes?: string        // 한 줄 요약 — 홈 카드 표시용(withKind)
}

// 정밀 OCR 프롬프트 생성. withKind 면 분류(kind)·요약(notes) 필드를 함께 요청(홈 격상 경로).
export function buildReceiptOcrPrompt(opts: { categories: string; vocabBlock?: string; withKind?: boolean }): string {
  const { categories, vocabBlock = '', withKind = false } = opts
  const intro = withKind
    ? `이 사진을 분석하세요. 먼저 사진이 무엇인지 분류(kind)하고, 영수증·주문서·물품이면 아래 정밀 스키마로 품목까지 읽어 다음 JSON 스키마로만 응답하세요. 다른 설명, 마크다운, 코드 블록 없이 순수 JSON만 출력:`
    : `이 영수증 이미지를 분석해 다음 JSON 스키마로만 응답하세요. 다른 설명, 마크다운, 코드 블록 없이 순수 JSON만 출력:`
  const kindLines = withKind
    ? `  "kind": "expense" | "inventory" | "unknown",   // expense=영수증/계산서/결제내역, inventory=재고·물품 사진(라면/세제/소모품 등), unknown=둘 다 아님
  "notes": "한 줄 요약",          // 예: '롯데마트 라면+세제 32,500원' 또는 '4층 주방 라면 6봉지'
`
    : ''
  // items 비우기 규칙 — 일반 경로는 '영수증 아니면 빈 배열'. 홈 격상(withKind)은 물품 사진도 품목을 채워야 하므로 kind별로 안내.
  const emptyRule = withKind
    ? `- kind가 "inventory"(물품 사진)면 보이는 물품을 items에 품목으로 넣으세요(label·용량 specValue/specUnit·개수 qtyValue/qtyUnit, 가격이 안 보이면 amount는 0). date·vendor·totalAmount는 없으면 생략
- kind가 "unknown"이면 items는 빈 배열([])로`
    : `- 영수증으로 보이지 않는 이미지면: { "items": [] } 만 반환`
  return `${intro}

{
${kindLines}  "date": "YYYY-MM-DD",          // 결제일. 안 보이면 생략
  "vendor": "상호명",              // 안 보이면 생략
  "vendorBizNo": "123-45-67890",  // 사업자등록번호(사업자번호·등록번호 표기). 안 보이면 생략
  "totalAmount": 12345,           // 최종 결제 금액 = 부가세 포함 (정수, 원). '합계/총액/결제금액/받을금액/승인금액' 값. '공급가액/과세금액'을 쓰지 말 것
  "orderNo": "1234567890",        // 쇼핑몰 주문번호(쿠팡 등). 영수증/주문서에 '주문번호'가 보이면. 없으면 생략
  "category": "${categories}",  // 가장 적합한 1개. 애매하면 생략
  "items": [
    {
      "label": "품목명",
      "specValue": "300",         // 용량/규격 숫자 (선택)
      "specUnit": "ml",           // 용량 단위 (선택)
      "specText": "싱글/그레이",    // 색상·사이즈·재질 등 서술형 규격(선택). 숫자 단위로 못 적는 규격만. 없으면 생략
      "qtyValue": "2",            // 개수 (선택)
      "qtyUnit": "개",             // 개수 단위 (선택)
      "amount": 5000              // 이 품목 가격 (정수)
    }
  ]
}

규칙:
- totalAmount는 반드시 부가세 포함 최종 결제 금액. 공급가액(과세금액)·부가세가 따로 표시된 영수증이면 그 합(=합계/총액)을 쓰고, 공급가액만 넣지 마세요
- items의 amount도 부가세 포함 가격으로. 품목이 부가세 별도 단가로 표시돼 있으면 부가세를 각 품목에 비례 배분해 포함시키고, items 합계가 totalAmount와 일치하게 하세요
- specText는 색상·사이즈·재질처럼 숫자 단위로 못 적는 서술형 규격만(예: '싱글/그레이', '1200x600mm', 'XL'). 용량·개수 같은 숫자 규격은 specValue/specUnit·qtyValue/qtyUnit에 넣으세요
- vendorBizNo는 숫자 10자리(하이픈 유무 무관 — 000-00-00000 형식으로). 안 보이면 생략
- 부가세/할인/포인트 등 메타 행 자체는 items에 넣지 마세요
- category 선택 시: 가구·집기·공구·가전처럼 여러 해 쓰는 내구재는 소모품·부식 성격 카테고리로 분류하지 마세요(수리·유지·비품 성격 카테고리가 후보에 있으면 그쪽). 세제·휴지·식자재처럼 써서 없어지는 물건만 소모품·부식류입니다
- 한국어 영수증 우선. 가격은 숫자만 (콤마 제거)
${emptyRule}${vocabBlock}`
}

// Gemini Vision 호출. inline mime 은 실제 값 사용(HEIC/PNG 대응). 성공 시 응답 텍스트만 반환.
export async function fetchGeminiOcr(params: {
  apiKey: string
  imageBase64: string
  mimeType: string
  prompt: string
  maxOutputTokens: number
}): Promise<{ ok: true; text: string } | { ok: false; status: number; errorText: string }> {
  const { apiKey, imageBase64, mimeType, prompt, maxOutputTokens } = params
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } },
          ],
        }],
        // thinkingBudget 0 — 2.5-flash는 기본으로 사고 토큰이 maxOutputTokens를 잠식해 JSON이 잘린다
        // (신고 4b1f59e2 재현: 1500 중 사고가 1439 소모, 답변 45토큰에서 절단). noticeSms.ts와 동일 패턴.
        generationConfig: { temperature: 0.1, maxOutputTokens, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },
      }),
    }
  )
  if (!res.ok) return { ok: false, status: res.status, errorText: (await res.text()).slice(0, 200) }
  const json = await res.json()
  const parts: { text?: string }[] = json.candidates?.[0]?.content?.parts ?? []
  const text: string = parts.map(p => p.text ?? '').join('')
  // 길이 제한 절단은 파싱 실패와 다른 문제 — 정확한 안내를 위해 구분(신고 4b1f59e2)
  if (json.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
    console.error('[receiptOcr] MAX_TOKENS 절단', { len: text.length })
    return { ok: false, status: 200, errorText: '인식 결과가 잘렸습니다. 다시 시도하거나 영수증을 나눠 촬영해 주세요.' }
  }
  return { ok: true, text }
}

// 응답 텍스트 → ReceiptOcrResult. items 는 label·spec·specText·qty·amount 만(별칭·setHint 는 호출부에서).
export function parseReceiptOcrText(text: string, opts?: { withKind?: boolean }): { ok: true; data: ReceiptOcrResult } | { ok: false; error: string } {
  if (!text) return { ok: false, error: 'AI 응답이 비어있습니다.' }
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    // 원문은 서버 로그로만 — 사용자 화면에 잘린 JSON 조각을 노출하지 않는다(패널 판정, 신고 4b1f59e2)
    console.error('[receiptOcr] JSON 파싱 실패', { head: cleaned.slice(0, 200) })
    return { ok: false, error: '인식 결과를 읽지 못했습니다. 다시 시도해 주세요.' }
  }
  const rawItems = Array.isArray(parsed.items) ? parsed.items : []
  const items: ReceiptOcrItem[] = rawItems
    .filter((it: Record<string, unknown>) => it && typeof it.label === 'string' && (it.label as string).trim())
    .map((it: Record<string, unknown>) => ({
      label: String(it.label).trim(),
      specValue: it.specValue ? String(it.specValue) : undefined,
      specUnit:  it.specUnit  ? String(it.specUnit)  : undefined,
      specText:  typeof it.specText === 'string' && it.specText.trim() ? it.specText.trim() : undefined,
      qtyValue:  it.qtyValue  ? String(it.qtyValue)  : undefined,
      qtyUnit:   it.qtyUnit   ? String(it.qtyUnit)   : undefined,
      amount:    Number(it.amount) || 0,
    }))
  const kindRaw = parsed.kind
  const kind = opts?.withKind && typeof kindRaw === 'string' && ['expense', 'inventory', 'unknown'].includes(kindRaw)
    ? (kindRaw as 'expense' | 'inventory' | 'unknown')
    : undefined
  return {
    ok: true,
    data: {
      date:        typeof parsed.date === 'string' ? parsed.date : undefined,
      vendor:      typeof parsed.vendor === 'string' ? parsed.vendor : undefined,
      // 인식 표기가 하이픈 유무·자리수 오차가 있어도 저장 포맷(000-00-00000)으로 정규화, 10자리 아니면 버림
      vendorBizNo: normalizeBizNo(typeof parsed.vendorBizNo === 'string' ? parsed.vendorBizNo : null) ?? undefined,
      totalAmount: typeof parsed.totalAmount === 'number' ? parsed.totalAmount : undefined,
      category:    typeof parsed.category === 'string' ? parsed.category : undefined,
      orderNo:     typeof parsed.orderNo === 'string' && parsed.orderNo.trim() ? parsed.orderNo.trim() : undefined,
      notes:       typeof parsed.notes === 'string' && parsed.notes.trim() ? parsed.notes.trim() : undefined,
      kind,
      items,
    },
  }
}
