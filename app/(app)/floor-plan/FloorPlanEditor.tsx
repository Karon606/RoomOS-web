'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Stage, Layer, Rect, Text, Group, Transformer, Line } from 'react-konva'
import { type FloorPlanData, type FloorPlanElement, type ElementType, saveFloorPlan } from './actions'
import { pushToast } from '@/lib/saveStatus'

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

function GridLines({ width, height, size = 20 }: { width: number; height: number; size?: number }) {
  const lines: React.ReactNode[] = []
  for (let y = 0; y <= height; y += size)
    lines.push(<Line key={`h${y}`} points={[0, y, width, y]} stroke="#d0c8bc" strokeWidth={0.5} dash={[2, 4]} />)
  for (let x = 0; x <= width; x += size)
    lines.push(<Line key={`v${x}`} points={[x, 0, x, height]} stroke="#d0c8bc" strokeWidth={0.5} dash={[2, 4]} />)
  return <>{lines}</>
}

function PlanElement({
  el, isSelected, onSelect, onChange, editMode, roomStatus,
}: {
  el: FloorPlanElement
  isSelected: boolean
  onSelect: () => void
  onChange: (patch: Partial<FloorPlanElement>) => void
  editMode: boolean
  roomStatus?: { isVacant: boolean; tenantName?: string }
}) {
  const groupRef = useRef<any>(null)
  const trRef    = useRef<any>(null)
  const def      = ELEMENT_DEFAULTS[el.type]

  const fill   = el.fill ?? def.fill
  const stroke = def.stroke
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

  const handleDragEnd = (e: any) => onChange({ x: Math.round(e.target.x()), y: Math.round(e.target.y()) })

  const handleTransformEnd = () => {
    const node = groupRef.current
    if (!node) return
    const scaleX = node.scaleX(), scaleY = node.scaleY()
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
          stroke={isSelected ? 'var(--coral, #e84a1a)' : stroke}
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
          fontSize={fontSize}
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
          <p className="text-[10px] text-[var(--warm-muted)]">너비 px</p>
          <input type="number" className={inputCls} value={el.width}
            onChange={e => onChange({ width: Math.max(20, Number(e.target.value)) })} />
        </div>
        <div className="space-y-1">
          <p className="text-[10px] text-[var(--warm-muted)]">높이 px</p>
          <input type="number" className={inputCls} value={el.height}
            onChange={e => onChange({ height: Math.max(20, Number(e.target.value)) })} />
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
            <input type="color"
              value={el.fill ?? ELEMENT_DEFAULTS[el.type].fill}
              onChange={e => onChange({ fill: e.target.value })}
              className="w-8 h-7 rounded cursor-pointer border border-[var(--warm-border)]" />
            <button onClick={() => onChange({ fill: undefined })}
              className="text-[10px] text-[var(--warm-muted)] hover:text-[var(--warm-dark)]">
              초기화
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

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

  const [mounted, setMounted]         = useState(false)
  const [elements, setElements]       = useState<FloorPlanElement[]>(initialData?.elements ?? [])
  const [canvasWidth]                 = useState(initialData?.canvasWidth  ?? DEFAULT_W)
  const [canvasHeight]                = useState(initialData?.canvasHeight ?? DEFAULT_H)
  const [selectedId, setSelectedId]   = useState<string | null>(null)
  const [editMode, setEditMode]       = useState(!viewOnly)
  const [saving, setSaving]           = useState(false)
  const [showGrid, setShowGrid]       = useState(true)

  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(() => {
      setScale(Math.min(1, el.clientWidth / canvasWidth))
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [canvasWidth])

  const selectedEl = elements.find(e => e.id === selectedId) ?? null

  const addElement = (type: ElementType) => {
    const def = ELEMENT_DEFAULTS[type]
    const el: FloorPlanElement = {
      id: genId(), type,
      x: 60 + Math.random() * 80,
      y: 60 + Math.random() * 80,
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

  const btnBase = 'px-2.5 py-1.5 text-xs rounded-lg border transition-colors'
  const btnIdle = `${btnBase} bg-[var(--canvas)] border-[var(--warm-border)] text-[var(--warm-dark)] hover:border-[var(--coral)]`

  return (
    <div className="flex flex-col h-full">
      {/* 툴바 */}
      {!viewOnly && (
        <div
          className="flex items-center gap-1.5 px-3 py-2 border-b border-[var(--warm-border)] shrink-0 overflow-x-auto"
          style={{ background: 'var(--cream)' }}
        >
          {/* 편집/보기 토글 */}
          <button
            onClick={() => { setEditMode(v => !v); setSelectedId(null) }}
            className={`${btnBase} shrink-0 font-medium ${
              editMode
                ? 'bg-[var(--coral)] border-[var(--coral)] text-white'
                : 'bg-[var(--canvas)] border-[var(--warm-border)] text-[var(--warm-mid)]'
            }`}
          >
            {editMode ? '편집 중' : '편집'}
          </button>

          {editMode && (
            <>
              <div className="w-px h-4 bg-[var(--warm-border)] shrink-0 mx-0.5" />
              <span className="text-[10px] text-[var(--warm-muted)] shrink-0">추가:</span>
              {PALETTE.map(type => (
                <button key={type} onClick={() => addElement(type)}
                  className={`${btnIdle} shrink-0`}>
                  {TYPE_LABEL[type]}
                </button>
              ))}
              <div className="w-px h-4 bg-[var(--warm-border)] shrink-0 mx-0.5" />
            </>
          )}

          <label className="flex items-center gap-1 text-xs text-[var(--warm-mid)] cursor-pointer shrink-0 ml-auto">
            <input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)}
              className="accent-[var(--coral)]" />
            그리드
          </label>

          <button onClick={handleSave} disabled={saving}
            className={`${btnBase} shrink-0 font-medium bg-[var(--ink)] border-[var(--ink)] text-[var(--canvas)] hover:opacity-80 disabled:opacity-50`}>
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      )}

      {/* 본문 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 캔버스 */}
        <div ref={containerRef} className="flex-1 overflow-auto" style={{ background: 'var(--cream-2, #f0ebe0)' }}>
          {mounted ? (
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
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-[var(--warm-muted)]">도면 로딩 중…</p>
            </div>
          )}
        </div>

        {/* 속성 패널 */}
        {editMode && selectedEl && (
          <div className="w-48 shrink-0 border-l border-[var(--warm-border)] overflow-y-auto"
            style={{ background: 'var(--cream)' }}>
            <PropertiesPanel
              el={selectedEl}
              rooms={rooms}
              onChange={patch => updateElement(selectedEl.id, patch)}
              onDelete={() => deleteElement(selectedEl.id)}
            />
          </div>
        )}
      </div>

      {/* 빈 상태 안내 */}
      {mounted && editMode && elements.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ top: 44 }}>
          <div className="text-center px-6 py-4 rounded-xl" style={{ background: 'rgba(250,246,239,0.9)' }}>
            <p className="text-sm text-[var(--warm-dark)] font-medium mb-1">도면이 비어 있습니다</p>
            <p className="text-xs text-[var(--warm-muted)]">위 툴바에서 요소를 클릭해 캔버스에 추가하세요</p>
          </div>
        </div>
      )}
    </div>
  )
}
