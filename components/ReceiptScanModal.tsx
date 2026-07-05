'use client'

// 영수증 스캔 — 문서 모서리 자동 감지 + 드래그 조정 + 원근 보정 크롭.
// 지출 등록(FinanceClient)과 홈 '찍어 올리기'(PendingReceiptSection)가 동일 UX로 공유(2026-07-03).
import { useState, useRef, useEffect } from 'react'
import { Btn } from '@/components/ui/Btn'

// ─── Receipt scan utilities ───────────────────────────────────────────────

type CropPt = { x: number; y: number }
type CropCorners = { tl: CropPt; tr: CropPt; br: CropPt; bl: CropPt }
type EdgeKey = 'top' | 'right' | 'bottom' | 'left'
const EDGES: Record<EdgeKey, [keyof CropCorners, keyof CropCorners]> = {
  top: ['tl', 'tr'], right: ['tr', 'br'], bottom: ['br', 'bl'], left: ['bl', 'tl'],
}

function gaussSolve(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let max = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[max][c])) max = r
    ;[M[c], M[max]] = [M[max], M[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j]
    }
  }
  return M.map((row, i) => row[n] / row[i])
}

function buildHomography(srcPts: [number, number][], dstPts: [number, number][]): number[][] {
  const A: number[][] = [], b: number[] = []
  for (let i = 0; i < 4; i++) {
    const [sx, sy] = srcPts[i], [dx, dy] = dstPts[i]
    A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]); b.push(dx)
    A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]); b.push(dy)
  }
  const h = gaussSolve(A, b)
  return [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]]
}

function applyHomographyPt(H: number[][], x: number, y: number): [number, number] {
  const w = H[2][0] * x + H[2][1] * y + H[2][2]
  return [(H[0][0] * x + H[0][1] * y + H[0][2]) / w, (H[1][0] * x + H[1][1] * y + H[1][2]) / w]
}

function detectRegion(bitmap: ImageBitmap): CropCorners | null {
  const SIZE = 320
  const sc = Math.min(SIZE / bitmap.width, SIZE / bitmap.height)
  const cW = Math.round(bitmap.width * sc), cH = Math.round(bitmap.height * sc)
  const canvas = document.createElement('canvas')
  canvas.width = cW; canvas.height = cH
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, cW, cH)
  const { data } = canvas.getContext('2d')!.getImageData(0, 0, cW, cH)
  const px = (x: number, y: number) => { const i = (y * cW + x) * 4; return [data[i], data[i + 1], data[i + 2]] }
  const c4 = [px(0, 0), px(cW - 1, 0), px(cW - 1, cH - 1), px(0, cH - 1)]
  const bg = [c4.reduce((s, p) => s + p[0], 0) / 4, c4.reduce((s, p) => s + p[1], 0) / 4, c4.reduce((s, p) => s + p[2], 0) / 4]
  let left = cW, top = cH, right = 0, bottom = 0
  for (let y = 0; y < cH; y++) for (let x = 0; x < cW; x++) {
    const [r, g, b] = px(x, y)
    if (Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]) > 40) {
      if (x < left) left = x; if (x > right) right = x
      if (y < top) top = y; if (y > bottom) bottom = y
    }
  }
  if (left >= right || top >= bottom) return null   // 배경과 구분되는 문서 영역 없음
  const nx = (v: number) => Math.max(0, Math.min(1, v / cW))
  const ny = (v: number) => Math.max(0, Math.min(1, v / cH))
  return { tl: { x: nx(left), y: ny(top) }, tr: { x: nx(right), y: ny(top) }, br: { x: nx(right), y: ny(bottom) }, bl: { x: nx(left), y: ny(bottom) } }
}

// 문서 영역 감지 성공 시에만 모서리 반환 — 홈 '찍어 올리기'의 영수증 판별용(실패 = 영수증 아님으로 간주)
export function tryDetectDocumentCorners(bitmap: ImageBitmap): CropCorners | null {
  return detectRegion(bitmap)
}

