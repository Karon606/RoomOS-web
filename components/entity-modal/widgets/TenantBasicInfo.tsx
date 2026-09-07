'use client'

// 고객의 핵심 정보 — 이름·호실·영어이름·성별·국적·직업·생년월일·기초수급자.
// 방을 둘 이상 쓰는 고객에게만 '추가 계약'과 '이번 달 청구 합계' 두 줄이 더 붙는다.

import { flagByName } from '@/components/ui/CountrySelect'
import { fmtDateKor as fmtDate } from '@/lib/fmtDate'
import { Section, Grid, Item } from './Section'
import { fmtRoomNo } from '@/lib/roomNo'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { primaryTenantLease, TENANT_LIST_STATUSES } from '@/lib/leaseStatus'
import { isForeignForDocuments } from '@/lib/documentName'
import { STATUS_LABEL } from '@/lib/statusColors'
import { MoneyEquation } from '@/components/ui/MoneyEquation'
import { useEntityModal } from '@/components/entity-modal/EntityModal'

type Lease = {
  id: string
  status: string
  moveInDate: Date | string | null
  rentAmount: number
  room: { id: string; roomNo: string } | null
}

type Tenant = {
  name: string
  englishName: string | null
  // 현지 표기 이름(본국 표기 그대로). 외국인만 값이 있고, 비면 줄이 서지 않는다.
  nativeName?: string | null
  email: string | null
  gender: string
  nationality: string | null
  job: string | null
  birthdate: Date | string | null
  isBasicRecipient: boolean
  smoking: boolean
  // 외국인등록번호 마스킹. 평문은 이 화면에 오지 않는다. 뒤 7자리를 보려면 고객 정보 화면의
  // [보기]를 거쳐야 하고, 그 열람만 기록으로 남는다.
  foreignRegNoMasked?: string | null
  // 메인 계약 선택에 필요한 칸을 함께 받는다 — 호실 한 줄이라도 '어느 계약의 호실인가'는 정본이 정한다.
  leaseTerms: Lease[]
  // 계약이 둘 이상일 때만 서버가 채운다(getTenantDetail). 값은 수납 관리 행의 그 달 청구액 그대로다.
  monthlyBilling?: { month: string; parts: { leaseId: string; roomNo: string; amount: number }[]; total: number } | null
}

