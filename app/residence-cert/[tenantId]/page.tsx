import { notFound } from 'next/navigation'
import { getResidenceCertData } from './actions'
import ResidenceCertView from './ResidenceCertView'

// ?leaseTermId=<id> 는 계약 지목이다(2026-08-13, 다호실 마무리 — /contract/[tenantId] 와 같은 문법).
// 없으면 종전 추론 그대로라 기존 링크·발급 이력의 '다시 작성'은 불변이다.
export default async function ResidenceCertPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>
  searchParams: Promise<{ leaseTermId?: string }>
}) {
  const { tenantId } = await params
  const { leaseTermId } = await searchParams
  const data = await getResidenceCertData(tenantId, leaseTermId ?? null)
  if (!data) notFound()
  // 지자체별 서식 상이 — 현재 서울형만 지원, 그 외 지역은 발급 차단 안내(운영자 정정 2026-07-10)
  if (!data.regionSupported) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-6" style={{ background: 'var(--canvas)' }}>
        <div className="max-w-md w-full rounded-2xl border border-[var(--warm-border)] bg-[var(--cream)] p-6 text-center space-y-2">
          <p className="text-base font-bold text-[var(--warm-dark)]">이 지역 양식은 준비 중입니다</p>
          <p className="text-sm text-[var(--warm-mid)] leading-relaxed">
            실거주 확인서 서식은 지자체마다 달라, 현재는 서울 소재 영업장만 발급할 수 있습니다.<br />
            {data.regionLabel} 소재 영업장의 양식은 추후 업데이트 예정입니다.
          </p>
        </div>
      </div>
    )
  }
  return <ResidenceCertView data={data} />
}
