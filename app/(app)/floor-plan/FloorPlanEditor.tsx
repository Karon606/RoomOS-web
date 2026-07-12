'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { AiQuotaHint } from '@/components/ui/AiQuotaHint'
import { notifyAiQuota } from '@/lib/aiQuotaToast'
import { Stage, Layer, Rect, Text, Group, Transformer, Line, Circle, Image as KonvaImage } from 'react-konva'
import {
  type FloorPlanData, type FloorPlanElement, type FloorData,
  type ElementType, saveFloorPlan, swapFloorPlanWithPrev, parseFloorPlanImage, setFloorPlanDashboardVisibility,
} from './actions'
import { pushToast } from '@/lib/saveStatus'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { Modal, ModalFooterActions } from '@/components/ui/Modal'
import { Btn } from '@/components/ui/Btn'

// ── 상수 ─────────────────────────────────────────────────────
const GRID = 20
const SNAP_D = 8
const MAX_HISTORY = 50
const DEFAULT_W = 800
const DEFAULT_H = 600

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

// ── 다각형 유틸 ──────────────────────────────────────────────
function polyBBox(points: number[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0; i < points.length; i += 2) {
    if (points[i] < minX) minX = points[i]; if (points[i] > maxX) maxX = points[i]
    if (points[i + 1] < minY) minY = points[i + 1]; if (points[i + 1] > maxY) maxY = points[i + 1]
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY }
}

// Adjusts el.x/y so bounding box origin is 0,0 relative to element; updates width/height.
function normalizePoly(el: FloorPlanElement): FloorPlanElement {
  if (!el.points) return el
  const { minX, minY, w, h } = polyBBox(el.points)
  const pts = el.points.map((v, i) => i % 2 === 0 ? v - minX : v - minY)
  return { ...el, x: el.x + minX, y: el.y + minY, width: Math.max(20, w), height: Math.max(20, h), points: pts }
}

