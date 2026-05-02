import { analyzePaymentTargetMonth } from './actions'
import AccrualCheckClient from './AccrualCheckClient'

export default async function AccrualCheckPage() {
  const result = await analyzePaymentTargetMonth()
  return <AccrualCheckClient initialResult={result} />
}