const GENDER_LABEL: Record<string, string> = {
  MALE: '남성', FEMALE: '여성', OTHER: '기타', UNKNOWN: '—',
}
export function TenantBasicInfo({ tenant }: { tenant: Tenant }) {
  // 외국인 판정 — 계약서 종이와 같은 축(국적·등록번호). 본국어 이름 상시 노출과 기초수급자
  // 숨김이 이 하나를 본다.
  const foreign = isForeignForDocuments({ nationality: tenant.nationality, hasForeignRegNo: !!tenant.foreignRegNoMasked })
  const entityModal = useEntityModal()
  const lease = primaryTenantLease(tenant.leaseTerms)
  // 부계약 — 메인이 아닌 **진행 중** 계약(창고·사무실 명의 등). 취소된 계약은 죽은 계약이라 세지 않는다
  // (판정은 lib/leaseStatus 의 고객 목록 표시 대상 그대로). 계약이 하나뿐인 고객은 빈 배열이라 줄이 안 뜬다.
  const live: string[] = TENANT_LIST_STATUSES
  const extras = tenant.leaseTerms.filter(l => l.id !== lease?.id && live.includes(l.status))
  const billing = tenant.monthlyBilling ?? null
  const natFlag = flagByName(tenant.nationality)
  return (
    <Section title="기본 정보">
      <Grid>
        <Item label="이름"       value={<span className="font-semibold text-[var(--warm-dark)]">{tenant.name}</span>} />
        <Item label="호실"       value={fmtRoomNo(lease?.room?.roomNo)} />
        {/* 본국어 이름 — 성함 바로 밑(운영자 오더 2026-09-07). 외국인은 값이 없어도 '—' 로 줄이
            서서 수집이 안 됐다는 사실 자체가 보인다(수집은 입주자가 서명 흐름에서 한다). */}
        {(foreign || tenant.nativeName) && <Item label="본국어 이름" value={tenant.nativeName || '—'} />}
        {tenant.englishName && <Item label="영어이름" value={tenant.englishName} />}
        {tenant.email && <Item label="이메일" value={tenant.email} />}
        <Item label="성별"       value={GENDER_LABEL[tenant.gender] ?? tenant.gender} />
        <Item label="국적"       value={tenant.nationality ? `${natFlag} ${tenant.nationality}` : '—'} />
        <Item label="직업"       value={tenant.job ?? '—'} />
        <Item label="흡연 여부"  value={tenant.smoking ? '흡연' : '비흡연'} />
        <Item label="생년월일"   value={fmtDate(tenant.birthdate)} />
        {tenant.foreignRegNoMasked && (
          <Item label="외국인등록번호" value={<span className="tabular-nums">{tenant.foreignRegNoMasked}</span>} />
        )}
        {/* 외국인은 기초생활수급 대상 자체가 아니라 줄을 세우지 않는다 — 해당 없는 항목의
            '아니오'는 정보가 아니라 소음이다(운영자 오더 2026-09-07). */}
        {!foreign && <Item label="기초수급자" value={tenant.isBasicRecipient ? '예/대상자' : '아니오/해당없음'} />}
      </Grid>

      {/* 추가 계약 — 위 '호실'은 메인 계약 하나만 말한다. 그 사람이 방을 둘 쓰는 사실이 여기서만
          보이므로 줄을 접거나 숨기지 않는다. 호실번호 클릭은 형제 위젯(TenantWishRooms·거주 이력)과
          같은 문법이다 — 같은 모달 안에서 그 방의 면으로 바뀐다(평시 행 색, hover 코랄, 밑줄 없음). */}
      {extras.length > 0 && (
        <div className="mt-2.5">
          <p className="text-[0.65625rem] text-[var(--warm-muted)] mb-0.5">추가 계약</p>
          <ul className="space-y-1">
            {extras.map(x => (
              <li key={x.id} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">
                  {x.room
                    ? <button type="button" onClick={() => entityModal.open({ kind: 'room', roomId: x.room!.id })}
                        className="py-1 -my-1 font-medium text-[var(--warm-dark)] transition-colors hover:text-[var(--coral)]">
                        {fmtRoomNo(x.room.roomNo)}
                      </button>
                    : <span className="font-medium text-[var(--warm-dark)]">호실 미지정</span>}
                  <span className="text-[var(--warm-muted)]"> {STATUS_LABEL[x.status] ?? x.status}</span>
                </span>
                <MoneyDisplay amount={x.rentAmount} className="shrink-0 text-[var(--warm-muted)]" />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 이번 달 청구 합계 — 계약별 청구는 그대로 두고 합만 적는다. 항 문장은 MoneyEquation 정본이
          만든다(홈 KPI·수납 관리 캡션과 같은 문법). 값은 수납 관리 행의 그 달 청구액 그대로다. */}
      {billing && (
        <div className="mt-2.5">
          <p className="text-[0.65625rem] text-[var(--warm-muted)] mb-0.5">이번 달 청구 합계</p>
          <p className="text-sm text-[var(--warm-dark)]">
            <MoneyDisplay amount={billing.total} className="font-semibold" />
          </p>
          <p className="mt-0.5 text-[0.65625rem] leading-relaxed text-[var(--warm-muted)]">
            <MoneyEquation terms={billing.parts.map(p => ({ label: fmtRoomNo(p.roomNo, '호실 미지정'), amount: p.amount, op: '+' as const }))} />
          </p>
        </div>
      )}
    </Section>
  )
}
