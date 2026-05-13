'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Stage, Layer, Rect, Text, Group, Transformer, Line } from 'react-konva'
import { type FloorPlanData, type FloorPlanElement, type ElementType, saveFloorPlan } from './actions'
import { pushToast } from '@/lib/saveStatus'

// ── 상수 ─────────────────────────────────────────────────────
const GRID = 20
const SNAP_D = 8
const MAX_HISTORY = 50

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

// ── 정렬 아이콘 ──────────────────────────────────────────────
const _i = { viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, width: 16, height: 16 }
function IcoAlignLeft()     { return <svg {..._i}><line x1="4"  y1="3"  x2="4"  y2="17"/><rect x="4"  y="5"  width="7"  height="3.5" rx="0.8" fill="currentColor" stroke="none"/><rect x="4"  y="11.5" width="12" height="3.5" rx="0.8" fill="currentColor" stroke="none"/></svg> }
function IcoAlignRight()    { return <svg {..._i}><line x1="16" y1="3"  x2="16" y2="17"/><rect x="5"  y="5"  width="11" height="3.5" rx="0.8" fill="currentColor" stroke="none"/><rect x="9"  y="11.5" width="7"  height="3.5" rx="0.8" fill="currentColor" stroke="none"/></svg> }
function IcoAlignTop()      { return <svg {..._i}><line x1="3"  y1="4"  x2="17" y2="4" /><rect x="5"  y="4"  width="3.5" height="7"  rx="0.8" fill="currentColor" stroke="none"/><rect x="11.5" y="4" width="3.5" height="12" rx="0.8" fill="currentColor" stroke="none"/></svg> }
function IcoAlignBottom()   { return <svg {..._i}><line x1="3"  y1="16" x2="17" y2="16"/><rect x="5"  y="9"  width="3.5" height="7"  rx="0.8" fill="currentColor" stroke="none"/><rect x="11.5" y="4" width="3.5" height="12" rx="0.8" fill="currentColor" stroke="none"/></svg> }
function IcoAlignCenterH()  { return <svg {..._i}><line x1="10" y1="3"  x2="10" y2="17"/><rect x="3"  y="5"  width="14" height="3.5" rx="0.8" fill="currentColor" stroke="none"/><rect x="5"  y="11.5" width="10" height="3.5" rx="0.8" fill="currentColor" stroke="none"/></svg> }
function IcoAlignCenterV()  { return <svg {..._i}><line x1="3"  y1="10" x2="17" y2="10"/><rect x="5"  y="3"  width="3.5" height="14" rx="0.8" fill="currentColor" stroke="none"/><rect x="11.5" y="5" width="3.5" height="10" rx="0.8" fill="currentColor" stroke="none"/></svg> }
function IcoDistributeH()   { return <svg {..._i}><line x1="3"  y1="3"  x2="3"  y2="17"/><line x1="17" y1="3"  x2="17" y2="17"/><rect x="7.5" y="6" width="5" height="8" rx="0.8" fill="currentColor" stroke="none"/></svg> }
function IcoDistributeV()   { return <svg {..._i}><line x1="3"  y1="3"  x2="17" y2="3" /><line x1="3"  y1="17" x2="17" y2="17"/><rect x="6"  y="7.5" width="8" height="5" rx="0.8" fill="currentColor" stroke="none"/></svg> }

