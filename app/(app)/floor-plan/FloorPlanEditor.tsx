'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { type FloorPlanData, type FloorPlanElement, type ElementType, saveFloorPlan } from './actions'
import { pushToast } from '@/lib/saveStatus'

// react-konva는 SSR 불가 → dynamic import
const Stage    = dynamic(() => import('react-konva').then(m => m.Stage),    { ssr: false })
const Layer    = dynamic(() => import('react-konva').then(m => m.Layer),    { ssr: false })
const Rect     = dynamic(() => import('react-konva').then(m => m.Rect),     { ssr: false })
const Text     = dynamic(() => import('react-konva').then(m => m.Text),     { ssr: false })
const Group    = dynamic(() => import('react-konva').then(m => m.Group),    { ssr: false })
const Transformer = dynamic(() => import('react-konva').then(m => m.Transformer), { ssr: false })
const Line     = dynamic(() => import('react-konva').then(m => m.Line),     { ssr: false })

// ── 타입 설정 ────────────────────────────────────────────────

const ELEMENT_DEFAULTS: Record<ElementType, { label: string; width: number; height: number; fill: string; stroke: string }> = {
  room:           { label: '방',   width: 80,  height: 80,  fill: '#f5f1ea', stroke: '#4d3e2e' },
  corridor:       { label: '복도', width: 200, height: 50,  fill: '#ebe1cf', stroke: '#7a6a55' },
  kitchen:        { label: '주방', width: 100, height: 80,  fill: '#fff3e0', stroke: '#b85944' },
  bathroom:       { label: '화장실', width: 60, height: 70, fill: '#e3f2fd', stroke: '#4d8fac' },
  stairs:         { label: '계단', width: 70,  height: 80,  fill: '#f3e5f5', stroke: '#7b3f9e' },
  entrance:       { label: '출입문', width: 50, height: 20, fill: '#1a1a1a', stroke: '#1a1a1a' },
  emergency_exit: { label: '비상구', width: 40, height: 20, fill: '#e84a1a', stroke: '#c83a10' },
  window:         { label: '창문', width: 60,  height: 12,  fill: '#b3d9f7', stroke: '#4d8fac' },
  label:          { label: '텍스트', width: 80, height: 30, fill: 'transparent', stroke: 'transparent' },
}

const PALETTE: { type: ElementType; icon: string }[] = [
  { type: 'room',           icon: '🚪' },
  { type: 'corridor',       icon: '↔️' },
  { type: 'kitchen',        icon: '🍳' },
  { type: 'bathroom',       icon: '🚿' },
  { type: 'stairs',         icon: '🪜' },
  { type: 'entrance',       icon: '🏠' },
  { type: 'emergency_exit', icon: '🆘' },
  { type: 'window',         icon: '🪟' },
  { type: 'label',          icon: '✏️' },
]

const TYPE_LABEL: Record<ElementType, string> = {
  room: '방', corridor: '복도', kitchen: '주방', bathroom: '화장실',
  stairs: '계단', entrance: '출입문', emergency_exit: '비상구', window: '창문', label: '텍스트',
}

function genId() { return Math.random().toString(36).slice(2, 10) }

// ── 점선 그리드 ──────────────────────────────────────────────
function GridLines({ width, height, size = 20 }: { width: number; height: number; size?: number }) {
  const hLines: number[][] = []
  const vLines: number[][] = []
  for (let y = 0; y <= height; y += size) hLines.push([0, y, width, y])
  for (let x = 0; x <= width; x += size) vLines.push([x, 0, x, height])
  return (
    <>
      {hLines.map((pts, i) => (
        <Line key={`h${i}`} points={pts} stroke="#d0c8bc" strokeWidth={0.5} dash={[2, 4]} />
      ))}
      {vLines.map((pts, i) => (
        <Line key={`v${i}`} points={pts} stroke="#d0c8bc" strokeWidth={0.5} dash={[2, 4]} />
      ))}
    </>
  )
}

