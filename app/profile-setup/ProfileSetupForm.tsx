'use client'

import { useState, useTransition } from 'react'
import { AsYouType } from 'libphonenumber-js'
import { AddressSearch } from '@/components/ui/AddressSearch'
import { Btn } from '@/components/ui/Btn'
import { saveProfileSetup, skipProfileSetup } from './actions'

export default function ProfileSetupForm({
  email,
  initial,
}: {
  email: string
  initial: { realName: string; phone: string; address: string }
}) {
  const [realName, setRealName] = useState(initial.realName)
  const [phone, setPhone] = useState(initial.phone)
  const [addressBase, setAddressBase] = useState(initial.address)
  const [addressDetail, setAddressDetail] = useState('')
  const [error, setError] = useState('')
  const [savePending, startSave] = useTransition()
  const [skipPending, startSkip] = useTransition()

  const handlePhoneChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 11)
    setPhone(new AsYouType('KR').input(digits))
  }

  const handleSave = () => {
    setError('')
    if (!realName.trim()) { setError('이름(실명)은 필수입니다.'); return }
    const address = [addressBase, addressDetail].map(s => s.trim()).filter(Boolean).join(' ')
    startSave(async () => {
      try {
        await saveProfileSetup({ realName, phone, address })
      } catch (e) {
        if ((e as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw e
        setError((e as Error).message ?? '저장 실패')
      }
    })
  }

  const handleSkip = () => {
    startSkip(async () => {
      try { await skipProfileSetup() }
      catch (e) {
        if ((e as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw e
      }
    })
  }

  const inputCls = 'w-full px-3 py-2.5 rounded-sm text-sm outline-none transition-colors'
  const inputStyle: React.CSSProperties = {
    background: 'var(--canvas)',
    border: '1px solid var(--warm-border)',
    color: 'var(--warm-dark)',
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl p-5 space-y-3"
        style={{ background: 'var(--cream)', border: '1px solid var(--cream-3)' }}>
        <p className="text-xs" style={{ color: 'var(--ink-mute)' }}>
          {email}
        </p>

        <div>
          <label className="block text-xs font-medium mb-1 px-1" style={{ color: 'var(--warm-dark)' }}>
            이름 (실명) <span style={{ color: 'var(--persimmon)' }}>*</span>
          </label>
          <input type="text" placeholder="홍길동"
            value={realName} onChange={e => setRealName(e.target.value)}
            autoComplete="name"
            className={inputCls} style={inputStyle} />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1 px-1" style={{ color: 'var(--warm-dark)' }}>전화번호</label>
          <input type="tel" inputMode="numeric" placeholder="010-1234-5678"
            value={phone} onChange={e => handlePhoneChange(e.target.value)}
            autoComplete="tel"
            className={inputCls} style={inputStyle} />
        </div>

        <AddressSearch
          label="주소"
          address={addressBase}
          detail={addressDetail}
          onAddressChange={setAddressBase}
          onDetailChange={setAddressDetail}
        />

        {error && (
          <p className="text-sm rounded-sm px-3 py-2.5"
            style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-ring)', color: 'var(--danger-fg)' }}>
            {error}
          </p>
        )}
      </div>

      <Btn variant="primary" size="md" onClick={handleSave} disabled={savePending || skipPending} fullWidth>
        {savePending ? '저장 중...' : '저장하고 계속'}
      </Btn>

      <button type="button" onClick={handleSkip} disabled={savePending || skipPending}
        className="w-full text-sm py-2 disabled:opacity-50"
        style={{ color: 'var(--warm-muted)' }}>
        {skipPending ? '...' : '나중에 입력하기'}
      </button>
    </div>
  )
}
