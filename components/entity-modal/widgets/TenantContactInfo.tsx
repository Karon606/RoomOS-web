'use client'

// 고객 연락처 — 주/비상/본국 연락처 + 전화·문자·메일 바로 연결.

import { useState } from 'react'
import { formatPhone } from '@/lib/formatPhone'
import { fmtIntlPhone } from '@/components/ui/IntlPhoneInput'
import { TenantSmsModal } from '@/components/TenantSmsModal'
import { Section, Grid, Item } from './Section'

type Contact = {
  contactValue: string
  isPrimary: boolean
  isEmergency: boolean
  isHomeCountry?: boolean
  emergencyRelation: string | null
  countryCode?: string | null
}

// tel:/sms: 용 — 숫자·+ 만 남김
const telDigits = (v: string) => v.replace(/[^0-9+]/g, '')

export function TenantContactInfo({ tenantId, contacts, email }: { tenantId: string; contacts: Contact[]; email?: string | null }) {
  const [smsOpen, setSmsOpen] = useState(false)
  const primary   = contacts.find(c => c.isPrimary)
  const emergency = contacts.find(c => c.isEmergency)
  const home      = contacts.find(c => c.isHomeCountry)
  const phone = primary?.contactValue ? telDigits(primary.contactValue) : null

  const linkCls = 'flex-1 text-center text-xs font-semibold px-3 py-2 rounded-lg border transition-colors'
  const onCls = 'border-[var(--coral)]/45 text-[var(--coral)] hover:bg-[var(--coral)]/10'
  const offCls = 'border-[var(--warm-border)] text-[var(--warm-muted)] pointer-events-none opacity-50'

  return (
    <Section title="연락처">
      {/* 바로 연결 — 모바일에서 탭하면 전화/문자/메일 앱 */}
      <div className="flex items-center gap-1.5 mb-2">
        <a href={phone ? `tel:${phone}` : undefined} className={`${linkCls} ${phone ? onCls : offCls}`}>전화</a>
        <button type="button" onClick={() => setSmsOpen(true)} disabled={!phone}
          className={`${linkCls} ${phone ? onCls : offCls}`}>문자</button>
        <a href={email ? `mailto:${email}` : undefined} className={`${linkCls} ${email ? onCls : offCls}`}>메일</a>
      </div>
      {smsOpen && <TenantSmsModal tenantId={tenantId} onClose={() => setSmsOpen(false)} />}
      <Grid>
        <Item label="주 연락처" value={primary?.contactValue ? formatPhone(primary.contactValue) : '—'} />
        {email && <Item label="이메일" value={email} />}
        {emergency && (
          <>
            <Item label="비상 관계"   value={emergency.emergencyRelation ?? '—'} />
            <Item label="비상 연락처" value={formatPhone(emergency.contactValue)} />
          </>
        )}
        {home && (
          <Item label="본국 연락처" value={fmtIntlPhone(home.contactValue, home.countryCode ?? undefined) || home.contactValue} />
        )}
      </Grid>
    </Section>
  )
}
