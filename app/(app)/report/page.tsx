import { getAnnualReport, getAvailableYears, getForecastReport } from './actions'
import ReportClient from './ReportClient'
import { kstYmd } from '@/lib/kstDate'
import { requireRouteAccess } from '@/lib/auth/requireRouteAccess'
import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { parseReportYear, isReportYearAllowed } from '@/lib/reportShared'

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>
}) {
  await requireRouteAccess()   // 클라 내비 뒷문 차단(제한 스태프)
  const { year } = await searchParams
  const today = kstYmd()
  // 연도는 PDF 라우트와 같은 파서·같은 허용 판정으로 읽는다. 네 자리가 아니거나 기록 없는 지난 연도면
  // 올해로 둔다('2026a' 나 /report?year=1999 를 화면은 그리는데 종이는 400 이 나던 어긋남을 막는다).
  const thisYear = String(today.year)
  // 예상 보고서는 연도와 무관해 먼저 띄워 두고, 연도 판정이 필요한 결산만 기다린다(직렬 왕복을 한 번으로).
  const forecastPromise = getForecastReport(6)
  const years = await getAvailableYears()
  const parsedYear = parseReportYear(year)
  const targetYear = parsedYear && isReportYearAllowed(parsedYear, years, thisYear) ? parsedYear : thisYear
  // 화면이 그린 영업장. PDF 요청에 실어 보내 다른 탭에서 영업장이 바뀌었는지 라우트가 대조한다.
  // 같은 요청 안의 관문 결과를 다시 쓴다(React cache, 추가 조회 없음).
  const { propertyId } = await requirePropertyAccess()

  const [summary, forecast] = await Promise.all([
    getAnnualReport(targetYear),
    forecastPromise,
  ])

  return <ReportClient summary={summary} years={years} forecast={forecast} propertyId={propertyId} />
}