function detectDocumentCorners(bitmap: ImageBitmap): CropCorners {
  const pad = 0.03
  return detectRegion(bitmap) ?? { tl: { x: pad, y: pad }, tr: { x: 1 - pad, y: pad }, br: { x: 1 - pad, y: 1 - pad }, bl: { x: pad, y: 1 - pad } }
}

async function warpReceiptToRect(bitmap: ImageBitmap, corners: CropCorners): Promise<{ dataUrl: string; base64: string }> {
  const iW = bitmap.width, iH = bitmap.height
  const tl: [number, number] = [corners.tl.x * iW, corners.tl.y * iH]
  const tr: [number, number] = [corners.tr.x * iW, corners.tr.y * iH]
  const br: [number, number] = [corners.br.x * iW, corners.br.y * iH]
  const bl: [number, number] = [corners.bl.x * iW, corners.bl.y * iH]
  const dist = (a: [number, number], b: [number, number]) => Math.hypot(b[0] - a[0], b[1] - a[1])
  const oW = Math.max(1, Math.round(Math.max(dist(tl, tr), dist(bl, br))))
  const oH = Math.max(1, Math.round(Math.max(dist(tl, bl), dist(tr, br))))
  const H = buildHomography([[0, 0], [oW, 0], [oW, oH], [0, oH]], [tl, tr, br, bl])
  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = iW; srcCanvas.height = iH
  srcCanvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  const src = srcCanvas.getContext('2d')!.getImageData(0, 0, iW, iH).data
  const outCanvas = document.createElement('canvas')
  outCanvas.width = oW; outCanvas.height = oH
  const outCtx = outCanvas.getContext('2d')!
  const outImg = outCtx.createImageData(oW, oH)
  const out = outImg.data
  for (let y = 0; y < oH; y++) {
    for (let x = 0; x < oW; x++) {
      const [sx, sy] = applyHomographyPt(H, x, y)
      const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = x0 + 1, y1 = y0 + 1
      const fx = sx - x0, fy = sy - y0
      const oi = (y * oW + x) * 4
      const ch = (px: number, py: number, c: number) => (px < 0 || py < 0 || px >= iW || py >= iH) ? 255 : src[(py * iW + px) * 4 + c]
      for (let c = 0; c < 4; c++)
        out[oi + c] = (ch(x0, y0, c) * (1 - fx) * (1 - fy) + ch(x1, y0, c) * fx * (1 - fy) + ch(x0, y1, c) * (1 - fx) * fy + ch(x1, y1, c) * fx * fy + 0.5) | 0
    }
  }
  outCtx.putImageData(outImg, 0, 0)
  const dataUrl = outCanvas.toDataURL('image/jpeg', 0.92)
  return { dataUrl, base64: dataUrl.replace(/^data:image\/jpeg;base64,/, '') }
}

export function dataUrlToFile(dataUrl: string, name: string): File {
  const [header, b64] = dataUrl.split(',')
  const mime = (header.match(/:(.*?);/) ?? ['', 'image/jpeg'])[1]
  const bytes = atob(b64); const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return new File([arr], name, { type: mime })
}

// ─── ReceiptScanModal ─────────────────────────────────────────────────────

function CornerHandle({ cx, cy, containerRef, onMove, onStart, onEnd, variant = 'corner' }: {
  cx: number; cy: number
  containerRef: React.RefObject<HTMLDivElement | null>
  onMove: (x: number, y: number) => void
  onStart?: () => void
  onEnd?: () => void
  variant?: 'corner' | 'edge'   // edge = 변 중앙 핸들(작게·반전색) — 변 전체를 법선 방향으로 평행이동
}) {
  const SIZE = variant === 'corner' ? 28 : 22
  return (
    <div
      style={{
        position: 'absolute', left: cx - SIZE / 2, top: cy - SIZE / 2,
        width: SIZE, height: SIZE, borderRadius: '50%',
        background: variant === 'corner' ? 'var(--coral)' : 'white',
        border: variant === 'corner' ? '3px solid white' : '3px solid var(--coral)',
        cursor: 'grab', touchAction: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.5)', zIndex: 2,
      }}
      onPointerDown={e => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        onStart?.()
      }}
      onPointerMove={e => {
        if (!(e.buttons & 1)) return
        const rect = containerRef.current?.getBoundingClientRect()
        if (!rect) return
        onMove(Math.max(0, Math.min(rect.width, e.clientX - rect.left)), Math.max(0, Math.min(rect.height, e.clientY - rect.top)))
      }}
      onPointerUp={() => onEnd?.()}
      onPointerCancel={() => onEnd?.()}
    />
  )
}

