'use client'

// 원격 서명 링크 생년월일 확인 게이트 — 통과 시 서버가 HMAC 쿠키 발급, 새로고침으로 계약서 진입. 5회 오류 시 잠김.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { verifyShareBirthdate } from './actions'
import { formatBirthdateDigits, digitsToIso, isValidBirthdate } from '@/lib/birthdate'
import DocumentScroll from '@/components/layout/DocumentScroll'
import { bi, biLine, type SignLang } from '@/lib/signGuideText'

// lang: 링크 스냅샷에 박제된 안내 언어. 한국어 정본 줄 + 그 언어 부속 줄로 병기한다(bi 정본).
export default function BirthdateGate({ token, lang = 'ko' }: { token: string; lang?: SignLang }) {
  const router = useRouter()
  // 화면에는 점 포맷("1970.09.28")을 보여주고, 서버에는 ISO("1970-09-28")를 보낸다.
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const valid = isValidBirthdate(value)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const iso = digitsToIso(value)
    if (pending || !iso) return
    setPending(true)
    setError(null)
    try {
      const res = await verifyShareBirthdate(token, iso)
      if (res.ok) {
        router.refresh()   // 쿠키 반영 후 서버가 계약서 화면을 렌더 — pending 유지로 재제출 방지
        return
      }
      setError(res.error)
      setPending(false)
    } catch {
      setError(bi(lang, 'gate.netFail'))
      setPending(false)
    }
  }

  return (
    <div style={{ minHeight: '100dvh', background: '#E8DDD0', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <DocumentScroll />
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 380, background: '#fff', borderRadius: 16, padding: '28px 24px', boxShadow: '0 4px 24px -6px rgba(61,36,24,.28)', boxSizing: 'border-box' }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#1F1A17', marginBottom: 6, whiteSpace: 'pre-line' }}>{bi(lang, 'gate.title')}</div>
        <p style={{ fontSize: 13, color: '#6B5D4F', lineHeight: 1.6, margin: '0 0 18px', whiteSpace: 'pre-line' }}>
          {bi(lang, 'gate.hint')}
        </p>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#1F1A17', marginBottom: 6, whiteSpace: 'pre-line' }}>
          {bi(lang, 'gate.birthLabel')}
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={value}
            onChange={e => setValue(formatBirthdateDigits(e.target.value))}
            placeholder={biLine(lang, 'gate.placeholder')}
            required
            style={{ display: 'block', width: '100%', minWidth: 0, marginTop: 6, padding: '10px 12px', fontSize: 15, border: '1px solid #D8CFC4', borderRadius: 10, background: '#fff', color: '#1F1A17', boxSizing: 'border-box', WebkitAppearance: 'none', appearance: 'none' }}
          />
        </label>
        {error && (
          <p style={{ fontSize: 12.5, color: '#A03C2E', lineHeight: 1.5, margin: '10px 0 0', whiteSpace: 'pre-line' }}>{error}</p>
        )}
        <button
          type="submit"
          disabled={pending || !valid}
          style={{ width: '100%', marginTop: 16, padding: '11px 0', fontSize: 14, fontWeight: 600, color: '#fff', background: '#A03C2E', border: 0, borderRadius: 10, cursor: 'pointer', opacity: pending || !valid ? 0.6 : 1 }}
        >
          {pending ? biLine(lang, 'gate.submitting') : biLine(lang, 'gate.submit')}
        </button>
        {/* 입주자가 자기 정보를 직접 넣는 유일한 화면이다 — 무엇에 쓰이는지 그 자리에서 말한다.
            이 화면은 앱 셸 밖 단독 라우트라 스타일이 인라인이다(형제 문법 그대로). */}
        <p style={{ fontSize: 11.5, color: '#6B5D4F', lineHeight: 1.6, margin: '14px 0 0', whiteSpace: 'pre-line' }}>
          {bi(lang, 'gate.privacy')}
        </p>
      </form>
    </div>
  )
}
