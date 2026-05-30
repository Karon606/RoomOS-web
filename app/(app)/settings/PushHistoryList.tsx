'use client'

// 최근 푸시 발송 내역 — 본인 앞으로 발송된 cron-daily/test 푸시 row 들을 시간순으로.
// 펼침/접힘으로 노출.

import { useEffect, useState } from 'react'
import { getMyPushHistory, type PushHistoryRow } from './pushActions'

const SOURCE_LABEL: Record<string, string> = {
  'cron-daily': '매일 알림',
  test: '테스트',
}

function fmtWhen(d: Date | string): string {
  const t = new Date(d)
  const now = new Date()
  const diffMs = now.getTime() - t.getTime()
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return '방금'
  if (min < 60) return `${min}분 전`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour}시간 전`
  const day = Math.floor(hour / 24)
  if (day < 7) return `${day}일 전`
  return `${t.getFullYear()}.${String(t.getMonth() + 1).padStart(2, '0')}.${String(t.getDate()).padStart(2, '0')}`
}

export function PushHistoryList() {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<PushHistoryRow[] | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try { setRows(await getMyPushHistory(20)) }
    finally { setLoading(false) }
  }

  useEffect(() => { if (open && rows === null) load() }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-2">
      <button type="button" onClick={() => setOpen(v => !v)}
        className="text-xs font-medium flex items-center gap-1.5 hover:underline"
        style={{ color: 'var(--warm-mid)' }}>
        최근 푸시 내역 {open ? '▲' : '▼'}
      </button>
      {open && (
        <div className="space-y-1.5">
          {loading && rows === null && (
            <p className="text-[0.6875rem] text-[var(--warm-muted)]">불러오는 중…</p>
          )}
          {rows && rows.length === 0 && (
            <p className="text-[0.6875rem] text-[var(--warm-muted)]">아직 발송된 푸시가 없습니다.</p>
          )}
          {rows && rows.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-[0.625rem] text-[var(--warm-muted)]">최근 {rows.length}건</p>
                <button type="button" onClick={load} disabled={loading}
                  className="text-[0.625rem] text-[var(--coral)] hover:underline disabled:opacity-50">
                  새로고침
                </button>
              </div>
              <ul className="space-y-1.5">
                {rows.map(r => (
                  <li key={r.id} className="rounded-lg p-2.5 text-xs space-y-1"
                    style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)' }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[0.6875rem] font-semibold px-1.5 py-0.5 rounded"
                        style={{
                          background: r.source === 'test' ? 'rgba(59,130,246,0.12)' : 'rgba(160,60,46,0.10)',
                          color: r.source === 'test' ? '#3b82f6' : 'var(--coral)',
                        }}>
                        {SOURCE_LABEL[r.source] ?? r.source}
                      </span>
                      <span className="text-[0.625rem]" style={{ color: 'var(--warm-muted)' }}>
                        {fmtWhen(r.sentAt)} · {r.successCount}/{r.endpointCount} 기기
                      </span>
                    </div>
                    <p className="font-medium" style={{ color: 'var(--warm-dark)' }}>{r.title}</p>
                    {r.body && <p style={{ color: 'var(--warm-mid)' }}>{r.body}</p>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}
