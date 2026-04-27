'use client'

import { useState, useTransition, useCallback } from 'react'
import {
  createSurvey,
  updateSurveyStrategy,
  addCompetitor,
  updateCompetitor,
  deleteCompetitor,
  deleteSurvey,
} from './actions'
import type { RoomPrice } from './actions'

// ── Types ─────────────────────────────────────────────────────

type Room = {
  id: string
  roomNo: string
  type: string | null
  baseRent: number
  isVacant: boolean
}

type Property = {
  id: string
  name: string
  address: string | null
  rooms: Room[]
}

type Competitor = {
  id: string
  name: string
  address: string
  naverPlaceUrl: string | null
  roomPrices: unknown
  notes: string | null
  createdAt: Date
  updatedAt: Date
  marketSurveyId: string
}

type Survey = {
  id: string
  surveyedAt: Date
  strategy: string | null
  aiResult: string | null
  notes: string | null
  createdAt: Date
  updatedAt: Date
  propertyId: string
  competitors: Competitor[]
}

type NaverItem = {
  title: string
  address: string
  roadAddress: string
  link: string
}

// ── Label maps (구 enum → 한국어, 마이그레이션 전 데이터 호환) ──

const WINDOW_TYPE_LABEL: Record<string, string> = {
  OUTER: '외창', INNER: '내창',
}
const DIRECTION_LABEL: Record<string, string> = {
  NORTH: '북향', NORTH_EAST: '북동향', EAST: '동향', SOUTH_EAST: '남동향',
  SOUTH: '남향', SOUTH_WEST: '남서향', WEST: '서향', NORTH_WEST: '북서향',
}

function getWindowLabel(val: string) { return WINDOW_TYPE_LABEL[val] ?? val }
function getDirectionLabel(val: string) { return DIRECTION_LABEL[val] ?? val }

// ── Helpers ───────────────────────────────────────────────────

function parseRoomPrices(raw: unknown): RoomPrice[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (r): r is RoomPrice =>
      typeof r === 'object' &&
      r !== null &&
      typeof (r as RoomPrice).type === 'string' &&
      typeof (r as RoomPrice).price === 'number',
  )
}

