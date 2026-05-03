import { getAnnualReport, getAvailableYears, getForecastReport } from './actions'
import ReportClient from './ReportClient'
import { kstYmd } from '@/lib/kstDate'

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>
}) {
  const { year } = await searchParams
  const today = kstYmd()
  const targetYear = year ?? String(today.year)

  const [summary, years, forecast] = await Promise.all([
    getAnnualReport(targetYear),
    getAvailableYears(),
    getForecastReport(6),
  ])

  return <ReportClient summary={summary} years={years} forecast={forecast} />
}