// ── 스냅 ─────────────────────────────────────────────────────
function applySnap(x: number, y: number, w: number, h: number, others: FloorPlanElement[]): { x: number; y: number } {
  const xC: number[] = [Math.round(x / GRID) * GRID, Math.round((x + w) / GRID) * GRID - w]
  const yC: number[] = [Math.round(y / GRID) * GRID, Math.round((y + h) / GRID) * GRID - h]
  for (const o of others) {
    xC.push(o.x, o.x + o.width, o.x - w, o.x + o.width - w)
    yC.push(o.y, o.y + o.height, o.y - h, o.y + o.height - h)
  }
  let rx = x, bx = SNAP_D
  for (const c of xC) { const d = Math.abs(c - x); if (d < bx) { bx = d; rx = c } }
  let ry = y, by = SNAP_D
  for (const c of yC) { const d = Math.abs(c - y); if (d < by) { by = d; ry = c } }
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
  const def      = ELEMENT_DEFAULTS[el.type]
  const fill     = el.fill ?? def.fill
  const bgFill   = el.type === 'room' && roomStatus != null
    ? (roomStatus.isVacant ? '#f0fdf4' : '#fff7ed') : fill

  useEffect(() => {
    registerRef(el.id, groupRef.current)
    return () => registerRef(el.id, null)
  }, [el.id, registerRef])

  const handleDragMove = (e: any) => {
    const node = e.target
    const snapped = applySnap(node.x(), node.y(), el.width, el.height, allElements.filter(o => o.id !== el.id))
    node.x(snapped.x); node.y(snapped.y)
    onDragMove(el.id, snapped.x, snapped.y)
  }

  const textColor = (el.type === 'entrance' || el.type === 'emergency_exit') ? '#fff' : '#2a1f15'

  return (
    <Group
      ref={groupRef}
      x={el.x} y={el.y} width={el.width} height={el.height}
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
        shadowEnabled={isSelected} shadowColor="rgba(232,74,26,0.3)" shadowBlur={8}
      />
      <Text
        text={el.label} width={el.width} height={el.height}
        align="center" verticalAlign="middle"
        fontSize={el.type === 'room' ? 11 : 10}
        fontFamily="Pretendard Variable, Pretendard, sans-serif"
        fill={textColor} wrap="word" padding={2}
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
  el, rooms, onChange, onDelete, onCommit,
}: {
  el: FloorPlanElement
  rooms: { id: string; roomNo: string }[]
  onChange: (patch: Partial<FloorPlanElement>) => void
  onDelete: () => void
  onCommit: () => void   // 입력 blur 시 히스토리 스냅샷 저장
}) {
  const inputCls = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg px-2.5 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]'
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-[var(--warm-dark)]">{TYPE_LABEL[el.type]}</p>
        <button onClick={onDelete} className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 transition-colors">삭제</button>
      </div>

      <div className="space-y-1">
        <p className="text-[11px] text-[var(--warm-muted)]">표시 이름</p>
        <input className={inputCls} value={el.label}
          onChange={e => onChange({ label: e.target.value })}
          onBlur={onCommit} />
      </div>

      {el.type === 'room' && (
        <div className="space-y-1">
          <p className="text-[11px] text-[var(--warm-muted)]">연결 호실</p>
          <select className={inputCls} value={el.roomNo ?? ''}
            onChange={e => { onChange({ roomNo: e.target.value || undefined }); onCommit() }}>
            <option value="">연결 없음</option>
            {rooms.map(r => <option key={r.id} value={r.roomNo}>{r.roomNo}호</option>)}
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <p className="text-[11px] text-[var(--warm-muted)]">너비 px</p>
          <input type="number" className={inputCls} value={el.width}
            onChange={e => onChange({ width: Number(e.target.value) })}
            onBlur={e => { if (Number(e.target.value) < 1) onChange({ width: 20 }); onCommit() }} />
        </div>
        <div className="space-y-1">
          <p className="text-[11px] text-[var(--warm-muted)]">높이 px</p>
          <input type="number" className={inputCls} value={el.height}
            onChange={e => onChange({ height: Number(e.target.value) })}
            onBlur={e => { if (Number(e.target.value) < 1) onChange({ height: 20 }); onCommit() }} />
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-[11px] text-[var(--warm-muted)]">회전 (°)</p>
        <input type="number" className={inputCls} value={el.rotation}
          onChange={e => onChange({ rotation: Number(e.target.value) })}
          onBlur={onCommit} />
      </div>

      {el.type !== 'label' && (
        <div className="space-y-1">
          <p className="text-[11px] text-[var(--warm-muted)]">배경색</p>
          <div className="flex items-center gap-2">
            <input type="color" value={el.fill ?? ELEMENT_DEFAULTS[el.type].fill}
              onChange={e => onChange({ fill: e.target.value })}
              onBlur={onCommit}
              className="w-9 h-8 rounded cursor-pointer border border-[var(--warm-border)]" />
            <button onClick={() => { onChange({ fill: undefined }); onCommit() }}
              className="text-xs text-[var(--warm-muted)] hover:text-[var(--warm-dark)]">초기화</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 모바일 하단 시트 (드래그 가능) ──────────────────────────
function BottomSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const INIT_H = 360
  const MIN_H  = 120
  const MAX_H  = () => window.innerHeight * 0.88

  const [height, setHeight] = useState(INIT_H)
  const drag = useRef<{ startY: number; startH: number } | null>(null)

  const onDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { startY: e.clientY, startH: height }
  }
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    const newH = Math.max(MIN_H, Math.min(MAX_H(), drag.current.startH + drag.current.startY - e.clientY))
    setHeight(newH)
  }
  const onUp = () => { drag.current = null }

  return (
    <div className="md:hidden fixed bottom-0 inset-x-0 z-40 rounded-t-2xl border-t border-[var(--warm-border)] shadow-xl"
      style={{ background: 'var(--cream)', height, display: 'flex', flexDirection: 'column' }}>
      {/* 드래그 핸들 — 실제로 올리고 내릴 수 있음 */}
      <div
        className="flex justify-center pt-2 pb-1 shrink-0 cursor-ns-resize touch-none select-none"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      >
        <div className="w-10 h-1.5 rounded-full bg-[var(--warm-border)]" />
      </div>
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--warm-border)] shrink-0">
        <p className="text-sm font-semibold text-[var(--warm-dark)]">{title}</p>
        <button onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full text-[var(--warm-muted)] hover:bg-[var(--warm-border)] transition-colors text-lg leading-none">
          ×
        </button>
      </div>
      <div className="overflow-y-auto flex-1">{children}</div>
    </div>
  )
}

