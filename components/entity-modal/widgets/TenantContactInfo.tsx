'use client'

// 고객 연락처 — 주/비상/해외 연락처 + 전화·문자·메일 바로 연결.

import { useState, useEffect } from 'react'
import { formatPhone } from '@/lib/formatPhone'
import { fmtIntlPhone } from '@/components/ui/IntlPhoneInput'
import { fmtWon } from '@/lib/fmtMoney'
import { TenantSmsModal } from '@/components/TenantSmsModal'
import { UnpaidSmsModal } from '@/components/UnpaidSmsModal'
import { getTenantUnpaidTarget, type TenantUnpaidTarget } from '@/app/(app)/dashboard/actions'
import { Section, Grid, Item } from './Section'

type Contact = {
  contactValue: string
  isPrimary: boolean
  isEmergency: boolean
  isHomeCountry?: boolean
  emergencyName: string | null
  emergencyRelation: string | null
  countryCode?: string | null
}

// tel:/sms: 용 — 숫자·+ 만 남김
const telDigits = (v: string) => v.replace(/[^0-9+]/g, '')

export function TenantContactInfo({ tenantId, contacts, email }: { tenantId: string; contacts: Contact[]; email?: string | null }) {
  const [smsOpen, setSmsOpen] = useState(false)
  // 납부일 경과 미납이면 독촉 대상 조회(정본 computeUnpaidStatus 필터). 미납 아니면 null → 독촉 버튼 미노출.
  const [unpaidTarget, setUnpaidTarget] = useState<TenantUnpaidTarget | null>(null)
  const [unpaidOpen, setUnpaidOpen] = useState(false)
  useEffect(() => { getTenantUnpaidTarget(tenantId).then(setUnpaidTarget).catch(() => {}) }, [tenantId])
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
      {/* 납부일 경과 미납일 때만 — 독촉 문자(정본 UnpaidSmsModal, 미납액·경과일 자동 치환·입금확인 스텝) */}
      {unpaidTarget && phone && (
        <button type="button" onClick={() => setUnpaidOpen(true)}
          className="w-full text-center text-xs font-semibold px-3 py-2 rounded-lg border border-[var(--danger-fg)]/45 text-[var(--danger-fg)] hover:bg-[var(--danger-fg)]/10 transition-colors mb-2">
          독촉 문자 · 미납 {fmtWon(unpaidTarget.unpaidAmount)}{unpaidTarget.daysOverdue != null ? ` · ${unpaidTarget.daysOverdue}일 경과` : ''}
        </button>
      )}
      {smsOpen && <TenantSmsModal tenantId={tenantId} onClose={() => setSmsOpen(false)} />}
      {unpaidOpen && unpaidTarget && <UnpaidSmsModal target={unpaidTarget} z={260} onClose={() => setUnpaidOpen(false)} />}
      <Grid>
        <Item label="주 연락처" value={primary?.contactValue ? formatPhone(primary.contactValue) : '—'} />
        {email && <Item label="이메일" value={email} />}
        {/* 비상연락처는 한 줄로 붙인다 — 급할 때 이름·관계·번호를 한눈에 읽어야 한다
            (운영자 확정 2026-08-31). 종전에는 관계와 번호가 따로 서고 이름은 아예 없었다. */}
        {emergency && (
          <Item label="비상연락처" value={
            [emergency.emergencyName, emergency.emergencyRelation ? `(${emergency.emergencyRelation})` : null, formatPhone(emergency.contactValue)]
              .filter(Boolean).join(' ')
          } />
        )}
        {home && (
          <Item label="해외 연락처" value={fmtIntlPhone(home.contactValue, home.countryCode ?? undefined) || home.contactValue} />
        )}
      </Grid>
    </Section>
  )
}
