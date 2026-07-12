'use client'

import { createClient } from '@/lib/supabase/client'
import { useState } from 'react'
import { AsYouType } from 'libphonenumber-js'
import { AddressSearch } from '@/components/ui/AddressSearch'
import { Btn } from '@/components/ui/Btn'
import { safeReturnTo } from '@/lib/auth/returnTo'
import { syncUserToDB } from './actions'

type Mode = 'login' | 'signup' | 'forgot'

const ERROR_MAP: [string, string][] = [
  ['Invalid login credentials',               '이메일 또는 비밀번호가 올바르지 않습니다'],
  ['User already registered',                 '이미 가입된 이메일입니다'],
  ['Password should be at least 6 characters','비밀번호는 6자 이상이어야 합니다'],
  ['Email not confirmed',                     '이메일 인증이 필요합니다. 메일함을 확인해주세요'],
  ['you can only request this',               '잠시 후 다시 시도해주세요. 잠깐 기다린 뒤 재요청할 수 있습니다'],
  ['signup is disabled',                      '현재 회원가입이 비활성화되어 있습니다'],
]

function mapError(msg: string) {
  for (const [key, val] of ERROR_MAP) {
    if (msg.includes(key)) return val
  }
  return '오류가 발생했습니다. 잠시 후 다시 시도해주세요'
}

// 비밀번호 규칙: 영문·숫자·특수문자 포함 8자 이상
// (대문자 입력은 항상 허용 — 영문 검사는 대/소문자 모두 통과, 대문자를 필수로 요구하지 않음)
const PW_RULES: { label: string; test: (p: string) => boolean }[] = [
  { label: '8자 이상',  test: p => p.length >= 8 },
  { label: '영문',      test: p => /[A-Za-z]/.test(p) },
  { label: '숫자',      test: p => /[0-9]/.test(p) },
  { label: '특수문자',  test: p => /[^A-Za-z0-9]/.test(p) },
]
const isPasswordValid = (p: string) => PW_RULES.every(r => r.test(p))

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-xs font-medium mb-1 px-1" style={{ color: 'var(--warm-dark)' }}>
      {children}
      {required && <span style={{ color: 'var(--persimmon)' }}> *</span>}
    </label>
  )
}