// ── 정렬 아이콘 ──────────────────────────────────────────────
const _i = { viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, width: 16, height: 16 }
function IcoAlignLeft()    { return <svg {..._i}><line x1="4"  y1="3"  x2="4"  y2="17"/><rect x="4"  y="5"  width="7"  height="3.5" rx="0.8" fill="currentColor" stroke="none"/><rect x="4"  y="11.5" width="12" height="3.5" rx="0.8" fill="currentColor" stroke="none"/></svg> }
function IcoAlignRight()   { return <svg {..._i}><line x1="16" y1="3"  x2="16" y2="17"/><rect x="5"  y="5"  width="11" height="3.5" rx="0.8" fill="currentColor" stroke="none"/><rect x="9"  y="11.5" width="7"  height="3.5" rx="0.8" fill="currentColor" stroke="none"/></svg> }
function IcoAlignTop()     { return <svg {..._i}><line x1="3"  y1="4"  x2="17" y2="4" /><rect x="5"  y="4"  width="3.5" height="7"  rx="0.8" fill="currentColor" stroke="none"/><rect x="11.5" y="4" width="3.5" height="12" rx="0.8" fill="currentColor" stroke="none"/></svg> }
function IcoAlignBottom()  { return <svg {..._i}><line x1="3"  y1="16" x2="17" y2="16"/><rect x="5"  y="9"  width="3.5" height="7"  rx="0.8" fill="currentColor" stroke="none"/><rect x="11.5" y="4" width="3.5" height="12" rx="0.8" fill="currentColor" stroke="none"/></svg> }
function IcoAlignCenterH() { return <svg {..._i}><line x1="10" y1="3"  x2="10" y2="17"/><rect x="3"  y="5"  width="14" height="3.5" rx="0.8" fill="currentColor" stroke="none"/><rect x="5"  y="11.5" width="10" height="3.5" rx="0.8" fill="currentColor" stroke="none"/></svg> }
function IcoAlignCenterV() { return <svg {..._i}><line x1="3"  y1="10" x2="17" y2="10"/><rect x="5"  y="3"  width="3.5" height="14" rx="0.8" fill="currentColor" stroke="none"/><rect x="11.5" y="5" width="3.5" height="10" rx="0.8" fill="currentColor" stroke="none"/></svg> }
function IcoDistributeH()  { return <svg {..._i}><line x1="3"  y1="3"  x2="3"  y2="17"/><line x1="17" y1="3"  x2="17" y2="17"/><rect x="7.5" y="6" width="5" height="8" rx="0.8" fill="currentColor" stroke="none"/></svg> }
function IcoDistributeV()  { return <svg {..._i}><line x1="3"  y1="3"  x2="17" y2="3" /><line x1="3"  y1="17" x2="17" y2="17"/><rect x="6"  y="7.5" width="8" height="5" rx="0.8" fill="currentColor" stroke="none"/></svg> }

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
  const isPolygon = !!el.points

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
      {isPolygon ? (
        <Line
          points={el.points!}
          closed
          fill={bgFill}
          stroke={isSelected ? '#e84a1a' : def.stroke}
          strokeWidth={isSelected ? 2 : 1}
          shadowEnabled={isSelected} shadowColor="rgba(232,74,26,0.3)" shadowBlur={8}
        />
      ) : (
        <Rect
          width={el.width} height={el.height}
          fill={bgFill}
          stroke={isSelected ? '#e84a1a' : def.stroke}
          strokeWidth={isSelected ? 2 : 1}
          cornerRadius={el.type === 'room' ? 4 : 2}
          shadowEnabled={isSelected} shadowColor="rgba(232,74,26,0.3)" shadowBlur={8}
        />
      )}
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
  el, rooms, onChange, onDelete, onCommit, onToggleVertexEdit, isVertexEditing,
}: {
  el: FloorPlanElement
  rooms: { id: string; roomNo: string }[]
  onChange: (patch: Partial<FloorPlanElement>) => void
  onDelete: () => void
  onCommit: () => void
  onToggleVertexEdit: () => void
  isVertexEditing: boolean
}) {
  const inputCls = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]'
  const isPolygon = !!el.points

  const convertToPolygon = () => {
    const pts = [0, 0, el.width, 0, el.width, el.height, 0, el.height]
    onChange({ points: pts })
    onCommit()
  }
  const convertToRect = () => {
    onChange({ points: undefined })
    onCommit()
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-[var(--warm-dark)]">{TYPE_LABEL[el.type]}</p>
        <button onClick={onDelete} className="text-xs text-[var(--danger-fg)] hover:text-[var(--danger-fg)] px-2 py-1 rounded hover:bg-[var(--danger-bg)] transition-colors">삭제</button>
      </div>

      {/* 도형 변환 */}
      <div className="flex gap-1.5">
        {isPolygon ? (
          <>
            <button
              onClick={onToggleVertexEdit}
              className={`flex-1 text-xs py-1.5 rounded-lg border transition-colors ${isVertexEditing ? 'text-[var(--on-solid)] border-transparent' : 'border-[var(--warm-border)] text-[var(--warm-dark)] hover:border-[var(--coral)]'}`}
              style={isVertexEditing ? { background: 'var(--coral)' } : {}}>
              {isVertexEditing ? '정점 편집 중' : '정점 편집'}
            </button>
            <button onClick={convertToRect}
              className="flex-1 text-xs py-1.5 rounded-lg border border-[var(--warm-border)] text-[var(--warm-muted)] hover:border-[var(--coral)] transition-colors">
              직사각형으로
            </button>
          </>
        ) : (
          <button onClick={convertToPolygon}
            className="w-full text-xs py-1.5 rounded-lg border border-[var(--warm-border)] text-[var(--warm-dark)] hover:border-[var(--coral)] transition-colors">
            다각형으로 변환
          </button>
        )}
      </div>

      <div className="space-y-1">
        <p className="text-[0.6875rem] text-[var(--warm-muted)]">표시 이름</p>
        <input className={inputCls} value={el.label}
          onChange={e => onChange({ label: e.target.value })}
          onBlur={onCommit} />
      </div>

      {el.type === 'room' && (
        <div className="space-y-1">
          <p className="text-[0.6875rem] text-[var(--warm-muted)]">연결 호실</p>
          <select className={inputCls} value={el.roomNo ?? ''}
            onChange={e => { onChange({ roomNo: e.target.value || undefined }); onCommit() }}>
            <option value="">연결 없음</option>
            {rooms.map(r => <option key={r.id} value={r.roomNo}>{r.roomNo}호</option>)}
          </select>
        </div>
      )}

      {!isPolygon && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <p className="text-[0.6875rem] text-[var(--warm-muted)]">너비 px</p>
            <input type="number" className={inputCls} value={el.width}
              onChange={e => onChange({ width: Number(e.target.value) })}
              onBlur={e => { if (Number(e.target.value) < 1) onChange({ width: 20 }); onCommit() }} />
          </div>
          <div className="space-y-1">
            <p className="text-[0.6875rem] text-[var(--warm-muted)]">높이 px</p>
            <input type="number" className={inputCls} value={el.height}
              onChange={e => onChange({ height: Number(e.target.value) })}
              onBlur={e => { if (Number(e.target.value) < 1) onChange({ height: 20 }); onCommit() }} />
          </div>
        </div>
      )}

      <div className="space-y-1">
        <p className="text-[0.6875rem] text-[var(--warm-muted)]">회전 (°)</p>
        <input type="number" className={inputCls} value={el.rotation}
          onChange={e => onChange({ rotation: Number(e.target.value) })}
          onBlur={onCommit} />
      </div>

      {el.type !== 'label' && (
        <div className="space-y-1">
          <p className="text-[0.6875rem] text-[var(--warm-muted)]">배경색</p>
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

// ── 모바일 하단 시트 ──────────────────────────────────────────
function BottomSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const INIT_H = 380
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
    <div className="md:hidden fixed bottom-0 inset-x-0 z-40 rounded-t-2xl border-t border-[var(--warm-border)] shadow-lift"
      style={{ background: 'var(--cream)', height, display: 'flex', flexDirection: 'column' }}>
      <div className="flex justify-center pt-2 pb-1 shrink-0 cursor-ns-resize touch-none select-none"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div className="w-10 h-1.5 rounded-full bg-[var(--warm-border)]" />
      </div>
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--warm-border)] shrink-0">
        <p className="text-sm font-semibold text-[var(--warm-dark)]">{title}</p>
        <button onClick={onClose}
          className="w-11 h-11 flex items-center justify-center rounded-full text-[var(--warm-muted)] hover:bg-[var(--warm-border)] transition-colors text-lg leading-none">
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
    { type: 'left',        Icon: IcoAlignLeft,    title: '좌측 정렬',       min: 2 },
    { type: 'centerH',     Icon: IcoAlignCenterH, title: '수평 가운데 정렬', min: 2 },
    { type: 'right',       Icon: IcoAlignRight,   title: '우측 정렬',       min: 2 },
    { type: 'top',         Icon: IcoAlignTop,     title: '상단 정렬',       min: 2 },
    { type: 'centerV',     Icon: IcoAlignCenterV, title: '수직 가운데 정렬', min: 2 },
    { type: 'bottom',      Icon: IcoAlignBottom,  title: '하단 정렬',       min: 2 },
    { type: 'distributeH', Icon: IcoDistributeH,  title: '수평 균등 배분',  min: 3 },
    { type: 'distributeV', Icon: IcoDistributeV,  title: '수직 균등 배분',  min: 3 },
  ]
  return (
    <div className="px-4 pb-3 space-y-1.5">
      <p className="text-[0.6875rem] text-[var(--warm-muted)]">정렬</p>
      <div className="grid grid-cols-4 gap-1.5">
        {items.map(({ type, Icon, title, min }) => (
          <button key={type} onClick={() => onAlign(type)} disabled={count < min}
            title={title} className={btnCls}>
            <Icon />
          </button>
        ))}
      </div>
      <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-tight">
        좌→우→우측끝 / 위→가운데→아래 · 배분은 3개 이상
      </p>
    </div>
  )
}

