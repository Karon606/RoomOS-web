'use server'

import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

async function getPropertyId() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const cookieStore = await cookies()
  const propertyId = cookieStore.get('selected_property_id')?.value
  if (!propertyId) redirect('/property-select')
  return propertyId
}

export type ElementType =
  | 'room' | 'corridor' | 'kitchen' | 'bathroom' | 'stairs'
  | 'entrance' | 'emergency_exit' | 'window' | 'label'

export type FloorPlanElement = {
  id: string
  type: ElementType
  x: number
  y: number
  width: number
  height: number
  rotation: number
  label: string
  roomNo?: string
  fill?: string
  points?: number[]  // flat [x1,y1,x2,y2,...] relative to (x,y). Present → polygon shape.
}

export type FloorData = {
  id: string
  label: string
  elements: FloorPlanElement[]
  canvasWidth: number
  canvasHeight: number
}

export type FloorPlanData = {
  floors: FloorData[]
}

function _genId() { return Math.random().toString(36).slice(2, 10) }

function migrateToMultiFloor(raw: any): FloorPlanData {
  if (!raw) {
    return { floors: [{ id: _genId(), label: '1층', elements: [], canvasWidth: 800, canvasHeight: 600 }] }
  }
  if (Array.isArray(raw?.floors)) return raw as FloorPlanData
  // Legacy format: { elements, canvasWidth, canvasHeight }
  return {
    floors: [{
      id: _genId(),
      label: '1층',
      elements: (raw.elements ?? []) as FloorPlanElement[],
      canvasWidth: raw.canvasWidth ?? 800,
      canvasHeight: raw.canvasHeight ?? 600,
    }],
  }
}

export async function getFloorPlan(): Promise<FloorPlanData | null> {
  const propertyId = await getPropertyId()
  const prop = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { floorPlanData: true },
  })
  if (!prop?.floorPlanData) return null
  return migrateToMultiFloor(prop.floorPlanData)
}