// 모서리 드래그 중 원본 해상도에서 잘라낸 작은 영역을 확대해 표시.
// 손가락이 코너를 가려도 화면 위의 확대경으로 정확히 픽셀 단위 조정 가능.
function CornerLoupe({ bitmap, cornerX, cornerY, dW, dH }: {
  bitmap: ImageBitmap
  cornerX: number; cornerY: number
  dW: number; dH: number
}) {
  const SIZE = 120
  const MAG = 2.8
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // 원본 비트맵에서 잘라낼 영역 (코너 중심으로)
  const sourceX = (cornerX / dW) * bitmap.width
  const sourceY = (cornerY / dH) * bitmap.height
  const srcW = SIZE / MAG / (dW / bitmap.width)
  const srcH = SIZE / MAG / (dH / bitmap.height)
  const sx = sourceX - srcW / 2
  const sy = sourceY - srcH / 2

  useEffect(() => {
    const c = canvasRef.current; if (!c) return
    const ctx = c.getContext('2d'); if (!ctx) return
    ctx.clearRect(0, 0, SIZE, SIZE)
    // 비트맵을 그리기 전에 원형 클립
    ctx.save()
    ctx.beginPath()
    ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2)
    ctx.clip()
    // 비어보일 수 있는 가장자리 흰색으로 채워두기
    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.fillRect(0, 0, SIZE, SIZE)
    // 코너가 이미지 가장자리에 있을 때(예: 우측 하단 모서리) sx/sy 가 음수이거나
    // sx+srcW 가 bitmap.width 를 넘어서 source 사각형의 일부가 bitmap 밖으로 벗어남.
    // 단순 drawImage 는 그 잘려나간 만큼 destination 의 (0,0) 부터 그리기 때문에
    // 결과적으로 십자선이 가리키는 위치가 어긋남 (사용자 진단 2026-06-01).
    // 해결: bitmap 영역 안으로 잘린 source 만 그리되, destination 위치도 같은 비율로
    // 이동시켜 핸들 위치(sourceX,sourceY) 가 캔버스 중앙(SIZE/2,SIZE/2) 에 오게 유지한다.
    let drawSx = sx, drawSy = sy
    let drawSw = srcW, drawSh = srcH
    let drawDx = 0, drawDy = 0
    const pxPerSrcX = SIZE / srcW
    const pxPerSrcY = SIZE / srcH
    if (drawSx < 0) { drawDx = -drawSx * pxPerSrcX; drawSw = srcW + drawSx; drawSx = 0 }
    if (drawSy < 0) { drawDy = -drawSy * pxPerSrcY; drawSh = srcH + drawSy; drawSy = 0 }
    if (drawSx + drawSw > bitmap.width)  drawSw = bitmap.width  - drawSx
    if (drawSy + drawSh > bitmap.height) drawSh = bitmap.height - drawSy
    if (drawSw > 0 && drawSh > 0) {
      const drawDw = drawSw * pxPerSrcX
      const drawDh = drawSh * pxPerSrcY
      ctx.drawImage(bitmap, drawSx, drawSy, drawSw, drawSh, drawDx, drawDy, drawDw, drawDh)
    }
    ctx.restore()
  }, [sx, sy, srcW, srcH, bitmap])

  // 위치: 기본은 코너 위로 18px, 화면 위로 넘어가면 아래로 fallback.
  // 가로는 코너 중심으로 두되 컨테이너 안에서 클램프.
  const aboveY = cornerY - SIZE - 22
  const useAbove = aboveY > 4
  const top = useAbove ? aboveY : cornerY + 28
  const left = Math.max(4, Math.min(dW - SIZE - 4, cornerX - SIZE / 2))

  return (
    <div
      style={{
        position: 'absolute', left, top, width: SIZE, height: SIZE,
        borderRadius: '50%', border: '3px solid white',
        boxShadow: '0 6px 16px rgba(0,0,0,0.55)', pointerEvents: 'none',
        zIndex: 3, overflow: 'hidden',
      }}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} width={SIZE} height={SIZE} />
      {/* 십자선 — 정확한 픽셀 위치 표시 */}
      <div style={{ position: 'absolute', top: '50%', left: 0, width: '100%', height: 1, background: 'var(--coral)', opacity: 0.85 }} />
      <div style={{ position: 'absolute', left: '50%', top: 0, height: '100%', width: 1, background: 'var(--coral)', opacity: 0.85 }} />
      <div style={{ position: 'absolute', top: '50%', left: '50%', width: 6, height: 6, marginTop: -3, marginLeft: -3, borderRadius: '50%', border: '1.5px solid white', background: 'transparent' }} />
    </div>
  )
}