// ── AI 도면 인식 모달 ─────────────────────────────────────────
function AiImportModal({
  canvasWidth, canvasHeight, onConfirm, onCancel,
}: {
  canvasWidth: number
  canvasHeight: number
  onConfirm: (elements: FloorPlanElement[], imgDataUrl: string) => void
  onCancel: () => void
}) {
  const [pending, setPending] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<FloorPlanElement[] | null>(null)
  const [imgDataUrl, setImgDataUrl] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!pending) { setElapsed(0); return }
    const t = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [pending])

  const handleFile = async (file: File) => {
    setPending(true); setError(''); setPreview(null)
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result as string)
      r.onerror = reject
      r.readAsDataURL(file)
    })
    setImgDataUrl(dataUrl)
    const base64 = dataUrl.split(',')[1]
    const res = await parseFloorPlanImage(base64, file.type || 'image/jpeg', canvasWidth, canvasHeight)
    setPending(false)
    if (!res.ok) { setError(res.error); return }
    void notifyAiQuota()
    if (res.elements.length === 0) { setError('평면도 요소를 찾을 수 없습니다. 더 선명한 이미지를 사용해보세요.'); return }
    setPreview(res.elements)
  }

  return (
    <Modal open onClose={onCancel} width="sm" title="AI 도면 인식"
      // 인식 결과(preview)가 있으면 배경클릭 오조작으로 분석 결과가 날아가지 않게
      dirty={!!preview || pending}>
      <div className="p-6 pt-4 space-y-4">
        <p className="text-xs text-[var(--warm-muted)] leading-relaxed">
          평면도 사진을 업로드하면 AI가 방, 복도, 계단 등을 자동으로 인식하여 추가합니다.
        </p>
        <AiQuotaHint />
        {!preview ? (
          <>
            {pending ? (
              <div className="w-full py-8 flex flex-col items-center gap-3 border-2 border-dashed border-[var(--warm-border)] rounded-xl">
                <div className="w-7 h-7 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--coral)', borderTopColor: 'transparent' }} />
                <p className="text-xs font-medium text-[var(--warm-dark)]">AI 분석 중… {elapsed}초</p>
                <p className="text-[0.6875rem] text-[var(--warm-muted)] text-center px-4">
                  {elapsed < 10 ? '이미지를 전송하고 있습니다' : elapsed < 25 ? '공간 요소를 인식하고 있습니다' : '좌표를 계산하고 있습니다. 거의 다 됐어요'}
                </p>
              </div>
            ) : (
              <button onClick={() => fileRef.current?.click()}
                className="w-full py-10 border-2 border-dashed border-[var(--warm-border)] rounded-xl text-xs text-[var(--warm-muted)] hover:border-[var(--coral)] transition-colors">
                이미지 선택 (JPG, PNG)
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />
            {error && <p className="text-xs text-[var(--danger-fg)]">{error}</p>}
          </>
        ) : (
          <>
            <p className="text-xs text-[var(--warm-muted)]">{preview.length}개 요소를 인식했습니다.</p>
            <ul className="text-xs text-[var(--warm-dark)] space-y-1 max-h-44 overflow-y-auto border border-[var(--warm-border)] rounded-lg p-2">
              {preview.map((el, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="text-[var(--warm-muted)] w-12 shrink-0">{TYPE_LABEL[el.type]}</span>
                  <span>{el.label}{el.roomNo ? ` (${el.roomNo}호)` : ''}</span>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Btn variant="secondary" size="sm" className="flex-1" onClick={() => setPreview(null)}>
                다시 선택
              </Btn>
              <Btn variant="primary" size="sm" className="flex-1" onClick={() => onConfirm(preview!, imgDataUrl)}>
                도면에 추가
              </Btn>
            </div>
          </>
        )}
        <button onClick={onCancel} className="w-full text-xs text-[var(--warm-muted)] hover:text-[var(--warm-dark)] py-1">취소</button>
      </div>
    </Modal>
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
  // ── 층 초기화 ─────────────────────────────────────────────
  const initFloors = (): { floors: { id: string; label: string }[]; activeId: string; firstEls: FloorPlanElement[]; cw: number; ch: number } => {
    const data = initialData ?? { floors: [{ id: genId(), label: '1층', elements: [], canvasWidth: DEFAULT_W, canvasHeight: DEFAULT_H }] }
    const fl = data.floors
    return {
      floors: fl.map(f => ({ id: f.id, label: f.label })),
      activeId: fl[0].id,
      firstEls: fl[0].elements,
      cw: fl[0].canvasWidth ?? DEFAULT_W,
      ch: fl[0].canvasHeight ?? DEFAULT_H,
    }
  }
  const _init = initFloors()

  const [floors, setFloors]             = useState<{ id: string; label: string }[]>(_init.floors)
  const [activeFloorId, setActiveFloorId] = useState(_init.activeId)
  const [canvasWidth]                   = useState(_init.cw)
  const [canvasHeight]                  = useState(_init.ch)
  const [elements, setElements]         = useState<FloorPlanElement[]>(_init.firstEls)

  // Non-active floors' elements
  const floorElementsRef = useRef<Map<string, FloorPlanElement[]>>(new Map())
  useEffect(() => {
    if (!initialData) return
    initialData.floors.forEach((f, i) => {
      if (i === 0) return
      floorElementsRef.current.set(f.id, f.elements)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [mounted, setMounted]               = useState(false)
  const [selectedIds, setSelectedIds]       = useState<string[]>([])
  const [editMode, setEditMode]             = useState(!viewOnly)
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [transformMode, setTransformMode]   = useState(false)
  const [saving, setSaving]                 = useState(false)
  const [showGrid, setShowGrid]             = useState(true)
  const [selBox, setSelBox]                 = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [clipboard, setClipboard]           = useState<FloorPlanElement[]>([])

  // ── 다각형 그리기 ─────────────────────────────────────────
  const [drawingPolygon, setDrawingPolygon]   = useState<{ type: ElementType; points: number[] } | null>(null)
  const [drawCursor, setDrawCursor]           = useState<{ x: number; y: number } | null>(null)
  const [showPolyMenu, setShowPolyMenu]       = useState(false)
  const lastClickTimeRef                      = useRef(0)

  // ── 정점 편집 ─────────────────────────────────────────────
  const [vertexEditId, setVertexEditId]       = useState<string | null>(null)

  // ── AI 임포트 ─────────────────────────────────────────────
  const [aiImportOpen, setAiImportOpen]       = useState(false)

  // ── 층 이름 변경(정본 Modal — window.prompt 대체) ─────────
  const [renameTarget, setRenameTarget]       = useState<{ id: string; value: string } | null>(null)

  // ── 대시보드 표시 토글 ────────────────────────────────────
  const [showOnDashboard, setShowOnDashboard] = useState(initialData?.showOnDashboard ?? false)
  const [dashToggling, setDashToggling]       = useState(false)
  const handleDashboardToggle = useCallback(async (val: boolean) => {
    setShowOnDashboard(val)
    setDashToggling(true)
    await setFloorPlanDashboardVisibility(val)
    setDashToggling(false)
  }, [])

  // ── 배경 도면 이미지 ──────────────────────────────────────
  const [bgDataUrl, setBgDataUrl]             = useState<string>('')
  const [bgImg, setBgImg]                     = useState<HTMLImageElement | null>(null)
  const [showBg, setShowBg]                   = useState(true)
  const bgDataUrlRef                          = useRef('')
  const floorBgRef                            = useRef<Map<string, string>>(new Map())
  useEffect(() => { bgDataUrlRef.current = bgDataUrl }, [bgDataUrl])
  useEffect(() => {
    if (!bgDataUrl) { setBgImg(null); return }
    const img = new window.Image()
    img.onload = () => setBgImg(img)
    img.src = bgDataUrl
  }, [bgDataUrl])

  // ── 히스토리 ─────────────────────────────────────────────
  const historyRef    = useRef<FloorPlanElement[][]>([[..._init.firstEls]])
  const historyIdxRef = useRef(0)
  const [historyIdx, setHistoryIdx] = useState(0)

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
  const elementsRef    = useRef(elements)
  const selectedIdsRef = useRef(selectedIds)
  const clipboardRef   = useRef(clipboard)
  useEffect(() => { elementsRef.current = elements },        [elements])
  useEffect(() => { selectedIdsRef.current = selectedIds },  [selectedIds])
  useEffect(() => { clipboardRef.current = clipboard },      [clipboard])

  // ── 미저장 변경 가드(ID-28) ──────────────────────────────
  // 마지막 저장 시점 스냅샷과 현재(모든 층 요소)를 비교해 dirty 판정.
  // 편집 중 탭 이동·새로고침 시 확인을 거치고, 저장 직후엔 경고가 안 뜨게 한다.
  const router = useRouter()
  const savedSnapshotRef = useRef<string>('')
  const dirtyRef = useRef(false)
  const serializeFloors = useCallback(() => JSON.stringify(
    floors.map(f => ({
      id: f.id, label: f.label,
      elements: f.id === activeFloorId ? elementsRef.current : (floorElementsRef.current.get(f.id) ?? []),
    })),
  ), [floors, activeFloorId])
  // 최초 마운트 시 저장 스냅샷 확정(다른 층 요소가 ref 에 채워진 뒤).
  useEffect(() => { savedSnapshotRef.current = serializeFloors() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { dirtyRef.current = serializeFloors() !== savedSnapshotRef.current }, [elements, floors, activeFloorId, serializeFloors])
  // 새로고침·탭 닫기 방어
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])
  // 앱 내 라우팅 이탈(하단 탭·링크) 방어 — 링크 클릭을 가로채 확인 후 이동
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current) return
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as HTMLElement).closest('a')
      if (!a) return
      const href = a.getAttribute('href')
      if (!href || href.startsWith('#') || href.startsWith('http') || a.target === '_blank') return
      e.preventDefault()
      e.stopPropagation()
      void confirmDialog({ title: '저장하지 않은 변경이 있어요', message: '나가면 배치 변경이 사라집니다.', confirmLabel: '나가기', level: 'danger' }).then(ok => {
        if (ok) { dirtyRef.current = false; router.push(href) }
      })
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [router])

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

  useEffect(() => {
    if (!trRef.current || !mounted) return
    if (transformMode && !vertexEditId) {
      const nodes = selectedIds.map(id => nodeRefs.current.get(id)).filter(Boolean)
      trRef.current.nodes(nodes)
    } else {
      trRef.current.nodes([])
    }
    trRef.current.getLayer()?.batchDraw()
  }, [selectedIds, mounted, transformMode, vertexEditId])

  // ── 층 전환 ──────────────────────────────────────────────
  const switchFloor = useCallback((newId: string) => {
    setFloors(prev => prev) // no-op to flush
    floorElementsRef.current.set(activeFloorId, elementsRef.current)
    floorBgRef.current.set(activeFloorId, bgDataUrlRef.current)
    const newEls = floorElementsRef.current.get(newId) ?? []
    setElements(newEls)
    setActiveFloorId(newId)
    setBgDataUrl(floorBgRef.current.get(newId) ?? '')
    setSelectedIds([])
    setVertexEditId(null)
    setDrawingPolygon(null)
    setDrawCursor(null)
    historyRef.current = [[...newEls]]
    historyIdxRef.current = 0
    setHistoryIdx(0)
  }, [activeFloorId])

  const addFloor = useCallback(() => {
    floorElementsRef.current.set(activeFloorId, elementsRef.current)
    const id = genId()
    const label = `${floors.length + 1}층`
    setFloors(prev => [...prev, { id, label }])
    floorElementsRef.current.set(id, [])
    setElements([])
    setActiveFloorId(id)
    setSelectedIds([])
    setVertexEditId(null)
    setDrawingPolygon(null)
    historyRef.current = [[]]
    historyIdxRef.current = 0
    setHistoryIdx(0)
  }, [activeFloorId, floors.length])

  const deleteFloor = useCallback((id: string) => {
    if (floors.length <= 1) return
    const newFloors = floors.filter(f => f.id !== id)
    floorElementsRef.current.delete(id)
    if (id === activeFloorId) {
      const newActive = newFloors[0]
      const newEls = floorElementsRef.current.get(newActive.id) ?? []
      setElements(newEls)
      setActiveFloorId(newActive.id)
      setSelectedIds([])
      historyRef.current = [[...newEls]]
      historyIdxRef.current = 0
      setHistoryIdx(0)
    }
    setFloors(newFloors)
  }, [floors, activeFloorId])

  const renameFloor = useCallback((id: string) => {
    const current = floors.find(f => f.id === id)?.label ?? ''
    setRenameTarget({ id, value: current })
  }, [floors])
  const commitRename = useCallback(() => {
    setRenameTarget(t => {
      if (t) {
        const name = t.value.trim()
        if (name) setFloors(prev => prev.map(f => f.id === t.id ? { ...f, label: name } : f))
      }
      return null
    })
  }, [])

  // ── 키보드 단축키 ─────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.key === 'Escape') {
        if (drawingPolygon) { setDrawingPolygon(null); setDrawCursor(null); return }
        if (vertexEditId) { setVertexEditId(null); return }
        setSelectedIds([]); setMultiSelectMode(false); return
      }
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      if (meta && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo() }
      if (meta && e.key === 'c') { e.preventDefault(); copySelected() }
      if (meta && e.key === 'v') { e.preventDefault(); pasteClipboard() }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIdsRef.current.length > 0) {
        const newEls = elementsRef.current.filter(el => !selectedIdsRef.current.includes(el.id))
        setElements(newEls); setSelectedIds([]); pushHistory(newEls)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo, redo, pushHistory, drawingPolygon, vertexEditId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── ref 등록 ─────────────────────────────────────────────
  const registerRef = useCallback((id: string, node: any) => {
    if (node) nodeRefs.current.set(id, node)
    else nodeRefs.current.delete(id)
  }, [])

  // ── 클릭 ─────────────────────────────────────────────────
  const handleElementClick = useCallback((id: string, shiftKey: boolean) => {
    if (vertexEditId && vertexEditId !== id) { setVertexEditId(null); return }
    if (shiftKey || multiSelectMode) {
      setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id])
    } else {
      setSelectedIds([id])
    }
  }, [multiSelectMode, vertexEditId])

  // ── 드래그 ───────────────────────────────────────────────
  const handleDragStart = useCallback((id: string) => {
    isDraggingElement.current = true
    const ids = selectedIdsRef.current.includes(id) ? selectedIdsRef.current : [id]
    draggingGroup.current = ids
    dragStartPositions.current.clear()
    ids.forEach(sid => {
      const elData = elementsRef.current.find(e => e.id === sid)
      if (elData) {
        dragStartPositions.current.set(sid, { x: elData.x, y: elData.y })
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
      node.setAttrs({ x: newX, y: newY, scaleX: 1, scaleY: 1, rotation: newRot, offsetX: 0, offsetY: 0, skewX: 0, skewY: 0 })
      if (el.points) {
        const newPts = el.points.map((v, i) => Math.round(i % 2 === 0 ? v * scaleX : v * scaleY))
        const { w, h } = polyBBox(newPts)
        return { ...el, x: newX, y: newY, width: Math.max(20, w), height: Math.max(20, h), rotation: newRot, points: newPts }
      }
      const newW = Math.round(Math.max(20, el.width  * scaleX))
      const newH = Math.round(Math.max(20, el.height * scaleY))
      return { ...el, x: newX, y: newY, width: newW, height: newH, rotation: newRot }
    })
    setElements(newEls)
    pushHistory(newEls)
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
    setElements(newEls); setSelectedIds([])
    setVertexEditId(null); pushHistory(newEls)
  }, [pushHistory])

  const clearAll = useCallback(() => {
    setElements([]); setSelectedIds([]); setVertexEditId(null); pushHistory([])
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

  // ── AI 임포트 확인 ────────────────────────────────────────
  const handleAiImportConfirm = useCallback((imported: FloorPlanElement[], imgDataUrl: string) => {
    setAiImportOpen(false)
    const newEls = [...elementsRef.current, ...imported]
    setElements(newEls)
    setSelectedIds(imported.map(e => e.id))
    pushHistory(newEls)
    if (imgDataUrl) { setBgDataUrl(imgDataUrl); setShowBg(true) }
    pushToast('success', `${imported.length}개 요소를 추가했습니다`)
  }, [pushHistory])

  // ── 저장 ─────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true)
    floorElementsRef.current.set(activeFloorId, elementsRef.current)
    const allFloors: FloorData[] = floors.map(f => ({
      id: f.id,
      label: f.label,
      elements: floorElementsRef.current.get(f.id) ?? [],
      canvasWidth,
      canvasHeight,
    }))
    const res = await saveFloorPlan({ floors: allFloors })
    setSaving(false)
    if (res.ok) {
      savedSnapshotRef.current = serializeFloors()
      dirtyRef.current = false
    }
    if (res.ok) pushToast('success', '도면 저장됨', {
      action: { label: '적용취소', run: () => { void swapFloorPlanWithPrev().then(r => { if (r.ok) location.reload(); else pushToast('error', r.error) }) } },
    })
    else pushToast('error', res.error)
  }

  // ── 다각형 그리기 ─────────────────────────────────────────
  const startDrawPolygon = (type: ElementType) => {
    setShowPolyMenu(false)
    setSelectedIds([])
    setVertexEditId(null)
    setDrawingPolygon({ type, points: [] })
    setDrawCursor(null)
  }

  const finalizePolygon = useCallback((rawPts: number[]) => {
    // Remove the last vertex (added by the first click of the double-click sequence)
    const pts = rawPts.slice(0, -2)
    if (pts.length < 6) { setDrawingPolygon(null); setDrawCursor(null); return }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (let i = 0; i < pts.length; i += 2) {
      if (pts[i] < minX) minX = pts[i]; if (pts[i] > maxX) maxX = pts[i]
      if (pts[i+1] < minY) minY = pts[i+1]; if (pts[i+1] > maxY) maxY = pts[i+1]
    }
    const normPts = pts.map((v, i) => i % 2 === 0 ? v - minX : v - minY)
    const def = ELEMENT_DEFAULTS[drawingPolygon!.type]
    const el: FloorPlanElement = {
      id: genId(), type: drawingPolygon!.type,
      x: minX, y: minY,
      width: Math.max(20, maxX - minX), height: Math.max(20, maxY - minY),
      rotation: 0, label: def.label, points: normPts,
    }
    const newEls = [...elementsRef.current, el]
    setElements(newEls)
    setSelectedIds([el.id])
    pushHistory(newEls)
    setDrawingPolygon(null)
    setDrawCursor(null)
  }, [drawingPolygon, pushHistory])

  // ── 정점 편집 ─────────────────────────────────────────────
  const handleVertexDrag = useCallback((elId: string, vi: number, nx: number, ny: number) => {
    setElements(prev => prev.map(el => {
      if (el.id !== elId || !el.points) return el
      const newPts = [...el.points]
      newPts[vi * 2]     = Math.round(nx - el.x)
      newPts[vi * 2 + 1] = Math.round(ny - el.y)
      return normalizePoly({ ...el, points: newPts })
    }))
  }, [])

  const handleVertexDragEnd = useCallback(() => {
    pushHistory(elementsRef.current)
  }, [pushHistory])

  const toggleVertexEdit = useCallback((id: string) => {
    setVertexEditId(prev => {
      if (prev === id) return null
      setTransformMode(false) // Transformer와 정점 핸들이 겹치지 않도록
      return id
    })
  }, [])

  // ── Stage 이벤트 ──────────────────────────────────────────
  const getCanvasPos = (stage: any) => {
    const pos = stage.getPointerPosition()
    return pos ? { x: pos.x / scale, y: pos.y / scale } : null
  }

  const handlePointerDownStage = (e: any) => {
    if (drawingPolygon) return  // handled by onClick
    if (!editMode || e.target !== e.target.getStage() || isDraggingElement.current) return
    if (vertexEditId) { setVertexEditId(null); return }
    const pos = getCanvasPos(e.target.getStage())
    if (!pos) return
    selStartRef.current = pos
    setSelBox(null); setSelectedIds([])
  }

  const handlePointerMoveStage = (e: any) => {
    if (drawingPolygon) {
      const pos = getCanvasPos(e.target.getStage())
      if (pos) setDrawCursor(pos)
      return
    }
    if (!selStartRef.current || isDraggingElement.current) return
    const pos = getCanvasPos(e.target.getStage())
    if (!pos) return
    const { x: sx, y: sy } = selStartRef.current
    const w = Math.abs(pos.x - sx), h = Math.abs(pos.y - sy)
    if (w < 6 && h < 6) return
    setSelBox({ x: Math.min(sx, pos.x), y: Math.min(sy, pos.y), w, h })
  }

  const handlePointerUpStage = () => {
    if (drawingPolygon) return
    if (!selStartRef.current) return
    if (selBox && (selBox.w > 5 || selBox.h > 5)) {
      const { x, y, w, h } = selBox
      setSelectedIds(elements.filter(el =>
        el.x < x + w && el.x + el.width > x && el.y < y + h && el.y + el.height > y
      ).map(el => el.id))
    }
    selStartRef.current = null; setSelBox(null)
  }

  const handleStageClick = (e: any) => {
    if (!drawingPolygon) return
    const now = Date.now()
    if (now - lastClickTimeRef.current < 350) return  // skip second click of dblclick
    lastClickTimeRef.current = now
    const pos = getCanvasPos(e.target.getStage())
    if (!pos) return
    setDrawingPolygon(prev => prev
      ? { ...prev, points: [...prev.points, Math.round(pos.x), Math.round(pos.y)] }
      : null
    )
  }

  const handleStageDblClick = (e: any) => {
    if (!drawingPolygon) return
    // drawingPolygon.points already has the vertex from the first click of this dblclick.
    // finalizePolygon will trim the redundant last vertex.
    finalizePolygon(drawingPolygon.points)
  }

  // ── 편집 모드 전환 ────────────────────────────────────────
  const toggleEditMode = () => {
    setEditMode(v => {
      if (v) {
        setMultiSelectMode(false); setTransformMode(false)
        setSelectedIds([]); setVertexEditId(null)
        setDrawingPolygon(null); setDrawCursor(null)
      }
      return !v
    })
  }

  const singleSelected = selectedIds.length === 1
    ? elements.find(e => e.id === selectedIds[0]) ?? null
    : null

  // ── 버튼 스타일 ───────────────────────────────────────────
  const btn    = 'px-3 py-2 text-xs rounded-lg border transition-colors shrink-0 min-h-[44px] flex items-center gap-1'
  const btnOn  = (color = 'var(--coral)') => `${btn} text-[var(--on-solid)] border-transparent`
  const btnOff = `${btn} bg-[var(--canvas)] border-[var(--warm-border)] text-[var(--warm-dark)] hover:border-[var(--coral)]`
  const btnGray = `${btn} bg-[var(--canvas)] border-[var(--warm-border)] text-[var(--warm-mid)]`
  const divider = <div className="w-px h-5 bg-[var(--warm-border)] mx-0.5 shrink-0" />

  // ── 그리기 중 preview 포인트 ──────────────────────────────
  const drawPreviewPoints = drawingPolygon && drawCursor
    ? [...drawingPolygon.points, drawCursor.x, drawCursor.y]
    : drawingPolygon?.points ?? []

  return (
    <div className="flex flex-col h-full">
      {/* ── 층 탭 ── */}
      <div className="flex items-center gap-0 border-b border-[var(--warm-border)] overflow-x-auto shrink-0"
        style={{ background: 'var(--canvas)' }}>
        {floors.map(fl => (
          <div key={fl.id}
            className={`flex items-center gap-1 px-3 py-2 text-xs border-r border-[var(--warm-border)] cursor-pointer whitespace-nowrap transition-colors shrink-0 ${fl.id === activeFloorId ? 'font-semibold text-[var(--coral)]' : 'text-[var(--warm-mid)] hover:text-[var(--warm-dark)]'}`}
            style={fl.id === activeFloorId ? { background: 'var(--cream)' } : {}}
            onClick={() => fl.id !== activeFloorId && switchFloor(fl.id)}
            onDoubleClick={() => renameFloor(fl.id)}>
            {fl.label}
            {floors.length > 1 && !viewOnly && (
              <button
                onClick={async e => { e.stopPropagation(); if (await confirmDialog({ title: `'${fl.label}'을 삭제할까요?`, message: '이 층에 배치된 도면 요소도 함께 삭제됩니다.', level: 'danger', confirmLabel: '삭제' })) deleteFloor(fl.id) }}
                className="ml-0.5 w-4 h-4 flex items-center justify-center text-[var(--warm-muted)] hover:text-[var(--danger-fg)] rounded-full text-[0.65625rem] leading-none">
                ×
              </button>
            )}
          </div>
        ))}
        {!viewOnly && (
          <button onClick={addFloor}
            className="px-3 py-2 text-xs text-[var(--warm-muted)] hover:text-[var(--coral)] transition-colors shrink-0">
            + 층 추가
          </button>
        )}
      </div>

      {/* ── 툴바 ── */}
      {!viewOnly && (
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[var(--warm-border)] shrink-0 overflow-x-auto"
          style={{ background: 'var(--cream)' }}>

          <button onClick={toggleEditMode}
            className={editMode ? `${btnOn()} bg-[var(--coral)]` : btnGray}>
            {editMode ? '편집 중' : '편집'}
          </button>

          {editMode && (<>
            {/* 다중·변형 모드 */}
            <button onClick={() => setMultiSelectMode(v => !v)}
              className={multiSelectMode ? `${btnOn()} bg-[var(--info-solid)]` : btnGray}>
              다중{multiSelectMode && ' ✓'}
            </button>
            <button onClick={() => setTransformMode(v => !v)}
              className={transformMode ? `${btnOn()} bg-[var(--deposit-fg)]` : btnGray}>
              {transformMode ? '변형 중' : '변형'}
            </button>

            {divider}

            {/* 되돌리기 */}
            <button onClick={undo} disabled={!canUndo} className={`${btnGray} disabled:opacity-30`} title="되돌리기 (Ctrl+Z)">↩</button>
            <button onClick={redo} disabled={!canRedo} className={`${btnGray} disabled:opacity-30`} title="다시실행 (Ctrl+Y)">↪</button>

            {divider}

            {/* 복사/붙여넣기 */}
            <button onClick={copySelected} disabled={selectedIds.length === 0} className={`${btnGray} disabled:opacity-30`}>복사</button>
            <button onClick={pasteClipboard} disabled={clipboard.length === 0} className={`${btnGray} disabled:opacity-30`}>붙여넣기</button>

            {elements.length > 0 && (
              <button onClick={clearAll}
                className={`${btn} bg-[var(--canvas)] border-[var(--warm-border)] text-[var(--warm-muted)] hover:border-[var(--danger-ring)] hover:text-[var(--danger-fg)]`}>
                전체 지우기
              </button>
            )}

            {divider}

            {/* 요소 추가 */}
            <span className="text-[0.65625rem] text-[var(--warm-muted)] shrink-0 hidden sm:inline">추가:</span>
            {PALETTE.map(type => (
              <button key={type} onClick={() => addElement(type)} className={btnOff}>{TYPE_LABEL[type]}</button>
            ))}

            {divider}

            {/* 다각형 그리기 */}
            <div className="relative shrink-0">
              {drawingPolygon ? (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-[var(--coral)] font-medium">
                    {TYPE_LABEL[drawingPolygon.type]} 그리는 중 ({Math.floor(drawingPolygon.points.length / 2)}개)
                  </span>
                  {drawingPolygon.points.length >= 6 && (
                    <button onClick={() => finalizePolygon(drawingPolygon.points)}
                      className={`${btn} bg-[var(--coral)] border-transparent text-[var(--on-solid)]`}>완료</button>
                  )}
                  <button onClick={() => { setDrawingPolygon(null); setDrawCursor(null) }}
                    className={btnGray}>취소</button>
                </div>
              ) : (
                <button onClick={() => setShowPolyMenu(v => !v)}
                  className={showPolyMenu ? `${btnOn()} bg-[var(--coral)]` : btnOff}>
                  다각형 ▾
                </button>
              )}
              {showPolyMenu && !drawingPolygon && (
                <div className="absolute top-full left-0 mt-1 z-30 rounded-xl border border-[var(--warm-border)] shadow-lift overflow-hidden"
                  style={{ background: 'var(--cream)', minWidth: 120 }}>
                  {PALETTE.filter(t => t !== 'label').map(type => (
                    <button key={type} onClick={() => startDrawPolygon(type)}
                      className="w-full text-left px-3 py-2 text-xs text-[var(--warm-dark)] hover:bg-[var(--canvas)] transition-colors">
                      {TYPE_LABEL[type]}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {divider}

            {/* AI 도면 인식 */}
            <button onClick={() => setAiImportOpen(true)}
              className={btnOff}>
              AI 인식
            </button>

            {bgDataUrl && (<>
              {divider}
              <button onClick={() => setShowBg(v => !v)}
                className={showBg ? `${btnOn()} bg-[var(--warning-solid)]` : btnOff}
                title="업로드한 도면 배경 이미지 표시/숨기기">
                도면 배경
              </button>
            </>)}

            {selectedIds.length > 0 && (<>
              {divider}
              <button onClick={deleteSelected}
                className={`${btn} bg-[var(--danger-bg)] border border-[var(--danger-ring)] text-[var(--danger-fg)] hover:bg-[var(--danger-bg)]`}>
                삭제 ({selectedIds.length})
              </button>
            </>)}

            {divider}
          </>)}

          <label className="flex items-center gap-1.5 text-xs text-[var(--warm-mid)] cursor-pointer shrink-0 ml-auto min-h-[44px]">
            <input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} className="accent-[var(--coral)]" />
            그리드
          </label>

          {/* 대시보드 표시 토글 */}
          <label className={`flex items-center gap-1.5 text-xs cursor-pointer shrink-0 min-h-[44px] ${dashToggling ? 'opacity-50' : ''}`}
            style={{ color: showOnDashboard ? 'var(--coral)' : 'var(--warm-muted)' }}>
            <span className="whitespace-nowrap">대시보드 표시</span>
            <div className="relative inline-flex items-center">
              <input
                type="checkbox"
                className="sr-only"
                checked={showOnDashboard}
                disabled={dashToggling}
                onChange={e => handleDashboardToggle(e.target.checked)}
              />
              <div className={`w-8 h-4 rounded-full transition-colors duration-200 ${showOnDashboard ? 'bg-[var(--coral)]' : 'bg-[var(--warm-border)]'}`} />
              <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-[var(--cream)] rounded-full shadow transition-transform duration-200 ${showOnDashboard ? 'translate-x-4' : 'translate-x-0'}`} />
            </div>
          </label>

          <button onClick={handleSave} disabled={saving}
            className={`${btn} bg-[var(--ink)] border-transparent text-[var(--canvas)] hover:opacity-80 disabled:opacity-50`}>
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      )}

      {/* ── 변형 모드 안내 ── */}
      {editMode && !transformMode && !drawingPolygon && selectedIds.length > 0 && (
        <div className="hidden md:flex items-center justify-center py-1 text-[0.6875rem] text-[var(--warm-muted)] border-b border-[var(--warm-border)]"
          style={{ background: 'var(--canvas)' }}>
          이동 모드 — 크기·회전 변경이 필요하면 <strong className="mx-1 text-[var(--deposit-fg)]">변형</strong> 버튼을 활성화하세요
        </div>
      )}

      {/* ── 다각형 그리기 안내 ── */}
      {drawingPolygon && (
        <div className="flex items-center justify-center py-1.5 text-[0.6875rem] font-medium border-b border-[var(--warm-border)]"
          style={{ background: 'var(--coral-pale)', color: 'var(--coral)' }}>
          {drawingPolygon.points.length === 0
            ? '캔버스를 클릭하여 첫 번째 꼭짓점을 추가하세요'
            : drawingPolygon.points.length < 6
              ? `꼭짓점 추가 중 (${Math.floor(drawingPolygon.points.length / 2)}개) · 최소 3개 필요`
              : `꼭짓점 ${Math.floor(drawingPolygon.points.length / 2)}개. 더블클릭하거나 완료 버튼을 눌러 닫으세요`}
        </div>
      )}

      {/* ── 본문 ── */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* 캔버스 */}
        <div ref={containerRef} className="flex-1 overflow-auto"
          style={{
            background: 'var(--cream-2)',
            touchAction: (editMode && !drawingPolygon) ? 'none' : 'auto',
            cursor: drawingPolygon ? 'crosshair' : 'default',
          }}>
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
                onClick={handleStageClick}
                onDblClick={handleStageDblClick}
              >
                <Layer>
                  <Rect width={canvasWidth} height={canvasHeight} fill="#faf6ef" listening={false} />
                  {showBg && bgImg && (
                    <KonvaImage
                      image={bgImg}
                      x={0} y={0}
                      width={canvasWidth} height={canvasHeight}
                      opacity={0.25}
                      listening={false}
                    />
                  )}
                  {showGrid && <GridLines width={canvasWidth} height={canvasHeight} />}

                  {elements.map(el => (
                    <PlanElement
                      key={el.id} el={el}
                      isSelected={selectedIds.includes(el.id)}
                      editMode={editMode && !drawingPolygon}
                      roomStatus={el.roomNo ? roomStatuses[el.roomNo] : undefined}
                      onElementClick={handleElementClick}
                      onDragStart={handleDragStart}
                      onDragMove={handleDragMove}
                      onDragEnd={handleDragEnd}
                      registerRef={registerRef}
                      allElements={elements}
                    />
                  ))}

                  {/* 정점 편집 핸들 */}
                  {vertexEditId && (() => {
                    const el = elements.find(e => e.id === vertexEditId)
                    if (!el?.points) return null
                    return el.points.reduce<React.ReactNode[]>((acc, _, idx) => {
                      if (idx % 2 !== 0) return acc
                      const vi = idx / 2
                      const cx = el.x + el.points![idx]
                      const cy = el.y + el.points![idx + 1]
                      acc.push(
                        <Circle key={vi}
                          x={cx} y={cy} radius={6}
                          fill="white" stroke="#e84a1a" strokeWidth={1.5}
                          draggable
                          onDragMove={(e: any) => handleVertexDrag(el.id, vi, e.target.x(), e.target.y())}
                          onDragEnd={handleVertexDragEnd}
                        />
                      )
                      return acc
                    }, [])
                  })()}

                  {/* 다각형 그리기 preview */}
                  {drawingPolygon && drawPreviewPoints.length >= 4 && (
                    <Line
                      points={drawPreviewPoints}
                      stroke="var(--coral)" strokeWidth={1.5}
                      dash={[4, 3]} listening={false}
                      fill="rgba(232,74,26,0.08)"
                      closed={drawingPolygon.points.length >= 6}
                    />
                  )}
                  {drawingPolygon && drawingPolygon.points.length >= 2 && drawPreviewPoints.length >= 2 && (
                    <Circle
                      x={drawingPolygon.points[0]}
                      y={drawingPolygon.points[1]}
                      radius={5} fill="var(--coral)"
                      listening={false}
                    />
                  )}

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
        {editMode && !drawingPolygon && singleSelected && (
          <div className="hidden md:block w-52 shrink-0 border-l border-[var(--warm-border)] overflow-y-auto"
            style={{ background: 'var(--cream)' }}>
            <PropertiesPanel
              el={singleSelected} rooms={rooms}
              onChange={patch => updateElement(singleSelected.id, patch)}
              onDelete={deleteSelected}
              onCommit={commitHistory}
              onToggleVertexEdit={() => toggleVertexEdit(singleSelected.id)}
              isVertexEditing={vertexEditId === singleSelected.id}
            />
          </div>
        )}

        {editMode && !drawingPolygon && selectedIds.length > 1 && (
          <div className="hidden md:flex md:flex-col w-52 shrink-0 border-l border-[var(--warm-border)] overflow-y-auto"
            style={{ background: 'var(--cream)' }}>
            <div className="px-4 pt-4 pb-2">
              <p className="text-xs font-semibold text-[var(--warm-dark)]">{selectedIds.length}개 선택됨</p>
              <p className="text-[0.6875rem] text-[var(--warm-muted)] mt-1">
                {transformMode ? '핸들로 함께 이동·크기 변경·회전' : '함께 이동 가능 · 크기·회전은 변형 모드 켜기'}
              </p>
            </div>
            <div className="border-t border-[var(--warm-border)] pt-3">
              <AlignPanel count={selectedIds.length} onAlign={alignElements} />
            </div>
            <div className="border-t border-[var(--warm-border)] px-4 py-3 space-y-2">
              <button onClick={copySelected}
                className="w-full text-xs border border-[var(--warm-border)] bg-[var(--canvas)] rounded-lg py-2 text-[var(--warm-dark)] hover:border-[var(--coral)] transition-colors">
                복사
              </button>
              <button onClick={deleteSelected}
                className="w-full text-xs text-[var(--danger-fg)] border border-[var(--danger-ring)] bg-[var(--danger-bg)] hover:bg-[var(--danger-bg)] rounded-lg py-2 transition-colors">
                선택 삭제
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 모바일 하단 시트 */}
      {editMode && !drawingPolygon && singleSelected && (
        <BottomSheet title={TYPE_LABEL[singleSelected.type]} onClose={() => setSelectedIds([])}>
          <PropertiesPanel
            el={singleSelected} rooms={rooms}
            onChange={patch => updateElement(singleSelected.id, patch)}
            onDelete={deleteSelected}
            onCommit={commitHistory}
            onToggleVertexEdit={() => toggleVertexEdit(singleSelected.id)}
            isVertexEditing={vertexEditId === singleSelected.id}
          />
        </BottomSheet>
      )}

      {/* 다중 선택 안내 (모바일) */}
      {editMode && multiSelectMode && selectedIds.length === 0 && !drawingPolygon && (
        <div className="md:hidden fixed bottom-4 inset-x-4 z-30 pointer-events-none">
          <div className="rounded-xl px-4 py-2.5 text-xs text-center text-[var(--warm-dark)]"
            style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
            요소를 탭하여 선택하세요. 여러 개 선택 가능합니다.
          </div>
        </div>
      )}

      {/* AI 임포트 모달 */}
      {aiImportOpen && (
        <AiImportModal
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          onConfirm={handleAiImportConfirm}
          onCancel={() => setAiImportOpen(false)}
        />
      )}

      {/* 다각형 메뉴 외부 클릭 닫기 */}
      {showPolyMenu && (
        <div className="fixed inset-0 z-20" onClick={() => setShowPolyMenu(false)} />
      )}

      {/* 층 이름 변경: 정본 Modal (window.prompt 대체) */}
      {renameTarget && (
        <Modal open onClose={() => setRenameTarget(null)} width="xs" title="층 이름 변경"
          footer={
            <ModalFooterActions onCancel={() => setRenameTarget(null)}>
              <Btn variant="primary" size="sm" onClick={commitRename}>변경</Btn>
            </ModalFooterActions>
          }>
          <div className="p-5">
            <input
              type="text"
              autoFocus
              value={renameTarget.value}
              onChange={e => setRenameTarget(t => t ? { ...t, value: e.target.value } : t)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitRename() } }}
              placeholder="층 이름"
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]"
            />
          </div>
        </Modal>
      )}
    </div>
  )
}