export async function saveFloorPlan(data: FloorPlanData): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const propertyId = await getPropertyId()
    await prisma.property.update({
      where: { id: propertyId },
      data: { floorPlanData: data as object },
    })
    revalidatePath('/dashboard')
    revalidatePath('/floor-plan')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function parseFloorPlanImage(
  base64: string,
  mimeType: string,
  canvasWidth: number,
  canvasHeight: number,
): Promise<{ ok: true; elements: FloorPlanElement[] } | { ok: false; error: string }> {
  try {
    await getPropertyId()
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return { ok: false, error: 'GEMINI_API_KEY가 설정되지 않았습니다.' }

    const prompt = `이것은 건물 평면도(floor plan) 이미지입니다. 이미지에서 방, 복도, 계단, 주방, 화장실, 출입구 등 모든 공간 요소를 감지하여 JSON 배열로만 응답하세요. 다른 설명, 마크다운, 코드블록 없이 순수 JSON만 출력하세요.

각 요소 스키마:
{
  "type": "room"|"corridor"|"kitchen"|"bathroom"|"stairs"|"entrance"|"emergency_exit"|"window"|"label",
  "label": "표시할 이름 (예: 101호, 복도, 계단실, 주방)",
  "roomNo": "호실 번호 (type이 room이고 번호가 보일 때만, 예: '101')",
  "points": [[x1,y1],[x2,y2],...]
}

좌표 규칙:
- points는 각 공간의 실제 경계를 나타내는 다각형 꼭짓점 (최소 3개)
- 직사각형 공간은 4개, 비정형 공간은 더 많이
- 좌표는 이미지 전체 크기 기준 0.0~1.0 사이 소수 (소수점 3자리), 좌상단=(0,0), 우하단=(1,1)
- 평면도가 아닌 이미지면: [] 반환`

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType || 'image/jpeg', data: base64 } },
          ]}],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 32768,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  type: { type: 'STRING' },
                  label: { type: 'STRING' },
                  roomNo: { type: 'STRING' },
                  points: { type: 'ARRAY', items: { type: 'ARRAY', items: { type: 'NUMBER' } } },
                },
                required: ['type', 'points'],
              },
            },
          },
        }),
      }
    )

    if (!res.ok) {
      const errTxt = await res.text()
      return { ok: false, error: `Gemini API 오류 (${res.status}): ${errTxt.slice(0, 200)}` }
    }
    const json = await res.json()
    const text: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    if (!text) return { ok: false, error: 'AI 응답이 비어있습니다.' }

    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    let parsed: any[]
    try {
      const j = JSON.parse(cleaned)
      if (Array.isArray(j)) {
        parsed = j
      } else if (j && typeof j === 'object') {
        // Gemini sometimes wraps the array: { elements: [...] } or { rooms: [...] }
        const arrVal = Object.values(j).find(v => Array.isArray(v))
        if (arrVal) { parsed = arrVal as any[] }
        else return { ok: false, error: `AI 응답 형식 오류 (키: ${Object.keys(j).join(', ')})` }
      } else {
        return { ok: false, error: 'AI 응답을 해석할 수 없습니다.' }
      }
    } catch {
      // Try to find a JSON array anywhere in the raw text
      const m = cleaned.match(/\[[\s\S]*\]/)
      let recovered: any[] | null = null
      if (m) {
        try { recovered = JSON.parse(m[0]) } catch { /* fall through */ }
      }
      // Try JSON Lines format: Gemini sometimes emits one object per line instead of an array
      if (!recovered) {
        const objs: any[] = []
        for (const line of cleaned.split(/\n/)) {
          const t = line.trim()
          if (!t.startsWith('{')) continue
          try { objs.push(JSON.parse(t)) } catch { /* skip malformed lines */ }
        }
        if (objs.length > 0) recovered = objs
      }
      // Salvage partial array: truncate after last complete element boundary
      if (!recovered) {
        const s = cleaned.trim()
        if (s.startsWith('[')) {
          const lastBoundary = Math.max(s.lastIndexOf('},'), s.lastIndexOf('}]'))
          if (lastBoundary > 0) {
            try { recovered = JSON.parse(s.slice(0, lastBoundary + 1) + ']') } catch { /* give up */ }
          }
        }
      }
      if (!recovered) return { ok: false, error: `JSON 파싱 실패 — 응답: ${cleaned.slice(0, 120)}` }
      parsed = recovered
    }

    const validTypes = new Set<string>(['room','corridor','kitchen','bathroom','stairs','entrance','emergency_exit','window','label'])

    const elements: FloorPlanElement[] = parsed
      .filter((el: any) => validTypes.has(el?.type) && Array.isArray(el?.points) && el.points.length >= 3)
      .map((el: any) => {
        const pts: [number, number][] = el.points.map((p: any) => [
          Math.max(0, Math.min(1, Number(Array.isArray(p) ? p[0] : (p.x ?? 0)))),
          Math.max(0, Math.min(1, Number(Array.isArray(p) ? p[1] : (p.y ?? 0)))),
        ])
        const scaledXs = pts.map(p => p[0] * canvasWidth)
        const scaledYs = pts.map(p => p[1] * canvasHeight)
        const minX = Math.min(...scaledXs), maxX = Math.max(...scaledXs)
        const minY = Math.min(...scaledYs), maxY = Math.max(...scaledYs)
        const flatPoints = pts.flatMap(p => [
          Math.round(p[0] * canvasWidth - minX),
          Math.round(p[1] * canvasHeight - minY),
        ])
        return {
          id: _genId(),
          type: el.type as ElementType,
          x: Math.round(minX),
          y: Math.round(minY),
          width: Math.max(20, Math.round(maxX - minX)),
          height: Math.max(20, Math.round(maxY - minY)),
          rotation: 0,
          label: String(el.label ?? '').trim() || el.type,
          roomNo: el.roomNo ? String(el.roomNo).trim() : undefined,
          points: flatPoints,
        } satisfies FloorPlanElement
      })

    return { ok: true, elements }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