export function ReceiptScanModal({ bitmap, onConfirm, onCancel }: {
  bitmap: ImageBitmap
  onConfirm: (result: { dataUrl: string; base64: string }) => void
  onCancel: () => void
}) {
  const MAX_DIM = Math.min(window.innerWidth * 0.92, window.innerHeight * 0.62, 520)
  const sc = Math.min(MAX_DIM / bitmap.width, MAX_DIM / bitmap.height)
  const dW = Math.round(bitmap.width * sc), dH = Math.round(bitmap.height * sc)
  const [corners, setCorners] = useState<CropCorners>(() => detectDocumentCorners(bitmap))
  const [processing, setProcessing] = useState(false)
  const [activeHandle, setActiveHandle] = useState<keyof CropCorners | EdgeKey | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, dW, dH)
  }, [bitmap, dW, dH])

  const moveCorner = (key: keyof CropCorners, x: number, y: number) =>
    setCorners(prev => ({ ...prev, [key]: { x: x / dW, y: y / dH } }))

  // 변 중앙 핸들 — 변 전체를 그 변의 90도(법선) 방향으로 평행이동(운영자 요청 2026-07-06).
  // 포인터 이동의 법선 성분만 취해 변의 방향·길이는 유지, 양 끝점이 캔버스를 벗어나지 않게 t 클램프.
  const moveEdge = (edge: EdgeKey, px: number, py: number) =>
    setCorners(prev => {
      const [k1, k2] = EDGES[edge]
      const a = { x: prev[k1].x * dW, y: prev[k1].y * dH }
      const b = { x: prev[k2].x * dW, y: prev[k2].y * dH }
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
      const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len
      let t = (px - (a.x + b.x) / 2) * nx + (py - (a.y + b.y) / 2) * ny
      let tMin = -Infinity, tMax = Infinity
      const bound = (pos: number, n: number, limit: number) => {
        if (Math.abs(n) < 1e-6) return
        const lo = (0 - pos) / n, hi = (limit - pos) / n
        tMin = Math.max(tMin, Math.min(lo, hi)); tMax = Math.min(tMax, Math.max(lo, hi))
      }
      bound(a.x, nx, dW); bound(a.y, ny, dH); bound(b.x, nx, dW); bound(b.y, ny, dH)
      t = Math.max(tMin, Math.min(tMax, t))
      return {
        ...prev,
        [k1]: { x: (a.x + nx * t) / dW, y: (a.y + ny * t) / dH },
        [k2]: { x: (b.x + nx * t) / dW, y: (b.y + ny * t) / dH },
      }
    })

  const handleConfirm = async () => {
    setProcessing(true)
    try {
      const MAX = 1600
      const compSc = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height))
      const cW = Math.round(bitmap.width * compSc), cH = Math.round(bitmap.height * compSc)
      const compCanvas = document.createElement('canvas')
      compCanvas.width = cW; compCanvas.height = cH
      compCanvas.getContext('2d')!.drawImage(bitmap, 0, 0, cW, cH)
      const compBitmap = await createImageBitmap(compCanvas)
      const result = await warpReceiptToRect(compBitmap, corners)
      compBitmap.close?.()
      onConfirm(result)
    } catch {
      const c = document.createElement('canvas'); c.width = bitmap.width; c.height = bitmap.height
      c.getContext('2d')!.drawImage(bitmap, 0, 0)
      const dataUrl = c.toDataURL('image/jpeg', 0.85)
      onConfirm({ dataUrl, base64: dataUrl.replace(/^data:image\/jpeg;base64,/, '') })
    } finally { setProcessing(false) }
  }

  const pts = `${corners.tl.x*dW},${corners.tl.y*dH} ${corners.tr.x*dW},${corners.tr.y*dH} ${corners.br.x*dW},${corners.br.y*dH} ${corners.bl.x*dW},${corners.bl.y*dH}`

  return (
    <div className="fixed inset-0 z-[var(--z-lightbox)] flex flex-col items-center justify-center bg-black/92">
      <p className="text-white text-sm font-medium mb-4 px-4 text-center">모서리를 드래그해 맞추세요. 변 가운데 흰 점을 끌면 그 변 전체가 움직여요</p>
      <div ref={containerRef} className="relative" style={{ width: dW, height: dH, touchAction: 'none' }}>
        <canvas ref={canvasRef} width={dW} height={dH} className="block rounded-xl" />
        <svg className="absolute inset-0 pointer-events-none rounded-xl" width={dW} height={dH}>
          <path fillRule="evenodd" fill="rgba(0,0,0,0.45)"
            d={`M0,0 L${dW},0 L${dW},${dH} L0,${dH} Z M${pts.replace(/ /g,' L')} Z`} />
          <polygon points={pts} fill="none" stroke="var(--coral)" strokeWidth="2.5" />
        </svg>
        {(['tl', 'tr', 'br', 'bl'] as const).map(key => (
          <CornerHandle key={key} cx={corners[key].x * dW} cy={corners[key].y * dH}
            containerRef={containerRef}
            onMove={(x, y) => moveCorner(key, x, y)}
            onStart={() => setActiveHandle(key)}
            onEnd={() => setActiveHandle(null)}
          />
        ))}
        {(Object.keys(EDGES) as EdgeKey[]).map(edge => {
          const [k1, k2] = EDGES[edge]
          return (
            <CornerHandle key={edge} variant="edge"
              cx={(corners[k1].x + corners[k2].x) / 2 * dW}
              cy={(corners[k1].y + corners[k2].y) / 2 * dH}
              containerRef={containerRef}
              onMove={(x, y) => moveEdge(edge, x, y)}
              onStart={() => setActiveHandle(edge)}
              onEnd={() => setActiveHandle(null)}
            />
          )
        })}
        {activeHandle && (() => {
          const pos = activeHandle in EDGES
            ? (() => { const [k1, k2] = EDGES[activeHandle as EdgeKey]; return { x: (corners[k1].x + corners[k2].x) / 2, y: (corners[k1].y + corners[k2].y) / 2 } })()
            : corners[activeHandle as keyof CropCorners]
          return <CornerLoupe bitmap={bitmap} cornerX={pos.x * dW} cornerY={pos.y * dH} dW={dW} dH={dH} />
        })()}
      </div>
      <div className="flex gap-3 mt-6">
        <button type="button" onClick={onCancel}
          className="px-6 py-2.5 rounded-xl bg-white/15 text-white text-sm font-medium hover:bg-white/25 transition-colors">
          취소
        </button>
        <Btn variant="primary" size="md" onClick={handleConfirm} disabled={processing}>
          {processing ? '처리 중…' : '영역 확정'}
        </Btn>
      </div>
    </div>
  )
}