function fmtDate(d: Date | string) {
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function fmtMoney(n: number) {
  return n.toLocaleString('ko-KR') + '원'
}

/** 방타입별 평균 단가 집계 */
function aggregateRoomTypes(rooms: Room[]) {
  const map = new Map<string, { total: number; count: number }>()
  for (const r of rooms) {
    const key = r.type ?? '기타'
    const cur = map.get(key) ?? { total: 0, count: 0 }
    map.set(key, { total: cur.total + r.baseRent, count: cur.count + 1 })
  }
  return Array.from(map.entries()).map(([type, { total, count }]) => ({
    type,
    avgPrice: Math.round(total / count),
    count,
  }))
}

/** Gemini 응답에서 권장단가 JSON 추출 */
function extractRecommendedPrices(text: string): Array<{ type: string; price: number; reason: string }> {
  try {
    const match = text.match(/\{"권장단가":\s*\[[\s\S]*?\]\}/)
    if (!match) return []
    const parsed = JSON.parse(match[0]) as { 권장단가: Array<{ type: string; price: number; reason: string }> }
    return parsed['권장단가'] ?? []
  } catch {
    return []
  }
}

/** Gemini 응답 텍스트에서 JSON 블록 제거하여 순수 텍스트 추출 */
function extractAnalysisText(text: string): string {
  return text.replace(/\{"권장단가":\s*\[[\s\S]*?\]\}/g, '').trim()
}

// ── Sub-components ────────────────────────────────────────────

function Btn({
  onClick,
  disabled,
  variant = 'primary',
  children,
  type = 'button',
  small,
}: {
  onClick?: () => void
  disabled?: boolean
  variant?: 'primary' | 'secondary' | 'danger'
  children: React.ReactNode
  type?: 'button' | 'submit'
  small?: boolean
}) {
  const base = `inline-flex items-center justify-center rounded-xl font-medium transition-colors disabled:opacity-50 ${small ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'}`
  const styles: Record<string, React.CSSProperties> = {
    primary: { background: 'var(--coral)', color: '#fff' },
    secondary: { background: 'var(--canvas)', color: 'var(--warm-dark)', border: '1px solid var(--warm-border)' },
    danger: { background: '#fee2e2', color: '#b91c1c', border: '1px solid #fca5a5' },
  }
  return (
    <button type={type} className={base} style={styles[variant]} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  )
}

// ── Competitor Form Modal ─────────────────────────────────────

type CompetitorFormData = {
  name: string
  address: string
  naverPlaceUrl: string
  roomPrices: RoomPrice[]
  notes: string
}

function emptyForm(): CompetitorFormData {
  return { name: '', address: '', naverPlaceUrl: '', roomPrices: [{ type: '', price: 0 }], notes: '' }
}

function CompetitorModal({
  initial,
  onClose,
  onSave,
  isPending,
  roomTypes,
  windowTypes,
  directions,
}: {
  initial?: CompetitorFormData
  onClose: () => void
  onSave: (data: CompetitorFormData) => void
  isPending: boolean
  roomTypes: string[]
  windowTypes: string[]
  directions: string[]
}) {
  const [form, setForm] = useState<CompetitorFormData>(initial ?? emptyForm())

  const setField = <K extends keyof CompetitorFormData>(k: K, v: CompetitorFormData[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  const PYEONG_TO_M2 = 3.30579

  const setPriceRow = (i: number, k: keyof RoomPrice, v: string | number) =>
    setForm(f => ({
      ...f,
      roomPrices: f.roomPrices.map((row, idx) => {
        if (idx !== i) return row
        if (k === 'price' || k === 'deposit') return { ...row, [k]: v === '' ? undefined : Number(v) }
        if (k === 'areaM2' || k === 'areaPyeong') return { ...row, [k]: v === '' ? undefined : Number(v) }
        return { ...row, [k]: v }
      }),
    }))

  const setAreaPyeong = (i: number, val: string) => {
    const num = parseFloat(val)
    setForm(f => ({
      ...f,
      roomPrices: f.roomPrices.map((row, idx) => {
        if (idx !== i) return row
        return {
          ...row,
          areaPyeong: val === '' || isNaN(num) ? undefined : num,
          areaM2: val === '' || isNaN(num) ? undefined : parseFloat((num * PYEONG_TO_M2).toFixed(2)),
        }
      }),
    }))
  }

  const setAreaM2 = (i: number, val: string) => {
    const num = parseFloat(val)
    setForm(f => ({
      ...f,
      roomPrices: f.roomPrices.map((row, idx) => {
        if (idx !== i) return row
        return {
          ...row,
          areaM2: val === '' || isNaN(num) ? undefined : num,
          areaPyeong: val === '' || isNaN(num) ? undefined : parseFloat((num / PYEONG_TO_M2).toFixed(2)),
        }
      }),
    }))
  }

  const toggleDeposit = (i: number, checked: boolean) =>
    setForm(f => ({
      ...f,
      roomPrices: f.roomPrices.map((row, idx) =>
        idx !== i ? row : { ...row, hasDeposit: checked, deposit: checked ? row.deposit : undefined }
      ),
    }))

  const addPriceRow = () =>
    setForm(f => ({ ...f, roomPrices: [...f.roomPrices, { type: '', price: 0 }] }))

  const removePriceRow = (i: number) =>
    setForm(f => ({ ...f, roomPrices: f.roomPrices.filter((_, idx) => idx !== i) }))

  const inputStyle: React.CSSProperties = {
    border: '1px solid var(--warm-border)',
    borderRadius: 12,
    padding: '8px 12px',
    fontSize: 14,
    background: 'var(--canvas)',
    color: 'var(--warm-dark)',
    width: '100%',
    outline: 'none',
  }

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    appearance: 'none',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23999' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 10px center',
    paddingRight: 28,
    cursor: 'pointer',
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--warm-muted)',
    marginBottom: 4,
    display: 'block',
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl flex flex-col"
        style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between shrink-0"
          style={{ padding: '16px 20px', borderBottom: '1px solid var(--warm-border)' }}
        >
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--warm-dark)' }}>
            {initial ? '경쟁업체 수정' : '경쟁업체 추가'}
          </span>
          <button onClick={onClose} style={{ color: 'var(--warm-muted)', fontSize: 20, lineHeight: 1 }}>×</button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-4" style={{ padding: 20 }}>
          <div>
            <label style={labelStyle}>업체명 *</label>
            <input
              style={inputStyle}
              value={form.name}
              onChange={e => setField('name', e.target.value)}
              placeholder="예: ○○고시원"
            />
          </div>
          <div>
            <label style={labelStyle}>주소 *</label>
            <input
              style={inputStyle}
              value={form.address}
              onChange={e => setField('address', e.target.value)}
              placeholder="예: 서울시 관악구 ..."
            />
          </div>
          <div>
            <label style={labelStyle}>네이버 플레이스 URL</label>
            <input
              style={inputStyle}
              value={form.naverPlaceUrl}
              onChange={e => setField('naverPlaceUrl', e.target.value)}
              placeholder="https://naver.me/..."
            />
          </div>

          {/* Room Prices */}
          <div>
            <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>방타입별 가격</label>
              <button
                type="button"
                onClick={addPriceRow}
                style={{ fontSize: 12, color: 'var(--coral)', fontWeight: 600 }}
              >
                + 행 추가
              </button>
            </div>
            <div className="flex flex-col gap-3">
              {form.roomPrices.map((row, i) => (
                <div
                  key={i}
                  style={{
                    border: '1px solid var(--warm-border)',
                    borderRadius: 12,
                    padding: '10px 12px',
                    background: 'var(--canvas)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  {/* 타입 선택 행 */}
                  <div className="flex gap-2 items-center">
                    <select
                      style={{ ...selectStyle, flex: 2 }}
                      value={row.type}
                      onChange={e => setPriceRow(i, 'type', e.target.value)}
                    >
                      <option value="">방타입 선택</option>
                      {roomTypes.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <select
                      style={{ ...selectStyle, flex: 1 }}
                      value={row.windowType ?? ''}
                      onChange={e => setPriceRow(i, 'windowType', e.target.value)}
                    >
                      <option value="">창타입</option>
                      {windowTypes.map(w => <option key={w} value={w}>{getWindowLabel(w)}</option>)}
                    </select>
                    <select
                      style={{ ...selectStyle, flex: 1 }}
                      value={row.direction ?? ''}
                      onChange={e => setPriceRow(i, 'direction', e.target.value)}
                    >
                      <option value="">방향</option>
                      {directions.map(d => <option key={d} value={d}>{getDirectionLabel(d)}</option>)}
                    </select>
                    <button
                      type="button"
                      onClick={() => removePriceRow(i)}
                      style={{ color: '#b91c1c', fontSize: 18, lineHeight: 1, flexShrink: 0 }}
                    >
                      ×
                    </button>
                  </div>
                  {/* 크기 + 면적 행 */}
                  <div className="flex gap-2">
                    <select
                      style={{ ...selectStyle, flex: '0 0 auto', width: '30%' }}
                      value={row.sizeCategory ?? ''}
                      onChange={e => setPriceRow(i, 'sizeCategory', e.target.value)}
                    >
                      <option value="">크기</option>
                      <option value="소">소 (~1평)</option>
                      <option value="중">중 (~1.6평)</option>
                      <option value="대">대 (~2평)</option>
                      <option value="특대">특대 (~3평+)</option>
                    </select>
                    <input
                      style={{ ...inputStyle, flex: 1 }}
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="평"
                      value={row.areaPyeong ?? ''}
                      onChange={e => setAreaPyeong(i, e.target.value)}
                    />
                    <input
                      style={{ ...inputStyle, flex: 1 }}
                      type="number"
                      step="0.1"
                      min="0"
                      placeholder="m²"
                      value={row.areaM2 ?? ''}
                      onChange={e => setAreaM2(i, e.target.value)}
                    />
                  </div>
                  {/* 단가 + 메모 행 */}
                  <div className="flex gap-2">
                    <input
                      style={{ ...inputStyle, flex: 1 }}
                      type="number"
                      placeholder="단가 (원)"
                      value={row.price || ''}
                      onChange={e => setPriceRow(i, 'price', e.target.value)}
                    />
                    <input
                      style={{ ...inputStyle, flex: 1 }}
                      placeholder="메모"
                      value={row.memo ?? ''}
                      onChange={e => setPriceRow(i, 'memo', e.target.value)}
                    />
                  </div>
                  {/* 보증금 행 */}
                  <div className="flex items-center gap-3">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: 'var(--warm-dark)', flexShrink: 0 }}>
                      <input
                        type="checkbox"
                        checked={row.hasDeposit ?? false}
                        onChange={e => toggleDeposit(i, e.target.checked)}
                        style={{ accentColor: 'var(--coral)', width: 15, height: 15 }}
                      />
                      보증금
                    </label>
                    {row.hasDeposit && (
                      <input
                        style={{ ...inputStyle, flex: 1 }}
                        type="number"
                        placeholder="보증금 (원)"
                        value={row.deposit ?? ''}
                        onChange={e => setPriceRow(i, 'deposit', e.target.value)}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label style={labelStyle}>메모</label>
            <textarea
              style={{ ...inputStyle, resize: 'vertical', minHeight: 64 }}
              value={form.notes}
              onChange={e => setField('notes', e.target.value)}
              placeholder="특이사항 등"
            />
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex justify-end gap-2 shrink-0"
          style={{ padding: '12px 20px', borderTop: '1px solid var(--warm-border)' }}
        >
          <Btn variant="secondary" onClick={onClose}>취소</Btn>
          <Btn
            variant="primary"
            disabled={isPending || !form.name.trim() || !form.address.trim()}
            onClick={() => onSave(form)}
          >
            {isPending ? '저장 중...' : '저장'}
          </Btn>
        </div>
      </div>
    </div>
  )
}

// ── Naver Search Panel ────────────────────────────────────────

function NaverSearchPanel({
  onSelect,
}: {
  onSelect: (item: NaverItem) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<NaverItem[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  const search = useCallback(async () => {
    if (!query.trim()) return
    setLoading(true)
    try {
      const res = await fetch(`/api/naver-places?query=${encodeURIComponent(query)}`)
      const json = await res.json() as { items: NaverItem[] }
      setResults(json.items ?? [])
      setSearched(true)
    } catch {
      setResults([])
      setSearched(true)
    } finally {
      setLoading(false)
    }
  }, [query])

  const stripHtml = (s: string) => s.replace(/<[^>]+>/g, '')

  return (
    <div
      className="rounded-2xl"
      style={{
        border: '1px solid var(--warm-border)',
        background: 'var(--canvas)',
        padding: 16,
        marginTop: 8,
      }}
    >
      <div className="flex gap-2" style={{ marginBottom: 8 }}>
        <input
          style={{
            flex: 1,
            border: '1px solid var(--warm-border)',
            borderRadius: 10,
            padding: '8px 12px',
            fontSize: 14,
            background: 'var(--cream)',
            color: 'var(--warm-dark)',
            outline: 'none',
          }}
          placeholder="예: 관악구 고시원"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') search() }}
        />
        <Btn onClick={search} disabled={loading} variant="primary">
          {loading ? '검색 중...' : '검색'}
        </Btn>
      </div>
      {searched && results.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--warm-muted)', textAlign: 'center', padding: '8px 0' }}>
          결과 없음 (네이버 API 키 미설정 시 결과가 빈 상태로 반환됩니다)
        </p>
      )}
      {results.map((item, i) => (
        <div
          key={i}
          className="rounded-xl cursor-pointer transition-colors"
          style={{
            padding: '10px 12px',
            marginBottom: 4,
            border: '1px solid var(--warm-border)',
            background: 'var(--cream)',
          }}
          onClick={() => onSelect(item)}
        >
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--warm-dark)' }}>
            {stripHtml(item.title)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--warm-muted)', marginTop: 2 }}>
            {item.roadAddress || item.address}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main Client ────────────────────────────────────────────────

export default function MarketClient({
  property,
  initialSurveys,
  roomTypes,
  windowTypes,
  directions,
}: {
  property: Property
  initialSurveys: Survey[]
  roomTypes: string[]
  windowTypes: string[]
  directions: string[]
}) {
  const [surveys, setSurveys] = useState<Survey[]>(initialSurveys)
  const [tab, setTab] = useState<'current' | 'history'>('current')
  const [isPending, startTransition] = useTransition()

  // 현재(가장 최신) 조사
  const activeSurvey = surveys[0] ?? null

  // Competitor modal
  const [showCompetitorModal, setShowCompetitorModal] = useState(false)
  const [editingCompetitor, setEditingCompetitor] = useState<Competitor | null>(null)
  const [prefillForm, setPrefillForm] = useState<Partial<CompetitorFormData> | null>(null)

  // Naver search
  const [showNaverSearch, setShowNaverSearch] = useState(false)

  // AI analysis
  const [strategy, setStrategy] = useState<string>(activeSurvey?.strategy ?? '시세형')
  const [aiResult, setAiResult] = useState<string>(activeSurvey?.aiResult ?? '')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')

  // History selected
  const [historySelected, setHistorySelected] = useState<Survey | null>(null)

  const myRoomTypes = aggregateRoomTypes(property.rooms)

  // ── 새 조사 시작 ─────────────────────────────────────────────
  const handleNewSurvey = () => {
    startTransition(async () => {
      const res = await createSurvey(property.id)
      if (res.ok && res.survey) {
        const newSurvey: Survey = {
          ...res.survey,
          competitors: [],
        }
        setSurveys(prev => [newSurvey, ...prev])
        setAiResult('')
        setStrategy('시세형')
        setTab('current')
      }
    })
  }

  // ── 경쟁업체 저장 ─────────────────────────────────────────────
  const handleSaveCompetitor = (form: CompetitorFormData) => {
    if (!activeSurvey) return
    startTransition(async () => {
      if (editingCompetitor) {
        const res = await updateCompetitor(editingCompetitor.id, {
          name: form.name,
          address: form.address,
          naverPlaceUrl: form.naverPlaceUrl || undefined,
          roomPrices: form.roomPrices,
          notes: form.notes || undefined,
        })
        if (res.ok) {
          setSurveys(prev =>
            prev.map(s =>
              s.id === activeSurvey.id
                ? {
                    ...s,
                    competitors: s.competitors.map(c =>
                      c.id === editingCompetitor.id
                        ? { ...c, ...form, roomPrices: form.roomPrices, updatedAt: new Date() }
                        : c,
                    ),
                  }
                : s,
            ),
          )
        }
      } else {
        const res = await addCompetitor(activeSurvey.id, {
          name: form.name,
          address: form.address,
          naverPlaceUrl: form.naverPlaceUrl || undefined,
          roomPrices: form.roomPrices,
          notes: form.notes || undefined,
        })
        if (res.ok) {
          // reload from server by adding optimistic entry
          const fake: Competitor = {
            id: `tmp-${Date.now()}`,
            name: form.name,
            address: form.address,
            naverPlaceUrl: form.naverPlaceUrl || null,
            roomPrices: form.roomPrices,
            notes: form.notes || null,
            marketSurveyId: activeSurvey.id,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
          setSurveys(prev =>
            prev.map(s =>
              s.id === activeSurvey.id
                ? { ...s, competitors: [...s.competitors, fake] }
                : s,
            ),
          )
        }
      }
      setShowCompetitorModal(false)
      setEditingCompetitor(null)
      setPrefillForm(null)
    })
  }

  // ── 경쟁업체 삭제 ─────────────────────────────────────────────
  const handleDeleteCompetitor = (id: string) => {
    if (!activeSurvey) return
    if (!confirm('경쟁업체를 삭제할까요?')) return
    startTransition(async () => {
      const res = await deleteCompetitor(id)
      if (res.ok) {
        setSurveys(prev =>
          prev.map(s =>
            s.id === activeSurvey.id
              ? { ...s, competitors: s.competitors.filter(c => c.id !== id) }
              : s,
          ),
        )
      }
    })
  }

  // ── 조사 삭제 ─────────────────────────────────────────────────
  const handleDeleteSurvey = (surveyId: string) => {
    if (!confirm('이 조사를 삭제할까요?')) return
    startTransition(async () => {
      const res = await deleteSurvey(surveyId)
      if (res.ok) {
        setSurveys(prev => prev.filter(s => s.id !== surveyId))
        if (historySelected?.id === surveyId) setHistorySelected(null)
      }
    })
  }

  // ── AI 분석 실행 ─────────────────────────────────────────────
  const handleAnalyze = async () => {
    if (!activeSurvey) return
    setAiLoading(true)
    setAiError('')
    try {
      const competitors = activeSurvey.competitors.map(c => ({
        name: c.name,
        address: c.address,
        roomPrices: parseRoomPrices(c.roomPrices),
      }))

      const res = await fetch('/api/market-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property: { name: property.name, address: property.address },
          competitors,
          strategy,
          roomTypes: myRoomTypes,
        }),
      })
      const json = await res.json() as { result?: string; error?: string }
      if (!res.ok || json.error) {
        setAiError(json.error ?? 'AI 분석 오류')
        return
      }
      const resultText = json.result ?? ''
      setAiResult(resultText)

      // persist to DB
      startTransition(async () => {
        await updateSurveyStrategy(activeSurvey.id, strategy, resultText)
        setSurveys(prev =>
          prev.map(s =>
            s.id === activeSurvey.id ? { ...s, strategy, aiResult: resultText } : s,
          ),
        )
      })
    } catch (err) {
      setAiError((err as Error).message)
    } finally {
      setAiLoading(false)
    }
  }

  // ── Naver item selected ───────────────────────────────────────
  const handleNaverSelect = (item: NaverItem) => {
    const stripHtml = (s: string) => s.replace(/<[^>]+>/g, '')
    setPrefillForm({
      name: stripHtml(item.title),
      address: item.roadAddress || item.address,
      naverPlaceUrl: item.link,
    })
    setShowNaverSearch(false)
    setShowCompetitorModal(true)
  }

  // ── Styles ────────────────────────────────────────────────────
  const card: React.CSSProperties = {
    background: 'var(--cream)',
    border: '1px solid var(--warm-border)',
    borderRadius: 16,
    padding: 20,
  }

  const sectionTitle: React.CSSProperties = {
    fontSize: 15,
    fontWeight: 700,
    color: 'var(--warm-dark)',
    marginBottom: 12,
  }

  // ── Render ────────────────────────────────────────────────────
  const displayAiResult = aiResult || activeSurvey?.aiResult || ''
  const analysisText = displayAiResult ? extractAnalysisText(displayAiResult) : ''
  const recommendedPrices = displayAiResult ? extractRecommendedPrices(displayAiResult) : []

  return (
    <div
      className="flex flex-col min-h-full"
      style={{ background: 'var(--canvas)', padding: '20px 16px', gap: 16 }}
    >
      {/* Page Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--warm-dark)' }}>시세 조사</h1>
          <p style={{ fontSize: 13, color: 'var(--warm-muted)', marginTop: 2 }}>{property.name}</p>
        </div>
        <Btn onClick={handleNewSurvey} disabled={isPending} variant="primary">
          + 새 조사 시작
        </Btn>
      </div>

      {/* Tabs */}
      <div
        className="flex"
        style={{
          borderBottom: '1px solid var(--warm-border)',
          gap: 4,
        }}
      >
        {(['current', 'history'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '8px 16px',
              fontSize: 14,
              fontWeight: tab === t ? 700 : 400,
              color: tab === t ? 'var(--coral)' : 'var(--warm-muted)',
              borderBottom: tab === t ? '2px solid var(--coral)' : '2px solid transparent',
              background: 'none',
              cursor: 'pointer',
            }}
          >
            {t === 'current' ? '이번 조사' : `조사 이력 (${surveys.length})`}
          </button>
        ))}
      </div>

      {/* ── Current Tab ── */}
      {tab === 'current' && (
        <div className="flex flex-col gap-4">
          {/* No survey yet */}
          {!activeSurvey && (
            <div style={{ ...card, textAlign: 'center', padding: 40 }}>
              <p style={{ color: 'var(--warm-muted)', marginBottom: 16 }}>
                진행 중인 조사가 없습니다.
              </p>
              <Btn onClick={handleNewSurvey} disabled={isPending} variant="primary">
                새 조사 시작
              </Btn>
            </div>
          )}

          {activeSurvey && (
            <>
              {/* Survey Meta */}
              <div
                style={{
                  ...card,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 8,
                  padding: '12px 20px',
                }}
              >
                <span style={{ fontSize: 13, color: 'var(--warm-muted)' }}>
                  조사일: <strong style={{ color: 'var(--warm-dark)' }}>{fmtDate(activeSurvey.surveyedAt)}</strong>
                </span>
                <Btn
                  small
                  variant="danger"
                  onClick={() => handleDeleteSurvey(activeSurvey.id)}
                  disabled={isPending}
                >
                  조사 삭제
                </Btn>
              </div>

              {/* My Property */}
              <div style={card}>
                <p style={sectionTitle}>내 영업장 현황</p>
                {myRoomTypes.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--warm-muted)' }}>등록된 호실이 없습니다.</p>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {myRoomTypes.map(rt => (
                      <div
                        key={rt.type}
                        className="rounded-xl"
                        style={{
                          background: 'var(--canvas)',
                          border: '1px solid var(--warm-border)',
                          padding: '10px 14px',
                          minWidth: 120,
                        }}
                      >
                        <div style={{ fontSize: 12, color: 'var(--warm-muted)', marginBottom: 2 }}>
                          {rt.type} ({rt.count}개)
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--warm-dark)' }}>
                          {fmtMoney(rt.avgPrice)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Competitors */}
              <div style={card}>
                <div
                  className="flex items-center justify-between flex-wrap gap-2"
                  style={{ marginBottom: 12 }}
                >
                  <p style={{ ...sectionTitle, marginBottom: 0 }}>경쟁업체</p>
                  <div className="flex gap-2 flex-wrap">
                    <Btn
                      small
                      variant="secondary"
                      onClick={() => setShowNaverSearch(v => !v)}
                    >
                      네이버에서 찾기
                    </Btn>
                    <Btn
                      small
                      variant="primary"
                      onClick={() => {
                        setEditingCompetitor(null)
                        setPrefillForm(null)
                        setShowCompetitorModal(true)
                      }}
                    >
                      + 경쟁업체 추가
                    </Btn>
                  </div>
                </div>

                {/* Naver search */}
                {showNaverSearch && (
                  <NaverSearchPanel onSelect={handleNaverSelect} />
                )}

                {/* Competitor list */}
                {activeSurvey.competitors.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--warm-muted)', marginTop: 8 }}>
                    등록된 경쟁업체가 없습니다.
                  </p>
                ) : (
                  <div className="flex flex-col gap-3" style={{ marginTop: 8 }}>
                    {activeSurvey.competitors.map(c => {
                      const prices = parseRoomPrices(c.roomPrices)
                      return (
                        <div
                          key={c.id}
                          className="rounded-xl"
                          style={{
                            background: 'var(--canvas)',
                            border: '1px solid var(--warm-border)',
                            padding: '12px 14px',
                          }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--warm-dark)' }}>
                                {c.name}
                              </div>
                              <div style={{ fontSize: 12, color: 'var(--warm-muted)', marginTop: 2 }}>
                                {c.address}
                              </div>
                              {c.naverPlaceUrl && (
                                <a
                                  href={c.naverPlaceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{ fontSize: 12, color: 'var(--coral)', marginTop: 2, display: 'block' }}
                                >
                                  네이버 플레이스 →
                                </a>
                              )}
                            </div>
                            <div className="flex gap-1 shrink-0">
                              <Btn
                                small
                                variant="secondary"
                                onClick={() => {
                                  setEditingCompetitor(c)
                                  setPrefillForm({
                                    name: c.name,
                                    address: c.address,
                                    naverPlaceUrl: c.naverPlaceUrl ?? '',
                                    roomPrices: prices,
                                    notes: c.notes ?? '',
                                  })
                                  setShowCompetitorModal(true)
                                }}
                              >
                                수정
                              </Btn>
                              <Btn
                                small
                                variant="danger"
                                onClick={() => handleDeleteCompetitor(c.id)}
                                disabled={isPending}
                              >
                                삭제
                              </Btn>
                            </div>
                          </div>
                          {prices.length > 0 && (
                            <div className="flex flex-wrap gap-2" style={{ marginTop: 10 }}>
                              {prices.map((p, i) => (
                                <span
                                  key={i}
                                  className="rounded-lg"
                                  style={{
                                    fontSize: 12,
                                    padding: '3px 8px',
                                    background: 'var(--cream)',
                                    border: '1px solid var(--warm-border)',
                                    color: 'var(--warm-dark)',
                                  }}
                                >
                                  {[
                                    p.type,
                                    p.windowType ? getWindowLabel(p.windowType) : null,
                                    p.direction  ? getDirectionLabel(p.direction)  : null,
                                    p.sizeCategory || p.areaPyeong || p.areaM2
                                      ? [
                                          p.sizeCategory,
                                          p.areaPyeong ? `${p.areaPyeong}평` : null,
                                          p.areaM2 ? `${p.areaM2}㎡` : null,
                                        ].filter(Boolean).join('/')
                                      : null,
                                  ].filter(Boolean).join(' · ')}: {fmtMoney(p.price)}
                                  {p.hasDeposit && p.deposit ? ` + 보증금 ${fmtMoney(p.deposit)}` : p.hasDeposit ? ' + 보증금 있음' : ''}
                                  {p.memo ? ` (${p.memo})` : ''}
                                </span>
                              ))}
                            </div>
                          )}
                          {c.notes && (
                            <div style={{ fontSize: 12, color: 'var(--warm-muted)', marginTop: 8 }}>
                              메모: {c.notes}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* AI Analysis */}
              <div style={card}>
                <p style={sectionTitle}>AI 시세 분석</p>

                {/* Strategy selector */}
                <div className="flex gap-2 flex-wrap" style={{ marginBottom: 16 }}>
                  {['실속형', '시세형', '프리미엄형'].map(s => (
                    <button
                      key={s}
                      onClick={() => setStrategy(s)}
                      className="rounded-xl transition-colors"
                      style={{
                        padding: '8px 16px',
                        fontSize: 13,
                        fontWeight: strategy === s ? 700 : 400,
                        background: strategy === s ? 'var(--coral)' : 'var(--canvas)',
                        color: strategy === s ? '#fff' : 'var(--warm-muted)',
                        border: strategy === s ? '1.5px solid var(--coral)' : '1.5px solid var(--warm-border)',
                        cursor: 'pointer',
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>

                <Btn
                  variant="primary"
                  onClick={handleAnalyze}
                  disabled={aiLoading || isPending}
                >
                  {aiLoading ? 'AI 분석 중...' : 'AI 분석 실행'}
                </Btn>

                {aiError && (
                  <div
                    className="rounded-xl"
                    style={{
                      marginTop: 12,
                      padding: '10px 14px',
                      background: '#fee2e2',
                      color: '#b91c1c',
                      fontSize: 13,
                      border: '1px solid #fca5a5',
                    }}
                  >
                    {aiError}
                  </div>
                )}

                {analysisText && (
                  <div style={{ marginTop: 16 }}>
                    {/* Recommended prices table */}
                    {recommendedPrices.length > 0 && (
                      <div style={{ marginBottom: 16 }}>
                        <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--warm-dark)', marginBottom: 8 }}>
                          권장 단가
                        </p>
                        <div
                          className="rounded-xl overflow-hidden"
                          style={{ border: '1px solid var(--warm-border)' }}
                        >
                          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                            <thead>
                              <tr style={{ background: 'var(--canvas)' }}>
                                <th
                                  style={{
                                    padding: '8px 12px',
                                    textAlign: 'left',
                                    color: 'var(--warm-muted)',
                                    fontWeight: 600,
                                    borderBottom: '1px solid var(--warm-border)',
                                  }}
                                >
                                  방타입
                                </th>
                                <th
                                  style={{
                                    padding: '8px 12px',
                                    textAlign: 'right',
                                    color: 'var(--warm-muted)',
                                    fontWeight: 600,
                                    borderBottom: '1px solid var(--warm-border)',
                                  }}
                                >
                                  권장 단가
                                </th>
                                <th
                                  style={{
                                    padding: '8px 12px',
                                    textAlign: 'left',
                                    color: 'var(--warm-muted)',
                                    fontWeight: 600,
                                    borderBottom: '1px solid var(--warm-border)',
                                  }}
                                >
                                  근거
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {recommendedPrices.map((rp, i) => (
                                <tr
                                  key={i}
                                  style={{
                                    borderBottom:
                                      i < recommendedPrices.length - 1
                                        ? '1px solid var(--warm-border)'
                                        : undefined,
                                  }}
                                >
                                  <td style={{ padding: '8px 12px', color: 'var(--warm-dark)', fontWeight: 600 }}>
                                    {rp.type}
                                  </td>
                                  <td
                                    style={{
                                      padding: '8px 12px',
                                      color: 'var(--coral)',
                                      fontWeight: 700,
                                      textAlign: 'right',
                                    }}
                                  >
                                    {fmtMoney(rp.price)}
                                  </td>
                                  <td style={{ padding: '8px 12px', color: 'var(--warm-muted)', fontSize: 12 }}>
                                    {rp.reason}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Analysis text */}
                    <div
                      className="rounded-xl"
                      style={{
                        background: 'var(--canvas)',
                        border: '1px solid var(--warm-border)',
                        padding: '14px 16px',
                        fontSize: 13,
                        color: 'var(--warm-dark)',
                        lineHeight: 1.75,
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {analysisText}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── History Tab ── */}
      {tab === 'history' && (
        <div className="flex flex-col gap-4">
          {surveys.length === 0 && (
            <div style={{ ...card, textAlign: 'center', padding: 40 }}>
              <p style={{ color: 'var(--warm-muted)' }}>조사 이력이 없습니다.</p>
            </div>
          )}

          {surveys.map(survey => (
            <div key={survey.id} style={card}>
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--warm-dark)' }}>
                    {fmtDate(survey.surveyedAt)}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--warm-muted)', marginTop: 2 }}>
                    경쟁업체 {survey.competitors.length}곳
                    {survey.strategy && ` · ${survey.strategy} 전략`}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Btn
                    small
                    variant="secondary"
                    onClick={() =>
                      setHistorySelected(prev =>
                        prev?.id === survey.id ? null : survey,
                      )
                    }
                  >
                    {historySelected?.id === survey.id ? '접기' : '상세 보기'}
                  </Btn>
                  <Btn
                    small
                    variant="danger"
                    onClick={() => handleDeleteSurvey(survey.id)}
                    disabled={isPending}
                  >
                    삭제
                  </Btn>
                </div>
              </div>

              {historySelected?.id === survey.id && (
                <div style={{ marginTop: 16 }}>
                  {/* Competitors summary */}
                  {survey.competitors.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <p
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: 'var(--warm-muted)',
                          marginBottom: 8,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                        }}
                      >
                        경쟁업체
                      </p>
                      {survey.competitors.map(c => {
                        const prices = parseRoomPrices(c.roomPrices)
                        return (
                          <div
                            key={c.id}
                            className="rounded-xl"
                            style={{
                              background: 'var(--canvas)',
                              border: '1px solid var(--warm-border)',
                              padding: '10px 12px',
                              marginBottom: 6,
                            }}
                          >
                            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--warm-dark)' }}>
                              {c.name}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--warm-muted)' }}>{c.address}</div>
                            {prices.length > 0 && (
                              <div className="flex flex-wrap gap-1" style={{ marginTop: 6 }}>
                                {prices.map((p, i) => (
                                  <span
                                    key={i}
                                    className="rounded-md"
                                    style={{
                                      fontSize: 11,
                                      padding: '2px 6px',
                                      background: 'var(--cream)',
                                      border: '1px solid var(--warm-border)',
                                      color: 'var(--warm-dark)',
                                    }}
                                  >
                                    {[
                                      p.type,
                                      p.windowType ? getWindowLabel(p.windowType) : null,
                                      p.direction  ? getDirectionLabel(p.direction)  : null,
                                      p.sizeCategory || p.areaPyeong || p.areaM2
                                        ? [
                                            p.sizeCategory,
                                            p.areaPyeong ? `${p.areaPyeong}평` : null,
                                            p.areaM2 ? `${p.areaM2}㎡` : null,
                                          ].filter(Boolean).join('/')
                                        : null,
                                    ].filter(Boolean).join(' · ')}: {fmtMoney(p.price)}
                                    {p.hasDeposit && p.deposit ? ` + 보증금 ${fmtMoney(p.deposit)}` : p.hasDeposit ? ' + 보증금 있음' : ''}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* AI result summary */}
                  {survey.aiResult && (
                    <div>
                      <p
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: 'var(--warm-muted)',
                          marginBottom: 8,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                        }}
                      >
                        AI 분석 결과
                      </p>
                      {extractRecommendedPrices(survey.aiResult).length > 0 && (
                        <div className="flex flex-wrap gap-2" style={{ marginBottom: 8 }}>
                          {extractRecommendedPrices(survey.aiResult).map((rp, i) => (
                            <span
                              key={i}
                              className="rounded-lg"
                              style={{
                                fontSize: 12,
                                padding: '4px 10px',
                                background: 'rgba(244,98,58,0.08)',
                                border: '1px solid rgba(244,98,58,0.2)',
                                color: 'var(--coral)',
                                fontWeight: 600,
                              }}
                            >
                              {rp.type}: {fmtMoney(rp.price)}
                            </span>
                          ))}
                        </div>
                      )}
                      <div
                        className="rounded-xl"
                        style={{
                          background: 'var(--canvas)',
                          border: '1px solid var(--warm-border)',
                          padding: '12px 14px',
                          fontSize: 12,
                          color: 'var(--warm-dark)',
                          lineHeight: 1.7,
                          whiteSpace: 'pre-wrap',
                          maxHeight: 200,
                          overflow: 'auto',
                        }}
                      >
                        {extractAnalysisText(survey.aiResult)}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Competitor Modal */}
      {showCompetitorModal && (
        <CompetitorModal
          initial={
            prefillForm
              ? {
                  name: prefillForm.name ?? '',
                  address: prefillForm.address ?? '',
                  naverPlaceUrl: prefillForm.naverPlaceUrl ?? '',
                  roomPrices: prefillForm.roomPrices ?? [{ type: '', price: 0 }],
                  notes: prefillForm.notes ?? '',
                }
              : undefined
          }
          onClose={() => {
            setShowCompetitorModal(false)
            setEditingCompetitor(null)
            setPrefillForm(null)
          }}
          onSave={handleSaveCompetitor}
          isPending={isPending}
          roomTypes={roomTypes}
          windowTypes={windowTypes}
          directions={directions}
        />
      )}
    </div>
  )
}