// ── 개별 요소 ────────────────────────────────────────────────
function PlanElement({
  el, isSelected, onSelect, onChange, editMode,
  roomStatus,
}: {
  el: FloorPlanElement
  isSelected: boolean
  onSelect: () => void
  onChange: (updated: Partial<FloorPlanElement>) => void
  editMode: boolean
  roomStatus?: { isVacant: boolean; tenantName?: string }
}) {
  const groupRef = useRef<any>(null)
  const trRef    = useRef<any>(null)
  const def = ELEMENT_DEFAULTS[el.type]

  const fill   = el.fill ?? def.fill
  const stroke = def.stroke

  // 방 타입: 점유 상태 색상
  const bgFill =
    el.type === 'room' && roomStatus != null
      ? roomStatus.isVacant ? '#f0fdf4' : '#fff7ed'
      : fill

  useEffect(() => {
    if (isSelected && trRef.current && groupRef.current) {
      trRef.current.nodes([groupRef.current])
      trRef.current.getLayer()?.batchDraw()
    }
  }, [isSelected])

  const handleDragEnd = (e: any) => {
    onChange({ x: Math.round(e.target.x()), y: Math.round(e.target.y()) })
  }
  const handleTransformEnd = () => {
    const node = groupRef.current
    if (!node) return
    const scaleX = node.scaleX()
    const scaleY = node.scaleY()
    node.scaleX(1); node.scaleY(1)
    onChange({
      x: Math.round(node.x()),
      y: Math.round(node.y()),
      width:    Math.round(Math.max(20, el.width  * scaleX)),
      height:   Math.round(Math.max(20, el.height * scaleY)),
      rotation: Math.round(node.rotation()),
    })
  }

  const fontSize  = el.type === 'room' ? 11 : 10
  const textColor = el.type === 'entrance' || el.type === 'emergency_exit' ? '#fff' : '#2a1f15'

  return (
    <>
      <Group
        ref={groupRef}
        x={el.x} y={el.y}
        width={el.width} height={el.height}
        rotation={el.rotation}
        draggable={editMode}
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={handleDragEnd}
        onTransformEnd={handleTransformEnd}
      >
        <Rect
          width={el.width} height={el.height}
          fill={bgFill}
          stroke={isSelected ? '#e84a1a' : stroke}
          strokeWidth={isSelected ? 2 : 1}
          cornerRadius={el.type === 'room' ? 4 : 2}
          shadowEnabled={isSelected}
          shadowColor="rgba(232,74,26,0.3)"
          shadowBlur={8}
        />
        <Text
          text={el.label}
          width={el.width}
          height={el.height}
          align="center"
          verticalAlign="middle"
          fontSize={fontSize}
          fontFamily="Pretendard Variable, Pretendard, sans-serif"
          fill={textColor}
          wrap="word"
          padding={2}
        />
        {el.type === 'room' && roomStatus && (
          <Text
            text={roomStatus.isVacant ? '공실' : (roomStatus.tenantName ?? '입실')}
            width={el.width}
            y={el.height - 18}
            align="center"
            fontSize={8}
            fill={roomStatus.isVacant ? '#047857' : '#b85944'}
          />
        )}
      </Group>
      {isSelected && editMode && (
        <Transformer
          ref={trRef}
          rotateEnabled
          boundBoxFunc={(_: any, newBox: any) => ({
            ...newBox,
            width:  Math.max(20, newBox.width),
            height: Math.max(20, newBox.height),
          })}
        />
      )}
    </>
  )
}

