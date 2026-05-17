'use client'

import { createClient } from '@/lib/supabase/client'
import { useState } from 'react'

type Mode = 'login' | 'signup' | 'forgot'

const ERROR_MAP: [string, string][] = [
  ['Invalid login credentials',              '이메일 또는 비밀번호가 올바르지 않습니다'],
  ['User already registered',                '이미 가입된 이메일입니다'],
  ['Password should be at least 6 characters','비밀번호는 6자 이상이어야 합니다'],
  ['Email not confirmed',                    '이메일 인증이 필요합니다. 메일함을 확인해주세요'],
  ['signup is disabled',                     '현재 회원가입이 비활성화되어 있습니다'],
]

function mapError(msg: string) {
  for (const [key, val] of ERROR_MAP) {
    if (msg.includes(key)) return val
  }
  return '오류가 발생했습니다. 잠시 후 다시 시도해주세요'
}

export default function EmailLoginForm({ returnTo }: { returnTo?: string }) {
  const [mode, setMode]       = useState<Mode>('login')
  const [email, setEmail]     = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const supabase = createClient()

  const reset = (next: Mode) => {
    setMode(next)
    setError(null)
    setSuccess(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setLoading(true)

    try {
      if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        })
        if (error) throw error
        setSuccess('비밀번호 재설정 메일을 보냈습니다. 메일함을 확인해주세요.')
        return
      }

      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setSuccess('가입이 완료됐습니다. 이메일로 로그인해주세요.')
        reset('login')
        return
      }

      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      window.location.href = returnTo ?? '/property-select'
    } catch (err: unknown) {
      setError(mapError(err instanceof Error ? err.message : String(err)))
    } finally {
      setLoading(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--canvas)',
    border: '1px solid var(--warm-border)',
    color: 'var(--warm-dark)',
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && (
        <p className="text-sm rounded-xl px-3 py-2.5"
           style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}>
          {error}
        </p>
      )}
      {success && (
        <p className="text-sm rounded-xl px-3 py-2.5"
           style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', color: '#059669' }}>
          {success}
        </p>
      )}

      <input
        type="email"
        placeholder="이메일"
        value={email}
        onChange={e => setEmail(e.target.value)}
        required
        autoComplete="email"
        className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-colors"
        style={inputStyle}
      />

      {mode !== 'forgot' && (
        <input
          type="password"
          placeholder="비밀번호 (6자 이상)"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          minLength={6}
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-colors"
          style={inputStyle}
        />
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-2.5 rounded-xl text-sm font-semibold transition-opacity disabled:opacity-60"
        style={{ background: 'var(--persimmon)', color: '#fff' }}
      >
        {loading
          ? '처리 중...'
          : mode === 'login'   ? '이메일로 로그인'
          : mode === 'signup'  ? '회원가입'
          :                      '재설정 메일 보내기'}
      </button>

      <div className="flex justify-between text-xs pt-0.5" style={{ color: 'var(--warm-muted)' }}>
        {mode === 'login' ? (
          <>
            <button type="button" className="hover:underline" onClick={() => reset('signup')}>
              회원가입
            </button>
            <button type="button" className="hover:underline" onClick={() => reset('forgot')}>
              비밀번호 찾기
            </button>
          </>
        ) : (
          <button type="button" className="hover:underline" onClick={() => reset('login')}>
            ← 로그인으로 돌아가기
          </button>
        )}
      </div>
    </form>
  )
}