export default function EmailLoginForm({ returnTo }: { returnTo?: string }) {
  const [mode, setMode]                   = useState<Mode>('login')
  const [email, setEmail]                 = useState('')
  const [password, setPassword]           = useState('')
  const [realName, setRealName]           = useState('')
  const [phone, setPhone]                 = useState('')
  const [addressBase, setAddressBase]     = useState('')
  const [addressDetail, setAddressDetail] = useState('')
  const [inviteCode, setInviteCode]       = useState('')
  const [loading, setLoading]             = useState(false)
  const [error, setError]                 = useState<string | null>(null)
  const [success, setSuccess]             = useState<string | null>(null)
  const [needsConfirm, setNeedsConfirm]   = useState(false)

  const supabase = createClient()

  const reset = (next: Mode) => {
    setMode(next)
    setError(null)
    setSuccess(null)
    setNeedsConfirm(false)
  }

  // 입력하는 대로 한국 전화번호 형식(010-0000-0000)으로 하이픈 자동 삽입
  const handlePhoneChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 11)
    setPhone(new AsYouType('KR').input(digits))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setNeedsConfirm(false)

    if (mode === 'signup' && !isPasswordValid(password)) {
      setError('비밀번호는 영문·숫자·특수문자를 포함해 8자 이상이어야 합니다')
      return
    }

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
        const address = [addressBase, addressDetail].map(s => s.trim()).filter(Boolean).join(' ')
        const invite = inviteCode.trim().toUpperCase()
        // 이메일 인증이 켜져 있으면 signUp 직후 세션이 없어 syncUserToDB가 no-op이므로,
        // 실명·연락처·초대코드를 user_metadata에 실어 첫 로그인 시 회수·적용한다.
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              real_name: realName || undefined,
              phone: phone || undefined,
              address: address || undefined,
              invite_code: invite || undefined,
            },
          },
        })
        if (error) throw error
        // 세션이 즉시 생기는 환경(인증 비활성)에서는 바로 반영
        await syncUserToDB({ realName, phone, address, inviteCode: invite })
        setSuccess('가입이 완료됐습니다. 이메일로 로그인해주세요.')
        reset('login')
        return
      }

      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      await syncUserToDB()
      // #18 replace 사용 — /login이 히스토리에 남지 않아 뒤로가기로 로그인 화면 재진입(→로그아웃 체감) 방지
      // 오픈 리다이렉트 방어 — returnTo 는 내부 상대경로만 허용
      window.location.replace(safeReturnTo(returnTo))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setNeedsConfirm(msg.includes('Email not confirmed'))
      setError(mapError(msg))
    } finally {
      setLoading(false)
    }
  }

  // 미인증 계정 — 인증 메일 재발송 (로그인 시도만으론 메일이 재발송되지 않음)
  const handleResendConfirmation = async () => {
    setError(null)
    setSuccess(null)
    setLoading(true)
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email })
      if (error) throw error
      setNeedsConfirm(false)
      setSuccess('인증 메일을 다시 보냈습니다. 메일함을 확인해주세요.')
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
  const inputCls = 'w-full px-3 py-2.5 rounded-sm text-sm outline-none transition-colors focus:shadow-[var(--input-ring-focus)]'

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-[11px] px-1" style={{ color: 'var(--warm-muted)' }}>
        <span style={{ color: 'var(--persimmon)' }}>*</span> 표시는 필수 입력 항목입니다
      </p>

      {error && (
        <p className="text-sm rounded-sm px-3 py-2.5"
           style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-ring)', color: 'var(--danger-fg)' }}>
          {error}
        </p>
      )}
      {success && (
        <p className="text-sm rounded-sm px-3 py-2.5"
           style={{ background: 'var(--success-bg)', border: '1px solid var(--success-bg)', color: 'var(--success-fg)' }}>
          {success}
        </p>
      )}

      {needsConfirm && (
        <button
          type="button"
          onClick={handleResendConfirmation}
          disabled={loading}
          className="w-full py-2.5 rounded-xl text-sm font-medium transition-opacity disabled:opacity-60"
          style={{ background: 'var(--persimmon-l)', color: 'var(--persimmon)', border: '1px solid var(--warm-border)' }}
        >
          인증 메일 다시 보내기
        </button>
      )}

      {/* 회원가입 전용 필드 */}
      {mode === 'signup' && (
        <>
          <div>
            <Label required>이름 (실명)</Label>
            <input
              type="text"
              placeholder="홍길동"
              value={realName}
              onChange={e => setRealName(e.target.value)}
              required
              autoComplete="name"
              className={inputCls}
              style={inputStyle}
            />
          </div>
          <div>
            <Label required>전화번호</Label>
            <input
              type="tel"
              inputMode="numeric"
              placeholder="010-1234-5678"
              value={phone}
              onChange={e => handlePhoneChange(e.target.value)}
              required
              autoComplete="tel"
              className={inputCls}
              style={inputStyle}
            />
          </div>
          <AddressSearch
            label="주소"
            address={addressBase}
            detail={addressDetail}
            onAddressChange={setAddressBase}
            onDetailChange={setAddressDetail}
          />
          <div>
            <Label>초대코드</Label>
            <input
              type="text"
              placeholder="STAY-XXXXXX (선택)"
              value={inviteCode}
              onChange={e => setInviteCode(e.target.value.toUpperCase())}
              autoComplete="off"
              className={inputCls}
              style={inputStyle}
            />
            <p className="text-[11px] mt-1 px-1" style={{ color: 'var(--warm-muted)' }}>
              초대코드가 있으면 가입 즉시 이용할 수 있어요. 없으면 운영자 승인 후 이용 가능합니다.
            </p>
          </div>
          <div className="h-px" style={{ background: 'var(--warm-border)' }} />
        </>
      )}

      <div>
        <Label required>이메일</Label>
        <input
          type="email"
          placeholder="example@email.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          autoComplete="email"
          className={inputCls}
          style={inputStyle}
        />
      </div>

      {mode !== 'forgot' && (
        <div>
          <Label required>비밀번호</Label>
          <input
            type="password"
            placeholder={mode === 'signup' ? '영문·숫자·특수문자 8자 이상' : '비밀번호'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            className={inputCls}
            style={inputStyle}
          />
          {mode === 'signup' && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 px-1">
              {PW_RULES.map(r => {
                const ok = r.test(password)
                return (
                  <span
                    key={r.label}
                    className="text-[11px] flex items-center gap-0.5"
                    style={{ color: ok ? 'var(--success-fg)' : 'var(--warm-muted)' }}
                  >
                    {ok ? (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    ) : '·'} {r.label}
                  </span>
                )
              })}
            </div>
          )}
        </div>
      )}

      <Btn
        type="submit"
        variant="primary"
        size="md"
        fullWidth
        disabled={loading}
        className="font-semibold"
      >
        {loading ? (
          /* v2.0 §21 제출 중 — 버튼 내 스피너 14px(0.8s 회전) + 모드별 라벨. fullWidth 라 레이아웃 점프 없음 */
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"
              style={{ animation: 'spin 0.8s linear infinite' }}>
              <path d="M21 12a9 9 0 1 1-6.2-8.56" />
            </svg>
            {mode === 'login' ? '로그인 중…' : mode === 'signup' ? '가입 중…' : '보내는 중…'}
          </>
        )
          : mode === 'login'  ? '이메일로 로그인'
          : mode === 'signup' ? '회원가입'
          :                     '재설정 메일 보내기'}
      </Btn>

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
            ‹ 로그인으로 돌아가기
          </button>
        )}
      </div>
    </form>
  )
}
