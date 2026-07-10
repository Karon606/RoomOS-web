// 고객의 핵심 정보 — 이름·호실·영어이름·성별·국적·직업·생년월일·기초수급자.

import { flagByName } from '@/components/ui/CountrySelect'
import { fmtDateKor as fmtDate } from '@/lib/fmtDate'
import { Section, Grid, Item } from './Section'

type Tenant = {
  name: string
  englishName: string | null
  email: string | null
  gender: string
  nationality: string | null
  job: string | null
  birthdate: Date | string | null
  isBasicRecipient: boolean
  smoking: boolean
  leaseTerms: { room: { roomNo: string } | null }[]
}

const GENDER_LABEL: Record<string, string> = {
  MALE: '남성', FEMALE: '여성', OTHER: '기타', UNKNOWN: '—',
}
const fmtRoomNo = (no?: string | null) => (no ? (/^\d+$/.test(no) ? `${no}호` : no) : '—')

export function TenantBasicInfo({ tenant }: { tenant: Tenant }) {
  const lease = tenant.leaseTerms[0]
  const natFlag = flagByName(tenant.nationality)
  return (
    <Section title="기본 정보">
      <Grid>
        <Item label="이름"       value={<span className="font-semibold text-[var(--warm-dark)]">{tenant.name}</span>} />
        <Item label="호실"       value={fmtRoomNo(lease?.room?.roomNo)} />
        {tenant.englishName && <Item label="영어이름" value={tenant.englishName} />}
        {tenant.email && <Item label="이메일" value={tenant.email} />}
        <Item label="성별"       value={GENDER_LABEL[tenant.gender] ?? tenant.gender} />
        <Item label="국적"       value={tenant.nationality ? `${natFlag} ${tenant.nationality}` : '—'} />
        <Item label="직업"       value={tenant.job ?? '—'} />
        <Item label="흡연 여부"  value={tenant.smoking ? '흡연' : '비흡연'} />
        <Item label="생년월일"   value={fmtDate(tenant.birthdate)} />
        <Item label="기초수급자" value={tenant.isBasicRecipient ? '예/대상자' : '아니오/해당없음'} />
      </Grid>
    </Section>
  )
}
