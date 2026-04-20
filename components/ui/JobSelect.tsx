'use client'

import { useState, useRef, useEffect } from 'react'

const STORAGE_KEY = 'roomos_custom_jobs'

const DEFAULT_JOBS = [
  '직장인',
  '학생',
  '고시생',
  '취업준비생',
  '대학원생',
  '프리랜서',
  '자영업자',
  '아르바이트',
  '무직',
  '의료인',
  '교사 / 강사',
  '군인',
  '공무원',
  '연구원',
  '운전기사',
  '기술직',
  '서비스직',
  '건설업',
  '요식업',
  '예술 / 창작',
]

function loadCustomJobs(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

function saveCustomJobs(jobs: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs))
}

interface JobSelectProps {
  name: string
  defaultValue?: string | null
  placeholder?: string
}

export function JobSelect({ name, defaultValue, placeholder = '직업 선택' }: JobSelectProps) {
  const [selected, setSelected]       = useState(defaultValue ?? '')
  const [open, setOpen]               = useState(false)
  const [query, setQuery]             = useState('')
  const [customJobs, setCustomJobs]   = useState<string[]>([])
  const [newJob, setNewJob]           = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const panelRef  = useRef<HTMLDivElement>(null)

  // 마운트 시 localStorage에서 커스텀 직업 불러오기
  useEffect(() => {
    setCustomJobs(loadCustomJobs())
  }, [])

  // 열릴 때 검색창 포커스
  useEffect(() => {
    if (open) { setQuery(''); setTimeout(() => searchRef.current?.focus(), 50) }
  }, [open])

  // 바깥 클릭 닫기
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const allJobs = [...DEFAULT_JOBS, ...customJobs]
  const q = query.toLowerCase()
  const filtered = allJobs.filter(j => j.toLowerCase().includes(q))

  const pick = (job: string) => {
    setSelected(job)
    setOpen(false)
  }

  const addCustomJob = () => {
    const trimmed = newJob.trim()
    if (!trimmed || allJobs.includes(trimmed)) return
    const updated = [...customJobs, trimmed]
    setCustomJobs(updated)
    saveCustomJobs(updated)
    setSelected(trimmed)
    setNewJob('')
    setOpen(false)
  }

  const handleAddKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); addCustomJob() }
  }

  return (
    <div className="relative" ref={panelRef}>
      {/* hidden input — 폼 전송용 */}
      <input type="hidden" name={name} value={selected} />

      {/* 선택 버튼 */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-left focus:outline-none focus:border-indigo-500 transition-colors"
      >
        {selected ? (
          <span className="text-white flex-1">{selected}</span>
        ) : (
          <span className="text-gray-600 flex-1">{placeholder}</span>
        )}
        <span className="text-gray-500 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {/* 드롭다운 */}
      {open && (
        <div
          className="absolute z-50 mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl shadow-2xl flex flex-col"
          style={{ maxHeight: '280px' }}
        >
          {/* 검색창 */}
          <div className="px-3 pt-2.5 pb-2 border-b border-gray-700 shrink-0">
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="검색..."
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 outline-none focus:border-indigo-500"
            />
          </div>

          {/* 직업 목록 */}
          <div className="overflow-y-auto flex-1">
            {filtered.length === 0 ? (
              <p className="px-4 py-4 text-sm text-gray-500 text-center">검색 결과 없음</p>
            ) : (
              filtered.map(job => {
                const isCustom = customJobs.includes(job)
                return (
                  <button
                    key={job}
                    type="button"
                    onClick={() => pick(job)}
                    className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left transition-colors ${
                      selected === job
                        ? 'bg-indigo-600/30 text-indigo-300'
                        : 'text-gray-200 hover:bg-gray-700'
                    }`}
                  >
                    <span className="flex-1">{job}</span>
                    {isCustom && (
                      <span className="text-xs text-gray-500 shrink-0">추가됨</span>
                    )}
                  </button>
                )
              })
            )}
          </div>

          {/* 직접 추가 */}
          <div className="border-t border-gray-700 px-3 py-2.5 shrink-0">
            <p className="text-xs text-gray-500 mb-2">직접 추가</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={newJob}
                onChange={e => setNewJob(e.target.value)}
                onKeyDown={handleAddKeyDown}
                placeholder="직업 입력 후 Enter"
                className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={addCustomJob}
                disabled={!newJob.trim()}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >
                추가
              </button>
            </div>
          </div>

          {/* 선택 초기화 */}
          {selected && (
            <div className="border-t border-gray-700 px-3 py-2 shrink-0">
              <button
                type="button"
                onClick={() => { setSelected(''); setOpen(false) }}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                선택 초기화
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