// ── 정렬 패널 ────────────────────────────────────────────────
type AlignType = 'left' | 'right' | 'top' | 'bottom' | 'centerH' | 'centerV' | 'distributeH' | 'distributeV'

function AlignPanel({ count, onAlign }: { count: number; onAlign: (type: AlignType) => void }) {
  const btnCls = 'flex items-center justify-center w-9 h-9 rounded-lg border border-[var(--warm-border)] bg-[var(--canvas)] text-[var(--warm-dark)] hover:border-[var(--coral)] hover:text-[var(--coral)] transition-colors disabled:opacity-30'
  const items: { type: AlignType; Icon: () => React.ReactElement; title: string; min: number }[] = [
    { type: 'left',        Icon: IcoAlignLeft,    title: '좌측 정렬',      min: 2 },
    { type: 'centerH',     Icon: IcoAlignCenterH, title: '수평 가운데 정렬', min: 2 },
    { type: 'right',       Icon: IcoAlignRight,   title: '우측 정렬',      min: 2 },
    { type: 'top',         Icon: IcoAlignTop,     title: '상단 정렬',      min: 2 },
    { type: 'centerV',     Icon: IcoAlignCenterV, title: '수직 가운데 정렬', min: 2 },
    { type: 'bottom',      Icon: IcoAlignBottom,  title: '하단 정렬',      min: 2 },
    { type: 'distributeH', Icon: IcoDistributeH,  title: '수평 균등 배분',  min: 3 },
    { type: 'distributeV', Icon: IcoDistributeV,  title: '수직 균등 배분',  min: 3 },
  ]
  return (
    <div className="px-4 pb-3 space-y-1.5">
      <p className="text-[11px] text-[var(--warm-muted)]">정렬</p>
      <div className="grid grid-cols-4 gap-1.5">
        {items.map(({ type, Icon, title, min }) => (
          <button key={type} onClick={() => onAlign(type)} disabled={count < min}
            title={title} className={btnCls}>
            <Icon />
          </button>
        ))}
      </div>
      <p className="text-[10px] text-[var(--warm-muted)] leading-tight">
        좌→우→우측끝 / 위→가운데→아래 · 배분은 3개 이상
      </p>
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
  const initEls = initialData?.elements ?? []

  const [mounted, setMounted]               = useState(false)
  const [elements, setElements]             = useState<FloorPlanElement[]>(initEls)
  const [canvasWidth]                       = useState(initialData?.canvasWidth  ?? DEFAULT_W)
  const [canvasHeight]                      = useState(initialData?.canvasHeight ?? DEFAULT_H)
  const [selectedIds, setSelectedIds]       = useState<string[]>([])
  const [editMode, setEditMode]             = useState(!viewOnly)
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [transformMode, setTransformMode]   = useState(false)   // 기본: 이동만. 활성화 시 리사이즈·회전 핸들 노출
  const [saving, setSaving]                 = useState(false)
  const [showGrid, setShowGrid]             = useState(true)
  const [selBox, setSelBox]                 = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [clipboard, setClipboard]           = useState<FloorPlanElement[]>([])

  // ── 히스토리 ─────────────────────────────────────────────
  const historyRef      = useRef<FloorPlanElement[][]>([[...initEls]])
  const historyIdxRef   = useRef(0)
  const [historyIdx, setHistoryIdx] = useState(0)    // 재렌더 트리거용

  const canUndo = historyIdx > 0
  const canRedo = historyIdx < historyRef.current.length - 1

  const pushHistory = useCallback((newEls: FloorPlanElement[]) => {
    const sliced = historyRef.current.slice(0, historyIdxRef.current + 1)
    sliced.push([...newEls])
    if (sliced.length > MAX_HISTORY) sliced.splice(0, 1)
    historyRef.current = sliced
    historyIdxRef.current = sliced.length - 1
    setHistoryIdx(sliced.length - 1)
  }, [])

  const undo = useCallback(() => {
    if (historyIdxRef.current <= 0) return
    historyIdxRef.current -= 1
    setHistoryIdx(historyIdxRef.current)
    setElements([...historyRef.current[historyIdxRef.current]])
    setSelectedIds([])
  }, [])

  const redo = useCallback(() => {
    if (historyIdxRef.current >= historyRef.current.length - 1) return
    historyIdxRef.current += 1
    setHistoryIdx(historyIdxRef.current)
    setElements([...historyRef.current[historyIdxRef.current]])
    setSelectedIds([])
  }, [])

  // ── 안정적 ref ───────────────────────────────────────────
  const elementsRef     = useRef(elements)
  const selectedIdsRef  = useRef(selectedIds)
  const clipboardRef    = useRef(clipboard)
  useEffect(() => { elementsRef.current = elements },     [elements])
  useEffect(() => { selectedIdsRef.current = selectedIds }, [selectedIds])
  useEffect(() => { clipboardRef.current = clipboard },   [clipboard])

  // ── Konva 내부 ref ────────────────────────────────────────
  const nodeRefs           = useRef<Map<string, any>>(new Map())
  const trRef              = useRef<any>(null)
  const dragStartPositions = useRef<Map<string, { x: number; y: number }>>(new Map())
  const draggingGroup      = useRef<string[]>([])
  const isDraggingElement  = useRef(false)
  const selStartRef        = useRef<{ x: number; y: number } | null>(null)
  const pasteOffsetRef     = useRef(0)

  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / canvasWidth)))
    obs.observe(el)
    return () => obs.disconnect()
  }, [canvasWidth])

  // Transformer 노드 연결 (선택 변경 or 변형 모드 변경 시)
  useEffect(() => {
    if (!trRef.current || !mounted) return
    if (transformMode) {
      const nodes = selectedIds.map(id => nodeRefs.current.get(id)).filter(Boolean)
      trRef.current.nodes(nodes)
    } else {
      trRef.current.nodes([])   // 이동 모드: 핸들 숨김
    }
    trRef.current.getLayer()?.batchDraw()
  }, [selectedIds, mounted, transformMode])

  // ── 키보드 단축키 ─────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      if (meta && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo() }
      if (meta && e.key === 'c') { e.preventDefault(); copySelected() }
      if (meta && e.key === 'v') { e.preventDefault(); pasteClipboard() }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIdsRef.current.length > 0) {
        const newEls = elementsRef.current.filter(el => !selectedIdsRef.current.includes(el.id))
        setElements(newEls); setSelectedIds([]); pushHistory(newEls)
      }
      if (e.key === 'Escape') { setSelectedIds([]); setMultiSelectMode(false) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo, redo, pushHistory]) // copySelected/pasteClipboard ref 안정적

  // ── ref 등록 ─────────────────────────────────────────────
  const registerRef = useCallback((id: string, node: any) => {
    if (node) nodeRefs.current.set(id, node)
    else nodeRefs.current.delete(id)
  }, [])

  // ── 클릭 ─────────────────────────────────────────────────
  const handleElementClick = useCallback((id: string, shiftKey: boolean) => {
    if (shiftKey || multiSelectMode) {
      setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id])
    } else {
      setSelectedIds([id])
    }
  }, [multiSelectMode])

  // ── 드래그 ───────────────────────────────────────────────
  const handleDragStart = useCallback((id: string) => {
    isDraggingElement.current = true
    const ids = selectedIdsRef.current.includes(id) ? selectedIdsRef.current : [id]
    draggingGroup.current = ids
    dragStartPositions.current.clear()
    ids.forEach(sid => {
      // React state를 source of truth로 사용 — transform 후 node.x()가 발산하는 것 방지
      const elData = elementsRef.current.find(e => e.id === sid)
      if (elData) {
        dragStartPositions.current.set(sid, { x: elData.x, y: elData.y })
        // Konva 노드도 React state에 맞게 동기화
        const node = nodeRefs.current.get(sid)
        if (node) { node.x(elData.x); node.y(elData.y) }
      } else {
        const node = nodeRefs.current.get(sid)
        if (node) dragStartPositions.current.set(sid, { x: Math.round(node.x()), y: Math.round(node.y()) })
      }
    })
    if (!selectedIdsRef.current.includes(id)) setSelectedIds([id])
  }, [])

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

  const handleDragEnd = useCallback((id: string, nx: number, ny: number) => {
    isDraggingElement.current = false
    const start = dragStartPositions.current.get(id)
    const dx = start ? nx - start.x : 0, dy = start ? ny - start.y : 0
    const ids = draggingGroup.current
    const newEls = elementsRef.current.map(el => {
      if (!ids.includes(el.id)) return el
      if (el.id === id) return { ...el, x: nx, y: ny }
      const s = dragStartPositions.current.get(el.id)
      return s ? { ...el, x: Math.round(s.x + dx), y: Math.round(s.y + dy) } : el
    })
    setElements(newEls)
    pushHistory(newEls)
    dragStartPositions.current.clear()
    draggingGroup.current = []
  }, [pushHistory])

  // ── Transform ────────────────────────────────────────────
  const handleTransformEnd = useCallback(() => {
    const newEls = elementsRef.current.map(el => {
      if (!selectedIdsRef.current.includes(el.id)) return el
      const node = nodeRefs.current.get(el.id)
      if (!node) return el
      const scaleX = node.scaleX(), scaleY = node.scaleY()
      const newX   = Math.round(node.x())
      const newY   = Math.round(node.y())
      const newRot = Math.round(node.rotation())
      const newW   = Math.round(Math.max(20, el.width  * scaleX))
      const newH   = Math.round(Math.max(20, el.height * scaleY))
      // scale·offset·skew 잔류값 전부 초기화 — 이후 drag 시 위치 발산 방지
      node.setAttrs({ x: newX, y: newY, scaleX: 1, scaleY: 1, rotation: newRot, offsetX: 0, offsetY: 0, skewX: 0, skewY: 0 })
      return { ...el, x: newX, y: newY, width: newW, height: newH, rotation: newRot }
    })
    setElements(newEls)
    pushHistory(newEls)
    // React 재렌더 후 Transformer 바운딩박스 재계산
    requestAnimationFrame(() => {
      if (!trRef.current) return
      const nodes = selectedIdsRef.current.map(id => nodeRefs.current.get(id)).filter(Boolean)
      trRef.current.nodes(nodes)
      trRef.current.getLayer()?.batchDraw()
    })
  }, [pushHistory])

  // ── 요소 추가 ────────────────────────────────────────────
  const addElement = (type: ElementType) => {
    const def = ELEMENT_DEFAULTS[type]
    const el: FloorPlanElement = {
      id: genId(), type,
      x: Math.round((60 + Math.random() * 80) / GRID) * GRID,
      y: Math.round((60 + Math.random() * 80) / GRID) * GRID,
      width: def.width, height: def.height, rotation: 0, label: def.label,
    }
    const newEls = [...elementsRef.current, el]
    setElements(newEls)
    setSelectedIds([el.id])
    setMultiSelectMode(false)
    pushHistory(newEls)
  }

  const updateElement = useCallback((id: string, patch: Partial<FloorPlanElement>) => {
    setElements(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e))
  }, [])

  const commitHistory = useCallback(() => {
    pushHistory(elementsRef.current)
  }, [pushHistory])

  const deleteSelected = useCallback(() => {
    const newEls = elementsRef.current.filter(e => !selectedIdsRef.current.includes(e.id))
    setElements(newEls); setSelectedIds([]); pushHistory(newEls)
  }, [pushHistory])

  const clearAll = useCallback(() => {
    setElements([]); setSelectedIds([]); pushHistory([])
  }, [pushHistory])

  // ── 정렬 ─────────────────────────────────────────────────
  const alignElements = useCallback((type: AlignType) => {
    const sel = elementsRef.current.filter(e => selectedIdsRef.current.includes(e.id))
    if (sel.length < 2) return

    const minX = Math.min(...sel.map(e => e.x))
    const maxX = Math.max(...sel.map(e => e.x + e.width))
    const minY = Math.min(...sel.map(e => e.y))
    const maxY = Math.max(...sel.map(e => e.y + e.height))

    let patchMap: Map<string, Partial<FloorPlanElement>> | null = null

    if (type === 'distributeH' && sel.length >= 3) {
      const sorted = [...sel].sort((a, b) => a.x - b.x)
      const totalW = sorted.reduce((s, e) => s + e.width, 0)
      const gap = (maxX - minX - totalW) / (sorted.length - 1)
      let cur = minX
      patchMap = new Map()
      sorted.forEach(e => { patchMap!.set(e.id, { x: Math.round(cur) }); cur += e.width + gap })
    } else if (type === 'distributeV' && sel.length >= 3) {
      const sorted = [...sel].sort((a, b) => a.y - b.y)
      const totalH = sorted.reduce((s, e) => s + e.height, 0)
      const gap = (maxY - minY - totalH) / (sorted.length - 1)
      let cur = minY
      patchMap = new Map()
      sorted.forEach(e => { patchMap!.set(e.id, { y: Math.round(cur) }); cur += e.height + gap })
    }

    const newEls = elementsRef.current.map(el => {
      if (!selectedIdsRef.current.includes(el.id)) return el
      if (patchMap) return { ...el, ...(patchMap.get(el.id) ?? {}) }
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
      switch (type) {
        case 'left':    return { ...el, x: minX }
        case 'right':   return { ...el, x: maxX - el.width }
        case 'top':     return { ...el, y: minY }
        case 'bottom':  return { ...el, y: maxY - el.height }
        case 'centerH': return { ...el, x: Math.round(cx - el.width  / 2) }
        case 'centerV': return { ...el, y: Math.round(cy - el.height / 2) }
        default: return el
      }
    })

    setElements(newEls)
    pushHistory(newEls)
    // Konva 노드 즉시 동기화 (재렌더 전 깜빡임 방지)
    newEls.forEach(el => {
      if (!selectedIdsRef.current.includes(el.id)) return
      const node = nodeRefs.current.get(el.id)
      if (node) { node.x(el.x); node.y(el.y) }
    })
    trRef.current?.getLayer()?.batchDraw()
  }, [pushHistory])

  // ── 복사/붙여넣기 ─────────────────────────────────────────
  const copySelected = useCallback(() => {
    const toCopy = elementsRef.current.filter(e => selectedIdsRef.current.includes(e.id))
    if (toCopy.length === 0) return
    setClipboard(toCopy)
    pasteOffsetRef.current = 0
  }, [])

  const pasteClipboard = useCallback(() => {
    if (clipboardRef.current.length === 0) return
    pasteOffsetRef.current += 20
    const offset = pasteOffsetRef.current
    const pasted = clipboardRef.current.map(el => ({
      ...el, id: genId(),
      x: el.x + offset, y: el.y + offset,
    }))
    const newEls = [...elementsRef.current, ...pasted]
    setElements(newEls)
    setSelectedIds(pasted.map(e => e.id))
    pushHistory(newEls)
  }, [pushHistory])

  // ── 저장 ─────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true)
    const res = await saveFloorPlan({ elements, canvasWidth, canvasHeight })
    setSaving(false)
    if (res.ok) pushToast('success', '도면 저장됨')
    else pushToast('error', res.error)
  }

  // ── 드래그 선택 ──────────────────────────────────────────
  const getCanvasPos = (stage: any) => {
    const pos = stage.getPointerPosition()
    return pos ? { x: pos.x / scale, y: pos.y / scale } : null
  }

  const handlePointerDownStage = (e: any) => {
    if (!editMode || e.target !== e.target.getStage() || isDraggingElement.current) return
    const pos = getCanvasPos(e.target.getStage())
    if (!pos) return
    selStartRef.current = pos
    setSelBox(null); setSelectedIds([])
  }

  const handlePointerMoveStage = (e: any) => {
    if (!selStartRef.current || isDraggingElement.current) return
    const pos = getCanvasPos(e.target.getStage())
    if (!pos) return
    const { x: sx, y: sy } = selStartRef.current
    const w = Math.abs(pos.x - sx), h = Math.abs(pos.y - sy)
    if (w < 6 && h < 6) return
    setSelBox({ x: Math.min(sx, pos.x), y: Math.min(sy, pos.y), w, h })
  }

  const handlePointerUpStage = () => {
    if (!selStartRef.current) return
    if (selBox && (selBox.w > 5 || selBox.h > 5)) {
      const { x, y, w, h } = selBox
      setSelectedIds(elements.filter(el =>
        el.x < x + w && el.x + el.width > x && el.y < y + h && el.y + el.height > y
      ).map(el => el.id))
    }
    selStartRef.current = null; setSelBox(null)
  }

  // ── 편집 모드 전환 ────────────────────────────────────────
  const toggleEditMode = () => {
    setEditMode(v => {
      if (v) { setMultiSelectMode(false); setTransformMode(false); setSelectedIds([]) }
      return !v
    })
  }

  const singleSelected = selectedIds.length === 1
    ? elements.find(e => e.id === selectedIds[0]) ?? null
    : null

  // ── 버튼 스타일 ───────────────────────────────────────────
  const btn = 'px-3 py-2 text-xs rounded-lg border transition-colors shrink-0 min-h-[44px] flex items-center gap-1'
  const btnOn  = (color = 'var(--coral)') => `${btn} text-white border-transparent` + ` bg-[${color}]`
  const btnOff = `${btn} bg-[var(--canvas)] border-[var(--warm-border)] text-[var(--warm-dark)] hover:border-[var(--coral)]`
  const btnGray = `${btn} bg-[var(--canvas)] border-[var(--warm-border)] text-[var(--warm-mid)]`
  const divider = <div className="w-px h-5 bg-[var(--warm-border)] mx-0.5 shrink-0" />

  return (
    <div className="flex flex-col h-full">
      {/* ── 툴바 ── */}
      {!viewOnly && (
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[var(--warm-border)] shrink-0 overflow-x-auto"
          style={{ background: 'var(--cream)' }}>

          {/* 편집 모드 */}
          <button onClick={toggleEditMode}
            className={editMode ? btnOn() : btnGray}
            style={editMode ? { backgroundColor: 'var(--coral)' } : {}}>
            {editMode ? '편집 중' : '편집'}
          </button>

          {editMode && (<>
            {/* 다중 선택 모드 */}
            <button onClick={() => setMultiSelectMode(v => !v)}
              className={multiSelectMode ? btnOn('#3b82f6') : btnGray}
              style={multiSelectMode ? { backgroundColor: '#3b82f6' } : {}}
              title="다중 선택 (터치 기기용 Shift 대체)">
              다중{multiSelectMode && ' ✓'}
            </button>

            {/* 변형 모드 — 비활성 시 핸들 없음 → 실수로 리사이즈 방지 */}
            <button onClick={() => setTransformMode(v => !v)}
              className={transformMode ? btnOn('#7c3aed') : btnGray}
              style={transformMode ? { backgroundColor: '#7c3aed' } : {}}
              title="변형 모드 활성화 시 크기·회전 핸들 표시 (비활성: 이동만 가능)">
              {transformMode ? '변형 중' : '변형'}
            </button>

            {divider}

            {/* 되돌리기 / 다시실행 */}
            <button onClick={undo} disabled={!canUndo}
              className={`${btnGray} disabled:opacity-30`} title="되돌리기 (Ctrl+Z)">↩</button>
            <button onClick={redo} disabled={!canRedo}
              className={`${btnGray} disabled:opacity-30`} title="다시실행 (Ctrl+Y)">↪</button>

            {divider}

            {/* 복사 / 붙여넣기 */}
            <button onClick={copySelected} disabled={selectedIds.length === 0}
              className={`${btnGray} disabled:opacity-30`} title="복사 (Ctrl+C)">복사</button>
            <button onClick={pasteClipboard} disabled={clipboard.length === 0}
              className={`${btnGray} disabled:opacity-30`} title="붙여넣기 (Ctrl+V)">붙여넣기</button>

            {elements.length > 0 && (
              <button onClick={clearAll}
                className={`${btn} bg-[var(--canvas)] border-[var(--warm-border)] text-[var(--warm-muted)] hover:border-red-300 hover:text-red-400`}
                title="전체 지우기 (↩ 되돌리기로 복구 가능)">
                전체 지우기
              </button>
            )}

            {divider}

            {/* 요소 추가 */}
            <span className="text-[10px] text-[var(--warm-muted)] shrink-0 hidden sm:inline">추가:</span>
            {PALETTE.map(type => (
              <button key={type} onClick={() => addElement(type)} className={btnOff}>
                {TYPE_LABEL[type]}
              </button>
            ))}

            {selectedIds.length > 0 && (<>
              {divider}
              <button onClick={deleteSelected}
                className={`${btn} bg-red-50 border border-red-200 text-red-500 hover:bg-red-100`}>
                삭제 ({selectedIds.length})
              </button>
            </>)}

            {divider}
          </>)}

          <label className="flex items-center gap-1.5 text-xs text-[var(--warm-mid)] cursor-pointer shrink-0 ml-auto min-h-[44px]">
            <input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} className="accent-[var(--coral)]" />
            그리드
          </label>

          <button onClick={handleSave} disabled={saving}
            className={`${btn} bg-[var(--ink)] border-transparent text-[var(--canvas)] hover:opacity-80 disabled:opacity-50`}>
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      )}

      {/* ── 변형 모드 안내 (데스크탑) ── */}
      {editMode && !transformMode && selectedIds.length > 0 && (
        <div className="hidden md:flex items-center justify-center py-1 text-[11px] text-[var(--warm-muted)] border-b border-[var(--warm-border)]"
          style={{ background: 'var(--canvas)' }}>
          이동 모드 — 크기·회전 변경이 필요하면 <strong className="mx-1 text-[#7c3aed]">변형</strong> 버튼을 활성화하세요
        </div>
      )}

      {/* ── 본문 ── */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* 캔버스 */}
        <div ref={containerRef} className="flex-1 overflow-auto"
          style={{ background: 'var(--cream-2, #f0ebe0)', touchAction: editMode ? 'none' : 'auto' }}>
          {mounted && (
            <div style={{ width: canvasWidth * scale, height: canvasHeight * scale }}>
              <Stage
                width={canvasWidth * scale} height={canvasHeight * scale}
                scaleX={scale} scaleY={scale}
                onMouseDown={handlePointerDownStage}
                onMouseMove={handlePointerMoveStage}
                onMouseUp={handlePointerUpStage}
                onTouchStart={handlePointerDownStage}
                onTouchMove={handlePointerMoveStage}
                onTouchEnd={handlePointerUpStage}
              >
                <Layer>
                  <Rect width={canvasWidth} height={canvasHeight} fill="#faf6ef" listening={false} />
                  {showGrid && <GridLines width={canvasWidth} height={canvasHeight} />}

                  {elements.map(el => (
                    <PlanElement
                      key={el.id} el={el}
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

                  {/* 변형 모드일 때만 핸들 노출 */}
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

                  {selBox && selBox.w > 0 && (
                    <Rect
                      x={selBox.x} y={selBox.y} width={selBox.w} height={selBox.h}
                      fill="rgba(74,144,232,0.08)" stroke="#4a90e8" strokeWidth={1}
                      dash={[4, 3]} listening={false}
                    />
                  )}
                </Layer>
              </Stage>
            </div>
          )}
        </div>

        {/* 데스크탑 속성 패널 */}
        {editMode && singleSelected && (
          <div className="hidden md:block w-52 shrink-0 border-l border-[var(--warm-border)] overflow-y-auto"
            style={{ background: 'var(--cream)' }}>
            <PropertiesPanel
              el={singleSelected} rooms={rooms}
              onChange={patch => updateElement(singleSelected.id, patch)}
              onDelete={deleteSelected}
              onCommit={commitHistory}
            />
          </div>
        )}

        {editMode && selectedIds.length > 1 && (
          <div className="hidden md:flex md:flex-col w-52 shrink-0 border-l border-[var(--warm-border)] overflow-y-auto"
            style={{ background: 'var(--cream)' }}>
            <div className="px-4 pt-4 pb-2">
              <p className="text-xs font-semibold text-[var(--warm-dark)]">{selectedIds.length}개 선택됨</p>
              <p className="text-[11px] text-[var(--warm-muted)] mt-1">
                {transformMode ? '핸들로 함께 이동·크기 변경·회전' : '함께 이동 가능 · 크기·회전은 변형 모드 켜기'}
              </p>
            </div>
            {/* 정렬 먼저 */}
            <div className="border-t border-[var(--warm-border)] pt-3">
              <AlignPanel count={selectedIds.length} onAlign={alignElements} />
            </div>
            <div className="border-t border-[var(--warm-border)] px-4 py-3 space-y-2">
              <button onClick={copySelected}
                className="w-full text-xs border border-[var(--warm-border)] bg-[var(--canvas)] rounded-lg py-2 text-[var(--warm-dark)] hover:border-[var(--coral)] transition-colors">
                복사
              </button>
              <button onClick={deleteSelected}
                className="w-full text-xs text-red-500 border border-red-200 bg-red-50 hover:bg-red-100 rounded-lg py-2 transition-colors">
                선택 삭제
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 모바일 하단 시트 */}
      {editMode && singleSelected && (
        <BottomSheet title={TYPE_LABEL[singleSelected.type]} onClose={() => setSelectedIds([])}>
          <PropertiesPanel
            el={singleSelected} rooms={rooms}
            onChange={patch => updateElement(singleSelected.id, patch)}
            onDelete={deleteSelected}
            onCommit={commitHistory}
          />
        </BottomSheet>
      )}

      {/* 다중 선택 BottomSheet는 제거 — 모든 화면 크기에서 상단 툴바 + 우측 패널이 역할 담당.
          캔버스를 가리는 문제 + 해상도 낮은 데스크탑에서 중복 노출 문제 해소. */}

      {/* 다중 선택 모드 안내 (모바일) */}
      {editMode && multiSelectMode && selectedIds.length === 0 && (
        <div className="md:hidden fixed bottom-4 inset-x-4 z-30 pointer-events-none">
          <div className="rounded-xl px-4 py-2.5 text-xs text-center text-[var(--warm-dark)]"
            style={{ background: 'rgba(250,246,239,0.95)', border: '1px solid var(--warm-border)' }}>
            요소를 탭하여 선택하세요. 여러 개 선택 가능합니다.
          </div>
        </div>
      )}
    </div>
  )
}
