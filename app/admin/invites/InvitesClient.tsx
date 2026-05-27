'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { DatePicker } from '@/components/ui/DatePicker'
import { createInviteCode, toggleInviteCode, deleteInviteCode } from '../actions'

type Row = {
  id: string
  code: string
  note: string
  maxUses: number
  usedCount: number
  autoApprove: boolean
  isActive: boolean
  expiresAtLabel: string
  expired: boolean
  createdAtLabel: string
}

const inputCls = 'w-full px-3 py-2 rounded-lg text-sm outline-none'
const inputStyle: React.CSSProperties = {
  background: 'var(--canvas)',
  border: '1px solid var(--cream-3)',
  color: 'var(--ink)',
}

export default function InvitesClient({ rows }: { rows: Row[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // 생성 폼
  const [code, setCode] = useState('')
  const [note, setNote] = useState('')
  const [maxUses, setMaxUses] = useState('1')
  const [autoApprove, setAutoApprove] = useState(true)
  const [expiresAt, setExpiresAt] = useState('')

  function submit() {
    setErr(null)
    startTransition(async () => {
      const res = await createInviteCode({
        code: code || undefined,
        note: note || undefined,
        maxUses: Number(maxUses) || 0,
        autoApprove,
        expiresAt: expiresAt || null,
      })
      if (!res.ok) {
        setErr(res.error ?? '생성 실패')
        return
      }
      setCode('')
      setNote('')
      setMaxUses('1')
      setExpiresAt('')
      router.refresh()
    })
  }

  function act(id: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusyId(id)
    setErr(null)
    startTransition(async () => {
      const res = await fn()
      if (!res.ok) setErr(res.error ?? '처리 실패')
      else router.refresh()
      setBusyId(null)
    })
  }

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
        초대코드 / 쿠폰
      </h1>

      {/* 생성 폼 */}
      <div
        className="rounded-xl p-4 space-y-3"
        style={{ background: 'var(--cream)', border: '1px solid var(--cream-3)' }}
      >
        <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
          새 코드 발급
        </p>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="col-span-2">
            <label className="text-xs" style={{ color: 'var(--ink-mute)' }}>
              코드 (비우면 자동 생성)
            </label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="STAY-XXXXXX"
              className={inputCls}
              style={inputStyle}
            />
          </div>
          <div className="col-span-2">
            <label className="text-xs" style={{ color: 'var(--ink-mute)' }}>
              메모 (용도)
            </label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="예: 1차 베타 테스터"
              className={inputCls}
              style={inputStyle}
            />
          </div>
          <div>
            <label className="text-xs" style={{ color: 'var(--ink-mute)' }}>
              사용 가능 인원 (0=무제한)
            </label>
            <input
              type="number"
              inputMode="numeric"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              min={0}
              className={inputCls}
              style={inputStyle}
            />
          </div>
          <div>
            <label className="text-xs" style={{ color: 'var(--ink-mute)' }}>
              만료일 (선택)
            </label>
            <DatePicker
              value={expiresAt}
              onChange={setExpiresAt}
              minDate={new Date().toISOString().slice(0, 10)}
              placeholder="만료일 선택"
              className={inputCls}
              style={inputStyle}
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink-3)' }}>
          <input type="checkbox" checked={autoApprove} onChange={(e) => setAutoApprove(e.target.checked)} />
          이 코드로 가입하면 자동 승인 (선착순 무료)
        </label>
        {err && (
          <p className="text-sm" style={{ color: 'var(--persimmon-d)' }}>
            {err}
          </p>
        )}
        <button
          onClick={submit}
          disabled={pending}
          className="px-4 py-2 text-sm font-medium rounded-lg text-white disabled:opacity-50"
          style={{ background: 'var(--persimmon)' }}
        >
          코드 발급
        </button>
      </div>

      {/* 목록 */}
      {rows.length === 0 ? (
        <p className="text-sm py-6 text-center" style={{ color: 'var(--ink-mute)' }}>
          발급한 코드가 없습니다.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((c) => {
            const exhausted = c.maxUses > 0 && c.usedCount >= c.maxUses
            const rowBusy = pending && busyId === c.id
            const disabled = !c.isActive || c.expired || exhausted
            return (
              <li
                key={c.id}
                className="rounded-xl p-4"
                style={{
                  background: 'var(--cream)',
                  border: '1px solid var(--cream-3)',
                  opacity: rowBusy ? 0.6 : disabled ? 0.7 : 1,
                }}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-semibold" style={{ color: 'var(--ink)' }}>
                    {c.code}
                  </span>
                  {!c.isActive && <Tag bg="var(--cream-3)" fg="var(--ink-3)">비활성</Tag>}
                  {c.expired && <Tag bg="var(--cream-3)" fg="var(--ink-3)">만료</Tag>}
                  {exhausted && <Tag bg="var(--cream-3)" fg="var(--ink-3)">소진</Tag>}
                  {c.autoApprove ? (
                    <Tag bg="var(--sand)" fg="var(--ink)">자동승인</Tag>
                  ) : (
                    <Tag bg="var(--cream-soft)" fg="var(--ink-3)">수동승인</Tag>
                  )}
                </div>
                {c.note && (
                  <p className="text-sm mt-1" style={{ color: 'var(--ink-3)' }}>
                    {c.note}
                  </p>
                )}
                <p className="text-xs mt-1" style={{ color: 'var(--ink-mute)' }}>
                  사용 {c.usedCount}/{c.maxUses > 0 ? c.maxUses : '∞'} · 발급 {c.createdAtLabel}
                  {c.expiresAtLabel ? ` · 만료 ${c.expiresAtLabel}` : ''}
                </p>
                <div className="flex gap-2 mt-3">
                  <button
                    disabled={rowBusy}
                    onClick={() => act(c.id, () => toggleInviteCode(c.id, !c.isActive))}
                    className="px-3 py-1.5 text-sm rounded-lg disabled:opacity-50"
                    style={{ background: 'var(--cream-soft)', color: 'var(--ink-3)', border: '1px solid var(--cream-3)' }}
                  >
                    {c.isActive ? '비활성화' : '활성화'}
                  </button>
                  <button
                    disabled={rowBusy}
                    onClick={() => {
                      if (confirm(`코드 ${c.code} 를 삭제할까요?`)) act(c.id, () => deleteInviteCode(c.id))
                    }}
                    className="px-3 py-1.5 text-sm rounded-lg disabled:opacity-50"
                    style={{ background: 'transparent', color: 'var(--persimmon-d)', border: '1px solid var(--persimmon-l)' }}
                  >
                    삭제
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function Tag({ children, bg, fg }: { children: React.ReactNode; bg: string; fg: string }) {
  return (
    <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded" style={{ background: bg, color: fg }}>
      {children}
    </span>
  )
}
