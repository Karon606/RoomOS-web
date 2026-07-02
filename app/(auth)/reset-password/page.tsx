'use client'

import { createClient } from '@/lib/supabase/client'
import { StayeumWordmark } from '@/components/brand/StayeumWordmark'
import { Btn } from '@/components/ui/Btn'
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export default function ResetPasswordPage() {
  const [password, setPassword]     = useState('')
  const [confirm, setConfirm]       = useState('')
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [ready, setReady]           = useState(false)

  const router       = useRouter()
  const searchParams = useSearchParams()
  const supabase     = createClient()

  useEffect(() => {
    const code = searchParams.get('code')
    if (!code) {
      setError('유효하지 않은 링크입니다. 비밀번호 찾기를 다시 시도해주세요.')
      return
    }
    supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
      if (error) {
        setError('링크가 만료됐거나 이미 사용된 링크입니다. 비밀번호 찾기를 다시 시도해주세요.')
      } else {
        setReady(true)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirm) {
      setError('비밀번호가 일치하지 않습니다')
      return
    }
    setError(null)
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) {
      setError('비밀번호 변경에 실패했습니다. 다시 시도해주세요.')
    } else {
      router.push('/login?message=password_updated')
    }
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--canvas)',
    border: '1px solid var(--warm-border)',
    color: 'var(--warm-dark)',
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4"
          style={{ background: 'var(--canvas)' }}>
      <div className="w-full max-w-sm space-y-8 px-2">
        <div className="text-center space-y-3">
          <StayeumWordmark height={36} />
        </div>

        <div className="rounded-xl p-8 space-y-5"
             style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--warm-dark)' }}>새 비밀번호 설정</h2>
            <p className="text-xs mt-1" style={{ color: 'var(--warm-muted)' }}>새로 사용할 비밀번호를 입력해주세요</p>
          </div>

          {error && (
            <p className="text-sm rounded-sm px-3 py-2.5"
               style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-ring)', color: 'var(--danger-fg)' }}>
              {error}
            </p>
          )}

          {ready && (
            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                type="password"
                placeholder="새 비밀번호 (6자 이상)"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                className="w-full px-3 py-2.5 rounded-sm text-sm outline-none"
                style={inputStyle}
              />
              <input
                type="password"
                placeholder="비밀번호 확인"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                className="w-full px-3 py-2.5 rounded-sm text-sm outline-none"
                style={inputStyle}
              />
              <Btn
                type="submit"
                variant="primary"
                size="md"
                fullWidth
                disabled={loading}
                className="font-semibold"
              >
                {loading ? '변경 중...' : '비밀번호 변경'}
              </Btn>
            </form>
          )}

          {!ready && !error && (
            <p className="text-sm text-center py-4" style={{ color: 'var(--warm-muted)' }}>
              링크 확인 중...
            </p>
          )}
        </div>
      </div>
    </main>
  )
}
