import { notFound } from 'next/navigation'
import { getResidenceCertData } from './actions'
import ResidenceCertView from './ResidenceCertView'

export default async function ResidenceCertPage({
  params,
}: {
  params: Promise<{ tenantId: string }>
}) {
  const { tenantId } = await params
  const data = await getResidenceCertData(tenantId)
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
