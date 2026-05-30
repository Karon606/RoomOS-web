// 고객 연락처 — 주/비상/본국 연락처.

import { formatPhone } from '@/lib/formatPhone'
import { fmtIntlPhone } from '@/components/ui/IntlPhoneInput'
import { Section, Grid, Item } from './Section'

type Contact = {
  contactValue: string
  isPrimary: boolean
  isEmergency: boolean
  isHomeCountry?: boolean
  emergencyRelation: string | null
  countryCode?: string | null
}

export function TenantContactInfo({ contacts }: { contacts: Contact[] }) {
  const primary   = contacts.find(c => c.isPrimary)
  const emergency = contacts.find(c => c.isEmergency)
  const home      = contacts.find(c => c.isHomeCountry)
  return (
    <Section title="연락처">
      <Grid>
        <Item label="주 연락처" value={primary?.contactValue ? formatPhone(primary.contactValue) : '—'} />
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