// ── 속성 패널 ────────────────────────────────────────────────
function PropertiesPanel({
  el, rooms, onChange, onDelete,
}: {
  el: FloorPlanElement
  rooms: { roomNo: string; id: string }[]
  onChange: (updated: Partial<FloorPlanElement>) => void
  onDelete: () => void
}) {
  const inputCls = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]'
  return (
    <div className="space-y-2.5 p-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-[var(--warm-dark)]">{TYPE_LABEL[el.type]}</p>
        <button onClick={onDelete}
          className="text-[10px] text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 transition-colors">
          삭제
        </button>
      </div>

      <div className="space-y-1">
        <p className="text-[10px] text-[var(--warm-muted)]">표시 이름</p>
        <input className={inputCls} value={el.label}
          onChange={e => onChange({ label: e.target.value })} />
      </div>

      {el.type === 'room' && (
        <div className="space-y-1">
          <p className="text-[10px] text-[var(--warm-muted)]">연결 호실</p>
          <select className={inputCls} value={el.roomNo ?? ''}
            onChange={e => onChange({ roomNo: e.target.value || undefined })}>
            <option value="">연결 없음</option>
            {rooms.map(r => <option key={r.id} value={r.roomNo}>{r.roomNo}호</option>)}
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-1.5">
        <div className="space-y-1">
          <p className="text-[10px] text-[var(--warm-muted)]">너비</p>
          <input type="number" className={inputCls} value={el.width}
            onChange={e => onChange({ width: Number(e.target.value) })} />
        </div>
        <div className="space-y-1">
          <p className="text-[10px] text-[var(--warm-muted)]">높이</p>
          <input type="number" className={inputCls} value={el.height}
            onChange={e => onChange({ height: Number(e.target.value) })} />
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
            <button onClick={() => onChange({ fill: undefined })}
              className="text-[10px] text-[var(--warm-muted)] hover:text-[var(--warm-dark)]">초기화</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 메인 에디터 컴포넌트 ─────────────────────────────────────
export default function FloorPlanEditor({
  initialData,
  rooms,
  roomStatuses,
  viewOnly = false,
}: {
  initialData: FloorPlanData | null
  rooms: { id: string; roomNo: string }[]
  roomStatuses: Record<string, { isVacant: boolean; tenantName?: string }>
  viewOnly?: boolean
}) {
  const DEFAULT_W = 800
  const DEFAULT_H = 600

  const [elements, setElements] = useState<FloorPlanElement[]>(initialData?.elements ?? [])
  const [canvasWidth]  = useState(initialData?.canvasWidth  ?? DEFAULT_W)
  const [canvasHeight] = useState(initialData?.canvasHeight ?? DEFAULT_H)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editMode, setEditMode]     = useState(!viewOnly)
  const [saving, setSaving]         = useState(false)
  const [showGrid, setShowGrid]     = useState(true)

  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  // 컨테이너 크기에 맞춰 스케일 계산
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(() => {
      const w = el.clientWidth
      setScale(Math.min(1, w / canvasWidth))
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [canvasWidth])

  const selectedEl = elements.find(e => e.id === selectedId) ?? null

  const addElement = (type: ElementType) => {
    const def = ELEMENT_DEFAULTS[type]
    const el: FloorPlanElement = {
      id: genId(), type,
      x: 40 + Math.random() * 100,
      y: 40 + Math.random() * 100,
      width: def.width, height: def.height,
      rotation: 0,
      label: def.label,
    }
    setElements(prev => [...prev, el])
    setSelectedId(el.id)
  }

  const updateElement = useCallback((id: string, patch: Partial<FloorPlanElement>) => {
    setElements(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e))
  }, [])

  const deleteElement = (id: string) => {
    setElements(prev => prev.filter(e => e.id !== id))
    setSelectedId(null)
  }

  const handleSave = async () => {
    setSaving(true)
    const res = await saveFloorPlan({ elements, canvasWidth, canvasHeight })
    setSaving(false)
    if (res.ok) pushToast('success', '도면 저장됨')
    else pushToast('error', res.error)
  }

  const handleStageClick = (e: any) => {
    if (e.target === e.target.getStage()) setSelectedId(null)
  }

  return (
    <div className="flex flex-col h-full">
      {/* 상단 툴바 */}
      {!viewOnly && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--warm-border)] shrink-0 flex-wrap">
          <button
            onClick={() => { setEditMode(v => !v); setSelectedId(null) }}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              editMode
                ? 'bg-[var(--coral)] text-white'
                : 'bg-[var(--canvas)] text-[var(--warm-mid)] border border-[var(--warm-border)] hover:border-[var(--coral)]'
            }`}>
            {editMode ? '✏️ 편집 중' : '✏️ 편집'}
          </button>

          {editMode && (
            <>
              <div className="w-px h-5 bg-[var(--warm-border)]" />
              {PALETTE.map(({ type, icon }) => (
                <button key={type} onClick={() => addElement(type)}
                  title={TYPE_LABEL[type]}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg hover:border-[var(--coral)] transition-colors text-[var(--warm-dark)]">
                  <span>{icon}</span>
                  <span className="hidden sm:inline">{TYPE_LABEL[type]}</span>
                </button>
              ))}
              <div className="w-px h-5 bg-[var(--warm-border)]" />
            </>
          )}

          <label className="flex items-center gap-1.5 text-xs text-[var(--warm-mid)] cursor-pointer ml-auto">
            <input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)}
              className="accent-[var(--coral)]" />
            그리드
          </label>

          <button onClick={handleSave} disabled={saving}
            className="px-3 py-1.5 text-xs font-medium bg-[var(--ink)] text-[var(--canvas)] rounded-lg hover:opacity-80 disabled:opacity-50 transition-opacity">
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      )}

      {/* 메인 영역 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 캔버스 */}
        <div ref={containerRef} className="flex-1 overflow-auto bg-[var(--cream-2)]">
          <div style={{ width: canvasWidth * scale, height: canvasHeight * scale }}>
            <Stage
              width={canvasWidth * scale}
              height={canvasHeight * scale}
              scaleX={scale} scaleY={scale}
              onClick={handleStageClick}
              onTap={handleStageClick}
            >
              <Layer>
                <Rect width={canvasWidth} height={canvasHeight} fill="#faf6ef" />
                {showGrid && <GridLines width={canvasWidth} height={canvasHeight} />}
                {elements.map(el => (
                  <PlanElement
                    key={el.id}
                    el={el}
                    isSelected={selectedId === el.id}
                    onSelect={() => editMode && setSelectedId(el.id)}
                    onChange={patch => updateElement(el.id, patch)}
                    editMode={editMode}
                    roomStatus={el.roomNo ? roomStatuses[el.roomNo] : undefined}
                  />
                ))}
              </Layer>
            </Stage>
          </div>
        </div>

        {/* 우측 속성 패널 */}
        {editMode && selectedEl && (
          <div className="w-48 shrink-0 border-l border-[var(--warm-border)] overflow-y-auto bg-[var(--cream)]">
            <PropertiesPanel
              el={selectedEl}
              rooms={rooms}
              onChange={patch => updateElement(selectedEl.id, patch)}
              onDelete={() => deleteElement(selectedEl.id)}
            />
          </div>
        )}
      </div>

      {/* 편집 모드 안내 */}
      {editMode && elements.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-sm text-[var(--warm-muted)] bg-[var(--cream)]/80 rounded-xl px-4 py-3">
            위 버튼을 눌러 요소를 추가하세요
          </p>
        </div>
      )}
    </div>
  )
}
