'use client'

// 원격 서명 링크 생년월일 확인 게이트 — 통과 시 서버가 HMAC 쿠키 발급, 새로고침으로 계약서 진입. 5회 오류 시 잠김.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { verifyShareBirthdate } from './actions'

export default function BirthdateGate({ token }: { token: string }) {
  const router = useRouter()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pending || !value) return
    setPending(true)
    setError(null)
    try {
      const res = await verifyShareBirthdate(token, value)
      if (res.ok) {
        router.refresh()   // 쿠키 반영 후 서버가 계약서 화면을 렌더 — pending 유지로 재제출 방지
        return
      }
      setError(res.error)
      setPending(false)
    } catch {
      setError('확인에 실패했습니다. 잠시 후 다시 시도해 주세요.')
      setPending(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#E8DDD0', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 380, background: '#fff', borderRadius: 16, padding: '28px 24px', boxShadow: '0 4px 24px -6px rgba(61,36,24,.28)', boxSizing: 'border-box' }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#1F1A17', marginBottom: 6 }}>입실 계약서 확인</div>
        <p style={{ fontSize: 13, color: '#6B5D4F', lineHeight: 1.6, margin: '0 0 18px' }}>
          본인 확인을 위해 생년월일을 입력해 주세요. 확인 후 계약 내용을 열람하고 서명할 수 있습니다.
        </p>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#1F1A17', marginBottom: 6 }}>
          생년월일
          <input
            type="date"
            value={value}
            onChange={e => setValue(e.target.value)}
            required
            style={{ display: 'block', width: '100%', marginTop: 6, padding: '10px 12px', fontSize: 15, border: '1px solid #D8CFC4', borderRadius: 10, background: '#fff', color: '#1F1A17', boxSizing: 'border-box' }}
          />
        </label>
        {error && (
          <p style={{ fontSize: 12.5, color: '#A03C2E', lineHeight: 1.5, margin: '10px 0 0' }}>{error}</p>
        )}
        <button
          type="submit"
          disabled={pending || !value}
          style={{ width: '100%', marginTop: 16, padding: '11px 0', fontSize: 14, fontWeight: 600, color: '#fff', background: '#A03C2E', border: 0, borderRadius: 10, cursor: 'pointer', opacity: pending || !value ? 0.6 : 1 }}
        >
          {pending ? '확인 중…' : '확인'}
        </button>
      </form>
    </div>
  )
}
