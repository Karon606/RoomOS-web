'use client'

import { useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'

type SheetResult = { imported: number; skipped: number; errors: string[] }

export default function DataButtons() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const month = searchParams.get('month') ??
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`

  const fileRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<Record<string, SheetResult> | null>(null)

  const handleExport = () => {
    window.location.href = `/api/export?month=${month}`
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setLoading(true)
    setResults(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/import', { method: 'POST', body: fd })
      const data = await res.json()
      setResults(data)
      router.refresh()
    } catch {
      setResults({ '오류': { imported: 0, skipped: 0, errors: ['파일 처리 중 오류가 발생했습니다.'] } })
    } finally {
      setLoading(false)
    }
  }

  const totalImported = results ? Object.values(results).reduce((s, r) => s + r.imported, 0) : 0
  const allErrors = results ? Object.entries(results).flatMap(([sheet, r]) =>
    r.errors.map(e => `[${sheet}] ${e}`)
  ) : []

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors"
          style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)', color: 'var(--warm-mid)' }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M7 1v8M4 6l3 3 3-3M2 11h10"/>
          </svg>
          내보내기
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
          style={{ background: 'var(--coral)', color: '#fff' }}
        >
          {loading ? (
            <>
              <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              가져오는 중...
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M7 9V1M4 4l3-3 3 3M2 11h10"/>
              </svg>
              가져오기
            </>
          )}
        </button>
        <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={handleImport} />
      </div>

      {results && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.4)' }}
          onClick={() => setResults(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-6 space-y-4"
            style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm" style={{ color: 'var(--warm-dark)' }}>가져오기 완료</h3>
              <button onClick={() => setResults(null)} style={{ color: 'var(--warm-muted)' }}>✕</button>
            </div>

            <div className="space-y-2">
              {Object.entries(results).map(([sheet, r]) => (
                <div key={sheet} className="flex items-center justify-between text-sm">
                  <span style={{ color: 'var(--warm-mid)' }}>{sheet}</span>
                  <span style={{ color: r.imported > 0 ? 'var(--coral)' : 'var(--warm-muted)' }}>
                    {r.imported}건 추가 {r.skipped > 0 ? `· ${r.skipped}건 건너뜀` : ''}
                  </span>
                </div>
              ))}
            </div>

            <div className="pt-2 border-t" style={{ borderColor: 'var(--warm-border)' }}>
              <p className="text-sm font-semibold" style={{ color: 'var(--warm-dark)' }}>
                총 {totalImported}건 추가됨
              </p>
            </div>

            {allErrors.length > 0 && (
              <div className="rounded-xl p-3 space-y-1" style={{ background: 'rgba(239,68,68,0.06)' }}>
                <p className="text-xs font-medium text-red-500">오류 {allErrors.length}건</p>
                {allErrors.slice(0, 5).map((e, i) => (
                  <p key={i} className="text-xs text-red-400">{e}</p>
                ))}
                {allErrors.length > 5 && (
                  <p className="text-xs text-red-400">외 {allErrors.length - 5}건...</p>
                )}
              </div>
            )}

            <button
              onClick={() => setResults(null)}
              className="w-full py-2.5 rounded-xl text-sm font-medium"
              style={{ background: 'var(--coral)', color: '#fff' }}
            >
              확인
            </button>
          </div>
        </div>
      )}
    </>
  )
}
