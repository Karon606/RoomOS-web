'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Stage, Layer, Rect, Text, Group, Transformer, Line } from 'react-konva'
import { type FloorPlanData, type FloorPlanElement, type ElementType, saveFloorPlan } from './actions'
import { pushToast } from '@/lib/saveStatus'

// ── 상수 ─────────────────────────────────────────────────────
const GRID = 20
const SNAP_D = 8   // snap 발동 거리 (canvas px)

const ELEMENT_DEFAULTS: Record<ElementType, { label: string; width: number; height: number; fill: string; stroke: string }> = {
  room:           { label: '방',    width: 80,  height: 80,  fill: '#f5f1ea', stroke: '#4d3e2e' },
  corridor:       { label: '복도',  width: 200, height: 50,  fill: '#ebe1cf', stroke: '#7a6a55' },
  kitchen:        { label: '주방',  width: 100, height: 80,  fill: '#fff3e0', stroke: '#b85944' },
  bathroom:       { label: '화장실', width: 60, height: 70,  fill: '#e3f2fd', stroke: '#4d8fac' },
  stairs:         { label: '계단',  width: 70,  height: 80,  fill: '#f3e5f5', stroke: '#7b3f9e' },
  entrance:       { label: '출입문', width: 50,  height: 20, fill: '#1a1a1a', stroke: '#1a1a1a' },
  emergency_exit: { label: '비상구', width: 40,  height: 20, fill: '#e84a1a', stroke: '#c83a10' },
  window:         { label: '창문',  width: 60,  height: 12,  fill: '#b3d9f7', stroke: '#4d8fac' },
  label:          { label: '텍스트', width: 80,  height: 30, fill: 'transparent', stroke: 'transparent' },
}

const PALETTE: ElementType[] = [
  'room', 'corridor', 'kitchen', 'bathroom', 'stairs',
  'entrance', 'emergency_exit', 'window', 'label',
]

const TYPE_LABEL: Record<ElementType, string> = {
  room: '방', corridor: '복도', kitchen: '주방', bathroom: '화장실',
  stairs: '계단', entrance: '출입문', emergency_exit: '비상구', window: '창문', label: '텍스트',
}

function genId() { return Math.random().toString(36).slice(2, 10) }

// ── 스냅 ─────────────────────────────────────────────────────
function applySnap(
  x: number, y: number, w: number, h: number,
  others: FloorPlanElement[],
): { x: number; y: number } {
  // x 스냅 후보 (el.left 기준)
  const xCandidates: number[] = [
    Math.round(x / GRID) * GRID,          // left → 그리드
    Math.round((x + w) / GRID) * GRID - w, // right → 그리드
  ]
  for (const o of others) {
    xCandidates.push(o.x, o.x + o.width, o.x - w, o.x + o.width - w)
  }

  // y 스냅 후보 (el.top 기준)
  const yCandidates: number[] = [
    Math.round(y / GRID) * GRID,
    Math.round((y + h) / GRID) * GRID - h,
  ]
  for (const o of others) {
    yCandidates.push(o.y, o.y + o.height, o.y - h, o.y + o.height - h)
  }

  let rx = x, bestDX = SNAP_D
  for (const cx of xCandidates) {
    const d = Math.abs(cx - x)
    if (d < bestDX) { bestDX = d; rx = cx }
  }

  let ry = y, bestDY = SNAP_D
  for (const cy of yCandidates) {
    const d = Math.abs(cy - y)
    if (d < bestDY) { bestDY = d; ry = cy }
  }

  return { x: rx, y: ry }
}

// ── 그리드 ───────────────────────────────────────────────────
function GridLines({ width, height }: { width: number; height: number }) {
  const lines: React.ReactNode[] = []
  for (let y = 0; y <= height; y += GRID)
    lines.push(<Line key={`h${y}`} points={[0, y, width, y]} stroke="#d0c8bc" strokeWidth={0.4} dash={[2, 4]} listening={false} />)
  for (let x = 0; x <= width; x += GRID)
    lines.push(<Line key={`v${x}`} points={[x, 0, x, height]} stroke="#d0c8bc" strokeWidth={0.4} dash={[2, 4]} listening={false} />)
  return <>{lines}</>
}

