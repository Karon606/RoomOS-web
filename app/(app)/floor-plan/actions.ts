'use server'

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

async function getPropertyId() {
  const { propertyId } = await requirePropertyAccess()
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
  showOnDashboard?: boolean
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

export async function setFloorPlanDashboardVisibility(show: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const propertyId = await getPropertyId()
    const prop = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { floorPlanData: true },
    })
    const current = migrateToMultiFloor(prop?.floorPlanData ?? null)
    await prisma.property.update({
      where: { id: propertyId },
      data: { floorPlanData: { ...current, showOnDashboard: show } as object },
    })
    revalidatePath('/dashboard')
    revalidatePath('/floor-plan')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
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

// 잘린 JSON 텍스트에서 완성된 JSON 객체만 추출 (괄호 카운팅)
function extractCompleteObjects(text: string): any[] {
  const objs: any[] = []
  let i = 0
  while (i < text.length) {
    const start = text.indexOf('{', i)
    if (start === -1) break
    let depth = 0
    let inStr = false
    let esc = false
    let j = start
    for (; j < text.length; j++) {
      const c = text[j]
      if (esc) { esc = false; continue }
      if (c === '\\' && inStr) { esc = true; continue }
      if (c === '"') { inStr = !inStr; continue }
      if (!inStr) {
        if (c === '{') depth++
        else if (c === '}') {
          if (--depth === 0) {
            try { objs.push(JSON.parse(text.slice(start, j + 1))) } catch { /* malformed */ }
            break
          }
        }
      }
    }
    if (depth > 0) break // 잘린 객체 — 이후 복구 불가
    i = j + 1
  }
  return objs
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

    const prompt = `이것은 건물 평면도(floor plan) 이미지입니다. 이미지에 보이는 각 공간 구역을 인식하여 JSON 배열로 응답하세요.

규칙:
- 하나의 연속된 공간은 반드시 하나의 요소로만 출력 (절대 쪼개지 말 것)
- 공간 유형(type)은 이미지 안에 적힌 텍스트 레이블 또는 공간의 구조적 기능으로 판단
  · 여러 방을 연결하는 통로 → "corridor"
  · 계단 형태 → "stairs"
  · 출입문 위치 → "entrance"
  · 이미지에 텍스트가 있으면 그 텍스트를 우선
  · 판단 불가능한 일반 공간 → "room"
- label은 이미지 안의 텍스트 그대로 사용, 없으면 type명의 한국어(방/복도/계단실/출입구/주방/화장실)

각 요소 스키마:
{
  "type": "room"|"corridor"|"kitchen"|"bathroom"|"stairs"|"entrance"|"emergency_exit"|"window"|"label",
  "label": "공간 이름",
  "roomNo": "호실 번호 (있을 때만)",
  "points": [[x1,y1],[x2,y2],...]
}

좌표:
- 공간의 실제 외곽선 꼭짓점, L자·ㄷ자 등 비직사각형은 꺾이는 모든 점 포함
- 이미지 전체 기준 0.0~1.0 소수 (소수점 3자리), 좌상단=(0,0), 우하단=(1,1)
- 평면도가 아닌 이미지면: [] 반환`

    const reqBody = JSON.stringify({
      contents: [{ parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType || 'image/jpeg', data: base64 } },
      ]}],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 65536,
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
    })
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`
    const fetchOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: reqBody }

    let res = await fetch(geminiUrl, fetchOpts)
    // 503/429는 일시적 과부하 — 3초 후 1회 재시도
    if (res.status === 503 || res.status === 429) {
      await new Promise(r => setTimeout(r, 3000))
      res = await fetch(geminiUrl, fetchOpts)
    }

    if (!res.ok) {
      const errTxt = await res.text()
      const hint = res.status === 503 ? ' (서버 과부하 — 잠시 후 다시 시도해 주세요)' : ''
      return { ok: false, error: `Gemini API 오류 (${res.status})${hint}: ${errTxt.slice(0, 200)}` }
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
            try { recovered = JSON.parse(s.slice(0, lastBoundary + 1) + ']') } catch { /* fall through */ }
          }
        }
      }
      // 괄호 카운팅으로 완성된 객체 개별 추출 (첫 요소가 잘린 경우에도 동작)
      if (!recovered) {
        const objs = extractCompleteObjects(cleaned)
        if (objs.length > 0) recovered = objs
      }
      if (!recovered) return { ok: false, error: `JSON 파싱 실패 (${cleaned.length}자) — 응답: ${cleaned.slice(0, 120)}` }
      parsed = recovered
    }

    const validTypes = new Set<string>(['room','corridor','kitchen','bathroom','stairs','entrance','emergency_exit','window','label'])
    const defaultLabel: Record<string, string> = {
      room: '방', corridor: '복도', kitchen: '주방', bathroom: '화장실',
      stairs: '계단실', entrance: '출입구', emergency_exit: '비상구', window: '창문',
    }
    // Gemini가 영어 type명을 label로 그대로 내보낼 때 한국어로 교체
    const englishTypeNames = new Set(['room','corridor','kitchen','bathroom','stairs','entrance','emergency_exit','window','label'])

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
          label: (() => {
            const raw = String(el.label ?? '').trim()
            // 영어 type명 그대로 나온 경우 or 비어있는 경우 → 한국어 기본값
            if (!raw || englishTypeNames.has(raw.toLowerCase())) return defaultLabel[el.type] ?? el.type
            return raw
          })(),
          roomNo: el.roomNo ? String(el.roomNo).trim() : undefined,
          points: flatPoints,
        } satisfies FloorPlanElement
      })

    return { ok: true, elements }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