// ── 개별 요소 ────────────────────────────────────────────────
function PlanElement({
  el, isSelected, editMode, roomStatus,
  onElementClick, onDragStart, onDragMove, onDragEnd,
  registerRef, allElements,
}: {
  el: FloorPlanElement
  isSelected: boolean
  editMode: boolean
  roomStatus?: { isVacant: boolean; tenantName?: string }
  onElementClick: (id: string, shiftKey: boolean) => void
  onDragStart: (id: string) => void
  onDragMove: (id: string, x: number, y: number) => void
  onDragEnd: (id: string, x: number, y: number) => void
  registerRef: (id: string, node: any) => void
  allElements: FloorPlanElement[]
}) {
  const groupRef = useRef<any>(null)
  const def = ELEMENT_DEFAULTS[el.type]
  const fill = el.fill ?? def.fill
  const bgFill =
    el.type === 'room' && roomStatus != null
      ? roomStatus.isVacant ? '#f0fdf4' : '#fff7ed'
      : fill

  useEffect(() => {
    registerRef(el.id, groupRef.current)
    return () => registerRef(el.id, null)
  }, [el.id, registerRef])

  const handleDragMove = (e: any) => {
    const node = e.target
    const others = allElements.filter(o => o.id !== el.id)
    const snapped = applySnap(node.x(), node.y(), el.width, el.height, others)
    node.x(snapped.x)
    node.y(snapped.y)
    onDragMove(el.id, snapped.x, snapped.y)
  }

  const textColor = (el.type === 'entrance' || el.type === 'emergency_exit') ? '#fff' : '#2a1f15'

  return (
    <Group
      ref={groupRef}
      x={el.x} y={el.y}
      width={el.width} height={el.height}
      rotation={el.rotation}
      draggable={editMode}
      onClick={(e: any) => { if (editMode) onElementClick(el.id, e.evt.shiftKey) }}
      onTap={() => { if (editMode) onElementClick(el.id, false) }}
      onDragStart={() => onDragStart(el.id)}
      onDragMove={handleDragMove}
      onDragEnd={(e: any) => onDragEnd(el.id, Math.round(e.target.x()), Math.round(e.target.y()))}
    >
      <Rect
        width={el.width} height={el.height}
        fill={bgFill}
        stroke={isSelected ? '#e84a1a' : def.stroke}
        strokeWidth={isSelected ? 2 : 1}
        cornerRadius={el.type === 'room' ? 4 : 2}
        shadowEnabled={isSelected}
        shadowColor="rgba(232,74,26,0.3)"
        shadowBlur={8}
      />
      <Text
        text={el.label}
        width={el.width} height={el.height}
        align="center" verticalAlign="middle"
        fontSize={el.type === 'room' ? 11 : 10}
        fontFamily="Pretendard Variable, Pretendard, sans-serif"
        fill={textColor}
        wrap="word" padding={2}
      />
      {el.type === 'room' && roomStatus && (
        <Text
          text={roomStatus.isVacant ? '공실' : (roomStatus.tenantName ?? '입실')}
          width={el.width} y={el.height - 18}
          align="center" fontSize={8}
          fill={roomStatus.isVacant ? '#047857' : '#b85944'}
        />
      )}
    </Group>
  )
}

// ── 속성 패널 ────────────────────────────────────────────────
function PropertiesPanel({
  el, rooms, onChange, onDelete,
}: {
  el: FloorPlanElement
  rooms: { id: string; roomNo: string }[]
  onChange: (patch: Partial<FloorPlanElement>) => void
  onDelete: () => void
}) {
  const inputCls = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]'
  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-[var(--warm-dark)]">{TYPE_LABEL[el.type]}</p>
        <button onClick={onDelete} className="text-[10px] text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 transition-colors">삭제</button>
      </div>

      <div className="space-y-1">
        <p className="text-[10px] text-[var(--warm-muted)]">표시 이름</p>
        <input className={inputCls} value={el.label} onChange={e => onChange({ label: e.target.value })} />
      </div>

      {el.type === 'room' && (
        <div className="space-y-1">
          <p className="text-[10px] text-[var(--warm-muted)]">연결 호실</p>
          <select className={inputCls} value={el.roomNo ?? ''} onChange={e => onChange({ roomNo: e.target.value || undefined })}>
            <option value="">연결 없음</option>
            {rooms.map(r => <option key={r.id} value={r.roomNo}>{r.roomNo}호</option>)}
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-1.5">
        <div className="space-y-1">
          <p className="text-[10px] text-[var(--warm-muted)]">너비 px</p>
          <input type="number" className={inputCls} value={el.width}
            onChange={e => onChange({ width: Number(e.target.value) })}
            onBlur={e => { if (Number(e.target.value) < 1) onChange({ width: 20 }) }} />
        </div>
        <div className="space-y-1">
          <p className="text-[10px] text-[var(--warm-muted)]">높이 px</p>
          <input type="number" className={inputCls} value={el.height}
            onChange={e => onChange({ height: Number(e.target.value) })}
            onBlur={e => { if (Number(e.target.value) < 1) onChange({ height: 20 }) }} />
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-[10px] text-[var(--warm-muted)]">회전 (°)</p>
        <input type="number" className={inputCls} value={el.rotation}
          onChange={e => onChange({ rotation: Number(e.target.value) })} />
      </div>

      {el.type !== 'label' && (
        <div className="space-y-1">
          <p className="text-[10px] text-[var(--warm-muted)]">배경색</p>
          <div className="flex items-center gap-2">
            <input type="color" value={el.fill ?? ELEMENT_DEFAULTS[el.type].fill}
              onChange={e => onChange({ fill: e.target.value })}
              className="w-8 h-7 rounded cursor-pointer border border-[var(--warm-border)]" />
            <button onClick={() => onChange({ fill: undefined })} className="text-[10px] text-[var(--warm-muted)] hover:text-[var(--warm-dark)]">초기화</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 메인 에디터 ──────────────────────────────────────────────
export default function FloorPlanEditor({
  initialData, rooms, roomStatuses, viewOnly = false,
}: {
  initialData: FloorPlanData | null
  rooms: { id: string; roomNo: string }[]
  roomStatuses: Record<string, { isVacant: boolean; tenantName?: string }>
  viewOnly?: boolean
}) {
  const DEFAULT_W = 800, DEFAULT_H = 600

  const [mounted, setMounted]       = useState(false)
  const [elements, setElements]     = useState<FloorPlanElement[]>(initialData?.elements ?? [])
  const [canvasWidth]               = useState(initialData?.canvasWidth  ?? DEFAULT_W)
  const [canvasHeight]              = useState(initialData?.canvasHeight ?? DEFAULT_H)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [editMode, setEditMode]     = useState(!viewOnly)
  const [saving, setSaving]         = useState(false)
  const [showGrid, setShowGrid]     = useState(true)
  const [selBox, setSelBox]         = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  const containerRef   = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  // Konva 노드 ref 맵 (id → Konva.Group)
  const nodeRefs       = useRef<Map<string, any>>(new Map())
  const trRef          = useRef<any>(null)
  const selectedIdsRef = useRef<string[]>([])

  // 드래그 관련 ref
  const dragStartPositions = useRef<Map<string, { x: number; y: number }>>(new Map())
  const draggingGroup      = useRef<string[]>([])

  // 드래그 선택 관련 ref
  const selStartRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => { setMounted(true) }, [])
  useEffect(() => { selectedIdsRef.current = selectedIds }, [selectedIds])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / canvasWidth)))
    obs.observe(el)
    return () => obs.disconnect()
  }, [canvasWidth])

  // Transformer → 선택된 노드들 연결
  useEffect(() => {
    if (!trRef.current || !mounted) return
    const nodes = selectedIds.map(id => nodeRefs.current.get(id)).filter(Boolean)
    trRef.current.nodes(nodes)
    trRef.current.getLayer()?.batchDraw()
  }, [selectedIds, mounted])

  // Delete 키로 선택 요소 삭제
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIdsRef.current.length > 0) {
        setElements(prev => prev.filter(el => !selectedIdsRef.current.includes(el.id)))
        setSelectedIds([])
      }
      if (e.key === 'Escape') setSelectedIds([])
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // ── ref 등록 ─────────────────────────────────────────────
  const registerRef = useCallback((id: string, node: any) => {
    if (node) nodeRefs.current.set(id, node)
    else nodeRefs.current.delete(id)
  }, [])

  // ── 요소 클릭 (단일/shift 다중) ──────────────────────────
  const handleElementClick = useCallback((id: string, shiftKey: boolean) => {
    if (shiftKey) {
      setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id])
    } else {
      setSelectedIds([id])
    }
  }, [])

  // ── 드래그 시작 ──────────────────────────────────────────
  const handleDragStart = useCallback((id: string) => {
    const ids = selectedIdsRef.current.includes(id) ? selectedIdsRef.current : [id]
    draggingGroup.current = ids
    dragStartPositions.current.clear()
    ids.forEach(sid => {
      const node = nodeRefs.current.get(sid)
      if (node) dragStartPositions.current.set(sid, { x: node.x(), y: node.y() })
    })
    if (!selectedIdsRef.current.includes(id)) setSelectedIds([id])
  }, [])

  // ── 드래그 중 (snap 적용된 좌표 받음) ────────────────────
  const handleDragMove = useCallback((id: string, nx: number, ny: number) => {
    const start = dragStartPositions.current.get(id)
    if (!start) return
    const dx = nx - start.x, dy = ny - start.y
    draggingGroup.current.forEach(sid => {
      if (sid === id) return
      const node = nodeRefs.current.get(sid)
      const s = dragStartPositions.current.get(sid)
      if (node && s) { node.x(s.x + dx); node.y(s.y + dy) }
    })
  }, [])

  // ── 드래그 종료 ──────────────────────────────────────────
  const handleDragEnd = useCallback((id: string, nx: number, ny: number) => {
    const start = dragStartPositions.current.get(id)
    const dx = start ? nx - start.x : 0
    const dy = start ? ny - start.y : 0
    const ids = draggingGroup.current
    setElements(prev => prev.map(el => {
      if (!ids.includes(el.id)) return el
      if (el.id === id) return { ...el, x: nx, y: ny }
      const s = dragStartPositions.current.get(el.id)
      return s ? { ...el, x: Math.round(s.x + dx), y: Math.round(s.y + dy) } : el
    }))
    dragStartPositions.current.clear()
    draggingGroup.current = []
  }, [])

  // ── Transform 종료 ───────────────────────────────────────
  const handleTransformEnd = useCallback(() => {
    setElements(prev => prev.map(el => {
      if (!selectedIdsRef.current.includes(el.id)) return el
      const node = nodeRefs.current.get(el.id)
      if (!node) return el
      const scaleX = node.scaleX(), scaleY = node.scaleY()
      node.scaleX(1); node.scaleY(1)
      return {
        ...el,
        x: Math.round(node.x()),
        y: Math.round(node.y()),
        width:    Math.round(Math.max(20, el.width  * scaleX)),
        height:   Math.round(Math.max(20, el.height * scaleY)),
        rotation: Math.round(node.rotation()),
      }
    }))
  }, [])

  // ── 요소 추가 ────────────────────────────────────────────
  const addElement = (type: ElementType) => {
    const def = ELEMENT_DEFAULTS[type]
    const el: FloorPlanElement = {
      id: genId(), type,
      x: Math.round((60 + Math.random() * 80) / GRID) * GRID,
      y: Math.round((60 + Math.random() * 80) / GRID) * GRID,
      width: def.width, height: def.height, rotation: 0, label: def.label,
    }
    setElements(prev => [...prev, el])
    setSelectedIds([el.id])
  }

  const updateElement = useCallback((id: string, patch: Partial<FloorPlanElement>) => {
    setElements(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e))
  }, [])

  const deleteSelected = () => {
    setElements(prev => prev.filter(e => !selectedIds.includes(e.id)))
    setSelectedIds([])
  }

  // ── 저장 ─────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true)
    const res = await saveFloorPlan({ elements, canvasWidth, canvasHeight })
    setSaving(false)
    if (res.ok) pushToast('success', '도면 저장됨')
    else pushToast('error', res.error)
  }

  // ── 드래그 선택 (Stage 빈 영역) ──────────────────────────
  const getCanvasPos = (stage: any) => {
    const pos = stage.getPointerPosition()
    return pos ? { x: pos.x / scale, y: pos.y / scale } : null
  }

  const handleStageMouseDown = (e: any) => {
    if (!editMode || e.target !== e.target.getStage()) return
    const pos = getCanvasPos(e.target.getStage())
    if (!pos) return
    selStartRef.current = pos
    setSelBox({ x: pos.x, y: pos.y, w: 0, h: 0 })
    setSelectedIds([])
  }

  const handleStageMouseMove = (e: any) => {
    if (!selStartRef.current) return
    const pos = getCanvasPos(e.target.getStage())
    if (!pos) return
    const { x: sx, y: sy } = selStartRef.current
    setSelBox({
      x: Math.min(sx, pos.x), y: Math.min(sy, pos.y),
      w: Math.abs(pos.x - sx), h: Math.abs(pos.y - sy),
    })
  }

  const handleStageMouseUp = () => {
    if (!selStartRef.current) return
    if (selBox && (selBox.w > 4 || selBox.h > 4)) {
      const { x, y, w, h } = selBox
      const hit = elements
        .filter(el => el.x < x + w && el.x + el.width > x && el.y < y + h && el.y + el.height > y)
        .map(el => el.id)
      setSelectedIds(hit)
    }
    selStartRef.current = null
    setSelBox(null)
  }

  // ── 속성 패널 표시 대상 ───────────────────────────────────
  const singleSelected = selectedIds.length === 1
    ? elements.find(e => e.id === selectedIds[0]) ?? null
    : null

  const btnBase = 'px-2.5 py-1.5 text-xs rounded-lg border transition-colors shrink-0'
  const btnIdle = `${btnBase} bg-[var(--canvas)] border-[var(--warm-border)] text-[var(--warm-dark)] hover:border-[var(--coral)]`

  return (
    <div className="flex flex-col h-full">
      {/* ── 툴바 ── */}
      {!viewOnly && (
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[var(--warm-border)] shrink-0 overflow-x-auto"
          style={{ background: 'var(--cream)' }}>
          <button
            onClick={() => { setEditMode(v => !v); setSelectedIds([]) }}
            className={`${btnBase} font-medium ${editMode
              ? 'bg-[var(--coral)] border-[var(--coral)] text-white'
              : 'bg-[var(--canvas)] border-[var(--warm-border)] text-[var(--warm-mid)]'}`}>
            {editMode ? '편집 중' : '편집'}
          </button>

          {editMode && (
            <>
              <div className="w-px h-4 bg-[var(--warm-border)] mx-0.5" />
              <span className="text-[10px] text-[var(--warm-muted)] shrink-0">+ 추가:</span>
              {PALETTE.map(type => (
                <button key={type} onClick={() => addElement(type)} className={btnIdle}>
                  {TYPE_LABEL[type]}
                </button>
              ))}
              {selectedIds.length > 0 && (
                <>
                  <div className="w-px h-4 bg-[var(--warm-border)] mx-0.5" />
                  <button onClick={deleteSelected}
                    className={`${btnBase} bg-red-50 border-red-200 text-red-500 hover:bg-red-100`}>
                    삭제 ({selectedIds.length})
                  </button>
                </>
              )}
              <div className="w-px h-4 bg-[var(--warm-border)] mx-0.5" />
            </>
          )}

          <label className="flex items-center gap-1 text-xs text-[var(--warm-mid)] cursor-pointer shrink-0 ml-auto">
            <input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} className="accent-[var(--coral)]" />
            그리드
          </label>

          <button onClick={handleSave} disabled={saving}
            className={`${btnBase} font-medium bg-[var(--ink)] border-[var(--ink)] text-[var(--canvas)] hover:opacity-80 disabled:opacity-50`}>
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      )}

      {/* ── 본문 ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* 캔버스 */}
        <div ref={containerRef} className="flex-1 overflow-auto" style={{ background: 'var(--cream-2, #f0ebe0)' }}>
          {mounted && (
            <div style={{ width: canvasWidth * scale, height: canvasHeight * scale }}>
              <Stage
                width={canvasWidth * scale} height={canvasHeight * scale}
                scaleX={scale} scaleY={scale}
                onMouseDown={handleStageMouseDown}
                onMouseMove={handleStageMouseMove}
                onMouseUp={handleStageMouseUp}
                onTouchEnd={() => { selStartRef.current = null; setSelBox(null) }}
              >
                <Layer>
                  <Rect width={canvasWidth} height={canvasHeight} fill="#faf6ef" listening={false} />
                  {showGrid && <GridLines width={canvasWidth} height={canvasHeight} />}

                  {elements.map(el => (
                    <PlanElement
                      key={el.id}
                      el={el}
                      isSelected={selectedIds.includes(el.id)}
                      editMode={editMode}
                      roomStatus={el.roomNo ? roomStatuses[el.roomNo] : undefined}
                      onElementClick={handleElementClick}
                      onDragStart={handleDragStart}
                      onDragMove={handleDragMove}
                      onDragEnd={handleDragEnd}
                      registerRef={registerRef}
                      allElements={elements}
                    />
                  ))}

                  {/* 단일 Transformer — 선택된 모든 노드 관리 */}
                  <Transformer
                    ref={trRef}
                    rotateEnabled
                    onTransformEnd={handleTransformEnd}
                    boundBoxFunc={(_: any, newBox: any) => ({
                      ...newBox,
                      width:  Math.max(20, newBox.width),
                      height: Math.max(20, newBox.height),
                    })}
                  />

                  {/* 드래그 선택 박스 */}
                  {selBox && selBox.w > 0 && (
                    <Rect
                      x={selBox.x} y={selBox.y} width={selBox.w} height={selBox.h}
                      fill="rgba(74,144,232,0.08)"
                      stroke="#4a90e8" strokeWidth={1}
                      dash={[4, 3]} listening={false}
                    />
                  )}
                </Layer>
              </Stage>
            </div>
          )}
        </div>

        {/* 속성 패널 — 단일 선택 시만 */}
        {editMode && singleSelected && (
          <div className="w-48 shrink-0 border-l border-[var(--warm-border)] overflow-y-auto"
            style={{ background: 'var(--cream)' }}>
            <PropertiesPanel
              el={singleSelected}
              rooms={rooms}
              onChange={patch => updateElement(singleSelected.id, patch)}
              onDelete={() => { deleteSelected() }}
            />
          </div>
        )}

        {/* 다중 선택 패널 */}
        {editMode && selectedIds.length > 1 && (
          <div className="w-48 shrink-0 border-l border-[var(--warm-border)] p-3"
            style={{ background: 'var(--cream)' }}>
            <p className="text-[11px] font-semibold text-[var(--warm-dark)] mb-2">{selectedIds.length}개 선택됨</p>
            <p className="text-[10px] text-[var(--warm-muted)] mb-3">핸들로 함께 이동·크기 변경·회전</p>
            <button onClick={deleteSelected}
              className="w-full text-xs text-red-500 border border-red-200 bg-red-50 hover:bg-red-100 rounded-lg py-1.5 transition-colors">
              선택 삭제
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
